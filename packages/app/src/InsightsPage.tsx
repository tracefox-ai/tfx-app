import * as React from 'react';
import {
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFilter, IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import InsightCard from '@/components/InsightCard';
import { PageHeader } from '@/components/PageHeader';
import { withAppNav } from '@/layout';
import {
  TelemetryInsightFilters,
  useTelemetryInsights,
  useTriggerAnalysis,
} from '@/telemetryInsights';

export default function InsightsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<
    'active' | 'dismissed' | 'resolved' | undefined
  >('active');
  const [categoryFilter, setCategoryFilter] = React.useState<
    'reliability' | 'observability' | 'best_practices' | undefined
  >();
  const [serviceFilter, setServiceFilter] = React.useState<string>('');
  const [debouncedServiceFilter] = useDebouncedValue(serviceFilter, 300);
  const [page, setPage] = React.useState(0);
  const pageSize = 20;

  const filters: TelemetryInsightFilters = React.useMemo(
    () => ({
      status: statusFilter,
      category: categoryFilter,
      serviceName: debouncedServiceFilter || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [statusFilter, categoryFilter, debouncedServiceFilter, page, pageSize],
  );

  const { data, isLoading, error, refetch } = useTelemetryInsights(filters);
  const triggerAnalysis = useTriggerAnalysis();

  const handleTriggerAnalysis = React.useCallback(() => {
    triggerAnalysis.mutate(
      {},
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['telemetry-insights'] });
        },
      },
    );
  }, [triggerAnalysis, queryClient]);

  const insights = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <ErrorBoundary>
      <Container fluid p="xl">
        <PageHeader>
          <Stack gap="xs">
            <Text size="xl" fw={600}>
              AI Telemetry Insights
            </Text>
            <Text size="sm" c="dimmed">
              AI-powered suggestions to improve reliability, observability, and
              best practices
            </Text>
          </Stack>
        </PageHeader>

        <Stack gap="md" mt="xl">
          <Group justify="space-between" align="flex-end">
            <Group gap="md" align="flex-end">
              <Select
                label="Status"
                placeholder="All statuses"
                data={[
                  { value: 'active', label: 'Active' },
                  { value: 'dismissed', label: 'Dismissed' },
                  { value: 'resolved', label: 'Resolved' },
                ]}
                value={statusFilter || ''}
                onChange={value =>
                  setStatusFilter(
                    value as 'active' | 'dismissed' | 'resolved' | undefined,
                  )
                }
                clearable
                leftSection={<IconFilter size={16} />}
                style={{ minWidth: 150 }}
              />
              <Select
                label="Category"
                placeholder="All categories"
                data={[
                  { value: 'reliability', label: 'Reliability' },
                  { value: 'observability', label: 'Observability' },
                  { value: 'best_practices', label: 'Best Practices' },
                ]}
                value={categoryFilter || ''}
                onChange={value =>
                  setCategoryFilter(
                    value as
                      | 'reliability'
                      | 'observability'
                      | 'best_practices'
                      | undefined,
                  )
                }
                clearable
                leftSection={<IconFilter size={16} />}
                style={{ minWidth: 150 }}
              />
              <TextInput
                label="Service"
                placeholder="Filter by service name"
                value={serviceFilter}
                onChange={e => setServiceFilter(e.target.value)}
                style={{ minWidth: 200 }}
              />
            </Group>
            <Group>
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={() => refetch()}
                loading={isLoading}
              >
                Refresh
              </Button>
              <Button
                variant="light"
                onClick={handleTriggerAnalysis}
                loading={triggerAnalysis.isPending}
              >
                Trigger Analysis
              </Button>
            </Group>
          </Group>

          {isLoading && (
            <Group justify="center" py="xl">
              <Loader size="lg" />
            </Group>
          )}

          {error && (
            <Box
              p="md"
              style={{ backgroundColor: 'var(--mantine-color-red-1)' }}
            >
              <Text c="red">Error loading insights: {error.message}</Text>
            </Box>
          )}

          {!isLoading && !error && insights.length === 0 && (
            <Box p="xl" style={{ textAlign: 'center' }}>
              <Text size="lg" c="dimmed" mb="md">
                No insights found
              </Text>
              <Text size="sm" c="dimmed">
                {statusFilter || categoryFilter || debouncedServiceFilter
                  ? 'Try adjusting your filters'
                  : 'Insights will appear here after the daily analysis runs'}
              </Text>
            </Box>
          )}

          {!isLoading && !error && insights.length > 0 && (
            <>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Showing {insights.length} of {total} insights
                </Text>
                <Group gap="xs">
                  <Button
                    variant="subtle"
                    size="xs"
                    disabled={page === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Text size="sm" c="dimmed">
                    Page {page + 1} of {totalPages}
                  </Text>
                  <Button
                    variant="subtle"
                    size="xs"
                    disabled={page >= totalPages - 1}
                    onClick={() =>
                      setPage(p => Math.min(totalPages - 1, p + 1))
                    }
                  >
                    Next
                  </Button>
                </Group>
              </Group>

              <Stack gap="md">
                {insights.map(insight => (
                  <InsightCard key={insight._id} insight={insight} />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </Container>
    </ErrorBoundary>
  );
}

InsightsPage.getLayout = withAppNav;
