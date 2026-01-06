import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  Badge,
  Button,
  Container,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageHeader } from '@/components/PageHeader';

import api from './api';
import { withAppNav } from './layout';

const SEVERITY_COLORS: Record<string, string> = {
  Critical: 'red',
  High: 'orange',
  Medium: 'yellow',
  Low: 'blue',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'red',
  Investigating: 'orange',
  Identified: 'yellow',
  Monitoring: 'blue',
  Resolved: 'green',
};

function IncidentRow({ incident }: { incident: any }) {
  const router = useRouter();

  return (
    <Table.Tr
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(`/incidents/${incident._id}`)}
    >
      <Table.Td>
        <Badge color={SEVERITY_COLORS[incident.severity] || 'gray'} size="sm">
          {incident.severity}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge color={STATUS_COLORS[incident.status] || 'gray'} variant="light">
          {incident.status}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text fw={500}>{incident.title}</Text>
        {incident.description && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {incident.description}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {incident.owner ? (
          <Text size="sm">{incident.owner.name || incident.owner.email}</Text>
        ) : (
          <Text size="sm" c="dimmed">
            Unassigned
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {formatDistanceToNow(new Date(incident.startedAt), { addSuffix: true })}
        </Text>
      </Table.Td>
      <Table.Td>
        {incident.alerts && incident.alerts.length > 0 ? (
          <Badge variant="light" size="sm">
            {incident.alerts.length} alert{incident.alerts.length > 1 ? 's' : ''}
          </Badge>
        ) : (
          <Text size="sm" c="dimmed">
            –
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export default function IncidentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<string | undefined>();
  const [severityFilter, setSeverityFilter] = React.useState<string | undefined>();
  const [searchQuery, setSearchQuery] = React.useState('');

  const { data, isError, isLoading, refetch } = api.useIncidents({
    status: statusFilter,
    severity: severityFilter,
  });

  const incidents = React.useMemo(() => {
    let filtered = data?.data || [];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (incident: any) =>
          incident.title?.toLowerCase().includes(query) ||
          incident.description?.toLowerCase().includes(query),
      );
    }
    return filtered;
  }, [data?.data, searchQuery]);

  const handleCreateIncident = () => {
    router.push('/incidents/new');
  };

  return (
    <div data-testid="incidents-page" className="IncidentsPage">
      <Head>
        <title>Incidents</title>
      </Head>
      <PageHeader>
        <Group justify="space-between" style={{ width: '100%' }}>
          <Text size="xl" fw={600}>
            Incidents
          </Text>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleCreateIncident}
          >
            New Incident
          </Button>
        </Group>
      </PageHeader>
      <div className="my-4">
        <Container maw={1500}>
          <ErrorBoundary message="Failed to load incidents">
            <Stack gap="md">
              <Group>
                <TextInput
                  placeholder="Search incidents..."
                  leftSection={<IconSearch size={16} />}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Select
                  placeholder="Filter by status"
                  data={[
                    { value: '', label: 'All Statuses' },
                    { value: 'Open', label: 'Open' },
                    { value: 'Investigating', label: 'Investigating' },
                    { value: 'Identified', label: 'Identified' },
                    { value: 'Monitoring', label: 'Monitoring' },
                    { value: 'Resolved', label: 'Resolved' },
                  ]}
                  value={statusFilter || ''}
                  onChange={value => setStatusFilter(value || undefined)}
                  clearable
                />
                <Select
                  placeholder="Filter by severity"
                  data={[
                    { value: '', label: 'All Severities' },
                    { value: 'Critical', label: 'Critical' },
                    { value: 'High', label: 'High' },
                    { value: 'Medium', label: 'Medium' },
                    { value: 'Low', label: 'Low' },
                  ]}
                  value={severityFilter || ''}
                  onChange={value => setSeverityFilter(value || undefined)}
                  clearable
                />
              </Group>

              {isLoading ? (
                <div className="text-center my-4 fs-8">Loading...</div>
              ) : isError ? (
                <div className="text-center my-4 fs-8">Error loading incidents</div>
              ) : incidents?.length ? (
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Severity</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Title</Table.Th>
                      <Table.Th>Owner</Table.Th>
                      <Table.Th>Created</Table.Th>
                      <Table.Th>Alerts</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {incidents.map((incident: any) => (
                      <IncidentRow key={incident._id} incident={incident} />
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <div className="text-center my-4 fs-8">
                  {searchQuery || statusFilter || severityFilter
                    ? 'No incidents match your filters'
                    : 'No incidents created yet'}
                </div>
              )}
            </Stack>
          </ErrorBoundary>
        </Container>
      </div>
    </div>
  );
}

IncidentsPage.getLayout = withAppNav;
