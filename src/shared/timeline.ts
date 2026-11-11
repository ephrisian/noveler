import { invoke } from '@tauri-apps/api/core';

export type TimelineConfidence = 'confirmed' | 'inferred' | 'uncertain';

export interface TimelineEvent {
  id: string;
  projectId: string;
  title: string;
  dateLabel: string;
  sortOrder: number;
  description: string;
  confidence: TimelineConfidence;
  sourceSceneId: string | null;
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEventInput {
  projectId: string;
  title: string;
  dateLabel: string;
  sortOrder: number;
  description: string;
  confidence: TimelineConfidence;
  sourceSceneId?: string | null;
  dismissed?: boolean;
}

export interface AppearanceSettings {
  version: 1;
  themes: unknown[];
  selectedThemeId: string;
  theme: 'light' | 'dark';
  textScale: '1' | '1.15' | '1.3';
}

export const timelineService = {
  list: (projectId: string) =>
    invoke<TimelineEvent[]>('list_timeline_events', { projectId }),
  create: (input: TimelineEventInput) =>
    invoke<TimelineEvent>('create_timeline_event', { input }),
  update: (input: TimelineEvent) =>
    invoke<TimelineEvent>('update_timeline_event', { input }),
  remove: (id: string) => invoke<void>('delete_timeline_event', { id }),
};
