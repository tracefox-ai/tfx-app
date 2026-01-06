import http from 'http';
import http2, {
  ClientHttp2Session,
  Http2ServerRequest,
  Http2ServerResponse,
} from 'http2';
import { PassThrough, Transform } from 'stream';
import { URL } from 'url';

import * as config from '@/config';
import {
  markIngestionTokenUsed,
  resolveIngestionToken,
} from '@/controllers/ingestionAuth';
import logger from '@/utils/logger';

type CachedAuth = {
  teamId: string;
  assignedShard?: string;
  expiresAt: number;
};

const authCache = new Map<string, CachedAuth>();

function getAuthHeader(headers: http.IncomingHttpHeaders | http2.IncomingHttpHeaders): string | string[] | undefined {
  // Try lowercase first (Node.js HTTP/1.1 normalizes to lowercase)
  if (headers.authorization) {
    return headers.authorization;
  }
  // Try various case combinations for HTTP/2 or non-normalized headers
  const headerKeys = Object.keys(headers);
  const authKey = headerKeys.find(
    key => key.toLowerCase() === 'authorization'
  );
  return authKey ? headers[authKey] : undefined;
}

function getBearerToken(authHeader?: string | string[]) {
  const h = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!h) return null;
  // Try to match "Bearer <token>" format first
  const m = h.match(/^[Bb]earer\s+(.+)$/);
  if (m?.[1]) {
    return m[1].trim();
  }
  // If no Bearer prefix, treat the entire header value as the token
  // (some clients may send the token directly without the Bearer prefix)
  const trimmed = h.trim();
  return trimmed || null;
}

function shardIndexFromId(shardId: string) {
  const m = shardId.match(/^shard-(\d+)$/);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}

function pickShardEndpoint(shardId: string, endpoints: string[]) {
  const idx = shardIndexFromId(shardId);
  if (idx == null) return null;
  return endpoints[idx] ?? null;
}

async function authenticateToken(token: string): Promise<CachedAuth | null> {
  // Cache by token string hash (done in resolveIngestionToken).
  const resolved = await resolveIngestionToken(token);
  const tokenHash = resolved?.tokenHash;
  if (!tokenHash) return null;
  const now = Date.now();
  const cached = authCache.get(tokenHash);
  if (cached && cached.expiresAt > now) return cached;

  if (!resolved) return null;

  const assignedShard = resolved.assignedShard;
  const result: CachedAuth = {
    teamId: resolved.teamId,
    assignedShard,
    expiresAt: now + 60_000,
  };
  authCache.set(tokenHash, result);

  // Best-effort usage tracking (don’t await).
  void markIngestionTokenUsed(resolved.tokenId);

  return result;
}

function pipeHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetBaseUrl: string,
  teamId: string,
  requestId: string,
) {
  const base = new URL(targetBaseUrl);
  const targetUrl = new URL(req.url || '/', base);

  // Track data volume using PassThrough to avoid consuming the stream
  let bytesReceived = 0;
  let firstChunk: Buffer | null = null;
  const maxSampleSize = 1024; // Sample first 1KB
  const trackingStream = new PassThrough();

  trackingStream.on('data', (chunk: Buffer) => {
    bytesReceived += chunk.length;
    if (firstChunk === null && chunk.length > 0) {
      firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
    }
  });

  trackingStream.on('end', () => {
    if (bytesReceived > 0) {
      const sample = firstChunk
        ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
        : null;
      logger.info({
        requestId,
        teamId,
        bytesReceived,
        hasData: true,
        dataSample: sample,
        contentType: req.headers['content-type'],
      }, 'OTLP HTTP gateway: request data received');
    }
  });

  const proxyReq = http.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: targetUrl.pathname + targetUrl.search,
      headers: {
        ...req.headers,
        host: targetUrl.host,
        'x-hdx-team-id': teamId,
      },
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers as any);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', err => {
    logger.error({ err, requestId, teamId }, 'OTLP HTTP proxy error');
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });

  // Pipe through tracking stream to monitor data
  req.pipe(trackingStream).pipe(proxyReq);
}

