export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
}

export interface PromptContext {
  selectedText?: string;
  surroundingPassage?: string;
  scene?: string;
  chapter?: string;
  codex?: string;
  instruction?: string;
}

export interface AIHistoryItem {
  id: string;
  at: string;
  templateName: string;
  model: string;
  includedContext: string[];
}

export const TEMPLATE_VARIABLES = [
  '{{selectedText}}',
  '{{surroundingPassage}}',
  '{{scene}}',
  '{{chapter}}',
  '{{codex}}',
  '{{instruction}}',
] as const;

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'continue',
    name: 'Continue passage',
    description: 'Continue in the same voice.',
    body: 'Continue the passage naturally in the same voice. Return only the proposed passage.\n\n{{surroundingPassage}}',
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm ideas',
    description: 'Explore possible directions.',
    body: 'Brainstorm several distinct possibilities for what could happen next. Do not write into the manuscript.\n\nScene: {{scene}}\n\nContext: {{surroundingPassage}}',
  },
  {
    id: 'rewrite',
    name: 'Rewrite selected text',
    description: 'Rewrite the selected passage using an instruction.',
    body: 'Rewrite the selected passage according to this instruction: {{instruction}}\nReturn only the rewritten passage.\n\n{{selectedText}}',
  },
  {
    id: 'clarity',
    name: 'Improve clarity',
    description: 'Suggest a clearer version.',
    body: 'Improve clarity and flow while preserving the meaning and voice. Return only the proposed revision.\n\n{{selectedText}}',
  },
  {
    id: 'continuity',
    name: 'Check continuity',
    description: 'Review selected story facts.',
    body: 'Check the manuscript context for possible continuity conflicts with the selected Codex facts. Do not rewrite it; explain any possible issue and cite the relevant fact.\n\nManuscript context:\n{{surroundingPassage}}\n\nSelected Codex facts:\n{{codex}}',
  },
  {
    id: 'summarize',
    name: 'Summarize scene',
    description: 'Summarize without changing text.',
    body: 'Summarize the following scene concisely.\n\n{{scene}}',
  },
  {
    id: 'editorial',
    name: 'Editorial feedback',
    description: 'Give feedback without rewriting.',
    body: 'Give concise editorial feedback on the following passage. Do not rewrite it. Focus on clarity, pacing, and reader understanding.\n\n{{selectedText}}',
  },
];

export function expandPrompt(template: string, context: PromptContext): string {
  return template.replace(
    /\{\{(selectedText|surroundingPassage|scene|chapter|codex|instruction)\}\}/g,
    (_match, key: string) => context[key as keyof PromptContext] ?? '',
  );
}

export function getContextLabels(context: PromptContext): string[] {
  const labels: string[] = [];
  if (context.selectedText?.trim()) labels.push('selected text');
  if (context.surroundingPassage?.trim()) labels.push('surrounding passage');
  if (context.scene?.trim()) labels.push('scene');
  if (context.chapter?.trim()) labels.push('chapter');
  if (context.codex?.trim()) labels.push('Codex entries');
  if (context.instruction?.trim()) labels.push('instruction');
  return labels;
}

export function safeInsertText(
  current: string,
  start: number,
  end: number,
  output: string,
  mode: 'insert' | 'replace',
): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = mode === 'replace' ? Math.max(from, Math.min(end, current.length)) : from;
  const text = current.slice(0, from) + output + current.slice(to);
  return { text, cursor: from + output.length };
}

export function contextForProvider(context: PromptContext): string[] {
  return [
    context.selectedText,
    context.surroundingPassage,
    context.scene,
    context.chapter,
    context.codex,
    context.instruction,
  ].filter((value): value is string => Boolean(value?.trim()));
}
