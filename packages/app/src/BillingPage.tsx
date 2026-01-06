import { useState, useMemo } from 'react';
import Head from 'next/head';
import {
  Box,
  Button,
  Card,
  Center,
  Container,
  Divider,
  Group,
  InputLabel,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Table,
  Badge,
  Tabs,
  Grid,
  Select,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCurrencyDollar,
  IconDownload,
  IconTrendingUp,
  IconHelpCircle,
  IconChartBar,
} from '@tabler/icons-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import { IS_LOCAL_MODE } from '@/config';
import { PageHeader } from './components/PageHeader';
import api from './api';
import { withAppNav } from './layout';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  }
  return num.toString();
}

function DataIngestionMetricsRealtimeSection() {
  const [timeRangeHours, setTimeRangeHours] = useState(1);
  const { data: realtimeData, isLoading } =
    api.useDataIngestionMetricsRealtime(timeRangeHours);

  if (IS_LOCAL_MODE) {
    return null;
  }

  return (
    <Box id="data-ingestion-metrics-realtime">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconChartBar size={20} />
          <Text size="md">Real-Time Service Breakdown</Text>
        </Group>
        <Group gap="xs">
          <Select
            value={timeRangeHours.toString()}
            onChange={val => setTimeRangeHours(parseInt(val || '1', 10))}
            data={[
              { value: '1', label: 'Last 1 hour' },
              { value: '2', label: 'Last 2 hours' },
              { value: '6', label: 'Last 6 hours' },
              { value: '24', label: 'Last 24 hours' },
            ]}
            size="xs"
          />
          <Tooltip label="Real-time breakdown by service to help fine-tune your collector sampling policies. Use this to identify which services are ingesting the most data.">
            <IconHelpCircle size={16} style={{ cursor: 'help' }} />
          </Tooltip>
        </Group>
      </Group>
      <Divider my="md" />
      <Card variant="muted">
        {isLoading ? (
          <Center p="xl">
            <Loader color="dimmed" />
          </Center>
        ) : !realtimeData?.data || realtimeData.data.length === 0 ? (
          <Text c="dimmed" ta="center" p="xl">
            No service metrics available. Data will appear as services send
            telemetry.
          </Text>
        ) : (
          <Stack gap="md">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Service-level ingestion rates (estimated per hour)
              </Text>
              {realtimeData.timestamp && (
                <Text size="xs" c="dimmed">
                  Last updated:{' '}
                  {new Date(realtimeData.timestamp).toLocaleTimeString()}
                </Text>
              )}
            </Group>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Service</Table.Th>
                  <Table.Th>Est. Bytes/Hour</Table.Th>
                  <Table.Th>Est. Rows/Hour</Table.Th>
                  <Table.Th>Logs</Table.Th>
                  <Table.Th>Traces</Table.Th>
                  <Table.Th>Metrics</Table.Th>
                  <Table.Th>Sessions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {realtimeData.data.map(service => (
                  <Table.Tr key={service.serviceName}>
                    <Table.Td>
                      <Text fw={500}>{service.serviceName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color="blue">
                        {formatBytes(service.estimatedBytesPerHour)}/hr
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color="green">
                        {formatNumber(service.estimatedRowsPerHour)}/hr
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {service.breakdown.logs.rows > 0 ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">
                            {formatBytes(service.breakdown.logs.bytes)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatNumber(service.breakdown.logs.rows)} rows
                          </Text>
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {service.breakdown.traces.rows > 0 ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">
                            {formatBytes(service.breakdown.traces.bytes)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatNumber(service.breakdown.traces.rows)} rows
                          </Text>
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {service.breakdown.metrics.rows > 0 ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">
                            {formatBytes(service.breakdown.metrics.bytes)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatNumber(service.breakdown.metrics.rows)} rows
                          </Text>
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {service.breakdown.sessions.rows > 0 ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">
                            {formatBytes(service.breakdown.sessions.bytes)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatNumber(service.breakdown.sessions.rows)} rows
                          </Text>
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed" mt="sm">
              💡 Tip: Use this data to configure tail sampling policies in your
              OpenTelemetry collector. Services with high ingestion rates may
              benefit from sampling strategies (errors-only, slow traces, or
              probabilistic sampling).
            </Text>
          </Stack>
        )}
      </Card>
    </Box>
  );
}

export default function BillingPage() {
  const { data: currentData, isLoading: isLoadingCurrent } =
    api.useBillingCurrent();
  const { data: forecastData, isLoading: isLoadingForecast } =
    api.useBillingForecast();
  const [breakdownStartDate, setBreakdownStartDate] = useState<string>(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
  );
  const [breakdownEndDate, setBreakdownEndDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const { data: breakdownData, isLoading: isLoadingBreakdown } =
    api.useBillingBreakdown(breakdownStartDate, breakdownEndDate);
  const exportMutation = api.useBillingExport();

  if (IS_LOCAL_MODE) {
    return (
      <div className="BillingPage">
        <Head>
          <title>Billing & Usage</title>
        </Head>
        <PageHeader>
          <div>Billing & Usage</div>
        </PageHeader>
        <Container>
          <Center mt="xl">
            <Text c="dimmed">Billing is not available in local mode.</Text>
          </Center>
        </Container>
      </div>
    );
  }

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const getTopCostDriver = (costs: {
    logs: number;
    traces: number;
    metrics: number;
  }): string => {
    const max = Math.max(costs.logs, costs.traces, costs.metrics);
    if (max === costs.logs) return 'Logs';
    if (max === costs.traces) return 'Traces';
    return 'Metrics';
  };

  const calculateThisMonthTotal = (): number => {
    if (!breakdownData?.teams) return 0;
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    return breakdownData.teams.reduce((sum, team) => {
      return (
        sum +
        team.daily
          .filter(day => day.date && day.date >= firstDayOfMonth)
          .reduce((daySum, day) => daySum + day.costs.total, 0)
      );
    }, 0);
  };

  const calculateAverageDailyCost = (): number => {
    if (!breakdownData?.total) return 0;
    const days = breakdownData.teams?.[0]?.daily?.length || 1;
    return breakdownData.total.costs.total / days;
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate(
      {
        startDate: breakdownStartDate,
        endDate: breakdownEndDate,
        format,
      },
      {
        onSuccess: () => {
          notifications.show({
            title: 'Export started',
            message: `Billing data will be downloaded as ${format.toUpperCase()}`,
            color: 'green',
          });
        },
        onError: (error: any) => {
          notifications.show({
            title: 'Export failed',
            message: error?.message || 'Failed to export billing data',
            color: 'red',
          });
        },
      },
    );
  };

  // Filter teams if a team is selected
  const filteredTeams = selectedTeamId
    ? breakdownData?.teams?.filter(t => t.teamId === selectedTeamId) || []
    : breakdownData?.teams || [];

  const teamOptions =
    breakdownData?.teams?.map(t => ({
      value: t.teamId,
      label: t.teamName,
    })) || [];

  // Prepare chart data for historical trends
  const chartData = useMemo(() => {
    if (!filteredTeams || filteredTeams.length === 0) {
      return [];
    }

    const dailyMap = new Map<
      string,
      {
        date: string;
        logs: number;
        traces: number;
        metrics: number;
        total: number;
      }
    >();

    filteredTeams.forEach(team => {
      team.daily.forEach(day => {
        const date = day.date || '';
        if (!dailyMap.has(date)) {
          dailyMap.set(date, {
            date,
            logs: 0,
            traces: 0,
            metrics: 0,
            total: 0,
          });
        }
        const daily = dailyMap.get(date)!;
        daily.logs += day.costs.logs;
        daily.traces += day.costs.traces;
        daily.metrics += day.costs.metrics;
        daily.total += day.costs.total;
      });
    });

    return Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(item => ({
        ...item,
        dateLabel: item.date
          ? new Date(item.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : '',
      }));
  }, [filteredTeams]);

  return (
    <div className="BillingPage">
      <Head>
        <title>Billing & Usage</title>
      </Head>
      <PageHeader>
        <div>Billing & Usage</div>
      </PageHeader>
      <div>
        <Container>
          <Stack my={20} gap="xl">
            <Box id="billing">
              <Group justify="space-between" mb="md">
                <Group gap="xs">
                  <IconCurrencyDollar size={20} />
                  <Text size="md">Billing Overview</Text>
                </Group>
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconDownload size={14} />}
                    onClick={() => handleExport('csv')}
                    loading={exportMutation.isPending}
                  >
                    Export CSV
                  </Button>
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconDownload size={14} />}
                    onClick={() => handleExport('json')}
                    loading={exportMutation.isPending}
                  >
                    Export JSON
                  </Button>
                  <Tooltip label="View billing and usage for all teams you own">
                    <IconHelpCircle size={16} style={{ cursor: 'help' }} />
                  </Tooltip>
                </Group>
              </Group>
              <Divider my="md" />

              <Tabs defaultValue="dashboard">
                <Tabs.List>
                  <Tabs.Tab value="dashboard">Dashboard</Tabs.Tab>
                  <Tabs.Tab value="breakdown">Breakdown</Tabs.Tab>
                  <Tabs.Tab value="historical">Historical</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="dashboard" pt="md">
                  <Stack gap="md">
                    {/* Current Usage Card */}
                    <Card withBorder>
                      <Text size="lg" fw={500} mb="md">
                        Current Usage (Today)
                      </Text>
                      {isLoadingCurrent ? (
                        <Center p="xl">
                          <Loader color="dimmed" />
                        </Center>
                      ) : !currentData ? (
                        <Text c="dimmed" ta="center" p="xl">
                          No billing data available yet.
                        </Text>
                      ) : (
                        <Grid>
                          <Grid.Col span={{ base: 12, md: 6 }}>
                            <Stack gap="xs">
                              <Text size="sm" c="dimmed">
                                Total Cost Today (All Teams)
                              </Text>
                              <Text size="xl" fw={700}>
                                {formatCurrency(currentData.total.costs.total)}
                              </Text>
                            </Stack>
                          </Grid.Col>
                          <Grid.Col span={{ base: 12, md: 6 }}>
                            <Stack gap="xs">
                              <Text size="sm" c="dimmed">
                                Current Hourly Rate (All Teams)
                              </Text>
                              <Text size="lg" fw={500}>
                                {formatCurrency(
                                  currentData.total.currentHourlyCost,
                                )}
                                /hr
                              </Text>
                              <Text size="xs" c="dimmed">
                                Est. Daily:{' '}
                                {formatCurrency(
                                  currentData.total.estimatedDailyCost,
                                )}
                              </Text>
                            </Stack>
                          </Grid.Col>
                          <Grid.Col span={12}>
                            <Divider my="sm" />
                            <Text size="sm" fw={500} mb="xs">
                              Breakdown by Type (All Teams)
                            </Text>
                            <Grid>
                              <Grid.Col span={{ base: 12, md: 4 }}>
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Logs
                                  </Text>
                                  <Text size="sm" fw={500}>
                                    {formatCurrency(currentData.total.costs.logs)}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    Storage: {formatBytes(currentData.total.ingestion.logs.bytes)}
                                  </Text>
                                </Stack>
                              </Grid.Col>
                              <Grid.Col span={{ base: 12, md: 4 }}>
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Traces
                                  </Text>
                                  <Text size="sm" fw={500}>
                                    {formatCurrency(
                                      currentData.total.costs.traces,
                                    )}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    Storage: {formatBytes(currentData.total.ingestion.traces.bytes)}
                                  </Text>
                                </Stack>
                              </Grid.Col>
                              <Grid.Col span={{ base: 12, md: 4 }}>
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Metrics
                                  </Text>
                                  <Text size="sm" fw={500}>
                                    {formatCurrency(
                                      currentData.total.costs.metrics,
                                    )}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    Samples: {formatNumber(currentData.total.ingestion.metrics.rows)}
                                  </Text>
                                </Stack>
                              </Grid.Col>
                            </Grid>
                          </Grid.Col>
                          {currentData.teams && currentData.teams.length > 0 && (
                            <Grid.Col span={12}>
                              <Divider my="sm" />
                              <Text size="sm" fw={500} mb="xs">
                                By Team
                              </Text>
                              <Table>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Team</Table.Th>
                                    <Table.Th>Today's Cost</Table.Th>
                                    <Table.Th>Hourly Rate</Table.Th>
                                    <Table.Th>Usage</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {currentData.teams.map(team => (
                                    <Table.Tr key={team.teamId}>
                                      <Table.Td>
                                        <Text fw={500}>{team.teamName}</Text>
                                      </Table.Td>
                                      <Table.Td>
                                        {formatCurrency(team.costs.total)}
                                      </Table.Td>
                                      <Table.Td>
                                        <Text size="xs" c="dimmed">
                                          {formatCurrency(team.currentHourlyCost)}
                                          /hr
                                        </Text>
                                      </Table.Td>
                                      <Table.Td>
                                        <Stack gap={2}>
                                          <Text size="xs" c="dimmed">
                                            Logs: {formatBytes(team.ingestion.logs.bytes)}
                                          </Text>
                                          <Text size="xs" c="dimmed">
                                            Traces: {formatBytes(team.ingestion.traces.bytes)}
                                          </Text>
                                          <Text size="xs" c="dimmed">
                                            Metrics: {formatNumber(team.ingestion.metrics.rows)} samples
                                          </Text>
                                        </Stack>
                                      </Table.Td>
                                    </Table.Tr>
                                  ))}
                                </Table.Tbody>
                              </Table>
                            </Grid.Col>
                          )}
                        </Grid>
                      )}
                    </Card>

                    {/* Forecast Card */}
                    <Card withBorder>
                      <Group justify="space-between" mb="md">
                        <Text size="lg" fw={500}>
                          Cost Forecast (All Teams)
                        </Text>
                        <IconTrendingUp size={20} />
                      </Group>
                      {isLoadingForecast ? (
                        <Center p="xl">
                          <Loader color="dimmed" />
                        </Center>
                      ) : !forecastData ||
                        forecastData.total.forecasts.length === 0 ? (
                        <Text c="dimmed" ta="center" p="xl">
                          No forecast data available yet.
                        </Text>
                      ) : (
                        <Stack gap="md">
                          {forecastData.total.forecasts.map((forecast, idx) => (
                            <Box key={idx}>
                              <Group justify="space-between" mb="xs">
                                <Text size="sm" fw={500}>
                                  {forecast.description}
                                </Text>
                                <Text size="lg" fw={700}>
                                  {formatCurrency(forecast.projectedMonthlyCost)}
                                  /mo
                                </Text>
                              </Group>
                              <Text size="xs" c="dimmed">
                                Daily average:{' '}
                                {formatCurrency(forecast.projectedDailyCost)}
                              </Text>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Card>

                    {/* Quick Stats */}
                    <Card withBorder>
                      <Text size="lg" fw={500} mb="md">
                        Quick Stats
                      </Text>
                      <Grid>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <Stack gap={2}>
                            <Text size="sm" c="dimmed">
                              This Month Total
                            </Text>
                            <Text size="lg" fw={500}>
                              {formatCurrency(calculateThisMonthTotal())}
                            </Text>
                          </Stack>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <Stack gap={2}>
                            <Text size="sm" c="dimmed">
                              Average Daily Cost
                            </Text>
                            <Text size="lg" fw={500}>
                              {formatCurrency(calculateAverageDailyCost())}
                            </Text>
                          </Stack>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <Stack gap={2}>
                            <Text size="sm" c="dimmed">
                              Top Cost Driver
                            </Text>
                            <Text size="lg" fw={500}>
                              {currentData?.total
                                ? getTopCostDriver(currentData.total.costs)
                                : 'N/A'}
                            </Text>
                          </Stack>
                        </Grid.Col>
                      </Grid>
                    </Card>

                    {/* Real-Time Service Breakdown */}
                    <DataIngestionMetricsRealtimeSection />
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="breakdown" pt="md">
                  <Card withBorder>
                    <Stack gap="md">
                      <Group justify="space-between">
                        <Text size="lg" fw={500}>
                          Detailed Breakdown
                        </Text>
                        <Group gap="xs">
                          {teamOptions.length > 0 && (
                            <Select
                              placeholder="All Teams"
                              data={[
                                { value: '', label: 'All Teams' },
                                ...teamOptions,
                              ]}
                              value={selectedTeamId || ''}
                              onChange={val => setSelectedTeamId(val || null)}
                              size="xs"
                              style={{ width: 200 }}
                            />
                          )}
                          <InputLabel size="sm">Start Date</InputLabel>
                          <TextInput
                            type="date"
                            value={breakdownStartDate}
                            onChange={e =>
                              setBreakdownStartDate(e.target.value)
                            }
                            size="xs"
                            style={{ width: 150 }}
                          />
                          <InputLabel size="sm">End Date</InputLabel>
                          <TextInput
                            type="date"
                            value={breakdownEndDate}
                            onChange={e => setBreakdownEndDate(e.target.value)}
                            size="xs"
                            style={{ width: 150 }}
                          />
                        </Group>
                      </Group>

                      {isLoadingBreakdown ? (
                        <Center p="xl">
                          <Loader color="dimmed" />
                        </Center>
                      ) : !breakdownData?.teams ||
                        breakdownData.teams.length === 0 ? (
                        <Text c="dimmed" ta="center" p="xl">
                          No billing data available for the selected period.
                        </Text>
                      ) : (
                        <>
                          {breakdownData.total && (
                            <Box>
                              <Text size="sm" fw={500} mb="xs">
                                Period Total (All Teams)
                              </Text>
                              <Grid>
                                <Grid.Col span={{ base: 12, md: 3 }}>
                                  <Stack gap={2}>
                                    <Text size="sm" fw={500}>
                                      Total Cost
                                    </Text>
                                    <Text size="lg" fw={700}>
                                      {formatCurrency(breakdownData.total.costs.total)}
                                    </Text>
                                  </Stack>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, md: 3 }}>
                                  <Stack gap={2}>
                                    <Text size="sm" fw={500}>
                                      Logs
                                    </Text>
                                    <Text size="sm">
                                      {formatCurrency(breakdownData.total.costs.logs)}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {formatBytes(breakdownData.total.ingestion.logs.bytes)}
                                    </Text>
                                  </Stack>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, md: 3 }}>
                                  <Stack gap={2}>
                                    <Text size="sm" fw={500}>
                                      Traces
                                    </Text>
                                    <Text size="sm">
                                      {formatCurrency(breakdownData.total.costs.traces)}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {formatBytes(breakdownData.total.ingestion.traces.bytes)}
                                    </Text>
                                  </Stack>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, md: 3 }}>
                                  <Stack gap={2}>
                                    <Text size="sm" fw={500}>
                                      Metrics
                                    </Text>
                                    <Text size="sm">
                                      {formatCurrency(breakdownData.total.costs.metrics)}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {formatNumber(breakdownData.total.ingestion.metrics.rows)} samples
                                    </Text>
                                  </Stack>
                                </Grid.Col>
                              </Grid>
                            </Box>
                          )}

                          <Divider my="sm" />

                          {filteredTeams.map(team => (
                            <Box key={team.teamId}>
                              <Text size="md" fw={500} mb="xs">
                                {team.teamName}
                              </Text>
                              <Table striped highlightOnHover>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Date</Table.Th>
                                    <Table.Th>Logs</Table.Th>
                                    <Table.Th>Traces</Table.Th>
                                    <Table.Th>Metrics</Table.Th>
                                    <Table.Th>Total Cost</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {team.daily
                                    .slice()
                                    .reverse()
                                    .map(day => (
                                      <Table.Tr key={day.date}>
                                        <Table.Td>
                                          <Text fw={500}>
                                            {day.date
                                              ? new Date(
                                                  day.date,
                                                ).toLocaleDateString('en-US', {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  year: 'numeric',
                                                })
                                              : 'N/A'}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.logs)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(day.ingestion.logs.bytes)}
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.traces)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(day.ingestion.traces.bytes)}
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.metrics)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatNumber(day.ingestion.metrics.rows)} samples
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Badge
                                            variant="light"
                                            color="blue"
                                            size="lg"
                                          >
                                            {formatCurrency(day.costs.total)}
                                          </Badge>
                                        </Table.Td>
                                      </Table.Tr>
                                    ))}
                                </Table.Tbody>
                              </Table>
                            </Box>
                          ))}
                        </>
                      )}
                    </Stack>
                  </Card>
                </Tabs.Panel>

                <Tabs.Panel value="historical" pt="md">
                  <Card withBorder>
                    <Stack gap="md">
                      <Group justify="space-between">
                        <Text size="lg" fw={500}>
                          Historical Trends
                        </Text>
                        <Group gap="xs">
                          {teamOptions.length > 0 && (
                            <Select
                              placeholder="All Teams"
                              data={[
                                { value: '', label: 'All Teams' },
                                ...teamOptions,
                              ]}
                              value={selectedTeamId || ''}
                              onChange={val => setSelectedTeamId(val || null)}
                              size="xs"
                              style={{ width: 200 }}
                            />
                          )}
                          <InputLabel size="sm">Start Date</InputLabel>
                          <TextInput
                            type="date"
                            value={breakdownStartDate}
                            onChange={e =>
                              setBreakdownStartDate(e.target.value)
                            }
                            size="xs"
                            style={{ width: 150 }}
                          />
                          <InputLabel size="sm">End Date</InputLabel>
                          <TextInput
                            type="date"
                            value={breakdownEndDate}
                            onChange={e => setBreakdownEndDate(e.target.value)}
                            size="xs"
                            style={{ width: 150 }}
                          />
                        </Group>
                      </Group>

                      {isLoadingBreakdown ? (
                        <Center p="xl">
                          <Loader color="dimmed" />
                        </Center>
                      ) : !breakdownData?.teams ||
                        breakdownData.teams.length === 0 ? (
                        <Text c="dimmed" ta="center" p="xl">
                          No billing data available for the selected period.
                        </Text>
                      ) : (
                        <Stack gap="md">
                          {breakdownData.total && (
                            <Box>
                              <Text size="sm" fw={500} mb="xs">
                                Period Summary (All Teams)
                              </Text>
                              <Group gap="lg">
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Total Cost
                                  </Text>
                                  <Text size="lg" fw={700}>
                                    {formatCurrency(
                                      breakdownData.total.costs.total,
                                    )}
                                  </Text>
                                </Stack>
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Average Daily
                                  </Text>
                                  <Text size="lg" fw={500}>
                                    {formatCurrency(calculateAverageDailyCost())}
                                  </Text>
                                </Stack>
                                <Stack gap={2}>
                                  <Text size="xs" c="dimmed">
                                    Days
                                  </Text>
                                  <Text size="lg" fw={500}>
                                    {breakdownData.teams[0]?.daily?.length || 0}
                                  </Text>
                                </Stack>
                              </Group>
                            </Box>
                          )}

                          {/* Bar Chart */}
                          {chartData.length > 0 && (
                            <Box>
                              <Text size="sm" fw={500} mb="md">
                                Daily Cost Trends
                              </Text>
                              <Box style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={chartData}
                                    margin={{
                                      top: 20,
                                      right: 30,
                                      left: 20,
                                      bottom: 60,
                                    }}
                                  >
                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      opacity={0.3}
                                    />
                                    <XAxis
                                      dataKey="dateLabel"
                                      tick={{ fontSize: 12 }}
                                      angle={-45}
                                      textAnchor="end"
                                      height={80}
                                    />
                                    <YAxis
                                      tick={{ fontSize: 12 }}
                                      tickFormatter={(value: number) =>
                                        formatCurrency(value)
                                      }
                                      width={80}
                                    />
                                    <RechartsTooltip
                                      formatter={(value: number) =>
                                        formatCurrency(value)
                                      }
                                      labelFormatter={label => `Date: ${label}`}
                                      contentStyle={{
                                        backgroundColor:
                                          'var(--mantine-color-dark-7)',
                                        border:
                                          '1px solid var(--mantine-color-dark-4)',
                                        borderRadius: '4px',
                                      }}
                                    />
                                    <Legend />
                                    <Bar
                                      dataKey="logs"
                                      stackId="1"
                                      fill="#3b82f6"
                                      name="Logs"
                                      isAnimationActive={false}
                                    />
                                    <Bar
                                      dataKey="traces"
                                      stackId="1"
                                      fill="#10b981"
                                      name="Traces"
                                      isAnimationActive={false}
                                    />
                                    <Bar
                                      dataKey="metrics"
                                      stackId="1"
                                      fill="#f59e0b"
                                      name="Metrics"
                                      isAnimationActive={false}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </Box>
                            </Box>
                          )}

                          <Divider my="md" />

                          {filteredTeams.map(team => (
                            <Box key={team.teamId}>
                              <Text size="md" fw={500} mb="xs">
                                {team.teamName}
                              </Text>
                              <Table striped highlightOnHover>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Date</Table.Th>
                                    <Table.Th>Total Cost</Table.Th>
                                    <Table.Th>Logs</Table.Th>
                                    <Table.Th>Traces</Table.Th>
                                    <Table.Th>Metrics</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {team.daily
                                    .slice()
                                    .reverse()
                                    .map(day => (
                                      <Table.Tr key={day.date}>
                                        <Table.Td>
                                          <Text fw={500}>
                                            {day.date
                                              ? new Date(
                                                  day.date,
                                                ).toLocaleDateString('en-US', {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  year: 'numeric',
                                                })
                                              : 'N/A'}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          <Badge
                                            variant="light"
                                            color="blue"
                                            size="lg"
                                          >
                                            {formatCurrency(day.costs.total)}
                                          </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.logs)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(day.ingestion.logs.bytes)}
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.traces)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(day.ingestion.traces.bytes)}
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                          <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                              {formatCurrency(day.costs.metrics)}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatNumber(day.ingestion.metrics.rows)} samples
                                            </Text>
                                          </Stack>
                                        </Table.Td>
                                      </Table.Tr>
                                    ))}
                                </Table.Tbody>
                              </Table>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </Card>
                </Tabs.Panel>
              </Tabs>
            </Box>
          </Stack>
        </Container>
      </div>
    </div>
  );
}

BillingPage.getLayout = withAppNav;

