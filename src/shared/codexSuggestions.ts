import type { CodexEntryKind } from './contracts';

export interface CodexSuggestion {
  kind: CodexEntryKind;
  title: string;
  description: string;
  tags: string[];
  fields: Record<string, unknown>;
  evidence: string;
  sceneIds: string[];
  duplicateTitle?: string;
}

const allowedKinds = new Set<CodexEntryKind>([
  'character',
  'location',
  'item',
  'general',
]);

export function buildCodexSuggestionPrompt(text: string, sourceLabel: string): string {
  return [
    'Extract candidate story-reference facts for a writer to review. Return only a JSON object with a "suggestions" array.',
    'Each item must have kind (character, location, item, or general), title, description, tags (string array), fields (object), and evidence (short exact excerpt). Do not invent facts. Use only facts supported by the supplied text. Do not include markdown fences.',
    `Source: ${sourceLabel}`,
    'Manuscript text:',
    text,
  ].join('\n\n');
}

export function parseCodexSuggestions(
  response: string,
  sceneIds: string[],
): CodexSuggestion[] {
  if (response.length > 100_000) {
    throw new Error('The AI response is too large to review safely.');
  }
  const normalized = response.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  const value: unknown = JSON.parse(normalized);
  if (!value || typeof value !== 'object' || !('suggestions' in value)) {
    throw new Error('The AI response did not contain a suggestions list.');
  }
  const candidates = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(candidates)) {
    throw new Error('The AI response suggestions must be a list.');
  }
  if (candidates.length > 100) {
    throw new Error(
      'The response contains too many suggestions. Analyze a smaller section.',
    );
  }
  return candidates.flatMap((candidate): CodexSuggestion[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const kind = item.kind;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
    const description =
      typeof item.description === 'string' ? item.description.slice(0, 10_000) : '';
    const fields =
      item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
        ? (item.fields as Record<string, unknown>)
        : {};
    if (typeof kind !== 'string' || !allowedKinds.has(kind as CodexEntryKind) || !title)
      return [];
    let fieldsJson = '';
    try {
      fieldsJson = JSON.stringify(fields);
    } catch {
      return [];
    }
    if (fieldsJson.length > 20_000) return [];
    return [
      {
        kind: kind as CodexEntryKind,
        title,
        description,
        tags: Array.isArray(item.tags)
          ? [
              ...new Set(
                item.tags
                  .filter((tag): tag is string => typeof tag === 'string')
                  .map((tag) => tag.trim().slice(0, 80))
                  .filter(Boolean),
              ),
            ].slice(0, 30)
          : [],
        fields,
        evidence: typeof item.evidence === 'string' ? item.evidence.slice(0, 2_000) : '',
        sceneIds: [...new Set(sceneIds)].slice(0, 200),
      },
    ];
  });
}
