import type { UseQueryOptions } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';

import { server } from './api';

export interface TelemetryInsight {
  _id: string;
  team: string;
  serviceName?: string;
  category: 'reliability' | 'observability' | 'best_practices';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  suggestions: string[];
  relatedQueries: Array<{
    type: 'search' | 'chart' | 'dashboard';
    label: string;
    query?: string;
    sourceId?: string;
    dashboardId?: string;
    tileId?: string;
  }>;
  metadata: Record<string, any>;
  status: 'active' | 'dismissed' | 'resolved';
  dismissedAt?: string;
  dismissedBy?: {
    _id: string;
    email: string;
    name?: string;
  };
  generatedAt: string;
  analysisTimeRange: {
    start: string;
    end: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface TelemetryInsightsResponse {
  data: TelemetryInsight[];
  total: number;
  limit: number;
  offset: number;
}

export interface TelemetryInsightFilters {
  status?: 'active' | 'dismissed' | 'resolved';
  category?: 'reliability' | 'observability' | 'best_practices';
  serviceName?: string;
  limit?: number;
  offset?: number;
}

export function useTelemetryInsights(
  filters?: TelemetryInsightFilters,
  options?: Omit<
    UseQueryOptions<TelemetryInsightsResponse, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<TelemetryInsightsResponse, Error>({
    queryKey: ['telemetry-insights', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.category) params.append('category', filters.category);
      if (filters?.serviceName) params.append('serviceName', filters.serviceName);
      if (filters?.limit) params.append('limit', filters.limit.toString());
      if (filters?.offset) params.append('offset', filters.offset.toString());

      const url = `telemetry-insights${params.toString() ? `?${params.toString()}` : ''}`;
      return server(url).json<TelemetryInsightsResponse>();
    },
    ...options,
  });
}

export function useTelemetryInsight(id: string) {
  return useQuery<{ data: TelemetryInsight }, Error>({
    queryKey: ['telemetry-insight', id],
    queryFn: async () => {
      return server(`telemetry-insights/${id}`).json<{ data: TelemetryInsight }>();
    },
    enabled: !!id,
  });
}

export function useDismissInsight() {
  return useMutation<{ data: TelemetryInsight }, Error, string>({
    mutationFn: async (insightId: string) => {
      return server(`telemetry-insights/${insightId}/dismiss`, {
        method: 'POST',
      }).json<{ data: TelemetryInsight }>();
    },
  });
}

export function useAcknowledgeInsight() {
  return useMutation<{ data: TelemetryInsight }, Error, string>({
    mutationFn: async (insightId: string) => {
      return server(`telemetry-insights/${insightId}/acknowledge`, {
        method: 'POST',
      }).json<{ data: TelemetryInsight }>();
    },
  });
}

export function useTriggerAnalysis() {
  return useMutation<
    { message: string; serviceName?: string; timeRangeHours: number },
    Error,
    { serviceName?: string; timeRangeHours?: number }
  >({
    mutationFn: async (params: { serviceName?: string; timeRangeHours?: number }) => {
      return server('telemetry-insights/analyze', {
        method: 'POST',
        json: params,
      }).json<{ message: string; serviceName?: string; timeRangeHours: number }>();
    },
  });
}

