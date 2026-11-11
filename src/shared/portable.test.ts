import { describe, expect, it } from 'vitest';
import {
  createDocxExport,
  parseManuscriptImport,
  parseManuscriptBuffer,
} from './portable';

function exportText(
  chapters: { title: string; scenes: { title: string; content: string }[] }[],
  format: 'markdown' | 'text',
) {
  return chapters
    .map((chapter) => {
      const chapterHeading =
        format === 'markdown'
          ? `# ${chapter.title}`
          : `${chapter.title}\n${'='.repeat(chapter.title.length)}`;
      const scenes = chapter.scenes.map((scene) =>
        format === 'markdown'
          ? `## ${scene.title}\n\n${scene.content}`
          : `${scene.title}\n\n${scene.content}`,
      );
      return [chapterHeading, ...scenes].join('\n\n');
    })
    .join('\n\n');
}

describe('predictable manuscript export formatting', () => {
  it('preserves chapter and scene ordering without adding app metadata', () => {
    const output = exportText(
      [
        {
          title: 'First',
          scenes: [
            { title: 'Dawn', content: 'The road opened.' },
            { title: 'Noon', content: 'A bell rang.' },
          ],
        },
        { title: 'Second', scenes: [{ title: 'Dusk', content: 'The harbor slept.' }] },
      ],
      'markdown',
    );
    expect(output.indexOf('# First')).toBeLessThan(output.indexOf('## Dawn'));
    expect(output.indexOf('## Dawn')).toBeLessThan(output.indexOf('## Noon'));
    expect(output.indexOf('## Noon')).toBeLessThan(output.indexOf('# Second'));
    expect(output.indexOf('# Second')).toBeLessThan(output.indexOf('## Dusk'));
    expect(output).not.toMatch(/createdAt|updatedAt|projectId|sceneId/);
  });

  it('exports plain text with simple headings in the same order', () => {
    const output = exportText(
      [{ title: 'Chapter', scenes: [{ title: 'Scene', content: 'Manuscript.' }] }],
      'text',
    );
    expect(output).toBe('Chapter\n=======\n\nScene\n\nManuscript.');
  });
});

describe('plain text and Markdown manuscript import preview', () => {
  it('maps Markdown chapter and scene headings and keeps the introduction', () => {
    const parsed = parseManuscriptImport(
      'Opening prose.\n\n# Chapter One\n\nFirst scene.\n\n## Arrival\n\nThey came ashore.',
      'draft.md',
    );
    expect(parsed.title).toBe('draft');
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Introduction',
      'Chapter One',
    ]);
    expect(parsed.chapters[0].scenes[0].content).toContain('Opening prose.');
    expect(parsed.chapters[1].scenes.map((scene) => scene.title)).toEqual([
      'Scene 1',
      'Arrival',
    ]);
  });

  it('creates a preview structure for plain text and rejects oversized imports', () => {
    expect(
      parseManuscriptImport('Plain prose', 'draft.txt').chapters[0].scenes[0].content,
    ).toBe('Plain prose');
    expect(() => parseManuscriptImport('x'.repeat(10_000_001), 'draft.txt')).toThrow(
      /10 MB/,
    );
  });

  it('exports a DOCX document and imports its headings and paragraphs', async () => {
    const blob = await createDocxExport(
      'Novel',
      '# Chapter One\n\nOpening paragraph.\n\n## Scene One\n\nThe scene begins.',
    );
    expect(blob.type).toContain('application/vnd.openxmlformats-officedocument');
    expect(blob.size).toBeGreaterThan(1000);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const mammothParser = {
      convertToHtml: async () => ({
        value:
          '<h1>Chapter One</h1><p>Opening paragraph.</p><h2>Scene One</h2><p>The scene begins.</p>',
      }),
    } as unknown as typeof import('mammoth');
    const imported = await parseManuscriptBuffer(buffer, 'roundtrip.docx', mammothParser);
    expect(imported.chapters[0].title).toBe('Chapter One');
    expect(imported.chapters[0].scenes.map((scene) => scene.title)).toContain(
      'Scene One',
    );
  });
});
