export type ThemeMode = 'dark' | 'light' | 'system';
export type DensityMode = 'compact' | 'normal' | 'comfortable';
export type LanguageMode = 'es' | 'en' | 'fr' | 'de' | 'pt' | 'it' | 'zh' | 'hi' | 'ar' | 'bn' | 'ru' | 'ur';

export interface RecentFileInfo {
  name: string;
  lastOpened: number;
  taskCount?: number;
  groupCount?: number;
}

export interface AppUserSettings {
  theme: ThemeMode;
  density: DensityMode;
  language: LanguageMode;
  defaultView: 'canvas' | 'kanban' | 'split' | 'studio';
  confirmDeleteWithDependents: boolean;
  autoSave: boolean;
  autoSaveIntervalSeconds: number;
  canvasShowGrid: boolean;
  canvasSnapToGrid: boolean;
  canvasInitialZoom: number; // in percentage, e.g. 100
  showTaskIds: boolean;
  showTaskStatus: boolean;
  showTaskPriority: boolean;
  showHiddenItemLabels: boolean;
  hiddenItemLabelTypes?: {
    id: boolean;
    status: boolean;
    priority: boolean;
    completed: boolean;
  };
  hideCompletedTasks: boolean;
  syncLiveCursor?: boolean;
  workspaceShowSidebar: boolean;
  kanbanDefaultGroupBy: 'status' | 'section';
  kanbanShowTags: boolean;
  kanbanShowSubtasks: boolean;
  accessibilityReducedMotion: boolean;
  accessibilityHighContrast: boolean;
  recentFiles: RecentFileInfo[];
}

export const DEFAULT_USER_SETTINGS: AppUserSettings = {
  theme: 'dark',
  density: 'normal',
  language: 'en',
  defaultView: 'canvas',
  confirmDeleteWithDependents: true,
  autoSave: true,
  autoSaveIntervalSeconds: 30,
  canvasShowGrid: true,
  canvasSnapToGrid: false,
  canvasInitialZoom: 100,
  showTaskIds: true,
  showTaskStatus: true,
  showTaskPriority: true,
  showHiddenItemLabels: true,
  hiddenItemLabelTypes: {
    id: true,
    status: true,
    priority: true,
    completed: true,
  },
  hideCompletedTasks: false,
  syncLiveCursor: false,
  workspaceShowSidebar: true,
  kanbanDefaultGroupBy: 'status',
  kanbanShowTags: true,
  kanbanShowSubtasks: true,
  accessibilityReducedMotion: false,
  accessibilityHighContrast: false,
  recentFiles: [
    { name: 'TASKS.md', lastOpened: Date.now(), taskCount: 4, groupCount: 2 },
  ],
};

const SETTINGS_STORAGE_KEY = 'antask_user_preferences_v1';

export function loadUserSettings(): AppUserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
      showTaskIds: parsed.showTaskIds !== undefined ? Boolean(parsed.showTaskIds) : DEFAULT_USER_SETTINGS.showTaskIds,
      showTaskStatus: parsed.showTaskStatus !== undefined ? Boolean(parsed.showTaskStatus) : DEFAULT_USER_SETTINGS.showTaskStatus,
      showTaskPriority: parsed.showTaskPriority !== undefined ? Boolean(parsed.showTaskPriority) : DEFAULT_USER_SETTINGS.showTaskPriority,
      showHiddenItemLabels: parsed.showHiddenItemLabels !== undefined ? Boolean(parsed.showHiddenItemLabels) : DEFAULT_USER_SETTINGS.showHiddenItemLabels,
      hiddenItemLabelTypes: {
        id: parsed.hiddenItemLabelTypes?.id !== undefined ? Boolean(parsed.hiddenItemLabelTypes.id) : true,
        status: parsed.hiddenItemLabelTypes?.status !== undefined ? Boolean(parsed.hiddenItemLabelTypes.status) : true,
        priority: parsed.hiddenItemLabelTypes?.priority !== undefined ? Boolean(parsed.hiddenItemLabelTypes.priority) : true,
        completed: parsed.hiddenItemLabelTypes?.completed !== undefined ? Boolean(parsed.hiddenItemLabelTypes.completed) : true,
      },
      hideCompletedTasks: parsed.hideCompletedTasks !== undefined ? Boolean(parsed.hideCompletedTasks) : DEFAULT_USER_SETTINGS.hideCompletedTasks,
      syncLiveCursor: parsed.syncLiveCursor !== undefined ? Boolean(parsed.syncLiveCursor) : DEFAULT_USER_SETTINGS.syncLiveCursor,
      recentFiles: Array.isArray(parsed.recentFiles) ? parsed.recentFiles : DEFAULT_USER_SETTINGS.recentFiles,
    };
  } catch (e) {
    console.warn('Could not load user settings from localStorage:', e);
    return { ...DEFAULT_USER_SETTINGS };
  }
}

export function saveUserSettings(settings: AppUserSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Could not save user settings to localStorage:', e);
  }
}

export function recordRecentFile(fileName: string, taskCount: number, groupCount: number): RecentFileInfo[] {
  const current = loadUserSettings();
  const filtered = (current.recentFiles || []).filter(
    (f) => f.name.toLowerCase() !== fileName.toLowerCase()
  );
  const updated: RecentFileInfo[] = [
    { name: fileName, lastOpened: Date.now(), taskCount, groupCount },
    ...filtered,
  ].slice(0, 10);

  saveUserSettings({ ...current, recentFiles: updated });
  return updated;
}

export function clearRecentFilesHistory(): void {
  const current = loadUserSettings();
  saveUserSettings({ ...current, recentFiles: [] });
}

export function resetUserSettingsToDefault(): AppUserSettings {
  const defaults = { ...DEFAULT_USER_SETTINGS };
  saveUserSettings(defaults);
  return defaults;
}
