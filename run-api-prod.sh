#!/bin/bash

# Script to run the API in production mode standalone
# Note: Uses ts-node (dev mode) if build fails, since there are TypeScript errors

# Default values
PORT=${PORT:-8000}
MONGO_URI=${MONGO_URI:-mongodb://localhost:27017/hyperdx}
HYPERDX_API_KEY=${HYPERDX_API_KEY:-your-api-key-here}
EXPRESS_SESSION_SECRET=${EXPRESS_SESSION_SECRET:-change-this-to-a-random-string}
FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
OPAMP_PORT=${OPAMP_PORT:-4319}
USE_DEV_MODE=${USE_DEV_MODE:-true}

echo "Starting API server..."
echo "Port: $PORT"
echo "MongoDB: $MONGO_URI"
echo "Frontend URL: $FRONTEND_URL"
echo ""

cd packages/api

# Try to build, but fall back to dev mode if it fails
if [ "$USE_DEV_MODE" != "true" ] && [ ! -d "build" ]; then
  echo "Building API..."
  if yarn build 2>/dev/null; then
    echo "Build successful!"
    USE_BUILD=true
  else
    echo "Build failed (TypeScript errors). Falling back to dev mode (ts-node)..."
    USE_BUILD=false
  fi
elif [ -d "build" ]; then
  USE_BUILD=true
else
  USE_BUILD=false
fi

# Start the API server
if [ "$USE_BUILD" = "true" ]; then
  echo "Starting from build directory..."
  PORT=$PORT \
  MONGO_URI=$MONGO_URI \
  HYPERDX_API_KEY=$HYPERDX_API_KEY \
  EXPRESS_SESSION_SECRET=$EXPRESS_SESSION_SECRET \
  FRONTEND_URL=$FRONTEND_URL \
  OPAMP_PORT=$OPAMP_PORT \
  NODE_ENV=production \
  yarn start
else
  echo "Starting with ts-node (dev mode with production env vars)..."
  PORT=$PORT \
  MONGO_URI=$MONGO_URI \
  HYPERDX_API_KEY=$HYPERDX_API_KEY \
  EXPRESS_SESSION_SECRET=$EXPRESS_SESSION_SECRET \
  FRONTEND_URL=$FRONTEND_URL \
  OPAMP_PORT=$OPAMP_PORT \
  NODE_ENV=production \
  npx ts-node --transpile-only -r tsconfig-paths/register -r dotenv-expand/config -r '@hyperdx/node-opentelemetry/build/src/tracing' ./src/index.ts
fi

