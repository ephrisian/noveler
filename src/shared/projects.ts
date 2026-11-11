import { invoke } from '@tauri-apps/api/core';
import type { Chapter, Project, ProjectDetail, Scene } from './contracts';

export interface ProjectService {
  listProjects(): Promise<Project[]>;
  createProject(title: string): Promise<Project>;
  renameProject(id: string, title: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  openProject(id: string): Promise<ProjectDetail>;
  createChapter(projectId: string, title: string): Promise<Chapter>;
  renameChapter(id: string, title: string): Promise<Chapter>;
  deleteChapter(id: string): Promise<void>;
  reorderChapters(projectId: string, orderedIds: string[]): Promise<void>;
  createScene(chapterId: string, title: string): Promise<Scene>;
  renameScene(id: string, title: string): Promise<Scene>;
  deleteScene(id: string): Promise<void>;
  reorderScenes(chapterId: string, orderedIds: string[]): Promise<void>;
  saveSceneContent(id: string, content: string): Promise<Scene>;
  saveChapterSceneContents(
    chapterId: string,
    updates: { sceneId: string; content: string }[],
  ): Promise<Scene[]>;
}

export const projectService: ProjectService = {
  listProjects: () => invoke('list_projects'),
  createProject: (title) => invoke('create_project', { title }),
  renameProject: (id, title) => invoke('rename_project', { id, title }),
  deleteProject: (id) => invoke('delete_project', { id }),
  openProject: (id) => invoke('open_project', { id }),
  createChapter: (projectId, title) => invoke('create_chapter', { projectId, title }),
  renameChapter: (id, title) => invoke('rename_chapter', { id, title }),
  deleteChapter: (id) => invoke('delete_chapter', { id }),
  reorderChapters: (projectId, orderedIds) =>
    invoke('reorder_chapters', { projectId, orderedIds }),
  createScene: (chapterId, title) => invoke('create_scene', { chapterId, title }),
  renameScene: (id, title) => invoke('rename_scene', { id, title }),
  deleteScene: (id) => invoke('delete_scene', { id }),
  reorderScenes: (chapterId, orderedIds) =>
    invoke('reorder_scenes', { chapterId, orderedIds }),
  saveSceneContent: (id, content) => invoke('save_scene_content', { id, content }),
  saveChapterSceneContents: (chapterId, updates) =>
    invoke('save_chapter_scene_contents', { chapterId, updates }),
};
