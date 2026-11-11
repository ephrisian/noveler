import { invoke } from '@tauri-apps/api/core';
import type { CodexEntry, CodexEntryDetail, ProjectDetail } from './contracts';

export interface CodexService {
  list(projectId: string, query: string, kind: string | null): Promise<CodexEntry[]>;
  detail(id: string): Promise<CodexEntryDetail>;
  create(
    input: Pick<
      CodexEntry,
      'projectId' | 'kind' | 'title' | 'description' | 'tags' | 'fields'
    >,
  ): Promise<CodexEntry>;
  createWithSources(
    input: Pick<
      CodexEntry,
      'projectId' | 'kind' | 'title' | 'description' | 'tags' | 'fields'
    >,
    sceneIds: string[],
  ): Promise<CodexEntry>;
  update(entry: CodexEntry): Promise<CodexEntry>;
  remove(id: string): Promise<void>;
  linkEntries(
    sourceId: string,
    targetId: string,
    label: string,
    linked: boolean,
  ): Promise<void>;
  linkLocation(input: {
    entryId: string;
    chapterId?: string;
    sceneId?: string;
  }): Promise<void>;
  unlinkLocation(input: {
    entryId: string;
    chapterId?: string;
    sceneId?: string;
  }): Promise<void>;
  openProject(id: string): Promise<ProjectDetail>;
}

export const codexService: CodexService = {
  list: (projectId, query, kind) =>
    invoke('list_codex_entries', { projectId, query, kind }),
  detail: (id) => invoke('get_codex_entry_detail', { id }),
  create: ({ projectId, kind, title, description, tags, fields }) =>
    invoke('create_codex_entry', { projectId, kind, title, description, tags, fields }),
  createWithSources: ({ projectId, kind, title, description, tags, fields }, sceneIds) =>
    invoke('create_codex_entry_with_sources', {
      projectId,
      kind,
      title,
      description,
      tags,
      fields,
      sceneIds,
    }),
  update: ({ id, kind, title, description, tags, fields }) =>
    invoke('update_codex_entry', { id, kind, title, description, tags, fields }),
  remove: (id) => invoke('delete_codex_entry', { id }),
  linkEntries: (sourceId, targetId, label, linked) =>
    invoke('set_codex_entry_link', { sourceId, targetId, label, linked }),
  linkLocation: ({ entryId, chapterId, sceneId }) =>
    invoke('add_codex_manuscript_link', { entryId, chapterId, sceneId }),
  unlinkLocation: ({ entryId, chapterId, sceneId }) =>
    invoke('remove_codex_manuscript_link', { entryId, chapterId, sceneId }),
  openProject: (id) => invoke('open_project', { id }),
};
