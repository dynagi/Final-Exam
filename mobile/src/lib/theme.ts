/**
 * Theme system — light + dark palettes share the same key set so any
 * component can read `colors` from `useTheme()` and restyle on toggle.
 *
 * Screens build their StyleSheet with a `makeStyles(colors)` factory and
 * memoize it on `colors`, so flipping the mode re-themes the whole app.
 */
import { Platform } from 'react-native';

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderLight: string;
  text: string;
  textDim: string;
  textFaint: string;
  primary: string;
  primaryDark: string;
  primarySoft: string; // translucent primary for selected backgrounds
  accent: string;
  violet: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  gold: string;
  /** Text/icon color that sits on top of a gradient or solid primary fill. */
  onAccent: string;
  /** Backdrop for modals. */
  backdrop: string;
  /** Glassmorphism: translucent surface + hairline highlight border. */
  glass: string;
  glassBorder: string;
  /** Blur tint for expo-blur ('light' | 'dark' | 'default'). */
  blurTint: 'light' | 'dark' | 'default';
  /** Three soft blobs that paint the animated mesh/aurora background. */
  mesh: readonly [string, string, string];
}

/** "Ink desk at night" — a leather-and-lamplight study. */
export const darkColors: ThemeColors = {
  bg: '#1B140D',
  bgElevated: '#241B12',
  surface: '#2A2014',
  surfaceAlt: '#332615',
  border: '#4A3826',
  borderLight: '#5C4630',
  text: '#EDE0C8',
  textDim: '#B8A67E',
  textFaint: '#8A7856',
  primary: '#6E9BD6',
  primaryDark: '#4A7AB8',
  primarySoft: 'rgba(110, 155, 214, 0.16)',
  accent: '#D8B85C',
  violet: '#B08A5C',
  success: '#5FA876',
  warning: '#D8B85C',
  danger: '#D96B6B',
  info: '#6E9BD6',
  gold: '#D8B85C',
  onAccent: '#1B140D',
  backdrop: 'rgba(10, 7, 4, 0.72)',
  glass: 'rgba(42, 32, 20, 0.62)',
  glassBorder: 'rgba(216, 184, 92, 0.22)',
  blurTint: 'dark',
  mesh: ['rgba(216,184,92,0.20)', 'rgba(139,46,46,0.16)', 'rgba(110,155,214,0.14)'],
};

/** "Exam-hall daylight" — bright ivory paper, ink and wax-seal accents. */
export const lightColors: ThemeColors = {
  bg: '#F2EAD3',
  bgElevated: '#FBF7EC',
  surface: '#FBF7EC',
  surfaceAlt: '#F0E6C8',
  border: '#D8C9A0',
  borderLight: '#C7B686',
  text: '#2E2417',
  textDim: '#6B5A3E',
  textFaint: '#9C8B68',
  primary: '#2A4B7C',
  primaryDark: '#1D3557',
  primarySoft: 'rgba(42, 75, 124, 0.10)',
  accent: '#A9812F',
  violet: '#6B4423',
  success: '#2F6B3F',
  warning: '#B8860B',
  danger: '#8B2E2E',
  info: '#2A4B7C',
  gold: '#A9812F',
  onAccent: '#FBF7EC',
  backdrop: 'rgba(46, 36, 23, 0.42)',
  glass: 'rgba(251, 247, 236, 0.72)',
  glassBorder: 'rgba(169, 129, 47, 0.35)',
  blurTint: 'light',
  mesh: ['rgba(169,129,47,0.16)', 'rgba(139,46,46,0.10)', 'rgba(42,75,124,0.08)'],
};

export type ThemeMode = 'light' | 'dark';

export function paletteFor(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? darkColors : lightColors;
}

/** Gradient pairs used by buttons, chips and brand marks (work on both modes). */
export const gradients = {
  primary: ['#2A4B7C', '#4A7AB8'] as const,
  success: ['#2F6B3F', '#5FA876'] as const,
  danger: ['#8B2E2E', '#B8453F'] as const,
  /** Wax-seal ribbon — crimson to antique gold, used for logos and gradient titles. Kept dark enough to stay legible as text on both the cream and ink backgrounds. */
  brand: ['#8B2E2E', '#A9812F', '#8A6D23'] as const,
};

/** Book/newsletter serif — used for titles, section headers and stamped labels. */
export const serif = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Times New Roman", serif',
});

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
};

/** Semantic color key for any status / severity string used across the app. */
type ToneKey = keyof Pick<
  ThemeColors,
  'info' | 'success' | 'textDim' | 'warning' | 'accent' | 'primary' | 'gold' | 'danger'
>;

const statusTone: Record<string, ToneKey> = {
  // questions
  submitted: 'info',
  approved: 'success',
  used: 'textDim',
  // papers
  draft: 'textDim',
  sealed: 'warning',
  sealed_dual: 'accent',
  printed: 'primary',
  distributed: 'gold',
  completed: 'success',
  // copies / custody
  in_transit: 'warning',
  at_center: 'info',
  delivered: 'success',
  missing: 'danger',
  leaked: 'danger',
  // exams
  scheduled: 'accent',
  // alert severities
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export const statusLabel: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  used: 'Used in paper',
  draft: 'Draft',
  sealed: 'Sealed (1/2)',
  sealed_dual: 'Dual-Sealed',
  printed: 'Printed',
  distributed: 'Distributed',
  completed: 'Completed',
  in_transit: 'In Transit',
  at_center: 'At Center',
  delivered: 'Delivered',
  missing: 'MISSING',
  leaked: 'LEAKED',
  scheduled: 'Scheduled',
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
  // question types
  mcq: 'MCQ',
  msq: 'MSQ',
  numerical: 'Numerical',
  theoretical: 'Theory',
};

export function toneFor(colors: ThemeColors, status: string): string {
  const key = statusTone[status];
  return key ? colors[key] : colors.textDim;
}

export function labelFor(status: string): string {
  return statusLabel[status] ?? status;
}
