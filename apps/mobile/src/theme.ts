/**
 * Mobil tema — packages/design-tokens/tokens.css ile aynı değerler.
 * React Native CSS değişkeni okuyamaz; renkler burada koda gömülür ve
 * Faz 02'de (marka sistemi) otomatik eşitleme değerlendirilir.
 */
export const theme = {
  ink950: '#132238',
  ink900: '#192B43',
  blue700: '#1D4ED8',
  blue600: '#2563EB',
  canvas: '#F5F7FA',
  surface: '#FFFFFF',
  text: '#172033',
  muted: '#64748B',
  border: '#E2E8F0',
  success: '#15803D',
  successBg: '#DCFCE7',
} as const;
