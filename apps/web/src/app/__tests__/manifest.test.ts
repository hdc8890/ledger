import { describe, it, expect } from 'vitest';
import manifest from '../manifest';

describe('PWA manifest', () => {
  const m = manifest();

  it('declares an installable standalone app', () => {
    expect(m.name).toBe('Ledger — AI Financial OS');
    expect(m.short_name).toBe('Ledger');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('sets theme and background colors', () => {
    expect(m.theme_color).toBe('#0b1220');
    expect(m.background_color).toBe('#0b1220');
  });

  it('provides 192 and 512 icons', () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('provides both any and maskable purposes', () => {
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });

  it('points every icon at an existing png path', () => {
    for (const icon of m.icons ?? []) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/^\/icons\/.+\.png$/);
    }
  });
});
