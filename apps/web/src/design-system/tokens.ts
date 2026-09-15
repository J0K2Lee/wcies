/**
 * WCIES Design Tokens — "精致中性商务" (Phase 1 redesign task §6-§9).
 *
 * Single source of truth for colors / spacing / radius / typography / shadows.
 * Pages must consume these tokens (directly or via the AntD theme) instead of
 * hard-coding hex values, so the visual language stays consistent as the
 * system extends in Phase 2.
 */

export const colors = {
  /** App canvas behind cards / rails. */
  canvas: '#F6F7F9',
  container: '#FFFFFF',
  sidebar: '#FFFFFF',

  textPrimary: '#172033',
  textSecondary: '#667085',
  textTertiary: '#98A2B3',

  border: '#E7E9EE',
  borderSoft: '#EEF0F3',

  /** Low-saturation blue-gray primary (NOT default AntD bright blue). */
  primary: '#496F96',
  primaryHover: '#52779C',
  primaryActive: '#3E5F82',
  primarySoft: '#ECF1F6',

  // Semantic states: light background + darker text + small indicator only.
  success: '#2F9E62',
  successBg: '#EAF6EF',
  successBorder: '#C4E7D3',
  warning: '#C2760F',
  warningBg: '#FCF3E5',
  warningBorder: '#F0DCBB',
  danger: '#C4433C',
  dangerBg: '#FBEDEC',
  dangerBorder: '#F0C7C4',
  info: '#496F96',
  infoBg: '#ECF1F6',
  infoBorder: '#D3DEEA',
  neutral: '#667085',
  neutralBg: '#F1F3F6',
  neutralBorder: '#E2E6EC',
  purple: '#7A5EA8',
  purpleBg: '#F2EEF9',
  purpleBorder: '#DFD7EE',
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
} as const;

export const radius = {
  card: 12,
  button: 8,
  input: 8,
  tag: 6,
} as const;

export const typography = {
  fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, -apple-system, sans-serif",
  /** Monospace for order numbers / platform IDs / UUID / raw payloads (UI spec §9). */
  monoFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  pageTitle: { size: 28, weight: 650, lineHeight: '36px' },
  sectionTitle: { size: 16, weight: 600, lineHeight: '24px' },
  cardTitle: { size: 14, weight: 600, lineHeight: '22px' },
  body: { size: 14, weight: 400, lineHeight: '22px' },
  secondary: { size: 12.5, weight: 400, lineHeight: '20px' },
  kpi: { size: 30, weight: 680, lineHeight: '38px' },
} as const;

/** Very light elevation: 1px border + soft shadow, no strong float. */
export const shadows = {
  card: '0 1px 2px rgba(23, 32, 51, 0.04), 0 1px 3px rgba(23, 32, 51, 0.05)',
  cardHover: '0 2px 6px rgba(23, 32, 51, 0.06), 0 1px 3px rgba(23, 32, 51, 0.06)',
  rail: 'inset 1px 0 0 #EEF0F3',
  overlay: '0 6px 24px rgba(23, 32, 51, 0.10)',
} as const;

/** Sidebar / rail / content width scale (task §13, §16, §15). */
export const layout = {
  siderWidth: 208,
  topbarHeight: 56,
  contentMaxWidth: 1680,
  contentPadding: 24,
  railExpandedWidth: 300,
  railBreakpointWide: 1600,
  railBreakpointNarrow: 1366,
} as const;
