import { useEffect, useMemo, useRef, useState } from 'react';
import { aiService } from '../shared/ai';
import {
  DEFAULT_PROMPT_TEMPLATES,
  expandPrompt,
  getContextLabels,
  safeInsertText,
  TEMPLATE_VARIABLES,
  type AIHistoryItem,
  type PromptContext,
  type PromptTemplate,
} from '../shared/aiPrompts';
import type { CodexEntry, Scene } from '../shared/contracts';

interface AiWritingPanelProps {
  scene: Scene;
  sceneText: string;
  chapterTitle: string;
  chapterText: string;
  projectText: string;
  selection: { start: number; end: number; text: string };
  codexEntries: CodexEntry[];
  templates: PromptTemplate[];
  history: AIHistoryItem[];
  onSaveTemplates: (templates: PromptTemplate[]) => Promise<void>;
  onSaveHistory: (item: AIHistoryItem) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onSelectionChange: (selection: { start: number; end: number; text: string }) => void;
  onApply: (text: string) => void;
  onClose: () => void;
}

type Tab = 'request' | 'templates' | 'history';

export default function AiWritingPanel(props: AiWritingPanelProps) {
  const [tab, setTab] = useState<Tab>('request');
  const [savedTemplates, setSavedTemplates] = useState<PromptTemplate[]>(
    props.templates.length ? props.templates : DEFAULT_PROMPT_TEMPLATES,
  );
  const [templateId, setTemplateId] = useState(DEFAULT_PROMPT_TEMPLATES[0].id);
  const [instruction, setInstruction] = useState('');
  const [includeSelection, setIncludeSelection] = useState(Boolean(props.selection.text));
  const [includeSurrounding, setIncludeSurrounding] = useState(true);
  const [includeScene, setIncludeScene] = useState(true);
  const [includeChapter, setIncludeChapter] = useState(false);
  const [includeCodex, setIncludeCodex] = useState(false);
  const [codexIds, setCodexIds] = useState<string[]>([]);
  const [assembledPrompt, setAssembledPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const requestActive = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [promptEdited, setPromptEdited] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
    focusable()?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
    // Modal lifetime controls focus; cancel is intentionally stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templates = savedTemplates;
  const selectedTemplate = templateId
    ? templates.find((template) => template.id === templateId)
    : undefined;
  const selectedCodex = props.codexEntries.filter((entry) => codexIds.includes(entry.id));
  const sceneTitle = props.scene.title;

  const context: PromptContext = useMemo(
    () => ({
      selectedText: includeSelection ? props.selection.text : '',
      surroundingPassage: includeSurrounding ? props.sceneText : '',
      scene: includeScene ? sceneTitle : '',
      chapter: includeChapter ? `${props.chapterTitle}\n${props.chapterText}` : '',
      codex: includeCodex
        ? selectedCodex
            .map(
              (entry) =>
                `${entry.kind}: ${entry.title}\n${entry.description}${Object.keys(entry.fields).length ? `\n${JSON.stringify(entry.fields)}` : ''}`,
            )
            .join('\n\n')
        : '',
      instruction,
    }),
    [
      includeSelection,
      includeSurrounding,
      includeScene,
      includeChapter,
      includeCodex,
      props.selection.text,
      props.sceneText,
      props.chapterTitle,
      props.chapterText,
      selectedCodex,
      instruction,
      sceneTitle,
    ],
  );

  const contextLabels = getContextLabels(context);

  useEffect(() => {
    setSavedTemplates(
      props.templates.length ? props.templates : DEFAULT_PROMPT_TEMPLATES,
    );
  }, [props.templates]);

  useEffect(() => {
    if (templates.length && !templates.some((template) => template.id === templateId)) {
      setTemplateId(templates[0].id);
    }
  }, [templates, templateId]);

  useEffect(() => {
    if (!templateId || !selectedTemplate || response || promptEdited || requestSent)
      return;
    setAssembledPrompt(expandPrompt(selectedTemplate.body, context));
  }, [templateId, selectedTemplate, context, response, promptEdited, requestSent]);

  const persistTemplates = async (next: PromptTemplate[]) => {
    setError('');
    await props.onSaveTemplates(next);
    setSavedTemplates(next);
  };

  const send = async () => {
    if (!assembledPrompt.trim()) {
      setError(
        'The assembled prompt is empty. Add instructions or context before sending.',
      );
      return;
    }
    if (assembledPrompt.length > 200_000) {
      setError(
        'The assembled prompt is too long to send (limit: 200,000 characters). Remove some context and try again.',
      );
      return;
    }
    if (
      templateId &&
      selectedTemplate?.body.includes('{{selectedText}}') &&
      !context.selectedText?.trim()
    ) {
      setError(
        'This template requires selected text. Select a passage or choose another template.',
      );
      return;
    }
    setBusy(true);
    setRequestInFlight(true);
    requestActive.current = true;
    setError('');
    setStatus('Sending only the prompt shown below to your configured provider…');
    setResponse('');
    setRequestSent(true);
    try {
      const result = await aiService.chat({
        messages: [{ role: 'user', content: assembledPrompt }],
        maxTokens: 1200,
      });
      if (!requestActive.current) return;
      setResponse(result.text);
      setStatus(`Response received from ${result.model}. Review it before using it.`);
      const item: AIHistoryItem = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        templateName: selectedTemplate?.name ?? 'Custom prompt',
        model: result.model,
        includedContext: contextLabels,
      };
      try {
        await props.onSaveHistory(item);
      } catch {
        setStatus(
          `Response received from ${result.model}. History could not be saved; the response remains only in this preview.`,
        );
      }
    } catch (cause) {
      setStatus('');
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      setRequestInFlight(false);
    }
  };

  const saveTemplate = async () => {
    const normalizedName = templateName.trim();
    if (!normalizedName || !templateBody.trim()) {
      setError('A template name and prompt body are required.');
      return;
    }
    const id = editingTemplateId ?? crypto.randomUUID();
    const nextTemplate = {
      id,
      name: normalizedName,
      description: templateDescription.trim(),
      body: templateBody,
    };
    try {
      const next = editingTemplateId
        ? templates.map((template) => (template.id === id ? nextTemplate : template))
        : [...templates, nextTemplate];
      await persistTemplates(next);
      setTemplateId(id);
      setEditingTemplateId(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const editTemplate = (template: PromptTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setTemplateBody(template.body);
  };

  const duplicateTemplate = async (template: PromptTemplate) => {
    const copy = { ...template, id: crypto.randomUUID(), name: `${template.name} copy` };
    try {
      await persistTemplates([...templates, copy]);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const deleteTemplate = async (template: PromptTemplate) => {
    if (!window.confirm(`Delete prompt template “${template.name}”?`)) return;
    const next = templates.filter((item) => item.id !== template.id);
    try {
      await persistTemplates(next);
      if (templateId === template.id) setTemplateId(next[0]?.id ?? '');
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const clearHistory = async () => {
    if (
      !window.confirm(
        'Clear local AI interaction history? Prompt and response text are not stored there.',
      )
    )
      return;
    try {
      await props.onClearHistory();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const applyResponse = (mode: 'insert' | 'replace') => {
    const result = safeInsertText(
      props.sceneText,
      props.selection.start,
      props.selection.end,
      response,
      mode,
    );
    props.onApply(result.text);
    setStatus(
      mode === 'insert'
        ? 'Response inserted into the scene. Autosave will store your change.'
        : 'Selected passage replaced. Autosave will store your change.',
    );
    setResponse('');
    if (mode === 'replace')
      props.onSelectionChange({ start: result.cursor, end: result.cursor, text: '' });
  };

  const copyResponse = async () => {
    try {
      await navigator.clipboard.writeText(response);
      setStatus('Response copied to clipboard.');
    } catch {
      setError('Clipboard access is unavailable. Select and copy the preview manually.');
    }
  };

  const cancel = () => {
    requestActive.current = false;
    setBusy(false);
    if (requestInFlight) {
      setStatus(
        'Stopped waiting. The provider may still finish processing this request; its response will be discarded and never applied automatically.',
      );
    }
    props.onClose();
  };

  return (
    <div className="ai-modal-backdrop">
      <section
        ref={dialogRef}
        className="ai-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
      >
        <header className="ai-modal-header">
          <div>
            <span className="eyebrow">OPTIONAL · USER-INITIATED</span>
            <h2 id="ai-dialog-title">Writing assistant</h2>
            <p>Only the context you review and send below leaves this device.</p>
          </div>
          <button className="text-button" onClick={cancel} type="button">
            Close
          </button>
        </header>
        <nav className="ai-tabs" aria-label="Writing assistant sections">
          <button
            aria-current={tab === 'request' ? 'page' : undefined}
            onClick={() => setTab('request')}
            type="button"
          >
            Request
          </button>
          <button
            aria-current={tab === 'templates' ? 'page' : undefined}
            onClick={() => setTab('templates')}
            type="button"
          >
            Prompt templates
          </button>
          <button
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => setTab('history')}
            type="button"
          >
            History
          </button>
        </nav>
        {tab === 'request' && (
          <div className="ai-request-body">
            {!response ? (
              <>
                <label>
                  Action / template
                  <select
                    value={templateId}
                    onChange={(event) => {
                      setTemplateId(event.target.value);
                      setPromptEdited(false);
                      setRequestSent(false);
                      setAssembledPrompt('');
                      setError('');
                    }}
                  >
                    <option value="">Custom prompt</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplate?.body.includes('{{instruction}}') && (
                  <label>
                    Instruction
                    <input
                      value={instruction}
                      onChange={(event) => {
                        setInstruction(event.target.value);
                        setPromptEdited(false);
                        setRequestSent(false);
                      }}
                      placeholder="What should the rewrite focus on?"
                    />
                  </label>
                )}
                <fieldset className="ai-context-options">
                  <legend>Context to include</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeSelection}
                      disabled={!props.selection.text}
                      onChange={(event) => {
                        setIncludeSelection(event.target.checked);
                        setRequestSent(false);
                      }}
                    />{' '}
                    Selected text{' '}
                    {!props.selection.text && (
                      <small>(select text in the scene first)</small>
                    )}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeSurrounding}
                      onChange={(event) => {
                        setIncludeSurrounding(event.target.checked);
                        setRequestSent(false);
                      }}
                    />{' '}
                    Current scene text
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeScene}
                      onChange={(event) => {
                        setIncludeScene(event.target.checked);
                        setRequestSent(false);
                      }}
                    />{' '}
                    Scene title
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeChapter}
                      onChange={(event) => {
                        setIncludeChapter(event.target.checked);
                        setRequestSent(false);
                      }}
                    />{' '}
                    Chapter title and text
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeCodex}
                      onChange={(event) => {
                        setIncludeCodex(event.target.checked);
                        setRequestSent(false);
                      }}
                      disabled={!selectedCodex.length}
                    />{' '}
                    Selected Codex entries{' '}
                    {selectedCodex.length === 0 && <small>(choose entries below)</small>}
                  </label>
                  {props.codexEntries.length > 0 && (
                    <div className="ai-codex-choices">
                      {props.codexEntries.map((entry) => (
                        <label key={entry.id}>
                          <input
                            type="checkbox"
                            checked={codexIds.includes(entry.id)}
                            onChange={(event) => {
                              setCodexIds((ids) =>
                                event.target.checked
                                  ? [...new Set([...ids, entry.id])]
                                  : ids.filter((id) => id !== entry.id),
                              );
                              setRequestSent(false);
                            }}
                          />{' '}
                          {entry.title}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <div className="ai-context-summary">
                  <strong>Included context:</strong>{' '}
                  {contextLabels.length ? contextLabels.join(', ') : 'none'}{' '}
                  <span>· {assembledPrompt.length.toLocaleString()} characters</span>
                </div>
                {assembledPrompt.length > 80_000 && (
                  <p className="ai-warning" role="status">
                    This is a large context. The provider may reject it or charge more.
                  </p>
                )}
                <label>
                  Exact prompt to send
                  <textarea
                    aria-label="Exact prompt to send"
                    rows={10}
                    value={assembledPrompt}
                    onChange={(event) => {
                      setPromptEdited(true);
                      setRequestSent(false);
                      setAssembledPrompt(event.target.value);
                    }}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || !assembledPrompt.trim()}
                  onClick={() => void send()}
                  type="button"
                >
                  {busy ? 'Waiting for provider…' : 'Send reviewed prompt'}
                </button>
                {busy && (
                  <button className="secondary-button" onClick={cancel} type="button">
                    Stop waiting / close
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="ai-preview-heading">
                  <h3>Response preview</h3>
                  <span>Not applied to your manuscript</span>
                </div>
                <textarea
                  aria-label="AI response preview"
                  rows={12}
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                />
                <div className="ai-preview-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void copyResponse()}
                    type="button"
                  >
                    Copy
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setResponse('');
                      setStatus('Response discarded.');
                    }}
                    type="button"
                  >
                    Discard
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!props.selection.text}
                    onClick={() => applyResponse('replace')}
                    type="button"
                  >
                    Replace selection
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => applyResponse('insert')}
                    type="button"
                  >
                    Insert at cursor
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {tab === 'templates' && (
          <div className="ai-template-manager">
            <div className="ai-template-list">
              {templates.map((template) => (
                <div className="ai-template-row" key={template.id}>
                  <button onClick={() => editTemplate(template)} type="button">
                    <strong>{template.name}</strong>
                    <small>{template.description}</small>
                  </button>
                  <button
                    aria-label={`Duplicate ${template.name}`}
                    onClick={() => void duplicateTemplate(template)}
                    type="button"
                  >
                    Duplicate
                  </button>
                  <button
                    aria-label={`Delete ${template.name}`}
                    onClick={() => void deleteTemplate(template)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
              <button
                className="secondary-button"
                onClick={() => {
                  setEditingTemplateId(null);
                  setTemplateName('');
                  setTemplateDescription('');
                  setTemplateBody('');
                }}
                type="button"
              >
                New template
              </button>
            </div>
            <div className="ai-template-form">
              <p>Variables: {TEMPLATE_VARIABLES.join(', ')}</p>
              <label>
                Name
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </label>
              <label>
                Description
                <input
                  value={templateDescription}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                />
              </label>
              <label>
                Prompt body
                <textarea
                  rows={10}
                  value={templateBody}
                  onChange={(event) => setTemplateBody(event.target.value)}
                />
              </label>
              <button
                className="primary-button"
                onClick={() => void saveTemplate()}
                type="button"
              >
                Save template
              </button>
            </div>
          </div>
        )}
        {tab === 'history' && (
          <div className="ai-history">
            <div>
              <h3>Local interaction history</h3>
              <button
                className="secondary-button"
                disabled={!props.history.length}
                onClick={() => void clearHistory()}
                type="button"
              >
                Clear history
              </button>
            </div>
            <p>
              Only timestamps, template names, models, and included-context labels are
              saved. Prompt and response text are not stored.
            </p>
            {props.history.length ? (
              <ul>
                {props.history.map((item) => (
                  <li key={item.id}>
                    <strong>{item.templateName}</strong>
                    <span>
                      {item.model} · {new Date(item.at).toLocaleString()}
                    </span>
                    <small>{item.includedContext.join(', ') || 'No context'}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No interactions recorded.</p>
            )}
          </div>
        )}
        {(status || error) && (
          <div
            className={error ? 'ai-error' : 'ai-status'}
            role={error ? 'alert' : 'status'}
          >
            {error || status}
          </div>
        )}
      </section>
    </div>
  );
}

function messageOf(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return 'The AI request failed. Check your provider settings and try again.';
}
