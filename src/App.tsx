import { beginSyncSession, getSyncSession, assertSyncSession, invalidateSyncSession, localScope } from './services/syncSessionService';
import { documentSync, mergeSyncValue, syncComparable } from './services/documentSyncService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createShapeId,
  Editor,
  renderPlaintextFromRichText,
  startEditingShapeWithRichText,
  Tldraw,
  TLShapeId,
} from 'tldraw';
import {
  CanvasVisualDocument,
  extractVisualStateFromEditor,
  getSanityConfig,
  loadCanvasVisualState,
  saveCanvasVisualState,
  syncAllTasksToSanity,
  saveWorkspaceToSanity,
  loadWorkspacesFromSanity,
  syncAllWorkspacesToSanity,
  deleteWorkspaceFromSanity,
  subscribeToSanityLiveChanges,
  SanityLiveChangeEvent,
  SanityConfig,
  buildSanityTaskDocId,
  sanitizeSanityDocId,
  normalizeSanityWorkspaceDoc,
  fetchSanityDocumentsList,
  workspacesFromSanityDocuments,
  applyRemoteTask,
  deleteDocumentFromSanity,
} from './services/sanityService';
import {
  CustomNoteShapeUtil,
  isCanvasPopulatingFromMarkdown,
  ITaskGroupShape,
  ITaskShape,
  loadTasksFromMarkdown,
  NOTE_COLOR_OPTIONS,
  ParsedGroup,
  parseTasksMarkdown,
  seedMockTasks,
  TaskGroupShapeUtil,
  TaskPriority,
  TaskShapeUtil,
  TaskStatus,
  updateAllGroupCounts,
} from './shapes/TaskShapeUtil';
import { applyAutoLayout } from './utils/autoLayout';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskDetailsPanel } from './components/TaskDetailsPanel';
import { CommandPalette, CommandPaletteAction, CommandPaletteTask } from './components/CommandPalette';
import { FilterBar, TaskFilterState } from './components/FilterBar';
import {
  setGlobalTaskFilters,
  resetGlobalTaskFilters,
  isTaskMatchingFilters,
  hasActiveFilters,
} from './utils/filterStore';
import { ToastContainer, ToastItem, ToastType } from './components/ToastSystem';
import { QuickGuideModal } from './components/QuickGuideModal';
import { WelcomeModal } from './components/WelcomeModal';
import {
  ActiveConnectionSource,
  getActiveConnectionSource,
  setActiveConnectionSource,
  subscribeToConnectionSource,
} from './utils/taskConnectionManager';
import { SettingsModal } from './components/SettingsModal';
import { ImportExportModal } from './components/ImportExportModal';
import { SanityConfigModal } from './components/SanityConfigModal';
import { SanityProfileManagerModal } from './components/SanityProfileManagerModal';
import { SanityAccountButton } from './components/SanityAccountButton';
import { SanityStudio } from './components/SanityStudio';
import { SanityStudioEmbed } from './components/SanityStudioEmbed';
import { setGlobalSearchQuery } from './utils/searchHighlight';
import { TaskDocumentExplorer } from './components/TaskDocumentExplorer';
import { WorkspaceManagerModal } from './components/WorkspaceManagerModal';
import { SyncOverrideModal } from './components/SyncOverrideModal';
import { NewTaskDocumentModal } from './components/NewTaskDocumentModal';
import { NewBranchModal } from './components/NewBranchModal';
import { GitHubSyncModal } from './components/GitHubSyncModal';
import { RenameDocumentModal } from './components/RenameDocumentModal';
import { NewFolderModal } from './components/NewFolderModal';
import { RenameFolderModal } from './components/RenameFolderModal';
import { MarkdownSplitEditor } from './components/MarkdownSplitEditor';
import { SafeMarkdownNormalizerModal } from './components/SafeMarkdownNormalizerModal';
import { SafeguardPage } from './components/SafeguardPage';
import { LanguageSelector } from './components/LanguageSelector';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { dynamicActivate, formatTime, formatTaskCount, formatSectionCount, formatWorkspaceCount } from './i18n';
import {
  loadWorkspaceStore,
  saveWorkspaceStore,
  createTaskDocument,
  createWorkspaceBranch,
  cloneWorkspace,
  deleteBranchFromWorkspace,
  renameBranchInWorkspace,
  toggleBranchProtectionInWorkspace,
  flushWorkspaceStoreSaves,
  getActiveWorkspace,
  getActiveBranch,
  getActiveDocument,
  createEmptyWorkspace,
  logWorkspaceTrace,
  WorkspaceStoreState,
  Workspace,
  BranchConfig,
  TaskDocument,
  formatDocumentPath,
} from './services/workspaceService';
import {
  AppUserSettings,
  loadUserSettings,
  saveUserSettings,
  recordRecentFile,
} from './services/settingsService';
import { analyzeSyncDifferences } from './services/syncEngineService';
import {
  addTaskToMarkdown,
  assignTaskIdToTask,
  autoAssignAllMissingTaskIds,
  deleteSectionFromMarkdown,
  deleteTaskFromMarkdown,
  findDependentTasks,
  moveTaskToGroupInMarkdown,
  scanNotesFromMarkdown,
  scanTaskBlocks,
  syncNotesToMarkdown,
  updateTaskInMarkdown,
  validateMarkdownDocument,
} from './utils/markdownSync';

export type SyncStatus = 'idle' | 'saving' | 'synced' | 'local' | 'loading';

export const SAMPLE_MARKDOWN = `# Proyecto AnTaskCanvas - Developer Tasks

## Autenticación
- [ ] Configurar OAuth
  id: oauth
  priority: P0
- [ ] Persistir sesión
  id: session
  priority: P0
  blockedBy: oauth

## Perfil
- [ ] Crear pantalla de perfil
  id: profile
  priority: P2
- [x] Añadir avatar
  id: avatar
  priority: P3
  blockedBy: profile
`;

interface DeleteWarningInfo {
  shapeId: string;
  taskId: string;
  title: string;
  dependents: Array<{ taskId: string; title: string; groupTitle: string }>;
}

function toRichTextHelper(text: string) {
  const lines = text.split('\n');
  const content = lines.map((line) => {
    if (!line) {
      return { type: 'paragraph' };
    }
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    };
  });
  return {
    type: 'doc',
    content,
  };
}

function extractPlainTextFromShape(editor: any, shape: any): string {
  if (!shape?.props?.richText) return '';
  try {
    if (editor && typeof renderPlaintextFromRichText === 'function') {
      const rendered = renderPlaintextFromRichText(editor, shape.props.richText);
      if (typeof rendered === 'string') return rendered;
    }
  } catch {
    // fallback below
  }
  const content = shape.props.richText.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p: any) => {
      if (!p.content || !Array.isArray(p.content)) return '';
      return p.content.map((c: any) => c.text || '').join('');
    })
    .join('\n');
}

