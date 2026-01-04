import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { serializeError } from 'serialize-error';
import { z } from 'zod';

import * as config from '@/config';
import {
  InsightCategory,
  InsightSeverity,
  IRelatedQuery,
  ITelemetryInsight,
} from '@/models/telemetryInsight';
import logger from '@/utils/logger';
import {
  BestPracticesAnalysisResult,
} from './analyzers/bestPracticesAnalyzer';
import {
  ObservabilityAnalysisResult,
} from './analyzers/observabilityAnalyzer';
import {
  ReliabilityAnalysisResult,
} from './analyzers/reliabilityAnalyzer';

const InsightSuggestionSchema = z.object({
  title: z.string().describe('Short, actionable title for the insight'),
  description: z
    .string()
    .describe(
      'Detailed description explaining the issue and why it matters',
    ),
  suggestions: z
    .array(z.string())
    .describe('Array of actionable suggestions to address the issue'),
  severity: z
    .enum(['low', 'medium', 'high'])
    .describe('Severity level of the insight'),
  relatedQueries: z
    .array(
      z.object({
        type: z.enum(['search', 'chart', 'dashboard']),
        label: z.string(),
        query: z.string().optional(),
        sourceId: z.string().optional(),
        dashboardId: z.string().optional(),
        tileId: z.string().optional(),
      }),
    )
    .optional()
    .describe('Related queries or dashboards to investigate the issue'),
});

const InsightsResponseSchema = z.object({
  insights: z.array(InsightSuggestionSchema),
});

/**
 * Generates AI-powered insights from telemetry analysis results
 */