export async function startOtlpGateway() {
  // HTTP (OTLP/HTTP, typically 4318)
  const httpServer = http.createServer(async (req, res) => {
    const startTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Track data even if auth fails - use Transform to capture while forwarding
    let bytesReceived = 0;
    let firstChunk: Buffer | null = null;
    const maxSampleSize = 1024;
    let authFailed = false;
    let teamId: string | null = null;

    // Transform stream that captures data but forwards it
    const dataCaptureTransform = new Transform({
      transform(chunk: Buffer, encoding, callback) {
        bytesReceived += chunk.length;
        if (firstChunk === null && chunk.length > 0) {
          firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
        }
        // Forward the data
        callback(null, chunk);
      },
      flush(callback) {
        // Log data when stream ends, regardless of auth status
        if (bytesReceived > 0) {
          const sample = firstChunk
            ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
            : null;
          const logData: any = {
            requestId,
            bytesReceived,
            dataSample: sample,
            contentType: req.headers['content-type'],
          };
          if (teamId) {
            logData.teamId = teamId;
          }
          if (authFailed) {
            logger.warn(logData, 'OTLP HTTP gateway: request data received (auth failed)');
          } else {
            logger.info(logData, 'OTLP HTTP gateway: request data received');
          }
        }
        callback();
      },
    });

    try {
      const authHeader = getAuthHeader(req.headers);
      const tokenPrefix = authHeader
        ? (typeof authHeader === 'string' ? authHeader.substring(0, 20) + '...' : 'multiple')
        : 'none';

      // Log all header keys for debugging
      const headerKeys = Object.keys(req.headers);
      const authHeaderKeys = headerKeys.filter(key =>
        key.toLowerCase() === 'authorization'
      );

      logger.info({
        requestId,
        method: req.method,
        url: req.url,
        headers: {
          'content-type': req.headers['content-type'],
          'content-length': req.headers['content-length'],
          'user-agent': req.headers['user-agent'],
          'host': req.headers.host,
          'authorization': tokenPrefix,
        },
        headerKeys: headerKeys.slice(0, 10), // First 10 for debugging
        authHeaderKeysFound: authHeaderKeys,
        remoteAddress: req.socket.remoteAddress,
        remotePort: req.socket.remotePort,
      }, 'OTLP HTTP gateway: incoming request');

      const token = getBearerToken(authHeader);
      if (!token) {
        authFailed = true;
        logger.warn({ requestId }, 'OTLP HTTP gateway: missing token');
        // Still capture and log data even on auth failure - use a sink stream
        const sinkStream = new PassThrough();
        sinkStream.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;
          if (firstChunk === null && chunk.length > 0) {
            firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
          }
        });
        sinkStream.on('end', () => {
          if (bytesReceived > 0) {
            const sample = firstChunk
              ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
              : null;
            logger.warn({
              requestId,
              bytesReceived,
              dataSample: sample,
              contentType: req.headers['content-type'],
            }, 'OTLP HTTP gateway: request data received (auth failed)');
          }
          res.writeHead(401);
          res.end('missing token');
        });
        req.pipe(sinkStream);
        return;
      }

      const auth = await authenticateToken(token);
      if (!auth) {
        authFailed = true;
        logger.warn({ requestId, tokenPrefix: token.substring(0, 10) + '...' }, 'OTLP HTTP gateway: invalid token');
        // Still capture and log data even on auth failure - use a sink stream
        const sinkStream = new PassThrough();
        sinkStream.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;
          if (firstChunk === null && chunk.length > 0) {
            firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
          }
        });
        sinkStream.on('end', () => {
          if (bytesReceived > 0) {
            const sample = firstChunk
              ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
              : null;
            logger.warn({
              requestId,
              tokenPrefix: token.substring(0, 10) + '...',
              bytesReceived,
              dataSample: sample,
              contentType: req.headers['content-type'],
            }, 'OTLP HTTP gateway: request data received (auth failed)');
          }
          res.writeHead(401);
          res.end('invalid token');
        });
        req.pipe(sinkStream);
        return;
      }

      teamId = auth.teamId;
      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
      }, 'OTLP HTTP gateway: authenticated request');

      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
      }, 'OTLP HTTP gateway: authenticated request');

      const target = pickShardEndpoint(
        auth.assignedShard || 'shard-0',
        config.INGESTION_SHARD_HTTP_ENDPOINTS,
      );
      if (!target) {
        logger.error({
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          configuredEndpoints: config.INGESTION_SHARD_HTTP_ENDPOINTS,
          endpointCount: config.INGESTION_SHARD_HTTP_ENDPOINTS.length,
        }, 'OTLP HTTP gateway: no shard endpoint available. Set INGESTION_SHARD_HTTP_ENDPOINTS environment variable (comma-separated list of endpoints, e.g., "http://localhost:14318" for do)');
        res.writeHead(503);
        return res.end('no shard endpoint');
      }

      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
        targetEndpoint: target,
      }, 'OTLP HTTP gateway: routing to shard');

      // Track response
      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = function (statusCode: number, ...args: any[]) {
        const duration = Date.now() - startTime;
        logger.info({
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          targetEndpoint: target,
          statusCode,
          durationMs: duration,
        }, 'OTLP HTTP gateway: response sent');
        return originalWriteHead(statusCode, ...args);
      };

      // Pipe through data capture transform, then to proxy
      // The transform will log data when stream ends
      const base = new URL(target);
      const targetUrl = new URL(req.url || '/', base);

      const proxyReq = http.request(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          method: req.method,
          path: targetUrl.pathname + targetUrl.search,
          headers: {
            ...req.headers,
            host: targetUrl.host,
            'x-hdx-team-id': auth.teamId,
          },
        },
        proxyRes => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers as any);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', err => {
        logger.error({ err, requestId, teamId: auth.teamId }, 'OTLP HTTP proxy error');
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });

      // Pipe request through capture transform to proxy
      req.pipe(dataCaptureTransform).pipe(proxyReq);
    } catch (e) {
      logger.error({ err: e, requestId }, 'OTLP HTTP gateway error');
      res.writeHead(500);
      res.end('error');
    }
  });

  httpServer.listen(config.OTLP_GATEWAY_HTTP_PORT, () => {
    logger.info(
      `OTLP HTTP gateway listening on ${config.OTLP_GATEWAY_HTTP_PORT}`,
    );
  });

  // gRPC (OTLP/gRPC, typically 4317) over h2c proxy.
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionPingIntervals = new Map<string, NodeJS.Timeout>();

  const getClientSession = (targetBaseUrl: string): Promise<ClientHttp2Session> => {
    return new Promise((resolve, reject) => {
      const existing = sessions.get(targetBaseUrl);
      if (existing && !existing.closed && !existing.destroyed) {
        // Double-check session is still valid
        if (existing.destroyed || existing.closed) {
          sessions.delete(targetBaseUrl);
          const pingInterval = sessionPingIntervals.get(targetBaseUrl);
          if (pingInterval) {
            clearInterval(pingInterval);
            sessionPingIntervals.delete(targetBaseUrl);
          }
        } else {
          // Session exists and is ready - check if it's still connecting
          if (existing.connecting) {
            // Wait for connection to complete with timeout
            const timeout = setTimeout(() => {
              reject(new Error(`Connection timeout for ${targetBaseUrl}`));
            }, 5000); // 5 second timeout

            existing.once('connect', () => {
              clearTimeout(timeout);
              resolve(existing);
            });
            existing.once('error', (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          } else {
            // Session is ready and already connected
            resolve(existing);
          }
          return;
        }
      }

      // Create new HTTP/2 session with keepalive settings
      const s = http2.connect(targetBaseUrl, {
        // Enable keepalive to prevent idle connection timeouts
        // These settings help maintain the connection and detect dead connections
      });

      // Connection timeout
      const timeout = setTimeout(() => {
        if (!s.destroyed) {
          s.destroy();
        }
        reject(new Error(`Connection timeout for ${targetBaseUrl}`));
      }, 5000); // 5 second timeout

      // Wait for connection to be established before resolving
      s.once('connect', () => {
        clearTimeout(timeout);

        // Double-check session is still valid after connect
        if (s.destroyed || s.closed) {
          reject(new Error(`Session closed immediately after connect for ${targetBaseUrl}`));
          return;
        }

        // Set up periodic ping to keep connection alive and detect dead connections
        // Ping every 30 seconds (typical HTTP/2 keepalive interval)
        const pingInterval = setInterval(() => {
          if (s.destroyed || s.closed) {
            clearInterval(pingInterval);
            sessionPingIntervals.delete(targetBaseUrl);
            return;
          }
          try {
            // Send HTTP/2 PING frame to keep connection alive
            s.ping((err, duration, payload) => {
              if (err) {
                logger.warn({ err, targetBaseUrl }, 'OTLP gRPC gateway: HTTP/2 ping failed');
                // If ping fails, the session is likely dead - clean it up
                sessions.delete(targetBaseUrl);
                clearInterval(pingInterval);
                sessionPingIntervals.delete(targetBaseUrl);
                if (!s.destroyed) {
                  s.destroy();
                }
              }
            });
          } catch (err) {
            logger.warn({ err, targetBaseUrl }, 'OTLP gRPC gateway: HTTP/2 ping error');
            sessions.delete(targetBaseUrl);
            clearInterval(pingInterval);
            sessionPingIntervals.delete(targetBaseUrl);
          }
        }, 30000); // Ping every 30 seconds

        sessions.set(targetBaseUrl, s);
        sessionPingIntervals.set(targetBaseUrl, pingInterval);
        resolve(s);
      });

      s.on('error', (err) => {
        clearTimeout(timeout);
        const isConnectionReset = err.code === 'ECONNRESET';
        const isDuringConnection = s.connecting;

        // ECONNRESET during connection setup is a real error - connection failed
        if (isDuringConnection) {
          logger.error({ err, targetBaseUrl }, 'OTLP gRPC gateway: HTTP/2 connection failed');
          sessions.delete(targetBaseUrl);
          const pingInterval = sessionPingIntervals.get(targetBaseUrl);
          if (pingInterval) {
            clearInterval(pingInterval);
            sessionPingIntervals.delete(targetBaseUrl);
          }
          reject(err);
          return;
        }

        // ECONNRESET after connection is established is usually just the server closing idle connections
        // This is normal behavior and we'll just recreate the session on next use
        // Only log non-ECONNRESET errors as they indicate real problems
        if (!isConnectionReset) {
          logger.error({ err, targetBaseUrl }, 'OTLP gRPC gateway: HTTP/2 session error');
        } else {
          // ECONNRESET on established connection - this is expected, don't log
          // The session will be recreated on next use
        }

        sessions.delete(targetBaseUrl);
        const pingInterval = sessionPingIntervals.get(targetBaseUrl);
        if (pingInterval) {
          clearInterval(pingInterval);
          sessionPingIntervals.delete(targetBaseUrl);
        }
      });

      s.on('close', () => {
        clearTimeout(timeout);
        sessions.delete(targetBaseUrl);
        const pingInterval = sessionPingIntervals.get(targetBaseUrl);
        if (pingInterval) {
          clearInterval(pingInterval);
          sessionPingIntervals.delete(targetBaseUrl);
        }
      });
    });
  };

  const grpcServer = http2.createServer();

  // Handle server-level errors
  grpcServer.on('error', (err) => {
    logger.error({ err }, 'OTLP gRPC gateway: server error');
  });

  grpcServer.on('stream', async (stream, headers) => {
    const startTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Track data even if auth fails
    let bytesReceived = 0;
    let firstChunk: Buffer | null = null;
    const maxSampleSize = 1024;
    let chunkCount = 0;
    let authFailed = false;
    let teamId: string | null = null;
    let streamResponded = false;
    let streamEnded = false;

    // Helper function to safely respond to stream
    const safeRespond = (headers: http2.OutgoingHttpHeaders) => {
      if (!streamResponded && !stream.destroyed && !stream.closed) {
        try {
          stream.respond(headers);
          streamResponded = true;
        } catch (err) {
          logger.warn({ err, requestId }, 'OTLP gRPC gateway: failed to respond to stream');
        }
      }
    };

    // Helper function to safely end stream
    const safeEnd = () => {
      if (!streamEnded && !stream.destroyed) {
        try {
          stream.end();
          streamEnded = true;
        } catch (err) {
          // Stream may already be closed, ignore
        }
      }
    };

    // Handle stream errors and close events
    stream.on('error', (err) => {
      logger.warn({ err, requestId, teamId }, 'OTLP gRPC gateway: stream error');
    });

    stream.on('close', () => {
      // Log data when stream closes
      if (bytesReceived > 0) {
        const sample = firstChunk
          ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
          : null;
        const logData: any = {
          requestId,
          bytesReceived,
          chunkCount,
          dataSample: sample,
          contentType: headers['content-type'],
        };
        if (teamId) {
          logData.teamId = teamId;
        }
        if (authFailed) {
          logger.warn(logData, 'OTLP gRPC gateway: stream closed (auth failed)');
        } else {
          logger.info(logData, 'OTLP gRPC gateway: stream closed');
        }
      }
    });

    try {
      const authHeader = getAuthHeader(headers);
      const tokenPrefix = authHeader
        ? (typeof authHeader === 'string' ? authHeader.substring(0, 20) + '...' : 'multiple')
        : 'none';

      // Log all header keys for debugging
      const headerKeys = Object.keys(headers);
      const authHeaderKeys = headerKeys.filter(key =>
        key.toLowerCase() === 'authorization'
      );

      logger.info({
        requestId,
        method: headers[':method'],
        path: headers[':path'],
        headers: {
          'content-type': headers['content-type'],
          'user-agent': headers['user-agent'],
          'grpc-timeout': headers['grpc-timeout'],
          'authorization': tokenPrefix,
        },
        headerKeys: headerKeys.slice(0, 10), // First 10 for debugging
        authHeaderKeysFound: authHeaderKeys,
        streamId: stream.id,
      }, 'OTLP gRPC gateway: incoming stream');

      const token = getBearerToken(authHeader);
      if (!token) {
        authFailed = true;
        logger.warn({ requestId }, 'OTLP gRPC gateway: missing token');
        // Still track data even on auth failure
        stream.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;
          chunkCount++;
          if (firstChunk === null && chunk.length > 0) {
            firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
          }
        });
        safeRespond({ ':status': 401 });
        safeEnd();
        return;
      }
      const auth = await authenticateToken(token);
      if (!auth) {
        authFailed = true;
        logger.warn({ requestId, tokenPrefix: token.substring(0, 10) + '...' }, 'OTLP gRPC gateway: invalid token');
        // Still track data even on auth failure
        stream.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;
          chunkCount++;
          if (firstChunk === null && chunk.length > 0) {
            firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
          }
        });
        safeRespond({ ':status': 401 });
        safeEnd();
        return;
      }

      teamId = auth.teamId;

      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
      }, 'OTLP gRPC gateway: authenticated stream');

      const target = pickShardEndpoint(
        auth.assignedShard || 'shard-0',
        config.INGESTION_SHARD_GRPC_ENDPOINTS,
      );
      if (!target) {
        logger.error({
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          configuredEndpoints: config.INGESTION_SHARD_GRPC_ENDPOINTS,
          endpointCount: config.INGESTION_SHARD_GRPC_ENDPOINTS.length,
        }, 'OTLP gRPC gateway: no shard endpoint available. Set INGESTION_SHARD_GRPC_ENDPOINTS environment variable (comma-separated list of endpoints, e.g., "http://localhost:14317" for shard-0)');
        safeRespond({ ':status': 503 });
        safeEnd();
        return;
      }

      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
        targetEndpoint: target,
      }, 'OTLP gRPC gateway: routing to shard');

      // Track data volume for gRPC stream using Transform to avoid consuming
      let dataSentToProxy = false;
      const trackingTransform = new Transform({
        transform(chunk: Buffer, encoding, callback) {
          bytesReceived += chunk.length;
          chunkCount++;
          if (firstChunk === null && chunk.length > 0) {
            firstChunk = chunk.slice(0, Math.min(chunk.length, maxSampleSize));
          }
          // Track when we first send data
          if (!dataSentToProxy) {
            dataSentToProxy = true;
            logger.info({
              requestId,
              teamId: auth.teamId,
              targetEndpoint: target,
              timeSinceStart: Date.now() - startTime,
              chunkSize: chunk.length,
            }, 'OTLP gRPC gateway: first data sent to proxy');
          }
          // Pass through the data
          callback(null, chunk);
        },
        flush(callback) {
          if (bytesReceived > 0) {
            const sample = firstChunk
              ? firstChunk.toString('utf8', 0, Math.min(firstChunk.length, 512))
              : null;
            const logData: any = {
              requestId,
              bytesReceived,
              chunkCount,
              dataSample: sample,
              contentType: headers['content-type'],
            };
            if (teamId) {
              logData.teamId = teamId;
            }
            if (authFailed) {
              logger.warn(logData, 'OTLP gRPC gateway: stream data received (auth failed)');
            } else {
              logger.info(logData, 'OTLP gRPC gateway: stream data received');
            }
          }
          callback();
        },
      });

      let session: ClientHttp2Session;
      try {
        session = await getClientSession(target);

        // Double-check session is ready after getting it (might have been closed between await and here)
        if (session.destroyed || session.closed || session.connecting) {
          // Session became invalid, try to get a new one
          logger.warn({
            requestId,
            teamId: auth.teamId,
            assignedShard: auth.assignedShard,
            targetEndpoint: target,
            destroyed: session.destroyed,
            closed: session.closed,
            connecting: session.connecting,
          }, 'OTLP gRPC gateway: session invalid after connect, retrying');

          // Remove invalid session and try again
          sessions.delete(target);
          const pingInterval = sessionPingIntervals.get(target);
          if (pingInterval) {
            clearInterval(pingInterval);
            sessionPingIntervals.delete(target);
          }

          // Retry once
          try {
            session = await getClientSession(target);
          } catch (retryErr) {
            logger.error({
              err: retryErr,
              requestId,
              teamId: auth.teamId,
              assignedShard: auth.assignedShard,
              targetEndpoint: target,
            }, 'OTLP gRPC gateway: failed to get HTTP/2 session after retry');
            safeRespond({ ':status': 503 });
            safeEnd();
            return;
          }
        }
      } catch (err) {
        logger.error({
          err,
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          targetEndpoint: target,
        }, 'OTLP gRPC gateway: failed to get HTTP/2 session');
        safeRespond({ ':status': 503 });
        safeEnd();
        return;
      }

      // Final check if session is ready (not destroyed or closed)
      if (session.destroyed || session.closed) {
        logger.error({
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          targetEndpoint: target,
        }, 'OTLP gRPC gateway: HTTP/2 session not available');
        safeRespond({ ':status': 503 });
        safeEnd();
        return;
      }

      const reqHeaders: http2.OutgoingHttpHeaders = {
        ...headers,
        // Ensure the downstream sees the correct :authority
        ':authority': new URL(target).host,
        'x-hdx-team-id': auth.teamId,
      };

      // Log request details for debugging
      logger.info({
        requestId,
        teamId: auth.teamId,
        assignedShard: auth.assignedShard,
        targetEndpoint: target,
        method: headers[':method'],
        path: headers[':path'],
        sessionState: {
          destroyed: session.destroyed,
          closed: session.closed,
          connecting: session.connecting,
        },
        headersSent: Object.keys(reqHeaders).filter(k => !k.startsWith(':')),
      }, 'OTLP gRPC gateway: creating proxy stream');

      const proxyStream = session.request(reqHeaders);
      let responseReceived = false;
      let dataReceivedFromProxy = false;

      // Track when data flows
      proxyStream.on('data', () => {
        if (!dataReceivedFromProxy) {
          dataReceivedFromProxy = true;
          logger.info({
            requestId,
            teamId: auth.teamId,
            targetEndpoint: target,
            timeSinceStart: Date.now() - startTime,
          }, 'OTLP gRPC gateway: first data received from proxy');
        }
      });

      proxyStream.on('response', proxyHeaders => {
        responseReceived = true;
        const statusCode = proxyHeaders[':status'] as number | undefined;
        const duration = Date.now() - startTime;
        logger.info({
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          targetEndpoint: target,
          statusCode,
          durationMs: duration,
          responseHeaders: Object.keys(proxyHeaders),
        }, 'OTLP gRPC gateway: response received');
        safeRespond(proxyHeaders as any);
      });

      proxyStream.on('error', (err) => {
        const duration = Date.now() - startTime;
        // ECONNRESET is a common transient error when the server closes the connection
        // It often happens during normal operation and shouldn't be logged as an error
        const isConnectionReset = err.code === 'ECONNRESET';
        const logLevel = isConnectionReset ? 'warn' : 'error';
        logger[logLevel]({
          err,
          requestId,
          teamId: auth.teamId,
          assignedShard: auth.assignedShard,
          targetEndpoint: target,
          durationMs: duration,
          responseReceived,
          dataSentToProxy,
          dataReceivedFromProxy,
          sessionState: {
            destroyed: session.destroyed,
            closed: session.closed,
          },
          proxyStreamState: {
            destroyed: proxyStream.destroyed,
            closed: proxyStream.closed,
          },
        }, 'OTLP gRPC gateway: proxy stream error');
        safeRespond({ ':status': 502 });
        safeEnd();
      });

      // Handle stream close events
      stream.on('aborted', () => {
        logger.warn({
          requestId,
          teamId,
          durationMs: Date.now() - startTime,
        }, 'OTLP gRPC gateway: stream aborted by client');
        proxyStream.destroy();
      });

      proxyStream.on('close', () => {
        const duration = Date.now() - startTime;
        logger.info({
          requestId,
          teamId: auth.teamId,
          targetEndpoint: target,
          durationMs: duration,
          responseReceived,
          dataSentToProxy,
          dataReceivedFromProxy,
        }, 'OTLP gRPC gateway: proxy stream closed');
        safeEnd();
      });

      // Handle session errors that might occur while stream is active
      const sessionErrorHandler = (err: Error) => {
        // If session dies while stream is active, clean up the stream
        if (!proxyStream.destroyed && !proxyStream.closed) {
          proxyStream.destroy();
        }
      };
      session.once('error', sessionErrorHandler);
      proxyStream.once('close', () => {
        session.removeListener('error', sessionErrorHandler);
      });

      // Pipe through tracking transform to monitor data
      stream.pipe(trackingTransform).pipe(proxyStream);
      proxyStream.pipe(stream);
    } catch (e) {
      logger.error({ err: e, requestId }, 'OTLP gRPC gateway error');
      safeRespond({ ':status': 500 });
      safeEnd();
    }
  });

  grpcServer.listen(config.OTLP_GATEWAY_GRPC_PORT, () => {
    logger.info(
      `OTLP gRPC gateway listening on ${config.OTLP_GATEWAY_GRPC_PORT}`,
    );
  });
}
