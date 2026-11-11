import { invoke } from '@tauri-apps/api/core';
import type { Project } from './contracts';

export interface SearchResult {
  kind: 'project' | 'chapter' | 'scene' | 'codex';
  projectId: string;
  projectTitle: string;
  title: string;
  snippet: string;
  chapterId: string | null;
  sceneId: string | null;
  codexEntryId: string | null;
}

export type ManuscriptFormat = 'markdown' | 'text';

export interface ManuscriptImport {
  title: string;
  chapters: { title: string; scenes: { title: string; content: string }[] }[];
}

export function parseManuscriptImport(text: string, filename: string): ManuscriptImport {
  if (text.length > 10_000_000) throw new Error('Import files must be 10 MB or smaller.');
  const markdown = /\.md(?:own)?$/i.test(filename);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const projectTitle = filename.replace(/\.[^.]+$/, '').trim() || 'Imported manuscript';
  const chapters: ManuscriptImport['chapters'] = [];
  let currentChapter: ManuscriptImport['chapters'][number] | null = null;
  let currentScene: { title: string; content: string } | null = null;
  let body: string[] = [];
  const preamble: string[] = [];
  const flushScene = () => {
    if (!currentScene || !currentChapter) return;
    currentScene.content = body.join('\n').trim();
    currentChapter.scenes.push(currentScene);
    currentScene = null;
    body = [];
  };
  const startChapter = (title: string) => {
    flushScene();
    currentChapter = {
      title: title.trim() || `Chapter ${chapters.length + 1}`,
      scenes: [],
    };
    chapters.push(currentChapter);
  };
  for (const line of lines) {
    const heading = markdown
      ? /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line)
      : /^Chapter\s+(.+)$/i.exec(line.trim());
    if (heading) {
      if (markdown && heading[1].length === 1) startChapter(heading[2]);
      else if (markdown && heading[1].length === 2) {
        if (!currentChapter) startChapter('Chapter 1');
        flushScene();
        currentScene = { title: heading[2].trim(), content: '' };
        body = [];
      } else if (!markdown) {
        startChapter(heading[1]);
      }
      continue;
    }
    if (!currentChapter) {
      if (markdown && line.trim()) preamble.push(line);
      continue;
    }
    if (!currentScene) currentScene = { title: 'Scene 1', content: '' };
    body.push(line);
  }
  flushScene();
  if (!chapters.length)
    chapters.push({
      title: 'Chapter 1',
      scenes: [{ title: 'Scene 1', content: text.trim() }],
    });
  else if (preamble.length)
    chapters.unshift({
      title: 'Introduction',
      scenes: [{ title: 'Scene 1', content: preamble.join('\n').trim() }],
    });
  for (const chapter of chapters)
    if (!chapter.scenes.length) chapter.scenes.push({ title: 'Scene 1', content: '' });
  return { title: projectTitle, chapters };
}

export async function parseManuscriptFile(file: File): Promise<ManuscriptImport> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Import files must be 10 MB or smaller.');
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import('mammoth');
    return parseManuscriptBuffer(await readFileBuffer(file), file.name, mammoth);
  }
  if (!/\.(md|markdown|txt)$/i.test(file.name))
    throw new Error('Choose a Markdown, plain-text, or DOCX file.');
  const text = new TextDecoder().decode(await readFileBuffer(file));
  return parseManuscriptImport(text, file.name);
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read import file.'));
    reader.readAsArrayBuffer(file);
  });
}

export async function parseManuscriptBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mammothParser?: typeof import('mammoth'),
): Promise<ManuscriptImport> {
  if (buffer.byteLength > 10 * 1024 * 1024)
    throw new Error('Import files must be 10 MB or smaller.');
  if (!/\.docx$/i.test(filename)) throw new Error('Choose a DOCX file.');
  const mammoth = mammothParser ?? (await import('mammoth')).default;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
  const document = new DOMParser().parseFromString(result.value, 'text/html');
  const lines = [...document.body.children].map((element) => {
    const text = element.textContent?.trim() ?? '';
    if (element.tagName === 'H1') return `# ${text}`;
    if (element.tagName === 'H2') return `## ${text}`;
    return text;
  });
  return parseManuscriptImport(lines.join('\n\n'), 'import.md');
}

export async function createDocxExport(title: string, markdown: string): Promise<Blob> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const paragraphs: import('docx').Paragraph[] = [];
  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,2})\s+(.+)$/.exec(line);
    if (heading)
      paragraphs.push(
        new Paragraph({
          text: heading[2],
          heading:
            heading[1].length === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        }),
      );
    else if (/^\s*[-*+]\s+/.test(line))
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^\s*[-*+]\s+/, ''),
          bullet: { level: 0 },
        }),
      );
    else if (/^\s*\d+\.\s+/.test(line))
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^\s*\d+\.\s+/, ''),
          numbering: { reference: 'ordered-list', level: 0 },
        }),
      );
    else if (line.trim())
      paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
    else paragraphs.push(new Paragraph({ text: '' }));
  }
  const document = new Document({
    title,
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: 'left',
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });
  return Packer.toBlob(document);
}

export const portableService = {
  parseManuscriptFile: (file: File) => parseManuscriptFile(file),
  search: (query: string) => invoke<SearchResult[]>('search_everything', { query }),
  exportManuscript: (projectId: string, format: ManuscriptFormat) =>
    invoke<string>('export_manuscript', { projectId, format }),
  exportBackup: (projectId: string) =>
    invoke<string>('export_project_backup', { projectId }),
  restoreBackup: (payload: string, replaceProjectId: string | null) =>
    invoke<Project>('restore_project_backup', { payload, replaceProjectId }),
  importManuscript: (input: ManuscriptImport) =>
    invoke<Project>('import_manuscript', { input }),
};
