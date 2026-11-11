import { describe, expect, it } from 'vitest';
import { buildCodexSuggestionPrompt, parseCodexSuggestions } from './codexSuggestions';

describe('reviewed Codex suggestions', () => {
  it('builds an explicit extraction prompt from the provided scope only', () => {
    const prompt = buildCodexSuggestionPrompt('A silver key.', 'Scene 1');
    expect(prompt).toContain('A silver key.');
    expect(prompt).toContain('Scene 1');
    expect(prompt).toContain('Return only a JSON object');
  });

  it('parses valid suggestions and associates selected source scenes', () => {
    const result = parseCodexSuggestions(
      JSON.stringify({
        suggestions: [
          {
            kind: 'item',
            title: 'Silver key',
            description: 'Opens the archive.',
            tags: ['important', 'important'],
            fields: { material: 'silver' },
            evidence: 'silver key',
          },
        ],
      }),
      ['scene-1', 'scene-2'],
    );
    expect(result).toEqual([
      {
        kind: 'item',
        title: 'Silver key',
        description: 'Opens the archive.',
        tags: ['important'],
        fields: { material: 'silver' },
        evidence: 'silver key',
        sceneIds: ['scene-1', 'scene-2'],
      },
    ]);
  });

  it('rejects malformed response shapes and excessive suggestions', () => {
    expect(() => parseCodexSuggestions('not json', [])).toThrow();
    expect(() =>
      parseCodexSuggestions(JSON.stringify({ suggestions: Array(101).fill({}) }), []),
    ).toThrow(/too many/);
  });

  it('bounds response and structured field sizes', () => {
    expect(() => parseCodexSuggestions(' '.repeat(100_001), [])).toThrow(/too large/);
    const hugeField = 'x'.repeat(20_001);
    expect(
      parseCodexSuggestions(
        JSON.stringify({
          suggestions: [
            {
              kind: 'general',
              title: 'Huge',
              fields: { note: hugeField },
            },
          ],
        }),
        [],
      ),
    ).toEqual([]);
  });

  it('ignores unsupported kinds and missing titles', () => {
    expect(
      parseCodexSuggestions(
        JSON.stringify({
          suggestions: [
            { kind: 'unsupported', title: 'Nope' },
            { kind: 'character', title: '  ' },
          ],
        }),
        ['source'],
      ),
    ).toEqual([]);
  });
});
