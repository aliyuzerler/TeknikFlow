import { describe, expect, it } from 'vitest';
import { PLANNED_COMPONENTS, UI_WEB_PHASE } from './index.js';

describe('ui-web yer tutucu', () => {
  it('paket Faz 02 için işaretlidir', () => {
    expect(UI_WEB_PHASE).toBe('phase-02');
  });
  it('planlanan bileşen listesi benzersizdir', () => {
    expect(new Set(PLANNED_COMPONENTS).size).toBe(PLANNED_COMPONENTS.length);
  });
});