export async function generateInsights(
  reliability: ReliabilityAnalysisResult,
  observability: ObservabilityAnalysisResult,
  bestPractices: BestPracticesAnalysisResult,
  teamName: string,
  timeRange: { start: Date; end: Date },
): Promise<Omit<ITelemetryInsight, 'team' | 'generatedAt' | 'status'>[]> {
  if (!config.ANTHROPIC_API_KEY) {
    logger.error('No ANTHROPIC_API_KEY defined for AI insights');
    throw new Error('AI insights require ANTHROPIC_API_KEY to be configured');
  }

  const anthropic = createAnthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const model = anthropic('claude-sonnet-4-5-20250929');

  // Format analysis data for the prompt
  const reliabilitySummary = `
Reliability Analysis:
- Total services: ${reliability.summary.totalServices}
- Services with high error rate (>5%): ${reliability.summary.servicesWithHighErrorRate}
- Services with error spikes: ${reliability.summary.servicesWithSpikes}
- Top services by error rate:
${reliability.patterns
  .slice(0, 10)
  .map(
    p =>
      `  - ${p.serviceName}: ${p.errorRate.toFixed(2)}% error rate (${p.errorCount}/${p.totalCount}), trend: ${p.errorRateTrend}`,
  )
  .join('\n')}
`;

  const observabilitySummary = `
Observability Analysis:
- Total services: ${observability.summary.totalServices}
- Services with missing traces: ${observability.summary.servicesWithMissingTraces}
- Services with low log coverage (<50%): ${observability.summary.servicesWithLowLogCoverage}
- Services with incomplete traces: ${observability.summary.servicesWithIncompleteTraces}
- Services with observability gaps:
${observability.patterns
  .filter(p => !p.hasTraces || p.traceCoverage < 50 || p.logCoverage < 50)
  .slice(0, 10)
  .map(
    p =>
      `  - ${p.serviceName}: logs=${p.hasLogs}, traces=${p.hasTraces}, traceCoverage=${p.traceCoverage.toFixed(1)}%, logCoverage=${p.logCoverage.toFixed(1)}%`,
  )
  .join('\n')}
`;

  const bestPracticesSummary = `
Best Practices Analysis:
- Total services: ${bestPractices.summary.totalServices}
- Services with inconsistent logging: ${bestPractices.summary.servicesWithInconsistentLogging}
- Services with missing structured logs: ${bestPractices.summary.servicesWithMissingStructuredLogs}
- Services with non-standard metrics: ${bestPractices.summary.servicesWithNonStandardMetrics}
- Services needing improvement:
${bestPractices.patterns
  .filter(
    p =>
      p.inconsistentLogLevels ||
      p.missingStructuredLogging ||
      p.nonStandardMetricNames > 0,
  )
  .slice(0, 10)
  .map(p => {
    const issues: string[] = [];
    if (p.inconsistentLogLevels) issues.push('inconsistent log levels');
    if (p.missingStructuredLogging) issues.push('missing structured logs');
    if (p.nonStandardMetricNames > 0)
      issues.push(`${p.nonStandardMetricNames} non-standard metrics`);
    return `  - ${p.serviceName}: ${issues.join(', ')}`;
  })
  .join('\n')}
`;

  const prompt = `You are an SRE observability expert analyzing telemetry data for a team called "${teamName}".

You have analyzed their telemetry data from ${timeRange.start.toISOString()} to ${timeRange.end.toISOString()} and found the following patterns:

${reliabilitySummary}

${observabilitySummary}

${bestPracticesSummary}

Based on this analysis, generate actionable insights that will help improve:
1. **Reliability**: Error rates, failure patterns, alert coverage
2. **Observability**: Missing traces, incomplete instrumentation, log coverage
3. **Best Practices**: Logging consistency, structured logging, metric naming

For each insight, provide:
- A clear, actionable title
- A detailed description explaining the issue and its impact
- Specific, actionable suggestions (3-5 items)
- Appropriate severity (low, medium, high)
- Related queries that would help investigate the issue (optional)

Focus on insights that:
- Are actionable and specific
- Have clear business/operational impact
- Can be investigated with queries or dashboards
- Are prioritized by severity

Generate insights for the most critical issues first. Limit to 10-15 total insights across all categories.`;

  try {
    logger.debug('Generating AI insights from analysis results');

    const insights: Omit<
      ITelemetryInsight,
      'team' | 'generatedAt' | 'status'
    >[] = [];

    // Try to generate AI insights first (with timeout)
    let aiInsights: any[] = [];
    try {
      logger.debug('Calling AI model for insights');
      const result = await Promise.race([
        generateObject({
          model,
          schema: InsightsResponseSchema,
          prompt,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI call timeout after 30s')), 30000),
        ),
      ]) as any;
      
      if (result?.object?.insights && result.object.insights.length > 0) {
        aiInsights = result.object.insights;
        logger.debug(
          {
            aiInsightCount: aiInsights.length,
          },
          'AI model returned insights',
        );
      } else {
        logger.debug('AI model returned no insights');
      }
    } catch (aiError: any) {
      logger.warn(
        {
          err: serializeError(aiError),
          teamName,
        },
        'AI insight generation failed or timed out, will use hardcoded insights only',
      );
    }

    // Add AI-generated insights first (if any)
    for (const aiInsight of aiInsights) {
      // Determine category from the insight content
      let category = InsightCategory.RELIABILITY;
      if (
        aiInsight.title.toLowerCase().includes('trace') ||
        aiInsight.title.toLowerCase().includes('observability') ||
        aiInsight.title.toLowerCase().includes('instrumentation')
      ) {
        category = InsightCategory.OBSERVABILITY;
      } else if (
        aiInsight.title.toLowerCase().includes('log') ||
        aiInsight.title.toLowerCase().includes('metric') ||
        aiInsight.title.toLowerCase().includes('practice')
      ) {
        category = InsightCategory.BEST_PRACTICES;
      }

      insights.push({
        serviceName: undefined, // Team-wide insight
        category,
        severity: aiInsight.severity === 'low' ? InsightSeverity.LOW : aiInsight.severity === 'medium' ? InsightSeverity.MEDIUM : InsightSeverity.HIGH,
        title: aiInsight.title,
        description: aiInsight.description,
        suggestions: aiInsight.suggestions,
        relatedQueries: (aiInsight.relatedQueries || []) as IRelatedQuery[],
        metadata: {},
        analysisTimeRange: timeRange,
      });
    }

    logger.debug(
      {
        aiInsightsAdded: aiInsights.length,
      },
      'AI insights added to results',
    );

    // Map reliability patterns to insights
    const highErrorRateServices = reliability.patterns.filter(
      p => p.errorRate > 5,
    );
    if (highErrorRateServices.length > 0) {
      const topService = highErrorRateServices[0];
      insights.push({
        serviceName: topService.serviceName,
        category: InsightCategory.RELIABILITY,
        severity: topService.errorRate > 10 ? InsightSeverity.HIGH : InsightSeverity.MEDIUM,
        title: `High error rate detected in ${topService.serviceName}`,
        description: `${topService.serviceName} has an error rate of ${topService.errorRate.toFixed(2)}% (${topService.errorCount} errors out of ${topService.totalCount} total requests). This indicates potential reliability issues.`,
        suggestions: [
          `Investigate the error patterns in ${topService.serviceName} logs`,
          `Set up alerts for error rate thresholds`,
          `Review recent deployments or changes that might have introduced errors`,
          `Check for correlated errors in dependent services`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View errors in ${topService.serviceName}`,
            query: `ServiceName="${topService.serviceName}" AND (SeverityText="error" OR SeverityText="ERROR")`,
          },
        ],
        metadata: {
          errorRate: topService.errorRate,
          errorCount: topService.errorCount,
          totalCount: topService.totalCount,
          trend: topService.errorRateTrend,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Map observability patterns to insights
    const missingTraceServices = observability.patterns.filter(
      p => p.hasLogs && !p.hasTraces,
    );
    if (missingTraceServices.length > 0) {
      const service = missingTraceServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.OBSERVABILITY,
        severity: InsightSeverity.MEDIUM,
        title: `Missing trace data for ${service.serviceName}`,
        description: `${service.serviceName} has log data but no trace data. This makes it difficult to understand request flows and debug distributed systems issues.`,
        suggestions: [
          `Enable OpenTelemetry tracing for ${service.serviceName}`,
          `Ensure trace context is propagated across service boundaries`,
          `Verify trace export configuration`,
          `Check if trace sampling is too aggressive`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View logs for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          hasLogs: service.hasLogs,
          hasTraces: service.hasTraces,
          traceCoverage: service.traceCoverage,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Map best practices patterns to insights
    const inconsistentLoggingServices = bestPractices.patterns.filter(
      p => p.inconsistentLogLevels,
    );
    if (inconsistentLoggingServices.length > 0) {
      const service = inconsistentLoggingServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.BEST_PRACTICES,
        severity: InsightSeverity.LOW,
        title: `Inconsistent log level usage in ${service.serviceName}`,
        description: `${service.serviceName} uses inconsistent log level formats (mixed case, different standards), making it harder to filter and analyze logs effectively.`,
        suggestions: [
          `Standardize log levels to use consistent casing (e.g., all lowercase)`,
          `Use OpenTelemetry severity levels consistently`,
          `Review logging configuration and ensure all loggers use the same standard`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View log levels for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          logLevelDistribution: service.logLevelDistribution,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Add insights for services with missing structured logs
    const missingStructuredLogServices = bestPractices.patterns.filter(
      p => p.missingStructuredLogging,
    );
    if (missingStructuredLogServices.length > 0) {
      const service = missingStructuredLogServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.BEST_PRACTICES,
        severity: InsightSeverity.MEDIUM,
        title: `Missing structured logging in ${service.serviceName}`,
        description: `${service.serviceName} has logs but less than 50% have structured attributes. Structured logging makes it easier to query and analyze logs effectively.`,
        suggestions: [
          `Add structured attributes to logs in ${service.serviceName}`,
          `Use OpenTelemetry log attributes for key-value pairs`,
          `Ensure important context (user IDs, request IDs, etc.) is included as attributes`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View logs for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          missingStructuredLogging: true,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Add insights for services with non-standard metrics
    const nonStandardMetricServices = bestPractices.patterns.filter(
      p => p.nonStandardMetricNames > 0,
    );
    if (nonStandardMetricServices.length > 0) {
      const service = nonStandardMetricServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.BEST_PRACTICES,
        severity: InsightSeverity.LOW,
        title: `Non-standard metric naming in ${service.serviceName}`,
        description: `${service.serviceName} has ${service.nonStandardMetricNames} metrics that don't follow standard naming conventions (http_*, rpc_*, db_*, etc.). Standard naming makes metrics easier to discover and understand.`,
        suggestions: [
          `Review metric names in ${service.serviceName} and align with OpenTelemetry conventions`,
          `Use prefixes like http_, rpc_, db_ for standard metric types`,
          `Document custom metrics and their purpose`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View metrics for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          nonStandardMetricNames: service.nonStandardMetricNames,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Add insights for services with low log coverage
    const lowLogCoverageServices = observability.patterns.filter(
      p => p.logCoverage < 50 && p.hasLogs,
    );
    if (lowLogCoverageServices.length > 0) {
      const service = lowLogCoverageServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.OBSERVABILITY,
        severity: InsightSeverity.MEDIUM,
        title: `Low log coverage in ${service.serviceName}`,
        description: `${service.serviceName} has logs for only ${service.logCoverage.toFixed(1)}% of the time period analyzed. This suggests inconsistent logging or potential gaps in observability.`,
        suggestions: [
          `Ensure ${service.serviceName} logs consistently across all code paths`,
          `Check for log sampling that might be too aggressive`,
          `Verify logging configuration is correct`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View logs for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          logCoverage: service.logCoverage,
        },
        analysisTimeRange: timeRange,
      });
    }

    // Add insights for services with incomplete traces
    const incompleteTraceServices = observability.patterns.filter(
      p => p.incompleteTraces > 0,
    );
    if (incompleteTraceServices.length > 0) {
      const service = incompleteTraceServices[0];
      insights.push({
        serviceName: service.serviceName,
        category: InsightCategory.OBSERVABILITY,
        severity: InsightSeverity.MEDIUM,
        title: `Incomplete trace data in ${service.serviceName}`,
        description: `${service.serviceName} has ${service.incompleteTraces} traces that appear to be missing parent/child relationships. This makes it difficult to understand the full request flow.`,
        suggestions: [
          `Ensure trace context is properly propagated in ${service.serviceName}`,
          `Check for missing parent span IDs in trace exports`,
          `Verify trace sampling and export configuration`,
        ],
        relatedQueries: [
          {
            type: 'search',
            label: `View traces for ${service.serviceName}`,
            query: `ServiceName="${service.serviceName}"`,
          },
        ],
        metadata: {
          incompleteTraces: service.incompleteTraces,
        },
        analysisTimeRange: timeRange,
      });
    }

    logger.debug(
      {
        hardcodedInsightsCount: insights.length - aiInsights.length,
        totalInsightsCount: insights.length,
        hardcodedInsightTitles: insights.slice(aiInsights.length).map(i => i.title),
      },
      'Hardcoded insights generated',
    );

    logger.info(
      {
        insightCount: insights.length,
        categories: {
          reliability: insights.filter(i => i.category === InsightCategory.RELIABILITY).length,
          observability: insights.filter(i => i.category === InsightCategory.OBSERVABILITY).length,
          bestPractices: insights.filter(i => i.category === InsightCategory.BEST_PRACTICES).length,
        },
      },
      'Generated AI insights',
    );

    return insights;
  } catch (error: any) {
    logger.error(
      {
        err: error,
        teamName,
      },
      'Failed to generate AI insights',
    );
    throw new Error(
      `Failed to generate insights: ${error?.message || String(error)}`,
    );
  }
}

