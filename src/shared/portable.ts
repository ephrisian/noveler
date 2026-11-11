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

export const portableService = {
  search: (query: string) => invoke<SearchResult[]>('search_everything', { query }),
  exportManuscript: (projectId: string, format: ManuscriptFormat) =>
    invoke<string>('export_manuscript', { projectId, format }),
  exportBackup: (projectId: string) =>
    invoke<string>('export_project_backup', { projectId }),
  restoreBackup: (payload: string, replaceProjectId: string | null) =>
    invoke<Project>('restore_project_backup', { payload, replaceProjectId }),
};
