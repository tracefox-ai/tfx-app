import * as React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  Badge,
  Button,
  Container,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Paper,
  ActionIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageHeader } from '@/components/PageHeader';

import api from './api';
import { withAppNav } from './layout';

const SEVERITY_OPTIONS = [
  { value: 'Critical', label: 'Critical' },
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
];

const STATUS_OPTIONS = [
  { value: 'Open', label: 'Open' },
  { value: 'Investigating', label: 'Investigating' },
  { value: 'Identified', label: 'Identified' },
  { value: 'Monitoring', label: 'Monitoring' },
  { value: 'Resolved', label: 'Resolved' },
];

export default function IncidentCreatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formData, setFormData] = React.useState({
    title: '',
    description: '',
    severity: 'Medium',
    status: 'Open',
    alertIds: [] as string[],
  });

  const createIncident = api.useCreateIncident();
  const { data: alertsData } = api.useAlerts();

  const availableAlerts = React.useMemo(() => {
    return alertsData?.data?.filter(
      (alert: any) => alert.state === 'ALERT',
    ) || [];
  }, [alertsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      notifications.show({
        color: 'red',
        message: 'Title is required',
      });
      return;
    }

    try {
      const result = await createIncident.mutateAsync({
        title: formData.title,
        description: formData.description || undefined,
        severity: formData.severity,
        status: formData.status,
        alertIds: formData.alertIds,
      });

      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      notifications.show({
        color: 'green',
        message: 'Incident created successfully',
        icon: <IconCheck size={16} />,
      });

      // Navigate to the new incident
      if (result?.data?._id) {
        router.push(`/incidents/${result.data._id}`);
      } else {
        router.push('/incidents');
      }
    } catch (err: any) {
      notifications.show({
        color: 'red',
        message: err.message || 'Failed to create incident',
      });
    }
  };

  return (
    <div data-testid="incident-create-page" className="IncidentCreatePage">
      <Head>
        <title>New Incident - Incidents</title>
      </Head>
      <PageHeader>
        <Group justify="space-between" style={{ width: '100%' }}>
          <Group gap="md">
            <ActionIcon
              variant="subtle"
              onClick={() => router.push('/incidents')}
            >
              <IconArrowLeft size={20} />
            </ActionIcon>
            <Text size="xl" fw={600}>
              New Incident
            </Text>
          </Group>
        </Group>
      </PageHeader>

      <div className="my-4">
        <Container maw={800}>
          <ErrorBoundary message="Failed to load incident form">
            <form onSubmit={handleSubmit}>
              <Stack gap="lg">
                <Paper p="md" withBorder>
                  <Stack gap="md">
                    <TextInput
                      label="Title"
                      placeholder="Enter incident title"
                      required
                      value={formData.title}
                      onChange={e =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                    />

                    <Textarea
                      label="Description"
                      placeholder="Enter incident description (optional)"
                      value={formData.description}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      minRows={4}
                    />

                    <Group grow>
                      <Select
                        label="Severity"
                        required
                        data={SEVERITY_OPTIONS}
                        value={formData.severity}
                        onChange={value =>
                          setFormData({
                            ...formData,
                            severity: value || 'Medium',
                          })
                        }
                      />

                      <Select
                        label="Status"
                        required
                        data={STATUS_OPTIONS}
                        value={formData.status}
                        onChange={value =>
                          setFormData({
                            ...formData,
                            status: value || 'Open',
                          })
                        }
                      />
                    </Group>

                    {availableAlerts.length > 0 && (
                      <Select
                        label="Associate Alerts (optional)"
                        placeholder="Select alerts to associate"
                        data={availableAlerts.map((alert: any) => ({
                          value: alert._id,
                          label: alert.name || alert._id,
                        }))}
                        value={formData.alertIds[0] || null}
                        onChange={value =>
                          setFormData({
                            ...formData,
                            alertIds: value ? [value] : [],
                          })
                        }
                        clearable
                        searchable
                      />
                    )}
                  </Stack>
                </Paper>

                <Group justify="flex-end">
                  <Button
                    variant="subtle"
                    onClick={() => router.push('/incidents')}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={createIncident.isPending}
                    leftSection={<IconCheck size={16} />}
                  >
                    Create Incident
                  </Button>
                </Group>
              </Stack>
            </form>
          </ErrorBoundary>
        </Container>
      </div>
    </div>
  );
}

IncidentCreatePage.getLayout = withAppNav;
