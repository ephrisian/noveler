import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpenText,
  ChevronDown,
  ChevronDown as MoveDown,
  ChevronUp,
  Link2,
  FileText,
  HardDrive,
  Library,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AiSettings,
  ChapterWithScenes,
  CodexEntry,
  CodexEntryDetail,
  Project,
  ProjectDetail,
  Scene,
} from '../shared/contracts';
import {
  countWords,
  documentFromPlainText,
  parseStoredContent,
  plainTextFromStoredContent,
  serializeEditorDocument,
} from '../shared/editorDocument';
import { createDebouncedAction } from '../shared/debouncedAction';
import { codexService } from '../shared/codex';
import { aiService } from '../shared/ai';
import { createDocxExport, portableService, type SearchResult } from '../shared/portable';
import type { AIHistoryItem, PromptTemplate } from '../shared/aiPrompts';
import AiWritingPanel from './AiWritingPanel';
import { projectService } from '../shared/projects';
import {
  timelineService,
  type TimelineEvent,
  type TimelineEventInput,
} from '../shared/timeline';
import {
  buildCodexSuggestionPrompt,
  parseCodexSuggestions,
  type CodexSuggestion,
} from '../shared/codexSuggestions';
import {
  DEFAULT_WRITING_THEMES,
  contrastRatio,
  loadWritingThemes,
  exportWritingTheme,
  parseWritingThemeImport,
  saveWritingThemes,
  validateWritingTheme,
  WRITING_FONTS,
  type WritingTheme,
} from '../shared/themes';

type Page = 'Library' | 'Codex' | 'Timeline' | 'Settings';
type Theme = 'light' | 'dark';
type TextScale = '1' | '1.15' | '1.3';

