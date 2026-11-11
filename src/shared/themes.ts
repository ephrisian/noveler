export interface WritingTheme {
  id: string;
  name: string;
  background: string;
  foreground: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  headingFontFamily?: string;
  sceneDivider?: 'line' | 'ornament' | 'simple';
}

export const DEFAULT_WRITING_THEMES: WritingTheme[] = [
  {
    id: 'paper',
    name: 'Warm Paper',
    background: '#fffefa',
    foreground: '#292820',
    fontFamily: 'Literata',
    fontSize: 18,
    lineHeight: 1.8,
    contentWidth: 760,
  },
  {
    id: 'classic',
    name: 'Classic',
    background: '#ffffff',
    foreground: '#282a27',
    fontFamily: 'Literata',
    fontSize: 18,
    lineHeight: 1.75,
    contentWidth: 760,
  },
  {
    id: 'night',
    name: 'Night Reader',
    background: '#202421',
    foreground: '#e4e7df',
    fontFamily: 'Literata',
    fontSize: 18,
    lineHeight: 1.8,
    contentWidth: 760,
  },
];

export const WRITING_FONTS = [
  'Literata',
  'Source Serif 4',
  'Atkinson Hyperlegible',
  'System UI',
] as const;

export const SCENE_DIVIDERS = ['line', 'ornament', 'simple'] as const;

export function validateWritingTheme(value: unknown): value is WritingTheme {
  if (!value || typeof value !== 'object') return false;
  const theme = value as Partial<WritingTheme>;
  return (
    typeof theme.id === 'string' &&
    theme.id.length > 0 &&
    theme.id.length <= 80 &&
    typeof theme.name === 'string' &&
    theme.name.trim().length > 0 &&
    theme.name.length <= 80 &&
    typeof theme.background === 'string' &&
    /^#[\da-f]{6}$/i.test(theme.background) &&
    typeof theme.foreground === 'string' &&
    /^#[\da-f]{6}$/i.test(theme.foreground) &&
    typeof theme.fontFamily === 'string' &&
    WRITING_FONTS.includes(theme.fontFamily as (typeof WRITING_FONTS)[number]) &&
    typeof theme.fontSize === 'number' &&
    theme.fontSize >= 14 &&
    theme.fontSize <= 32 &&
    typeof theme.lineHeight === 'number' &&
    theme.lineHeight >= 1.2 &&
    theme.lineHeight <= 2.4 &&
    typeof theme.contentWidth === 'number' &&
    theme.contentWidth >= 480 &&
    theme.contentWidth <= 1200 &&
    (theme.headingFontFamily === undefined ||
      WRITING_FONTS.includes(
        theme.headingFontFamily as (typeof WRITING_FONTS)[number],
      )) &&
    (theme.sceneDivider === undefined || SCENE_DIVIDERS.includes(theme.sceneDivider))
  );
}

export function contrastRatio(background: string, foreground: string): number {
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
  const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function loadWritingThemes(): WritingTheme[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem('noveler-writing-themes') ?? 'null',
    );
    if (
      Array.isArray(stored) &&
      stored.length > 0 &&
      stored.length <= 100 &&
      stored.every(validateWritingTheme) &&
      new Set(stored.map((theme) => theme.id)).size === stored.length
    )
      return stored;
  } catch {
    // Invalid or unavailable preferences fall back to built-ins.
  }
  return DEFAULT_WRITING_THEMES.map((theme) => ({ ...theme }));
}

export function saveWritingThemes(themes: WritingTheme[]): void {
  if (
    themes.length === 0 ||
    themes.length > 100 ||
    !themes.every(validateWritingTheme) ||
    new Set(themes.map((theme) => theme.id)).size !== themes.length
  )
    throw new Error('Theme settings are invalid.');
  localStorage.setItem('noveler-writing-themes', JSON.stringify(themes));
}

export function exportWritingTheme(theme: WritingTheme): string {
  if (!validateWritingTheme(theme)) throw new Error('Theme settings are invalid.');
  return JSON.stringify({ format: 'noveler-theme', version: 1, theme }, null, 2);
}

export function parseWritingThemeImport(text: string): WritingTheme {
  if (text.length > 50_000) throw new Error('Theme files must be 50 KB or smaller.');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Theme file is invalid.');
  const envelope = parsed as { format?: unknown; version?: unknown; theme?: unknown };
  if (
    envelope.format !== 'noveler-theme' ||
    envelope.version !== 1 ||
    !validateWritingTheme(envelope.theme)
  ) {
    throw new Error('This theme file is invalid or unsupported.');
  }
  return { ...envelope.theme, id: crypto.randomUUID() };
}
