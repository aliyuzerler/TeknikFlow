import { tokens } from '@teknikflow/design-tokens';

/**
 * Mobil tema — değerler @teknikflow/design-tokens paketinden gelir
 * (tokens.css → üretilmiş tokens.ts). Elle kopya değer YOKTUR;
 * tokens.css değişirse senkron testi (design-tokens) keser.
 */
export const theme = {
  // Renkler
  ink950: tokens.color.ink950,
  ink900: tokens.color.ink900,
  ink800: tokens.color.ink800,
  blue700: tokens.color.blue700,
  blue600: tokens.color.blue600,
  blue100: tokens.color.blue100,
  teal700: tokens.color.teal700,
  teal600: tokens.color.teal600,
  canvas: tokens.color.canvas,
  surface: tokens.color.surface,
  text: tokens.color.text,
  muted: tokens.color.muted,
  border: tokens.color.border,
  success: tokens.color.success,
  successBg: tokens.color.successBg,
  warning: tokens.color.warning,
  warningBg: tokens.color.warningBg,
  danger: tokens.color.danger,
  dangerBg: tokens.color.dangerBg,
  info: tokens.color.info,
  infoBg: tokens.color.infoBg,
  // Yarıçap ve boşluk (StyleSheet değerleri)
  radiusSm: tokens.radius.sm,
  radiusMd: tokens.radius.md,
  radiusLg: tokens.radius.lg,
  space1: tokens.space.s1,
  space2: tokens.space.s2,
  space3: tokens.space.s3,
  space4: tokens.space.s4,
  space6: tokens.space.s6,
  space8: tokens.space.s8,
  // Tipografi boyutları
  textXs: tokens.text.xs,
  textSm: tokens.text.sm,
  textBase: tokens.text.base,
  textLg: tokens.text.lg,
  textXl: tokens.text.xl,
} as const;

export type Theme = typeof theme;
