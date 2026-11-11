/** Stable contracts returned by the Rust persistence commands. */
export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Scene {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterWithScenes {
  chapter: Chapter;
  scenes: Scene[];
}

export interface ProjectDetail {
  project: Project;
  chapters: ChapterWithScenes[];
}

export type CodexEntryKind = 'character' | 'location' | 'item' | 'general';

export interface CodexEntry {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  description: string;
  tags: string[];
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CodexEntryLink {
  id: string;
  kind: string;
  title: string;
  label: string;
}

export interface CodexManuscriptLink {
  chapterId: string | null;
  chapterTitle: string | null;
  sceneId: string | null;
  sceneTitle: string | null;
}

export interface CodexEntryDetail {
  entry: CodexEntry;
  links: CodexEntryLink[];
  manuscriptLinks: CodexManuscriptLink[];
}

export interface AiSettings {
  provider: string;
  model: string;
  endpoint: string;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  maxTokens?: number;
}

export interface AiChatResponse {
  text: string;
  model: string;
}

export interface AiLocalData {
  templates: import('./aiPrompts').PromptTemplate[];
  history: import('./aiPrompts').AIHistoryItem[];
}

export interface AppInfo {
  name: string;
  version: string;
  dataLocation: 'local';
}
