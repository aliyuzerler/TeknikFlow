import { tokens } from '@teknikflow/design-tokens';

/**
 * Mobil tema — değerler @teknikflow/design-tokens paketinden gelir
 * (tokens.css → üretilmiş tokens.ts). Elle kopya değer YOKTUR;
 * tokens.css değişirse senkron testi (design-tokens) keser.
 *
 * CSS px dizgileri React Native sayılarına çevrilir (RN px = dp birimi).
 */

function px(value: string): number {
  return Number.parseFloat(value);
}

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
  surfaceAlt: tokens.color.surfaceAlt,
  text: tokens.color.text,
  muted: tokens.color.muted,
  border: tokens.color.border,
  borderSoft: tokens.color.borderSoft,
  success: tokens.color.success,
  successBg: tokens.color.successBg,
  warning: tokens.color.warning,
  warningBg: tokens.color.warningBg,
  danger: tokens.color.danger,
  dangerBg: tokens.color.dangerBg,
  info: tokens.color.info,
  infoBg: tokens.color.infoBg,
  attention: tokens.color.attention,
  // Faz 03 semantik yardımcıları
  placeholder: tokens.color.placeholder,
  separator: tokens.color.separator,
  subtle: tokens.color.subtle,
  bgSubtle: tokens.color.bgSubtle,
  bgQuiet: tokens.color.bgQuiet,
  textStrong: tokens.color.textStrong,
  onAccent: tokens.color.onAccent,
  dotSuccess: tokens.color.dotSuccess,
  dotWarning: tokens.color.dotWarning,
  dotDanger: tokens.color.dotDanger,
  // Yarıçap ve boşluk (RN sayıları)
  radiusSm: px(tokens.radius.sm),
  radiusMd: px(tokens.radius.md),
  radiusLg: px(tokens.radius.lg),
  space1: px(tokens.space.s1),
  space2: px(tokens.space.s2),
  space3: px(tokens.space.s3),
  space4: px(tokens.space.s4),
  space6: px(tokens.space.s6),
  space8: px(tokens.space.s8),
  // Tipografi boyutları (RN sayıları)
  textXs: px(tokens.text.xs),
  textSm: px(tokens.text.sm),
  textBase: px(tokens.text.base),
  textMd: px(tokens.text.md),
  textLg: px(tokens.text.lg),
  textXl: px(tokens.text.xl),
} as const;

export type Theme = typeof theme;
