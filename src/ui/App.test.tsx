import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectDetail } from '../shared/contracts';
import { createDebouncedAction } from '../shared/debouncedAction';
import AiWritingPanel from './AiWritingPanel';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/aiPrompts';
import App from './App';

const projectServiceMock = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  openProject: vi.fn(),
  createChapter: vi.fn(),
  renameChapter: vi.fn(),
  deleteChapter: vi.fn(),
  reorderChapters: vi.fn(),
  createScene: vi.fn(),
  renameScene: vi.fn(),
  deleteScene: vi.fn(),
  reorderScenes: vi.fn(),
  saveSceneContent: vi.fn(),
  saveChapterSceneContents: vi.fn(),
}));

vi.mock('../shared/projects', () => ({ projectService: projectServiceMock }));

const codexServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  createWithSources: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  linkEntries: vi.fn(),
  linkLocation: vi.fn(),
  unlinkLocation: vi.fn(),
}));

vi.mock('../shared/codex', () => ({ codexService: codexServiceMock }));

const aiServiceMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  configureProvider: vi.fn(),
  hasCredential: vi.fn(),
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
  testConnection: vi.fn(),
  listOllamaModels: vi.fn(),
  chat: vi.fn(),
  getLocalData: vi.fn(),
  saveTemplates: vi.fn(),
  recordInteraction: vi.fn(),
  clearHistory: vi.fn(),
  getAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
}));

vi.mock('../shared/ai', () => ({ aiService: aiServiceMock }));

const timelineServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../shared/timeline', async () => {
  const actual =
    await vi.importActual<typeof import('../shared/timeline')>('../shared/timeline');
  return { ...actual, timelineService: timelineServiceMock };
});

const portableServiceMock = vi.hoisted(() => ({
  search: vi.fn(),
  exportManuscript: vi.fn(),
  exportBackup: vi.fn(),
  restoreBackup: vi.fn(),
  importManuscript: vi.fn(),
}));

vi.mock('../shared/portable', async () => {
  const actual =
    await vi.importActual<typeof import('../shared/portable')>('../shared/portable');
  return {
    ...actual,
    portableService: { ...actual.portableService, ...portableServiceMock },
  };
});

