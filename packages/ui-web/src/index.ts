/**
 * Faz 01 yer tutucusu. Somut bileşenler Faz 02'de (marka sistemi, UI shell ve
 * Storybook) tasarım token'larıyla birlikte eklenir; burada yalnızca paketin
 * varlığı ve plan kaydı tutulur.
 */
export const UI_WEB_PHASE = 'phase-02' as const;

export const PLANNED_COMPONENTS = [
  'Button',
  'StatusBadge',
  'DataTable',
  'Dialog',
  'FormField',
  'Toast',
] as const;
