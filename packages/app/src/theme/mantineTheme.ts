import {
  ActionIcon,
  Button,
  MantineTheme,
  MantineThemeOverride,
  rem,
  Select,
  Text,
  Tooltip,
} from '@mantine/core';

// Tailwind Slate
const slate = [
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#1e293b',
  '#0f172a',
];

// Tailwind Indigo
const indigo = [
  '#eef2ff',
  '#e0e7ff',
  '#c7d2fe',
  '#a5b4fc',
  '#818cf8',
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#3730a3',
  '#312e81',
];

export const makeTheme = ({
  fontFamily = 'var(--font-inter), "IBM Plex Sans", monospace',
}: {
  fontFamily?: string;
}): MantineThemeOverride => ({
  cursorType: 'pointer',
  fontFamily,
  primaryColor: 'indigo',
  primaryShade: 5, // Indigo-500 is standard primary
  autoContrast: true,
  white: '#fff',
  fontSizes: {
    xxs: '11px',
    xs: '12px',
    sm: '13px',
    md: '15px',
    lg: '16px',
    xl: '18px',
  },
  spacing: {
    xxxs: 'calc(0.375rem * var(--mantine-scale))',
    xxs: 'calc(0.5rem * var(--mantine-scale))',
    xs: 'calc(0.625rem * var(--mantine-scale))',
    sm: 'calc(0.75rem * var(--mantine-scale))',
    md: 'calc(1rem * var(--mantine-scale))',
    lg: 'calc(1.25rem * var(--mantine-scale))',
    xl: 'calc(2rem * var(--mantine-scale))',
  },
  colors: {
    // Override standard colors with our palette
    gray: slate as any,
    dark: [
      '#f8fafc', // 0 - Slate 50
      '#f1f5f9', // 1 - Slate 100
      '#e2e8f0', // 2 - Slate 200
      '#cbd5e1', // 3 - Slate 300
      '#94a3b8', // 4 - Slate 400
      '#64748b', // 5 - Slate 500
      '#334155', // 6 - Slate 700 (Inputs)
      '#1e293b', // 7 - Slate 800 (Borders/Secondary BG)
      '#0f172a', // 8 - Slate 900 (Card BG)
      '#020617', // 9 - Slate 950 (App BG)
    ],
    indigo: indigo as any,
  },
  headings: {
    fontFamily,
  },
  components: {
    Tooltip: Tooltip.extend({
      styles: () => ({
        tooltip: {
          fontFamily: 'var(--mantine-font-family)',
        },
      }),
    }),
    Modal: {
      styles: {
        header: {
          fontFamily,
          fontWeight: 'bold',
        },
      },
    },
    InputWrapper: {
      styles: {
        label: {
          marginBottom: 4,
          fontWeight: 500,
        },
        description: {
          marginBottom: 8,
          lineHeight: 1.3,
        },
      },
    },
    Select: Select.extend({
      styles: {
        input: {
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-bg-field)',
          '&:focus': {
            borderColor: 'var(--mantine-color-indigo-5)',
          },
        },
      },
    }),
    Input: {
      styles: {
        input: {
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-bg-field)',
          color: 'var(--color-text)',
        },
      },
    },
    Card: {
      defaultProps: {
        withBorder: true,
      },
      styles: (_theme: MantineTheme, _props: any) => {
        return {
          root: {
            backgroundColor: 'var(--color-bg-surface)',
            borderColor: 'var(--color-border)',
          },
        };
      },
    },
    Divider: {
      styles: {
        root: {
          borderColor: 'var(--color-border)',
        },
      },
    },
    Accordion: {
      styles: (_theme: MantineTheme, _props: any) => {
        const base = {
          control: {
            '&:hover': {
              backgroundColor: 'var(--color-bg-muted)',
            },
          },
          item: {
            borderColor: 'var(--color-border)',
          },
        };
        return base;
      },
    },
    Paper: {
      styles: (_theme: MantineTheme, _props: any) => ({
        root: {
          backgroundColor: 'var(--color-bg-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
        },
      }),
    },
    Text: Text.extend({
      styles: (_theme, props) => {
        if (props.variant === 'danger') {
          return {
            root: {
              color: 'var(--mantine-color-red-6)',
            },
          };
        }
        return {};
      },
    }),
    Button: Button.extend({
      defaultProps: {
        fw: 500,
      },
      vars: (_theme, props) => {
        if (props.size === 'xxs') {
          return {
            root: {
              '--button-height': rem(22),
              '--button-padding-x': rem(8),
              '--button-fz': rem(12),
            },
          };
        }

        return { root: {} };
      },
      styles: (_theme, props) => {
        // Primary variant - light green style
        if (props.variant === 'primary') {
          return {
            root: {
              backgroundColor: 'var(--mantine-color-green-light)',
              color: 'var(--mantine-color-green-light-color)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-green-light-hover)',
              },
            },
          };
        }

        // Secondary variant - similar to default
        if (props.variant === 'secondary') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-body)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              '&:hover': {
                backgroundColor: 'var(--color-bg-hover)',
              },
            },
          };
        }

        // Danger variant - light red style
        if (props.variant === 'danger') {
          return {
            root: {
              backgroundColor: 'var(--mantine-color-red-light)',
              color: 'var(--mantine-color-red-light-color)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-red-light-hover)',
              },
            },
          };
        }

        return {};
      },
    }),
    SegmentedControl: {
      styles: {
        root: {
          backgroundColor: 'var(--color-bg-surface)',
        },
      },
    },
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
      },
      styles: (_theme, props) => {
        if (props.variant === 'subtle') {
          return {
            root: {
              color: 'var(--mantine-color-gray-4)',
              '&:hover': {
                backgroundColor: 'var(--color-bg-hover)',
                color: 'var(--color-text)',
              },
            },
          };
        }
        return {};
      },
    }),
  },
});

export const theme = makeTheme({});
