import { describe, expect, it } from 'vitest';
import {
  contextForProvider,
  expandPrompt,
  getContextLabels,
  safeInsertText,
} from './aiPrompts';
import { DEFAULT_PROMPT_TEMPLATES } from './aiPrompts';

describe('AI prompt assembly safeguards', () => {
  it('expands only documented variables and leaves missing context blank', () => {
    expect(
      expandPrompt('Selected: {{selectedText}} / {{instruction}} / {{unknown}}', {
        selectedText: 'A red door.',
      }),
    ).toBe('Selected: A red door. /  / {{unknown}}');
  });

  it('reports exactly which context sections will be included', () => {
    expect(
      getContextLabels({
        selectedText: 'line',
        scene: 'whole scene',
        codex: 'Mira facts',
      }),
    ).toEqual(['selected text', 'scene', 'Codex entries']);
    expect(getContextLabels({ selectedText: ' ', codex: '' })).toEqual([]);
  });

  it('inserts or replaces output only at the explicit accepted range', () => {
    expect(safeInsertText('The old sentence.', 4, 7, 'new', 'replace')).toEqual({
      text: 'The new sentence.',
      cursor: 7,
    });
    expect(safeInsertText('A passage', 2, 8, 'aside', 'insert')).toEqual({
      text: 'A asidepassage',
      cursor: 7,
    });
    expect(safeInsertText('Keep untouched', 0, 4, 'ignored', 'insert').text).toBe(
      'ignoredKeep untouched',
    );
  });

  it('includes concrete user-facing templates for the requested writing tasks', () => {
    expect(DEFAULT_PROMPT_TEMPLATES.map((template) => template.id)).toEqual([
      'continue',
      'brainstorm',
      'rewrite',
      'clarity',
      'continuity',
      'summarize',
      'editorial',
    ]);
    expect(
      DEFAULT_PROMPT_TEMPLATES.find((template) => template.id === 'continuity')?.body,
    ).toContain('{{codex}}');
  });

  it('does not treat an unknown placeholder as context or silently expand it', () => {
    expect(expandPrompt('Keep {{unknown}} literal.', {})).toBe(
      'Keep {{unknown}} literal.',
    );
    expect(
      getContextLabels({
        selectedText: '',
        surroundingPassage: '',
        scene: '',
        chapter: '',
        codex: '',
        instruction: '',
      }),
    ).toEqual([]);
  });

  it('sends only context the user left enabled in the reviewed prompt builder', () => {
    expect(
      contextForProvider({ selectedText: 'chosen', scene: '', codex: 'selected fact' }),
    ).toEqual(['chosen', 'selected fact']);
  });

  it('requires a selected passage only when a template references selectedText', () => {
    const rewrite = DEFAULT_PROMPT_TEMPLATES.find(
      (template) => template.id === 'rewrite',
    )!;
    const brainstorm = DEFAULT_PROMPT_TEMPLATES.find(
      (template) => template.id === 'brainstorm',
    )!;
    expect(rewrite.body.includes('{{selectedText}}')).toBe(true);
    expect(brainstorm.body.includes('{{selectedText}}')).toBe(false);
  });
});
