import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { AlertSource } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Button,
  Container,
  Center,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tabs,
  Paper,
  Divider,
  ActionIcon,
  Modal,
  Loader,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft,
  IconBrain,
  IconClock,
  IconDownload,
  IconEdit,
  IconMessage,
  IconSend,
  IconUser,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

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

const STATUS_OPTIONS = [
  'Open',
  'Investigating',
  'Identified',
  'Monitoring',
  'Resolved',
];

const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

function TimelineEvent({ event }: { event: any }) {
  const getEventIcon = () => {
    switch (event.type) {
      case 'status_change':
        return <IconClock size={16} />;
      case 'comment':
        return <IconMessage size={16} />;
      case 'alert':
        return <IconBrain size={16} />;
      case 'deployment':
        return <IconEdit size={16} />;
      default:
        return <IconClock size={16} />;
    }
  };

  return (
    <Paper p="md" withBorder>
      <Group gap="sm" align="flex-start">
        {getEventIcon()}
        <Stack gap={4} style={{ flex: 1 }}>
          <Group gap="xs" justify="space-between">
            <Text size="sm" fw={500}>
              {event.message}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
            </Text>
          </Group>
          {event.actor && (
            <Text size="xs" c="dimmed">
              by {event.actor.name || event.actor.email}
            </Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

export default function IncidentDetailPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = router.query;
  const incidentId = typeof id === 'string' ? id : '';

  const [isEditing, setIsEditing] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');
  const [showCommentModal, setShowCommentModal] = React.useState(false);
  const [editForm, setEditForm] = React.useState({
    title: '',
    description: '',
    status: '',
    severity: '',
  });

  const { data, isLoading, error, refetch } = api.useIncident(incidentId);
  const incident = data?.data;

  const updateIncident = api.useUpdateIncident();
  const addTimelineEvent = api.useAddTimelineEvent();
  const analyzeIncident = api.useAnalyzeIncident();
  const downloadReport = api.useDownloadIncidentReport();

  React.useEffect(() => {
    if (incident && !isEditing) {
      setEditForm({
        title: incident.title || '',
        description: incident.description || '',
        status: incident.status || '',
        severity: incident.severity || '',
      });
    }
  }, [incident, isEditing]);

  const handleUpdate = async () => {
    if (!incidentId) return;

    try {
      await updateIncident.mutateAsync({
        id: incidentId,
        ...editForm,
      });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      notifications.show({
        color: 'green',
        message: 'Incident updated successfully',
      });
    } catch (err: any) {
      notifications.show({
        color: 'red',
        message: err.message || 'Failed to update incident',
      });
    }
  };

  const handleAddComment = async () => {
    if (!incidentId || !commentText.trim()) return;

    try {
      await addTimelineEvent.mutateAsync({
        id: incidentId,
        type: 'comment',
        message: commentText,
      });
      setCommentText('');
      setShowCommentModal(false);
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId] });
      notifications.show({
        color: 'green',
        message: 'Comment added',
      });
    } catch (err: any) {
      notifications.show({
        color: 'red',
        message: err.message || 'Failed to add comment',
      });
    }
  };

  const handleAnalyze = async () => {
    if (!incidentId) return;

    try {
      notifications.show({
        id: 'analyzing',
        color: 'blue',
        message: 'Analyzing incident...',
        loading: true,
        autoClose: false,
      });

      await analyzeIncident.mutateAsync(incidentId);
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId] });

      notifications.update({
        id: 'analyzing',
        color: 'green',
        message: 'Analysis complete',
        loading: false,
        autoClose: 2000,
      });
    } catch (err: any) {
      notifications.update({
        id: 'analyzing',
        color: 'red',
        message: err.message || 'Failed to analyze incident',
        loading: false,
        autoClose: 3000,
      });
    }
  };

  const handleDownloadReport = async () => {
    if (!incidentId) return;

    try {
      notifications.show({
        id: 'downloading-report',
        color: 'blue',
        message: 'Generating report...',
        loading: true,
        autoClose: false,
      });

      await downloadReport.mutateAsync(incidentId);

      notifications.update({
        id: 'downloading-report',
        color: 'green',
        message: 'Report downloaded successfully',
        loading: false,
        autoClose: 2000,
      });
    } catch (err: any) {
      notifications.update({
        id: 'downloading-report',
        color: 'red',
        message: err.message || 'Failed to download report',
        loading: false,
        autoClose: 3000,
      });
    }
  };

  if (isLoading) {
    return (
      <Container maw={1500}>
        <Center style={{ minHeight: '50vh' }}>
          <Loader size="lg" />
        </Center>
      </Container>
    );
  }

  if (error || !incident) {
    return (
      <Container maw={1500}>
        <Text c="red">Error loading incident or incident not found</Text>
      </Container>
    );
  }

  return (
    <div data-testid="incident-detail-page" className="IncidentDetailPage">
      <Head>
        <title>{incident.title} - Incidents</title>
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
            {isEditing ? (
              <TextInput
                value={editForm.title}
                onChange={e =>
                  setEditForm({ ...editForm, title: e.target.value })
                }
                style={{ minWidth: 300 }}
              />
            ) : (
              <Text size="xl" fw={600}>
                {incident.title}
              </Text>
            )}
          </Group>
          <Group>
            {isEditing ? (
              <>
                <Button variant="subtle" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdate}
                  loading={updateIncident.isPending}
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  leftSection={<IconMessage size={16} />}
                  variant="light"
                  onClick={() => setShowCommentModal(true)}
                >
                  Add Comment
                </Button>
                <Button
                  leftSection={<IconBrain size={16} />}
                  onClick={handleAnalyze}
                  loading={analyzeIncident.isPending}
                >
                  Analyze
                </Button>
                <Button
                  leftSection={<IconDownload size={16} />}
                  variant="light"
                  onClick={handleDownloadReport}
                  loading={downloadReport.isPending}
                >
                  Download Report
                </Button>
                <Button
                  leftSection={<IconEdit size={16} />}
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </Button>
              </>
            )}
          </Group>
        </Group>
      </PageHeader>

      <div className="my-4">
        <Container maw={1500}>
          <ErrorBoundary message="Failed to load incident details">
            <Stack gap="lg">
              {/* Header Info */}
              <Paper p="md" withBorder>
                <Stack gap="md">
                  <Group>
                    <Text size="sm" c="dimmed">
                      Severity:
                    </Text>
                    {isEditing ? (
                      <Select
                        value={editForm.severity}
                        onChange={value =>
                          setEditForm({ ...editForm, severity: value || '' })
                        }
                        data={SEVERITY_OPTIONS}
                        style={{ width: 150 }}
                      />
                    ) : (
                      <Badge
                        color={SEVERITY_COLORS[incident.severity] || 'gray'}
                        size="lg"
                      >
                        {incident.severity}
                      </Badge>
                    )}
                    <Text size="sm" c="dimmed">
                      Status:
                    </Text>
                    {isEditing ? (
                      <Select
                        value={editForm.status}
                        onChange={value =>
                          setEditForm({ ...editForm, status: value || '' })
                        }
                        data={STATUS_OPTIONS}
                        style={{ width: 200 }}
                      />
                    ) : (
                      <Badge
                        color={STATUS_COLORS[incident.status] || 'gray'}
                        variant="light"
                        size="lg"
                      >
                        {incident.status}
                      </Badge>
                    )}
                    {incident.owner && (
                      <>
                        <IconUser size={16} style={{ marginLeft: 'auto' }} />
                        <Text size="sm">
                          {incident.owner.name || incident.owner.email}
                        </Text>
                      </>
                    )}
                  </Group>
                  {isEditing ? (
                    <Textarea
                      label="Description"
                      value={editForm.description}
                      onChange={e =>
                        setEditForm({ ...editForm, description: e.target.value })
                      }
                      minRows={3}
                    />
                  ) : (
                    incident.description && (
                      <Text size="sm">{incident.description}</Text>
                    )
                  )}
                  <Group gap="md">
                    <Text size="xs" c="dimmed">
                      Started:{' '}
                      {formatDistanceToNow(new Date(incident.startedAt), {
                        addSuffix: true,
                      })}
                    </Text>
                    {incident.resolvedAt && (
                      <Text size="xs" c="dimmed">
                        Resolved:{' '}
                        {formatDistanceToNow(new Date(incident.resolvedAt), {
                          addSuffix: true,
                        })}
                      </Text>
                    )}
                    {incident.alerts && incident.alerts.length > 0 && (
                      <Group gap="xs">
                        <Text size="xs" c="dimmed">
                          Associated alerts:
                        </Text>
                        {incident.alerts.map((alert: any, index: number) => {
                          let alertUrl = '';
                          let alertName = alert.name || `Alert ${index + 1}`;
                          
                          if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch?._id) {
                            alertUrl = `/search/${alert.savedSearch._id}`;
                            alertName = alert.savedSearch.name || alertName;
                          } else if (alert.source === AlertSource.TILE && alert.dashboard?._id && alert.tileId) {
                            alertUrl = `/dashboards/${alert.dashboard._id}?highlightedTileId=${alert.tileId}`;
                            const tile = alert.dashboard.tiles?.find((t: any) => t.id === alert.tileId);
                            alertName = tile?.config?.name || alert.dashboard.name || alertName;
                          }
                          
                          return alertUrl ? (
                            <Link
                              key={alert._id || index}
                              href={alertUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ textDecoration: 'none' }}
                            >
                              <Badge variant="light" size="sm" style={{ cursor: 'pointer' }}>
                                {alertName}
                              </Badge>
                            </Link>
                          ) : (
                            <Badge key={alert._id || index} variant="light" size="sm">
                              {alertName}
                            </Badge>
                          );
                        })}
                      </Group>
                    )}
                  </Group>
                </Stack>
              </Paper>

              {/* Main Content Tabs */}
              <Tabs defaultValue="timeline">
                <Tabs.List>
                  <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
                  <Tabs.Tab value="analysis">Analysis</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="timeline" pt="md">
                  <Stack gap="md">
                    {incident.timeline && incident.timeline.length > 0 ? (
                      incident.timeline
                        .slice()
                        .reverse()
                        .map((event: any, index: number) => (
                          <TimelineEvent key={index} event={event} />
                        ))
                    ) : (
                      <Text c="dimmed" ta="center" py="xl">
                        No timeline events yet
                      </Text>
                    )}
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="analysis" pt="md">
                  {incident.analysis ? (
                    <Paper p="md" withBorder>
                      <div className="hdx-markdown">
                        <ReactMarkdown>{incident.analysis}</ReactMarkdown>
                      </div>
                    </Paper>
                  ) : (
                    <Paper p="xl" withBorder>
                      <Stack align="center" gap="md">
                        <Text c="dimmed" ta="center">
                          No analysis available yet
                        </Text>
                        <Button
                          leftSection={<IconBrain size={16} />}
                          onClick={handleAnalyze}
                          loading={analyzeIncident.isPending}
                        >
                          Generate Analysis
                        </Button>
                      </Stack>
                    </Paper>
                  )}
                </Tabs.Panel>
              </Tabs>
            </Stack>
          </ErrorBoundary>
        </Container>
      </div>

      {/* Comment Modal */}
      <Modal
        opened={showCommentModal}
        onClose={() => {
          setShowCommentModal(false);
          setCommentText('');
        }}
        title="Add Comment"
      >
        <Stack gap="md">
          <Textarea
            placeholder="Add a comment to the timeline..."
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            minRows={4}
            autosize
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => {
                setShowCommentModal(false);
                setCommentText('');
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconSend size={16} />}
              onClick={handleAddComment}
              loading={addTimelineEvent.isPending}
              disabled={!commentText.trim()}
            >
              Add Comment
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

IncidentDetailPage.getLayout = withAppNav;
