import { invoke } from '@tauri-apps/api/core';
import type { AiChatRequest, AiChatResponse, AiLocalData, AiSettings } from './contracts';
import type { AIHistoryItem, PromptTemplate } from './aiPrompts';

export const aiService = {
  getSettings: () => invoke<AiSettings>('get_ai_settings'),
  saveSettings: (settings: AiSettings) =>
    invoke<AiSettings>('save_ai_settings', { settings }),
  configureProvider: (provider: string) =>
    invoke<AiSettings>('configure_ai_provider', { provider }),
  hasCredential: (provider: string) => invoke<boolean>('ai_has_credential', { provider }),
  saveCredential: (provider: string, secret: string) =>
    invoke<void>('ai_save_credential', { provider, secret }),
  deleteCredential: (provider: string) =>
    invoke<void>('ai_delete_credential', { provider }),
  testConnection: () => invoke<void>('ai_test_connection'),
  chat: (request: AiChatRequest) => invoke<AiChatResponse>('ai_chat', { request }),
  getLocalData: () => invoke<AiLocalData>('ai_get_local_data'),
  saveTemplates: (templates: PromptTemplate[]) =>
    invoke<void>('ai_save_templates', { templates }),
  recordInteraction: (item: AIHistoryItem) =>
    invoke<void>('ai_record_interaction', { item }),
  clearHistory: () => invoke<void>('ai_clear_history'),
};
