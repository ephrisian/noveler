import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WRITING_THEMES,
  exportWritingTheme,
  loadWritingThemes,
  parseWritingThemeImport,
  saveWritingThemes,
  validateWritingTheme,
} from './themes';

beforeEach(() => localStorage.clear());

describe('custom writing themes', () => {
  it('provides useful built-in writing themes', () => {
    expect(DEFAULT_WRITING_THEMES.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_WRITING_THEMES[0].fontFamily).toBe('Literata');
  });

  it('persists valid custom themes and loads them again', () => {
    const themes = [
      ...DEFAULT_WRITING_THEMES,
      { ...DEFAULT_WRITING_THEMES[0], id: 'custom', name: 'My page' },
    ];
    saveWritingThemes(themes);
    expect(loadWritingThemes()).toEqual(themes);
  });

  it('rejects duplicate IDs and more than 100 themes', () => {
    expect(() =>
      saveWritingThemes([DEFAULT_WRITING_THEMES[0], DEFAULT_WRITING_THEMES[0]]),
    ).toThrow(/invalid/);
    expect(() =>
      saveWritingThemes(
        Array.from({ length: 101 }, (_, index) => ({
          ...DEFAULT_WRITING_THEMES[0],
          id: `theme-${index}`,
        })),
      ),
    ).toThrow(/invalid/);
  });

  it('round trips exported themes and rejects invalid/oversized theme imports', () => {
    const exported = exportWritingTheme(DEFAULT_WRITING_THEMES[0]);
    expect(parseWritingThemeImport(exported)).toMatchObject({
      ...DEFAULT_WRITING_THEMES[0],
      id: expect.any(String),
    });
    expect(() =>
      parseWritingThemeImport(
        JSON.stringify({ format: 'other', version: 1, theme: DEFAULT_WRITING_THEMES[0] }),
      ),
    ).toThrow(/invalid or unsupported/);
    expect(() => parseWritingThemeImport('x'.repeat(50_001))).toThrow(/50 KB/);
  });

  it('falls back to built-in themes if stored theme data is invalid', () => {
    localStorage.setItem(
      'noveler-writing-themes',
      JSON.stringify([{ id: 'bad', background: 'url(javascript:alert(1))' }]),
    );
    expect(loadWritingThemes()).toEqual(DEFAULT_WRITING_THEMES);
  });

  it('falls back when stored IDs are duplicated or collection limits are exceeded', () => {
    localStorage.setItem(
      'noveler-writing-themes',
      JSON.stringify([DEFAULT_WRITING_THEMES[0], DEFAULT_WRITING_THEMES[0]]),
    );
    expect(loadWritingThemes()).toEqual(DEFAULT_WRITING_THEMES);
    localStorage.setItem(
      'noveler-writing-themes',
      JSON.stringify(
        Array.from({ length: 101 }, (_, index) => ({
          ...DEFAULT_WRITING_THEMES[0],
          id: `t-${index}`,
        })),
      ),
    );
    expect(loadWritingThemes()).toEqual(DEFAULT_WRITING_THEMES);
  });

  it('limits font choices and theme dimensions to validated values', () => {
    expect(
      validateWritingTheme({
        ...DEFAULT_WRITING_THEMES[0],
        fontFamily: 'url(https://evil.test/font)',
      }),
    ).toBe(false);
    expect(validateWritingTheme({ ...DEFAULT_WRITING_THEMES[0], fontSize: 200 })).toBe(
      false,
    );
  });

  it('has safe foreground/background contrast for built-in presets', () => {
    const luminance = (hex: string) => {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((value) => parseInt(value, 16) / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    for (const theme of DEFAULT_WRITING_THEMES) {
      const values = [luminance(theme.background), luminance(theme.foreground)].sort(
        (a, b) => b - a,
      );
      expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
