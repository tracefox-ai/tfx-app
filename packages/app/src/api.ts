import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type {
  Alert,
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import { Dashboard } from './dashboard';
import type { AlertsPageItem } from './types';

type ServicesResponse = {
  data: Record<
    string,
    Array<{
      'deployment.environment'?: string;
      'k8s.namespace.name'?: string;
      'k8s.pod.name'?: string;
      'k8s.pod.uid'?: string;
    }>
  >;
};

type AlertsResponse = {
  data: AlertsPageItem[];
};

type ApiAlertInput = Alert;

export function loginHook(request: Request, options: any, response: Response) {
  // marketing pages
  const WHITELIST_PATHS = [
    '/',
    '/forgot',
    '/join-team',
    '/login',
    // '/register',
    '/signup',
    '/reset-password',
  ];
  if (!WHITELIST_PATHS.includes(Router.pathname) && response.status === 401) {
    try {
      window.sessionStorage.setItem('hdx-login-redirect-url', Router.asPath);
    } catch (e: any) {
      console.error(e);
    }
    Router.push('/login');
  }
}

export const server = ky.create({
  prefixUrl: '/api',
  credentials: 'include',
  hooks: {
    afterResponse: [loginHook],
  },
  timeout: false,
});

export const hdxServer = (
  url: string,
  options?: Options | undefined,
): ResponsePromise => {
  return server(url, {
    ...options,
  });
};

const api = {
  useCreateAlert() {
    return useMutation<any, Error, ApiAlertInput>({
      mutationFn: async alert =>
        server('alerts', {
          method: 'POST',
          json: alert,
        }).json(),
    });
  },
  useUpdateAlert() {
    return useMutation<any, Error, { id: string } & ApiAlertInput>({
      mutationFn: async alert =>
        server(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
    });
  },
  useDeleteAlert() {
    return useMutation<any, Error, string>({
      mutationFn: async (alertId: string) =>
        server(`alerts/${alertId}`, {
          method: 'DELETE',
        }),
    });
  },
  useSilenceAlert() {
    return useMutation<any, Error, { alertId: string; mutedUntil: string }>({
      mutationFn: async ({ alertId, mutedUntil }) =>
        server(`alerts/${alertId}/silenced`, {
          method: 'POST',
          json: { mutedUntil },
        }),
    });
  },
  useUnsilenceAlert() {
    return useMutation<any, Error, string>({
      mutationFn: async (alertId: string) =>
        server(`alerts/${alertId}/silenced`, {
          method: 'DELETE',
        }),
    });
  },
  useDashboards(options?: UseQueryOptions<Dashboard[] | null, Error>) {
    return useQuery({
      queryKey: [`dashboards`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`dashboards`, { method: 'GET' }).json<Dashboard[]>();
      },
      ...options,
    });
  },
  useCreateDashboard() {
    return useMutation({
      mutationFn: async ({
        name,
        charts,
        query,
        tags,
      }: {
        name: string;
        charts: any;
        query: any;
        tags: any;
      }) =>
        hdxServer(`dashboards`, {
          method: 'POST',
          json: { name, charts, query, tags },
        }).json(),
    });
  },
  useUpdateDashboard() {
    return useMutation({
      mutationFn: async ({
        id,
        name,
        charts,
        query,
        tags,
      }: {
        id: string;
        name: string;
        charts: any;
        query: any;
        tags: any;
      }) =>
        hdxServer(`dashboards/${id}`, {
          method: 'PUT',
          json: { name, charts, query, tags },
        }).json(),
    });
  },
  useDeleteDashboard() {
    return useMutation({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`dashboards/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  usePresetDashboardFilters(
    presetDashboard: PresetDashboard,
    sourceId: string,
  ) {
    return useQuery({
      queryKey: [`dashboards`, `preset`, presetDashboard, `filters`, sourceId],
      queryFn: () =>
        hdxServer(`dashboards/preset/${presetDashboard}/filters/`, {
          method: 'GET',
          searchParams: { sourceId },
        }).json() as Promise<PresetDashboardFilter[]>,
      enabled: !!sourceId,
    });
  },
  useCreatePresetDashboardFilter() {
    return useMutation({
      mutationFn: async (filter: PresetDashboardFilter) =>
        hdxServer(`dashboards/preset/${filter.presetDashboard}/filter`, {
          method: 'POST',
          json: { filter },
        }).json(),
    });
  },
  useUpdatePresetDashboardFilter() {
    return useMutation({
      mutationFn: async (filter: PresetDashboardFilter) =>
        hdxServer(`dashboards/preset/${filter.presetDashboard}/filter`, {
          method: 'PUT',
          json: { filter },
        }).json(),
    });
  },
  useDeletePresetDashboardFilter() {
    return useMutation({
      mutationFn: async ({
        id,
        presetDashboard,
      }: {
        id: string;
        presetDashboard: PresetDashboard;
      }) =>
        hdxServer(`dashboards/preset/${presetDashboard}/filter/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useAlerts() {
    return useQuery({
      queryKey: [`alerts`],
      queryFn: () => hdxServer(`alerts`).json() as Promise<AlertsResponse>,
    });
  },
  useServices() {
    return useQuery({
      queryKey: [`services`],
      queryFn: () =>
        hdxServer(`chart/services`, {
          method: 'GET',
        }).json() as Promise<ServicesResponse>,
    });
  },
  useDeleteTeamMember() {
    return useMutation<any, Error | HTTPError, { userId: string }>({
      mutationFn: async ({ userId }: { userId: string }) =>
        hdxServer(`team/member/${userId}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useTeamInvitations() {
    return useQuery<any>({
      queryKey: [`team/invitations`],
      queryFn: () => hdxServer(`team/invitations`).json(),
    });
  },
  useSaveTeamInvitation() {
    return useMutation<
      any,
      Error | HTTPError,
      { name?: string; email: string }
    >({
      mutationFn: async ({ name, email }: { name?: string; email: string }) =>
        hdxServer(`team/invitation`, {
          method: 'POST',
          json: {
            name,
            email,
          },
        }).json(),
    });
  },
  useDeleteTeamInvitation() {
    return useMutation({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`team/invitation/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useInstallation() {
    return useQuery<any, Error>({
      queryKey: [`installation`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return;
        }
        return hdxServer(`installation`).json();
      },
    });
  },
  useMe() {
    return useQuery<any>({
      queryKey: [`me`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`me`).json();
      },
    });
  },
  useTeam() {
    return useQuery<any, Error>({
      queryKey: [`team`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`team`).json();
      },
      retry: 1,
    });
  },
  useTeamMembers() {
    return useQuery<any>({
      queryKey: [`team/members`],
      queryFn: () => hdxServer(`team/members`).json(),
    });
  },
  useSetTeamName() {
    return useMutation<any, HTTPError, { name: string }>({
      mutationFn: async ({ name }) =>
        hdxServer(`team/name`, {
          method: 'PATCH',
          json: { name },
        }).json(),
    });
  },
  useUpdateClickhouseSettings() {
    return useMutation<
      any,
      HTTPError,
      {
        searchRowLimit?: number;
        fieldMetadataDisabled?: boolean;
        metadataMaxRowsToRead?: number;
      }
    >({
      mutationFn: async settings =>
        hdxServer(`team/clickhouse-settings`, {
          method: 'PATCH',
          json: settings,
        }).json(),
    });
  },
  useTags() {
    return useQuery({
      queryKey: [`team/tags`],
      queryFn: () => hdxServer(`team/tags`).json<{ data: string[] }>(),
    });
  },
  useSaveWebhook() {
    return useMutation<
      any,
      Error | HTTPError,
      {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }
    >({
      mutationFn: async ({
        service,
        url,
        name,
        description,
        queryParams,
        headers,
        body,
      }: {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }) =>
        hdxServer(`webhooks`, {
          method: 'POST',
          json: {
            name,
            service,
            url,
            description,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
        }).json(),
    });
  },
  useUpdateWebhook() {
    return useMutation<
      any,
      Error | HTTPError,
      {
        id: string;
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }
    >({
      mutationFn: async ({
        id,
        service,
        url,
        name,
        description,
        queryParams,
        headers,
        body,
      }: {
        id: string;
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'PUT',
          json: {
            name,
            service,
            url,
            description,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
        }).json(),
    });
  },
  useWebhooks(services: string[]) {
    return useQuery<any, Error>({
      queryKey: [...services],
      queryFn: () =>
        hdxServer('webhooks', {
          method: 'GET',
          searchParams: [...services.map(service => ['service', service])],
        }).json(),
    });
  },
  useDeleteWebhook() {
    return useMutation<any, Error | HTTPError, { id: string }>({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useTestWebhook() {
    return useMutation<
      any,
      Error | HTTPError,
      {
        service: string;
        url: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }
    >({
      mutationFn: async ({
        service,
        url,
        queryParams,
        headers,
        body,
      }: {
        service: string;
        url: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }) =>
        hdxServer(`webhooks/test`, {
          method: 'POST',
          json: {
            service,
            url,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
        }).json(),
    });
  },
  useRegisterPassword() {
    return useMutation({
      // @ts-ignore
      mutationFn: async ({ email, password, confirmPassword, teamName }) =>
        hdxServer(`register/password`, {
          method: 'POST',
          json: {
            teamName,
            email,
            password,
            confirmPassword,
          },
        }).json(),
    });
  },
  useTestConnection() {
    return useMutation({
      mutationFn: async ({
        host,
        username,
        password,
      }: {
        host: string;
        username: string;
        password: string;
      }) =>
        hdxServer(`clickhouse-proxy/test`, {
          method: 'POST',
          json: {
            host,
            username,
            password,
          },
        }).json() as Promise<{ success: boolean; error?: string }>,
    });
  },
  useIngestionTokens() {
    return useQuery<{
      data: Array<{
        id: string;
        tokenPrefix: string;
        status: 'active' | 'revoked';
        description?: string;
        assignedShard?: string;
        createdAt: string;
        lastUsedAt?: string;
        revokedAt?: string;
      }>;
    }>({
      queryKey: ['ingestion-tokens'],
      queryFn: () => hdxServer('ingestion-tokens').json(),
      retry: false,
    });
  },
  useCreateIngestionToken() {
    return useMutation({
      mutationFn: async (params?: { description?: string }) =>
        hdxServer('ingestion-tokens', {
          method: 'POST',
          json: params ?? {},
        }).json<{
          token: string;
          tokenRecord: {
            id: string;
            tokenPrefix: string;
            status: string;
            createdAt: string;
          };
        }>(),
    });
  },
  useRotateIngestionToken() {
    return useMutation({
      mutationFn: async (id: string) =>
        hdxServer(`ingestion-tokens/${id}/rotate`, {
          method: 'POST',
        }).json<{
          token: string;
          tokenRecord: {
            id: string;
            tokenPrefix: string;
            status: string;
            createdAt: string;
          };
        }>(),
    });
  },
  useRevokeIngestionToken() {
    return useMutation({
      mutationFn: async (id: string) =>
        hdxServer(`ingestion-tokens/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useTeams() {
    return useQuery<{
      activeTeamId: string | null;
      data: Array<{
        id: string;
        name: string;
        role: string;
        status: string;
      }>;
    }>({
      queryKey: ['teams'],
      queryFn: () => hdxServer('teams').json(),
      retry: false,
    });
  },
  useSwitchTeam() {
    return useMutation({
      mutationFn: async (teamId: string) =>
        hdxServer('teams/switch', {
          method: 'POST',
          json: { teamId },
        }).json<{ activeTeamId: string }>(),
    });
  },
  useCreateTeam() {
    return useMutation({
      mutationFn: async (name: string) =>
        hdxServer('teams', {
          method: 'POST',
          json: { name },
        }).json<{ team: any; activeTeamId: string }>(),
    });
  },
  useIncidents(filters?: { status?: string; severity?: string }) {
    return useQuery({
      queryKey: ['incidents', filters?.status, filters?.severity],
      queryFn: () => {
        const searchParams = new URLSearchParams();
        if (filters?.status) searchParams.set('status', filters.status);
        if (filters?.severity) searchParams.set('severity', filters.severity);
        return hdxServer(`incidents?${searchParams.toString()}`).json<{
          data: any[];
        }>();
      },
    });
  },
  useIncident(id: string) {
    return useQuery({
      queryKey: ['incidents', id],
      queryFn: () =>
        hdxServer(`incidents/${id}`).json<{ data: any }>(),
      enabled: !!id,
    });
  },
  useCreateIncident() {
    return useMutation({
      mutationFn: async (incident: {
        title: string;
        description?: string;
        severity: string;
        status?: string;
        ownerId?: string;
        alertIds?: string[];
      }) =>
        hdxServer('incidents', {
          method: 'POST',
          json: incident,
        }).json<{ data: any }>(),
    });
  },
  useUpdateIncident() {
    return useMutation({
      mutationFn: async ({
        id,
        ...updates
      }: {
        id: string;
        title?: string;
        description?: string;
        severity?: string;
        status?: string;
        ownerId?: string;
        alertIds?: string[];
      }) =>
        hdxServer(`incidents/${id}`, {
          method: 'PATCH',
          json: updates,
        }).json<{ data: any }>(),
    });
  },
  useAddTimelineEvent() {
    return useMutation({
      mutationFn: async ({
        id,
        type,
        message,
        metadata,
      }: {
        id: string;
        type: string;
        message: string;
        metadata?: Record<string, any>;
      }) =>
        hdxServer(`incidents/${id}/timeline`, {
          method: 'POST',
          json: { type, message, metadata },
        }).json<{ data: any }>(),
    });
  },
  useAnalyzeIncident() {
    return useMutation({
      mutationFn: async (id: string) =>
        hdxServer(`incidents/${id}/analyze`, {
          method: 'POST',
        }).json<{ data: any }>(),
    });
  },
  useDownloadIncidentReport() {
    return useMutation({
      mutationFn: async (id: string) => {
        const response = await hdxServer(`incidents/${id}/report`, {
          method: 'GET',
        });
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const contentDisposition = response.headers.get('content-disposition');
        const filename =
          contentDisposition?.split('filename=')[1]?.replace(/"/g, '') ||
          `incident-report-${id}.md`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      },
    });
  },
  useDataIngestionMetrics(startDate?: string, endDate?: string) {
    return useQuery<{
      data: Array<{
        date: string;
        totalBytes: number;
        totalRows: number;
        breakdown: {
          logs: { bytes: number; rows: number };
          traces: { bytes: number; rows: number };
          metrics: { bytes: number; rows: number };
          sessions: { bytes: number; rows: number };
        };
      }>;
      hourly: any[];
    }>({
      queryKey: ['dataIngestionMetrics', startDate, endDate],
      queryFn: async () => {
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        return hdxServer(`team/data-ingestion-metrics?${params.toString()}`).json();
      },
      retry: false,
    });
  },
  useDataIngestionMetricsRealtime(timeRangeHours: number = 1) {
    return useQuery<{
      data: Array<{
        serviceName: string;
        totalBytes: number;
        totalRows: number;
        estimatedBytesPerHour: number;
        estimatedRowsPerHour: number;
        breakdown: {
          logs: { bytes: number; rows: number };
          traces: { bytes: number; rows: number };
          metrics: { bytes: number; rows: number };
          sessions: { bytes: number; rows: number };
        };
      }>;
      timeRangeHours: number;
      timestamp: string;
    }>({
      queryKey: ['dataIngestionMetricsRealtime', timeRangeHours],
      queryFn: async () => {
        const params = new URLSearchParams();
        params.append('timeRangeHours', timeRangeHours.toString());
        return hdxServer(
          `team/data-ingestion-metrics-realtime?${params.toString()}`,
        ).json();
      },
      retry: false,
      refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
    });
  },
};
export default api;
