import type { JSONContent } from '@tiptap/core';

export const EDITOR_DOCUMENT_VERSION = 1;

export interface StoredEditorDocument {
  version: number;
  type: 'doc';
  content: JSONContent[];
}

export function parseStoredContent(value: string): JSONContent {
  if (value.trim().length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (isStoredDocument(parsed)) {
      return { type: 'doc', content: parsed.content };
    }
    if (isTipTapDocument(parsed)) return parsed;
  } catch {
    // Content written by earlier builds was plain text. Preserve it as paragraphs.
  }

  return {
    type: 'doc',
    content: value.split(/\n/).map((text) => ({
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    })),
  };
}

export function serializeEditorDocument(document: JSONContent): string {
  const stored: StoredEditorDocument = {
    version: EDITOR_DOCUMENT_VERSION,
    type: 'doc',
    content: document.content ?? [],
  };
  return JSON.stringify(stored);
}

export function documentFromPlainText(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

export function plainTextFromStoredContent(value: string): string {
  return plainText(parseStoredContent(value));
}

export function contentForEditor(value: string): JSONContent {
  return parseStoredContent(value);
}

export function countWords(document: JSONContent): number {
  const text = collectText(document).trim();
  return text ? text.split(/\s+/u).filter(Boolean).length : 0;
}

function collectText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? [])
    .map(collectText)
    .join(node.type === 'paragraph' || node.type === 'heading' ? ' ' : '\n');
}

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? [])
    .map(plainText)
    .join(node.type === 'paragraph' || node.type === 'heading' ? '\n' : '\n');
}

function isStoredDocument(value: unknown): value is StoredEditorDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredEditorDocument>;
  return (
    candidate.type === 'doc' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.content)
  );
}

function isTipTapDocument(value: unknown): value is JSONContent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<JSONContent>;
  return candidate.type === 'doc' && Array.isArray(candidate.content);
}
