import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconX,
  IconExternalLink,
  IconAlertTriangle,
  IconInfoCircle,
  IconBulb,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import {
  TelemetryInsight,
  useDismissInsight,
  useAcknowledgeInsight,
} from '@/telemetryInsights';

interface InsightCardProps {
  insight: TelemetryInsight;
}

const categoryColors: Record<string, string> = {
  reliability: 'red',
  observability: 'blue',
  best_practices: 'yellow',
};

const categoryIcons: Record<string, React.ReactNode> = {
  reliability: <IconAlertTriangle size={16} />,
  observability: <IconInfoCircle size={16} />,
  best_practices: <IconBulb size={16} />,
};

const severityColors: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'gray',
};

export default function InsightCard({ insight }: InsightCardProps) {
  const queryClient = useQueryClient();
  const dismissInsight = useDismissInsight();
  const acknowledgeInsight = useAcknowledgeInsight();

  const handleDismiss = React.useCallback(() => {
    dismissInsight.mutate(insight._id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['telemetry-insights'] });
      },
    });
  }, [insight._id, dismissInsight, queryClient]);

  const handleAcknowledge = React.useCallback(() => {
    acknowledgeInsight.mutate(insight._id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['telemetry-insights'] });
      },
    });
  }, [insight._id, acknowledgeInsight, queryClient]);

  const isActive = insight.status === 'active';

  return (
    <Card
      shadow="sm"
      padding="lg"
      radius="md"
      withBorder
      style={{
        opacity: isActive ? 1 : 0.7,
        borderLeft: `4px solid var(--mantine-color-${categoryColors[insight.category]}-6)`,
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Group gap="xs">
            {categoryIcons[insight.category]}
            <Badge
              color={categoryColors[insight.category]}
              variant="light"
              size="sm"
            >
              {insight.category.replace('_', ' ')}
            </Badge>
            <Badge
              color={severityColors[insight.severity]}
              variant="dot"
              size="sm"
            >
              {insight.severity}
            </Badge>
            {insight.serviceName && (
              <Badge variant="outline" size="sm">
                {insight.serviceName}
              </Badge>
            )}
            {!isActive && (
              <Badge variant="light" size="sm" color="gray">
                {insight.status}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {formatDistanceToNow(new Date(insight.generatedAt), {
              addSuffix: true,
            })}
          </Text>
        </Group>

        <Box>
          <Text fw={600} size="lg" mb="xs">
            {insight.title}
          </Text>
          <Text size="sm" c="dimmed" mb="md">
            {insight.description}
          </Text>
        </Box>

        {insight.suggestions.length > 0 && (
          <Box>
            <Text fw={500} size="sm" mb="xs">
              Suggestions:
            </Text>
            <Stack gap="xs">
              {insight.suggestions.map((suggestion, index) => (
                <Text key={index} size="sm" style={{ paddingLeft: '1rem' }}>
                  • {suggestion}
                </Text>
              ))}
            </Stack>
          </Box>
        )}

        {insight.relatedQueries.length > 0 && (
          <Box>
            <Text fw={500} size="sm" mb="xs">
              Related Queries:
            </Text>
            <Group gap="xs">
              {insight.relatedQueries.map((query, index) => {
                if (query.type === 'search' && query.query) {
                  return (
                    <Tooltip key={index} label={query.query}>
                      <Button
                        component={Link}
                        href={`/search?q=${encodeURIComponent(query.query)}`}
                        variant="light"
                        size="xs"
                        rightSection={<IconExternalLink size={14} />}
                      >
                        {query.label}
                      </Button>
                    </Tooltip>
                  );
                }
                if (query.type === 'dashboard' && query.dashboardId) {
                  return (
                    <Button
                      key={index}
                      component={Link}
                      href={`/dashboards/${query.dashboardId}`}
                      variant="light"
                      size="xs"
                      rightSection={<IconExternalLink size={14} />}
                    >
                      {query.label}
                    </Button>
                  );
                }
                return null;
              })}
            </Group>
          </Box>
        )}

        {isActive && (
          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconX size={14} />}
              onClick={handleDismiss}
              loading={dismissInsight.isPending}
            >
              Dismiss
            </Button>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconCheck size={14} />}
              onClick={handleAcknowledge}
              loading={acknowledgeInsight.isPending}
            >
              Mark Resolved
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

