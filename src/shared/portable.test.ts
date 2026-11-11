import { describe, expect, it } from 'vitest';

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