const navigation: { name: Page; icon: typeof Library }[] = [
  { name: 'Library', icon: Library },
  { name: 'Codex', icon: BookOpenText },
  { name: 'Timeline', icon: BookOpenText },
  { name: 'Settings', icon: Settings2 },
];

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('noveler-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [textScale, setTextScale] = useState<TextScale>(() => {
    try {
      const stored = localStorage.getItem('noveler-text-scale');
      return stored === '1.15' || stored === '1.3' ? stored : '1';
    } catch {
      return '1';
    }
  });
  const [writingThemes, setWritingThemes] = useState<WritingTheme[]>(loadWritingThemes);
  const [writingThemeId, setWritingThemeId] = useState(() => {
    try {
      const id = localStorage.getItem('noveler-writing-theme-id');
      return writingThemes.some((theme) => theme.id === id)
        ? id!
        : DEFAULT_WRITING_THEMES[0].id;
    } catch {
      return DEFAULT_WRITING_THEMES[0].id;
    }
  });
  const [page, setPage] = useState<Page>('Library');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [sceneText, setSceneText] = useState('');
  const [chapterEditId, setChapterEditId] = useState<string | null>(null);
  const [chapterContents, setChapterContents] = useState<Record<string, string>>({});
  const [restoreError, setRestoreError] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const aiTriggerRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' });
  const [chapterSceneSaveStates, setChapterSceneSaveStates] = useState<
    Record<string, 'saving' | 'saved' | 'error'>
  >({});
  const [loading, setLoading] = useState(true);
  const [libraryLoadError, setLibraryLoadError] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>(
    'saved',
  );
  const [saveError, setSaveError] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [codexEntries, setCodexEntries] = useState<CodexEntry[]>([]);
  const [selectedCodex, setSelectedCodex] = useState<CodexEntryDetail | null>(null);
  const [codexProjectDetail, setCodexProjectDetail] = useState<ProjectDetail | null>(
    null,
  );
  const [codexQuery, setCodexQuery] = useState('');
  const [codexKind, setCodexKind] = useState('');
  const [codexProjectId, setCodexProjectId] = useState('');
  const [codexError, setCodexError] = useState('');
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineError, setTimelineError] = useState('');
  const [timelineProjectId, setTimelineProjectId] = useState('');
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [appearanceMigrationComplete, setAppearanceMigrationComplete] = useState(false);
  const [appearanceSettingsReady, setAppearanceSettingsReady] = useState(false);
  const [aiLocalData, setAiLocalData] = useState<{
    templates: PromptTemplate[];
    history: AIHistoryItem[];
  }>({ templates: [], history: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<
    import('../shared/portable').ManuscriptImport | null
  >(null);
  const [importFilename, setImportFilename] = useState('');
  const [importError, setImportError] = useState('');
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const [pendingWindowClose, setPendingWindowClose] = useState(false);
  const [closingAfterSave, setClosingAfterSave] = useState(false);
  const allowWindowClose = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sceneTextRef = useRef(sceneText);
  const saveStateRef = useRef(saveState);
  const selectedSceneRef = useRef(selectedScene);
  const pageRef = useRef(page);
  const activeWritingTheme =
    writingThemes.find((item) => item.id === writingThemeId) ?? writingThemes[0];
  saveStateRef.current = saveState;
  selectedSceneRef.current = selectedScene;
  pageRef.current = page;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('noveler-theme', theme);
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', textScale);
    try {
      localStorage.setItem('noveler-text-scale', textScale);
    } catch {
      // Keep the selected scale for this session if local storage is unavailable.
    }
  }, [textScale]);

  useEffect(() => {
    if (!activeWritingTheme) return;
    const root = document.documentElement;
    root.style.setProperty('--writer-background', activeWritingTheme.background);
    root.style.setProperty('--writer-foreground', activeWritingTheme.foreground);
    root.style.setProperty('--writer-font', activeWritingTheme.fontFamily);
    root.style.setProperty(
      '--writer-heading-font',
      activeWritingTheme.headingFontFamily ?? activeWritingTheme.fontFamily,
    );
    root.style.setProperty('--writer-font-size', `${activeWritingTheme.fontSize}px`);
    root.style.setProperty('--writer-line-height', String(activeWritingTheme.lineHeight));
    root.style.setProperty(
      '--writer-content-width',
      `${activeWritingTheme.contentWidth}px`,
    );
    root.dataset.sceneDivider = activeWritingTheme.sceneDivider ?? 'line';
  }, [activeWritingTheme]);

  useEffect(() => {
    let active = true;
    void aiService
      .getAppearanceSettings()
      .then((settings) => {
        if (!active) return;
        if (settings.theme === 'light' || settings.theme === 'dark')
          setTheme(settings.theme);
        if (
          settings.textScale === '1' ||
          settings.textScale === '1.15' ||
          settings.textScale === '1.3'
        )
          setTextScale(settings.textScale);
        setAppearanceSettingsReady(true);
        if (
          settings.version === 1 &&
          Array.isArray(settings.themes) &&
          settings.themes.length > 0 &&
          settings.themes.every(validateWritingTheme)
        ) {
          setWritingThemes(settings.themes as WritingTheme[]);
          if (
            settings.themes.some(
              (item) => (item as WritingTheme).id === settings.selectedThemeId,
            )
          )
            setWritingThemeId(settings.selectedThemeId);
          setAppearanceMigrationComplete(true);
        } else {
          try {
            const legacy = localStorage.getItem('noveler-writing-themes');
            const parsed: unknown = legacy ? JSON.parse(legacy) : null;
            if (
              Array.isArray(parsed) &&
              parsed.length > 0 &&
              parsed.every(validateWritingTheme)
            )
              setWritingThemes(parsed);
            const legacyId = localStorage.getItem('noveler-writing-theme-id');
            if (
              legacyId &&
              Array.isArray(parsed) &&
              parsed.some((item) => item.id === legacyId)
            )
              setWritingThemeId(legacyId);
          } catch {
            /* Use built-in themes when legacy browser settings are invalid. */
          }
          setAppearanceMigrationComplete(true);
        }
      })
      .catch(() => {
        // Keep built-in and legacy local preferences if the settings file is unavailable.
        if (active) setAppearanceSettingsReady(false);
      })
      .finally(() => {
        if (active) {
          setAppearanceMigrationComplete(true);
          setAppearanceLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!appearanceLoaded || !appearanceMigrationComplete || !appearanceSettingsReady)
      return;
    const settings = {
      version: 1 as const,
      themes: writingThemes,
      selectedThemeId: writingThemeId,
      theme,
      textScale,
    };
    void aiService
      .saveAppearanceSettings(settings)
      .then(() => {
        try {
          saveWritingThemes(writingThemes);
          localStorage.setItem('noveler-writing-theme-id', writingThemeId);
        } catch {
          /* Native settings remain authoritative when browser storage is blocked. */
        }
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [
    appearanceLoaded,
    appearanceMigrationComplete,
    appearanceSettingsReady,
    writingThemes,
    writingThemeId,
    theme,
    textScale,
  ]);

  useEffect(() => {
    setActiveSearchResult(0);
  }, [searchResults]);
  const saveSequence = useRef(0);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const autosave = useRef(createDebouncedAction(700));
  const switchingScene = useRef(false);
  const chapterSceneDrafts = useRef(
    new Map<string, { content: string; revision: number }>(),
  );
  const chapterSceneRevisions = useRef(new Map<string, number>());
  const chapterSceneTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chapterSceneQueues = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        searchInputRef.current?.blur();
        event.stopImmediatePropagation();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);
  const persistScene = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      const sequence = ++saveSequence.current;
      setSaveState('saving');
      setSaveError('');
      const save = saveQueue.current
        .catch(() => false)
        .then(async () => {
          const updated = await projectService.saveSceneContent(id, content);
          if (saveSequence.current === sequence && sceneTextRef.current === content) {
            setSelectedScene((current) => (current?.id === id ? updated : current));
            setProject((current) => {
              if (!current) return current;
              return {
                ...current,
                chapters: current.chapters.map((chapter) => ({
                  ...chapter,
                  scenes: chapter.scenes.map((scene) =>
                    scene.id === id ? updated : scene,
                  ),
                })),
              };
            });
          }
          return true;
        });
      saveQueue.current = save.catch((cause) => {
        if (saveSequence.current === sequence) {
          setSaveState('error');
          setSaveError(errorMessage(cause));
        }
        return false;
      });
      try {
        await save;
        if (saveSequence.current === sequence && sceneTextRef.current === content) {
          setSaveState('saved');
        } else if (saveSequence.current === sequence) {
          setSaveState('unsaved');
        }
        return true;
      } catch (cause) {
        if (saveSequence.current === sequence) {
          setSaveState('error');
          setSaveError(errorMessage(cause));
        }
        return false;
      }
    },
    [],
  );

  const saveChapterSceneDraft = useCallback(async (sceneId: string) => {
    const draft = chapterSceneDrafts.current.get(sceneId);
    if (!draft) return;
    const revision = draft.revision;
    setChapterSceneSaveStates((current) => ({ ...current, [sceneId]: 'saving' }));
    const previous = chapterSceneQueues.current.get(sceneId) ?? Promise.resolve();
    const save = previous
      .catch(() => undefined)
      .then(async () => {
        await projectService.saveSceneContent(sceneId, draft.content);
      });
    chapterSceneQueues.current.set(sceneId, save);
    try {
      await save;
      if (chapterSceneRevisions.current.get(sceneId) === revision) {
        chapterSceneDrafts.current.delete(sceneId);
        chapterSceneRevisions.current.delete(sceneId);
        setChapterSceneSaveStates((current) => ({ ...current, [sceneId]: 'saved' }));
      } else {
        setChapterSceneSaveStates((current) => ({ ...current, [sceneId]: 'saving' }));
      }
    } catch {
      if (chapterSceneRevisions.current.get(sceneId) === revision) {
        setChapterSceneSaveStates((current) => ({ ...current, [sceneId]: 'error' }));
      }
    }
  }, []);

  const scheduleChapterSceneSave = useCallback(
    (sceneId: string, content: string) => {
      const revision = (chapterSceneRevisions.current.get(sceneId) ?? 0) + 1;
      chapterSceneRevisions.current.set(sceneId, revision);
      chapterSceneDrafts.current.set(sceneId, { content, revision });
      setChapterSceneSaveStates((current) => ({ ...current, [sceneId]: 'saving' }));
      const timer = chapterSceneTimers.current.get(sceneId);
      if (timer) window.clearTimeout(timer);
      chapterSceneTimers.current.set(
        sceneId,
        setTimeout(() => {
          chapterSceneTimers.current.delete(sceneId);
          void saveChapterSceneDraft(sceneId);
        }, 700),
      );
    },
    [saveChapterSceneDraft],
  );

  const flushChapterSceneDrafts = useCallback(async () => {
    for (const timer of chapterSceneTimers.current.values()) window.clearTimeout(timer);
    chapterSceneTimers.current.clear();
    const sceneIds = [...chapterSceneDrafts.current.keys()];
    await Promise.all(sceneIds.map((sceneId) => saveChapterSceneDraft(sceneId)));
    return sceneIds.every((sceneId) => !chapterSceneDrafts.current.has(sceneId));
  }, [saveChapterSceneDraft]);

  useEffect(
    () => () => {
      for (const timer of chapterSceneTimers.current.values()) window.clearTimeout(timer);
      chapterSceneTimers.current.clear();
    },
    [],
  );

  const refreshProjects = async () => {
    setError('');
    setLibraryLoadError('');
    try {
      setProjects(await projectService.listProjects());
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setLibraryLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    void aiService
      .getLocalData()
      .then(setAiLocalData)
      .catch((cause) => setError(errorMessage(cause)));
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError('');
      setSearchBusy(false);
      return;
    }
    let active = true;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      void portableService
        .search(query)
        .then((results) => {
          if (active) {
            setSearchResults(results);
            setSearchError('');
          }
        })
        .catch((cause) => {
          if (active) setSearchError(errorMessage(cause));
        })
        .finally(() => {
          if (active) setSearchBusy(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const jumpToSearchResult = async (result: SearchResult) => {
    setSearchOpen(false);
    setSearchQuery('');
    try {
      if (!(await flushChapterSceneDrafts())) return;
      if (selectedScene && ['unsaved', 'saving', 'error'].includes(saveState)) {
        await autosave.current.flush();
        if (saveStateRef.current === 'error') return;
      }
      if (result.kind === 'codex' && result.codexEntryId) {
        setSelectedCodex(await codexService.detail(result.codexEntryId));
        setProject(null);
        applySelectedScene(null);
        setCodexProjectId(result.projectId);
        setCodexQuery('');
        setCodexKind('');
        setPage('Codex');
        return;
      }
      const detail = await projectService.openProject(result.projectId);
      setProject(detail);
      if (result.sceneId) {
        const scene =
          detail.chapters
            .flatMap((chapter) => chapter.scenes)
            .find((item) => item.id === result.sceneId) ?? null;
        applySelectedScene(scene);
      } else if (result.chapterId) {
        applySelectedScene(
          detail.chapters.find((chapter) => chapter.chapter.id === result.chapterId)
            ?.scenes[0] ?? null,
        );
      } else {
        applySelectedScene(
          detail.chapters.flatMap((chapter) => chapter.scenes)[0] ?? null,
        );
      }
      setPage('Library');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadFile = (filename: string, content: string | Blob, type: string) => {
    const url = URL.createObjectURL(
      content instanceof Blob ? content : new Blob([content], { type }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const flushDraftBeforePortableAction = async () => {
    if (!(await flushChapterSceneDrafts())) return false;
    if (!selectedScene || !['unsaved', 'saving', 'error'].includes(saveState))
      return true;
    await autosave.current.flush();
    return saveStateRef.current !== 'error';
  };

  const restoreProjectBackup = async (file: File) => {
    const currentId = project?.project.id ?? null;
    const currentTitle = project?.project.title;
    if (
      currentId &&
      currentTitle &&
      !window.confirm(
        `Restore this backup over “${currentTitle}”? This permanently replaces its manuscript and Codex data. Export a backup first if you may need the current version.`,
      )
    )
      return;
    if (!(await flushDraftBeforePortableAction())) return;
    try {
      const payload = await file.text();
      const restored = await portableService.restoreBackup(payload, currentId);
      const detail = await projectService.openProject(restored.id);
      setProject(detail);
      applySelectedScene(detail.chapters.flatMap((chapter) => chapter.scenes)[0] ?? null);
      setPage('Library');
      setSelectedCodex(null);
      void refreshCodex(restored.id);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const restoreAsNewProject = async (file: File) => {
    if (!(await flushDraftBeforePortableAction())) return;
    try {
      const restored = await portableService.restoreBackup(await file.text(), null);
      const detail = await projectService.openProject(restored.id);
      setProject(detail);
      setSelectedCodex(null);
      applySelectedScene(detail.chapters.flatMap((chapter) => chapter.scenes)[0] ?? null);
      setPage('Library');
      void refreshCodex(restored.id);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const activeCodexProjectId =
    project?.project.id ?? (codexProjectId || projects[0]?.id || '');
  const activeTimelineProjectId =
    timelineProjectId || project?.project.id || projects[0]?.id || '';

  const refreshTimeline = async (projectId: string) => {
    if (!projectId) {
      setTimelineEvents([]);
      return;
    }
    setTimelineError('');
    try {
      setTimelineEvents(await timelineService.list(projectId));
    } catch (cause) {
      setTimelineError(errorMessage(cause));
    }
  };

  useEffect(() => {
    if (page === 'Timeline' && activeTimelineProjectId)
      void refreshTimeline(activeTimelineProjectId);
  }, [page, activeTimelineProjectId]);

  const refreshCodex = useCallback(
    async (projectId: string, query = codexQuery, kind = codexKind) => {
      setCodexError('');
      try {
        const results = await codexService.list(projectId, query, kind || null);
        setCodexEntries(results);
        setSelectedCodex((current) =>
          current && !results.some((entry) => entry.id === current.entry.id)
            ? null
            : current,
        );
      } catch (cause) {
        setCodexError(errorMessage(cause));
      }
    },
    [codexKind, codexQuery],
  );

  useEffect(() => {
    if (activeCodexProjectId) void refreshCodex(activeCodexProjectId);
  }, [activeCodexProjectId, refreshCodex]);

  useEffect(() => {
    if (!activeCodexProjectId) {
      setCodexProjectDetail(null);
      return;
    }
    void projectService
      .openProject(activeCodexProjectId)
      .then(setCodexProjectDetail)
      .catch((cause) => setCodexError(errorMessage(cause)));
  }, [activeCodexProjectId]);

  useEffect(() => {
    if (!activeCodexProjectId || pageRef.current !== 'Codex') return;
    const timer = window.setTimeout(() => void refreshCodex(activeCodexProjectId), 180);
    return () => window.clearTimeout(timer);
  }, [codexQuery, codexKind, activeCodexProjectId, refreshCodex]);

  const runAction = async (
    action: () => Promise<unknown>,
    success?: () => void,
    reopenProject = true,
  ) => {
    setError('');
    try {
      await action();
      success?.();
      await refreshProjects();
      if (project && reopenProject) {
        const detail = await projectService.openProject(project.project.id);
        setProject(detail);
        const currentScene = detail.chapters
          .flatMap((item) => item.scenes)
          .find((scene) => scene.id === selectedScene?.id);
        if (currentScene && saveState === 'unsaved') {
          setSelectedScene(currentScene);
        } else {
          applySelectedScene(
            currentScene ?? detail.chapters.flatMap((item) => item.scenes)[0] ?? null,
          );
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const openProject = async (id: string) => {
    if (!(await flushChapterSceneDrafts())) return;
    if (selectedScene && ['unsaved', 'saving', 'error'].includes(saveState)) {
      await autosave.current.flush();
      if (saveStateRef.current === 'error') return;
    }
    setError('');
    try {
      const detail = await projectService.openProject(id);
      setProject(detail);
      const firstScene = detail.chapters.flatMap((item) => item.scenes)[0] ?? null;
      applySelectedScene(firstScene);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const selectScene = (scene: Scene | null) => {
    if (selectedScene?.id === scene?.id) return;
    if (chapterEditId) {
      void flushChapterSceneDrafts().then((saved) => {
        if (!saved) return;
        setChapterEditId(null);
        setChapterContents({});
        applySelectedScene(scene);
      });
      return;
    }
    const previousScene = selectedSceneRef.current;
    if (previousScene && ['unsaved', 'saving', 'error'].includes(saveStateRef.current)) {
      if (switchingScene.current) return;
      switchingScene.current = true;
      autosave.current.schedule(async () => {
        const saved = await persistScene(previousScene.id, sceneTextRef.current);
        switchingScene.current = false;
        if (saved) applySelectedScene(scene);
      });
      void autosave.current.flush();
      return;
    }
    applySelectedScene(scene);
  };

  const applySelectedScene = (scene: Scene | null) => {
    setSelectedScene(scene);
    const content = scene?.content ?? '';
    sceneTextRef.current = content;
    setSceneText(content);
    setSaveError('');
    setSaveState('saved');
  };

  const navigate = async (destination: Page) => {
    if (destination === pageRef.current) return;
    if (chapterSceneDrafts.current.size > 0 && !(await flushChapterSceneDrafts())) return;
    if (selectedScene && ['unsaved', 'saving', 'error'].includes(saveState)) {
      await autosave.current.flush();
      if (saveStateRef.current === 'error') return;
    }
    setPage(destination);
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        (!selectedSceneRef.current ||
          !['unsaved', 'saving', 'error'].includes(saveStateRef.current)) &&
        chapterSceneDrafts.current.size === 0
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushChapterSceneDrafts();
      }
      if (
        document.visibilityState === 'hidden' &&
        selectedSceneRef.current &&
        ['unsaved', 'saving'].includes(saveStateRef.current)
      ) {
        void autosave.current.flush();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushChapterSceneDrafts]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowWindowClose.current) return;
        const hasUnsavedScene = Boolean(
          selectedSceneRef.current &&
          ['unsaved', 'saving', 'error'].includes(saveStateRef.current),
        );
        const hasChapterDrafts = chapterSceneDrafts.current.size > 0;
        if (!hasUnsavedScene && !hasChapterDrafts) {
          // Explicitly resume the native close after canceling the current request.
          // This also handles desktop Exit actions that invoke Tauri's close command.
          event.preventDefault();
          allowWindowClose.current = true;
          void getCurrentWindow()
            .close()
            .catch((cause) => {
              allowWindowClose.current = false;
              setError(errorMessage(cause));
            });
          return;
        }
        event.preventDefault();
        setPendingWindowClose(true);
      })
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else dispose();
      })
      .catch((cause) => setError(errorMessage(cause)));
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const closeWindowAfterSave = async () => {
    if (!(await flushChapterSceneDrafts())) return;
    if (!selectedSceneRef.current) {
      allowWindowClose.current = true;
      await getCurrentWindow().close();
      return;
    }
    setClosingAfterSave(true);
    const saved = await persistScene(selectedSceneRef.current.id, sceneTextRef.current);
    setClosingAfterSave(false);
    if (!saved) return;
    setPendingWindowClose(false);
    allowWindowClose.current = true;
    await getCurrentWindow().close();
  };

  const discardDraftAndClose = async () => {
    autosave.current.cancel();
    for (const timer of chapterSceneTimers.current.values()) window.clearTimeout(timer);
    chapterSceneTimers.current.clear();
    chapterSceneDrafts.current.clear();
    setPendingWindowClose(false);
    allowWindowClose.current = true;
    await getCurrentWindow().close();
  };

  const closeProject = () => {
    if (chapterEditId) {
      void flushChapterSceneDrafts().then((saved) => {
        if (!saved) return;
        setChapterEditId(null);
        setChapterContents({});
        closeProject();
      });
      return;
    }
    if (selectedScene && ['unsaved', 'saving', 'error'].includes(saveState)) {
      autosave.current.schedule(async () => {
        const saved = await persistScene(selectedScene.id, sceneTextRef.current);
        if (saved) {
          setProject(null);
          applySelectedScene(null);
          setFocusMode(false);
        }
      });
      void autosave.current.flush();
      return;
    }
    setProject(null);
    setSelectedScene(null);
    applySelectedScene(null);
    setFocusMode(false);
  };

  const editTitle = async (
    kind: 'project' | 'chapter' | 'scene',
    id: string,
    current: string,
  ) => {
    const title = window.prompt(`Rename ${kind}`, current);
    if (title === null) return;
    const rename = {
      project: () => projectService.renameProject(id, title),
      chapter: () => projectService.renameChapter(id, title),
      scene: () => projectService.renameScene(id, title),
    }[kind];
    await runAction(rename);
  };

  const deleteItem = async (
    kind: 'project' | 'chapter' | 'scene',
    id: string,
    title: string,
  ) => {
    const warning =
      kind === 'project'
        ? `Delete “${title}” and all of its chapters and scenes? This cannot be undone.`
        : `Delete “${title}”${kind === 'chapter' ? ' and all of its scenes' : ''}? This cannot be undone.`;
    const includesDraft =
      ['unsaved', 'saving', 'error'].includes(saveState) &&
      (kind === 'project' ||
        (kind === 'scene' && selectedScene?.id === id) ||
        (kind === 'chapter' &&
          project?.chapters.some(
            (chapter) =>
              chapter.chapter.id === id &&
              chapter.scenes.some((scene) => scene.id === selectedScene?.id),
          )));
    const consequence = includesDraft
      ? ' Unsaved edits in the current scene will also be lost.'
      : '';
    if (!window.confirm(`${warning}${consequence}`)) return;
    const remove = {
      project: () => projectService.deleteProject(id),
      chapter: () => projectService.deleteChapter(id),
      scene: () => projectService.deleteScene(id),
    }[kind];
    await runAction(
      remove,
      kind === 'project'
        ? () => {
            setProject(null);
            applySelectedScene(null);
          }
        : undefined,
      kind !== 'project',
    );
  };

  const moveChapter = async (index: number, direction: -1 | 1) => {
    if (!project) return;
    const chapters = project.chapters.map((item) => item.chapter.id);
    const next = index + direction;
    if (next < 0 || next >= chapters.length) return;
    [chapters[index], chapters[next]] = [chapters[next], chapters[index]];
    await runAction(() => projectService.reorderChapters(project.project.id, chapters));
  };

  const moveScene = async (
    chapter: ChapterWithScenes,
    index: number,
    direction: -1 | 1,
  ) => {
    const scenes = chapter.scenes.map((item) => item.id);
    const next = index + direction;
    if (next < 0 || next >= scenes.length) return;
    [scenes[index], scenes[next]] = [scenes[next], scenes[index]];
    await runAction(() => projectService.reorderScenes(chapter.chapter.id, scenes));
  };

  const createProject = async () => {
    const title = window.prompt('Project title');
    if (title === null) return;
    await runAction(
      async () => {
        const created = await projectService.createProject(title);
        const detail = await projectService.openProject(created.id);
        setProject(detail);
        applySelectedScene(detail.chapters.flatMap((item) => item.scenes)[0] ?? null);
      },
      undefined,
      false,
    );
  };

  const createChapter = async () => {
    if (!project) return;
    if (selectedScene && ['unsaved', 'saving', 'error'].includes(saveState)) {
      await autosave.current.flush();
      if (saveStateRef.current === 'error') return;
    }
    const title = `Chapter ${project.chapters.length + 1}`;
    setError('');
    try {
      const chapter = await projectService.createChapter(project.project.id, title);
      await refreshProjects();
      const updated = await projectService.openProject(project.project.id);
      setProject(updated);
      const starterScene =
        updated.chapters.find((item) => item.chapter.id === chapter.id)?.scenes[0] ??
        null;
      applySelectedScene(starterScene);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const createScene = async (chapter: ChapterWithScenes) => {
    const title = window.prompt('Scene title');
    if (title !== null) {
      await runAction(() => projectService.createScene(chapter.chapter.id, title));
    }
  };

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <a
          className="brand"
          href="#library"
          onClick={(event) => {
            event.preventDefault();
            void navigate('Library');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <BookOpenText size={19} />
          </span>
          <span>noveler</span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Workspace">
          {navigation.map(({ name, icon: Icon }) => (
            <button
              aria-label={name}
              aria-current={page === name ? 'page' : undefined}
              className={`nav-link${page === name ? ' active' : ''}`}
              key={name}
              onClick={() => void navigate(name)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{name}</span>
              {name === 'Library' && (
                <span aria-hidden="true" className="nav-count">
                  {projects.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-indicator" aria-hidden="true" />
            <div>
              <strong>Private by design</strong>
              <span>Your work stays on this device.</span>
            </div>
          </div>
          <div className="profile-button">
            <span className="avatar" aria-hidden="true">
              N
            </span>
            <span className="profile-copy">
              <strong>My workspace</strong>
              <small>Local workspace</small>
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </div>
        </div>
      </aside>

      <main className="main-panel" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="crumb-divider">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => document.getElementById('library-backup-input')?.click()}
              type="button"
            >
              Restore as new project
            </button>
            <button
              className="secondary-button"
              onClick={() => document.getElementById('manuscript-import-input')?.click()}
              type="button"
            >
              Import manuscript
            </button>
            <input
              id="manuscript-import-input"
              aria-label="Choose manuscript to import"
              type="file"
              accept=".md,.markdown,.txt,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setImportError('');
                void portableService
                  .parseManuscriptFile(file)
                  .then((preview) => {
                    setImportPreview(preview);
                    setImportFilename(file.name);
                  })
                  .catch((cause) => setImportError(errorMessage(cause)));
              }}
            />
            <input
              accept="application/json,.json"
              aria-label="Choose backup to restore as a new project"
              id="library-backup-input"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file && file.size > 50 * 1024 * 1024) {
                  setError('Backup files must be 50 MB or smaller.');
                } else if (file) {
                  void restoreAsNewProject(file);
                }
                event.currentTarget.value = '';
              }}
              type="file"
              hidden
            />
            <div className="global-search" onFocus={() => setSearchOpen(true)}>
              <input
                aria-label="Search projects, manuscript, and Codex"
                aria-controls="global-search-results"
                aria-expanded={searchOpen && Boolean(searchQuery.trim())}
                aria-autocomplete="list"
                aria-activedescendant={
                  searchOpen && searchResults.length
                    ? `global-search-result-${activeSearchResult}`
                    : undefined
                }
                placeholder="Search your writing…"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false);
                  if (event.key === 'ArrowDown' && searchResults.length) {
                    event.preventDefault();
                    setActiveSearchResult((index) => (index + 1) % searchResults.length);
                  }
                  if (event.key === 'ArrowUp' && searchResults.length) {
                    event.preventDefault();
                    setActiveSearchResult(
                      (index) =>
                        (index - 1 + searchResults.length) % searchResults.length,
                    );
                  }
                  if (event.key === 'Enter' && searchResults[activeSearchResult]) {
                    void jumpToSearchResult(searchResults[activeSearchResult]);
                  }
                }}
              />
              {searchOpen && searchQuery.trim() && (
                <div
                  className="global-search-results"
                  id="global-search-results"
                  role="listbox"
                  aria-label="Search results"
                >
                  {searchBusy ? <p role="status">Searching…</p> : null}
                  {searchError ? <p role="alert">{searchError}</p> : null}
                  {!searchBusy && !searchError && searchResults.length === 0 ? (
                    <p>No matching projects, scenes, or Codex entries.</p>
                  ) : null}
                  {searchResults.map((result, index) => (
                    <button
                      key={`${result.kind}:${result.codexEntryId ?? result.sceneId ?? result.projectId}`}
                      onClick={() => void jumpToSearchResult(result)}
                      role="option"
                      aria-selected={activeSearchResult === index}
                      id={`global-search-result-${index}`}
                      onMouseEnter={() => setActiveSearchResult(index)}
                      type="button"
                    >
                      <strong>{result.title}</strong>
                      <small>
                        {result.projectTitle} · {result.kind}
                      </small>
                      {result.kind !== 'project' && <span>{result.snippet}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="local-badge">
              <span className="local-indicator" /> Local only
            </span>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {importError && (
          <p className="form-error" role="alert">
            {importError}
          </p>
        )}
        {importPreview && (
          <section
            className="codex-suggestion-review"
            aria-label="Manuscript import preview"
          >
            <h2>Import preview · {importFilename}</h2>
            <p>
              <strong>{importPreview.title}</strong> · {importPreview.chapters.length}{' '}
              chapters ·{' '}
              {importPreview.chapters.reduce(
                (total, chapter) => total + chapter.scenes.length,
                0,
              )}{' '}
              scenes
            </p>
            <ol>
              {importPreview.chapters.map((chapter, index) => (
                <li key={`${chapter.title}-${index}`}>
                  {chapter.title} · {chapter.scenes.length} scenes
                </li>
              ))}
            </ol>
            <div className="heading-actions">
              <button
                className="primary-button"
                onClick={() =>
                  void portableService
                    .importManuscript(importPreview)
                    .then(async (created) => {
                      setImportPreview(null);
                      await refreshProjects();
                      setProject(await projectService.openProject(created.id));
                      setPage('Library');
                    })
                    .catch((cause) => setImportError(errorMessage(cause)))
                }
                type="button"
              >
                Create project from import
              </button>
              <button
                className="text-button"
                onClick={() => setImportPreview(null)}
                type="button"
              >
                Cancel import
              </button>
            </div>
          </section>
        )}
        {pendingWindowClose && (
          <div className="close-confirm-backdrop">
            <section
              aria-labelledby="close-confirm-title"
              aria-modal="true"
              className="close-confirm-dialog"
              role="dialog"
            >
              <h2 id="close-confirm-title">Unsaved writing</h2>
              <p>Save your current scene before closing Noveler?</p>
              {saveError && (
                <p className="form-error" role="alert">
                  {saveError}
                </p>
              )}
              <div className="heading-actions">
                <button
                  className="secondary-button"
                  disabled={closingAfterSave}
                  onClick={() => setPendingWindowClose(false)}
                  type="button"
                >
                  Stay in Noveler
                </button>
                <button
                  className="secondary-button"
                  disabled={closingAfterSave}
                  onClick={() => void discardDraftAndClose()}
                  type="button"
                >
                  Discard and close
                </button>
                <button
                  className="primary-button"
                  disabled={closingAfterSave}
                  onClick={() => void closeWindowAfterSave()}
                  type="button"
                >
                  {closingAfterSave ? 'Saving…' : 'Save and close'}
                </button>
              </div>
            </section>
          </div>
        )}
        {page === 'Library' &&
          (project ? (
            <ProjectWorkspace
              project={project}
              selectedScene={selectedScene}
              sceneText={sceneText}
              chapterEditId={chapterEditId}
              setChapterEditId={setChapterEditId}
              chapterContents={chapterContents}
              setChapterContents={setChapterContents}
              restoreError={restoreError}
              setRestoreError={setRestoreError}
              aiPanelOpen={aiPanelOpen}
              setAiPanelOpen={setAiPanelOpen}
              aiTriggerRef={aiTriggerRef}
              selection={selection}
              setSelection={setSelection}
              codexEntries={codexEntries}
              onCheckCodexDuplicate={async (suggestion) => {
                const entries = await codexService.list(project.project.id, '', null);
                setCodexEntries(entries);
                const duplicate =
                  entries.find(
                    (entry) =>
                      entry.kind === suggestion.kind &&
                      entry.title.trim().toLocaleLowerCase() ===
                        suggestion.title.trim().toLocaleLowerCase(),
                  ) ?? null;
                return duplicate;
              }}
              selectedCodex={selectedCodex}
              projectTemplates={aiLocalData.templates}
              aiHistory={aiLocalData.history}
              onSaveTemplates={async (templates) => {
                await aiService.saveTemplates(templates);
                setAiLocalData((current) => ({ ...current, templates }));
              }}
              writingTheme={activeWritingTheme}
              onGenerateCodex={async (text, sourceSceneIds, sourceLabel) => {
                if (!text.trim())
                  throw new Error(
                    'There is no manuscript text in this selection to analyze.',
                  );
                if (text.length > 100_000)
                  throw new Error(
                    'Analysis text is limited to 100,000 characters. Select a smaller scope.',
                  );
                const result = await aiService.chat({
                  messages: [
                    {
                      role: 'user',
                      content: buildCodexSuggestionPrompt(text, sourceLabel),
                    },
                  ],
                  maxTokens: 2000,
                });
                const sourceText = text.toLocaleLowerCase();
                const normalizeEvidence = (value: string) =>
                  value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
                const suggestions = parseCodexSuggestions(result.text, sourceSceneIds);
                const acceptedEvidence = suggestions.filter((suggestion) => {
                  const evidence = suggestion.evidence.trim();
                  return (
                    evidence.length > 0 &&
                    normalizeEvidence(sourceText).includes(normalizeEvidence(evidence))
                  );
                });
                return acceptedEvidence;
              }}
              onAcceptCodexSuggestion={async (suggestion, allowDuplicate) => {
                if (!project) return false;
                if (suggestion.duplicateTitle && !allowDuplicate) return false;
                await codexService.createWithSources(
                  {
                    projectId: project.project.id,
                    kind: suggestion.kind,
                    title: suggestion.title,
                    description: suggestion.description,
                    tags: suggestion.tags,
                    fields: suggestion.fields,
                  },
                  suggestion.sceneIds,
                );
                await refreshCodex(project.project.id);
                return true;
              }}
              onTemplateHistory={async (item) => {
                await aiService.recordInteraction(item);
                setAiLocalData((current) => ({
                  ...current,
                  history: [item, ...current.history].slice(0, 200),
                }));
              }}
              onClearAiHistory={async () => {
                await aiService.clearHistory();
                setAiLocalData((current) => ({ ...current, history: [] }));
              }}
              onExport={async (format) => {
                try {
                  if (!(await flushDraftBeforePortableAction())) return;
                  if (format === 'docx') {
                    const markdown = await portableService.exportManuscript(
                      project.project.id,
                      'markdown',
                    );
                    const blob = await createDocxExport(project.project.title, markdown);
                    downloadFile(
                      `${safeFilename(project.project.title)}.docx`,
                      blob,
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    );
                    return;
                  }
                  const content = await portableService.exportManuscript(
                    project.project.id,
                    format as 'markdown' | 'text',
                  );
                  downloadFile(
                    `${safeFilename(project.project.title)}.${format === 'markdown' ? 'md' : 'txt'}`,
                    content,
                    format === 'markdown'
                      ? 'text/markdown;charset=utf-8'
                      : 'text/plain;charset=utf-8',
                  );
                  setError('');
                } catch (cause) {
                  setError(errorMessage(cause));
                }
              }}
              onBackup={async () => {
                try {
                  if (!(await flushDraftBeforePortableAction())) return;
                  const content = await portableService.exportBackup(project.project.id);
                  downloadFile(
                    `${safeFilename(project.project.title)}.noveler.json`,
                    content,
                    'application/json;charset=utf-8',
                  );
                  setError('');
                } catch (cause) {
                  setError(errorMessage(cause));
                }
              }}
              onRestoreFile={restoreProjectBackup}
              saveState={saveState}
              saveError={saveError}
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode((value) => !value)}
              onBack={closeProject}
              onCreateChapter={createChapter}
              onCreateScene={createScene}
              onDelete={deleteItem}
              onEdit={editTitle}
              onMoveChapter={moveChapter}
              onMoveScene={moveScene}
              onRetrySave={() =>
                selectedScene && void persistScene(selectedScene.id, sceneTextRef.current)
              }
              onFlushSave={() => void autosave.current.flush()}
              onSaveChapterScene={(sceneId, content) =>
                scheduleChapterSceneSave(sceneId, content)
              }
              chapterSceneSaveStates={chapterSceneSaveStates}
              onSelectScene={selectScene}
              onSelectChapter={(chapter) => {
                setChapterEditId(chapter.chapter.id);
                if (chapter.scenes[0]) selectScene(chapter.scenes[0]);
                else applySelectedScene(null);
              }}
              onSelectCodex={async (entry) => {
                try {
                  setSelectedCodex(await codexService.detail(entry.id));
                } catch (cause) {
                  setCodexError(errorMessage(cause));
                }
              }}
              onTextChange={(text) => {
                sceneTextRef.current = text;
                setSceneText(text);
                setSaveState('unsaved');
                if (selectedSceneRef.current) {
                  autosave.current.schedule(async () => {
                    await persistScene(
                      selectedSceneRef.current!.id,
                      sceneTextRef.current,
                    );
                  });
                }
              }}
            />
          ) : (
            <LibraryPage
              projects={projects}
              loading={loading}
              loadError={libraryLoadError}
              onRetry={() => void refreshProjects()}
              onCreate={createProject}
              onOpen={openProject}
              onEdit={(projectItem) =>
                editTitle('project', projectItem.id, projectItem.title)
              }
              onDelete={(projectItem) =>
                deleteItem('project', projectItem.id, projectItem.title)
              }
            />
          ))}
        {page === 'Codex' && (
          <CodexPage
            projects={projects}
            projectId={activeCodexProjectId}
            projectDetail={codexProjectDetail}
            entries={codexEntries}
            selected={selectedCodex}
            query={codexQuery}
            kind={codexKind}
            error={codexError}
            onProjectChange={(id) => {
              setCodexProjectId(id);
              setSelectedCodex(null);
            }}
            onQueryChange={setCodexQuery}
            onKindChange={setCodexKind}
            onReload={() => void refreshCodex(activeCodexProjectId)}
            onCreate={async (input) => {
              try {
                const created = await codexService.create({
                  ...input,
                  projectId: activeCodexProjectId,
                });
                await refreshCodex(activeCodexProjectId);
                setSelectedCodex(await codexService.detail(created.id));
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onUpdate={async (entry) => {
              try {
                await codexService.update(entry);
                await refreshCodex(activeCodexProjectId);
                setSelectedCodex(await codexService.detail(entry.id));
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onDelete={async (entry) => {
              if (
                !window.confirm(
                  `Delete “${entry.title}” and its Codex links? This cannot be undone.`,
                )
              )
                return;
              try {
                await codexService.remove(entry.id);
                setSelectedCodex(null);
                await refreshCodex(activeCodexProjectId);
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onSelect={async (entry) => {
              try {
                setSelectedCodex(await codexService.detail(entry.id));
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onLink={async (sourceId, targetId, label, linked) => {
              try {
                await codexService.linkEntries(sourceId, targetId, label, linked);
                setSelectedCodex(await codexService.detail(sourceId));
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onLinkLocation={async (entryId, chapterId, sceneId) => {
              try {
                await codexService.linkLocation({ entryId, chapterId, sceneId });
                setSelectedCodex(await codexService.detail(entryId));
              } catch (cause) {
                setCodexError(errorMessage(cause));
                throw cause;
              }
            }}
            onUnlinkLocation={async (entryId, chapterId, sceneId) => {
              try {
                await codexService.unlinkLocation({ entryId, chapterId, sceneId });
                setSelectedCodex(await codexService.detail(entryId));
              } catch (cause) {
                setCodexError(errorMessage(cause));
              }
            }}
            onJumpToLocation={async (sceneId, chapterId) => {
              const targetProject = projects.find(
                (item) => item.id === activeCodexProjectId,
              );
              if (!targetProject) return;
              try {
                const detail = await projectService.openProject(targetProject.id);
                setProject(detail);
                const scene = detail.chapters
                  .flatMap((item) => item.scenes)
                  .find((item) => item.id === sceneId);
                if (scene) applySelectedScene(scene);
                else if (chapterId) applySelectedScene(null);
                setPage('Library');
              } catch (cause) {
                setCodexError(errorMessage(cause));
              }
            }}
          />
        )}
        {page === 'Timeline' && (
          <TimelinePage
            projects={projects}
            projectId={activeTimelineProjectId}
            projectDetail={
              codexProjectDetail?.project.id === activeTimelineProjectId
                ? codexProjectDetail
                : project?.project.id === activeTimelineProjectId
                  ? project
                  : null
            }
            events={timelineEvents}
            error={timelineError}
            onProjectChange={setTimelineProjectId}
            onReload={() => void refreshTimeline(activeTimelineProjectId)}
            onCreate={async (input) => {
              const created = await timelineService.create(input);
              setTimelineEvents((items) =>
                [...items, created].sort((a, b) => a.sortOrder - b.sortOrder),
              );
            }}
            onUpdate={async (event) => {
              const updated = await timelineService.update(event);
              setTimelineEvents((items) =>
                items
                  .map((item) => (item.id === updated.id ? updated : item))
                  .sort((a, b) => a.sortOrder - b.sortOrder),
              );
            }}
            onDelete={async (event) => {
              await timelineService.remove(event.id);
              setTimelineEvents((items) => items.filter((item) => item.id !== event.id));
            }}
            onJumpToScene={(sceneId) => {
              const target = projects.find((item) => item.id === activeTimelineProjectId);
              if (!target || !sceneId) return;
              void projectService
                .openProject(target.id)
                .then((detail) => {
                  setProject(detail);
                  applySelectedScene(
                    detail.chapters
                      .flatMap((chapter) => chapter.scenes)
                      .find((scene) => scene.id === sceneId) ?? null,
                  );
                  setPage('Library');
                })
                .catch((cause) => setTimelineError(errorMessage(cause)));
            }}
          />
        )}
        {page === 'Library' &&
          project &&
          selectedCodex?.entry.projectId === project.project.id && (
            <CodexReferencePanel
              detail={selectedCodex}
              entries={codexEntries}
              onSelect={(entry) => {
                void codexService
                  .detail(entry.id)
                  .then(setSelectedCodex)
                  .catch((cause) => setCodexError(errorMessage(cause)));
              }}
              onClose={() => setSelectedCodex(null)}
            />
          )}
        {page === 'Settings' && (
          <SettingsPage
            theme={theme}
            onThemeChange={setTheme}
            textScale={textScale}
            onTextScaleChange={setTextScale}
            writingThemes={writingThemes}
            selectedWritingThemeId={writingThemeId}
            onSelectWritingTheme={setWritingThemeId}
            onSaveWritingThemes={setWritingThemes}
          />
        )}
      </main>
    </div>
  );
}

function errorMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return 'The local operation failed. Please try again.';
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

interface LibraryPageProps {
  projects: Project[];
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}

function LibraryPage({
  projects,
  loading,
  loadError,
  onRetry,
  onCreate,
  onOpen,
  onEdit,
  onDelete,
}: LibraryPageProps) {
  return (
    <section className="page-content" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WRITING SPACE</div>
          <h1 id="page-title">Good stories start somewhere.</h1>
          <p className="page-subtitle">
            A quiet place for the worlds only you can imagine.
          </p>
        </div>
        <button className="primary-button" onClick={onCreate} type="button">
          <Plus size={17} /> New project
        </button>
      </div>

      {loading ? (
        <div className="empty-state" role="status">
          Loading local projects…
        </div>
      ) : loadError ? (
        <div className="empty-state" role="alert">
          <h2>Projects could not be loaded.</h2>
          <p>{loadError}</p>
          <button className="secondary-button" onClick={onRetry} type="button">
            Retry loading projects
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-paper">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="art-spark spark-one">
              <Sparkles size={17} />
            </div>
            <div className="art-spark spark-two">
              <span>✳</span>
            </div>
          </div>
          <div className="empty-kicker">
            <span /> YOUR NEXT CHAPTER BEGINS HERE <span />
          </div>
          <h2>Your library is ready.</h2>
          <p>
            Create a project to begin organizing your chapters, scenes, and story ideas.
          </p>
          <div className="empty-state-note">
            <FileText size={15} />
            <span>Projects are saved on this device.</span>
          </div>
        </div>
      ) : (
        <div className="project-grid" aria-label="Local projects">
          {projects.map((item) => (
            <article className="project-card" key={item.id}>
              <button
                className="project-open"
                onClick={() => onOpen(item.id)}
                type="button"
              >
                <span className="project-card-icon">
                  <BookOpenText size={20} />
                </span>
                <strong>{item.title}</strong>
                <small>Updated {new Date(item.updatedAt).toLocaleDateString()}</small>
              </button>
              <div className="card-actions">
                <button
                  aria-label={`Rename ${item.title}`}
                  onClick={() => onEdit(item)}
                  type="button"
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label={`Delete ${item.title}`}
                  onClick={() => onDelete(item)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="page-footer">
        <span>
          <span className="footer-dot" /> Local-first workspace
        </span>
        <span>Made for the long story</span>
      </footer>
    </section>
  );
}

interface ProjectWorkspaceProps {
  project: ProjectDetail;
  selectedScene: Scene | null;
  sceneText: string;
  codexEntries: CodexEntry[];
  selectedCodex: CodexEntryDetail | null;
  projectTemplates: PromptTemplate[];
  writingTheme: WritingTheme;
  onGenerateCodex: (
    text: string,
    sourceSceneIds: string[],
    sourceLabel: string,
  ) => Promise<CodexSuggestion[]>;
  onCheckCodexDuplicate: (suggestion: CodexSuggestion) => Promise<CodexEntry | null>;
  onAcceptCodexSuggestion: (
    suggestion: CodexSuggestion,
    allowDuplicate?: boolean,
  ) => Promise<boolean>;
  aiHistory: AIHistoryItem[];
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  saveError: string;
  focusMode: boolean;
  onToggleFocus: () => void;
  onBack: () => void;
  onCreateChapter: () => void;
  onCreateScene: (chapter: ChapterWithScenes) => void;
  onDelete: (kind: 'chapter' | 'scene', id: string, title: string) => void;
  onEdit: (kind: 'chapter' | 'scene', id: string, title: string) => void;
  onMoveChapter: (index: number, direction: -1 | 1) => void;
  onMoveScene: (chapter: ChapterWithScenes, index: number, direction: -1 | 1) => void;
  onRetrySave: () => void;
  onFlushSave: () => void;
  onSaveChapterScene: (sceneId: string, content: string) => void;
  chapterSceneSaveStates: Record<string, 'saving' | 'saved' | 'error'>;
  chapterEditId: string | null;
  setChapterEditId: React.Dispatch<React.SetStateAction<string | null>>;
  chapterContents: Record<string, string>;
  setChapterContents: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  restoreError: string;
  setRestoreError: React.Dispatch<React.SetStateAction<string>>;
  aiPanelOpen: boolean;
  setAiPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  aiTriggerRef: React.RefObject<HTMLButtonElement | null>;
  selection: { start: number; end: number; text: string };
  setSelection: React.Dispatch<
    React.SetStateAction<{ start: number; end: number; text: string }>
  >;
  onSelectScene: (scene: Scene) => void;
  onSelectChapter: (chapter: ChapterWithScenes) => void;
  onTextChange: (text: string) => void;
  onSelectCodex: (entry: CodexEntry) => void;
  onSaveTemplates: (
    templates: import('../shared/aiPrompts').PromptTemplate[],
  ) => Promise<void>;
  onTemplateHistory: (item: import('../shared/aiPrompts').AIHistoryItem) => Promise<void>;
  onClearAiHistory: () => Promise<void>;
  onExport: (format: 'markdown' | 'text' | 'docx') => Promise<void>;
  onBackup: () => Promise<void>;
  onRestoreFile: (file: File) => Promise<void>;
}

interface CodexPageProps {
  projects: Project[];
  projectId: string;
  projectDetail: ProjectDetail | null;
  entries: CodexEntry[];
  selected: CodexEntryDetail | null;
  query: string;
  kind: string;
  error: string;
  onProjectChange: (id: string) => void;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: string) => void;
  onReload: () => void;
  onCreate: (
    input: Pick<CodexEntry, 'kind' | 'title' | 'description' | 'tags' | 'fields'>,
  ) => Promise<void>;
  onUpdate: (entry: CodexEntry) => Promise<void>;
  onDelete: (entry: CodexEntry) => Promise<void>;
  onSelect: (entry: CodexEntry) => Promise<void>;
  onLink: (
    sourceId: string,
    targetId: string,
    label: string,
    linked: boolean,
  ) => Promise<void>;
  onLinkLocation: (
    entryId: string,
    chapterId?: string,
    sceneId?: string,
  ) => Promise<void>;
  onUnlinkLocation: (
    entryId: string,
    chapterId?: string,
    sceneId?: string,
  ) => Promise<void>;
  onJumpToLocation: (sceneId?: string | null, chapterId?: string | null) => Promise<void>;
}

function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const {
    project,
    selectedScene,
    saveState,
    focusMode,
    chapterEditId,
    setChapterEditId,
    chapterContents,
    setChapterContents,
    restoreError,
    setRestoreError,
    aiPanelOpen,
    setAiPanelOpen,
    aiTriggerRef,
    selection,
    setSelection,
  } = props;
  const [codexSuggestions, setCodexSuggestions] = useState<CodexSuggestion[]>([]);
  const [checkingDuplicateIndex, setCheckingDuplicateIndex] = useState<number | null>(
    null,
  );
  const [codexSuggestionBusy, setCodexSuggestionBusy] = useState(false);
  const [codexSuggestionError, setCodexSuggestionError] = useState('');
  const [pendingCodexAnalysis, setPendingCodexAnalysis] = useState<{
    text: string;
    sceneIds: string[];
    label: string;
  } | null>(null);
  const { onTextChange } = props;
  const selectText = (textarea: HTMLTextAreaElement) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setSelection({ start, end, text: textarea.value.slice(start, end) });
  };
  const sceneDocument = parseStoredContent(props.sceneText);
  const wordCount = countWords(sceneDocument);
  const chapterWords =
    project.chapters
      .find((chapter) => chapter.scenes.some((scene) => scene.id === selectedScene?.id))
      ?.scenes.reduce(
        (total, scene) =>
          total +
          countWords(
            scene.id === selectedScene?.id
              ? sceneDocument
              : parseStoredContent(scene.content),
          ),
        0,
      ) ?? 0;
  const projectWords = project.chapters.reduce(
    (total, chapter) =>
      total +
      chapter.scenes.reduce(
        (sum, scene) =>
          sum +
          countWords(
            scene.id === selectedScene?.id
              ? sceneDocument
              : parseStoredContent(scene.content),
          ),
        0,
      ),
    0,
  );
  const activeChapter =
    project.chapters.find((chapter) =>
      chapter.scenes.some((scene) => scene.id === selectedScene?.id),
    ) ?? null;
  const chapterDocument = Boolean(
    chapterEditId && activeChapter?.chapter.id === chapterEditId,
  );
  const chapterWordCount =
    activeChapter?.scenes.reduce((total, scene) => {
      const text =
        chapterContents[scene.id] ??
        (scene.id === selectedScene?.id
          ? plainTextFromStoredContent(props.sceneText)
          : plainTextFromStoredContent(scene.content));
      return total + countWords(documentFromPlainText(text));
    }, 0) ?? 0;

  return (
    <section
      className={`page-content project-workspace${focusMode ? ' focus-mode' : ''}`}
      aria-labelledby="page-title"
    >
      <div className="page-heading">
        <div>
          <button className="back-button" onClick={props.onBack} type="button">
            ← Library
          </button>
          <div className="eyebrow">PROJECT WORKSPACE</div>
          <h1 id="page-title">{project.project.title}</h1>
        </div>
        <div className="heading-actions">
          {activeChapter && selectedScene && (
            <button
              className="secondary-button"
              aria-pressed={chapterDocument}
              onClick={() => {
                if (chapterDocument) {
                  setChapterEditId(null);
                  setChapterContents({});
                } else {
                  setChapterEditId(activeChapter.chapter.id);
                }
              }}
              type="button"
            >
              {chapterDocument ? 'Scene view' : 'Edit whole chapter'}
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => void props.onExport('markdown')}
            type="button"
          >
            Export Markdown
          </button>
          <button
            className="secondary-button"
            onClick={() => void props.onExport('text')}
            type="button"
          >
            Export plain text
          </button>
          <button
            className="secondary-button"
            onClick={() => void props.onExport('docx')}
            type="button"
          >
            Export DOCX
          </button>
          <button
            className="secondary-button"
            onClick={() => void props.onBackup()}
            type="button"
          >
            Backup project
          </button>
          <button
            className="secondary-button"
            onClick={() => document.getElementById('project-backup-input')?.click()}
            type="button"
          >
            Restore backup
          </button>
          <input
            accept="application/json,.json"
            aria-label="Choose project backup file"
            id="project-backup-input"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file && file.size > 50 * 1024 * 1024) {
                setRestoreError('Backup files must be 50 MB or smaller.');
              } else if (file) {
                setRestoreError('');
                void props.onRestoreFile(file);
              }
              event.currentTarget.value = '';
            }}
            type="file"
            hidden
          />
          <button
            className="secondary-button"
            ref={aiTriggerRef}
            aria-haspopup="dialog"
            onClick={() => setAiPanelOpen(true)}
            type="button"
          >
            AI writing
          </button>
          {selectedScene && (
            <button
              className="secondary-button"
              disabled={codexSuggestionBusy}
              onClick={() => {
                const text = plainTextFromStoredContent(props.sceneText);
                setPendingCodexAnalysis({
                  text,
                  sceneIds: [selectedScene.id],
                  label: selectedScene.title,
                });
                setCodexSuggestionError('');
              }}
              type="button"
            >
              {codexSuggestionBusy ? 'Analyzing…' : 'Suggest Codex from scene'}
            </button>
          )}
          {project.chapters.some((chapter) => chapter.scenes.length > 0) && (
            <button
              className="secondary-button"
              disabled={codexSuggestionBusy}
              onClick={() => {
                const scenes = project.chapters.flatMap((chapter) => chapter.scenes);
                const text = project.chapters
                  .map(
                    (chapter) =>
                      `${chapter.chapter.title}\n${chapter.scenes.map((scene) => `${scene.title}\n${plainTextFromStoredContent(scene.id === selectedScene?.id ? props.sceneText : (chapterContents[scene.id] ?? scene.content))}`).join('\n\n')}`,
                  )
                  .join('\n\n');
                setPendingCodexAnalysis({
                  text,
                  sceneIds: scenes.map((scene) => scene.id),
                  label: project.project.title,
                });
                setCodexSuggestionError('');
              }}
              type="button"
            >
              Suggest Codex from project
            </button>
          )}
          {activeChapter && chapterEditId === activeChapter.chapter.id && (
            <button
              className="secondary-button"
              disabled={codexSuggestionBusy}
              onClick={() => {
                const sourceChapter = project.chapters.find(
                  (chapter) => chapter.chapter.id === chapterEditId,
                );
                const sourceScenes = sourceChapter?.scenes ?? [];
                const text = sourceScenes
                  .map(
                    (scene) =>
                      `${scene.title}\n${plainTextFromStoredContent(chapterContents[scene.id] ?? scene.content)}`,
                  )
                  .join('\n\n');
                setPendingCodexAnalysis({
                  text,
                  sceneIds: sourceScenes.map((scene) => scene.id),
                  label: sourceChapter?.chapter.title ?? 'Selected chapter',
                });
                setCodexSuggestionError('');
              }}
              type="button"
            >
              {codexSuggestionBusy ? 'Analyzing…' : 'Suggest Codex from chapter'}
            </button>
          )}
          <button
            className="secondary-button"
            onClick={props.onToggleFocus}
            type="button"
            aria-pressed={focusMode}
          >
            {focusMode ? 'Exit focus' : 'Focus mode'}
          </button>
          {!focusMode && (
            <button
              className="primary-button"
              onClick={props.onCreateChapter}
              type="button"
            >
              <Plus size={16} /> New chapter
            </button>
          )}
        </div>
      </div>
      <div className="writing-layout">
        <aside
          className={`outline-panel${focusMode ? ' focus-outline' : ''}`}
          aria-label="Chapter and scene outline"
        >
          {project.chapters.length === 0 ? (
            <div className="outline-empty">
              No chapters yet. Add one to start organizing this project.
            </div>
          ) : (
            project.chapters.map((chapter, index) => (
              <section className="outline-chapter" key={chapter.chapter.id}>
                <div className="outline-heading">
                  <button
                    className="outline-chapter-title"
                    aria-label={`Edit all scenes in ${chapter.chapter.title}`}
                    aria-pressed={chapterEditId === chapter.chapter.id}
                    onClick={() => {
                      setChapterEditId(chapter.chapter.id);
                      if (
                        selectedScene?.id &&
                        chapter.scenes.some((scene) => scene.id === selectedScene.id)
                      )
                        return;
                      if (chapter.scenes[0]) props.onSelectScene(chapter.scenes[0]);
                      else props.onSelectChapter(chapter);
                    }}
                    type="button"
                  >
                    {chapter.chapter.title}
                  </button>
                  <div className="card-actions compact-actions">
                    <button
                      aria-label={`Move ${chapter.chapter.title} up`}
                      disabled={index === 0}
                      onClick={() => props.onMoveChapter(index, -1)}
                      type="button"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      aria-label={`Move ${chapter.chapter.title} down`}
                      disabled={index === project.chapters.length - 1}
                      onClick={() => props.onMoveChapter(index, 1)}
                      type="button"
                    >
                      <MoveDown size={14} />
                    </button>
                    <button
                      aria-label={`Rename ${chapter.chapter.title}`}
                      onClick={() =>
                        props.onEdit('chapter', chapter.chapter.id, chapter.chapter.title)
                      }
                      type="button"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      aria-label={`Delete ${chapter.chapter.title}`}
                      onClick={() =>
                        props.onDelete(
                          'chapter',
                          chapter.chapter.id,
                          chapter.chapter.title,
                        )
                      }
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {chapter.scenes.map((scene, sceneIndex) => (
                  <div className="outline-scene-row" key={scene.id}>
                    <button
                      className={`outline-scene${selectedScene?.id === scene.id ? ' selected' : ''}`}
                      aria-current={selectedScene?.id === scene.id ? 'page' : undefined}
                      onClick={() => props.onSelectScene(scene)}
                      type="button"
                    >
                      {scene.title}
                    </button>
                    <div className="card-actions compact-actions">
                      <button
                        aria-label={`Move ${scene.title} up`}
                        disabled={sceneIndex === 0}
                        onClick={() => props.onMoveScene(chapter, sceneIndex, -1)}
                        type="button"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        aria-label={`Move ${scene.title} down`}
                        disabled={sceneIndex === chapter.scenes.length - 1}
                        onClick={() => props.onMoveScene(chapter, sceneIndex, 1)}
                        type="button"
                      >
                        <MoveDown size={13} />
                      </button>
                      <button
                        aria-label={`Rename ${scene.title}`}
                        onClick={() => props.onEdit('scene', scene.id, scene.title)}
                        type="button"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        aria-label={`Delete ${scene.title}`}
                        onClick={() => props.onDelete('scene', scene.id, scene.title)}
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="add-scene"
                  onClick={() => props.onCreateScene(chapter)}
                  type="button"
                >
                  <Plus size={14} /> Add scene
                </button>
              </section>
            ))
          )}
        </aside>
        <div
          className="scene-editor"
          style={{ fontFamily: `"${props.writingTheme.fontFamily}", Georgia, serif` }}
        >
          {chapterDocument && activeChapter ? (
            <>
              <div className="scene-editor-heading">
                <div>
                  <span className="eyebrow">CHAPTER DOCUMENT</span>
                  <h2>{activeChapter.chapter.title}</h2>
                </div>
                <span className="save-status" role="status">
                  {activeChapter.scenes.some(
                    (scene) => props.chapterSceneSaveStates[scene.id] === 'error',
                  )
                    ? 'Could not save a scene'
                    : activeChapter.scenes.some(
                          (scene) => props.chapterSceneSaveStates[scene.id] === 'saving',
                        )
                      ? 'Saving chapter…'
                      : 'Saved locally'}
                </span>
              </div>
              <div className="chapter-document-editor">
                {activeChapter.scenes.map((scene) => (
                  <section className="chapter-scene-section" key={scene.id}>
                    <h3 className="chapter-scene-divider">
                      <span aria-hidden="true">
                        {props.writingTheme.sceneDivider === 'ornament'
                          ? '❦'
                          : '────────'}
                      </span>
                      <span>Scene · {scene.title}</span>
                      <span aria-hidden="true">
                        {props.writingTheme.sceneDivider === 'ornament'
                          ? '❦'
                          : '────────'}
                      </span>
                    </h3>
                    <textarea
                      aria-label={`Text for ${scene.title} in ${activeChapter.chapter.title}`}
                      className="scene-textarea chapter-scene-textarea"
                      value={
                        chapterContents[scene.id] ??
                        plainTextFromStoredContent(scene.content)
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        setChapterContents((current) => ({
                          ...current,
                          [scene.id]: value,
                        }));
                        props.onSaveChapterScene(
                          scene.id,
                          serializeEditorDocument(documentFromPlainText(value)),
                        );
                      }}
                      placeholder={`Begin writing ${scene.title}…`}
                      spellCheck
                    />
                    <span className="chapter-scene-save" role="status">
                      {props.chapterSceneSaveStates[scene.id] === 'error'
                        ? 'Could not save'
                        : props.chapterSceneSaveStates[scene.id] === 'saving'
                          ? 'Saving…'
                          : 'Saved locally'}
                    </span>
                    {props.chapterSceneSaveStates[scene.id] === 'error' && (
                      <button
                        className="secondary-button chapter-scene-retry"
                        onClick={() =>
                          props.onSaveChapterScene(
                            scene.id,
                            serializeEditorDocument(
                              documentFromPlainText(
                                chapterContents[scene.id] ??
                                  plainTextFromStoredContent(scene.content),
                              ),
                            ),
                          )
                        }
                        type="button"
                      >
                        Retry save {scene.title}
                      </button>
                    )}
                  </section>
                ))}
                {activeChapter.scenes.length === 0 && (
                  <p className="outline-empty">This chapter has no scenes yet.</p>
                )}
              </div>
              <div className="editor-footer">
                <span>
                  Chapter {chapterWordCount} words · Project {projectWords} words
                </span>
                <span className="keyboard-hint">
                  Each scene saves separately; divider labels are not manuscript text.
                </span>
              </div>
            </>
          ) : selectedScene ? (
            <>
              <div className="scene-editor-heading">
                <div>
                  <span className="eyebrow">SCENE</span>
                  <h2>{selectedScene.title}</h2>
                </div>
                <span
                  className={`save-status ${saveState === 'error' ? 'save-error' : ''}`}
                  role="status"
                >
                  {saveState === 'saving'
                    ? 'Saving…'
                    : saveState === 'unsaved'
                      ? 'Unsaved changes'
                      : saveState === 'error'
                        ? 'Could not save'
                        : 'Saved locally'}
                </span>
              </div>
              <div className="editor-canvas">
                <textarea
                  id="scene-source"
                  className="scene-textarea"
                  value={plainTextFromStoredContent(props.sceneText)}
                  onChange={(event) => {
                    const document = documentFromPlainText(event.target.value);
                    onTextChange(serializeEditorDocument(document));
                  }}
                  onSelect={(event) => selectText(event.currentTarget)}
                  onMouseUp={(event) => selectText(event.currentTarget)}
                  onKeyUp={(event) => selectText(event.currentTarget)}
                  aria-label={`Text for ${selectedScene.title}`}
                  placeholder="Begin writing this scene…"
                  spellCheck
                />
              </div>
              <div className="editor-footer">
                <span>
                  {wordCount} words · Chapter {chapterWords} · Project {projectWords}
                </span>
                <div className="save-actions">
                  {saveState === 'error' && (
                    <>
                      <span className="save-error-message" role="alert">
                        {props.saveError}
                      </span>
                      <button
                        className="secondary-button"
                        onClick={props.onRetrySave}
                        type="button"
                      >
                        Retry save
                      </button>
                    </>
                  )}
                  <span className="keyboard-hint">
                    Undo Ctrl/⌘+Z · Redo Ctrl/⌘+Shift+Z
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="section-empty">
              <div className="section-empty-icon">
                <FileText size={22} />
              </div>
              <h2>
                {project.chapters.length === 0
                  ? 'Your outline starts here.'
                  : 'Choose a scene to write.'}
              </h2>
              <p>
                {project.chapters.length === 0
                  ? 'Add a chapter, then create scenes to organize your manuscript.'
                  : 'Select a scene from the outline or add one to a chapter.'}
              </p>
            </div>
          )}
        </div>
      </div>
      {codexSuggestionError && (
        <p className="form-error" role="alert">
          {codexSuggestionError}
        </p>
      )}
      {pendingCodexAnalysis && (
        <section
          className="codex-suggestion-review"
          aria-label="Confirm Codex analysis scope"
        >
          <h2>Review text before analysis</h2>
          <p>
            This text will be sent to your configured AI provider. Review the exact
            content before continuing.
          </p>
          <p>
            <strong>Source:</strong> {pendingCodexAnalysis.label}
          </p>
          <textarea
            aria-label="Text to analyze for Codex"
            rows={8}
            value={pendingCodexAnalysis.text}
            onChange={(event) =>
              setPendingCodexAnalysis((current) =>
                current ? { ...current, text: event.target.value } : current,
              )
            }
          />
          <div className="heading-actions">
            <button
              className="primary-button"
              disabled={!pendingCodexAnalysis.text.trim() || codexSuggestionBusy}
              onClick={() => {
                const pending = pendingCodexAnalysis;
                setCodexSuggestionBusy(true);
                setCodexSuggestionError('');
                void props
                  .onGenerateCodex(pending.text, pending.sceneIds, pending.label)
                  .then((items) => {
                    setCodexSuggestions(items);
                    if (!items.length)
                      setCodexSuggestionError(
                        'No valid Codex suggestions were returned.',
                      );
                    if (items.length > 0) setPendingCodexAnalysis(null);
                  })
                  .catch((cause) => setCodexSuggestionError(errorMessage(cause)))
                  .finally(() => setCodexSuggestionBusy(false));
              }}
              type="button"
            >
              {codexSuggestionBusy ? 'Analyzing…' : 'Send reviewed text'}
            </button>
            <button
              className="text-button"
              disabled={codexSuggestionBusy}
              onClick={() => setPendingCodexAnalysis(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {codexSuggestions.length > 0 && (
        <section
          className="codex-suggestion-review"
          aria-label="Review Codex suggestions"
        >
          <div className="codex-suggestion-heading">
            <div>
              <h2>Review Codex suggestions</h2>
              <p>
                Nothing is saved until you accept a suggestion. Check the evidence before
                adding it.
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => setCodexSuggestions([])}
              type="button"
            >
              Discard all
            </button>
          </div>
          {codexSuggestions.map((suggestion, index) => (
            <article
              className="codex-suggestion-card"
              key={`${suggestion.kind}-${suggestion.title}-${index}`}
            >
              <label>
                Type
                <select
                  value={suggestion.kind}
                  onChange={(event) =>
                    setCodexSuggestions((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              kind: event.target.value as CodexSuggestion['kind'],
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {['character', 'location', 'item', 'general'].map((kind) => (
                    <option key={kind} value={kind}>
                      {capitalize(kind)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input
                  value={suggestion.title}
                  onChange={(event) =>
                    setCodexSuggestions((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={suggestion.description}
                  onChange={(event) =>
                    setCodexSuggestions((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, description: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              {suggestion.evidence && (
                <blockquote>Evidence: “{suggestion.evidence}”</blockquote>
              )}
              {suggestion.duplicateTitle && (
                <p className="form-error" role="status">
                  Possible duplicate: “{suggestion.duplicateTitle}” already exists. Review
                  it before keeping a separate entry.
                </p>
              )}
              <div className="heading-actions">
                <button
                  className="primary-button"
                  disabled={!suggestion.title.trim()}
                  onClick={() =>
                    void props
                      .onAcceptCodexSuggestion(
                        suggestion,
                        Boolean(suggestion.duplicateTitle),
                      )
                      .then((saved) => {
                        if (saved)
                          setCodexSuggestions((items) =>
                            items.filter((_, itemIndex) => itemIndex !== index),
                          );
                      })
                      .catch((cause) => setCodexSuggestionError(errorMessage(cause)))
                  }
                  type="button"
                >
                  {suggestion.duplicateTitle ? 'Keep separate and add' : 'Accept and add'}
                </button>
                {!suggestion.duplicateTitle && (
                  <button
                    className="text-button"
                    disabled={checkingDuplicateIndex === index}
                    onClick={() =>
                      void (async () => {
                        setCheckingDuplicateIndex(index);
                        try {
                          const duplicate = await props.onCheckCodexDuplicate(suggestion);
                          setCodexSuggestions((items) =>
                            items.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...suggestion, duplicateTitle: duplicate?.title }
                                : item,
                            ),
                          );
                        } catch (cause) {
                          setCodexSuggestionError(errorMessage(cause));
                        } finally {
                          setCheckingDuplicateIndex(null);
                        }
                      })()
                    }
                    type="button"
                  >
                    Check duplicate
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    setCodexSuggestions((items) =>
                      items.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  Skip
                </button>
              </div>
            </article>
          ))}
          <button
            className="secondary-button"
            onClick={() => setCodexSuggestions([])}
            type="button"
          >
            Close review
          </button>
          <p className="codex-muted">
            Suggestions remain in this review only; none are added until accepted.
          </p>
        </section>
      )}
      {restoreError && (
        <p className="form-error" role="alert">
          {restoreError}
        </p>
      )}
      {props.codexEntries.length > 0 && (
        <div className="writer-codex-strip" aria-label="Project Codex reference">
          <strong>Codex</strong>
          {props.codexEntries.slice(0, 8).map((entry) => (
            <button
              className={props.selectedCodex?.entry.id === entry.id ? 'selected' : ''}
              key={entry.id}
              onClick={() => props.onSelectCodex(entry)}
              type="button"
            >
              {entry.title}
            </button>
          ))}
        </div>
      )}
      {aiPanelOpen && selectedScene && (
        <AiWritingPanel
          scene={selectedScene}
          sceneText={plainTextFromStoredContent(props.sceneText)}
          chapterTitle={
            project.chapters.find((chapter) =>
              chapter.scenes.some((scene) => scene.id === selectedScene.id),
            )?.chapter.title ?? ''
          }
          chapterText={
            project.chapters
              .find((chapter) =>
                chapter.scenes.some((scene) => scene.id === selectedScene.id),
              )
              ?.scenes.map(
                (scene) => `${scene.title}\n${plainTextFromStoredContent(scene.content)}`,
              )
              .join('\n\n') ?? ''
          }
          projectText={project.chapters
            .map(
              (chapter) =>
                `${chapter.chapter.title}\n${chapter.scenes.map((scene) => plainTextFromStoredContent(scene.content)).join('\n')}`,
            )
            .join('\n\n')}
          selection={selection}
          codexEntries={props.codexEntries}
          templates={props.projectTemplates}
          history={props.aiHistory}
          onSaveTemplates={props.onSaveTemplates}
          onSaveHistory={props.onTemplateHistory}
          onClearHistory={props.onClearAiHistory}
          onSelectionChange={setSelection}
          onApply={(text) =>
            props.onTextChange(serializeEditorDocument(documentFromPlainText(text)))
          }
          onClose={() => {
            setAiPanelOpen(false);
            window.setTimeout(() => aiTriggerRef.current?.focus(), 0);
          }}
        />
      )}
    </section>
  );
}

function TimelinePage(props: {
  projects: Project[];
  projectId: string;
  projectDetail: ProjectDetail | null;
  events: TimelineEvent[];
  error: string;
  onProjectChange: (id: string) => void;
  onReload: () => void;
  onCreate: (input: TimelineEventInput) => Promise<void>;
  onUpdate: (event: TimelineEvent) => Promise<void>;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onJumpToScene: (sceneId: string | null) => void;
}) {
  const project = props.projects.find((item) => item.id === props.projectId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [dateLabel, setDateLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [description, setDescription] = useState('');
  const [confidence, setConfidence] = useState<TimelineEvent['confidence']>('confirmed');
  const [sourceSceneId, setSourceSceneId] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [formError, setFormError] = useState('');

  const clearForm = () => {
    setEditingId(null);
    setTitle('');
    setDateLabel('');
    setSortOrder(String((props.events.at(-1)?.sortOrder ?? -1) + 1));
    setDescription('');
    setConfidence('confirmed');
    setSourceSceneId('');
    setDismissed(false);
    setFormError('');
  };
  const editEvent = (event: TimelineEvent) => {
    setEditingId(event.id);
    setTitle(event.title);
    setDateLabel(event.dateLabel);
    setSortOrder(String(event.sortOrder));
    setDescription(event.description);
    setConfidence(event.confidence);
    setSourceSceneId(event.sourceSceneId ?? '');
    setDismissed(event.dismissed);
    setFormError('');
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const order = Number(sortOrder);
    if (!title.trim() || !Number.isFinite(order)) {
      setFormError('Enter an event title and valid ordering number.');
      return;
    }
    try {
      if (editingId) {
        const current = props.events.find((item) => item.id === editingId);
        if (current)
          await props.onUpdate({
            ...current,
            title: title.trim(),
            dateLabel,
            sortOrder: order,
            description,
            confidence,
            sourceSceneId: sourceSceneId || null,
            dismissed,
          });
      } else {
        await props.onCreate({
          projectId: props.projectId,
          title: title.trim(),
          dateLabel,
          sortOrder: order,
          description,
          confidence,
          sourceSceneId: sourceSceneId || null,
          dismissed,
        });
      }
      clearForm();
    } catch (cause) {
      setFormError(errorMessage(cause));
    }
  };

  const visibleEvents = props.events.filter(
    (event) => includeDismissed || !event.dismissed,
  );
  return (
    <section className="page-content timeline-page" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">STORY CHRONOLOGY</div>
          <h1 id="page-title">Timeline</h1>
          <p className="page-subtitle">
            Manually record story events and their source passages.
          </p>
        </div>
        <label>
          Project
          <select
            aria-label="Timeline project"
            value={props.projectId}
            onChange={(event) => props.onProjectChange(event.target.value)}
          >
            {props.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.error && (
        <p className="form-error" role="alert">
          {props.error}
        </p>
      )}
      {!project ? (
        <div className="section-empty">
          <h2>Choose a project first.</h2>
          <p>Create a local project before adding story events.</p>
        </div>
      ) : (
        <div className="timeline-layout">
          <section className="timeline-list" aria-label="Timeline events">
            <div className="timeline-toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={includeDismissed}
                  onChange={(event) => setIncludeDismissed(event.target.checked)}
                />{' '}
                Show dismissed
              </label>
              <button className="secondary-button" onClick={props.onReload} type="button">
                Refresh
              </button>
            </div>
            {visibleEvents.length === 0 ? (
              <p className="codex-muted">
                No timeline events yet. Add events manually; later analysis suggestions
                should always be reviewed before saving.
              </p>
            ) : (
              visibleEvents.map((event) => (
                <article
                  className={`timeline-event${event.dismissed ? ' is-dismissed' : ''}`}
                  key={event.id}
                >
                  <span className="timeline-date">
                    {event.dateLabel || `Order ${event.sortOrder}`}
                  </span>
                  <div>
                    <h2>{event.title}</h2>
                    <p>{event.description || 'No notes.'}</p>
                    <small>
                      {event.confidence}
                      {event.sourceSceneId ? ' · linked to manuscript' : ''}
                      {event.dismissed ? ' · dismissed' : ''}
                    </small>
                  </div>
                  {event.sourceSceneId && (
                    <button
                      className="text-button"
                      onClick={() => props.onJumpToScene(event.sourceSceneId)}
                      type="button"
                    >
                      Open source
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => editEvent(event)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void props.onUpdate({ ...event, dismissed: !event.dismissed })
                    }
                    type="button"
                  >
                    {event.dismissed ? 'Restore' : 'Dismiss'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (window.confirm(`Delete timeline event “${event.title}”?`))
                        void props.onDelete(event);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </article>
              ))
            )}
          </section>
          <form className="timeline-form" onSubmit={(event) => void submit(event)}>
            <h2>{editingId ? 'Edit event' : 'Add event'}</h2>
            <label>
              Event title
              <input
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <label>
              Date or time expression
              <input
                value={dateLabel}
                maxLength={120}
                onChange={(event) => setDateLabel(event.target.value)}
                placeholder="e.g. Three days after the storm"
              />
            </label>
            <label>
              Order
              <input
                type="number"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                step="any"
              />
            </label>
            <label>
              Notes
              <textarea
                rows={4}
                value={description}
                maxLength={10000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Confidence
              <select
                value={confidence}
                onChange={(event) =>
                  setConfidence(event.target.value as TimelineEvent['confidence'])
                }
              >
                <option value="confirmed">Confirmed</option>
                <option value="inferred">Inferred</option>
                <option value="uncertain">Uncertain</option>
              </select>
            </label>
            <label>
              Source scene
              <select
                value={sourceSceneId}
                onChange={(event) => setSourceSceneId(event.target.value)}
              >
                <option value="">No source linked</option>
                {props.projectDetail?.chapters.map((chapter) => (
                  <Fragment key={chapter.chapter.id}>
                    {chapter.scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {chapter.chapter.title} / {scene.title}
                      </option>
                    ))}
                  </Fragment>
                ))}
              </select>
            </label>
            <p className="codex-muted">
              Timeline facts are manual in this version. No manuscript text is
              automatically analyzed.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="heading-actions">
              <button className="primary-button" type="submit">
                {editingId ? 'Save event' : 'Add event'}
              </button>
              {editingId && (
                <button className="text-button" onClick={clearForm} type="button">
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function CodexPage(props: CodexPageProps) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState('character');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [fieldsText, setFieldsText] = useState('{}');
  const [formError, setFormError] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [relatedLabel, setRelatedLabel] = useState('');
  const [locationId, setLocationId] = useState('');

  const beginCreate = () => {
    setEditing(false);
    setCreating(true);
    setKind('character');
    setTitle('');
    setDescription('');
    setTagsText('');
    setFieldsText('{}');
    setFormError('');
  };

  const beginEdit = () => {
    if (!props.selected) return;
    setCreating(false);
    const { entry } = props.selected;
    setEditing(true);
    setKind(entry.kind);
    setTitle(entry.title);
    setDescription(entry.description);
    setTagsText(entry.tags.join(', '));
    setFieldsText(JSON.stringify(entry.fields, null, 2));
    setFormError('');
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    let fields: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(fieldsText || '{}');
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Structured fields must be a JSON object.');
      }
      fields = parsed as Record<string, unknown>;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Enter valid JSON fields.');
      return;
    }
    const tags = [
      ...new Set(
        tagsText
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    const input = { kind, title: title.trim(), description, tags, fields };
    if (!input.title) {
      setFormError('A title is required.');
      return;
    }
    const operation =
      editing && props.selected
        ? Promise.resolve(props.onUpdate({ ...props.selected.entry, ...input }))
        : Promise.resolve(props.onCreate(input));
    setEditing(false);
    setCreating(false);
    void operation.then(props.onReload);
  };

  const selectedEntry = props.selected?.entry;
  const selectedProject = props.projects.find(
    (project) => project.id === props.projectId,
  );

  return (
    <section className="page-content codex-page" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">STORY REFERENCE</div>
          <h1 id="page-title">Codex</h1>
          <p className="page-subtitle">
            Keep characters, places, objects, and other story facts organized by project.
          </p>
        </div>
        <div className="heading-actions">
          {props.projects.length > 1 && (
            <label className="sr-only" htmlFor="codex-project">
              Project
            </label>
          )}
          {props.projects.length > 1 && (
            <select
              id="codex-project"
              className="codex-select"
              value={props.projectId}
              onChange={(event) => props.onProjectChange(event.target.value)}
            >
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={!props.projectId}
            onClick={beginCreate}
          >
            <Plus size={16} /> New entry
          </button>
        </div>
      </div>
      {props.error && (
        <div className="error-banner" role="alert">
          {props.error}
        </div>
      )}
      {!props.projectId ? (
        <div className="section-empty">
          <div className="section-empty-icon">
            <BookOpenText size={23} />
          </div>
          <h2>Choose a project first.</h2>
          <p>Create a local project to keep its story reference together.</p>
        </div>
      ) : (
        <div className="codex-layout">
          <section className="codex-browser" aria-label="Codex entries">
            <div className="codex-filters">
              <label className="sr-only" htmlFor="codex-search">
                Search Codex
              </label>
              <input
                id="codex-search"
                type="search"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
                placeholder="Search entries…"
              />
              <label className="sr-only" htmlFor="codex-kind">
                Filter by type
              </label>
              <select
                id="codex-kind"
                value={props.kind}
                onChange={(event) => props.onKindChange(event.target.value)}
              >
                <option value="">All types</option>
                {['character', 'location', 'item', 'general'].map((value) => (
                  <option key={value} value={value}>
                    {capitalize(value)}
                  </option>
                ))}
              </select>
            </div>
            {props.entries.length === 0 ? (
              <div className="codex-empty">
                <BookOpenText size={23} />
                <h2>
                  {props.query || props.kind
                    ? 'No matching entries.'
                    : 'No Codex entries yet.'}
                </h2>
                <p>
                  {props.query || props.kind
                    ? 'Try another search or filter.'
                    : 'Create a character, location, item, or general story note.'}
                </p>
                {!props.query && !props.kind && (
                  <button
                    className="secondary-button"
                    onClick={beginCreate}
                    type="button"
                  >
                    Create first entry
                  </button>
                )}
              </div>
            ) : (
              <div className="codex-list">
                {props.entries.map((entry) => (
                  <button
                    className={`codex-list-item${selectedEntry?.id === entry.id ? ' selected' : ''}`}
                    key={entry.id}
                    onClick={() => {
                      setEditing(false);
                      props.onSelect(entry);
                    }}
                    type="button"
                  >
                    <span className="codex-kind">{capitalize(entry.kind)}</span>
                    <strong>{entry.title}</strong>
                    <span>{entry.description || 'No description yet.'}</span>
                    {entry.tags.length > 0 && <small>{entry.tags.join(' · ')}</small>}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="codex-detail" aria-label="Codex entry details">
            {editing || creating ? (
              <form className="codex-form" onSubmit={submit}>
                <div className="codex-form-heading">
                  <h2>{editing ? 'Edit entry' : 'New entry'}</h2>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(false);
                      setCreating(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
                <label>
                  Type
                  <select value={kind} onChange={(event) => setKind(event.target.value)}>
                    {['character', 'location', 'item', 'general'].map((value) => (
                      <option key={value} value={value}>
                        {capitalize(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input
                    autoFocus
                    maxLength={200}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Description / notes
                  <textarea
                    rows={6}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label>
                  Tags <small>comma-separated</small>
                  <input
                    value={tagsText}
                    onChange={(event) => setTagsText(event.target.value)}
                    placeholder="mentor, northern kingdom"
                  />
                </label>
                <label>
                  Structured fields <small>JSON object</small>
                  <textarea
                    className="fields-input"
                    rows={5}
                    value={fieldsText}
                    onChange={(event) => setFieldsText(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                {formError && (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                )}
                <button className="primary-button" type="submit">
                  Save entry
                </button>
              </form>
            ) : props.selected ? (
              <CodexDetailView
                detail={props.selected}
                entries={props.entries}
                project={selectedProject}
                projectDetail={props.projectDetail}
                relatedId={relatedId}
                relatedLabel={relatedLabel}
                locationId={locationId}
                onEdit={beginEdit}
                onDelete={() => props.onDelete(props.selected!.entry)}
                onRelatedIdChange={setRelatedId}
                onRelatedLabelChange={setRelatedLabel}
                onLink={() => {
                  if (relatedId) {
                    props.onLink(props.selected!.entry.id, relatedId, relatedLabel, true);
                    setRelatedId('');
                    setRelatedLabel('');
                  }
                }}
                onUnlink={(targetId) =>
                  props.onLink(props.selected!.entry.id, targetId, '', false)
                }
                onLocationIdChange={setLocationId}
                onLinkLocation={() => {
                  if (locationId.startsWith('scene:'))
                    props.onLinkLocation(
                      props.selected!.entry.id,
                      undefined,
                      locationId.slice(6),
                    );
                  else if (locationId.startsWith('chapter:'))
                    props.onLinkLocation(
                      props.selected!.entry.id,
                      locationId.slice(8),
                      undefined,
                    );
                  setLocationId('');
                }}
                onUnlinkLocation={(link) =>
                  props.onUnlinkLocation(
                    props.selected!.entry.id,
                    link.chapterId ?? undefined,
                    link.sceneId ?? undefined,
                  )
                }
                onJumpToLocation={props.onJumpToLocation}
              />
            ) : (
              <div className="section-empty">
                <div className="section-empty-icon">
                  <BookOpenText size={22} />
                </div>
                <h2>Select an entry</h2>
                <p>
                  Choose an item to browse its details and links, or create a new Codex
                  entry.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function CodexDetailView(props: {
  detail: CodexEntryDetail;
  entries: CodexEntry[];
  project: Project | undefined;
  projectDetail: ProjectDetail | null;
  relatedId: string;
  relatedLabel: string;
  locationId: string;
  onEdit: () => void;
  onDelete: () => void;
  onRelatedIdChange: (value: string) => void;
  onRelatedLabelChange: (value: string) => void;
  onLink: () => void;
  onUnlink: (targetId: string) => void;
  onLocationIdChange: (value: string) => void;
  onLinkLocation: () => void;
  onUnlinkLocation: (link: CodexEntryDetail['manuscriptLinks'][number]) => void;
  onJumpToLocation: (sceneId?: string | null, chapterId?: string | null) => void;
}) {
  const { entry, links, manuscriptLinks } = props.detail;
  const candidates = props.entries.filter(
    (item) => item.id !== entry.id && !links.some((link) => link.id === item.id),
  );
  return (
    <div className="codex-entry-detail">
      <div className="codex-detail-heading">
        <div>
          <span className="codex-kind">{capitalize(entry.kind)}</span>
          <h2>{entry.title}</h2>
        </div>
        <div className="card-actions">
          <button aria-label={`Edit ${entry.title}`} onClick={props.onEdit} type="button">
            <Pencil size={15} />
          </button>
          <button
            aria-label={`Delete ${entry.title}`}
            onClick={props.onDelete}
            type="button"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {entry.description ? (
        <p className="codex-description">{entry.description}</p>
      ) : (
        <p className="codex-muted">No description provided.</p>
      )}
      {entry.tags.length > 0 && (
        <div className="codex-tags">
          {entry.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      {Object.keys(entry.fields).length > 0 && (
        <section className="codex-subsection">
          <h3>Details</h3>
          <dl className="codex-fields">
            {Object.entries(entry.fields).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}
      <section className="codex-subsection">
        <h3>Related entries</h3>
        {links.length === 0 ? (
          <p className="codex-muted">No related entries yet.</p>
        ) : (
          <ul className="codex-links">
            {links.map((link) => (
              <li key={link.id}>
                <span>
                  <strong>{link.title}</strong>
                  <small>
                    {capitalize(link.kind)}
                    {link.label ? ` · ${link.label}` : ''}
                  </small>
                </span>
                <button
                  aria-label={`Unlink ${link.title}`}
                  onClick={() => props.onUnlink(link.id)}
                  type="button"
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 0 && (
          <div className="codex-link-form">
            <select
              aria-label="Related entry"
              value={props.relatedId}
              onChange={(event) => props.onRelatedIdChange(event.target.value)}
            >
              <option value="">Choose an entry…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title} · {capitalize(candidate.kind)}
                </option>
              ))}
            </select>
            <input
              aria-label="Relationship label"
              placeholder="Relationship (optional)"
              value={props.relatedLabel}
              onChange={(event) => props.onRelatedLabelChange(event.target.value)}
            />
            <button
              className="secondary-button"
              disabled={!props.relatedId}
              onClick={props.onLink}
              type="button"
            >
              <Link2 size={14} /> Link
            </button>
          </div>
        )}
      </section>
      <section className="codex-subsection">
        <h3>Manuscript locations</h3>
        {manuscriptLinks.length === 0 ? (
          <p className="codex-muted">Not linked to a chapter or scene.</p>
        ) : (
          <ul className="codex-links">
            {manuscriptLinks.map((link) => (
              <li key={link.sceneId ?? link.chapterId}>
                <button
                  className="location-link"
                  onClick={() => props.onJumpToLocation(link.sceneId, link.chapterId)}
                  type="button"
                >
                  {link.sceneTitle
                    ? `${link.chapterTitle} / ${link.sceneTitle}`
                    : link.chapterTitle}
                </button>
                <button
                  aria-label="Unlink manuscript location"
                  onClick={() => props.onUnlinkLocation(link)}
                  type="button"
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.project && (
          <div className="codex-link-form">
            <select
              aria-label="Chapter or scene"
              value={props.locationId}
              onChange={(event) => props.onLocationIdChange(event.target.value)}
            >
              <option value="">Choose a chapter or scene…</option>
              {props.projectDetail?.chapters.map((chapter) => (
                <Fragment key={chapter.chapter.id}>
                  <option value={`chapter:${chapter.chapter.id}`}>
                    {chapter.chapter.title}
                  </option>
                  {chapter.scenes.map((scene) => (
                    <option key={scene.id} value={`scene:${scene.id}`}>
                      {chapter.chapter.title} / {scene.title}
                    </option>
                  ))}
                </Fragment>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={!props.locationId}
              onClick={props.onLinkLocation}
              type="button"
            >
              Link location
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function CodexReferencePanel(props: {
  detail: CodexEntryDetail;
  entries: CodexEntry[];
  onSelect: (entry: CodexEntry) => void;
  onClose: () => void;
}) {
  const { entry, links, manuscriptLinks } = props.detail;
  return (
    <aside className="codex-reference-panel" aria-label="Codex reference while writing">
      <div className="codex-reference-heading">
        <div>
          <span className="eyebrow">CODEX REFERENCE</span>
          <h2>{entry.title}</h2>
        </div>
        <button className="text-button" onClick={props.onClose} type="button">
          Close
        </button>
      </div>
      <span className="codex-kind">{capitalize(entry.kind)}</span>
      {entry.description && <p>{entry.description}</p>}
      {entry.tags.length > 0 && (
        <div className="codex-tags">
          {entry.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <section className="codex-subsection">
          <h3>Related entries</h3>
          {links.map((link) => {
            const target = props.entries.find((item) => item.id === link.id);
            return target ? (
              <button
                key={link.id}
                className="codex-reference-link"
                onClick={() => props.onSelect(target)}
                type="button"
              >
                {link.title} <small>{capitalize(link.kind)}</small>
              </button>
            ) : (
              <p key={link.id}>{link.title}</p>
            );
          })}
        </section>
      )}
      {manuscriptLinks.length > 0 && (
        <section className="codex-subsection">
          <h3>Appears in</h3>
          {manuscriptLinks.map((link) => (
            <p key={link.sceneId ?? link.chapterId}>
              {link.sceneTitle
                ? `${link.chapterTitle} / ${link.sceneTitle}`
                : link.chapterTitle}
            </p>
          ))}
        </section>
      )}
      <p className="codex-muted">
        Reference only. Codex details never change manuscript text.
      </p>
    </aside>
  );
}

function providerLabel(provider: string): string {
  return (
    {
      'openai-compatible': 'OpenAI-compatible',
      openrouter: 'OpenRouter',
      ollama: 'Ollama (local)',
    }[provider] ?? provider
  );
}

function providerCredentialAccount(provider: string): string {
  return provider === 'openai-compatible' ? 'openai-compatible' : provider;
}

function providerEndpointHint(provider: string): string {
  return (
    {
      'openai-compatible': 'https://api.openai.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      ollama: 'http://127.0.0.1:11434/v1',
    }[provider] ?? 'Provider endpoint URL'
  );
}

function SettingsPage(props: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  textScale: TextScale;
  onTextScaleChange: (scale: TextScale) => void;
  writingThemes: WritingTheme[];
  selectedWritingThemeId: string;
  onSelectWritingTheme: (id: string) => void;
  onSaveWritingThemes: (themes: WritingTheme[]) => void;
}) {
  const selectedWritingTheme =
    props.writingThemes.find((item) => item.id === props.selectedWritingThemeId) ??
    props.writingThemes[0];
  const updateWritingTheme = (patch: Partial<WritingTheme>) => {
    if (!selectedWritingTheme) return;
    props.onSaveWritingThemes(
      props.writingThemes.map((item) =>
        item.id === selectedWritingTheme.id ? { ...item, ...patch } : item,
      ),
    );
  };
  const createWritingTheme = () => {
    const theme: WritingTheme = {
      ...DEFAULT_WRITING_THEMES[0],
      id: crypto.randomUUID(),
      name: 'My writing theme',
    };
    props.onSaveWritingThemes([...props.writingThemes, theme]);
    props.onSelectWritingTheme(theme.id);
  };
  const [settings, setSettings] = useState<AiSettings>({
    provider: 'openai-compatible',
    model: '',
    endpoint: 'https://api.openai.com/v1',
  });
  const [themeError, setThemeError] = useState('');
  const [credentialPresent, setCredentialPresent] = useState(false);
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const providerHasCredential = settings.provider !== 'ollama';

  const changeProvider = async (provider: string) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const next = await aiService.configureProvider(provider);
      setSettings(next);
      setSecret('');
      const present =
        provider === 'ollama'
          ? false
          : await aiService.hasCredential(providerCredentialAccount(provider));
      setCredentialPresent(present);
      setStatus(`${providerLabel(provider)} selected. Configure a model before use.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (settings.provider !== provider) setCredentialPresent(false);
      setBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void aiService
      .getSettings()
      .then((value) => {
        if (!mounted) return;
        setSettings(value);
        return aiService
          .hasCredential(providerCredentialAccount(value.provider))
          .then(setCredentialPresent);
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (mounted) setSettingsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const saveSettings = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const saved = await aiService.saveSettings(settings);
      setSettings(saved);
      setStatus('Provider settings saved on this device.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveCredential = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await aiService.saveCredential(
        providerCredentialAccount(settings.provider),
        secret,
      );
      setSecret('');
      setCredentialPresent(true);
      setStatus('Credential saved in the operating system credential store.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeCredential = async () => {
    setBusy(true);
    setError('');
    try {
      await aiService.deleteCredential(providerCredentialAccount(settings.provider));
      setCredentialPresent(false);
      setStatus('Credential removed from the operating system credential store.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setError('');
    setStatus('Testing connection…');
    try {
      await aiService.saveSettings(settings);
      await aiService.testConnection();
      setStatus('Connection test succeeded.');
    } catch (cause) {
      setStatus('');
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshOllamaModels = async () => {
    setModelsBusy(true);
    setError('');
    setStatus('Loading models from Ollama…');
    try {
      const models = await aiService.listOllamaModels(settings.endpoint);
      setOllamaModels(models);
      setStatus(
        models.length
          ? `Found ${models.length} Ollama model${models.length === 1 ? '' : 's'}.`
          : 'Ollama is available, but no models are installed yet.',
      );
    } catch (cause) {
      setStatus('');
      setError(errorMessage(cause));
    } finally {
      setModelsBusy(false);
    }
  };

  return (
    <section className="page-content secondary-page" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1 id="page-title">Settings</h1>
          <p className="page-subtitle">A few details about how Noveler works.</p>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-card-icon">
          <HardDrive size={19} />
        </div>
        <div>
          <h2>Local workspace</h2>
          <p>This app runs on your device. No account or cloud sync is configured.</p>
        </div>
        <span className="status-pill">
          <span className="local-indicator" /> Active
        </span>
      </div>
      <section className="settings-card" aria-labelledby="appearance-title">
        <div className="settings-card-icon" aria-hidden="true">
          <Settings2 size={19} />
        </div>
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p>Choose a comfortable color theme. The setting stays on this device.</p>
        </div>
        <label className="theme-control">
          <span className="sr-only">Color theme</span>
          <select
            aria-label="Color theme"
            value={props.theme}
            onChange={(event) => props.onThemeChange(event.target.value as Theme)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="theme-control">
          <span>Text size</span>
          <select
            aria-label="Text size"
            value={props.textScale}
            onChange={(event) => props.onTextScaleChange(event.target.value as TextScale)}
          >
            <option value="1">Default</option>
            <option value="1.15">Larger</option>
            <option value="1.3">Largest</option>
          </select>
        </label>
      </section>
      <section
        className="settings-card writing-theme-settings"
        aria-labelledby="writing-theme-title"
      >
        <div>
          <h2 id="writing-theme-title">Writing themes</h2>
          <p>Customize the manuscript page. Your themes are stored on this device.</p>
        </div>
        <div className="writing-theme-controls">
          <label>
            Selected writing theme
            <select
              aria-label="Writing theme"
              value={selectedWritingTheme?.id ?? ''}
              onChange={(event) => props.onSelectWritingTheme(event.target.value)}
            >
              {props.writingThemes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="heading-actions">
            <button
              className="secondary-button"
              onClick={createWritingTheme}
              type="button"
            >
              Create theme
            </button>
            {selectedWritingTheme && props.writingThemes.length > 1 && (
              <button
                className="text-button"
                onClick={() => {
                  const next = props.writingThemes.filter(
                    (item) => item.id !== selectedWritingTheme.id,
                  );
                  props.onSaveWritingThemes(next);
                  props.onSelectWritingTheme(next[0].id);
                }}
                type="button"
              >
                Delete selected
              </button>
            )}
          </div>
          {selectedWritingTheme && (
            <>
              <label>
                Theme name
                <input
                  aria-label="Writing theme name"
                  value={selectedWritingTheme.name}
                  onChange={(event) => updateWritingTheme({ name: event.target.value })}
                  maxLength={80}
                />
              </label>
              <label>
                Writing font
                <select
                  aria-label="Writing font"
                  value={selectedWritingTheme.fontFamily}
                  onChange={(event) =>
                    updateWritingTheme({ fontFamily: event.target.value })
                  }
                >
                  {WRITING_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Heading font
                <select
                  aria-label="Writing heading font"
                  value={
                    selectedWritingTheme.headingFontFamily ??
                    selectedWritingTheme.fontFamily
                  }
                  onChange={(event) =>
                    updateWritingTheme({ headingFontFamily: event.target.value })
                  }
                >
                  {WRITING_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Scene divider
                <select
                  aria-label="Scene divider style"
                  value={selectedWritingTheme.sceneDivider ?? 'line'}
                  onChange={(event) =>
                    updateWritingTheme({
                      sceneDivider: event.target.value as WritingTheme['sceneDivider'],
                    })
                  }
                >
                  <option value="line">Line</option>
                  <option value="ornament">Ornament</option>
                  <option value="simple">Simple</option>
                </select>
              </label>
              <label>
                Content width · {selectedWritingTheme.contentWidth}px
                <input
                  aria-label="Writing content width"
                  type="range"
                  min="480"
                  max="1200"
                  step="20"
                  value={selectedWritingTheme.contentWidth}
                  onChange={(event) =>
                    updateWritingTheme({ contentWidth: Number(event.target.value) })
                  }
                />
              </label>
              <div className="heading-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    const copy = {
                      ...selectedWritingTheme,
                      id: crypto.randomUUID(),
                      name: `${selectedWritingTheme.name} copy`,
                    };
                    props.onSaveWritingThemes([...props.writingThemes, copy]);
                    props.onSelectWritingTheme(copy.id);
                  }}
                  type="button"
                >
                  Duplicate theme
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const blob = new Blob([exportWritingTheme(selectedWritingTheme)], {
                      type: 'application/json',
                    });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `${selectedWritingTheme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.noveler-theme.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  type="button"
                >
                  Export theme
                </button>
                <button
                  className="secondary-button"
                  onClick={() => document.getElementById('writing-theme-import')?.click()}
                  type="button"
                >
                  Import theme
                </button>
                <input
                  id="writing-theme-import"
                  type="file"
                  accept="application/json,.json"
                  aria-label="Import writing theme"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (!file) return;
                    setThemeError('');
                    void file
                      .text()
                      .then((text) => {
                        const imported = parseWritingThemeImport(text);
                        if (props.writingThemes.length >= 100)
                          throw new Error(
                            'A maximum of 100 writing themes is supported.',
                          );
                        props.onSaveWritingThemes([...props.writingThemes, imported]);
                        props.onSelectWritingTheme(imported.id);
                      })
                      .catch((cause) => setThemeError(errorMessage(cause)));
                  }}
                />
              </div>
              {themeError && (
                <p className="form-error" role="alert">
                  {themeError}
                </p>
              )}
              <div className="theme-color-row">
                <label>
                  Page color
                  <input
                    aria-label="Page color"
                    type="color"
                    value={selectedWritingTheme.background}
                    onChange={(event) =>
                      updateWritingTheme({ background: event.target.value })
                    }
                  />
                </label>
                <label>
                  Text color
                  <input
                    aria-label="Text color"
                    type="color"
                    value={selectedWritingTheme.foreground}
                    onChange={(event) =>
                      updateWritingTheme({ foreground: event.target.value })
                    }
                  />
                </label>
              </div>
              {contrastRatio(
                selectedWritingTheme.background,
                selectedWritingTheme.foreground,
              ) < 4.5 && (
                <p className="form-error" role="alert">
                  Text contrast is below the recommended 4.5:1. Choose more contrasting
                  colors for readability.
                </p>
              )}
              <label>
                Text size · {selectedWritingTheme.fontSize}px
                <input
                  aria-label="Writing font size"
                  type="range"
                  min="14"
                  max="32"
                  value={selectedWritingTheme.fontSize}
                  onChange={(event) =>
                    updateWritingTheme({ fontSize: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Line spacing · {selectedWritingTheme.lineHeight.toFixed(2)}
                <input
                  aria-label="Writing line spacing"
                  type="range"
                  min="1.2"
                  max="2.4"
                  step="0.05"
                  value={selectedWritingTheme.lineHeight}
                  onChange={(event) =>
                    updateWritingTheme({ lineHeight: Number(event.target.value) })
                  }
                />
              </label>
              <div
                className="writing-theme-preview"
                style={{
                  background: selectedWritingTheme.background,
                  color: selectedWritingTheme.foreground,
                  fontFamily: `"${selectedWritingTheme.fontFamily}", Georgia, serif`,
                  fontSize: `${selectedWritingTheme.fontSize}px`,
                  lineHeight: selectedWritingTheme.lineHeight,
                }}
              >
                <strong>A sample manuscript page</strong>
                <p>
                  The quick brown fox crosses the old bridge as morning light fills the
                  valley.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="ai-settings-card" aria-labelledby="ai-settings-title">
        <div className="settings-card-icon">
          <Sparkles size={19} />
        </div>
        <div className="ai-settings-content">
          {settingsLoading && (
            <p className="ai-status" role="status">
              Loading provider settings…
            </p>
          )}
          <div>
            <h2 id="ai-settings-title">Bring your own AI provider</h2>
            <p>
              Requests are sent only when you explicitly start an AI action. Manuscript
              and Codex text is not sent automatically.
            </p>
          </div>
          <label>
            Provider
            <select
              value={settings.provider}
              disabled={busy || settingsLoading}
              onChange={(event) => void changeProvider(event.target.value)}
            >
              <option value="openai-compatible">OpenAI-compatible endpoint</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </label>
          <label>
            Model
            {settings.provider === 'ollama' && ollamaModels.length > 0 ? (
              <select
                aria-label="Model"
                value={settings.model}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value })
                }
              >
                {!ollamaModels.includes(settings.model) && settings.model && (
                  <option value={settings.model}>{settings.model} (selected)</option>
                )}
                {ollamaModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Model"
                value={settings.model}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value })
                }
                placeholder={
                  settings.provider === 'ollama'
                    ? 'e.g. llama3.2'
                    : settings.provider === 'openrouter'
                      ? 'e.g. openai/gpt-4o-mini'
                      : 'e.g. gpt-4o-mini'
                }
              />
            )}
          </label>
          {settings.provider === 'ollama' && (
            <div className="ai-settings-actions">
              <button
                className="secondary-button"
                disabled={busy || modelsBusy || settingsLoading}
                onClick={() => void refreshOllamaModels()}
                type="button"
              >
                {modelsBusy ? 'Loading models…' : 'List available models'}
              </button>
              <span className="settings-footnote">
                Lists models installed in your local Ollama instance.
              </span>
            </div>
          )}
          <label>
            Endpoint
            <input
              value={settings.endpoint}
              onChange={(event) =>
                setSettings({ ...settings, endpoint: event.target.value })
              }
              placeholder={providerEndpointHint(settings.provider)}
              aria-describedby="provider-endpoint-help"
            />
          </label>
          <p id="provider-endpoint-help" className="settings-footnote">
            {settings.provider === 'ollama'
              ? 'Ollama requests stay on this device and must use a local address, such as http://127.0.0.1:11434/v1. No API key is required.'
              : settings.provider === 'openrouter'
                ? 'OpenRouter sends requests to OpenRouter using its OpenAI-compatible API. An OpenRouter API key is required.'
                : 'OpenAI-compatible endpoints send requests to the configured service. An API key is required.'}
          </p>
          {settings.provider === 'ollama' && (
            <p className="settings-footnote">
              Ollama exposes its API without authentication by default. Keep the server
              bound to localhost and do not expose it to untrusted networks.
            </p>
          )}
          <button
            className="secondary-button"
            disabled={busy || settingsLoading}
            onClick={() => void saveSettings()}
            type="button"
          >
            Save provider settings
          </button>
          {providerHasCredential ? (
            <div className="credential-row">
              <label>
                API key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={
                    credentialPresent ? 'Key stored securely' : 'Enter API key'
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy || settingsLoading || !secret.trim()}
                onClick={() => void saveCredential()}
                type="button"
              >
                Save key securely
              </button>
              {credentialPresent && (
                <button
                  className="text-button"
                  disabled={busy || settingsLoading}
                  onClick={() => void removeCredential()}
                  type="button"
                >
                  Remove key
                </button>
              )}
            </div>
          ) : (
            <p className="credential-status" role="status">
              No API key needed for local Ollama.
            </p>
          )}
          <div className="ai-settings-actions">
            <span className="credential-status" role="status">
              {!providerHasCredential
                ? 'Using local Ollama without an API key.'
                : credentialPresent
                  ? 'A key is stored in the OS credential store.'
                  : 'No key stored.'}
            </span>
            <button
              className="primary-button"
              disabled={
                busy ||
                settingsLoading ||
                (providerHasCredential && !credentialPresent) ||
                !settings.model.trim()
              }
              onClick={() => void testConnection()}
              type="button"
            >
              {busy ? 'Please wait…' : 'Test connection'}
            </button>
          </div>
          {status && (
            <p className="ai-status" role="status">
              {status}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="settings-footnote">
            API keys are stored using the operating system credential manager, never in
            SQLite or browser storage. Provider requests leave this device when you
            initiate them.
          </p>
        </div>
      </section>
      <p className="settings-footnote">
        Your manuscript remains local. AI requests are sent only after you explicitly
        initiate them and review their context.
      </p>
    </section>
  );
}

export default App;
