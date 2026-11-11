import { describe, expect, it } from 'vitest';
import {
  countWords,
  documentFromPlainText,
  parseStoredContent,
  plainTextFromStoredContent,
  serializeEditorDocument,
} from './editorDocument';

describe('versioned editor document', () => {
  it('round-trips formatted TipTap JSON', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bright', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' idea' },
          ],
        },
      ],
    };

    expect(JSON.parse(serializeEditorDocument(document))).toEqual({
      version: 1,
      type: 'doc',
      content: document.content,
    });
    expect(parseStoredContent(serializeEditorDocument(document))).toEqual(document);
  });

  it('migrates existing plain text into paragraphs without losing blank lines', () => {
    expect(parseStoredContent('First line\n\nThird line')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Third line' }] },
      ],
    });
  });

  it('converts document text back for the controlled writing surface', () => {
    const serialized = serializeEditorDocument(documentFromPlainText('First\nSecond'));
    expect(plainTextFromStoredContent(serialized)).toBe('First\nSecond');
  });

  it('counts words across formatted paragraphs and lists', () => {
    expect(
      countWords({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One two' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(3);
  });
});