export default function App() {
  const { i18n } = useLingui();
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // User Settings & Preferences State (DESIGN.md Section 4 & Fase 7)
  const [userSettings, setUserSettings] = useState<AppUserSettings>(() => loadUserSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isImportExportOpen, setIsImportExportOpen] = useState<boolean>(false);

  // Sync language with userSettings
  useEffect(() => {
    if (userSettings.language && i18n.locale !== userSettings.language) {
      dynamicActivate(userSettings.language as any);
    }
  }, [userSettings.language, i18n]);

  // Compute effective theme based on userSettings (including system preference)
  const effectiveTheme = useMemo<'dark' | 'light'>(() => {
    if (userSettings.theme === 'system') {
      return typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return userSettings.theme;
  }, [userSettings.theme]);

  // Sync theme, density, high contrast, and reduced motion attributes with document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', userSettings.density);
  }, [userSettings.density]);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-contrast',
      userSettings.accessibilityHighContrast ? 'high' : 'normal'
    );
  }, [userSettings.accessibilityHighContrast]);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-reduced-motion',
      userSettings.accessibilityReducedMotion ? 'true' : 'false'
    );
  }, [userSettings.accessibilityReducedMotion]);

  const handleUpdateSettings = useCallback((newSettings: AppUserSettings) => {
    setUserSettings(newSettings);
    saveUserSettings(newSettings);
  }, []);

  // Safeguard routing & error detection (e.g. /404, /403, /500, /503 or ?error=404 / unknown sub-paths)
  const [safeguardError, setSafeguardError] = useState<{
    type: '404' | '403' | '500' | '503' | 'generic';
    statusCode: number;
    title?: string;
    message?: string;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error') || params.get('status');

    if (errorParam === '404' || path === '/404') {
      return { type: '404', statusCode: 404 };
    }
    if (errorParam === '403' || path === '/403') {
      return { type: '403', statusCode: 403 };
    }
    if (errorParam === '500' || path === '/500') {
      return { type: '500', statusCode: 500 };
    }
    if (errorParam === '503' || path === '/503') {
      return { type: '503', statusCode: 503 };
    }
    // Check if path is non-root and not /index.html and not a known static path
    if (path !== '/' && path !== '/index.html' && path !== '' && !path.startsWith('/assets')) {
      return {
        type: '404',
        statusCode: 404,
        title: 'Página o ruta no encontrada',
        message: `La ruta "${window.location.pathname}" no existe en la aplicación.`,
      };
    }
    return null;
  });

  // Shell Layout State (DESIGN.md Section 3 & 16)
  const [isMobileScreen, setIsMobileScreen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return false;
  });
  const [activeView, setActiveView] = useState<'canvas' | 'kanban' | 'split' | 'studio'>(() => userSettings.defaultView || 'canvas');
  const [selectedTaskShapeId, setSelectedTaskShapeId] = useState<string | null>(null);
  const [isTaskDetailsOpen, setIsTaskDetailsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    setGlobalSearchQuery(searchQuery);
  }, [searchQuery]);

  const [activeFilter, setActiveFilter] = useState<'all' | 'todo' | 'done' | 'critical' | 'blocked'>('all');

  // Advanced Filters State (DESIGN.md Section 6 & 7)
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>({
    status: 'all',
    priority: 'all',
    section: 'all',
    tag: 'all',
    onlyBlocked: false,
    sortBy: 'default',
  });

  // Sync React taskFilters state into global filter store for canvas shapes & listeners
  useEffect(() => {
    setGlobalTaskFilters(taskFilters);
  }, [taskFilters]);

  // Command Palette & Recent Tasks State (DESIGN.md Section 12 & 15)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('antask_recent_tasks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const pushRecentTask = useCallback((taskId: string) => {
    if (!taskId) return;
    setRecentTaskIds((prev) => {
      const filtered = prev.filter((id) => id.toLowerCase() !== taskId.toLowerCase());
      const next = [taskId, ...filtered].slice(0, 8);
      try {
        localStorage.setItem('antask_recent_tasks', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Global Keyboard Shortcuts (Cmd/Ctrl + K, Cmd/Ctrl + ,, ?, Escape)
  // Canvas interactive tool state & active connection source for central points
  const [currentCanvasTool, setCurrentCanvasTool] = useState<'select' | 'arrow' | 'note' | 'text'>('select');
  const [activeConnectionSource, setActiveConnectionSourceState] = useState<ActiveConnectionSource | null>(null);

  useEffect(() => {
    return subscribeToConnectionSource((src) => {
      setActiveConnectionSourceState(src);
    });
  }, []);

  const handleSelectCanvasTool = useCallback((tool: 'select' | 'arrow' | 'note' | 'text') => {
    if (editor) {
      editor.setCurrentTool(tool);
      setCurrentCanvasTool(tool);
    }
  }, [editor]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest?.('.tl-text-input') ||
          target.closest?.('.ProseMirror'));

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
        return;
      }

      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setIsQuickGuideOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        if (getActiveConnectionSource()) {
          setActiveConnectionSource(null);
        }
      }

      // Quick canvas tool shortcuts when not editing text
      if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          handleSelectCanvasTool('select');
        } else if (e.key === 'n' || e.key === 'N') {
          handleSelectCanvasTool('note');
        } else if (e.key === 't' || e.key === 'T') {
          handleSelectCanvasTool('text');
        } else if (e.key === 'a' || e.key === 'A') {
          handleSelectCanvasTool('arrow');
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleSelectCanvasTool]);

  // Selected Note state for quick color & size toolbar
  const [selectedNoteInfo, setSelectedNoteInfo] = useState<{
    id: string;
    color: string;
    size: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  const handleChangeNoteColor = useCallback((color: string) => {
    if (!editor) return;
    const noteShapes = editor.getSelectedShapes().filter((s) => (s as any).type === 'note');
    if (noteShapes.length > 0) {
      editor.updateShapes(
        noteShapes.map((s) => ({
          id: s.id,
          type: 'note',
          props: { color: color as any },
        }))
      );
      setSelectedNoteInfo((prev) => (prev ? { ...prev, color } : null));
    }
  }, [editor]);

  const handleChangeNoteSize = useCallback((size: 's' | 'm' | 'l' | 'xl') => {
    if (!editor) return;
    const noteShapes = editor.getSelectedShapes().filter((s) => (s as any).type === 'note');
    if (noteShapes.length > 0) {
      editor.updateShapes(
        noteShapes.map((s) => ({
          id: s.id,
          type: 'note',
          props: { size },
        }))
      );
      setSelectedNoteInfo((prev) => (prev ? { ...prev, size } : null));
    }
  }, [editor]);

  const handleDeleteSelectedNotes = useCallback(() => {
    if (!editor) return;
    const noteShapes = editor.getSelectedShapes().filter((s) => (s as any).type === 'note');
    if (noteShapes.length > 0) {
      editor.deleteShapes(noteShapes.map((s) => s.id));
      setSelectedNoteInfo(null);
    }
  }, [editor]);

  // Modals state
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState<boolean>(false);
  const [isViewMarkdownOpen, setIsViewMarkdownOpen] = useState<boolean>(false);
  const [isSanityModalOpen, setIsSanityModalOpen] = useState<boolean>(false);
  const [isSanityProfilesModalOpen, setIsSanityProfilesModalOpen] = useState<boolean>(false);
  const [isNativeStudioModalOpen, setIsNativeStudioModalOpen] = useState<boolean>(false);
  const [isSyncOverrideModalOpen, setIsSyncOverrideModalOpen] = useState<boolean>(false);
  const [isAutoLayoutConfirmOpen, setIsAutoLayoutConfirmOpen] = useState<boolean>(false);
  const [isProblemsModalOpen, setIsProblemsModalOpen] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState<boolean>(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [isQuickGuideOpen, setIsQuickGuideOpen] = useState<boolean>(false);
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return !localStorage.getItem('antask_welcome_dismissed');
  });
  const [isSafeNormalizerOpen, setIsSafeNormalizerOpen] = useState<boolean>(false);
  const [deleteWarningState, setDeleteWarningState] = useState<DeleteWarningInfo | null>(null);

  // Operations and Loading state (DESIGN.md Section 1 & 3)
  const [isAutoOrganizing, setIsAutoOrganizing] = useState<boolean>(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState<boolean>(false);
  const [isCanvasEmptyDismissed, setIsCanvasEmptyDismissed] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Undo history stack for destructive task deletions
  const undoStackRef = useRef<Array<{ markdown: string; label: string }>>([]);

  // Toast System State with Deduplication and Debounce
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastToastTimestampsRef = useRef<Map<string, number>>(new Map());
  const lastLocalWorkspaceMutationTimeRef = useRef<number>(0);
  const pendingWorkspaceDeletionsRef = useRef<
    Map<
      string,
      {
        timeoutId: NodeJS.Timeout;
        workspace: Workspace;
        deleteRemote: boolean;
        deletedAt: number;
      }
    >
  >(new Map());

  // Sanity Live Bidirectional Synchronization State
  const [isLiveSyncActive, setIsLiveSyncActive] = useState<boolean>(false);
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<string | null>(null);


  const pushToast = useCallback(
    (
      message: string,
      type: ToastType = 'info',
      action?: { label: string; onClick: () => void },
      duration?: number
    ) => {
      const trimmed = message ? message.trim() : '';
      if (!trimmed) return;

      const now = Date.now();
      const lastTime = lastToastTimestampsRef.current.get(trimmed) || 0;
      // Deduplicate identical messages sent within 2.5 seconds
      if (now - lastTime < 2500) {
        return;
      }
      lastToastTimestampsRef.current.set(trimmed, now);

      // Clean up ref map to prevent memory leak
      if (lastToastTimestampsRef.current.size > 50) {
        const threshold = now - 10000;
        for (const [key, timestamp] of lastToastTimestampsRef.current.entries()) {
          if (timestamp < threshold) {
            lastToastTimestampsRef.current.delete(key);
          }
        }
      }

      const id = 'toast_' + now + '_' + Math.random().toString(36).substring(2, 6);
      setToasts((prev) => {
        // Prevent adding duplicate message if one is already visible
        if (prev.some((t) => t.message === trimmed)) {
          return prev;
        }
        return [...prev.slice(-2), { id, message: trimmed, type, action, duration }];
      });
    },
    []
  );

  const handleDismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (msg: string, type: ToastType = 'info') => {
      pushToast(msg, type);
    },
    [pushToast]
  );

  // Handle dependency creation from central connection points
  useEffect(() => {
    const handleDepCreated = (e: any) => {
      const { blockerTaskId, blockedTaskId } = e.detail || {};
      if (blockerTaskId && blockedTaskId) {
        setMarkdownInput((curr) => {
          const blocks = scanTaskBlocks(curr).taskBlocks;
          const targetBlock = blocks.find((b) => b.detectedId === blockedTaskId);
          if (!targetBlock) return curr;
          const currentBlockedBy = targetBlock.detectedBlockedBy || '';
          const list = currentBlockedBy
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          if (!list.includes(blockerTaskId.toLowerCase())) {
            const nextBlocked = currentBlockedBy
              ? `${currentBlockedBy}, ${blockerTaskId}`
              : blockerTaskId;
            return updateTaskInMarkdown(curr, blockedTaskId, { blockedBy: nextBlocked });
          }
          return curr;
        });
        pushToast(
          i18n._(msg`Tareas unidas: #${blockerTaskId} bloquea a #${blockedTaskId}`),
          'success'
        );
      }
    };
    window.addEventListener('antask:dependency-created', handleDepCreated);
    return () => window.removeEventListener('antask:dependency-created', handleDepCreated);
  }, [pushToast]);

  // Handle task card moved to another group or separated to Out
  useEffect(() => {
    const handleTaskMovedGroup = (e: any) => {
      const { taskId, targetGroupTitle } = e.detail || {};
      if (taskId && targetGroupTitle) {
        setMarkdownInput((curr) => {
          return moveTaskToGroupInMarkdown(curr, taskId, targetGroupTitle);
        });
        if (editor) {
          updateAllGroupCounts(editor);
        }
      }
    };
    window.addEventListener('antask:task-moved-group', handleTaskMovedGroup);
    return () => window.removeEventListener('antask:task-moved-group', handleTaskMovedGroup);
  }, [editor]);

  // Handle auto-assigning IDs to tasks without them
  const handleAssignSingleTaskId = useCallback(
    (targetIdOrLine: string | number, taskTitle?: string) => {
      setMarkdownInput((curr) => {
        const { updatedMarkdown, taskId } = assignTaskIdToTask(curr, targetIdOrLine, taskTitle);
        if (taskId) {
          pushToast(i18n._(msg`ID #${taskId} asignado a "${taskTitle || taskId}"`), 'success');
        }
        return updatedMarkdown;
      });
    },
    [pushToast]
  );

  const handleAutoAssignAllTaskIds = useCallback(() => {
    setMarkdownInput((curr) => {
      const { updatedMarkdown, assignedCount } = autoAssignAllMissingTaskIds(curr);
      if (assignedCount > 0) {
        pushToast(i18n._(msg`Se asignaron IDs automáticos a ${assignedCount} tareas`), 'success');
      } else {
        pushToast(i18n._(msg`Todas las tareas ya cuentan con ID`), 'info');
      }
      return updatedMarkdown;
    });
  }, [pushToast]);

  useEffect(() => {
    const handleAssignEvent = (e: any) => {
      const { taskId, taskTitle } = e.detail || {};
      if (taskId !== undefined) {
        handleAssignSingleTaskId(taskId, taskTitle);
      }
    };
    const handleBatchAssignEvent = () => {
      handleAutoAssignAllTaskIds();
    };
    const handleDeleteSectionEvent = (e: any) => {
      const { groupTitle, shapeId } = e.detail || {};
      if (groupTitle) {
        const normGroup = groupTitle.trim().toLowerCase().replace(/^#+\s*/, '');
        setMarkdownInput((currentMd) => deleteSectionFromMarkdown(currentMd, groupTitle));

        const ed = editorRef.current;
        if (ed) {
          const allShapes = ed.getCurrentPageShapes();
          const shapesToDelete = new Set<string>();

          if (shapeId) {
            shapesToDelete.add(shapeId);
          }

          for (const s of allShapes) {
            const anyS = s as any;
            if (anyS.type === 'task-group') {
              const title = (anyS.props?.title || '').trim().toLowerCase().replace(/^#+\s*/, '');
              if (title === normGroup) {
                shapesToDelete.add(s.id);
              }
            } else if (anyS.type === 'task') {
              const taskGroup = (anyS.props?.groupTitle || '').trim().toLowerCase().replace(/^#+\s*/, '');
              if (taskGroup === normGroup) {
                shapesToDelete.add(s.id);
              }
            }
          }

          for (const s of allShapes) {
            if ((s as any).type === 'arrow') {
              const bindings = (ed.getBindingsInvolvingShape?.(s) as any[]) || [];
              if (bindings.some((b) => shapesToDelete.has(b.toId) || shapesToDelete.has(b.fromId))) {
                shapesToDelete.add(s.id);
              }
            }
          }

          if (shapesToDelete.size > 0) {
            ed.deleteShapes(Array.from(shapesToDelete) as any);
            triggerDebouncedVisualSave(ed);
          }
        }
        pushToast(i18n._(msg`Sección "${groupTitle}" eliminada`), 'info');
      }
    };

    window.addEventListener('antask:assign-task-id', handleAssignEvent);
    window.addEventListener('antask:auto-assign-all-ids', handleBatchAssignEvent);
    window.addEventListener('antask:delete-section', handleDeleteSectionEvent);

    return () => {
      window.removeEventListener('antask:assign-task-id', handleAssignEvent);
      window.removeEventListener('antask:auto-assign-all-ids', handleBatchAssignEvent);
      window.removeEventListener('antask:delete-section', handleDeleteSectionEvent);
    };
  }, [handleAssignSingleTaskId, handleAutoAssignAllTaskIds]);

  // Online / Offline network status listener
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      pushToast(i18n._(msg`Conexión reestablecida`), 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      pushToast(i18n._(msg`Sin conexión a internet. Los cambios se guardarán localmente.`), 'warning');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pushToast]);

  // Close header more menu on outside click or Escape key
  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setIsHeaderMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isHeaderMenuOpen]);

  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('P1');
  const [newTaskGroup, setNewTaskGroup] = useState<string>('General');
  const [customGroupInput, setCustomGroupInput] = useState<string>('');
  const [isCustomGroup, setIsCustomGroup] = useState<boolean>(false);

  // Workspace and GitHub Repositories Store State
  const [workspaceStore, setWorkspaceStore] = useState<WorkspaceStoreState>(() =>
    getSanityConfig().projectId ? { scope: 'loading', workspaces: [createEmptyWorkspace()], activeWorkspaceId: '' } : loadWorkspaceStore(localScope));
  const workspaceStoreRef = useRef(workspaceStore);
  workspaceStoreRef.current = workspaceStore;
  const [isWorkspaceManagerOpen, setIsWorkspaceManagerOpen] = useState(false);
  const [isNewTaskDocModalOpen, setIsNewTaskDocModalOpen] = useState(false);
  const [newTaskDocPresetFolder, setNewTaskDocPresetFolder] = useState<string>('');
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [renameFolderModalState, setRenameFolderModalState] = useState<{
    isOpen: boolean;
    currentFolder: string;
    docCount: number;
  }>({ isOpen: false, currentFolder: '', docCount: 0 });
  const [isNewBranchModalOpen, setIsNewBranchModalOpen] = useState(false);
  const [isGitHubSyncOpen, setIsGitHubSyncOpen] = useState(false);
  const [renameDocModalState, setRenameDocModalState] = useState<{
    isOpen: boolean;
    docId: string;
    initialName: string;
    initialFolder: string;
  }>({ isOpen: false, docId: '', initialName: '', initialFolder: '' });

  // Computed active entities
  const activeWorkspace = useMemo(() => getActiveWorkspace(workspaceStore), [workspaceStore]);
  const activeWorkspaceRef = useRef<Workspace>(activeWorkspace);
  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);
  const activeBranch = useMemo(() => getActiveBranch(activeWorkspace), [activeWorkspace]);
  const activeDocument = useMemo(() => getActiveDocument(activeBranch), [activeBranch]);

  // Compound key to track exact active document across workspaces & branches
  const currentDocKey = `${activeWorkspace.id}::${activeBranch.name}::${activeDocument.id}`;
  const activeDocKeyRef = useRef<string>(currentDocKey);
  const isSwitchingDocRef = useRef<boolean>(false);
  const appliedRemoteLayoutRef = useRef<string>('');

  // Markdown and sync
  const [currentFileName, setCurrentFileName] = useState<string>(() => activeDocument.path || 'TASKS.md');
  const [markdownInput, setMarkdownInput] = useState<string>(() => activeDocument.content ?? '');
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string>(() => activeDocument.lastSavedContent ?? '');
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef<number>(0);

  const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSanityTasksRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markdownRef = useRef<string>(markdownInput);
  markdownRef.current = markdownInput;
  const lastConflictNotifiedTimeRef = useRef<number>(0);
  const isAutoSavingRef = useRef<boolean>(false);
  const [activeSanityConfig, setActiveSanityConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [syncReady, setSyncReady] = useState(false);
  const syncReadyRef = useRef(false);
  const refreshRemoteRef = useRef<() => Promise<void>>(async () => {});

  // Dynamic profile / configuration sync listener (INV-02, INV-07)
  useEffect(() => {
    const handleConfigChange = (e: any) => {
      flushWorkspaceStoreSaves();
      const updated = e.detail || getSanityConfig();
      syncReadyRef.current = false;
      setSyncReady(false);
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      if (debouncedSanityTasksRef.current) clearTimeout(debouncedSanityTasksRef.current);
      if (markdownEditorDebounceRef.current) clearTimeout(markdownEditorDebounceRef.current);
      pendingWorkspaceDeletionsRef.current.forEach(p => clearTimeout(p.timeoutId));
      pendingWorkspaceDeletionsRef.current.clear();
      const empty = createEmptyWorkspace();
      setWorkspaceStore({ scope: 'loading', workspaces: [empty], activeWorkspaceId: empty.id });
      setMarkdownInput(empty.branches[0].taskDocuments[0].content);
      undoStackRef.current = [];
      setIsLiveSyncActive(false);
      setIsSyncOverrideModalOpen(false);
      setIsNativeStudioModalOpen(false);
      setActiveSanityConfig(updated);
    };
    window.addEventListener('antask_sanity_config_updated', handleConfigChange);
    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleConfigChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshing: Promise<void> | null = null;
    let refreshAgain = false;
    let initializing = false;
    let unsubscribe = () => {};
    const initialize = async () => {
      if (initializing || cancelled) return;
      initializing = true;
      try {
        const session = await beginSyncSession(activeSanityConfig);
        if (cancelled) return;
        if (!session) {
          const local = loadWorkspaceStore(localScope);
          setWorkspaceStore(local);
          syncReadyRef.current = true;
          setSyncReady(true);
          setSyncStatus('local');
          return;
        }
        const saved = loadWorkspaceStore(session.scope);
        workspaceStoreRef.current = saved;
        setWorkspaceStore(saved);
        (saved.remoteDocuments || []).forEach(d => documentSync.observe(d, session));
        const refresh = (): Promise<void> => {
          if (refreshing) { refreshAgain = true; return refreshing; }
          refreshing = (async () => {
            try {
              assertSyncSession(session);
              if (session.config.token) await documentSync.flush(session);
              let docs = await fetchSanityDocumentsList(session.config, true);
              docs = await documentSync.reconcileDeletions(workspaceStoreRef.current.remoteDocuments || [], docs, session.config);
              assertSyncSession(session);
              if (cancelled) return;
              const previous = workspaceStoreRef.current;
              if (previous.scope !== session.scope) return;
              const remote = workspacesFromSanityDocuments(docs);
              const local = previous.workspaces.filter(w => !w.isPlaceholder || w.name !== 'Mi Workspace' ||
                w.branches.some(b => b.taskDocuments.some(d => d.content.trim() !== '# Tareas\n\n## General')));

              const activeWs = previous.workspaces.find(w => w.id === previous.activeWorkspaceId);
              const activeBr = activeWs?.branches.find(b => b.name === activeWs.activeBranchName) || activeWs?.branches[0];
              const activeDoc = activeBr?.taskDocuments.find(d => d.id === activeBr.activeDocumentId) || activeBr?.taskDocuments[0];

              const merged = mergeSyncValue(previous.remoteBase || [], local, remote, '/workspaces') as Workspace[];
              const baseWorkspaces = merged.length ? merged : [previous.workspaces.find(w => w.isPlaceholder) || createEmptyWorkspace()];

              // Keep the active document and navigation intact in this browser session
              const workspaces = baseWorkspaces.map(w => {
                if (w.id !== previous.activeWorkspaceId) return w;
                return {
                  ...w,
                  activeBranchName: activeWs?.activeBranchName || w.activeBranchName,
                  branches: w.branches.map(b => {
                    if (b.name !== activeBr?.name) return b;
                    return {
                      ...b,
                      activeDocumentId: activeBr.activeDocumentId || b.activeDocumentId,
                      taskDocuments: b.taskDocuments.map(d => {
                        if (activeDoc && (d.id === activeDoc.id || d.path === activeDoc.path)) {
                          const liveContent = markdownRef.current !== undefined ? markdownRef.current : activeDoc.content;
                          return { ...d, content: liveContent, lastSavedContent: activeDoc.lastSavedContent };
                        }
                        return d;
                      }),
                    };
                  }),
                };
              });

              const next: WorkspaceStoreState = { ...previous, scope: session.scope, workspaces,
                remoteBase: remote, remoteDocuments: docs,
                activeWorkspaceId: workspaces.some(w => w.id === previous.activeWorkspaceId) ? previous.activeWorkspaceId : workspaces[0].id };
              workspaceStoreRef.current = next;
              saveWorkspaceStore(next);
              setWorkspaceStore(next);
              syncReadyRef.current = true;
              setSyncReady(true);
              setSyncStatus(session.config.token ? 'synced' : 'local');
            } catch (error: any) {
              if (cancelled || getSyncSession() !== session) return;
              syncReadyRef.current = false;
              setSyncReady(false);
              setSyncStatus('local');
              pushToast(error.message, 'warning');
              if (error.name !== 'TypeError') setIsSyncOverrideModalOpen(true);
            } finally {
              refreshing = null;
              if (refreshAgain && !cancelled) { refreshAgain = false; queueMicrotask(() => { void refresh(); }); }
            }
          })();
          return refreshing;
        };
        refreshRemoteRef.current = refresh;
        unsubscribe = subscribeToSanityLiveChanges(event => {
          setIsLiveSyncActive(event.type !== 'connection_error');
          if (event.type !== 'connection_error') void refresh();
        }, session.config);
        await refresh();
      } catch (error: any) {
        if (!cancelled) { setSyncStatus('local'); pushToast(error.message, 'warning'); }
      } finally { initializing = false; }
    };
    void initialize();
    const catchUp = () => {
      if (!getSyncSession(activeSanityConfig) && activeSanityConfig.projectId) void initialize();
      else void refreshRemoteRef.current();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'antaskcanvas_sanity_config') {
        invalidateSyncSession();
        window.dispatchEvent(new CustomEvent('antask_sanity_config_updated', { detail: getSanityConfig() }));
      } else if (event.key?.startsWith('antask_sync_pending:')) catchUp();
    };
    window.addEventListener('online', catchUp);
    window.addEventListener('focus', catchUp);
    window.addEventListener('storage', storageChanged);
    const poll = setInterval(catchUp, 30000);
    return () => {
      cancelled = true;
      unsubscribe();
      invalidateSyncSession();
      syncReadyRef.current = false;
      refreshRemoteRef.current = async () => {};
      clearInterval(poll);
      window.removeEventListener('online', catchUp);
      window.removeEventListener('focus', catchUp);
      window.removeEventListener('storage', storageChanged);
      setIsLiveSyncActive(false);
    };
  }, [activeSanityConfig]);

  // Synchronize canvas shape visibility (cards, groups, and connector arrows) with active filters & search query
  useEffect(() => {
    if (!editor) return;

    const isFilterActive = hasActiveFilters(taskFilters, searchQuery);

    // 1. Deselect any currently selected shape that doesn't match active filters
    const selectedIds = editor.getSelectedShapeIds();
    const shapesToDeselect: TLShapeId[] = [];

    const allShapes = editor.getCurrentPageShapes();
    const hiddenTaskIds = new Set<string>();

    for (const shape of allShapes) {
      const s = shape as any;
      if (s.type === 'task') {
        const taskShape = s as ITaskShape;
        const p = taskShape.props;
        const normalizedStatus = p.completed ? 'done' : p.status || 'todo';
        const matches = !isFilterActive || isTaskMatchingFilters(
          {
            title: p.title,
            taskId: p.taskId,
            completed: p.completed,
            priority: p.priority,
            status: normalizedStatus,
            groupTitle: p.groupTitle,
            tags: p.tags,
            blockedBy: p.blockedBy,
          },
          taskFilters,
          searchQuery
        );

        if (!matches) {
          hiddenTaskIds.add(s.id);
          if (selectedIds.includes(s.id)) {
            shapesToDeselect.push(s.id);
          }
        }

        // Synchronize DOM container visibility
        const el = document.querySelector(`[data-shape-id="${s.id}"]`) as HTMLElement | null;
        if (el) {
          if (!matches) {
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
            el.setAttribute('data-task-hidden', 'true');
          } else {
            el.style.display = '';
            el.style.pointerEvents = '';
            el.removeAttribute('data-task-hidden');
          }
        }
      } else if (s.type === 'task-group') {
        const groupShape = s as ITaskGroupShape;
        const isSectionFilteredOut =
          taskFilters.section !== 'all' &&
          groupShape.props.title.trim().toLowerCase() !== taskFilters.section.trim().toLowerCase();

        if (isSectionFilteredOut) {
          if (selectedIds.includes(s.id)) {
            shapesToDeselect.push(s.id);
          }
        }

        const el = document.querySelector(`[data-shape-id="${s.id}"]`) as HTMLElement | null;
        if (el) {
          if (isSectionFilteredOut) {
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
            el.setAttribute('data-task-hidden', 'true');
          } else {
            el.style.display = '';
            el.style.pointerEvents = '';
            el.removeAttribute('data-task-hidden');
          }
        }
      }
    }

    // 2. Hide any dependency arrow connecting to or from a hidden task card
    for (const shape of allShapes) {
      const s = shape as any;
      if (s.type === 'arrow') {
        const bindings = editor.getBindingsFromShape(s, 'arrow') as any[];
        let shouldHideArrow = false;
        if (isFilterActive && bindings && bindings.length > 0) {
          for (const b of bindings) {
            if (b?.toId && hiddenTaskIds.has(b.toId)) {
              shouldHideArrow = true;
              break;
            }
          }
        }

        const arrowEl = document.querySelector(`[data-shape-id="${s.id}"]`) as HTMLElement | null;
        if (arrowEl) {
          if (shouldHideArrow) {
            arrowEl.style.display = 'none';
            arrowEl.style.pointerEvents = 'none';
            arrowEl.setAttribute('data-task-hidden', 'true');
          } else {
            arrowEl.style.display = '';
            arrowEl.style.pointerEvents = '';
            arrowEl.removeAttribute('data-task-hidden');
          }
        }
      }
    }

    if (shapesToDeselect.length > 0) {
      const remaining = selectedIds.filter((id) => !shapesToDeselect.includes(id));
      editor.setSelectedShapes(remaining);
    }
  }, [editor, taskFilters, searchQuery, markdownInput]);

  // Split View State: Live bidirectional split between Canvas/Kanban and Markdown Editor
  const [isSplitViewOpen, setIsSplitViewOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('antask_split_view');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('antask_split_ratio');
      return saved ? Number(saved) : 50;
    } catch {
      return 50;
    }
  });

  const isDraggingSplitterRef = useRef(false);
  const markdownEditorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleSplitView = useCallback(() => {
    setIsSplitViewOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('antask_split_view', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleSetSplitRatio = useCallback((ratio: number) => {
    const safe = Math.max(20, Math.min(80, ratio));
    setSplitRatio(safe);
    try {
      localStorage.setItem('antask_split_ratio', String(safe));
    } catch {}
  }, []);

  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingSplitterRef.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isDraggingSplitterRef.current) return;
        const container = document.getElementById('antask-split-container');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const offsetX = ev.clientX - rect.left;
        const percentage = 100 - (offsetX / rect.width) * 100;
        const safeRatio = Math.max(20, Math.min(80, percentage));
        setSplitRatio(safeRatio);
      };

      const handlePointerUp = () => {
        isDraggingSplitterRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        try {
          localStorage.setItem('antask_split_ratio', String(splitRatio));
        } catch {}
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [splitRatio]
  );

  // Dual View (Canvas + Kanban) Resizer State
  const [dualRatio, setDualRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('antask_dual_ratio');
      return saved ? Number(saved) : 50;
    } catch {
      return 50;
    }
  });
  const isDraggingDualSplitterRef = useRef(false);

  const handleDualSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDualSplitterRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingDualSplitterRef.current) return;
      const container = document.getElementById('antask-dual-view-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const currentX = moveEvent.clientX - rect.left;
      const percentage = Math.max(20, Math.min(80, (currentX / rect.width) * 100));
      setDualRatio(percentage);
      try {
        localStorage.setItem('antask_dual_ratio', String(percentage));
      } catch {}
    };

    const handleMouseUp = () => {
      isDraggingDualSplitterRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  const triggerDebouncedVisualSave = useCallback((editorInstance: Editor) => {
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current);
    }
    const scheduledSession = getSyncSession();
    const scheduledScope = workspaceStoreRef.current.scope;
    const scheduledKey = currentDocKey;
    const scheduledConfig = getSanityConfig();
    setSyncStatus('saving');
    debouncedSaveRef.current = setTimeout(async () => {
      if (getSyncSession() !== scheduledSession || workspaceStoreRef.current.scope !== scheduledScope || activeDocKeyRef.current !== scheduledKey) return;
      const visualState = extractVisualStateFromEditor(editorInstance);
      {
        // 1. Immediately persist visualState to workspaceStore in localStorage
        setWorkspaceStore((prevStore) => {
          let hasChanges = false;
          const nextWs = prevStore.workspaces.map((ws) => {
            if (ws.id !== prevStore.activeWorkspaceId) return ws;
            const nextBranches = ws.branches.map((b) => {
              if (b.name !== ws.activeBranchName) return b;
              const nextDocs = b.taskDocuments.map((d) => {
                if (d.id !== b.activeDocumentId) return d;
                hasChanges = true;
                return {
                  ...d,
                  visualState: {
                    ...d.visualState,
                    _id: `canvasVisualState-${sanitizeSanityDocId(currentDocKey)}`,
                    _type: 'canvasVisualState' as const,
                    projectId: sanitizeSanityDocId(currentDocKey),
                    tasks: visualState.tasks,
                    groups: visualState.groups,
                    updatedAt: new Date().toISOString(),
                  },
                  updatedAt: new Date().toISOString(),
                };
              });
              return { ...b, taskDocuments: nextDocs };
            });
            return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
          });
          if (!hasChanges) return prevStore;
          const nextStore = { ...prevStore, workspaces: nextWs };
          saveWorkspaceStore(nextStore);
          return nextStore;
        });

        // 2. Persist to canvas visual state cache and remote if configured
        const res = await saveCanvasVisualState(visualState, currentDocKey, scheduledConfig);
        if (getSyncSession() === scheduledSession) setSyncStatus(res.remote ? 'synced' : 'local');
      }
    }, 700);
  }, [currentDocKey]);

  const handleMarkdownEditorChange = useCallback(
    (newMarkdown: string) => {
      setMarkdownInput(newMarkdown);

      if (markdownEditorDebounceRef.current) {
        clearTimeout(markdownEditorDebounceRef.current);
      }

      const scheduledKey = activeDocKeyRef.current;
      const scheduledSession = getSyncSession();
      markdownEditorDebounceRef.current = setTimeout(() => {
        if (activeDocKeyRef.current !== scheduledKey || getSyncSession() !== scheduledSession) return;
        if (editor) {
          const currentVisual = extractVisualStateFromEditor(editor);
          loadTasksFromMarkdown(
            editor,
            newMarkdown,
            {
              ...currentVisual,
              updatedAt: new Date().toISOString(),
            },
            { shouldZoomToFit: false }
          );
          triggerDebouncedVisualSave(editor);
        }
      }, 500);
    },
    [editor, triggerDebouncedVisualSave]
  );

  // Keep workspaceStore synced whenever markdownInput changes (guarding against doc switches with debouncing)
  const markdownStoreSyncDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (isSwitchingDocRef.current || workspaceStoreRef.current.scope === 'loading') return;

    if (markdownStoreSyncDebounceRef.current) {
      clearTimeout(markdownStoreSyncDebounceRef.current);
    }

    markdownStoreSyncDebounceRef.current = setTimeout(() => {
      setWorkspaceStore((prevStore) => {
        let hasChanges = false;
        const nextWs = prevStore.workspaces.map((ws) => {
          if (ws.id !== prevStore.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            const nextDocs = b.taskDocuments.map((d) => {
              if (d.id !== b.activeDocumentId) return d;
              if (d.content === markdownInput) return d;
              hasChanges = true;
              return {
                ...d,
                content: markdownInput,
                updatedAt: new Date().toISOString(),
              };
            });
            return { ...b, taskDocuments: nextDocs };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });

        if (!hasChanges) return prevStore;
        const nextStore = { ...prevStore, workspaces: nextWs };
        workspaceStoreRef.current = nextStore;
        saveWorkspaceStore(nextStore, 350);
        return nextStore;
      });
    }, 200);

    return () => {
      if (markdownStoreSyncDebounceRef.current) {
        clearTimeout(markdownStoreSyncDebounceRef.current);
      }
    };
  }, [markdownInput]);

  // Persist buffered edits before leaving the page or unmounting the editor.
  useEffect(() => {
    const handleVisibility = () => { if (document.visibilityState === 'hidden') flushWorkspaceStoreSaves(); };
    window.addEventListener('pagehide', flushWorkspaceStoreSaves);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flushWorkspaceStoreSaves);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushWorkspaceStoreSaves();
    };
  }, []);

  // Automatic periodic auto-save and cloud conflict detection
  useEffect(() => {
    if (!userSettings.autoSave) return;
    const intervalSec = userSettings.autoSaveIntervalSeconds || 30;
    const timer = setInterval(async () => {
      if (isAutoSavingRef.current || isSwitchingDocRef.current || isLoadingDocument) return;
      isAutoSavingRef.current = true;
      try {
        // 1. Ensure current active document content and visual layout are saved to workspaceStore in localStorage
        setWorkspaceStore((prevStore) => {
          let hasChanges = false;
          const nextWs = prevStore.workspaces.map((ws) => {
            if (ws.id !== prevStore.activeWorkspaceId) return ws;
            const nextBranches = ws.branches.map((b) => {
              if (b.name !== ws.activeBranchName) return b;
              const nextDocs = b.taskDocuments.map((d) => {
                if (d.id !== b.activeDocumentId) return d;
                if (d.content !== markdownInput) {
                  hasChanges = true;
                  return {
                    ...d,
                    content: markdownInput,
                    updatedAt: new Date().toISOString(),
                  };
                }
                return d;
              });
              return { ...b, taskDocuments: nextDocs };
            });
            return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
          });

          if (hasChanges) {
            const nextStore = { ...prevStore, workspaces: nextWs };
            saveWorkspaceStore(nextStore);
            return nextStore;
          }
          return prevStore;
        });

        // 2. If Sanity Cloud is configured, check for differences and notify on conflicts
        const sanityConfig = getSanityConfig();
        if (sanityConfig.projectId && sanityConfig.dataset) {
          const session = getSyncSession(sanityConfig);
          const diffResult = await analyzeSyncDifferences(workspaceStore);
          if (getSyncSession() !== session) return;
          const totalConflicts = diffResult.counts.conflicts + diffResult.counts.remoteOverrides;
          if (totalConflicts > 0) {
            const now = Date.now();
            // Throttle notifications to at most once per 60 seconds
            if (now - lastConflictNotifiedTimeRef.current > 60000) {
              lastConflictNotifiedTimeRef.current = now;
              pushToast(
                i18n._(msg`Conflicto detectado en la sincronización automática (${totalConflicts})`),
                'warning',
                {
                  label: i18n._(msg`Resolver`),
                  onClick: () => setIsSyncOverrideModalOpen(true),
                }
              );
            }
          }
        }
      } catch (e) {
        console.warn('Error during auto-save conflict check:', e);
      } finally {
        isAutoSavingRef.current = false;
      }
    }, Math.max(5, intervalSec) * 1000);

    return () => clearInterval(timer);
  }, [
    userSettings.autoSave,
    userSettings.autoSaveIntervalSeconds,
    markdownInput,
    workspaceStore,
    isLoadingDocument,
    pushToast,
    i18n,
  ]);

  // Reactive and reliable document switching across workspaces, branches and files
  useEffect(() => {
    const layoutRevision = `${currentDocKey}:${(activeDocument.visualState as any)?._rev || ''}`;
    const changedDocument = activeDocKeyRef.current !== currentDocKey;

    if (changedDocument) {
      appliedRemoteLayoutRef.current = layoutRevision;
      isSwitchingDocRef.current = true;
      activeDocKeyRef.current = currentDocKey;
      logWorkspaceTrace(`Cargando documento activo: ${currentDocKey}`, {
        workspace: activeWorkspace.name,
        branch: activeBranch.name,
        path: activeDocument.path,
      });

      setCurrentFileName(activeDocument.path);
      setMarkdownInput(activeDocument.content);
      setLastSavedMarkdown(activeDocument.lastSavedContent);
      setIsCanvasEmptyDismissed(false);

      // Reconcile document-specific filters (sections, tags) with the newly selected TASK.md
      const { groupHeadings, taskBlocks } = scanTaskBlocks(activeDocument.content || '');
      const availableSecs = groupHeadings.map((g) => g.title.toLowerCase());
      const availableTgs = new Set<string>();
      taskBlocks.forEach((b) => b.detectedTags?.forEach((tag) => availableTgs.add(tag.toLowerCase().replace(/^#/, ''))));

      setTaskFilters((prev) => {
        let nextSection = prev.section;
        if (nextSection !== 'all' && !availableSecs.includes(nextSection.toLowerCase())) {
          nextSection = 'all';
        }
        let nextTag = prev.tag;
        if (nextTag !== 'all' && !availableTgs.has(nextTag.toLowerCase().replace(/^#/, ''))) {
          nextTag = 'all';
        }
        if (nextSection !== prev.section || nextTag !== prev.tag) {
          return { ...prev, section: nextSection, tag: nextTag };
        }
        return prev;
      });

      if (editor) {
        loadTasksFromMarkdown(
          editor,
          activeDocument.content,
          activeDocument.visualState,
          { clearNotes: true }
        );
      }

      const timer = setTimeout(() => { isSwitchingDocRef.current = false; }, 60);
      return () => { clearTimeout(timer); isSwitchingDocRef.current = false; };
    } else if (appliedRemoteLayoutRef.current !== layoutRevision) {
      appliedRemoteLayoutRef.current = layoutRevision;
      if (editor && activeDocument.visualState) {
        loadTasksFromMarkdown(
          editor,
          markdownRef.current,
          activeDocument.visualState,
          { clearNotes: false }
        );
      }
    }
  }, [currentDocKey, activeDocument.id, activeDocument.path, (activeDocument.visualState as any)?._rev, activeWorkspace.name, activeBranch.name, editor]);

  useEffect(() => () => {
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    if (markdownEditorDebounceRef.current) clearTimeout(markdownEditorDebounceRef.current);
    pendingWorkspaceDeletionsRef.current.forEach(p => clearTimeout(p.timeoutId));
  }, []);

  // Existing folders in the active branch for autocomplete
  const existingFoldersInBranch = useMemo(() => {
    const folders = new Set<string>();
    (activeBranch?.taskDocuments || []).forEach((doc) => {
      if (doc && doc.folder && doc.folder !== 'root' && doc.folder !== '/') {
        folders.add(doc.folder);
      }
    });
    return Array.from(folders);
  }, [activeBranch]);

  // Workspace actions
  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      logWorkspaceTrace(`[handleSelectWorkspace] Petición de cambio a workspace: "${workspaceId}"`);
      let selectedName = workspaceId;
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (targetWs) {
          selectedName = targetWs.name;
        } else {
          console.warn(
            `[AnTask Workspace Engine] ⚠️ Workspace con ID "${workspaceId}" no encontrado en el store. Workspaces existentes:`,
            prev.workspaces.map((w) => ({ id: w.id, name: w.name }))
          );
          return prev;
        }
        if (prev.activeWorkspaceId === workspaceId) {
          logWorkspaceTrace(
            `[handleSelectWorkspace] El workspace "${targetWs.name}" (${workspaceId}) ya es el activo actualmente. No se requiere cambio.`
          );
          return prev;
        }
        logWorkspaceTrace(
          `[handleSelectWorkspace] Cambiando workspace activo de "${prev.activeWorkspaceId}" a "${workspaceId}" ("${targetWs.name}")`,
          {
            targetWs,
            ramasDisponibles: targetWs.branches?.map((b) => b.name) || [],
          }
        );
        const nextStore = { ...prev, activeWorkspaceId: workspaceId };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Workspace "${selectedName}" cargado`), 'success');
    },
    [pushToast]
  );

  const handleCreateWorkspace = useCallback(
    (newWs: Workspace) => {
      lastLocalWorkspaceMutationTimeRef.current = Date.now();
      setWorkspaceStore((prev) => {
        const nextStore = {
          ...prev,
          workspaces: [...prev.workspaces, newWs],
          activeWorkspaceId: newWs.id,
        };
        saveWorkspaceStore(nextStore);

        const targetBranch = getActiveBranch(newWs);
        const targetDoc = getActiveDocument(targetBranch);
        setCurrentFileName(targetDoc.path);
        setMarkdownInput(targetDoc.content);
        setLastSavedMarkdown(targetDoc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, targetDoc.content, targetDoc.visualState);
          triggerDebouncedVisualSave(editor);
        }


        return nextStore;
      });
      pushToast(i18n._(msg`Workspace "${newWs.name}" creado y activado`), 'success');
    },
    [editor, triggerDebouncedVisualSave, pushToast, i18n]
  );

  const handleUpdateWorkspace = useCallback(
    (updatedWs: Workspace) => {
      lastLocalWorkspaceMutationTimeRef.current = Date.now();
      setWorkspaceStore((prev) => {
        const nextWorkspaces = prev.workspaces.map((w) =>
          w.id === updatedWs.id ? updatedWs : w
        );
        const nextStore: WorkspaceStoreState = {
          ...prev,
          workspaces: nextWorkspaces,
        };
        saveWorkspaceStore(nextStore);


        return nextStore;
      });
      const session = getSyncSession();
      if (session && syncReadyRef.current && updatedWs.id !== workspaceStoreRef.current.activeWorkspaceId) {
        void saveWorkspaceToSanity(updatedWs, session.config).then(res => {
          if (getSyncSession() !== session) return;
          if (!res.ok) pushToast(res.message, 'warning');
          else void refreshRemoteRef.current();
        });
      }
      pushToast(i18n._(msg`Workspace "${updatedWs.name}" actualizado`), 'success');
    },
    [pushToast, i18n]
  );

  const handleUndoDeleteWorkspace = useCallback(
    (wsId: string) => {
      const cleanTargetId = wsId.replace(/^workspace-/, '');
      const pending =
        pendingWorkspaceDeletionsRef.current.get(wsId) ||
        pendingWorkspaceDeletionsRef.current.get(cleanTargetId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      pendingWorkspaceDeletionsRef.current.delete(wsId);
      pendingWorkspaceDeletionsRef.current.delete(cleanTargetId);
      if (pending.workspace?.id) {
        pendingWorkspaceDeletionsRef.current.delete(pending.workspace.id);
      }
      lastLocalWorkspaceMutationTimeRef.current = Date.now();

      if (!pending.workspace?.branches) {
        // Remote-only placeholder workspace restoration
        pushToast(
          i18n._(msg`Eliminación cancelada. El workspace remoto se ha conservado.`),
          'success'
        );
        return;
      }

      setWorkspaceStore((prev) => {
        const isOnlyFreshPlaceholder =
          prev.workspaces.length === 1 &&
          prev.workspaces[0].name === 'Mi Workspace' &&
          prev.workspaces[0].id.startsWith('ws_');

        const nextWorkspaces = isOnlyFreshPlaceholder
          ? [pending.workspace]
          : [...prev.workspaces.filter((w) => w.id !== pending.workspace.id), pending.workspace];

        const nextStore: WorkspaceStoreState = {
          ...prev,
          workspaces: nextWorkspaces,
          activeWorkspaceId: pending.workspace.id,
        };
        saveWorkspaceStore(nextStore);

        const activeBr = getActiveBranch(pending.workspace);
        const activeDc = getActiveDocument(activeBr);
        setCurrentFileName(activeDc.path);
        setMarkdownInput(activeDc.content);
        setLastSavedMarkdown(activeDc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, activeDc.content, activeDc.visualState);
          triggerDebouncedVisualSave(editor);
        }

        return nextStore;
      });

      pushToast(
        i18n._(msg`Workspace "${pending.workspace.name}" restaurado con éxito`),
        'success'
      );
    },
    [editor, pushToast, triggerDebouncedVisualSave, i18n]
  );

  const handleDeleteWorkspace = useCallback(
    (wsId: string, deleteRemote: boolean = false) => {
      const cleanTargetId = wsId.replace(/^workspace-/, '');
      const deletionSession = getSyncSession();
      const deletionConfig = getSanityConfig();
      const targetWs = workspaceStore.workspaces.find(
        (w) =>
          w.id === wsId ||
          w.id === cleanTargetId ||
          `ws_${w.id}` === wsId ||
          w.id.replace(/^workspace-/, '') === cleanTargetId
      );

      if (!targetWs) {
        if (deleteRemote) {
          const timeoutId = setTimeout(() => {
            pendingWorkspaceDeletionsRef.current.delete(wsId);
            pendingWorkspaceDeletionsRef.current.delete(cleanTargetId);
            if (getSyncSession() !== deletionSession) return;
            const config = deletionConfig;
            if (config.projectId && config.dataset && config.token) {
              deleteWorkspaceFromSanity(cleanTargetId, config).then(res => {
                if (getSyncSession() === deletionSession && !res.ok) pushToast(res.message, 'error');
              }).catch((e) => {
                console.warn('Error deleting remote workspace permanently from Sanity:', e);
              });
            }
          }, 30000);

          const pendingRecord = {
            timeoutId,
            workspace: { id: wsId, name: wsId } as any,
            deleteRemote: true,
            deletedAt: Date.now(),
          };
          pendingWorkspaceDeletionsRef.current.set(wsId, pendingRecord);
          pendingWorkspaceDeletionsRef.current.set(cleanTargetId, pendingRecord);

          pushToast(
            i18n._(
              msg`Workspace remoto "${wsId}" marcado para eliminar. Destrucción total en Sanity en 30s.`
            ),
            'warning',
            {
              label: i18n._(msg`Deshacer (30s)`),
              onClick: () => handleUndoDeleteWorkspace(wsId),
            },
            30000
          );
        }
        return;
      }

      const actualWsId = targetWs.id;
      lastLocalWorkspaceMutationTimeRef.current = Date.now();

      // Clear any prior pending deletion for this wsId
      const existingPending =
        pendingWorkspaceDeletionsRef.current.get(actualWsId) ||
        pendingWorkspaceDeletionsRef.current.get(wsId);
      if (existingPending) {
        clearTimeout(existingPending.timeoutId);
      }

      // Schedule permanent destruction after 30 seconds
      const timeoutId = setTimeout(() => {
        pendingWorkspaceDeletionsRef.current.delete(actualWsId);
        pendingWorkspaceDeletionsRef.current.delete(wsId);
        if (deleteRemote) {
          if (getSyncSession() !== deletionSession) return;
          const config = deletionConfig;
          if (config.projectId && config.dataset && config.token) {
            deleteWorkspaceFromSanity(actualWsId, config).then(res => {
              if (getSyncSession() === deletionSession && !res.ok) pushToast(res.message, 'error');
            }).catch((e) => {
              console.warn('Error deleting workspace permanently from Sanity:', e);
            });
          }
        }
      }, 30000);

      const pendingRecord = {
        timeoutId,
        workspace: targetWs,
        deleteRemote,
        deletedAt: Date.now(),
      };
      pendingWorkspaceDeletionsRef.current.set(actualWsId, pendingRecord);
      pendingWorkspaceDeletionsRef.current.set(wsId, pendingRecord);

      setWorkspaceStore((prev) => {
        const filtered = prev.workspaces.filter(
          (w) =>
            w.id !== actualWsId &&
            w.id !== wsId &&
            w.id.replace(/^workspace-/, '') !== cleanTargetId
        );
        let nextWorkspaces = filtered;
        let nextActiveId = prev.activeWorkspaceId;

        if (nextWorkspaces.length === 0) {
          const cleanWs = createEmptyWorkspace();
          nextWorkspaces = [cleanWs];
          nextActiveId = cleanWs.id;
        } else if (
          prev.activeWorkspaceId === wsId ||
          prev.activeWorkspaceId === actualWsId ||
          prev.activeWorkspaceId.replace(/^workspace-/, '') === cleanTargetId
        ) {
          nextActiveId = nextWorkspaces[0].id;
        }

        const nextStore: WorkspaceStoreState = {
          ...prev,
          workspaces: nextWorkspaces,
          activeWorkspaceId: nextActiveId,
        };
        saveWorkspaceStore(nextStore);

        const activeWs = getActiveWorkspace(nextStore);
        const activeBr = getActiveBranch(activeWs);
        const activeDc = getActiveDocument(activeBr);
        setCurrentFileName(activeDc.path);
        setMarkdownInput(activeDc.content);
        setLastSavedMarkdown(activeDc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, activeDc.content, activeDc.visualState);
          triggerDebouncedVisualSave(editor);
        }

        return nextStore;
      });

      pushToast(
        deleteRemote
          ? i18n._(
              msg`Workspace "${targetWs.name}" eliminado. Destrucción total en Sanity en 30s.`
            )
          : i18n._(
              msg`Workspace "${targetWs.name}" eliminado. Tienes 30s para revertir el cambio.`
            ),
        'warning',
        {
          label: i18n._(msg`Deshacer (30s)`),
          onClick: () => handleUndoDeleteWorkspace(wsId),
        },
        30000
      );
    },
    [
      editor,
      pushToast,
      triggerDebouncedVisualSave,
      handleUndoDeleteWorkspace,
      workspaceStore.workspaces,
      i18n,
    ]
  );

  // Activate a workspace document imported directly from Sanity Studio or Sanity Cloud
  const handleActivateWorkspaceFromSanity = useCallback(
    (sanityWs: any) => {
      const wsId =
        sanityWs.workspaceId || sanityWs._id?.replace(/^workspace-/, '') || 'ws_' + Date.now();

      const normalizedBranches: BranchConfig[] = (sanityWs.branches || []).map((b: any) => ({
        name: b.name || 'main',
        isProtected: Boolean(b.isProtected),
        activeDocumentId: b.activeDocumentId || b.taskDocuments?.[0]?.id || `doc_${Date.now()}`,
        lastCommit: b.lastCommit,
        taskDocuments: (b.taskDocuments || []).map((d: any) => ({
          id: d.id || `doc_${Date.now()}`,
          name: d.name || 'TASKS.md',
          folder: d.folder || '',
          path: d.path || (d.folder ? `${d.folder}/${d.name || 'TASKS.md'}` : d.name || 'TASKS.md'),
          content:
            d.content ||
            `# ${sanityWs.name || 'Workspace'}\n\n## Tareas Principales\n- [ ] Tarea inicial en Sanity\n  id: task_sanity_init\n  priority: P0\n`,
          lastSavedContent: d.lastSavedContent || d.content || '',
          updatedAt: d.updatedAt || new Date().toISOString(),
        })),
      }));

      const activeBranchName = sanityWs.activeBranchName || normalizedBranches[0]?.name || 'main';

      const targetWorkspace: Workspace = {
        id: wsId,
        name: sanityWs.name || 'Workspace Sanity',
        githubRepo: {
          owner: sanityWs.githubRepo?.owner || 'usuario',
          repo: sanityWs.githubRepo?.repo || 'proyecto',
          fullName:
            sanityWs.githubRepo?.fullName ||
            `${sanityWs.githubRepo?.owner || 'usuario'}/${sanityWs.githubRepo?.repo || 'proyecto'}`,
          url: sanityWs.githubRepo?.url || `https://github.com/${sanityWs.githubRepo?.fullName || 'proyecto'}`,
          defaultBranch: sanityWs.githubRepo?.defaultBranch || 'main',
          isPrivate: Boolean(sanityWs.githubRepo?.isPrivate),
          description: sanityWs.githubRepo?.description || '',
        },
        activeBranchName,
        createdAt: sanityWs.createdAt || new Date().toISOString(),
        updatedAt: sanityWs.updatedAt || new Date().toISOString(),
        branches:
          normalizedBranches.length > 0
            ? normalizedBranches
            : [
                {
                  name: 'main',
                  isProtected: true,
                  activeDocumentId: `doc_${Date.now()}`,
                  taskDocuments: [
                    {
                      id: `doc_${Date.now()}`,
                      name: 'TASKS.md',
                      folder: '',
                      path: 'TASKS.md',
                      content: `# ${sanityWs.name || 'Workspace'}\n\n## Tareas Principales\n- [ ] Tarea inicial en Sanity\n  id: task_sanity_init\n  priority: P0\n`,
                      lastSavedContent: `# ${sanityWs.name || 'Workspace'}\n\n## Tareas Principales\n- [ ] Tarea inicial en Sanity\n  id: task_sanity_init\n  priority: P0\n`,
                      updatedAt: new Date().toISOString(),
                    },
                  ],
                },
              ],
      };

      setWorkspaceStore((prev) => {
        const otherWorkspaces = prev.workspaces.filter((w) => w.id !== wsId);
        const nextStore = {
          ...prev,
          workspaces: [...otherWorkspaces, targetWorkspace],
          activeWorkspaceId: targetWorkspace.id,
        };
        saveWorkspaceStore(nextStore);

        const currentBr = getActiveBranch(targetWorkspace);
        const currentDoc = getActiveDocument(currentBr);

        setCurrentFileName(currentDoc.path);
        setMarkdownInput(currentDoc.content);
        setLastSavedMarkdown(currentDoc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, currentDoc.content, currentDoc.visualState);
          triggerDebouncedVisualSave(editor);
        }

        return nextStore;
      });

      setActiveView('canvas');
      pushToast(i18n._(msg`Workspace "${targetWorkspace.name}" cargado desde Sanity`), 'success');
    },
    [editor, pushToast, triggerDebouncedVisualSave]
  );

  // Sincronizar todos los workspaces locales con el dataset de Sanity
  const handleSyncAllWorkspacesToSanity = useCallback(async () => {
    const config = getSanityConfig();
    if (!config.projectId || !config.dataset || !config.token) {
      pushToast(i18n._(msg`Configura el API Token de Sanity para sincronizar workspaces`), 'warning');
      setIsSanityModalOpen(true);
      return;
    }

    const session = getSyncSession(config);
    const res = await syncAllWorkspacesToSanity(workspaceStore.workspaces, config);
    if (getSyncSession(config) !== session) return;
    if (res.ok) void refreshRemoteRef.current();
    if (res.ok) {
      pushToast(res.message, 'success');
    } else {
      pushToast(res.message, 'error');
    }
  }, [workspaceStore.workspaces, pushToast]);

  // Importar y combinar workspaces almacenados en el dataset de Sanity
  const handleImportWorkspacesFromSanity = useCallback(async () => {
    const config = getSanityConfig();
    if (!config.projectId || !config.dataset) {
      pushToast(i18n._(msg`Configura Sanity (Project ID y Dataset) para importar workspaces`), 'warning');
      setIsSanityModalOpen(true);
      return;
    }

    try {
      const importSession = getSyncSession(config);
      const remoteWorkspaces = await loadWorkspacesFromSanity(config, true);
      if (getSyncSession(config) !== importSession) return;
      if (remoteWorkspaces.length === 0) {
        pushToast(i18n._(msg`No se encontraron documentos _type: "workspace" en Sanity`), 'info');
        return;
      }

      setWorkspaceStore((prev) => {
        const existingIds = new Set(prev.workspaces.map((w) => w.id));
        const merged = [...prev.workspaces];

        for (const rw of remoteWorkspaces) {
          if (existingIds.has(rw.id)) {
            const idx = merged.findIndex((w) => w.id === rw.id);
            if (idx >= 0) merged[idx] = rw;
          } else {
            merged.push(rw);
          }
        }

        const nextStore = {
          ...prev,
          workspaces: merged,
        };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });

      pushToast(formatWorkspaceCount(remoteWorkspaces.length) + ' ' + i18n._(msg`importados desde Sanity`), 'success');
    } catch (err) {
      pushToast(i18n._(msg`Error al importar workspaces desde Sanity`), 'error');
    }
  }, [pushToast]);

  // Persistir un workspace individual hacia Sanity
  const handleSaveSingleWorkspaceToSanity = useCallback(
    async (ws: Workspace) => {
      const config = getSanityConfig();
      if (!config.projectId || !config.dataset || !config.token) {
        pushToast(i18n._(msg`Configura el API Token de Sanity para guardar el workspace`), 'warning');
        setIsSanityModalOpen(true);
        return;
      }

      const session = getSyncSession(config);
      const res = await saveWorkspaceToSanity(ws, config);
      if (getSyncSession(config) !== session) return;
      if (res.ok) void refreshRemoteRef.current();
      if (res.ok) {
        pushToast(res.message, 'success');
      } else {
        pushToast(res.message, 'error');
      }
    },
    [pushToast]
  );

  // Branch actions
  const handleSelectBranch = useCallback(
    (branchName: string) => {
      logWorkspaceTrace(`Cambiando a rama: ${branchName}`);
      setWorkspaceStore((prev) => {
        const currentWs = prev.workspaces.find((w) => w.id === prev.activeWorkspaceId);
        if (currentWs && currentWs.activeBranchName === branchName) return prev;

        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          return { ...ws, activeBranchName: branchName, updatedAt: new Date().toISOString() };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Rama "${branchName}" activada`), 'info');
    },
    [pushToast]
  );

  const handleCreateBranch = useCallback(
    (branchName: string, sourceBranchName: string | null) => {
      setWorkspaceStore((prev) => {
        const currentWs = getActiveWorkspace(prev);
        const newBranch = createWorkspaceBranch(currentWs, branchName, sourceBranchName);

        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          return {
            ...ws,
            activeBranchName: branchName,
            branches: [...ws.branches, newBranch],
            updatedAt: new Date().toISOString(),
          };
        });

        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Rama "${branchName}" creada y activada`), 'success');
    },
    [pushToast]
  );

  // Branch CRUD handlers that operate on any workspace (not just the active one)
  const handleManagerSelectBranch = useCallback(
    (workspaceId: string, branchName: string) => {
      logWorkspaceTrace(`WorkspaceManager: Activando rama "${branchName}" en workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== workspaceId) return ws;
          if (ws.activeBranchName === branchName) return ws;
          return { ...ws, activeBranchName: branchName, updatedAt: new Date().toISOString() };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Rama "${branchName}" activada`), 'info');
    },
    [pushToast]
  );

  const handleManagerCreateBranch = useCallback(
    (workspaceId: string, branchName: string, sourceBranchName: string | null) => {
      logWorkspaceTrace(`WorkspaceManager: Creando rama "${branchName}" en workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) return prev;
        const newBranch = createWorkspaceBranch(targetWs, branchName, sourceBranchName);
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== workspaceId) return ws;
          return {
            ...ws,
            activeBranchName: branchName,
            branches: [...ws.branches, newBranch],
            updatedAt: new Date().toISOString(),
          };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Rama "${branchName}" creada`), 'success');
    },
    [pushToast]
  );

  const handleManagerRenameBranch = useCallback(
    (workspaceId: string, oldBranchName: string, newBranchName: string) => {
      logWorkspaceTrace(`WorkspaceManager: Renombrando rama "${oldBranchName}" → "${newBranchName}" en workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) return prev;
        try {
          const updatedWs = renameBranchInWorkspace(targetWs, oldBranchName, newBranchName);
          const nextWsList = prev.workspaces.map((ws) => (ws.id !== workspaceId ? ws : updatedWs));
          const nextStore = { ...prev, workspaces: nextWsList };
          saveWorkspaceStore(nextStore);
          return nextStore;
        } catch (err) {
          pushToast((err as Error).message, 'error');
          return prev;
        }
      });
      pushToast(i18n._(msg`Rama renombrada a "${newBranchName}"`), 'success');
    },
    [pushToast]
  );

  const handleManagerDeleteBranch = useCallback(
    (workspaceId: string, branchName: string) => {
      logWorkspaceTrace(`WorkspaceManager: Eliminando rama "${branchName}" de workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) return prev;
        try {
          const updatedWs = deleteBranchFromWorkspace(targetWs, branchName);
          const nextWsList = prev.workspaces.map((ws) => (ws.id !== workspaceId ? ws : updatedWs));
          const nextStore = { ...prev, workspaces: nextWsList };
          saveWorkspaceStore(nextStore);
          return nextStore;
        } catch (err) {
          pushToast((err as Error).message, 'error');
          return prev;
        }
      });
      pushToast(i18n._(msg`Rama "${branchName}" eliminada`), 'info');
    },
    [pushToast]
  );

  const handleManagerToggleBranchProtection = useCallback(
    (workspaceId: string, branchName: string) => {
      logWorkspaceTrace(`WorkspaceManager: Alternando protección de rama "${branchName}" en workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) return prev;
        const updatedWs = toggleBranchProtectionInWorkspace(targetWs, branchName);
        const nextWsList = prev.workspaces.map((ws) => (ws.id !== workspaceId ? ws : updatedWs));
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
    },
    []
  );

  const handleCloneWorkspace = useCallback(
    (workspaceId: string) => {
      logWorkspaceTrace(`WorkspaceManager: Clonando workspace "${workspaceId}"`);
      setWorkspaceStore((prev) => {
        const targetWs = prev.workspaces.find((w) => w.id === workspaceId);
        if (!targetWs) return prev;
        const clonedWs = cloneWorkspace(targetWs, `${targetWs.name} (Copia)`);
        const nextStore = { ...prev, workspaces: [...prev.workspaces, clonedWs] };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
      pushToast(i18n._(msg`Workspace clonado correctamente`), 'success');
    },
    [pushToast]
  );

  // Task Document actions
  const handleSelectDocument = useCallback(
    (docId: string) => {
      setWorkspaceStore((prev) => {
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            if (b.activeDocumentId === docId) return b;
            return { ...b, activeDocumentId: docId };
          });
          return { ...ws, branches: nextBranches };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        return nextStore;
      });
    },
    []
  );

  const handleCreateTaskDocument = useCallback(
    (newDoc: TaskDocument) => {
      setWorkspaceStore((prev) => {
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            return {
              ...b,
              taskDocuments: [...b.taskDocuments, newDoc],
              activeDocumentId: newDoc.id,
            };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);

        setCurrentFileName(newDoc.path);
        setMarkdownInput(newDoc.content);
        setLastSavedMarkdown(newDoc.lastSavedContent);

        return nextStore;
      });
    },
    []
  );

  const handleRenameTaskDocument = useCallback(
    (docId: string, newName: string, newFolder: string) => {
      const newPath = formatDocumentPath(newFolder, newName);
      setWorkspaceStore((prev) => {
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            const nextDocs = b.taskDocuments.map((d) => {
              if (d.id !== docId) return d;
              return {
                ...d,
                name: newName,
                folder: newFolder,
                path: newPath,
                updatedAt: new Date().toISOString(),
              };
            });
            return { ...b, taskDocuments: nextDocs };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });
        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);

        if (activeDocument.id === docId) {
          setCurrentFileName(newPath);
        }
        return nextStore;
      });
    },
    [activeDocument.id]
  );

  const handleDuplicateTaskDocument = useCallback(
    (docId: string) => {
      setWorkspaceStore((prev) => {
        const activeWs = getActiveWorkspace(prev);
        const activeBr = getActiveBranch(activeWs);
        const targetDoc = activeBr.taskDocuments.find((d) => d.id === docId);
        if (!targetDoc) return prev;

        const copyName = targetDoc.name.replace(/\.md$/, '') + '_copy.md';
        const copyPath = formatDocumentPath(targetDoc.folder, copyName);

        const clonedDoc: TaskDocument = {
          ...targetDoc,
          id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          name: copyName,
          path: copyPath,
          updatedAt: new Date().toISOString(),
        };

        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            return {
              ...b,
              taskDocuments: [...b.taskDocuments, clonedDoc],
              activeDocumentId: clonedDoc.id,
            };
          });
          return { ...ws, branches: nextBranches };
        });

        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);

        setCurrentFileName(clonedDoc.path);
        setMarkdownInput(clonedDoc.content);
        setLastSavedMarkdown(clonedDoc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, clonedDoc.content, clonedDoc.visualState);
          triggerDebouncedVisualSave(editor);
        }

        pushToast(i18n._(msg`Documento duplicado como "${copyPath}"`), 'success');
        return nextStore;
      });
    },
    [editor, pushToast, triggerDebouncedVisualSave]
  );

  const handleDeleteTaskDocument = useCallback(
    (docId: string, docPath: string) => {
      setWorkspaceStore((prev) => {
        const activeWs = getActiveWorkspace(prev);
        const activeBr = getActiveBranch(activeWs);

        if (activeBr.taskDocuments.length <= 1) {
          pushToast(i18n._(msg`No puedes eliminar el único archivo Task MD de la rama`), 'warning');
          return prev;
        }

        const remainingDocs = activeBr.taskDocuments.filter((d) => d.id !== docId);
        const nextActiveDocId = activeBr.activeDocumentId === docId ? remainingDocs[0].id : activeBr.activeDocumentId;

        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            return {
              ...b,
              taskDocuments: remainingDocs,
              activeDocumentId: nextActiveDocId,
            };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });

        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);

        const nextTargetDoc = remainingDocs.find((d) => d.id === nextActiveDocId) || remainingDocs[0];
        setCurrentFileName(nextTargetDoc.path);
        setMarkdownInput(nextTargetDoc.content);
        setLastSavedMarkdown(nextTargetDoc.lastSavedContent);

        if (editor) {
          loadTasksFromMarkdown(editor, nextTargetDoc.content, nextTargetDoc.visualState);
          triggerDebouncedVisualSave(editor);
        }

        pushToast(i18n._(msg`Archivo "${docPath}" eliminado`), 'info');
        return nextStore;
      });
    },
    [editor, pushToast, triggerDebouncedVisualSave]
  );

  const handleRenameFolder = useCallback(
    (oldFolder: string, newFolder: string) => {
      setWorkspaceStore((prev) => {
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            const nextDocs = b.taskDocuments.map((d) => {
              if (d.folder !== oldFolder) return d;
              const nextPath = formatDocumentPath(newFolder, d.name);
              return {
                ...d,
                folder: newFolder,
                path: nextPath,
                updatedAt: new Date().toISOString(),
              };
            });
            return { ...b, taskDocuments: nextDocs };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });

        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);

        const currentActiveDoc = getActiveDocument(getActiveBranch(getActiveWorkspace(nextStore)));
        setCurrentFileName(currentActiveDoc.path);

        return nextStore;
      });
    },
    []
  );

  const handleCommitBranch = useCallback(
    (commitMessage: string, author: string) => {
      setWorkspaceStore((prev) => {
        const hash = Math.random().toString(16).substring(2, 9);
        const nextWsList = prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws;
          const nextBranches = ws.branches.map((b) => {
            if (b.name !== ws.activeBranchName) return b;
            const updatedDocs = b.taskDocuments.map((d) => ({
              ...d,
              lastSavedContent: d.content,
            }));
            return {
              ...b,
              lastCommit: {
                hash,
                message: commitMessage,
                author,
                timestamp: new Date().toISOString(),
              },
              taskDocuments: updatedDocs,
            };
          });
          return { ...ws, branches: nextBranches, updatedAt: new Date().toISOString() };
        });

        const nextStore = { ...prev, workspaces: nextWsList };
        saveWorkspaceStore(nextStore);
        setLastSavedMarkdown(markdownInput);
        return nextStore;
      });
    },
    [markdownInput]
  );

  const handleSaveGitHubToken = useCallback((token: string) => {
    setWorkspaceStore((prev) => {
      const nextStore = { ...prev, githubToken: token || undefined };
      saveWorkspaceStore(nextStore);
      return nextStore;
    });
  }, []);

  const customShapeUtils = useMemo(() => [TaskGroupShapeUtil, TaskShapeUtil, CustomNoteShapeUtil], []);


  // Validation Report computed reactively
  const validationReport = useMemo(
    () => validateMarkdownDocument(markdownInput),
    [markdownInput]
  );

  const parsedGroups = useMemo(() => {
    return parseTasksMarkdown(markdownInput);
  }, [markdownInput]);

  const existingSections = useMemo(() => {
    const { groupHeadings } = scanTaskBlocks(markdownInput);
    const titles = groupHeadings
      .map((g) => g.title.trim())
      .filter((t) => t && t.toLowerCase() !== 'notas' && t.toLowerCase() !== 'notes');
    return Array.from(new Set(titles));
  }, [markdownInput]);

  const handleOpenNewTaskModal = useCallback(
    (defaultGroup?: string) => {
      setNewTaskTitle('');
      setNewTaskPriority('P1');
      if (defaultGroup && defaultGroup.trim()) {
        const trimmed = defaultGroup.trim();
        if (existingSections.includes(trimmed)) {
          setNewTaskGroup(trimmed);
          setIsCustomGroup(false);
          setCustomGroupInput('');
        } else {
          setCustomGroupInput(trimmed);
          setIsCustomGroup(true);
        }
      } else {
        if (existingSections.length > 0) {
          setNewTaskGroup(existingSections[0]);
          setIsCustomGroup(false);
          setCustomGroupInput('');
        } else {
          setCustomGroupInput('');
          setIsCustomGroup(true);
        }
      }
      setIsNewTaskModalOpen(true);
    },
    [existingSections]
  );

  // Listen for delete requests from task cards
  useEffect(() => {
    const handleDeleteRequest = (e: Event) => {
      const customEvent = e as CustomEvent<{
        shapeId: string;
        taskId: string;
        title: string;
      }>;
      const { shapeId, taskId, title } = customEvent.detail;
      const finalTaskId = taskId || shapeId;
      const dependents = findDependentTasks(markdownRef.current, finalTaskId, title);

      setDeleteWarningState({
        shapeId: shapeId || finalTaskId,
        taskId: finalTaskId,
        title,
        dependents,
      });
    };

    window.addEventListener('antask-request-delete-task', handleDeleteRequest);

    const handleOpenTaskDetails = (e: Event) => {
      const customEvent = e as CustomEvent<{
        shapeId?: string;
        taskId?: string;
      }>;
      const { shapeId, taskId } = customEvent.detail || {};
      const targetId = shapeId || taskId;
      if (targetId) {
        if (editor && shapeId) {
          try {
            editor.select(shapeId as any);
          } catch {
            // ignore
          }
        }
        setSelectedTaskShapeId(targetId);
        setIsTaskDetailsOpen(true);
      }
    };

    const handleOpenNewTaskModalEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ groupTitle?: string }>;
      const { groupTitle } = customEvent.detail || {};
      handleOpenNewTaskModal(groupTitle);
    };

    window.addEventListener('antask:open-task-details', handleOpenTaskDetails);
    window.addEventListener('antask:open-new-task-modal', handleOpenNewTaskModalEvent);
    return () => {
      window.removeEventListener('antask-request-delete-task', handleDeleteRequest);
      window.removeEventListener('antask:open-task-details', handleOpenTaskDetails);
      window.removeEventListener('antask:open-new-task-modal', handleOpenNewTaskModalEvent);
    };
  }, [editor, handleOpenNewTaskModal]);

  // Selection and Zoom state for Canvas (DESIGN.md Section 14)
  const [canvasZoom, setCanvasZoom] = useState<number>(100);
  const [selectedTaskIdsOnCanvas, setSelectedTaskIdsOnCanvas] = useState<string[]>([]);

  // Selection and Zoom synchronization with editor
  useEffect(() => {
    if (!editor) return;

    let isMounted = true;
    const updateSelectionAndZoom = () => {
      queueMicrotask(() => {
        if (!isMounted || !editor) return;
        try {
          const zoom = Math.round(editor.getZoomLevel() * 100);
          setCanvasZoom((prev) => (prev !== zoom ? zoom : prev));
        } catch {
          // ignore
        }

        try {
          const selected = editor.getSelectedShapes();
          const taskShapes = selected.filter((s) => (s as any).type === 'task');
          const taskIds = taskShapes
            .map((s) => ((s as any).props?.taskId || (s as any).props?.temporaryId || s.id) as string)
            .filter(Boolean);

          setSelectedTaskIdsOnCanvas((prev) => {
            if (prev.length === taskIds.length && prev.every((id, i) => id === taskIds[i])) {
              return prev;
            }
            return taskIds;
          });

          if (taskShapes.length === 1) {
            setSelectedTaskShapeId((prev) => (prev !== taskShapes[0].id ? taskShapes[0].id : prev));
          } else if (taskShapes.length === 0 && activeView === 'canvas') {
            setSelectedTaskShapeId((prev) => (prev !== null ? null : prev));
            setIsTaskDetailsOpen(false);
          }

          // Check for selected note shapes to show color & size quick action toolbar
          const noteShapes = selected.filter((s) => (s as any).type === 'note');
          if (noteShapes.length >= 1) {
            const currentNote = noteShapes[0] as any;
            try {
              const pageBounds = editor.getShapePageBounds(currentNote.id);
              if (pageBounds) {
                const screenPoint = editor.pageToViewport({
                  x: pageBounds.midX,
                  y: pageBounds.minY,
                });
                setSelectedNoteInfo({
                  id: currentNote.id,
                  color: currentNote.props?.color || 'yellow',
                  size: currentNote.props?.size || 'm',
                  screenX: screenPoint.x,
                  screenY: screenPoint.y - 12,
                });
              } else {
                setSelectedNoteInfo(null);
              }
            } catch {
              setSelectedNoteInfo(null);
            }
          } else {
            setSelectedNoteInfo(null);
          }
        } catch {
          // ignore
        }
      });
    };

    updateSelectionAndZoom();
    const unsub = editor.store.listen(updateSelectionAndZoom);
    return () => {
      isMounted = false;
      unsub();
    };
  }, [editor, activeView]);

  // Sync theme with editor user preferences
  useEffect(() => {
    if (editor) {
      editor.user.updateUserPreferences({ colorScheme: effectiveTheme === 'dark' ? 'dark' : 'light' });
    }
  }, [editor, effectiveTheme]);

  const handleMount = useCallback(
    (editorInstance: Editor) => {
      setEditor(editorInstance);
      editorInstance.user.updateUserPreferences({ colorScheme: effectiveTheme === 'dark' ? 'dark' : 'light' });
      (editorInstance.options as any).createTextOnCanvasDoubleClick = false;

      // Container-level double-click listener:
      // - Double click on task card -> opens task details
      // - Double click outside cards -> creates text shape and begins editing
      const container = editorInstance.getContainer();
      const handleContainerDblClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;

        // Skip interactive chrome elements (buttons, inputs, dialogs, toolbar)
        if (target?.closest('button, input, textarea, select, [role="dialog"], #div-app-24, .tl-ui')) {
          return;
        }

        // 1. Check if double-click target is inside a task card element
        const taskCardEl = target?.closest('[id^="task-card-container-"]');
        if (taskCardEl) {
          const shapeId = taskCardEl.id.replace('task-card-container-', '');
          if (shapeId) {
            try {
              editorInstance.select(shapeId as any);
            } catch {
              // ignore
            }
            const shape = editorInstance.getShape(shapeId as any) as any;
            const targetId = shape?.props?.taskId || shape?.props?.temporaryId || shapeId;
            setSelectedTaskShapeId(targetId);
            setIsTaskDetailsOpen(true);
            e.stopPropagation();
            return;
          }
        }

        // 2. Check if a single task shape is selected
        const selected = editorInstance.getSelectedShapes();
        const taskShapes = selected.filter((s) => (s as any).type === 'task');
        if (taskShapes.length === 1) {
          const s = taskShapes[0] as any;
          const targetId = s.props?.taskId || s.props?.temporaryId || s.id;
          if (targetId) {
            setSelectedTaskShapeId(targetId);
            setIsTaskDetailsOpen(true);
            e.stopPropagation();
            return;
          }
        }

        // 3. Check shape at coordinate
        const pagePoint = editorInstance.screenToPage({ x: e.clientX, y: e.clientY });
        let hitShape: any = null;
        try {
          hitShape = editorInstance.getShapeAtPoint(pagePoint) as any;
        } catch {
          // ignore
        }

        if (hitShape && hitShape.type === 'task') {
          try {
            editorInstance.select(hitShape.id);
          } catch {
            // ignore
          }
          const targetId = hitShape.props?.taskId || hitShape.props?.temporaryId || hitShape.id;
          setSelectedTaskShapeId(targetId);
          setIsTaskDetailsOpen(true);
          e.stopPropagation();
          return;
        }

        // 4. If double-clicked on existing text or note shape, let tldraw handle entering edit mode
        if (hitShape && (hitShape.type === 'text' || hitShape.type === 'note')) {
          return;
        }

        // 5. Double click outside cards (empty canvas or inside group background) -> Create text shape!
        try {
          const textId = createShapeId();
          editorInstance.createShapes([
            {
              id: textId,
              type: 'text',
              x: pagePoint.x,
              y: pagePoint.y,
              props: {
                richText: toRichTextHelper(''),
                autoSize: true,
              },
            },
          ]);
          editorInstance.select(textId);
          startEditingShapeWithRichText(editorInstance, textId);
          e.stopPropagation();
        } catch {
          // ignore
        }
      };
      container?.addEventListener('dblclick', handleContainerDblClick, true);

      // Async initialization of visual state
      const initVisualState = async () => {
        setSyncStatus('loading');
        const scheduledKey = activeDocKeyRef.current;
        const scheduledSession = getSyncSession();
        const savedVisualState = await loadCanvasVisualState(scheduledKey);
        if (!isMounted || scheduledKey !== activeDocKeyRef.current || scheduledSession !== getSyncSession()) return;
        if (savedVisualState) {
          setSyncStatus(getSanityConfig().token ? 'synced' : 'local');
        } else {
          setSyncStatus('local');
        }

        // Reconstruct tasks from current active document / markdown with saved visual positions
        const contentToLoad = activeDocument?.content ?? markdownRef.current;
        const visualToLoad = activeDocument?.visualState || savedVisualState;
        loadTasksFromMarkdown(editorInstance, contentToLoad, visualToLoad);
      };

      initVisualState();

      // Debounced note and text synchronization into Markdown (## Notas)
      let notesDebounceTimer: any = null;
      const triggerNotesSync = () => {
        if (notesDebounceTimer) clearTimeout(notesDebounceTimer);
        notesDebounceTimer = setTimeout(() => {
          if (!isMounted) return;
          const noteShapes = editorInstance
            .getCurrentPageShapes()
            .filter((s) => (s as any).type === 'note' || (s as any).type === 'text')
            .sort((a, b) => {
              if (Math.abs(a.y - b.y) > 20) {
                return a.y - b.y;
              }
              return a.x - b.x;
            });

          const notes: string[] = [];
          for (const shape of noteShapes) {
            const plainText = extractPlainTextFromShape(editorInstance, shape);
            const trimmed = plainText.trim();
            if (trimmed) {
              notes.push(trimmed);
            }
          }

          setMarkdownInput((currentMd) => syncNotesToMarkdown(currentMd, notes));
        }, 150);
      };

      // Set up store listener to sync task content edits, moves between groups, notes, and visual persistence
      let isMounted = true;
      const unsubscribe = editorInstance.store.listen((entry) => {
        queueMicrotask(() => {
          if (!isMounted) return;
          if (isCanvasPopulatingFromMarkdown()) return;

          let hasVisualChange = false;
          let hasNoteOrTextChange = false;
          const changes = entry.changes as any;

          if (changes.updated) {
            for (const id of Object.keys(changes.updated)) {
              const [from, to] = changes.updated[id] || [];
              if (to?.typeName === 'shape' || from?.typeName === 'shape') {
                hasVisualChange = true;

                // Detect note or text shape content edits
                if (
                  to?.type === 'note' ||
                  to?.type === 'text' ||
                  from?.type === 'note' ||
                  from?.type === 'text'
                ) {
                  hasNoteOrTextChange = true;
                }

                // 1. Detect task attribute changes (title, completed, priority, status, tags, blockedBy)
                if (to?.type === 'task' && from?.type === 'task') {
                  const toProps = to.props || {};
                  const fromProps = from.props || {};
                  const isTitleChanged = toProps.title !== fromProps.title;
                  const isCompletedChanged = toProps.completed !== fromProps.completed;
                  const isPriorityChanged = toProps.priority !== fromProps.priority;
                  const isStatusChanged = toProps.status !== fromProps.status;
                  const isTagsChanged = JSON.stringify(toProps.tags) !== JSON.stringify(fromProps.tags);
                  const isBlockedByChanged = toProps.blockedBy !== fromProps.blockedBy;

                  if (
                    isTitleChanged ||
                    isCompletedChanged ||
                    isPriorityChanged ||
                    isStatusChanged ||
                    isTagsChanged ||
                    isBlockedByChanged
                  ) {
                    const taskId = toProps.taskId || fromProps.taskId || to.id;
                    const taskTitle = toProps.title || fromProps.title;
                    if (taskId || taskTitle) {
                      setMarkdownInput((currentMd) =>
                        updateTaskInMarkdown(
                          currentMd,
                          taskId,
                          {
                            title: toProps.title,
                            completed: toProps.completed,
                            priority: toProps.priority,
                            status: toProps.status,
                            tags: toProps.tags,
                            blockedBy: toProps.blockedBy,
                          },
                          taskTitle
                        )
                      );
                    }
                  }

                  // 2. Detect moving task into another group bounding box (for non-interactive programmatic moves)
                  const isPositionChanged = to.x !== from.x || to.y !== from.y;
                  if (isPositionChanged && !editorInstance.isIn('select.translating')) {
                    const taskId = toProps.taskId || fromProps.taskId;
                    const taskTitle = toProps.title || fromProps.title;
                    if (taskId || taskTitle) {
                      const taskCenterX = to.x + (toProps.w || 320) / 2;
                      const taskCenterY = to.y + 40;

                      // Find all task-group shapes on canvas
                      const groupShapes = editorInstance
                        .getCurrentPageShapes()
                        .filter((s) => (s as any).type === 'task-group');

                      let foundGroupTitle: string | null = null;
                      for (const gShape of groupShapes) {
                        const g = gShape as any;
                        const gW = g.props?.w || 360;
                        const gH = g.props?.h || 240;

                        if (
                          taskCenterX >= g.x &&
                          taskCenterX <= g.x + gW &&
                          taskCenterY >= g.y &&
                          taskCenterY <= g.y + gH
                        ) {
                          foundGroupTitle = g.props?.title || null;
                          break;
                        }
                      }

                      const targetGroupTitle = foundGroupTitle || 'Out';
                      const currentGroup = toProps.groupTitle || fromProps.groupTitle;
                      if (currentGroup?.trim().toLowerCase() !== targetGroupTitle.trim().toLowerCase()) {
                        setMarkdownInput((curr) =>
                          moveTaskToGroupInMarkdown(curr, taskId, targetGroupTitle, taskTitle)
                        );
                        updateAllGroupCounts(editorInstance);
                      }
                    }
                  }
                }

                // 3. Detect moving task-group shape -> move associated tasks together as a group
                if (to?.type === 'task-group' && from?.type === 'task-group') {
                  const isResizing = to.props?.w !== from.props?.w || to.props?.h !== from.props?.h;
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  if (!isResizing && (dx !== 0 || dy !== 0)) {
                    const selectedIds = new Set(editorInstance.getSelectedShapeIds());
                    const groupTitle = (to.props?.title || '').trim().toLowerCase();

                    const tasksInGroup = (editorInstance
                      .getCurrentPageShapes()
                      .filter((s) => {
                        if ((s as any).type !== 'task') return false;
                        const taskGroup = ((s as any).props?.groupTitle || '').trim().toLowerCase();
                        return taskGroup === groupTitle;
                      }) as any[]);

                    const updates: any[] = [];
                    for (const t of tasksInGroup) {
                      if (!selectedIds.has(t.id)) {
                        updates.push({
                          id: t.id,
                          type: 'task',
                          x: t.x + dx,
                          y: t.y + dy,
                        });
                      }
                    }
                    if (updates.length > 0) {
                      editorInstance.updateShapes(updates);
                    }
                  }
                }
              }
            }
          }

          if (!hasVisualChange && changes.added) {
            for (const id of Object.keys(changes.added)) {
              if (changes.added[id]?.typeName === 'shape') {
                hasVisualChange = true;
                if (changes.added[id]?.type === 'note' || changes.added[id]?.type === 'text') {
                  hasNoteOrTextChange = true;
                }
                break;
              }
            }
          }

          // Detect new arrow bindings to synchronize task dependencies (Blocked by)
          if (changes.added) {
            for (const id of Object.keys(changes.added)) {
              const item = changes.added[id];
              if (item?.typeName === 'binding' && item?.type === 'arrow') {
                hasVisualChange = true;
                const arrow = editorInstance.getShape(item.fromId);
                if (arrow && (arrow as any).type === 'arrow') {
                  const bindings = (editorInstance.getBindingsFromShape(arrow, 'arrow') as any[]) || [];
                  const startB = bindings.find((b) => b.props?.terminal === 'start');
                  const endB = bindings.find((b) => b.props?.terminal === 'end');
                  if (startB && endB) {
                    const startShape = editorInstance.getShape(startB.toId) as any;
                    const endShape = editorInstance.getShape(endB.toId) as any;
                    if (startShape?.type === 'task' && endShape?.type === 'task') {
                      const blockerId = startShape.props?.taskId;
                      const blockedId = endShape.props?.taskId;
                      if (blockerId && blockedId && blockerId !== blockedId) {
                        window.dispatchEvent(
                          new CustomEvent('antask:dependency-created', {
                            detail: { blockerTaskId: blockerId, blockedTaskId: blockedId },
                          })
                        );
                      }
                    }
                  }
                }
              }
            }
          }

          try {
            const toolId = (editorInstance as any).getCurrentToolId?.();
            if (toolId === 'select' || toolId === 'arrow' || toolId === 'note' || toolId === 'text') {
              setCurrentCanvasTool((prev) => (prev !== toolId ? (toolId as any) : prev));
            }
          } catch {
            // ignore
          }

          if (changes.removed) {
            let taskRemoved = false;
            for (const id of Object.keys(changes.removed)) {
              const removedItem = changes.removed[id];
              if (removedItem?.typeName === 'shape') {
                hasVisualChange = true;
                if (removedItem?.type === 'task') {
                  const taskId = removedItem.props?.taskId || removedItem.props?.id || removedItem.id;
                  const taskTitle = removedItem.props?.title;
                  setMarkdownInput((currentMd) =>
                    deleteTaskFromMarkdown(currentMd, taskId, taskTitle)
                  );
                  taskRemoved = true;
                } else if (removedItem?.type === 'task-group') {
                  const groupTitle = removedItem.props?.title;
                  if (groupTitle) {
                    setMarkdownInput((currentMd) =>
                      deleteSectionFromMarkdown(currentMd, groupTitle)
                    );
                    taskRemoved = true;
                  }
                }
                if (removedItem?.type === 'note' || removedItem?.type === 'text') {
                  hasNoteOrTextChange = true;
                }
              }
            }
            if (taskRemoved) {
              updateAllGroupCounts(editorInstance);
            }
          }

          if (hasNoteOrTextChange) {
            triggerNotesSync();
          }

          if (hasVisualChange) {
            triggerDebouncedVisualSave(editorInstance);
          }
        });
      });

      return () => {
        isMounted = false;
        if (notesDebounceTimer) clearTimeout(notesDebounceTimer);
        container?.removeEventListener('dblclick', handleContainerDblClick, true);
        unsubscribe();
        setEditor((curr) => (curr === editorInstance ? null : curr));
      };
    },
    [effectiveTheme, triggerDebouncedVisualSave, setSelectedTaskShapeId, setIsTaskDetailsOpen]
  );

  const handleZoomToFit = useCallback(() => {
    if (editor) {
      editor.zoomToFit({ animation: { duration: 250 } });
    }
  }, [editor]);

  const handleZoomIn = useCallback(() => {
    if (editor) {
      editor.zoomIn(undefined, { animation: { duration: 200 } });
    }
  }, [editor]);

  const handleZoomOut = useCallback(() => {
    if (editor) {
      editor.zoomOut(undefined, { animation: { duration: 200 } });
    }
  }, [editor]);

  const handleResetZoom = useCallback(() => {
    if (editor) {
      editor.resetZoom(undefined, { animation: { duration: 200 } });
    }
  }, [editor]);

  const handleResetLayout = useCallback(async () => {
    if (editor) {
      const currentShapes = editor
        .getCurrentPageShapes()
        .filter(
          (s) =>
            (s as any).type === 'task' ||
            (s as any).type === 'task-group' ||
            (s as any).type === 'arrow'
        );
      if (currentShapes.length > 0) {
        editor.deleteShapes(currentShapes.map((s) => s.id));
      }
      loadTasksFromMarkdown(editor, markdownInput, null);
      triggerDebouncedVisualSave(editor);
      showToast(i18n._(msg`Canvas reiniciado al estado inicial`));
    }
  }, [editor, markdownInput, triggerDebouncedVisualSave]);

  const parsedStats = useMemo(() => {
    const groups = parsedGroups;
    const totalTasks = groups.reduce((acc, g) => acc + g.tasks.length, 0);
    const completedTasks = groups.reduce(
      (acc, g) => acc + g.tasks.filter((t) => t.completed).length,
      0
    );
    const criticalTasks = groups.reduce(
      (acc, g) => acc + g.tasks.filter((t) => t.priority === 'P0').length,
      0
    );
    const blockedTasks = groups.reduce(
      (acc, g) => acc + g.tasks.filter((t) => Boolean(t.blockedBy) && !t.completed).length,
      0
    );

    return {
      groupCount: groups.length,
      taskCount: totalTasks,
      completedCount: completedTasks,
      criticalCount: criticalTasks,
      blockedCount: blockedTasks,
    };
  }, [parsedGroups]);

  const hasUnsavedChanges = useMemo(
    () => markdownInput !== lastSavedMarkdown,
    [markdownInput, lastSavedMarkdown]
  );

  // File Import Processor
  const processLoadedFile = useCallback(
    async (file: File) => {
      const lowerName = file.name.toLowerCase();
      const isMd =
        lowerName.endsWith('.md') ||
        lowerName.endsWith('.markdown') ||
        lowerName.endsWith('.txt') ||
        file.type.includes('markdown') ||
        file.type.includes('text/plain');

      if (!isMd) {
        showToast(i18n._(msg`Por favor selecciona o arrastra un archivo Markdown válido (.md)`));
        return;
      }

      try {
        const fileSession = getSyncSession();
        const fileKey = activeDocKeyRef.current;
        const text = await file.text();
        if (getSyncSession() !== fileSession || activeDocKeyRef.current !== fileKey) return;
        handleCreateTaskDocument(createTaskDocument(file.name, text));
        const groups = parseTasksMarkdown(text);
        const recents = recordRecentFile(file.name, groups.reduce((count, group) => count + group.tasks.length, 0), groups.length);
        setUserSettings((prev) => ({ ...prev, recentFiles: recents }));
      } catch (err) {
        pushToast(i18n._(msg`Error al leer "${file.name}"`), 'error');
      }
    },
    [handleCreateTaskDocument, pushToast]
  );

  const handleImportMarkdownFromModal = useCallback(
    async (newText: string, fileName: string, mode: 'replace' | 'merge') => {
      let finalMarkdown = newText;
      if (mode === 'merge') {
        finalMarkdown = markdownInput.trim() + '\n\n' + newText.trim() + '\n';
      }

      const cleanFileName = fileName || 'TASKS.md';
      setCurrentFileName(cleanFileName);
      setMarkdownInput(finalMarkdown);
      setLastSavedMarkdown(finalMarkdown);

      if (editor) {
        const scheduledSession = getSyncSession();
        const scheduledKey = activeDocKeyRef.current;
        const savedVisualState = await loadCanvasVisualState(scheduledKey);
        if (getSyncSession() !== scheduledSession || activeDocKeyRef.current !== scheduledKey) return;
        const { taskCount, groupCount } = loadTasksFromMarkdown(
          editor,
          finalMarkdown,
          savedVisualState
        );
        const recents = recordRecentFile(cleanFileName, taskCount, groupCount);
        setUserSettings((prev) => ({ ...prev, recentFiles: recents }));
        triggerDebouncedVisualSave(editor);
        pushToast(
          mode === 'replace'
            ? `Documento reemplazado (${taskCount} tareas en ${groupCount} secciones)`
            : `Contenido combinado (${taskCount} tareas en ${groupCount} secciones)`,
          'success'
        );
      }
    },
    [editor, markdownInput, triggerDebouncedVisualSave, pushToast]
  );

  const handleExportMarkdownFromModal = useCallback(
    (content: string, fileName: string, format: 'md' | 'json') => {
      try {
        const mimeType =
          format === 'json'
            ? 'application/json;charset=utf-8'
            : 'text/markdown;charset=utf-8';
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = url;
        downloadAnchor.download = fileName || (format === 'json' ? 'TASKS.json' : 'TASKS.md');
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);
        URL.revokeObjectURL(url);

        setLastSavedMarkdown(markdownInput);
        pushToast(i18n._(msg`Archivo "${fileName}" descargado con éxito`), 'success');
      } catch (err) {
        pushToast(i18n._(msg`Error al exportar archivo`), 'error');
      }
    },
    [markdownInput, pushToast]
  );

  const handleOpenFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processLoadedFile(files[0]);
    }
  };

  const handleExportFile = useCallback(() => {
    try {
      const blob = new Blob([markdownInput], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = currentFileName || 'TASKS.md';
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);

      setLastSavedMarkdown(markdownInput);
      pushToast(i18n._(msg`Archivo "${currentFileName || 'TASKS.md'}" guardado`), 'success');
    } catch (err) {
      pushToast(i18n._(msg`Error al exportar archivo`), 'error');
    }
  }, [markdownInput, currentFileName, pushToast]);

  // Drag & Drop Handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDraggingOver(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      processLoadedFile(file);
    }
  };

  const handleApplyMarkdown = useCallback(async () => {
    if (!editor) return;
    const scheduledSession = getSyncSession();
        const scheduledKey = activeDocKeyRef.current;
        const savedVisualState = await loadCanvasVisualState(scheduledKey);
        if (getSyncSession() !== scheduledSession || activeDocKeyRef.current !== scheduledKey) return;
    const { taskCount, groupCount } = loadTasksFromMarkdown(
      editor,
      markdownInput,
      savedVisualState
    );
    if (taskCount > 0 || groupCount > 0) {
      setIsImportExportOpen(false);
      setLastSavedMarkdown(markdownInput);
      showToast(i18n._(msg`${taskCount} tareas aplicadas al canvas`));
      triggerDebouncedVisualSave(editor);
    } else {
      showToast(i18n._(msg`No se detectaron tareas válidas`));
    }
  }, [editor, markdownInput, triggerDebouncedVisualSave]);

  // Focus a specific task on the canvas
  const handleFocusTaskOnCanvas = (targetTaskId?: string, targetTitle?: string) => {
    if (!editor || !targetTaskId) return;

    const shapes = editor.getCurrentPageShapes();
    const taskShape = shapes.find((s) => {
      if ((s as any).type !== 'task') return false;
      const tProps = (s as any).props || {};
      return (
        tProps.taskId?.toLowerCase() === targetTaskId.toLowerCase() ||
        tProps.title?.toLowerCase() === targetTitle?.toLowerCase()
      );
    });

    if (taskShape) {
      setIsProblemsModalOpen(false);
      editor.select(taskShape.id);
      setSelectedTaskShapeId(taskShape.id);
      editor.zoomToSelection({ animation: { duration: 300 } });
      const focusedLabel = targetTitle || targetTaskId;
      showToast(i18n._(msg`Enfocado: "${focusedLabel}"`));
    } else {
      showToast(i18n._(msg`No se encontró la tarjeta #${targetTaskId} en el canvas`));
    }
  };

  // Focus a specific section group on canvas
  const handleFocusSectionOnCanvas = (sectionTitle: string) => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes();
    const groupShape = shapes.find(
      (s) =>
        (s as any).type === 'task-group' &&
        (s as any).props?.title?.toLowerCase() === sectionTitle.toLowerCase()
    );

    if (groupShape) {
      editor.select(groupShape.id);
      editor.zoomToSelection({ animation: { duration: 300 } });
      showToast(i18n._(msg`Sección: "${sectionTitle}"`));
    }
  };

  // Create New Task Handler
  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const groupTitle = isCustomGroup
      ? (customGroupInput.trim() || 'General')
      : (newTaskGroup.trim() || (existingSections.length > 0 ? existingSections[0] : 'General'));

    const { updatedMarkdown, taskId } = addTaskToMarkdown(markdownInput, {
      title: newTaskTitle.trim(),
      priority: newTaskPriority,
      groupTitle,
    });

    setMarkdownInput(updatedMarkdown);

    if (editor) {
      const allShapes = editor.getCurrentPageShapes();
      const targetGroupShape = allShapes.find(
        (s) =>
          (s as any).type === 'task-group' &&
          (s as any).props?.title?.toLowerCase() === groupTitle.toLowerCase()
      ) as any;

      let targetX = 80;
      let targetY = 160;

      if (targetGroupShape) {
        const tasksInGroup = allShapes.filter(
          (s) =>
            (s as any).type === 'task' &&
            s.x >= targetGroupShape.x &&
            s.x <= targetGroupShape.x + (targetGroupShape.props?.w || 360)
        );

        targetX = targetGroupShape.x + 20;
        targetY = targetGroupShape.y + 70 + tasksInGroup.length * 126;

        const neededHeight = 80 + (tasksInGroup.length + 1) * 126 + 20;
        if (neededHeight > (targetGroupShape.props?.h || 240)) {
          editor.updateShape({
            id: targetGroupShape.id,
            type: 'task-group',
            props: {
              h: neededHeight,
              count: (targetGroupShape.props?.count || 0) + 1,
            },
          } as any);
        }
      } else {
        const existingGroupShapes = allShapes.filter((s) => (s as any).type === 'task-group') as any[];
        let newGroupX = 80;
        let newGroupY = 80;
        if (existingGroupShapes.length > 0) {
          const maxRight = Math.max(...existingGroupShapes.map((g) => (g.x ?? 0) + (g.props?.w ?? 360)));
          const refY = Math.min(...existingGroupShapes.map((g) => g.y ?? 80));
          newGroupX = maxRight + 40;
          newGroupY = refY;
        }

        editor.createShape({
          id: createShapeId(),
          type: 'task-group' as const,
          x: newGroupX,
          y: newGroupY,
          props: {
            w: 360,
            h: 240,
            title: groupTitle,
            count: 1,
            completedCount: 0,
          },
        } as any);

        targetX = newGroupX + 20;
        targetY = newGroupY + 70;
      }

      const newShapeId = createShapeId();
      editor.createShape({
        id: newShapeId,
        type: 'task' as const,
        x: targetX,
        y: targetY,
        props: {
          w: 320,
          h: 110,
          title: newTaskTitle.trim(),
          completed: false,
          priority: newTaskPriority,
          taskId,
        },
      } as any);

      triggerDebouncedVisualSave(editor);
    }

    setNewTaskTitle('');
    setNewTaskPriority('P1');
    setIsNewTaskModalOpen(false);
    showToast(i18n._(msg`Tarea #${taskId} creada en "${groupTitle}"`));
  };

  // Load Sample Project Helper
  const handleLoadSampleProject = useCallback(async () => {
    setIsLoadingDocument(true);
    setCurrentFileName('TASKS.md');
    setMarkdownInput(SAMPLE_MARKDOWN);
    setLastSavedMarkdown(SAMPLE_MARKDOWN);

    if (editor) {
      const currentShapes = editor.getCurrentPageShapes().filter(
        (s) =>
          (s as any).type === 'task' ||
          (s as any).type === 'task-group' ||
          (s as any).type === 'arrow'
      );
      if (currentShapes.length > 0) {
        editor.deleteShapes(currentShapes.map((s) => s.id));
      }
      seedMockTasks(editor, null);
      triggerDebouncedVisualSave(editor);
    }
    setTimeout(() => {
      setIsLoadingDocument(false);
      pushToast(i18n._(msg`Proyecto de ejemplo cargado`), 'success');
    }, 150);
  }, [editor, triggerDebouncedVisualSave, pushToast]);

  // Confirm Delete Task Handler with Undo Action (DESIGN.md Section 9)
  const handleConfirmDeleteTask = () => {
    if (!deleteWarningState) return;
    const { shapeId, taskId, title } = deleteWarningState;
    const priorMarkdown = markdownInput;
    const undoSession = getSyncSession();
    const undoDocKey = activeDocKeyRef.current;

    const updatedMarkdown = deleteTaskFromMarkdown(markdownInput, taskId, title);
    setMarkdownInput(updatedMarkdown);

    if (editor) {
      const allShapes = editor.getCurrentPageShapes();
      const arrowShapesToDelete = allShapes.filter((s) => {
        if ((s as any).type !== 'arrow') return false;
        const bindings = (editor.getBindingsInvolvingShape?.(s) as any[]) || [];
        return bindings.some(
          (b) => b.toId === shapeId || b.fromId === shapeId
        );
      });

      const shapesToDelete = [shapeId, ...arrowShapesToDelete.map((a) => a.id)];
      editor.deleteShapes(shapesToDelete as any);

      if (selectedTaskShapeId === shapeId) {
        setSelectedTaskShapeId(null);
      }

      triggerDebouncedVisualSave(editor);
    } else {
      if (selectedTaskShapeId === taskId || selectedTaskShapeId === shapeId) {
        setSelectedTaskShapeId(null);
      }
    }

    setDeleteWarningState(null);

    pushToast(i18n._(msg`Tarea #${taskId} eliminada`), 'info', {
      label: 'Deshacer',
      onClick: async () => {
        if (getSyncSession() !== undoSession || activeDocKeyRef.current !== undoDocKey) return;
        setMarkdownInput(priorMarkdown);
        if (editor) {
          const visual = await loadCanvasVisualState(currentDocKey);
          if (getSyncSession() !== undoSession || activeDocKeyRef.current !== undoDocKey) return;
          loadTasksFromMarkdown(editor, priorMarkdown, visual, { shouldZoomToFit: false });
          triggerDebouncedVisualSave(editor);
        }
        pushToast(i18n._(msg`Tarea "${title}" restaurada`), 'success');
      },
    });
  };

  // Execute Auto-Layout (DAG hierarchical organizing via Dagre) with local feedback
  const handleExecuteAutoLayout = () => {
    if (!editor) return;
    setIsAutoLayoutConfirmOpen(false);
    setIsAutoOrganizing(true);

    setTimeout(() => {
      try {
        const { taskCount, groupCount } = applyAutoLayout(editor, markdownInput);
        if (taskCount > 0 || groupCount > 0) {
          triggerDebouncedVisualSave(editor);
          pushToast(i18n._(msg`Canvas organizado (${taskCount} tareas en ${groupCount} secciones)`), 'success');
        } else {
          pushToast(i18n._(msg`No hay tareas para organizar`), 'info');
        }
      } catch (err) {
        pushToast(i18n._(msg`Error al organizar el canvas`), 'error');
      } finally {
        setIsAutoOrganizing(false);
      }
    }, 100);
  };

  const handleSanityConfigSaved = useCallback(async (_newConfig: SanityConfig) => {
    setSyncStatus('loading');
  }, []);

  const handleSyncAllTasksToSanity = useCallback(async () => {
    const session = getSyncSession();
    if (!session || !syncReadyRef.current) { pushToast('Espera a que termine la descarga de Sanity', 'warning'); return; }
    const result = await saveWorkspaceToSanity(activeWorkspace, session.config);
    if (getSyncSession() !== session) return;
    pushToast(result.message, result.ok ? 'success' : 'error');
    if (result.ok) await refreshRemoteRef.current();
  }, [activeWorkspace, pushToast]);

  // Local state stays current; only hydrated sessions may publish after a pause.
  useEffect(() => {
    if (!syncReady || !activeSanityConfig.token || !activeSanityConfig.projectId) return;
    const session = getSyncSession(activeSanityConfig);
    if (!session || workspaceStore.scope !== session.scope || markdownInput !== activeDocument.content) return;
    const timer = setTimeout(async () => {
      try {
        assertSyncSession(session);
        const baseWs = workspaceStore.remoteBase?.find(w => w.id === activeWorkspace.id);
        if (JSON.stringify(syncComparable(baseWs)) === JSON.stringify(syncComparable(activeWorkspace))) return;
        const normalized = autoAssignAllMissingTaskIds(markdownInput).updatedMarkdown;
        if (normalized !== markdownInput) { setMarkdownInput(normalized); return; }
        if (!baseWs && activeWorkspace.isPlaceholder && activeWorkspace.name === 'Mi Workspace' && markdownInput.trim() === '# Tareas\n\n## General') return;
        const snapshot = { ...activeWorkspace, branches: activeWorkspace.branches.map(b => b.name === activeBranch.name
          ? { ...b, taskDocuments: b.taskDocuments.map(d => d.id === activeDocument.id ? { ...d, content: markdownInput } : d) } : b) };
        setSyncStatus('saving');
        const result = await saveWorkspaceToSanity(snapshot, session.config);
        assertSyncSession(session);
        if (!result.ok) throw new Error(result.message);
        await refreshRemoteRef.current();
      } catch (error: any) {
        if (getSyncSession() === session) { setSyncStatus('local'); pushToast(error.message, 'warning'); }
      }
    }, 1000);
    debouncedSanityTasksRef.current = timer;
    return () => clearTimeout(timer);
  }, [markdownInput, activeSanityConfig, syncReady, currentDocKey, activeWorkspace, workspaceStore.remoteBase]);

  const handleImportTaskFromSanity = useCallback(
    (taskDoc: any) => {
      if (!taskDoc || !taskDoc.title) return;
      const groupTitle = taskDoc.groupTitle || 'General';
      const { updatedMarkdown, taskId } = addTaskToMarkdown(markdownInput, {
        title: taskDoc.title,
        priority: taskDoc.priority || 'P1',
        groupTitle,
        blockedBy: taskDoc.blockedBy,
        tags: taskDoc.tags,
        subtasks: taskDoc.subtasks,
      });
      setMarkdownInput(updatedMarkdown);
      pushToast(i18n._(msg`Tarea #${taskId} importada de Sanity al lienzo`), 'success');
    },
    [markdownInput, pushToast]
  );

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdownInput);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2000);
  };

  // Kanban update callbacks
  const handleUpdateTaskFromKanban = useCallback(
    (
      taskId: string,
      updates: {
        title?: string;
        completed?: boolean;
        priority?: TaskPriority;
        status?: TaskStatus;
        groupTitle?: string;
        tags?: string[];
        blockedBy?: string;
      }
    ) => {
      setMarkdownInput((currentMd) => {
        let updatedMd = currentMd;

        if (updates.groupTitle) {
          updatedMd = moveTaskToGroupInMarkdown(updatedMd, taskId, updates.groupTitle, updates.title);
        }

        if (
          updates.title !== undefined ||
          updates.completed !== undefined ||
          updates.priority !== undefined ||
          updates.status !== undefined ||
          updates.tags !== undefined ||
          updates.blockedBy !== undefined
        ) {
          updatedMd = updateTaskInMarkdown(
            updatedMd,
            taskId,
            {
              title: updates.title,
              completed: updates.completed,
              priority: updates.priority,
              status: updates.status,
              tags: updates.tags,
              blockedBy: updates.blockedBy,
            },
            updates.title
          );
        }

        return updatedMd;
      });

      if (editor) {
        const shapes = editor.getCurrentPageShapes();
        const taskShape = shapes.find((s) => {
          if ((s as any).type !== 'task') return false;
          const p = (s as any).props || {};
          return (p.taskId && p.taskId.toLowerCase() === taskId.toLowerCase()) || s.id === taskId;
        });

        if (taskShape) {
          editor.updateShape({
            id: taskShape.id,
            type: 'task',
            props: {
              ...(updates.title !== undefined ? { title: updates.title } : {}),
              ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
              ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
              ...(updates.status !== undefined ? { status: updates.status } : {}),
              ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
              ...(updates.blockedBy !== undefined ? { blockedBy: updates.blockedBy } : {}),
              ...(updates.groupTitle !== undefined ? { groupTitle: updates.groupTitle } : {}),
            },
          } as any);
          triggerDebouncedVisualSave(editor);
        }
      }
    },
    [editor, triggerDebouncedVisualSave]
  );

  const handleBatchUpdateTasksFromKanban = useCallback(
    (
      taskIds: string[],
      updates: {
        completed?: boolean;
        priority?: TaskPriority;
        status?: TaskStatus;
      }
    ) => {
      setMarkdownInput((currentMd) => {
        let updatedMd = currentMd;
        for (const taskId of taskIds) {
          updatedMd = updateTaskInMarkdown(updatedMd, taskId, updates);
        }
        return updatedMd;
      });

      if (editor) {
        const shapes = editor.getCurrentPageShapes();
        const batchShapeUpdates: any[] = [];
        for (const taskId of taskIds) {
          const taskShape = shapes.find((s) => {
            if ((s as any).type !== 'task') return false;
            const p = (s as any).props || {};
            return (p.taskId && p.taskId.toLowerCase() === taskId.toLowerCase()) || s.id === taskId;
          });
          if (taskShape) {
            batchShapeUpdates.push({
              id: taskShape.id,
              type: 'task',
              props: {
                ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
                ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
                ...(updates.status !== undefined ? { status: updates.status } : {}),
              },
            });
          }
        }
        if (batchShapeUpdates.length > 0) {
          editor.updateShapes(batchShapeUpdates as any);
        }
        triggerDebouncedVisualSave(editor);
      }
      showToast(i18n._(msg`${taskIds.length} tareas actualizadas`));
    },
    [editor, triggerDebouncedVisualSave]
  );

  const handleBatchDeleteTasksFromKanban = useCallback(
    (taskIds: string[]) => {
      const priorMarkdown = markdownInput;
    const undoSession = getSyncSession();
    const undoDocKey = activeDocKeyRef.current;

      setMarkdownInput((currentMd) => {
        let updatedMd = currentMd;
        for (const taskId of taskIds) {
          updatedMd = deleteTaskFromMarkdown(updatedMd, taskId);
        }
        return updatedMd;
      });

      if (editor) {
        const shapes = editor.getCurrentPageShapes();
        const shapesToDelete: string[] = [];
        for (const taskId of taskIds) {
          const taskShape = shapes.find((s) => {
            if ((s as any).type !== 'task') return false;
            const p = (s as any).props || {};
            return (p.taskId && p.taskId.toLowerCase() === taskId.toLowerCase()) || s.id === taskId;
          });
          if (taskShape) {
            shapesToDelete.push(taskShape.id);
          }
        }
        if (shapesToDelete.length > 0) {
          editor.deleteShapes(shapesToDelete as any);
        }
        triggerDebouncedVisualSave(editor);
      }

      pushToast(i18n._(msg`${taskIds.length} tareas eliminadas`), 'info', {
        label: 'Deshacer',
        onClick: async () => {
          if (getSyncSession() !== undoSession || activeDocKeyRef.current !== undoDocKey) return;
          setMarkdownInput(priorMarkdown);
          if (editor) {
            const visual = await loadCanvasVisualState(undoDocKey);
            if (getSyncSession() !== undoSession || activeDocKeyRef.current !== undoDocKey) return;
            loadTasksFromMarkdown(editor, priorMarkdown, visual, { shouldZoomToFit: false });
            triggerDebouncedVisualSave(editor);
          }
          pushToast(i18n._(msg`${taskIds.length} tareas restauradas`), 'success');
        },
      });
    },
    [editor, markdownInput, pushToast, triggerDebouncedVisualSave]
  );

  // All Parsed Tasks for navigation and linking
  const allParsedTasks = useMemo(() => {
    const { taskBlocks } = scanTaskBlocks(markdownInput);
    return taskBlocks.map((b) => {
      const isCompleted = b.rawTaskLine.includes('[x]') || b.rawTaskLine.includes('[X]');
      return {
        taskId: b.detectedId || b.temporaryId,
        title: b.detectedTitle,
        groupTitle: b.groupTitle || 'General',
        completed: isCompleted,
        priority: (b.detectedPriority || 'P1') as TaskPriority,
        status: ((b.detectedStatus as any) || (isCompleted ? 'done' : 'todo')) as TaskStatus,
        tags: b.detectedTags,
        blockedBy: b.detectedBlockedBy,
      };
    });
  }, [markdownInput]);

  // All Available Tags in markdown
  const allAvailableTags = useMemo(() => {
    const tagSet = new Set<string>();
    allParsedTasks.forEach((t) => {
      t.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet);
  }, [allParsedTasks]);

  // Command Palette Actions (DESIGN.md Section 12)
  const commandActions = useMemo<CommandPaletteAction[]>(
    () => [
      {
        id: 'new-task',
        title: 'Crear nueva tarea',
        shortcut: 'N',
        icon: 'add_circle',
        category: 'action',
        perform: () => {
          handleOpenNewTaskModal();
        },
      },
      {
        id: 'workspace-manager',
        title: 'Administrar Workspaces',
        shortcut: 'W',
        icon: 'source',
        category: 'action',
        perform: () => {
          setIsWorkspaceManagerOpen(true);
        },
      },
      {
        id: 'new-task-doc',
        title: 'Crear nuevo archivo Task MD (raíz, frontend, backend...)',
        shortcut: '⇧N',
        icon: 'note_add',
        category: 'action',
        perform: () => {
          setNewTaskDocPresetFolder('');
          setIsNewTaskDocModalOpen(true);
        },
      },
      {
        id: 'new-branch',
        title: 'Crear nueva rama de trabajo',
        shortcut: 'B',
        icon: 'fork_right',
        category: 'action',
        perform: () => {
          setIsNewBranchModalOpen(true);
        },
      },
      {
        id: 'view-canvas',
        title: 'Cambiar a vista Canvas',
        shortcut: 'V',
        icon: 'grid_view',
        category: 'view',
        perform: () => {
          setActiveView('canvas');
        },
      },
      {
        id: 'view-kanban',
        title: 'Cambiar a vista Kanban',
        shortcut: 'K',
        icon: 'view_kanban',
        category: 'view',
        perform: () => {
          setActiveView('kanban');
        },
      },
      {
        id: 'view-split-canvas-kanban',
        title: 'Cambiar a vista Dual (Canvas + Kanban)',
        shortcut: 'D',
        icon: 'vertical_split',
        category: 'view',
        perform: () => {
          setActiveView('split');
        },
      },
      {
        id: 'view-sanity-studio',
        title: 'Cambiar a vista Sanity Studio (Nativo / SDK)',
        shortcut: 'S',
        icon: 'cloud_sync',
        category: 'view',
        perform: () => {
          setActiveView('studio');
        },
      },
      {
        id: 'open-sanity-studio-embed',
        title: 'Abrir Sanity Studio Nativo Embebido (Ventana Modal)',
        shortcut: '⇧S',
        icon: 'dataset',
        category: 'action',
        perform: () => {
          setIsNativeStudioModalOpen(true);
        },
      },
      {
        id: 'auto-organize',
        title: 'Auto organizar Canvas jerárquicamente (DAG)',
        shortcut: 'A',
        icon: 'account_tree',
        category: 'action',
        perform: () => {
          setIsAutoLayoutConfirmOpen(true);
        },
      },
      {
        id: 'toggle-theme',
        title: `Cambiar a tema ${effectiveTheme === 'dark' ? 'claro' : 'oscuro'}`,
        shortcut: 'T',
        icon: effectiveTheme === 'dark' ? 'light_mode' : 'dark_mode',
        category: 'action',
        perform: () => {
          handleUpdateSettings({
            ...userSettings,
            theme: effectiveTheme === 'dark' ? 'light' : 'dark',
          });
        },
      },
      {
        id: 'open-settings',
        title: 'Abrir configuración y preferencias',
        shortcut: '⌘,',
        icon: 'settings',
        category: 'action',
        perform: () => {
          setIsSettingsOpen(true);
        },
      },
      {
        id: 'sync-sanity-diff',
        title: 'Sincronizar con Sanity (Detectar Overrides y Conflictos)',
        shortcut: '⌘Y',
        icon: 'sync_problem',
        category: 'action',
        perform: () => {
          setIsSyncOverrideModalOpen(true);
        },
      },
      {
        id: 'import-export-modal',
        title: 'Importar / Exportar TASKS.md o JSON',
        shortcut: '⌘E',
        icon: 'sync_alt',
        category: 'action',
        perform: () => {
          setIsImportExportOpen(true);
        },
      },
      {
        id: 'save-file',
        title: 'Guardar archivo TASKS.md',
        shortcut: '⌘S',
        icon: 'save',
        category: 'action',
        perform: () => {
          handleExportFile();
        },
      },
      {
        id: 'view-markdown',
        title: 'Ver TASKS.md en vivo',
        shortcut: 'M',
        icon: 'code',
        category: 'action',
        perform: () => {
          setIsViewMarkdownOpen(true);
        },
      },
      {
        id: 'problems-modal',
        title: 'Ver diagnóstico y problemas de sintaxis',
        shortcut: 'P',
        icon: 'warning',
        category: 'action',
        perform: () => {
          setIsProblemsModalOpen(true);
        },
      },
      {
        id: 'safe-normalize-markdown',
        title: 'Normalizar Markdown (Normalización Segura con Diff Git)',
        shortcut: '⇧⌘N',
        icon: 'verified',
        category: 'action',
        perform: () => {
          setIsSafeNormalizerOpen(true);
        },
      },
      {
        id: 'quick-guide',
        title: 'Guía rápida y atajos de teclado',
        shortcut: '?',
        icon: 'help',
        category: 'action',
        perform: () => {
          setIsQuickGuideOpen(true);
        },
      },
      {
        id: 'welcome-screen',
        title: 'Pantalla de bienvenida y modo demo',
        shortcut: '',
        icon: 'waving_hand',
        category: 'action',
        perform: () => {
          setIsWelcomeModalOpen(true);
        },
      },
      {
        id: 'load-sample-project',
        title: 'Cargar proyecto de ejemplo inicial',
        shortcut: '',
        icon: 'refresh',
        category: 'action',
        perform: () => {
          handleLoadSampleProject();
        },
      },
      {
        id: 'reset-filters',
        title: 'Limpiar todos los filtros y búsqueda',
        shortcut: 'ESC',
        icon: 'filter_alt_off',
        category: 'action',
        perform: () => {
          setSearchQuery('');
          setTaskFilters({
            status: 'all',
            priority: 'all',
            section: 'all',
            tag: 'all',
            onlyBlocked: false,
            sortBy: 'default',
          });
          resetGlobalTaskFilters();
          setActiveFilter('all');
        },
      },
    ],
    [effectiveTheme, handleExportFile]
  );

  // Filtered tasks count computed
  const filteredTasksCount = useMemo(() => {
    return allParsedTasks.filter((t) => {
      return isTaskMatchingFilters(
        {
          title: t.title,
          taskId: t.taskId,
          completed: t.completed,
          priority: t.priority,
          status: t.status,
          groupTitle: t.groupTitle,
          tags: t.tags,
          blockedBy: t.blockedBy,
        },
        taskFilters,
        searchQuery
      );
    }).length;
  }, [allParsedTasks, searchQuery, taskFilters]);

  // Index for cycling through search matches with Enter
  const [searchMatchIndex, setSearchMatchIndex] = useState<number>(0);

  useEffect(() => {
    setSearchMatchIndex(0);
  }, [searchQuery]);

  const handleSearchNextMatch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.toLowerCase();
    const cleanTag = q.replace(/^#/, '');
    const matches = allParsedTasks.filter((t) => {
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchId = t.taskId.toLowerCase().includes(q);
      const matchGroup = t.groupTitle.toLowerCase().includes(q);
      const matchTags = t.tags?.some(
        (tag) => tag.toLowerCase().includes(q) || tag.toLowerCase().includes(cleanTag)
      );
      const matchPriority = t.priority.toLowerCase() === q;
      const matchStatus =
        t.status.toLowerCase().includes(q) ||
        (q === 'done' || q === 'hecho' || q === 'completado' || q === 'completada' ? t.completed : false) ||
        (q === 'todo' || q === 'pendiente' || q === 'por hacer' ? !t.completed : false);
      return matchTitle || matchId || matchGroup || matchTags || matchPriority || matchStatus;
    });

    if (matches.length === 0) {
      showToast(i18n._(msg`No se encontraron resultados para "${searchQuery}"`));
      return;
    }

    const nextIdx = searchMatchIndex % matches.length;
    const target = matches[nextIdx];
    setSearchMatchIndex(nextIdx + 1);

    if (activeView === 'canvas') {
      handleFocusTaskOnCanvas(target.taskId, target.title);
    } else if (activeView === 'kanban') {
      const el = document.getElementById(`div-kanban-card-${target.taskId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-[var(--primary)]');
        setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--primary)]'), 2000);
      }
    }
  }, [searchQuery, allParsedTasks, searchMatchIndex, activeView, handleFocusTaskOnCanvas, showToast, i18n]);

  // Navigate to task from Command Palette or search
  const handleSelectTaskFromPalette = useCallback(
    (taskId: string) => {
      setSelectedTaskShapeId(taskId);
      pushRecentTask(taskId);
      const found = allParsedTasks.find(
        (t) => t.taskId.toLowerCase() === taskId.toLowerCase()
      );
      if (found) {
        if (activeView === 'canvas') {
          handleFocusTaskOnCanvas(found.taskId, found.title);
        } else if (activeView === 'kanban') {
          const el = document.getElementById(`div-kanban-card-${found.taskId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2', 'ring-[var(--primary)]');
            setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--primary)]'), 2000);
          }
        }
      }
    },
    [allParsedTasks, activeView, pushRecentTask, handleFocusTaskOnCanvas]
  );

  // Selected Task Details Helper
  const selectedTaskData = useMemo(() => {
    if (!selectedTaskShapeId) return null;

    const { taskBlocks } = scanTaskBlocks(markdownInput);

    if (editor) {
      const shape = (editor.getShape(selectedTaskShapeId as any) ||
        editor.getCurrentPageShapes().find((s) => {
          if ((s as any).type !== 'task') return false;
          const p = (s as any).props || {};
          return p.taskId === selectedTaskShapeId || p.temporaryId === selectedTaskShapeId || s.id === selectedTaskShapeId;
        })) as any;

      if (shape && shape.type === 'task') {
        const tProps = shape.props || {};
        const resId = tProps.taskId || tProps.temporaryId || selectedTaskShapeId;
        const matchedBlock = taskBlocks.find(
          (b) =>
            (b.detectedId && b.detectedId.toLowerCase() === resId.toLowerCase()) ||
            b.temporaryId.toLowerCase() === resId.toLowerCase()
        );

        return {
          shapeId: shape.id,
          taskId: resId,
          title: tProps.title || '',
          completed: Boolean(tProps.completed),
          priority: (tProps.priority || 'P1') as TaskPriority,
          status: (tProps.status || (tProps.completed ? 'done' : 'todo')) as TaskStatus,
          tags: tProps.tags || matchedBlock?.detectedTags || [],
          subtasks: tProps.subtasks || matchedBlock?.detectedSubtasks,
          blockedBy: tProps.blockedBy || matchedBlock?.detectedBlockedBy || '',
          groupTitle: matchedBlock?.groupTitle || 'General',
          hasMissingId: !matchedBlock?.detectedId,
        };
      }
    }

    const block = taskBlocks.find(
      (b) =>
        (b.detectedId && b.detectedId.toLowerCase() === selectedTaskShapeId.toLowerCase()) ||
        b.temporaryId.toLowerCase() === selectedTaskShapeId.toLowerCase()
    );

    if (block) {
      const isCompleted = block.rawTaskLine.includes('[x]') || block.rawTaskLine.includes('[X]');
      return {
        shapeId: selectedTaskShapeId,
        taskId: block.detectedId || block.temporaryId,
        title: block.detectedTitle,
        completed: isCompleted,
        priority: block.detectedPriority || 'P1',
        status: (block.detectedStatus as any) || (isCompleted ? 'done' : 'todo'),
        tags: block.detectedTags || [],
        subtasks: block.detectedSubtasks,
        blockedBy: block.detectedBlockedBy || '',
        groupTitle: block.groupTitle || 'General',
        hasMissingId: !block.detectedId,
      };
    }

    return null;
  }, [selectedTaskShapeId, editor, markdownInput]);

  if (safeguardError) {
    return (
      <SafeguardPage
        type={safeguardError.type}
        statusCode={safeguardError.statusCode}
        title={safeguardError.title}
        message={safeguardError.message}
        onGoHome={() => {
          setSafeguardError(null);
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/');
          }
        }}
        onRetry={() => {
          setSafeguardError(null);
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        }}
        onResetStorage={() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (e) {
            console.error(e);
          }
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
        }}
      />
    );
  }

  return (
    <div
      id="div-app-root"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col w-screen h-screen overflow-hidden font-sans relative bg-[var(--surface)] text-[var(--on-surface)]"
    >
      {/* Hidden file picker input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        aria-hidden="true"
      />

      {/* Top App Bar (Lightweight, global actions, clean professional tool surface) */}
      <header className="h-11 bg-[var(--surface-container)] border-b border-[var(--outline)] px-3 sm:px-4 flex items-center justify-between z-20 select-none flex-shrink-0 gap-2 sm:gap-3 transition-colors">
        {/* Left Section: Sidebar Toggle, Brand & Workspace / Branch Picker */}
        <div id="div-app-1" className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <button
            id="btn-toggle-sidebar"
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="btn-m3-icon shrink-0 cursor-pointer"
            title={isSidebarOpen ? i18n._(msg`Ocultar panel lateral`) : i18n._(msg`Mostrar panel lateral`)}
            aria-label={i18n._(msg`Alternar panel lateral`)}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isSidebarOpen ? 'menu_open' : 'menu'}
            </span>
          </button>

          <div id="div-app-2" className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div id="div-app-3" className="flex items-center gap-1.5 font-semibold text-xs text-[var(--on-surface)] shrink-0">
              <img src="/logo.png" alt="Logo" className="w-5 h-5 rounded-sm object-contain" />
              <span>Tasks Canvas</span>
            </div>
          </div>
        </div>

        {/* Center Section: View Switcher (Canvas / Kanban / Studio) & Quick Search bar */}
        <div id="div-app-4" className="hidden md:flex items-center gap-2 flex-1 max-w-sm lg:max-w-md mx-2 justify-center min-w-0">
          {/* View Switcher Segmented Control (Canvas / Kanban / Studio) */}
          <div id="div-app-5" className="flex items-center bg-[var(--surface)] p-0.5 rounded-md border border-[var(--outline)] shrink-0">
            <button
              id="btn-view-canvas"
              type="button"
              onClick={() => setActiveView('canvas')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                activeView === 'canvas'
                  ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
              <span className="hidden xl:inline">{i18n._(msg`Canvas`)}</span>
            </button>

            <button
              id="btn-view-kanban"
              type="button"
              onClick={() => setActiveView('kanban')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                activeView === 'kanban'
                  ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">view_kanban</span>
              <span className="hidden xl:inline">{i18n._(msg`Kanban`)}</span>
            </button>

            <button
              id="btn-view-split"
              type="button"
              onClick={() => setActiveView('split')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                activeView === 'split'
                  ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
              title={i18n._(msg`Vista Dual (Canvas y Kanban en dos)`)}
            >
              <span className="material-symbols-outlined text-[16px]">vertical_split</span>
              <span className="hidden xl:inline">{i18n._(msg`Dual`)}</span>
            </button>

            <button
              id="btn-view-studio"
              type="button"
              onClick={() => setActiveView('studio')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                activeView === 'studio'
                  ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">cloud_sync</span>
              <span className="hidden xl:inline">{i18n._(msg`Studio`)}</span>
            </button>
          </div>

          <div id="div-app-6" className="relative w-full hidden md:block max-w-[180px] xl:max-w-[240px]">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--on-surface-variant)] pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearchNextMatch();
                } else if (e.key === 'Escape') {
                  setSearchQuery('');
                }
              }}
              placeholder={i18n._(msg`Buscar...`)}
              title={searchQuery ? i18n._(msg`Presiona Enter para saltar entre resultados, Esc para limpiar`) : i18n._(msg`Buscar...`)}
              className="w-full bg-[var(--surface)] text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] border border-[var(--outline)] rounded pl-8 pr-10 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] transition-all"
            />
            {searchQuery ? (
              <button
                id="btn-clear-search"
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                title={i18n._(msg`Limpiar búsqueda`)}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            ) : (
              <button
                id="btn-open-command-palette-hint"
                type="button"
                onClick={() => setIsCommandPaletteOpen(true)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 py-0.2 rounded bg-[var(--surface-container)] border border-[var(--outline)] text-[9px] font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                title={i18n._(msg`Abrir paleta de comandos (⌘K)`)}
              >
                ⌘K
              </button>
            )}
          </div>
        </div>

        {/* Right Section: Global Actions (Split View, Problems, Help, Settings, Language) */}
        <div id="div-app-7" className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {!isOnline && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/80 border border-amber-700/60 text-amber-300 text-[10px] font-sans">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="hidden sm:inline">{i18n._(msg`Desconectado`)}</span>
            </span>
          )}

          {/* Split View Toggle */}
          <button
            id="btn-toggle-split-view-top"
            type="button"
            onClick={handleToggleSplitView}
            className={`hidden sm:flex px-2 sm:px-2.5 py-1 text-xs font-medium rounded border items-center gap-1 transition-colors cursor-pointer ${
              isSplitViewOpen
                ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)] border-[var(--outline)]'
                : 'bg-[var(--surface)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
            }`}
            title={i18n._(msg`Alternar editor Markdown en panel dividido`)}
          >
            <span className="material-symbols-outlined text-[16px]">
              {isSplitViewOpen ? 'vertical_split' : 'splitscreen'}
            </span>
            <span className="hidden xl:inline">
              {isSplitViewOpen ? i18n._(msg`Cerrar .md`) : i18n._(msg`Ver .md`)}
            </span>
          </button>

          {/* Header Sync & Override Button */}
          <button
            id="btn-header-sync-override"
            type="button"
            onClick={() => setIsSyncOverrideModalOpen(true)}
            className="px-2 sm:px-2.5 py-1 text-xs font-medium rounded border border-[var(--outline)] bg-[var(--surface)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] flex items-center gap-1.5 transition-colors cursor-pointer select-none"
            title={i18n._(msg`Sync & Override (Detección de diferencias, overrides y resolución de conflictos)`)}
            aria-label={i18n._(msg`Sync & Override`)}
          >
            <span className="material-symbols-outlined text-[16px] text-amber-500/90">
              sync_alt
            </span>
            <span className="hidden sm:inline font-sans text-xs">
              {i18n._(msg`Sync & Override`)}
            </span>
          </button>

          {/* Validation Issues Alert Chip (if any) */}
          {validationReport.issues.length > 0 && (
            <button
              id="btn-validation-issues-chip"
              type="button"
              onClick={() => setIsProblemsModalOpen(true)}
              className={`px-2 py-0.5 text-xs font-mono font-semibold rounded border flex items-center gap-1 cursor-pointer ${
                validationReport.hasErrors
                  ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                  : 'bg-amber-950/80 text-amber-300 border-amber-800'
              }`}
              title={i18n._(msg`Ver incidencias detectadas`)}
            >
              <span>⚠</span>
              <span>{validationReport.issues.length}</span>
            </button>
          )}

          {/* Sanity Account / Logo Badge (Top-Right Corner) */}
          <SanityAccountButton
            onOpenConfig={() => setIsSanityModalOpen(true)}
            onOpenProfilesModal={() => setIsSanityProfilesModalOpen(true)}
            onOpenStudio={() => setIsNativeStudioModalOpen(true)}
            onShowToast={pushToast}
          />

          {/* Three Dots Menu Container: Configuración, el ? y el tema */}
          <div id="div-header-more-menu-container" className="relative shrink-0" ref={headerMenuRef}>
            <button
              id="btn-mobile-menu-trigger"
              type="button"
              onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
              className={`btn-m3-icon shrink-0 cursor-pointer ${
                isHeaderMenuOpen ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]' : ''
              }`}
              title={i18n._(msg`Más opciones`)}
              aria-label={i18n._(msg`Más opciones`)}
              aria-haspopup="menu"
              aria-expanded={isHeaderMenuOpen}
            >
              <span className="material-symbols-outlined text-[20px]">more_vert</span>
            </button>

            {isHeaderMenuOpen && (
              <div
                id="div-header-more-menu-dropdown"
                role="menu"
                aria-label={i18n._(msg`Menú de opciones`)}
                className="absolute right-0 top-full mt-1.5 w-56 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in select-none text-xs"
              >
                {/* 1. Tema */}
                <div id="div-header-more-menu-lang" className="px-3 py-2 border-b border-[var(--outline)]">
                  <LanguageSelector onLanguageChange={(lang) => handleUpdateSettings({ ...userSettings, language: lang })} />
                </div>
                <button
                  id="btn-header-more-menu-theme"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    handleUpdateSettings({
                      ...userSettings,
                      theme: effectiveTheme === 'dark' ? 'light' : 'dark',
                    });
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={effectiveTheme === 'dark' ? i18n._(msg`Cambiar a tema claro`) : i18n._(msg`Cambiar a tema oscuro`)}
                >
                  <div id="div-header-more-menu-theme-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">
                      {effectiveTheme === 'dark' ? 'light_mode' : 'dark_mode'}
                    </span>
                    <span className="font-medium">{i18n._(msg`Tema`)}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[var(--on-surface-variant)] capitalize">
                    {effectiveTheme === 'dark' ? i18n._(msg`Oscuro`) : i18n._(msg`Claro`)}
                  </span>
                </button>

                {/* 2. Sync & Override Detection */}
                <button
                  id="btn-header-more-menu-sync-override"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    setIsSyncOverrideModalOpen(true);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={i18n._(msg`Sync & Override Detection (Detección de diferencias y resolución de conflictos)`)}
                >
                  <div id="div-header-more-menu-sync-override-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-amber-400">sync_problem</span>
                    <span className="font-medium">{i18n._(msg`Sync & Override Detection`)}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300">
                    Sync
                  </span>
                </button>

                {/* 3. Configuración */}
                <button
                  id="btn-header-more-menu-settings"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    setIsSettingsOpen(true);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={i18n._(msg`Configuración (⌘,)`)}
                >
                  <div id="div-header-more-menu-settings-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">settings</span>
                    <span className="font-medium">{i18n._(msg`Configuración`)}</span>
                  </div>
                  <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[var(--on-surface-variant)]">
                    ⌘,
                  </kbd>
                </button>

                {/* 3. El ? (Atajos y ayuda) */}
                <button
                  id="btn-header-more-menu-help"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    setIsQuickGuideOpen(true);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={i18n._(msg`Atajos de teclado y ayuda (?)`)}
                >
                  <div id="div-header-more-menu-help-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">help</span>
                    <span className="font-medium">{i18n._(msg`Atajos y ayuda`)}</span>
                  </div>
                  <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[var(--on-surface-variant)]">
                    ?
                  </kbd>
                </button>

                {/* 4. Pantalla de bienvenida y Modo Demo */}
                <button
                  id="btn-header-more-menu-welcome"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    setIsWelcomeModalOpen(true);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={i18n._(msg`Pantalla de bienvenida y modo demo`)}
                >
                  <div id="div-header-more-menu-welcome-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">waving_hand</span>
                    <span className="font-medium">{i18n._(msg`Bienvenida / Demo`)}</span>
                  </div>
                </button>

                {/* En pantallas móviles: acceso rápido al panel de herramientas completo */}
                <div id="div-header-more-menu-mobile-divider" className="sm:hidden my-1 border-t border-[var(--outline)]" />
                <button
                  id="btn-header-more-menu-mobile-drawer"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    setIsMobileMenuOpen(true);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer sm:hidden"
                >
                  <div id="div-header-more-menu-mobile-drawer-content" className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">widgets</span>
                    <span>{i18n._(msg`Todas las herramientas`)}</span>
                  </div>
                  <span className="text-[10px] text-[var(--on-surface-variant)]">➔</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main App Body: Sidebar + Workspace (Canvas) + Details Panel (DESIGN.md Section 3 & 16) */}
      <div id="div-app-8" className="flex-1 w-full flex overflow-hidden relative">
        {/* Mobile Sidebar Overlay Backdrop */}
        {isSidebarOpen && (
          <div
            id="modal-sidebar-backdrop"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden animate-fade-in"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Collapsible Sidebar (Offcanvas on mobile/tablet, Static Column on desktop) */}
        {isSidebarOpen && (
          <aside className="fixed inset-y-0 left-0 z-50 w-72 lg:static lg:z-10 lg:w-64 bg-[var(--surface-container)] border-r border-[var(--outline)] flex flex-col p-3 select-none flex-shrink-0 transition-transform duration-200 shadow-md lg:shadow-none animate-slide-right lg:animate-none">
            {/* Mobile Sidebar Header with Close Button */}
            <div id="div-app-9" className="flex items-center justify-between lg:hidden pb-2 border-b border-[var(--outline)] mb-1">
              <div id="div-app-10" className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sky-400 text-[18px]">folder_open</span>
                <span className="font-semibold text-xs text-[var(--on-surface)]">{i18n._(msg`Documentos de Tareas`)}</span>
              </div>
              <button
                id="btn-close-sidebar-mobile"
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
                aria-label={i18n._(msg`Cerrar explorador`)}
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div id="div-app-11" className="flex-1 flex flex-col gap-3 overflow-y-auto">
              {/* Task MD Documents Explorer (1 to N Task MD files in Root, Frontend, Backend, etc.) */}
              <div id="div-app-12" className="rounded-md bg-[var(--surface)] border border-[var(--outline)]">
                <TaskDocumentExplorer
                  workspace={activeWorkspace}
                  allWorkspaces={workspaceStore.workspaces}
                  activeBranch={activeBranch}
                  activeDocumentId={activeDocument.id}
                  onSelectWorkspace={handleSelectWorkspace}
                  onSelectBranch={handleSelectBranch}
                  onOpenWorkspaceManager={() => {
                    logWorkspaceTrace('Abriendo WorkspaceManagerModal desde Explorador (isWorkspaceManagerOpen -> true)');
                    setIsWorkspaceManagerOpen(true);
                  }}
                  onOpenCreateBranch={() => setIsNewBranchModalOpen(true)}
                  onSelectDocument={handleSelectDocument}
                  onOpenNewDocumentModal={(folder) => {
                    setNewTaskDocPresetFolder(folder || '');
                    setIsNewTaskDocModalOpen(true);
                  }}
                  onOpenNewFolderModal={() => setIsNewFolderModalOpen(true)}
                  onOpenRenameFolderModal={(folder, count) => {
                    setRenameFolderModalState({
                      isOpen: true,
                      currentFolder: folder,
                      docCount: count,
                    });
                  }}
                  onRenameDocument={(docId, currentName, currentFolder) => {
                    setRenameDocModalState({
                      isOpen: true,
                      docId,
                      initialName: currentName,
                      initialFolder: currentFolder,
                    });
                  }}
                  onDuplicateDocument={handleDuplicateTaskDocument}
                  onDeleteDocument={handleDeleteTaskDocument}
                  onExportDocument={(doc) => {
                    handleExportMarkdownFromModal(doc.content, doc.name, 'md');
                  }}
                />
              </div>

              {/* Quick Actions / New Task & File Button */}
              <div id="div-app-13" className="flex items-center gap-2">
                <button
                  id="btn-sidebar-import-file"
                  type="button"
                  onClick={handleOpenFilePicker}
                  className="btn-m3-secondary flex-1 py-1.5 text-xs cursor-pointer"
                  title={i18n._(msg`Abrir TASKS.md desde el equipo`)}
                >
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>
                  <span>{i18n._(msg`Importar .md`)}</span>
                </button>
                <button
                  id="btn-sidebar-import-export-modal"
                  type="button"
                  onClick={() => setIsImportExportOpen(true)}
                  className="btn-m3-secondary px-2.5 py-1.5 text-xs cursor-pointer"
                  title={i18n._(msg`Importar o Exportar TASKS.md / JSON`)}
                >
                  <span className="material-symbols-outlined text-[16px]">sync_alt</span>
                </button>
              </div>

              {/* Quick Filters */}
              <div id="div-app-14" className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider px-2">
                  {i18n._(msg`Filtros & Estados`)}
                </span>

                <button
                  id="btn-filter-all"
                  type="button"
                  onClick={() => {
                    setActiveFilter('all');
                    setTaskFilters((prev) => ({ ...prev, status: 'all', priority: 'all', onlyBlocked: false }));
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFilter === 'all' && taskFilters.status === 'all' && taskFilters.priority === 'all' && !taskFilters.onlyBlocked
                      ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <div id="div-app-15" className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">inbox</span>
                    <span>{i18n._(msg`Todas las tareas`)}</span>
                  </div>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                    {parsedStats.taskCount}
                  </span>
                </button>

                <button
                  id="btn-filter-todo"
                  type="button"
                  onClick={() => {
                    setActiveFilter('todo');
                    setTaskFilters((prev) => ({ ...prev, status: 'todo', priority: 'all', onlyBlocked: false }));
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFilter === 'todo' || taskFilters.status === 'todo'
                      ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <div id="div-app-16" className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">pending</span>
                    <span>{i18n._(msg`Por Hacer`)}</span>
                  </div>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                    {parsedStats.taskCount - parsedStats.completedCount}
                  </span>
                </button>

                <button
                  id="btn-filter-done"
                  type="button"
                  onClick={() => {
                    setActiveFilter('done');
                    setTaskFilters((prev) => ({ ...prev, status: 'done', priority: 'all', onlyBlocked: false }));
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFilter === 'done' || taskFilters.status === 'done'
                      ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <div id="div-app-17" className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">check_circle</span>
                    <span>{i18n._(msg`Completada`)}</span>
                  </div>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                    {parsedStats.completedCount}
                  </span>
                </button>

                <button
                  id="btn-filter-critical"
                  type="button"
                  onClick={() => {
                    setActiveFilter('critical');
                    setTaskFilters((prev) => ({ ...prev, priority: 'P0', onlyBlocked: false }));
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFilter === 'critical' || taskFilters.priority === 'P0'
                      ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <div id="div-app-18" className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">priority_high</span>
                    <span>{i18n._(msg`Críticas (P0)`)}</span>
                  </div>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                    {parsedStats.criticalCount}
                  </span>
                </button>

                <button
                  id="btn-filter-blocked"
                  type="button"
                  onClick={() => {
                    setActiveFilter('blocked');
                    setTaskFilters((prev) => ({ ...prev, onlyBlocked: true }));
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    activeFilter === 'blocked' || taskFilters.onlyBlocked
                      ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                  }`}
                >
                  <div id="div-app-19" className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">lock</span>
                    <span>{i18n._(msg`Bloqueadas`)}</span>
                  </div>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                    {parsedStats.blockedCount}
                  </span>
                </button>
              </div>

              {/* Sections & Groups List */}
              <div id="div-app-20" className="flex flex-col gap-1">
                <div id="div-app-21" className="flex items-center justify-between px-2">
                  <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                    {i18n._(msg`Secciones`)} ({parsedGroups.length})
                  </span>
                  {taskFilters.section !== 'all' && (
                    <button
                      id="btn-filter-view-all-sections"
                      type="button"
                      onClick={() => setTaskFilters((prev) => ({ ...prev, section: 'all' }))}
                      className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      {i18n._(msg`Ver todas`)}
                    </button>
                  )}
                </div>

                <div id="div-app-22" className="flex flex-col gap-0.5 max-h-48 overflow-y-auto pr-1">
                  {parsedGroups.map((grp) => {
                    const doneInGrp = grp.tasks.filter((t) => t.completed).length;
                    const isSectionActive = taskFilters.section.toLowerCase() === grp.title.toLowerCase();
                    return (
                      <button
                        id={`btn-filter-section-${grp.title.toLowerCase().replace(/\s+/g, '-')}`}
                        key={grp.title}
                        type="button"
                        onClick={() => {
                          setTaskFilters((prev) => ({
                            ...prev,
                            section: isSectionActive ? 'all' : grp.title,
                          }));
                          if (activeView === 'canvas') {
                            handleFocusSectionOnCanvas(grp.title);
                          }
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between text-left transition-colors cursor-pointer group ${
                          isSectionActive
                            ? 'bg-[var(--primary-container)]/30 text-[var(--primary)] font-semibold'
                            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                        }`}
                      >
                        <span className="truncate max-w-[140px]">## {grp.title}</span>
                        <span className="text-[10px] font-mono opacity-80">
                          {doneInGrp}/{grp.tasks.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Workspace: Infinite Canvas vs Kanban Board (DESIGN.md Section 3, 14 & 15) */}
        <main className="flex-1 h-full relative overflow-hidden bg-[var(--surface)] flex flex-col">
          {/* Advanced Filter Bar (DESIGN.md Section 6, 7 & 8) */}
          <FilterBar
            filters={taskFilters}
            onFilterChange={(f) => setTaskFilters(f)}
            onResetFilters={() => {
              setSearchQuery('');
              setTaskFilters({
                status: 'all',
                priority: 'all',
                section: 'all',
                tag: 'all',
                onlyBlocked: false,
                sortBy: 'default',
              });
              setActiveFilter('all');
            }}
            searchQuery={searchQuery}
            onSearchChange={(q) => setSearchQuery(q)}
            availableSections={existingSections}
            availableTags={allAvailableTags}
            totalTasksCount={allParsedTasks.length}
            filteredTasksCount={filteredTasksCount}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onAutoOrganize={() => setIsAutoLayoutConfirmOpen(true)}
            isAutoOrganizing={isAutoOrganizing}
            currentFileName={currentFileName}
            hasUnsavedChanges={hasUnsavedChanges}
            onRenameDocument={() =>
              setRenameDocModalState({
                isOpen: true,
                docId: activeDocument.id,
                initialName: activeDocument.name,
                initialFolder: activeDocument.folder,
              })
            }
            activeView={activeView}
            syncStatus={syncStatus}
            onOpenSanityModal={() => setIsSanityModalOpen(true)}
            onOpenSyncOverrideModal={() => setIsSyncOverrideModalOpen(true)}
          />

          {/* Main View Area: Split between Visual View (Canvas / Kanban / Studio) and Markdown Split Editor */}
          <div
            id="antask-split-container"
            className="flex-1 relative overflow-hidden w-full h-full flex flex-col md:flex-row"
          >
            {/* Visual View Pane (Canvas / Kanban / Dual Split / Studio) */}
            <div
              id="div-visual-view-pane"
              style={{
                width: isSplitViewOpen ? (isMobileScreen ? '100%' : `${100 - splitRatio}%`) : '100%',
                height: isSplitViewOpen && isMobileScreen ? '50%' : '100%',
                flex: isSplitViewOpen
                  ? (isMobileScreen ? '0 0 50%' : `0 0 ${100 - splitRatio}%`)
                  : '1 1 0%',
              }}
              className="relative overflow-hidden flex flex-col min-w-0 md:min-w-[280px] transition-all duration-75"
            >
              {(() => {
                const canvasViewNode = (
                  <div className="relative w-full h-full overflow-hidden flex flex-col">
                    <Tldraw
                      hideUi={true}
                      shapeUtils={customShapeUtils}
                      onMount={handleMount}
                      autoFocus
                    />

                    {/* Floating Note Action Toolbar (Color & Size) */}
                    {selectedNoteInfo && (
                      <div
                        id="note-floating-actions-toolbar"
                        className="absolute z-30 pointer-events-auto bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md px-2 py-1 flex items-center gap-1.5 select-none text-xs transition-all duration-75"
                        style={{
                          left: Math.max(160, selectedNoteInfo.screenX),
                          top: Math.max(16, selectedNoteInfo.screenY),
                          transform: 'translate(-50%, -100%)',
                        }}
                      >
                        {/* Color swatches */}
                        <div className="flex items-center gap-1">
                          {NOTE_COLOR_OPTIONS.map((col) => (
                            <button
                              key={col.id}
                              id={`btn-note-color-${col.id}`}
                              type="button"
                              onClick={() => handleChangeNoteColor(col.tldrawColor)}
                              className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center ${col.bgClass} ${col.borderClass} border ${
                                selectedNoteInfo.color === col.tldrawColor
                                  ? 'ring-2 ring-[var(--primary)] ring-offset-1 dark:ring-offset-black scale-105'
                                  : 'opacity-85 hover:opacity-100'
                              }`}
                              title={col.name}
                              aria-label={col.name}
                            >
                              {selectedNoteInfo.color === col.tldrawColor && (
                                <span className="w-1 h-1 rounded-full bg-[var(--on-surface)]" />
                              )}
                            </button>
                          ))}
                        </div>

                        <div className="w-px h-3.5 bg-[var(--outline)] my-auto mx-0.5" />

                        {/* Size presets S, M, L, XL */}
                        <div className="flex items-center gap-0.5">
                          {(['s', 'm', 'l', 'xl'] as const).map((sz) => (
                            <button
                              key={sz}
                              id={`btn-note-size-${sz}`}
                              type="button"
                              onClick={() => handleChangeNoteSize(sz)}
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-medium rounded transition-colors cursor-pointer ${
                                selectedNoteInfo.size === sz
                                  ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                                  : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                              }`}
                              title={i18n._(msg`Tamaño ${sz.toUpperCase()}`)}
                              aria-label={i18n._(msg`Tamaño ${sz.toUpperCase()}`)}
                            >
                              {sz.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <div className="w-px h-3.5 bg-[var(--outline)] my-auto mx-0.5" />

                        {/* Delete note button */}
                        <button
                          id="btn-delete-selected-note"
                          type="button"
                          onClick={handleDeleteSelectedNotes}
                          className="btn-m3-icon w-5 h-5 text-[var(--error)] hover:bg-[var(--surface-container-high)] cursor-pointer"
                          title={i18n._(msg`Eliminar nota`)}
                          aria-label={i18n._(msg`Eliminar nota`)}
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    )}

                    {/* Floating Canvas Navigation Controls (DESIGN.md Section 3 & 14) */}
                    <div id="div-app-24" className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 sm:gap-1 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md p-1 shadow-sm select-none">
                      <button
                        id="btn-canvas-zoom-out"
                        type="button"
                        onClick={handleZoomOut}
                        className="btn-m3-icon w-7 h-7 cursor-pointer"
                        title={i18n._(msg`Alejar zoom (Zoom Out)`)}
                        aria-label={i18n._(msg`Alejar zoom`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">remove</span>
                      </button>

                      <button
                        id="btn-canvas-zoom-reset"
                        type="button"
                        onClick={handleResetZoom}
                        className="px-2 py-0.5 text-xs font-mono font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] rounded-full transition-colors cursor-pointer"
                        title={i18n._(msg`Clic para restablecer zoom al 100%`)}
                      >
                        {canvasZoom}%
                      </button>

                      <button
                        id="btn-canvas-zoom-in"
                        type="button"
                        onClick={handleZoomIn}
                        className="btn-m3-icon w-7 h-7 cursor-pointer"
                        title={i18n._(msg`Acercar zoom (Zoom In)`)}
                        aria-label={i18n._(msg`Acercar zoom`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                      </button>

                      <div id="div-app-25" className="w-px h-4 bg-[var(--outline)] my-auto mx-0.5" />

                      <button
                        id="btn-canvas-zoom-fit"
                        type="button"
                        onClick={handleZoomToFit}
                        className="btn-m3-icon w-7 h-7 cursor-pointer"
                        title={i18n._(msg`Ajustar zoom al contenido (Zoom to Fit)`)}
                        aria-label={i18n._(msg`Ajustar zoom`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">fit_screen</span>
                      </button>

                      <div id="div-app-25-tools" className="w-px h-4 bg-[var(--outline)] my-auto mx-0.5" />

                      {/* Mode: Selection Tool (V) */}
                      <button
                        id="btn-canvas-tool-select"
                        type="button"
                        onClick={() => handleSelectCanvasTool('select')}
                        className={`btn-m3-icon w-7 h-7 cursor-pointer transition-colors ${
                          currentCanvasTool === 'select'
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                        }`}
                        title={i18n._(msg`Modo Selección (V)`)}
                        aria-label={i18n._(msg`Modo Selección`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">near_me</span>
                      </button>

                      {/* Mode: Sticky Note / Posit Tool (N) */}
                      <button
                        id="btn-canvas-tool-note"
                        type="button"
                        onClick={() => handleSelectCanvasTool('note')}
                        className={`btn-m3-icon w-7 h-7 cursor-pointer transition-colors ${
                          currentCanvasTool === 'note'
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                        }`}
                        title={i18n._(msg`Crear posit / nota adhesiva (N)`)}
                        aria-label={i18n._(msg`Crear posit`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">sticky_note_2</span>
                      </button>

                      {/* Mode: Text Tool (T) */}
                      <button
                        id="btn-canvas-tool-text"
                        type="button"
                        onClick={() => handleSelectCanvasTool('text')}
                        className={`btn-m3-icon w-7 h-7 cursor-pointer transition-colors ${
                          currentCanvasTool === 'text'
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                        }`}
                        title={i18n._(msg`Crear texto (T)`)}
                        aria-label={i18n._(msg`Crear texto`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">title</span>
                      </button>

                      {/* Mode: Arrow Tool for Joining Tasks at Central Points (A) */}
                      <button
                        id="btn-canvas-tool-arrow"
                        type="button"
                        onClick={() => handleSelectCanvasTool('arrow')}
                        className={`btn-m3-icon w-7 h-7 cursor-pointer transition-colors ${
                          currentCanvasTool === 'arrow'
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                        }`}
                        title={i18n._(msg`Unir tareas con flechas en puntos centrales (A)`)}
                        aria-label={i18n._(msg`Unir tareas con flechas`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">timeline</span>
                      </button>
                    </div>

                    {/* Active Connection Source Helper Banner */}
                    {activeConnectionSource && (
                      <div
                        id="canvas-active-connection-banner"
                        className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[var(--surface-container-high)] border border-[var(--primary)] text-[var(--on-surface)] rounded-md px-3 py-1.5 shadow-md flex items-center gap-2.5 text-xs select-none"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
                        <span className="font-medium">
                          {i18n._(msg`Uniendo desde #${activeConnectionSource.taskId || 'tarea'}`)} ·{' '}
                          <span className="text-[var(--on-surface-variant)] font-normal">
                            {i18n._(msg`Haz clic en el punto central de otra tarea para unirlas`)}
                          </span>
                        </span>
                        <button
                          id="btn-cancel-task-connection"
                          type="button"
                          onClick={() => setActiveConnectionSource(null)}
                          className="px-2 py-0.5 rounded bg-[var(--surface)] hover:bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] text-[11px] font-mono border border-[var(--outline)] cursor-pointer transition-colors"
                        >
                          {i18n._(msg`Cancelar (Esc)`)}
                        </button>
                      </div>
                    )}

                    {/* Canvas Empty State Overlay */}
                    {allParsedTasks.length === 0 && !isCanvasEmptyDismissed && (
                      <div id="div-app-26" className="absolute inset-0 pointer-events-none flex items-center justify-center p-6 z-10">
                        <div id="div-app-27" className="pointer-events-auto bg-[var(--surface-container)] border border-[var(--outline)] rounded-lg p-6 max-w-md text-center shadow-lg flex flex-col items-center relative animate-fade-in">
                          <button
                            id="btn-dismiss-empty-canvas"
                            type="button"
                            onClick={() => setIsCanvasEmptyDismissed(true)}
                            className="absolute top-2.5 right-2.5 w-6 h-6 rounded flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer transition-colors"
                            title={i18n._(msg`Cerrar`)}
                            aria-label={i18n._(msg`Cerrar`)}
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                          <div id="div-app-28" className="w-10 h-10 rounded bg-[var(--primary-container)]/30 border border-[var(--primary)]/30 flex items-center justify-center text-[var(--primary)] mb-3">
                            <span className="material-symbols-outlined text-[22px]">grid_view</span>
                          </div>
                          <h3 className="text-sm font-semibold text-[var(--on-surface)] font-sans mb-1">
                            {i18n._(msg`Lienzo vacío`)}
                          </h3>
                          <p className="text-xs text-[var(--on-surface-variant)] mb-4 leading-relaxed">
                            {i18n._(msg`No hay tareas en este archivo TASKS.md. Comienza añadiendo una tarea o carga un proyecto de ejemplo.`)}
                          </p>
                          <div id="div-app-29" className="flex items-center gap-2 flex-wrap justify-center">
                            <button
                              id="btn-empty-create-task"
                              type="button"
                              onClick={() => {
                                handleOpenNewTaskModal();
                              }}
                              className="btn-m3-primary px-3.5 py-1.5 text-xs cursor-pointer shadow-sm"
                            >
                              <span className="material-symbols-outlined text-[15px]">add</span>
                              <span>{i18n._(msg`Crear primera tarea`)}</span>
                            </button>
                            <button
                              id="btn-empty-load-sample"
                              type="button"
                              onClick={handleLoadSampleProject}
                              className="btn-m3-secondary px-3.5 py-1.5 text-xs cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[15px]">refresh</span>
                              <span>{i18n._(msg`Cargar ejemplo`)}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Floating Canvas Multi-Selection Action Bar (DESIGN.md Section 14) */}
                    {selectedTaskIdsOnCanvas.length > 1 && (
                      <div id="div-app-30" className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md px-2.5 sm:px-3 py-1 shadow-md flex items-center gap-1.5 sm:gap-2 select-none max-w-[96vw] overflow-x-auto">
                        <div id="div-app-31" className="flex items-center gap-1.5 pr-2 border-r border-[var(--outline)] shrink-0">
                          <span className="w-2 h-2 rounded bg-[var(--primary)]" />
                          <span className="text-xs font-mono font-medium text-[var(--on-surface)]">
                            {selectedTaskIdsOnCanvas.length} {i18n._(msg`seleccionadas`)}
                          </span>
                        </div>

                        <button
                          id="btn-selection-batch-complete"
                          type="button"
                          onClick={() =>
                            handleBatchUpdateTasksFromKanban(selectedTaskIdsOnCanvas, {
                              completed: true,
                              status: 'done',
                            })
                          }
                          className="btn-m3-secondary px-2 py-1 text-xs text-emerald-400 border-emerald-800/60 bg-emerald-950/30 cursor-pointer shrink-0"
                          title={i18n._(msg`Marcar seleccionadas como completadas`)}
                        >
                          <span className="material-symbols-outlined text-[15px]">check_circle</span>
                          <span className="hidden sm:inline">{i18n._(msg`Completar`)}</span>
                        </button>

                        <button
                          id="btn-selection-batch-pending"
                          type="button"
                          onClick={() =>
                            handleBatchUpdateTasksFromKanban(selectedTaskIdsOnCanvas, {
                              completed: false,
                              status: 'todo',
                            })
                          }
                          className="btn-m3-secondary px-2 py-1 text-xs text-amber-400 border-amber-800/60 bg-amber-950/30 cursor-pointer shrink-0"
                          title={i18n._(msg`Marcar seleccionadas como pendientes`)}
                        >
                          <span className="material-symbols-outlined text-[15px]">pending</span>
                          <span className="hidden sm:inline">{i18n._(msg`Pendiente`)}</span>
                        </button>

                        {/* Quick Priorities */}
                        <div id="div-app-32" className="flex items-center gap-1 shrink-0 border-l border-r border-[var(--outline)] px-1.5">
                          {(['P0', 'P1', 'P2', 'P3'] as TaskPriority[]).map((p) => (
                            <button
                              id={`btn-selection-priority-${p}`}
                              key={p}
                              type="button"
                              onClick={() =>
                                handleBatchUpdateTasksFromKanban(selectedTaskIdsOnCanvas, { priority: p })
                              }
                              className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-[var(--outline)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
                              title={i18n._(msg`Establecer prioridad ${p}`)}
                            >
                              {p}
                            </button>
                          ))}
                        </div>

                        <button
                          id="btn-selection-batch-delete"
                          type="button"
                          onClick={() => {
                            handleBatchDeleteTasksFromKanban(selectedTaskIdsOnCanvas);
                          }}
                          className="btn-m3-secondary px-2 py-1 text-xs text-[var(--error)] border-rose-800/60 bg-rose-950/30 cursor-pointer shrink-0"
                          title={i18n._(msg`Eliminar tareas seleccionadas`)}
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                          <span className="hidden sm:inline">{i18n._(msg`Eliminar`)}</span>
                        </button>

                        <button
                          id="btn-selection-deselect"
                          type="button"
                          onClick={() => {
                            if (editor) {
                              editor.selectNone();
                            }
                            setSelectedTaskIdsOnCanvas([]);
                            setSelectedTaskShapeId(null);
                          }}
                          className="btn-m3-icon w-6 h-6 shrink-0 cursor-pointer"
                          title={i18n._(msg`Deseleccionar`)}
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    )}
                  </div>
                );

                const kanbanViewNode = (
                  <div className="relative w-full h-full overflow-hidden flex flex-col">
                    <KanbanBoard
                      markdown={markdownInput}
                      isLoading={isLoadingDocument}
                      onOpenSampleProject={handleLoadSampleProject}
                      onUpdateTask={handleUpdateTaskFromKanban}
                      onBatchUpdateTasks={handleBatchUpdateTasksFromKanban}
                      onDeleteTask={(taskId, title) => {
                        const dependents = findDependentTasks(markdownInput, taskId);
                        setDeleteWarningState({
                          shapeId: taskId,
                          taskId,
                          title,
                          dependents,
                        });
                      }}
                      onBatchDeleteTasks={handleBatchDeleteTasksFromKanban}
                      onSelectTask={(id) => setSelectedTaskShapeId(id)}
                      onOpenTaskDetails={(id) => {
                        setSelectedTaskShapeId(id);
                        setIsTaskDetailsOpen(true);
                      }}
                      selectedTaskId={selectedTaskShapeId}
                      onOpenNewTaskModalWithGroup={(groupOrStatus) => {
                        handleOpenNewTaskModal(groupOrStatus);
                      }}
                      searchQuery={searchQuery}
                      activeFilter={activeFilter}
                      filters={taskFilters}
                      onResetFilters={() => {
                        setSearchQuery('');
                        setTaskFilters({
                          status: 'all',
                          priority: 'all',
                          section: 'all',
                          tag: 'all',
                          onlyBlocked: false,
                          sortBy: 'default',
                        });
                        resetGlobalTaskFilters();
                        setActiveFilter('all');
                      }}
                    />
                  </div>
                );

                if (activeView === 'canvas') {
                  return canvasViewNode;
                }

                if (activeView === 'kanban') {
                  return kanbanViewNode;
                }

                if (activeView === 'split') {
                  return (
                    <div
                      id="antask-dual-view-container"
                      className="relative w-full h-full overflow-hidden flex flex-col md:flex-row bg-[var(--surface)]"
                    >
                      {/* Left Pane: Canvas View */}
                      <div
                        id="antask-dual-canvas-pane"
                        style={{
                          width: isMobileScreen ? '100%' : `${dualRatio}%`,
                          height: isMobileScreen ? '50%' : '100%',
                          flex: isMobileScreen ? '0 0 50%' : `0 0 ${dualRatio}%`,
                        }}
                        className="relative overflow-hidden min-w-0 md:min-w-[200px] flex flex-col"
                      >
                        {canvasViewNode}
                      </div>

                      {/* Dual View Splitter Divider */}
                      <div
                        id="antask-dual-splitter"
                        onMouseDown={handleDualSplitterMouseDown}
                        onDoubleClick={() => {
                          setDualRatio(50);
                          try {
                            localStorage.setItem('antask_dual_ratio', '50');
                          } catch {}
                        }}
                        className="hidden md:flex w-2 hover:w-2.5 bg-[var(--surface-container-high)] hover:bg-[var(--primary)] transition-all cursor-col-resize items-center justify-center relative group select-none shrink-0 z-20 border-x border-[var(--outline)]"
                        title={i18n._(msg`Arrastrar para ajustar proporción Canvas / Kanban (Doble clic para 50/50)`)}
                      >
                        <div className="w-0.5 h-6 rounded-full bg-[var(--outline)] group-hover:bg-white" />
                      </div>

                      {/* Right Pane: Kanban View */}
                      <div
                        id="antask-dual-kanban-pane"
                        style={{
                          width: isMobileScreen ? '100%' : `${100 - dualRatio}%`,
                          height: isMobileScreen ? '50%' : '100%',
                          flex: isMobileScreen ? '0 0 50%' : `0 0 ${100 - dualRatio}%`,
                        }}
                        className="relative overflow-hidden min-w-0 md:min-w-[200px] border-t md:border-t-0 md:border-l border-[var(--outline)] flex flex-col"
                      >
                        {kanbanViewNode}
                      </div>
                    </div>
                  );
                }

                return (
                  <SanityStudio
                    activeWorkspaceId={activeWorkspace.id}
                    activeWorkspaceName={activeWorkspace.name}
                    onOpenSanityConfig={() => setIsSanityModalOpen(true)}
                    onImportTaskToMarkdown={handleImportTaskFromSanity}
                    onActivateWorkspace={handleActivateWorkspaceFromSanity}
                    onOpenSyncDiffModal={() => setIsSyncOverrideModalOpen(true)}
                    onShowToast={pushToast}
                  />
                );
              })()}

              {/* Drag & Drop Discrete Overlay */}
              {isDraggingOver && (
                <div id="div-app-33" className="absolute inset-0 z-50 pointer-events-none bg-black/80 flex flex-col items-center justify-center animate-fade-in p-6">
                  <div id="div-app-34" className="w-14 h-14 rounded-md bg-[var(--surface-container-high)] border border-[var(--primary)] flex items-center justify-center text-[var(--primary)] mb-4 shadow-md">
                    <span className="material-symbols-outlined text-[32px]">upload_file</span>
                  </div>
                  <h3 className="text-base font-semibold text-white font-sans mb-1">
                    {i18n._(msg`Suelta tu archivo TASKS.md aquí`)}
                  </h3>
                  <p className="text-xs text-slate-400 font-sans">
                    {i18n._(msg`Se parseará automáticamente manteniendo coordenadas y jerarquía`)}
                  </p>
                </div>
              )}
            </div>

            {/* Split Resizer Divider Bar */}
            {isSplitViewOpen && (
              <div
                id="div-split-resizer-bar"
                onPointerDown={handleSplitterPointerDown}
                onDoubleClick={() => handleSetSplitRatio(50)}
                className="h-2 w-full md:h-full md:w-2 bg-[var(--outline)] hover:bg-[var(--primary)] cursor-row-resize md:cursor-col-resize transition-colors shrink-0 relative flex items-center justify-center group select-none z-20"
                title={i18n._(msg`Arrastra para ajustar el visor en tiempo real (Doble clic para 50%)`)}
              >
                <div id="div-app-35" className="w-8 h-1 md:w-1 md:h-8 rounded-full bg-[var(--on-surface-variant)] group-hover:bg-[var(--on-primary)] transition-colors" />
              </div>
            )}

            {/* Real-time Bidirectional Markdown Editor Pane */}
            {isSplitViewOpen && (
              <div
                id="div-split-editor-pane"
                style={{
                  width: isMobileScreen ? '100%' : `${splitRatio}%`,
                  height: isMobileScreen ? '50%' : '100%',
                  flex: isMobileScreen ? '0 0 50%' : `0 0 ${splitRatio}%`,
                }}
                className="relative overflow-hidden min-w-0 md:min-w-[300px] transition-all duration-75"
              >
                <MarkdownSplitEditor
                  value={markdownInput}
                  fileName={currentFileName}
                  theme={effectiveTheme}
                  onChange={handleMarkdownEditorChange}
                  onClose={() => setIsSplitViewOpen(false)}
                  onExport={handleExportFile}
                  onShowToast={pushToast}
                  splitRatio={splitRatio}
                  onChangeSplitRatio={handleSetSplitRatio}
                  onOpenNormalizer={() => setIsSafeNormalizerOpen(true)}
                />
              </div>
            )}
          </div>

          {/* Floating Action Button (FAB) - Bottom Right Corner with plus icon */}
          <button
            id="btn-fab-new-task"
            type="button"
            onClick={() => {
              handleOpenNewTaskModal();
            }}
            className={`absolute bottom-16 sm:bottom-6 right-6 z-30 w-10 h-10 rounded-md bg-[var(--primary)] text-[var(--on-primary)] shadow-md flex items-center justify-center cursor-pointer hover:brightness-110 active:brightness-95 transition-all select-none ${
              isSplitViewOpen && isMobileScreen ? 'hidden' : ''
            }`}
            title={i18n._(msg`Crear nueva tarea (N)`)}
            aria-label={i18n._(msg`Crear nueva tarea`)}
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>

          {/* Toast notification system */}
          <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
        </main>

        {/* Details Panel (DESIGN.md Section 16 & Fase 4: Modular Details & Multi-Selection Panel) */}
        {((isTaskDetailsOpen && selectedTaskData) || selectedTaskIdsOnCanvas.length > 1) && (
          <TaskDetailsPanel
            task={selectedTaskData}
            selectedTaskIds={selectedTaskIdsOnCanvas}
            allTasks={allParsedTasks}
            allSections={existingSections}
            onUpdateTask={handleUpdateTaskFromKanban}
            onAssignId={handleAssignSingleTaskId}
            onBatchUpdateTasks={handleBatchUpdateTasksFromKanban}
            onDeleteTask={(taskId, title) => {
              const dependents = findDependentTasks(markdownInput, taskId);
              setDeleteWarningState({
                shapeId: taskId,
                taskId,
                title,
                dependents,
              });
            }}
            onBatchDeleteTasks={handleBatchDeleteTasksFromKanban}
            onSelectTask={(id) => {
              setSelectedTaskShapeId(id);
              if (id) {
                const found = allParsedTasks.find(
                  (t) => t.taskId.toLowerCase() === id.toLowerCase()
                );
                if (found) {
                  handleFocusTaskOnCanvas(found.taskId, found.title);
                }
              }
            }}
            onFocusOnCanvas={(taskId, title) => {
              if (activeView !== 'canvas') {
                setActiveView('canvas');
              }
              setTimeout(() => {
                handleFocusTaskOnCanvas(taskId, title);
              }, 100);
            }}
            onClose={() => {
              setIsTaskDetailsOpen(false);
              setSelectedTaskShapeId(null);
              if (editor) {
                editor.selectNone();
              }
              setSelectedTaskIdsOnCanvas([]);
            }}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (Docked, reliable, no button superposition) */}
      <nav
        aria-label={i18n._(msg`Acciones rápidas móviles`)}
        className="sm:hidden h-14 bg-[var(--surface-container)] border-t border-[var(--outline)] shrink-0 z-30 grid grid-cols-5 gap-1 px-1.5 py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] select-none"
      >
        <button
          id="btn-mobile-nav-create"
          type="button"
          onClick={() => {
            if (activeView === 'studio') {
              setIsSanityModalOpen(true);
            } else {
              handleOpenNewTaskModal();
            }
          }}
          className="btn-m3-primary py-1 px-1 rounded-md flex flex-col items-center justify-center text-[10px] cursor-pointer shadow-xs overflow-hidden active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span className="font-semibold truncate w-full text-center leading-none mt-0.5">{activeView === 'studio' ? i18n._(msg`Crear`) : i18n._(msg`Nueva Tarea`)}</span>
        </button>

        <button
          id="btn-mobile-nav-switch-view"
          type="button"
          onClick={() => {
            if (activeView === 'canvas') setActiveView('kanban');
            else if (activeView === 'kanban') setActiveView('studio');
            else setActiveView('canvas');
          }}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-lg text-[10px] transition-all cursor-pointer overflow-hidden border active:scale-95 ${
            activeView === 'canvas' || activeView === 'kanban' || activeView === 'studio'
              ? 'text-[var(--primary)] font-semibold bg-[var(--primary-container)]/40 border-[var(--primary)]/50'
              : 'text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/60 border-[var(--outline)] hover:text-[var(--on-surface)]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {activeView === 'canvas' ? 'grid_view' : activeView === 'kanban' ? 'view_kanban' : 'cloud_sync'}
          </span>
          <span className="capitalize truncate w-full text-center leading-none mt-0.5">{activeView}</span>
        </button>

        {activeView === 'kanban' ? (
          <button
            id="btn-mobile-nav-filters"
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="flex flex-col items-center justify-center py-1 px-0.5 rounded-lg text-[10px] text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/60 border border-[var(--outline)] hover:text-[var(--on-surface)] transition-all cursor-pointer overflow-hidden active:scale-95"
            title={i18n._(msg`Filtros y documentos`)}
          >
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            <span className="truncate w-full text-center leading-none mt-0.5">{i18n._(msg`Filtros`)}</span>
          </button>
        ) : activeView !== 'canvas' ? (
          <button
            id="btn-mobile-nav-sync-sanity"
            type="button"
            onClick={() => setIsSyncOverrideModalOpen(true)}
            className="flex flex-col items-center justify-center py-1 px-0.5 rounded-lg text-[10px] text-amber-400 bg-amber-950/30 border border-amber-800/60 hover:text-amber-300 transition-all cursor-pointer overflow-hidden active:scale-95"
            title={i18n._(msg`Sincronizar con Sanity`)}
          >
            <span className="material-symbols-outlined text-[18px]">sync_problem</span>
            <span className="truncate w-full text-center leading-none mt-0.5">{i18n._(msg`Sincronizar`)}</span>
          </button>
        ) : null}

        <button
          id="btn-mobile-nav-split-view"
          type="button"
          onClick={handleToggleSplitView}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-lg text-[10px] transition-all cursor-pointer overflow-hidden border active:scale-95 ${
            isSplitViewOpen
              ? 'text-sky-400 font-bold bg-sky-950/40 border-sky-700/80'
              : 'text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/60 border-[var(--outline)] hover:text-[var(--on-surface)]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isSplitViewOpen ? 'vertical_split' : 'splitscreen'}
          </span>
          <span className="truncate w-full text-center leading-none mt-0.5">{isSplitViewOpen ? i18n._(msg`Cerrar .md`) : i18n._(msg`Ver .md`)}</span>
        </button>

        <button
          id="btn-mobile-nav-menu"
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center py-1 px-0.5 rounded-lg text-[10px] text-[var(--on-surface-variant)] bg-[var(--surface-container-high)]/60 border border-[var(--outline)] hover:text-[var(--on-surface)] transition-all cursor-pointer relative overflow-hidden active:scale-95"
        >
          {validationReport.issues.length > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          )}
          <span className="material-symbols-outlined text-[18px]">menu</span>
          <span className="truncate w-full text-center leading-none mt-0.5">{i18n._(msg`Menú`)}</span>
        </button>
      </nav>

      {/* Mobile Drawer Menu */}
      {isMobileMenuOpen && (
        <div
          id="modal-mobile-menu-overlay"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:hidden animate-fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div
            id="modal-mobile-menu-dialog"
            className="w-full bg-[var(--surface-container)] border-t border-[var(--outline)] rounded-t-md shadow-md p-4 flex flex-col gap-3 animate-slide-up max-h-[88vh] overflow-y-auto pb-safe"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={i18n._(msg`Opciones y herramientas`)}
          >
            <div id="div-app-36" className="w-12 h-1 bg-[var(--outline)] rounded-full mx-auto" />

            <div id="div-app-37" className="flex items-center justify-between border-b border-[var(--outline)] pb-2.5">
              <div id="div-mobile-menu-header-titles">
                <h2 className="text-sm font-semibold text-[var(--on-surface)] font-sans">
                  {i18n._(msg`Menú de Opciones`)}
                </h2>
                <p className="text-xs text-[var(--on-surface-variant)] font-mono">
                  {currentFileName} · {parsedStats.taskCount} {i18n._(msg`tareas`)}
                </p>
              </div>
              <button
                id="btn-mobile-menu-close"
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="btn-m3-icon w-8 h-8"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div id="div-app-38" className="flex flex-col gap-1.5 text-xs">
              {/* Workspace & Repositories */}
              <button
                id="btn-mobile-menu-workspaces"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsWorkspaceManagerOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-39" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-emerald-400">workspaces</span>
                  <span>{i18n._(msg`Workspaces`)}</span>
                </div>
                <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">{activeWorkspace.name} ➔</span>
              </button>

              {/* Branches */}
              <button
                id="btn-mobile-menu-branches"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsNewBranchModalOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-40" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-sky-400">fork_right</span>
                  <span>{i18n._(msg`Ramas`)}</span>
                </div>
                <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">{activeBranch.name} ➔</span>
              </button>

              {/* Sanity Sync & Overrides */}
              <button
                id="btn-mobile-menu-sanity-sync"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsSyncOverrideModalOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-41" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-amber-400">sync_problem</span>
                  <span>{i18n._(msg`Sync & Override Detection`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* File Open */}
              <button
                id="btn-mobile-menu-open-file"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleOpenFilePicker();
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-42" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">folder_open</span>
                  <span>{i18n._(msg`Abrir TASKS.md`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* Save File */}
              <button
                id="btn-mobile-menu-save-file"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleExportFile();
                }}
                className={`w-full min-h-[44px] px-3 py-2 rounded-lg border flex items-center justify-between cursor-pointer ${
                  hasUnsavedChanges
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-200 font-medium'
                    : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                }`}
              >
                <div id="div-app-43" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-emerald-400">save</span>
                  <span>{i18n._(msg`Guardar`)} {currentFileName}</span>
                </div>
                {hasUnsavedChanges && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                    {i18n._(msg`Modificado`)}
                  </span>
                )}
              </button>

              {/* Import / Export */}
              <button
                id="btn-mobile-menu-import-export"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsImportExportOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-44" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">sync_alt</span>
                  <span>{i18n._(msg`Importar / Exportar (.md, JSON)`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* Theme Toggle */}
              <button
                id="btn-mobile-menu-toggle-theme"
                type="button"
                onClick={() => {
                  handleUpdateSettings({
                    ...userSettings,
                    theme: effectiveTheme === 'dark' ? 'light' : 'dark',
                  });
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-45" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px]">
                    {effectiveTheme === 'dark' ? 'light_mode' : 'dark_mode'}
                  </span>
                  <span>{i18n._(msg`Tema:`)} {effectiveTheme === 'dark' ? i18n._(msg`Oscuro`) : i18n._(msg`Claro`)}</span>
                </div>
                <span className="text-[10px] text-[var(--on-surface-variant)]">{i18n._(msg`Cambiar`)}</span>
              </button>

              {/* Language Selection */}
              <div id="div-app-46" className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)]">
                <div id="div-app-47" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">language</span>
                  <span>{i18n._(msg`Idioma`)}</span>
                </div>
                <LanguageSelector onLanguageChange={(lang) => handleUpdateSettings({ ...userSettings, language: lang })} />
              </div>

              {/* Settings */}
              <button
                id="btn-mobile-menu-settings"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-48" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">settings</span>
                  <span>{i18n._(msg`Configuración & Preferencias`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* Sanity Credentials */}
              <button
                id="btn-mobile-menu-sanity-config"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsSanityModalOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-49" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-rose-400">cloud_sync</span>
                  <span>{i18n._(msg`Ajustes de Sanity Cloud`)}</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400">
                  {getSanityConfig().projectId || i18n._(msg`No conectado`)}
                </span>
              </button>

              {/* Quick Guide */}
              <button
                id="btn-mobile-menu-quick-guide"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsQuickGuideOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-50" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-sky-400">help</span>
                  <span>{i18n._(msg`Atajos de teclado y ayuda (?)`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* Welcome Screen / Demo Mode */}
              <button
                id="btn-mobile-menu-welcome"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsWelcomeModalOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer"
              >
                <div id="div-app-welcome" className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-emerald-400">waving_hand</span>
                  <span>{i18n._(msg`Bienvenida y Modo Demo`)}</span>
                </div>
                <span>➔</span>
              </button>

              {/* Problems & Validation Panel */}
              {validationReport.issues.length > 0 && (
                <button
                  id="btn-mobile-menu-problems"
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsProblemsModalOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800 flex items-center justify-between text-amber-300 cursor-pointer"
                >
                  <div id="div-app-51" className="flex items-center gap-2.5">
                    <span>⚠</span>
                    <span>{i18n._(msg`Ver incidencias detectadas`)}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/60 text-amber-200">
                    {validationReport.issues.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Panel de Problemas */}
      {isProblemsModalOpen && (
        <div
          id="modal-problems-overlay"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={() => setIsProblemsModalOpen(false)}
        >
          <div
            id="modal-problems-dialog"
            className="w-full sm:max-w-2xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none max-h-[90vh] sm:max-h-[85vh] pb-safe sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="problems-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-app-52" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

            <div id="div-app-53" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <div id="div-problems-header-titles">
                <h2 id="problems-modal-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans flex items-center gap-2">
                  <span>{i18n._(msg`Ver incidencias detectadas`)}</span>
                </h2>
                <p className="text-xs text-[var(--on-surface-variant)] mt-0.5 font-sans">
                  {i18n._(msg`El editor previene la corrupción manteniendo una única fuente de verdad.`)}
                </p>
              </div>
              <button
                id="btn-problems-close-header"
                type="button"
                onClick={() => setIsProblemsModalOpen(false)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div id="div-app-54" className="px-4 py-2 bg-[var(--surface)] border-b border-[var(--outline)] flex items-center justify-between text-xs font-mono overflow-x-auto">
              <div className="flex items-center gap-4">
                <span>{i18n._(msg`Total:`)} <strong className="text-[var(--on-surface)]">{validationReport.issues.length}</strong></span>
                <span className="text-rose-400">{i18n._(msg`Errores`)}: <strong>{validationReport.errorCount}</strong></span>
                <span className="text-amber-400">{i18n._(msg`Avisos`)}: <strong>{validationReport.warningCount}</strong></span>
              </div>
              {validationReport.missingIdTaskIds.size > 0 && (
                <button
                  id="btn-problems-auto-assign-all-ids"
                  type="button"
                  onClick={handleAutoAssignAllTaskIds}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-sans font-medium bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer transition-colors"
                  title={i18n._(msg`Generar y asignar IDs a todas las tareas sin ID`)}
                >
                  <span className="material-symbols-outlined text-[13px]">auto_fix_high</span>
                  <span>{i18n._(msg`Generar IDs a todas (${validationReport.missingIdTaskIds.size})`)}</span>
                </button>
              )}
            </div>

            <div id="div-app-55" className="p-4 overflow-auto max-h-[50vh] flex flex-col gap-2">
              {validationReport.issues.length === 0 ? (
                <div id="div-app-56" className="py-8 text-center flex flex-col items-center justify-center gap-2">
                  <div id="div-app-57" className="w-8 h-8 rounded bg-emerald-950/80 border border-emerald-700 flex items-center justify-center text-emerald-400 text-base">
                    ✓
                  </div>
                  <p className="text-xs text-[var(--on-surface-variant)]">{i18n._(msg`Documento válido sin incidencias.`)}</p>
                </div>
              ) : (
                validationReport.issues.map((issue) => (
                  <div
                    id={`div-problems-item-${issue.id}`}
                    key={issue.id}
                    className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-start justify-between gap-3 text-xs"
                  >
                    <div id="div-app-58" className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-amber-400 font-bold shrink-0 mt-0.5">⚠</span>
                      <div id="div-app-59" className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-[var(--on-surface)] truncate">{issue.message}</span>
                        {issue.details && (
                          <span className="text-[11px] text-[var(--on-surface-variant)]">{issue.details}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {issue.type === 'missing_id' && (
                        <button
                          id={`btn-problems-assign-id-${issue.id}`}
                          type="button"
                          onClick={() => handleAssignSingleTaskId(issue.taskId ?? issue.lineIndex ?? '', issue.taskTitle)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer transition-colors flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>
                          <span>{i18n._(msg`Generar ID`)}</span>
                        </button>
                      )}
                      {issue.taskId && (
                        <button
                          id={`btn-problems-locate-${issue.id}`}
                          type="button"
                          onClick={() => handleFocusTaskOnCanvas(issue.taskId, issue.taskTitle)}
                          className="btn-m3-secondary px-2.5 py-1 text-[11px] cursor-pointer"
                        >
                          {i18n._(msg`Localizar`)}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div id="div-app-60" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex justify-end">
              <button
                id="btn-problems-close-footer"
                type="button"
                onClick={() => setIsProblemsModalOpen(false)}
                className="btn-m3-secondary px-3.5 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cerrar`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmación Auto Organizar */}
      {isAutoLayoutConfirmOpen && (
        <div
          id="modal-autolayout-overlay"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={() => setIsAutoLayoutConfirmOpen(false)}
        >
          <div
            id="modal-autolayout-dialog"
            className="w-full sm:max-w-md bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none pb-safe sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="autolayout-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-app-61" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

            <div id="div-app-62" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <h2 id="autolayout-modal-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">account_tree</span>
                <span>{i18n._(msg`Auto-ordenar`)}</span>
              </h2>
              <button
                id="btn-autolayout-close-header"
                type="button"
                onClick={() => setIsAutoLayoutConfirmOpen(false)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div id="div-app-63" className="p-4 flex flex-col gap-2.5 text-xs text-[var(--on-surface-variant)] leading-relaxed">
              <p>
                {i18n._(msg`Esta acción organizará todas las tarjetas y secciones en un grafo jerárquico según sus dependencias`)} <code className="text-[var(--primary)] font-mono">blockedBy</code>.
              </p>
              <div id="div-app-64" className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] font-mono">
                • {parsedStats.taskCount} {i18n._(msg`tareas en`)} {parsedStats.groupCount} {i18n._(msg`secciones`)}
              </div>
            </div>

            <div id="div-app-65" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-end gap-2">
              <button
                id="btn-autolayout-cancel"
                type="button"
                onClick={() => setIsAutoLayoutConfirmOpen(false)}
                className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cancelar`)}
              </button>
              <button
                id="btn-autolayout-confirm"
                type="button"
                onClick={handleExecuteAutoLayout}
                className="btn-m3-primary px-3.5 py-1 text-xs cursor-pointer shadow-sm"
              >
                {i18n._(msg`Auto organizar`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva Tarea */}
      {isNewTaskModalOpen && (
        <div
          id="modal-new-task-overlay"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={() => setIsNewTaskModalOpen(false)}
        >
          <div
            id="modal-new-task-dialog"
            className="w-full sm:max-w-md bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none pb-safe sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-app-66" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

            <div id="div-app-67" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <h2 id="new-task-modal-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">add_task</span>
                <span>{i18n._(msg`Nueva Tarea`)}</span>
              </h2>
              <button
                id="btn-new-task-close-header"
                type="button"
                onClick={() => setIsNewTaskModalOpen(false)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-4 flex flex-col gap-3.5">
              {/* Section / Group Selection & Creation */}
              <div id="div-app-71" className="flex flex-col gap-1.5">
                <div id="div-app-72" className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--on-surface)] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">folder</span>
                    <span>{i18n._(msg`Sección / Grupo`)}</span>
                  </label>
                  {existingSections.length > 0 && (
                    <div className="inline-flex rounded-md p-0.5 bg-[var(--surface-container-high)] border border-[var(--outline)]">
                      <button
                        id="btn-new-task-mode-existing"
                        type="button"
                        onClick={() => setIsCustomGroup(false)}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                          !isCustomGroup
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                        }`}
                      >
                        {i18n._(msg`Existente`)}
                      </button>
                      <button
                        id="btn-new-task-mode-custom"
                        type="button"
                        onClick={() => setIsCustomGroup(true)}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                          isCustomGroup
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                        }`}
                      >
                        {i18n._(msg`+ Nueva sección`)}
                      </button>
                    </div>
                  )}
                </div>

                {!isCustomGroup && existingSections.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <div className="relative">
                      <select
                        id="select-new-task-group"
                        value={newTaskGroup}
                        onChange={(e) => {
                          if (e.target.value === '__CREATE_NEW_SECTION__') {
                            setIsCustomGroup(true);
                            setCustomGroupInput('');
                          } else {
                            setNewTaskGroup(e.target.value);
                          }
                        }}
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-sans text-[var(--on-surface)] focus:outline-none cursor-pointer appearance-none pr-8"
                      >
                        {existingSections.map((sec) => (
                          <option key={sec} value={sec}>
                            📁 {sec}
                          </option>
                        ))}
                        <option value="__CREATE_NEW_SECTION__" className="text-[var(--primary)] font-medium">
                          ➕ {i18n._(msg`Crear nueva sección...`)}
                        </option>
                      </select>
                      <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--on-surface-variant)] pointer-events-none">
                        expand_more
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--on-surface-variant)]">
                      {i18n._(msg`Se añadirá bajo el encabezado ## existente en el documento.`)}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <input
                      id="input-new-task-custom-group"
                      type="text"
                      autoFocus={isCustomGroup}
                      value={customGroupInput}
                      onChange={(e) => setCustomGroupInput(e.target.value)}
                      placeholder={i18n._(msg`ej. Backend, Frontend, Autenticación, Pagos...`)}
                      className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-sans text-[var(--on-surface)] focus:outline-none"
                    />
                    <span className="text-[11px] text-[var(--on-surface-variant)]">
                      {existingSections.length === 0
                        ? i18n._(msg`Aún no hay secciones en el documento. Se creará una nueva sección en el archivo y en el lienzo.`)
                        : i18n._(msg`Se creará una nueva sección ## en el archivo y un nuevo contenedor en el lienzo.`)}
                    </span>
                  </div>
                )}
              </div>

              <div id="div-app-68" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">{i18n._(msg`Título`)}</label>
                <input
                  type="text"
                  autoFocus={!isCustomGroup}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder={i18n._(msg`ej. Crear recuperación de contraseña`)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-sans text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              {/* Priority Selection */}
              <div id="div-app-69" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">{i18n._(msg`Prioridad`)}</label>
                <div id="div-app-70" className="grid grid-cols-4 gap-2">
                  {(['P0', 'P1', 'P2', 'P3'] as TaskPriority[]).map((p) => {
                    const isSelected = newTaskPriority === p;
                    return (
                      <button
                        id={`btn-new-task-priority-${p}`}
                        key={p}
                        type="button"
                        onClick={() => setNewTaskPriority(p)}
                        className={`py-1.5 px-2 text-xs font-mono font-medium rounded border text-center transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)]'
                            : 'bg-[var(--surface)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:bg-[var(--surface-container-high)]'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div id="div-app-73" className="pt-2.5 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-new-task-cancel"
                  type="button"
                  onClick={() => setIsNewTaskModalOpen(false)}
                  className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  id="btn-new-task-submit"
                  type="submit"
                  disabled={!newTaskTitle.trim()}
                  className="btn-m3-primary px-4 py-1 text-xs cursor-pointer shadow-sm"
                >
                  {i18n._(msg`Crear Tarea`)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Advertencia / Confirmación de Eliminación */}
      {deleteWarningState && (
        <div
          id="modal-delete-warning-overlay"
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={() => setDeleteWarningState(null)}
        >
          <div
            id="modal-delete-warning-dialog"
            className="w-full sm:max-w-md bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none pb-safe sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-warning-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-app-74" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

            <div id="div-app-75" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <h2 id="delete-warning-title" className="text-sm font-semibold text-rose-400 font-sans flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>{i18n._(msg`Confirmar Eliminación`)}</span>
              </h2>
              <button
                id="btn-delete-warning-close-header"
                type="button"
                onClick={() => setDeleteWarningState(null)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div id="div-app-76" className="p-4 flex flex-col gap-2.5 text-xs text-[var(--on-surface-variant)] leading-relaxed">
              <p>
                {i18n._(msg`¿Estás seguro de que deseas eliminar la tarea "${deleteWarningState.title}" (#${deleteWarningState.taskId})?`)}
              </p>

              {deleteWarningState.dependents.length > 0 && (
                <div id="div-app-77" className="p-2.5 rounded bg-rose-950/40 border border-rose-800/80 text-rose-200">
                  <span className="font-semibold block mb-1">{i18n._(msg`Tareas dependientes que quedarán afectadas`)}:</span>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {deleteWarningState.dependents.map((dep) => (
                      <li key={dep.taskId}>
                        #{dep.taskId} ({dep.title}) {i18n._(msg`en`)} <em>{dep.groupTitle}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div id="div-app-78" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-end gap-2">
              <button
                id="btn-delete-warning-cancel"
                type="button"
                onClick={() => setDeleteWarningState(null)}
                className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cancelar`)}
              </button>
              <button
                id="btn-delete-warning-confirm"
                type="button"
                onClick={handleConfirmDeleteTask}
                className="btn-m3-primary bg-rose-600 hover:bg-rose-500 text-white px-4 py-1 text-xs cursor-pointer shadow-sm"
              >
                {i18n._(msg`Eliminar`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ver TASKS.md Sincronizado */}
      {isViewMarkdownOpen && (
        <div
          id="modal-view-markdown-overlay"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={() => setIsViewMarkdownOpen(false)}
        >
          <div
            id="modal-view-markdown-dialog"
            className="w-full sm:max-w-2xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none max-h-[90vh] sm:max-h-[85vh] pb-safe sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-markdown-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-app-79" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

            <div id="div-app-80" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <div id="div-view-markdown-header-titles">
                <h2 id="view-markdown-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans">
                  {i18n._(msg`TASKS.md — Sincronizado en Vivo`)}
                </h2>
                <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                  {formatTaskCount(parsedStats.taskCount)} · {formatSectionCount(parsedStats.groupCount)}
                </p>
              </div>
              <button
                id="btn-view-markdown-close-header"
                type="button"
                onClick={() => setIsViewMarkdownOpen(false)}
                className="btn-m3-icon w-7 h-7 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div id="div-app-81" className="p-4 flex flex-col gap-2.5 overflow-hidden">
              <div id="div-app-82" className="relative w-full rounded bg-[var(--surface)] border border-[var(--outline)] overflow-hidden">
                <pre className="p-3 text-xs font-mono text-[var(--on-surface)] overflow-auto max-h-[46vh] leading-relaxed select-text whitespace-pre-wrap">
                  {markdownInput}
                </pre>
              </div>
            </div>

            <div id="div-app-83" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-between">
              <button
                id="btn-view-markdown-copy"
                type="button"
                onClick={handleCopyMarkdown}
                className="btn-m3-secondary px-3 py-1 text-xs cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[15px]">content_copy</span>
                <span>{copiedMarkdown ? i18n._(msg`¡Copiado!`) : i18n._(msg`Copiar Markdown`)}</span>
              </button>

              <button
                id="btn-view-markdown-close-footer"
                type="button"
                onClick={() => setIsViewMarkdownOpen(false)}
                className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cerrar`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Importar / Exportar TASKS.md o JSON (DESIGN.md Section 12-18 & Fase 7) */}
      <ImportExportModal
        isOpen={isImportExportOpen}
        onClose={() => setIsImportExportOpen(false)}
        currentMarkdown={markdownInput}
        currentFileName={currentFileName}
        onImportMarkdown={handleImportMarkdownFromModal}
        onExportMarkdown={handleExportMarkdownFromModal}
      />

      {/* Modal: Configuración Sanity con prueba de conexión */}
      <SanityConfigModal
        isOpen={isSanityModalOpen}
        onClose={() => setIsSanityModalOpen(false)}
        onConfigSaved={handleSanityConfigSaved}
        onShowToast={pushToast}
        onSyncAllToSanity={handleSyncAllTasksToSanity}
      />

      {/* Modal: Administrador de Perfiles Sanity */}
      <SanityProfileManagerModal
        isOpen={isSanityProfilesModalOpen}
        onClose={() => setIsSanityProfilesModalOpen(false)}
        onProfileActivated={(newConfig) => {
          handleSanityConfigSaved(newConfig);
        }}
        onShowToast={pushToast}
      />

      {/* Modal: Sanity Studio Nativo Embebido (Formularios y Esquemas en vivo) */}
      {isNativeStudioModalOpen && (
        <div id="div-app-84" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4">
          <div id="div-app-85" className="w-full max-w-6xl h-[90vh] bg-neutral-950 border border-neutral-800 rounded-md shadow-md overflow-hidden flex flex-col">
            <SanityStudioEmbed
              isModal={true}
              activeWorkspaceId={activeWorkspace.id}
              activeWorkspaceName={activeWorkspace.name}
              onClose={() => setIsNativeStudioModalOpen(false)}
              onOpenSanityConfig={() => {
                setIsNativeStudioModalOpen(false);
                setIsSanityModalOpen(true);
              }}
              onShowToast={pushToast}
              onImportTaskToMarkdown={handleImportTaskFromSanity}
            />
          </div>
        </div>
      )}

      {/* Global Command Palette & Search Modal (Ctrl/Cmd + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        tasks={allParsedTasks}
        sections={existingSections}
        tags={allAvailableTags}
        recentTaskIds={recentTaskIds}
        onSelectTask={handleSelectTaskFromPalette}
        onSelectSection={(sec) => {
          setTaskFilters((prev) => ({ ...prev, section: sec }));
          if (activeView === 'canvas') {
            handleFocusSectionOnCanvas(sec);
          }
        }}
        onSelectTag={(tag) => {
          setTaskFilters((prev) => ({ ...prev, tag }));
        }}
        actions={commandActions}
      />

      {/* Quick Guide & Shortcuts Modal (?) */}
      <QuickGuideModal
        isOpen={isQuickGuideOpen}
        onClose={() => setIsQuickGuideOpen(false)}
        onOpenSampleProject={handleLoadSampleProject}
      />

      {/* Welcome & Onboarding Modal (Demo Mode & Sanity Cloud Connect) */}
      <WelcomeModal
        isOpen={isWelcomeModalOpen}
        onClose={() => setIsWelcomeModalOpen(false)}
        onStartDemoMode={handleLoadSampleProject}
        onConnectSanitySuccess={() => {
          handleImportWorkspacesFromSanity();
        }}
        onShowToast={pushToast}
      />

      {/* Settings & Preferences Modal (DESIGN.md Section 4 & Fase 7) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={userSettings}
        onUpdateSettings={handleUpdateSettings}
        onOpenSanityConfig={() => setIsSanityModalOpen(true)}
        onOpenFilePicker={handleOpenFilePicker}
        onResetCanvasLayout={handleResetLayout}
        onShowToast={pushToast}
      />

      {/* Modal: Gestión de Workspaces & Repositorios GitHub */}
      <WorkspaceManagerModal
        isOpen={isWorkspaceManagerOpen}
        onClose={() => setIsWorkspaceManagerOpen(false)}
        workspaces={workspaceStore.workspaces}
        activeWorkspaceId={workspaceStore.activeWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onCreateWorkspace={handleCreateWorkspace}
        onUpdateWorkspace={handleUpdateWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onCloneWorkspace={handleCloneWorkspace}
        onSelectBranch={handleManagerSelectBranch}
        onCreateBranch={handleManagerCreateBranch}
        onRenameBranch={handleManagerRenameBranch}
        onDeleteBranch={handleManagerDeleteBranch}
        onToggleBranchProtection={handleManagerToggleBranchProtection}
        onShowToast={pushToast}
        onSyncWorkspacesToSanity={handleSyncAllWorkspacesToSanity}
        onImportWorkspacesFromSanity={handleImportWorkspacesFromSanity}
        onSaveSingleWorkspaceToSanity={handleSaveSingleWorkspaceToSanity}
        onOpenSyncDiffModal={() => setIsSyncOverrideModalOpen(true)}
        isSanityConfigured={Boolean(getSanityConfig().projectId && getSanityConfig().dataset)}
      />

      {/* Modal: Sincronización & Detección de Overrides con Sanity */}
      <SyncOverrideModal
        isOpen={isSyncOverrideModalOpen}
        onClose={() => setIsSyncOverrideModalOpen(false)}
        workspaceStore={workspaceStore}
        onUpdateWorkspaceStore={(newStore) => {
          if (newStore.scope !== workspaceStoreRef.current.scope) return;
          workspaceStoreRef.current = newStore;
          setWorkspaceStore(newStore);
          saveWorkspaceStore(newStore);
          void refreshRemoteRef.current();
          const activeWs = getActiveWorkspace(newStore);
          const activeBr = getActiveBranch(activeWs);
          const activeDc = getActiveDocument(activeBr);
          if (activeDc) {
            setCurrentFileName(activeDc.path);
            setMarkdownInput(activeDc.content);
            setLastSavedMarkdown(activeDc.lastSavedContent);
            if (editor) {
              loadTasksFromMarkdown(editor, activeDc.content, activeDc.visualState);
            }
          }
        }}
        onShowToast={pushToast}
        onOpenSanityConfig={() => setIsSanityModalOpen(true)}
        onDeleteWorkspace={handleDeleteWorkspace}
      />

      {/* Modal: Crear nuevo archivo Task MD */}
      <NewTaskDocumentModal
        isOpen={isNewTaskDocModalOpen}
        onClose={() => setIsNewTaskDocModalOpen(false)}
        presetFolder={newTaskDocPresetFolder}
        existingFolders={existingFoldersInBranch}
        onCreateDocument={handleCreateTaskDocument}
        onShowToast={pushToast}
      />

      {/* Modal: Crear nueva rama de Git */}
      <NewBranchModal
        isOpen={isNewBranchModalOpen}
        onClose={() => setIsNewBranchModalOpen(false)}
        currentBranch={activeBranch}
        allBranches={activeWorkspace.branches}
        onCreateBranch={handleCreateBranch}
        onShowToast={pushToast}
      />

      {/* Modal: Git Status, Commits & Sincronización GitHub */}
      <GitHubSyncModal
        isOpen={isGitHubSyncOpen}
        onClose={() => setIsGitHubSyncOpen(false)}
        workspace={activeWorkspace}
        branch={activeBranch}
        githubToken={workspaceStore.githubToken}
        onSaveGitHubToken={handleSaveGitHubToken}
        onCommitBranch={handleCommitBranch}
        onShowToast={pushToast}
      />

      {/* Modal: Renombrar / Mover archivo Task MD */}
      <RenameDocumentModal
        isOpen={renameDocModalState.isOpen}
        onClose={() => setRenameDocModalState((prev) => ({ ...prev, isOpen: false }))}
        docId={renameDocModalState.docId}
        initialName={renameDocModalState.initialName}
        initialFolder={renameDocModalState.initialFolder}
        existingFolders={existingFoldersInBranch}
        onRename={handleRenameTaskDocument}
        onShowToast={pushToast}
      />

      {/* Modal: Crear nueva carpeta para Task MDs */}
      <NewFolderModal
        isOpen={isNewFolderModalOpen}
        onClose={() => setIsNewFolderModalOpen(false)}
        existingFolders={existingFoldersInBranch}
        onCreateFolderWithDoc={handleCreateTaskDocument}
        onShowToast={pushToast}
      />

      {/* Modal: Renombrar carpeta completa */}
      <RenameFolderModal
        isOpen={renameFolderModalState.isOpen}
        onClose={() => setRenameFolderModalState((prev) => ({ ...prev, isOpen: false }))}
        currentFolder={renameFolderModalState.currentFolder}
        docCount={renameFolderModalState.docCount}
        onRenameFolder={handleRenameFolder}
        onShowToast={pushToast}
      />

      {/* Modal: Normalización Segura de Markdown (Diff Git + remark/unified + Prevención de Pérdidas) */}
      <SafeMarkdownNormalizerModal
        isOpen={isSafeNormalizerOpen}
        documentTitle={currentFileName}
        originalMarkdown={markdownInput}
        theme={effectiveTheme}
        onClose={() => setIsSafeNormalizerOpen(false)}
        onApply={(confirmedMarkdown) => {
          handleMarkdownEditorChange(confirmedMarkdown);
        }}
        onShowToast={pushToast}
      />
    </div>
  );
}