const project: Project = {
  id: 'project-1',
  title: 'The Quiet Map',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

const detail: ProjectDetail = {
  project,
  chapters: [
    {
      chapter: {
        id: 'chapter-1',
        projectId: project.id,
        title: 'First Chapter',
        position: 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      scenes: [
        {
          id: 'scene-1',
          chapterId: 'chapter-1',
          title: 'The Arrival',
          content: 'A remembered opening.',
          position: 0,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      ],
    },
  ],
};

const codexEntry = {
  id: 'codex-1',
  projectId: project.id,
  kind: 'character',
  title: 'Mira Vale',
  description: 'A cartographer from the northern coast.',
  tags: ['cartographer', 'north'],
  fields: { age: 31 },
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

const codexDetail = {
  entry: codexEntry,
  links: [],
  manuscriptLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  projectServiceMock.listProjects.mockResolvedValue([]);
  projectServiceMock.openProject.mockResolvedValue(detail);
  projectServiceMock.createProject.mockResolvedValue(project);
  projectServiceMock.createChapter.mockResolvedValue(detail.chapters[0].chapter);
  projectServiceMock.createScene.mockResolvedValue(detail.chapters[0].scenes[0]);
  projectServiceMock.renameProject.mockResolvedValue(project);
  projectServiceMock.renameChapter.mockResolvedValue(detail.chapters[0].chapter);
  projectServiceMock.renameScene.mockResolvedValue(detail.chapters[0].scenes[0]);
  projectServiceMock.deleteProject.mockResolvedValue(undefined);
  projectServiceMock.deleteChapter.mockResolvedValue(undefined);
  projectServiceMock.deleteScene.mockResolvedValue(undefined);
  projectServiceMock.reorderChapters.mockResolvedValue(undefined);
  projectServiceMock.reorderScenes.mockResolvedValue(undefined);
  projectServiceMock.saveSceneContent.mockImplementation(async (_id, content) => ({
    ...detail.chapters[0].scenes[0],
    content,
  }));
  projectServiceMock.saveChapterSceneContents.mockResolvedValue([]);
  codexServiceMock.list.mockResolvedValue([]);
  codexServiceMock.detail.mockResolvedValue(codexDetail);
  codexServiceMock.create.mockImplementation(async (input) => ({
    ...codexEntry,
    ...input,
    id: 'codex-created',
  }));
  codexServiceMock.createWithSources.mockImplementation(async (input) => ({
    ...codexEntry,
    ...input,
    id: 'generated-1',
  }));
  codexServiceMock.update.mockImplementation(async (entry) => entry);
  codexServiceMock.remove.mockResolvedValue(undefined);
  codexServiceMock.linkEntries.mockResolvedValue(undefined);
  codexServiceMock.linkLocation.mockResolvedValue(undefined);
  codexServiceMock.unlinkLocation.mockResolvedValue(undefined);
  aiServiceMock.getSettings.mockResolvedValue({
    provider: 'openai-compatible',
    model: '',
    endpoint: 'https://api.openai.com/v1',
  });
  aiServiceMock.hasCredential.mockResolvedValue(false);
  aiServiceMock.saveSettings.mockImplementation(async (settings) => settings);
  aiServiceMock.configureProvider.mockImplementation(async (provider) => ({
    provider,
    model: '',
    endpoint:
      provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : provider === 'ollama'
          ? 'http://127.0.0.1:11434/v1'
          : 'https://api.openai.com/v1',
  }));
  aiServiceMock.saveCredential.mockResolvedValue(undefined);
  aiServiceMock.deleteCredential.mockResolvedValue(undefined);
  aiServiceMock.testConnection.mockResolvedValue(undefined);
  aiServiceMock.listOllamaModels.mockResolvedValue([]);
  aiServiceMock.chat.mockResolvedValue({ text: 'A response', model: 'model' });
  aiServiceMock.getLocalData.mockResolvedValue({ templates: [], history: [] });
  aiServiceMock.saveTemplates.mockResolvedValue(undefined);
  aiServiceMock.recordInteraction.mockResolvedValue(undefined);
  aiServiceMock.clearHistory.mockResolvedValue(undefined);
  aiServiceMock.getAppearanceSettings.mockResolvedValue({
    version: 1,
    themes: [],
    selectedThemeId: '',
    theme: 'light',
    textScale: '1',
  });
  aiServiceMock.saveAppearanceSettings.mockResolvedValue(undefined);
  timelineServiceMock.list.mockResolvedValue([]);
  timelineServiceMock.create.mockImplementation(async (input) => ({
    id: 'event-1',
    ...input,
    sourceSceneId: input.sourceSceneId ?? null,
    dismissed: input.dismissed ?? false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }));
  timelineServiceMock.update.mockImplementation(async (input) => input);
  timelineServiceMock.remove.mockResolvedValue(undefined);
  portableServiceMock.search.mockResolvedValue([]);
  portableServiceMock.exportManuscript.mockResolvedValue('');
  portableServiceMock.exportBackup.mockResolvedValue('{}');
  portableServiceMock.restoreBackup.mockResolvedValue(project);
  portableServiceMock.importManuscript.mockResolvedValue(project);
});

describe('application shell', () => {
  it('starts in the local project library empty state', async () => {
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Your library is ready.' }),
    ).toBeVisible();
    expect(await screen.findByText('Projects are saved on this device.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled();
  });

  it('navigates between Library, Codex, and Settings', async () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'Codex' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByText(/No account or cloud sync is configured/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(
      await screen.findByRole('heading', { name: 'Your library is ready.' }),
    ).toBeVisible();
  });

  it('supports global search and keyboard opening of search', async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('textbox', {
      name: 'Search projects, manuscript, and Codex',
    });
    await user.keyboard('{Control>}k{/Control}');
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    expect(search).not.toHaveFocus();
  });

  it('provides a retry state when the local project library fails to load', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Projects could not be loaded.' }),
    ).toBeVisible();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    await user.click(screen.getByRole('button', { name: 'Retry loading projects' }));
    expect(await screen.findByText('The Quiet Map')).toBeVisible();
  });

  it('offers persistent appearance and readable text-size settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Color theme' }),
      'dark',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text size' }), '1.15');
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark'),
    );
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.15');
  });

  it('shows timeline events and supports creating, dismissing, and deleting them', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    projectServiceMock.openProject.mockResolvedValue(detail);
    timelineServiceMock.list.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    await screen.findByRole('heading', { name: 'Timeline' });
    expect(timelineServiceMock.list).toHaveBeenCalledWith(project.id);
    await user.type(screen.getByLabelText('Event title'), 'The bridge falls');
    await user.type(screen.getByLabelText('Date or time expression'), 'Night 2');
    await user.selectOptions(screen.getByLabelText('Source scene'), 'scene-1');
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await waitFor(() =>
      expect(timelineServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'The bridge falls', sourceSceneId: 'scene-1' }),
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'The bridge falls' }),
    ).toBeVisible();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(timelineServiceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ dismissed: true }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Show dismissed' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    expect(timelineServiceMock.remove).toHaveBeenCalledWith('event-1');
    confirm.mockRestore();
  });

  it('previews manuscript imports before creating a new project', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([]);
    render(<App />);
    const file = new File(
      ['# Chapter One\n\n## Arrival\n\nThe ship docked.'],
      'novel.md',
      { type: 'text/markdown' },
    );
    const input = screen.getByLabelText(
      'Choose manuscript to import',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input, {
      target: { files: [file] },
    });
    await screen.findByRole('region', { name: 'Manuscript import preview' });
    expect(screen.getByText('novel')).toBeVisible();
    expect(screen.getByText(/Chapter One/)).toBeVisible();
    expect(portableServiceMock.importManuscript).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Create project from import' }));
    await waitFor(() =>
      expect(portableServiceMock.importManuscript).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'novel', chapters: expect.any(Array) }),
      ),
    );
  });

  it('requires review before sending manuscript text for Codex suggestions and accepts only selected entries', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    aiServiceMock.chat.mockResolvedValue({
      text: JSON.stringify({
        suggestions: [
          {
            kind: 'character',
            title: 'Mira',
            description: 'A cartographer.',
            tags: ['north'],
            fields: {},
            evidence: 'Mira checked the map.',
          },
        ],
      }),
      model: 'test-model',
    });
    codexServiceMock.createWithSources.mockResolvedValue({
      ...codexEntry,
      id: 'generated-1',
      title: 'Mira',
    });
    render(<App />);
    await user.click(
      within(await screen.findByRole('article')).getByRole('button', {
        name: /The Quiet Map Updated/,
      }),
    );
    await waitFor(() =>
      expect(codexServiceMock.list).toHaveBeenCalledWith(project.id, '', null),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Suggest Codex from scene' }),
    );
    expect(aiServiceMock.chat).not.toHaveBeenCalled();
    const reviewText = screen.getByRole('textbox', { name: 'Text to analyze for Codex' });
    expect(reviewText).toHaveValue('A remembered opening.');
    await user.clear(reviewText);
    await user.type(reviewText, 'Mira checked the map.');
    await user.click(screen.getByRole('button', { name: 'Send reviewed text' }));
    await screen.findByRole('region', { name: 'Review Codex suggestions' });
    expect(aiServiceMock.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Mira checked the map.'),
          }),
        ],
      }),
    );
    expect(codexServiceMock.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept and add' }));
    await waitFor(() =>
      expect(codexServiceMock.createWithSources).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Mira', projectId: project.id }),
        ['scene-1'],
      ),
    );
  });

  it('warns before saving a same-kind Codex duplicate and leaves the suggestion in review if declined', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    codexServiceMock.list.mockResolvedValue([codexEntry]);
    codexServiceMock.createWithSources.mockResolvedValue({
      ...codexEntry,
      id: 'generated-1',
    });
    codexServiceMock.list.mockResolvedValue([codexEntry]);
    aiServiceMock.chat.mockResolvedValue({
      text: JSON.stringify({
        suggestions: [
          {
            kind: 'character',
            title: 'Mira Vale',
            description: 'A cartographer.',
            tags: [],
            fields: {},
            evidence: 'A cartographer from the northern coast.',
          },
        ],
      }),
      model: 'test-model',
    });
    render(<App />);
    await user.click(
      within(await screen.findByRole('article')).getByRole('button', {
        name: /The Quiet Map Updated/,
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Suggest Codex from scene' }),
    );
    const textReview = screen.getByRole('textbox', { name: 'Text to analyze for Codex' });
    await user.clear(textReview);
    await user.type(textReview, 'A cartographer from the northern coast.');
    await user.click(screen.getByRole('button', { name: 'Send reviewed text' }));
    await screen.findByRole('region', { name: 'Review Codex suggestions' });
    await user.click(screen.getByRole('button', { name: 'Check duplicate' }));
    await waitFor(() => expect(screen.getByText(/Possible duplicate/)).toBeVisible());
    expect(screen.getByRole('button', { name: 'Keep separate and add' })).toBeVisible();
    expect(codexServiceMock.createWithSources).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(
      screen.queryByRole('region', { name: 'Review Codex suggestions' }),
    ).not.toBeInTheDocument();
  });

  it('does not send Codex extraction output without evidence from the reviewed source', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    aiServiceMock.chat.mockResolvedValue({
      text: JSON.stringify({
        suggestions: [
          {
            kind: 'character',
            title: 'Unsupported',
            description: 'Not in text',
            tags: [],
            fields: {},
            evidence: 'an excerpt that is absent',
          },
        ],
      }),
      model: 'test-model',
    });
    render(<App />);
    await user.click(
      within(await screen.findByRole('article')).getByRole('button', {
        name: /The Quiet Map Updated/,
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Suggest Codex from scene' }),
    );
    await user.click(screen.getByRole('button', { name: 'Send reviewed text' }));
    expect(
      await screen.findByText('No valid Codex suggestions were returned.'),
    ).toBeVisible();
    expect(codexServiceMock.createWithSources).not.toHaveBeenCalled();
  });

  it('creates a custom writing theme and applies its font choice', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Create theme' }));
    await user.clear(screen.getByRole('textbox', { name: 'Writing theme name' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Writing theme name' }),
      'My Theme',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Writing font' }),
      'Source Serif 4',
    );
    expect(screen.getByRole('textbox', { name: 'Writing theme name' })).toHaveValue(
      'My Theme',
    );
    expect(screen.getByRole('combobox', { name: 'Writing font' })).toHaveValue(
      'Source Serif 4',
    );
    expect(JSON.parse(localStorage.getItem('noveler-writing-themes') ?? '[]')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'My Theme', fontFamily: 'Source Serif 4' }),
      ]),
    );
  });

  it('loads and saves custom writing themes using native appearance settings', async () => {
    const custom = {
      id: 'custom-native',
      name: 'Native',
      background: '#ffffff',
      foreground: '#111111',
      fontFamily: 'Literata',
      fontSize: 18,
      lineHeight: 1.8,
      contentWidth: 760,
    };
    aiServiceMock.getAppearanceSettings.mockResolvedValue({
      version: 1,
      themes: [custom],
      selectedThemeId: custom.id,
      theme: 'dark',
      textScale: '1.3',
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Timeline' })).toBeVisible(),
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark'),
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3'),
    );
    await waitFor(() =>
      expect(aiServiceMock.saveAppearanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          themes: [custom],
          selectedThemeId: custom.id,
          theme: 'dark',
          textScale: '1.3',
        }),
      ),
    );
  });

  it('creates and opens a saved local project with its chapter and scene', async () => {
    projectServiceMock.listProjects.mockResolvedValue([project]);
    render(<App />);

    const projectCard = await screen.findByRole('article');
    expect(within(projectCard).getByText('The Quiet Map')).toBeVisible();
    fireEvent.click(
      within(projectCard).getByRole('button', { name: /The Quiet Map Updated/ }),
    );

    expect(await screen.findByRole('heading', { name: 'The Quiet Map' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'The Arrival' })).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Text for The Arrival' }),
    ).toHaveTextContent('A remembered opening.');
    expect(projectServiceMock.openProject).toHaveBeenCalledWith(project.id);
  });

  it('creates the first numbered chapter with its default scene and opens it for writing', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    const firstChapter = {
      chapter: {
        ...detail.chapters[0].chapter,
        id: 'chapter-first',
        title: 'Chapter 1',
        position: 0,
      },
      scenes: [
        {
          id: 'scene-default-first',
          chapterId: 'chapter-first',
          title: 'Scene',
          content: '',
          position: 0,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      ],
    };
    projectServiceMock.createChapter.mockResolvedValue(firstChapter.chapter);
    projectServiceMock.openProject.mockResolvedValue({ ...detail, chapters: [] });
    render(<App />);
    const card = await screen.findByRole('article');
    await user.click(within(card).getByRole('button', { name: /The Quiet Map Updated/ }));
    await screen.findByText('Your outline starts here.');
    projectServiceMock.openProject.mockResolvedValue({
      ...detail,
      chapters: [firstChapter],
    });
    await user.click(screen.getByRole('button', { name: 'New chapter' }));

    await waitFor(() =>
      expect(projectServiceMock.createChapter).toHaveBeenCalledWith(
        project.id,
        'Chapter 1',
      ),
    );
    expect(await screen.findByRole('textbox', { name: 'Text for Scene' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Scene' })).toBeVisible();
  });

  it('saves scene text and confirms project deletion with its manuscript consequence', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('The Quiet Map');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);

    const projectCard = await screen.findByRole('article');
    fireEvent.click(
      within(projectCard).getByRole('button', { name: /The Quiet Map Updated/ }),
    );
    const editor = await screen.findByRole('textbox', { name: 'Text for The Arrival' });
    await user.click(editor);
    await user.keyboard(' Revised passage.');
    fireEvent.click(screen.getByRole('button', { name: '← Library' }));
    await waitFor(() =>
      expect(projectServiceMock.saveSceneContent).toHaveBeenCalledWith(
        'scene-1',
        expect.stringContaining('Revised passage.'),
      ),
    );

    await waitFor(() => expect(screen.getByRole('article')).toBeVisible());
    fireEvent.click(
      within(screen.getByRole('article')).getByRole('button', {
        name: 'Delete The Quiet Map',
      }),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('all of its chapters and scenes'),
    );
    await waitFor(() =>
      expect(projectServiceMock.deleteProject).toHaveBeenCalledWith(project.id),
    );
    prompt.mockRestore();
    confirm.mockRestore();
  });

  it('autosaves rich text after the debounce and shows saved state', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    render(<App />);
    const projectCard = await screen.findByRole('article');
    fireEvent.click(
      within(projectCard).getByRole('button', { name: /The Quiet Map Updated/ }),
    );
    const editor = await screen.findByRole('textbox', { name: 'Text for The Arrival' });
    await user.click(editor);
    await user.keyboard(' New words');

    await waitFor(() => expect(projectServiceMock.saveSceneContent).toHaveBeenCalled(), {
      timeout: 2500,
    });
    expect(projectServiceMock.saveSceneContent).toHaveBeenCalledWith(
      'scene-1',
      expect.stringContaining('New words'),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved locally'),
    );
  });

  it('flushes the current scene before switching scenes and preserves the target content', async () => {
    const user = userEvent.setup();
    const secondScene = {
      ...detail.chapters[0].scenes[0],
      id: 'scene-2',
      title: 'The Return',
      content: 'Second scene text.',
      position: 1,
    };
    projectServiceMock.listProjects.mockResolvedValue([project]);
    projectServiceMock.openProject.mockResolvedValue({
      ...detail,
      chapters: [
        { ...detail.chapters[0], scenes: [...detail.chapters[0].scenes, secondScene] },
      ],
    });
    projectServiceMock.saveSceneContent.mockImplementation(async (id, content) => ({
      ...(id === secondScene.id ? secondScene : detail.chapters[0].scenes[0]),
      content,
    }));
    render(<App />);
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: /The Quiet Map Updated/ }));
    const editor = await screen.findByRole('textbox', { name: 'Text for The Arrival' });
    await user.click(editor);
    await user.keyboard(' Draft before navigation.');
    fireEvent.click(screen.getByRole('button', { name: 'The Return' }));

    await waitFor(() =>
      expect(projectServiceMock.saveSceneContent).toHaveBeenCalledWith(
        'scene-1',
        expect.stringContaining('Draft before navigation.'),
      ),
    );
    expect(
      await screen.findByRole('textbox', { name: 'Text for The Return' }),
    ).toHaveTextContent('Second scene text.');
  });

  it('shows and edits every scene in one chapter document while keeping dividers out of saved text', async () => {
    const user = userEvent.setup();
    const secondScene = {
      ...detail.chapters[0].scenes[0],
      id: 'scene-2',
      title: 'The Crossing',
      content: 'Second scene passage.',
      position: 1,
    };
    projectServiceMock.listProjects.mockResolvedValue([project]);
    projectServiceMock.openProject.mockResolvedValue({
      ...detail,
      chapters: [
        { ...detail.chapters[0], scenes: [...detail.chapters[0].scenes, secondScene] },
      ],
    });
    render(<App />);
    const card = await screen.findByRole('article');
    await user.click(within(card).getByRole('button', { name: /The Quiet Map Updated/ }));
    await user.click(screen.getByRole('button', { name: 'Edit whole chapter' }));

    const first = screen.getByRole('textbox', {
      name: 'Text for The Arrival in First Chapter',
    });
    const second = screen.getByRole('textbox', {
      name: 'Text for The Crossing in First Chapter',
    });
    expect(first).toHaveValue('A remembered opening.');
    expect(second).toHaveValue('Second scene passage.');
    expect(screen.getByRole('heading', { name: 'Scene · The Arrival' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Scene · The Crossing' })).toBeVisible();

    await user.clear(first);
    await user.type(first, 'Revised chapter passage.');
    await waitFor(
      () =>
        expect(projectServiceMock.saveSceneContent).toHaveBeenCalledWith(
          'scene-1',
          expect.stringContaining('Revised chapter passage.'),
        ),
      { timeout: 2000 },
    );
    const savedContent = projectServiceMock.saveSceneContent.mock.calls.at(
      -1,
    )?.[1] as string;
    expect(savedContent).not.toContain('Scene · The Arrival');
    expect(savedContent).not.toContain('Scene · The Crossing');
    expect(projectServiceMock.saveSceneContent).not.toHaveBeenCalledWith(
      'scene-2',
      expect.any(String),
    );
  });

  it('retains draft text and announces an autosave failure with a retry action', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    projectServiceMock.saveSceneContent.mockRejectedValue(
      new Error('Disk is unavailable'),
    );
    render(<App />);
    const projectCard = await screen.findByRole('article');
    fireEvent.click(
      within(projectCard).getByRole('button', { name: /The Quiet Map Updated/ }),
    );
    const editor = await screen.findByRole('textbox', { name: 'Text for The Arrival' });
    await user.click(editor);
    await user.keyboard(' Keep this draft.');

    fireEvent.click(screen.getByRole('button', { name: '← Library' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk is unavailable');
    expect(editor).toHaveTextContent('Keep this draft.');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
  });

  it('toggles distraction-minimized focus mode without hiding scene navigation or save status', async () => {
    projectServiceMock.listProjects.mockResolvedValue([project]);
    render(<App />);
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: /The Quiet Map Updated/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Focus mode' }));

    expect(screen.getByRole('button', { name: 'Exit focus' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'The Arrival' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally');
    fireEvent.click(screen.getByRole('button', { name: 'Exit focus' }));
    expect(screen.getByRole('button', { name: 'New chapter' })).toBeVisible();
  });

  it('debounced save flush runs the latest scheduled action exactly once', async () => {
    const debounced = createDebouncedAction(60_000);
    const first = vi.fn(async () => {});
    const latest = vi.fn(async () => {});

    debounced.schedule(first);
    debounced.schedule(latest);
    await debounced.flush();

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('creates and searches project-local Codex entries with type filtering', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    codexServiceMock.list.mockResolvedValue([codexEntry]);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(await screen.findByRole('button', { name: /Mira Vale/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'New entry' }));
    await user.selectOptions(screen.getByLabelText('Type'), 'location');
    await user.type(screen.getByLabelText('Title'), 'North Reach');
    await user.type(screen.getByLabelText('Description / notes'), 'A cold coast.');
    await user.type(screen.getByLabelText(/Tags/), 'island, northern');
    await user.clear(screen.getByLabelText(/Structured fields/));
    fireEvent.change(screen.getByLabelText(/Structured fields/), {
      target: { value: '{"climate":"cold"}' },
    });
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() =>
      expect(codexServiceMock.create).toHaveBeenCalledWith({
        projectId: project.id,
        kind: 'location',
        title: 'North Reach',
        description: 'A cold coast.',
        tags: ['island', 'northern'],
        fields: { climate: 'cold' },
      }),
    );

    const search = screen.getByRole('searchbox', { name: 'Search Codex' });
    await user.type(search, 'north');
    await waitFor(() =>
      expect(codexServiceMock.list).toHaveBeenCalledWith(project.id, 'north', null),
    );
    await user.selectOptions(screen.getByLabelText('Filter by type'), 'location');
    await waitFor(() =>
      expect(codexServiceMock.list).toHaveBeenCalledWith(project.id, 'north', 'location'),
    );
  });

  it('browses related entries and confirms Codex deletion', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    codexServiceMock.list.mockResolvedValue([
      codexEntry,
      { ...codexEntry, id: 'codex-2', title: 'North Reach', kind: 'location' },
    ]);
    codexServiceMock.detail.mockResolvedValue({
      ...codexDetail,
      links: [{ id: 'codex-2', kind: 'location', title: 'North Reach', label: 'knows' }],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    await user.click(await screen.findByRole('button', { name: /Mira Vale/ }));
    expect(await screen.findByText('knows', { exact: false })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Delete Mira Vale' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('its Codex links'));
    await waitFor(() => expect(codexServiceMock.remove).toHaveBeenCalledWith('codex-1'));
    confirm.mockRestore();
  });

  it('shows Codex facts while writing without changing the manuscript', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    codexServiceMock.list.mockResolvedValue([codexEntry]);
    codexServiceMock.detail.mockResolvedValue(codexDetail);
    render(<App />);
    const projectCard = await screen.findByRole('article');
    await user.click(
      within(projectCard).getByRole('button', { name: /The Quiet Map Updated/ }),
    );
    await user.click(await screen.findByRole('button', { name: 'Mira Vale' }));
    expect(
      await screen.findByRole('complementary', { name: 'Codex reference while writing' }),
    ).toHaveTextContent('A cartographer from the northern coast.');
    expect(
      screen.getByRole('textbox', { name: 'Text for The Arrival' }),
    ).toHaveTextContent('A remembered opening.');
    expect(projectServiceMock.saveSceneContent).not.toHaveBeenCalled();
  });

  it('stores provider preferences and credentials through the backend without sending automatic requests', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.type(screen.getByLabelText('Model'), 'example-model');
    await user.type(screen.getByLabelText('API key'), 'local-test-key');
    await user.click(screen.getByRole('button', { name: 'Save key securely' }));
    await waitFor(() =>
      expect(aiServiceMock.saveCredential).toHaveBeenCalledWith(
        'openai-compatible',
        'local-test-key',
      ),
    );
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(aiServiceMock.chat).not.toHaveBeenCalled();
    expect(aiServiceMock.testConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save provider settings' }));
    await waitFor(() =>
      expect(aiServiceMock.saveSettings).toHaveBeenCalledWith({
        provider: 'openai-compatible',
        model: 'example-model',
        endpoint: 'https://api.openai.com/v1',
      }),
    );
  });

  it('configures OpenRouter and local Ollama with provider-specific defaults and credential requirements', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const provider = await screen.findByRole('combobox', { name: 'Provider' });

    await user.selectOptions(provider, 'openrouter');
    await waitFor(() =>
      expect(aiServiceMock.configureProvider).toHaveBeenCalledWith('openrouter'),
    );
    expect(await screen.findByPlaceholderText('e.g. openai/gpt-4o-mini')).toBeVisible();
    expect(screen.getByText(/OpenRouter sends requests/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Endpoint' })).toHaveValue(
      'https://openrouter.ai/api/v1',
    );

    await user.selectOptions(provider, 'ollama');
    await waitFor(() =>
      expect(aiServiceMock.configureProvider).toHaveBeenCalledWith('ollama'),
    );
    expect(screen.getByText('No API key needed for local Ollama.')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'API key' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Endpoint' })).toHaveValue(
      'http://127.0.0.1:11434/v1',
    );
  });

  it('lists local Ollama models and lets the user select one', async () => {
    const user = userEvent.setup();
    aiServiceMock.listOllamaModels.mockResolvedValue(['llama3.2:latest', 'mistral']);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const provider = await screen.findByRole('combobox', { name: 'Provider' });
    await user.selectOptions(provider, 'ollama');
    await user.click(
      await screen.findByRole('button', { name: 'List available models' }),
    );

    await waitFor(() =>
      expect(aiServiceMock.listOllamaModels).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/v1',
      ),
    );
    const modelSelect = await screen.findByRole('combobox', { name: 'Model' });
    await user.selectOptions(modelSelect, 'mistral');
    expect(modelSelect).toHaveValue('mistral');
  });

  it('does not silently delete a saved OpenAI key when switching to Ollama and back', async () => {
    const user = userEvent.setup();
    aiServiceMock.hasCredential.mockImplementation(
      async (provider) => provider === 'openai-compatible',
    );
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const provider = await screen.findByRole('combobox', { name: 'Provider' });
    await user.selectOptions(provider, 'ollama');
    await waitFor(() =>
      expect(aiServiceMock.configureProvider).toHaveBeenCalledWith('ollama'),
    );
    await user.selectOptions(provider, 'openai-compatible');
    await waitFor(() =>
      expect(aiServiceMock.configureProvider).toHaveBeenCalledWith('openai-compatible'),
    );
    expect(aiServiceMock.deleteCredential).not.toHaveBeenCalled();
  });

  it('runs a connection test only after explicit user action and surfaces provider errors', async () => {
    const user = userEvent.setup();
    aiServiceMock.getSettings.mockResolvedValue({
      provider: 'openai-compatible',
      model: 'test-model',
      endpoint: 'https://api.openai.com/v1',
    });
    aiServiceMock.hasCredential.mockResolvedValue(true);
    aiServiceMock.testConnection.mockRejectedValue(
      new Error('The provider rate limit was reached.'),
    );
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(aiServiceMock.testConnection).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('provider rate limit');
    expect(aiServiceMock.testConnection).toHaveBeenCalledOnce();
  });

  it('searches across local content and jumps to the matching scene or Codex entry', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    portableServiceMock.search.mockResolvedValue([
      {
        kind: 'scene',
        projectId: project.id,
        projectTitle: project.title,
        title: 'First Chapter · The Arrival',
        snippet: 'A remembered opening.',
        chapterId: 'chapter-1',
        sceneId: 'scene-1',
        codexEntryId: null,
      },
    ]);
    render(<App />);
    const search = screen.getByRole('textbox', {
      name: 'Search projects, manuscript, and Codex',
    });
    await user.type(search, 'remembered');
    expect(
      await screen.findByRole('option', { name: /First Chapter · The Arrival/ }),
    ).toBeVisible();
    await user.click(screen.getByRole('option', { name: /First Chapter · The Arrival/ }));
    expect(await screen.findByRole('heading', { name: 'The Quiet Map' })).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Text for The Arrival' }),
    ).toHaveTextContent('A remembered opening.');
    expect(portableServiceMock.search).toHaveBeenCalledWith('remembered');
  });

  it('exports the selected project and asks before restoring over it', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<App />);
    await user.click(
      within(await screen.findByRole('article')).getByRole('button', {
        name: /The Quiet Map Updated/,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() =>
      expect(portableServiceMock.exportManuscript).toHaveBeenCalledWith(
        project.id,
        'markdown',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(screen.getByLabelText('Choose project backup file')).toBeInTheDocument();
    const backup = new File(['{}'], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Choose project backup file'), {
      target: { files: [backup] },
    });
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining('permanently replaces'),
      ),
    );
    expect(portableServiceMock.restoreBackup).not.toHaveBeenCalled();
    confirm.mockRestore();
    anchorClick.mockRestore();
    if (previousCreate) Object.defineProperty(URL, 'createObjectURL', previousCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (previousRevoke) Object.defineProperty(URL, 'revokeObjectURL', previousRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('shows exact reviewed prompt and requires explicit send and explicit apply', async () => {
    const user = userEvent.setup();
    projectServiceMock.listProjects.mockResolvedValue([project]);
    const apply = vi.fn();
    render(
      <AiWritingPanel
        scene={detail.chapters[0].scenes[0]}
        sceneText="A remembered opening."
        chapterTitle="First Chapter"
        chapterText="First Chapter\nA remembered opening."
        projectText="A remembered opening."
        selection={{
          start: 0,
          end: 'A remembered opening.'.length,
          text: 'A remembered opening.',
        }}
        codexEntries={[codexEntry]}
        templates={DEFAULT_PROMPT_TEMPLATES}
        history={[]}
        onSaveTemplates={async () => {}}
        onSaveHistory={async () => {}}
        onClearHistory={async () => {}}
        onSelectionChange={() => {}}
        onApply={apply}
        onClose={() => {}}
      />,
    );
    const prompt = screen.getByRole('textbox', {
      name: 'Exact prompt to send',
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(prompt.value).toContain('A remembered opening.'));
    expect(aiServiceMock.chat).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send reviewed prompt' }));
    await screen.findByRole('textbox', { name: 'AI response preview' });
    expect(aiServiceMock.chat).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Replace selection' }));
    expect(apply).toHaveBeenCalledWith('A response');
  });

  it('allows removal of manuscript context before send and does not apply discarded output', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    render(
      <AiWritingPanel
        scene={detail.chapters[0].scenes[0]}
        sceneText="Private scene text."
        chapterTitle="First Chapter"
        chapterText="Private chapter text."
        projectText="Private project text."
        selection={{ start: 0, end: 0, text: '' }}
        codexEntries={[]}
        templates={DEFAULT_PROMPT_TEMPLATES}
        history={[]}
        onSaveTemplates={async () => {}}
        onSaveHistory={async () => {}}
        onClearHistory={async () => {}}
        onSelectionChange={() => {}}
        onApply={apply}
        onClose={() => {}}
      />,
    );
    const sceneContext = screen.getByRole('checkbox', { name: 'Current scene text' });
    await user.click(sceneContext);
    const prompt = screen.getByRole('textbox', {
      name: 'Exact prompt to send',
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(prompt.value).not.toContain('Private scene text.'));
    await user.clear(prompt);
    await user.type(prompt, 'Please brainstorm without private context.');
    await user.click(screen.getByRole('button', { name: 'Send reviewed prompt' }));
    await screen.findByRole('textbox', { name: 'AI response preview' });
    expect(aiServiceMock.chat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Please brainstorm without private context.' }],
      maxTokens: 1200,
    });
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(apply).not.toHaveBeenCalled();
  });

  it('edits, duplicates, and deletes local prompt templates without storing response text', async () => {
    const user = userEvent.setup();
    const saveTemplates = vi.fn(
      async (templates: import('../shared/aiPrompts').PromptTemplate[]) => {
        expect(templates.length).toBeGreaterThan(0);
      },
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <AiWritingPanel
        scene={detail.chapters[0].scenes[0]}
        sceneText="Scene text"
        chapterTitle="First Chapter"
        chapterText="Scene text"
        projectText="Scene text"
        selection={{ start: 0, end: 0, text: '' }}
        codexEntries={[]}
        templates={DEFAULT_PROMPT_TEMPLATES}
        history={[]}
        onSaveTemplates={saveTemplates}
        onSaveHistory={async () => {}}
        onClearHistory={async () => {}}
        onSelectionChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Prompt templates' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate Continue passage' }));
    await waitFor(() => expect(saveTemplates).toHaveBeenCalled());
    expect(saveTemplates.mock.calls.at(-1)?.[0]).toHaveLength(
      DEFAULT_PROMPT_TEMPLATES.length + 1,
    );
    await user.click(screen.getByRole('button', { name: 'Delete Brainstorm ideas' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Brainstorm ideas'));
    await waitFor(() =>
      expect(saveTemplates.mock.calls.at(-1)?.[0]).toHaveLength(
        DEFAULT_PROMPT_TEMPLATES.length,
      ),
    );
    confirm.mockRestore();
  });

  it('keeps an edited prompt unchanged when context checkboxes subsequently change', async () => {
    const user = userEvent.setup();
    render(
      <AiWritingPanel
        scene={detail.chapters[0].scenes[0]}
        sceneText="Private text"
        chapterTitle="First Chapter"
        chapterText="Private chapter"
        projectText="Private project"
        selection={{ start: 0, end: 0, text: '' }}
        codexEntries={[]}
        templates={DEFAULT_PROMPT_TEMPLATES}
        history={[]}
        onSaveTemplates={async () => {}}
        onSaveHistory={async () => {}}
        onClearHistory={async () => {}}
        onSelectionChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    const prompt = screen.getByRole('textbox', {
      name: 'Exact prompt to send',
    }) as HTMLTextAreaElement;
    await user.clear(prompt);
    await user.type(prompt, 'Reviewed custom request');
    await user.click(screen.getByRole('checkbox', { name: 'Current scene text' }));
    expect(prompt).toHaveValue('Reviewed custom request');
  });

  it('keeps the generated prompt in sync with context toggles and preserves manual edits', async () => {
    const user = userEvent.setup();
    render(
      <AiWritingPanel
        scene={detail.chapters[0].scenes[0]}
        sceneText="A current scene."
        chapterTitle="First Chapter"
        chapterText="A current scene."
        projectText="A current scene."
        selection={{ start: 0, end: 0, text: '' }}
        codexEntries={[]}
        templates={DEFAULT_PROMPT_TEMPLATES}
        history={[]}
        onSaveTemplates={async () => {}}
        onSaveHistory={async () => {}}
        onClearHistory={async () => {}}
        onSelectionChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    const prompt = screen.getByRole('textbox', {
      name: 'Exact prompt to send',
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(prompt.value).toContain('A current scene.'));
    await user.click(screen.getByRole('checkbox', { name: 'Current scene text' }));
    await waitFor(() => expect(prompt.value).not.toContain('A current scene.'));
    await user.clear(prompt);
    await user.type(prompt, 'My reviewed prompt');
    await user.click(screen.getByRole('checkbox', { name: 'Scene title' }));
    expect(prompt).toHaveValue('My reviewed prompt');
  });
});
