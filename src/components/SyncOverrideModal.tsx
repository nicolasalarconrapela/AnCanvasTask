import { getSyncSession } from '../services/syncSessionService';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  SyncComparisonResult,
  SyncItemDiff,
  SyncDifferenceType,
  analyzeSyncDifferences,
  resolveSyncItem,
  executeBatchSync,
  deleteSyncItem,
  formatRelativeTime,
} from '../services/syncEngineService';
import { deleteTaskFromMarkdown } from '../utils/markdownSync';
import { WorkspaceStoreState } from '../services/workspaceService';
import { getSanityConfig } from '../services/sanityService';

interface SyncOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceStore: WorkspaceStoreState;
  onUpdateWorkspaceStore: (store: WorkspaceStoreState) => void;
  onShowToast: (
    message: string,
    type?: 'info' | 'success' | 'warning' | 'error',
    action?: { label: string; onClick: () => void },
    duration?: number
  ) => void;
  onOpenSanityConfig: () => void;
  onDeleteWorkspace?: (id: string, deleteRemote?: boolean) => void;
}

export const SyncOverrideModal: React.FC<SyncOverrideModalProps> = ({
  isOpen,
  onClose,
  workspaceStore,
  onUpdateWorkspaceStore,
  onShowToast,
  onOpenSanityConfig,
  onDeleteWorkspace,
}) => {
  const { i18n } = useLingui();
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<SyncComparisonResult | null>(null);
  const [filterType, setFilterType] = useState<
    'all' | 'pending' | 'local_override' | 'remote_override' | 'conflicts' | 'unique' | 'synced'
  >('all');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [deleteScope, setDeleteScope] = useState<'local' | 'remote' | 'both'>('local');
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<boolean>(false);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<'local' | 'remote' | 'both'>('local');

  const pendingDeletionsRef = useRef<
    Map<
      string,
      {
        timeoutId: NodeJS.Timeout;
        item: SyncItemDiff;
        scope: 'local' | 'remote' | 'both';
        priorStore?: WorkspaceStoreState;
      }
    >
  >(new Map());

  const workspaceStoreRef = useRef(workspaceStore);
  useEffect(() => {
    workspaceStoreRef.current = workspaceStore;
  }, [workspaceStore]);

  const toggleWorkspaceCollapse = (wsId: string) => {
    setCollapsedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) next.delete(wsId);
      else next.add(wsId);
      return next;
    });
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedItemIds(new Set());
    setConfirmBulkDelete(false);
  };

  const toggleSelectAll = () => {
    if (filteredItems.length === 0) return;
    const actionableItems = filteredItems.filter(item => item.entityType !== 'task_document');
    const allSelected = actionableItems.every((item) => selectedItemIds.has(item.id));
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedItemIds(new Set(actionableItems.map((item) => item.id)));
    }
  };

  const [sanityConfig, setSanityConfig] = useState(getSanityConfig());
  const isSanityConfigured = Boolean(sanityConfig.projectId && sanityConfig.dataset);

  useEffect(() => {
    const updateConfig = () => {
      pendingDeletionsRef.current.forEach(p => clearTimeout(p.timeoutId));
      pendingDeletionsRef.current.clear();
      setResult(null);
      setSanityConfig(getSanityConfig());
    };
    updateConfig();
    window.addEventListener('antask_sanity_config_updated', updateConfig);
    return () => {
      window.removeEventListener('antask_sanity_config_updated', updateConfig);
      pendingDeletionsRef.current.forEach(p => clearTimeout(p.timeoutId));
    };
  }, []);

  // Close active dropdown menu when clicking outside
  useEffect(() => {
    if (!activeMenuId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sync-menu-container')) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenuId]);

  const handleRunAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const session = getSyncSession();
      const res = await analyzeSyncDifferences(workspaceStore);
      if (getSyncSession() !== session) return;
      setResult(res);
      if (res.hasPendingChanges) {
        const count = res.counts.localOverrides + res.counts.remoteOverrides + res.counts.conflicts;
        onShowToast(i18n._(msg`Detección completada: ${count} diferencias encontradas`), 'info');
      } else {
        onShowToast(i18n._(msg`Todo está al día y sincronizado con Sanity`), 'success');
      }
    } catch (err: any) {
      onShowToast(err?.message || i18n._(msg`Error al analizar diferencias`), 'error');
    } finally {
      setIsAnalyzing(false);
    }
  }, [workspaceStore, onShowToast, i18n]);

  useEffect(() => {
    if (isOpen) {
      handleRunAnalysis();
    }
  }, [isOpen, handleRunAnalysis]);

  const handleResolveSingle = async (
    item: SyncItemDiff,
    strategy: 'keep_local' | 'keep_remote' | 'merge'
  ) => {
    const session = getSyncSession();
    setResolvingItemId(item.id);
    setActiveMenuId(null);
    try {
      const res = await resolveSyncItem(item, strategy, workspaceStore);
      if (getSyncSession() !== session) return;
      if (res.success) {
        onShowToast(res.message, 'success');
        if (res.updatedStore) {
          onUpdateWorkspaceStore(res.updatedStore);
        }
        await handleRunAnalysis();
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error al resolver elemento', 'error');
    } finally {
      setResolvingItemId(null);
    }
  };

  const handleUndoDeletion = useCallback(
    (itemId: string) => {
      const pending = pendingDeletionsRef.current.get(itemId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      pendingDeletionsRef.current.delete(itemId);

      if (pending.priorStore) {
        onUpdateWorkspaceStore(pending.priorStore);
      }

      setResult((prev) => {
        if (!prev) return prev;
        if (prev.items.some((i) => i.id === itemId)) return prev;
        return {
          ...prev,
          items: [pending.item, ...prev.items],
        };
      });

      onShowToast(
        i18n._(msg`Eliminación deshecha. Elemento restaurado.`),
        'success'
      );
    },
    [onUpdateWorkspaceStore, onShowToast, i18n]
  );

  const handleUndoBatchDeletion = useCallback(
    (itemIds: string[], priorStore?: WorkspaceStoreState, itemsToRestore?: SyncItemDiff[]) => {
      for (const id of itemIds) {
        const pending = pendingDeletionsRef.current.get(id);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingDeletionsRef.current.delete(id);
        }
      }

      if (priorStore) {
        onUpdateWorkspaceStore(priorStore);
      }

      setResult((prev) => {
        if (!prev) return prev;
        const existingIds = new Set(prev.items.map((i) => i.id));
        const toAdd = (itemsToRestore || []).filter((i) => !existingIds.has(i.id));
        return {
          ...prev,
          items: [...toAdd, ...prev.items],
        };
      });

      onShowToast(
        i18n._(msg`Eliminación múltiple cancelada. Elementos restaurados.`),
        'success'
      );
    },
    [onUpdateWorkspaceStore, onShowToast, i18n]
  );

  const handleDeleteSelected = async () => {
    if (selectedItemIds.size === 0 || !result) return;
    const itemsToDelete = result.items.filter((item) => selectedItemIds.has(item.id));
    if (itemsToDelete.length === 0) return;

    setConfirmBulkDelete(false);
    const itemIdsArray = Array.from(selectedItemIds);
    const currentSelectedSet = new Set(selectedItemIds);
    clearSelection();

    const priorStore = { ...workspaceStoreRef.current };

    // Optimistically remove from result
    setResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((i) => !currentSelectedSet.has(i.id)),
          }
        : null
    );

    // If local deletion is needed
    if (bulkDeleteScope === 'local' || bulkDeleteScope === 'both') {
      let currentWorkspaces = [...workspaceStoreRef.current.workspaces];
      const wsIdsToRemove = new Set<string>();

      for (const item of itemsToDelete) {
        if (item.entityType === 'workspace') {
          const cleanWsId = (
            item.localData?.id ||
            item.remoteData?.workspaceId ||
            item.remoteData?.id ||
            item.id.replace(/^ws_/, '')
          ).toString();
          wsIdsToRemove.add(cleanWsId);
          wsIdsToRemove.add(item.id);
          wsIdsToRemove.add(`ws_${cleanWsId}`);
          wsIdsToRemove.add(cleanWsId.replace(/^workspace-/, ''));
        }
      }

      if (wsIdsToRemove.size > 0) {
        currentWorkspaces = currentWorkspaces.filter(
          (w) =>
            !wsIdsToRemove.has(w.id) &&
            !wsIdsToRemove.has(`ws_${w.id}`) &&
            !wsIdsToRemove.has(w.id.replace(/^workspace-/, ''))
        );
      }

      // Also remove any task items locally from markdown
      const tasksToDelete = itemsToDelete.filter((i) => i.entityType === 'task');
      if (tasksToDelete.length > 0) {
        currentWorkspaces = currentWorkspaces.map((w) => ({
          ...w,
          branches: w.branches.map((b) => ({
            ...b,
            taskDocuments: b.taskDocuments.map((d) => {
              let md = d.content;
              for (const taskItem of tasksToDelete) {
                const taskId =
                  taskItem.localData?.taskId ||
                  taskItem.localData?.temporaryId ||
                  taskItem.remoteData?.taskId ||
                  taskItem.remoteData?._id?.replace(/^task-/, '') ||
                  taskItem.id.replace(/^task_/, '');
                md = deleteTaskFromMarkdown(md, taskId, taskItem.localData?.title);
              }
              return md !== d.content
                ? {
                    ...d,
                    content: md,
                    lastSavedContent: md,
                    updatedAt: new Date().toISOString(),
                  }
                : d;
            }),
          })),
        }));
      }

      const nextStore: WorkspaceStoreState = {
        ...workspaceStoreRef.current,
        workspaces: currentWorkspaces,
        activeWorkspaceId:
          currentWorkspaces.find((w) => w.id === workspaceStoreRef.current.activeWorkspaceId)?.id ||
          currentWorkspaces[0]?.id ||
          workspaceStoreRef.current.activeWorkspaceId,
      };
      onUpdateWorkspaceStore(nextStore);
    }

    // Schedule delayed permanent deletion for all items
    const deletionSession = getSyncSession();
    const deletionConfig = getSanityConfig();
    const timeoutId = setTimeout(async () => {
      if (getSyncSession() !== deletionSession) return;
      for (const id of itemIdsArray) {
        pendingDeletionsRef.current.delete(id);
      }
      try {
        if (bulkDeleteScope === 'remote' || bulkDeleteScope === 'both') {
          for (const item of itemsToDelete) {
            await deleteSyncItem(item, bulkDeleteScope, workspaceStoreRef.current, deletionConfig);
          }
        }
      } catch (err) {
        console.warn('Error executing bulk permanent deletion from Sanity:', err);
      }
    }, 30000);

    for (const item of itemsToDelete) {
      pendingDeletionsRef.current.set(item.id, {
        timeoutId,
        item,
        scope: bulkDeleteScope,
        priorStore,
      });
    }

    const scopeLabel =
      bulkDeleteScope === 'both'
        ? i18n._(msg`localmente y en Sanity Cloud`)
        : bulkDeleteScope === 'remote'
        ? i18n._(msg`en Sanity Cloud`)
        : i18n._(msg`en local`);

    onShowToast(
      i18n._(
        msg`${itemsToDelete.length} elemento(s) marcados para eliminar ${scopeLabel}. Tienes 30s para deshacer.`
      ),
      'warning',
      {
        label: i18n._(msg`Deshacer (30s)`),
        onClick: () => handleUndoBatchDeletion(itemIdsArray, priorStore, itemsToDelete),
      },
      30000
    );
  };

  const handleDeleteSingle = async (
    item: SyncItemDiff,
    scope: 'local' | 'remote' | 'both'
  ) => {
    setActiveMenuId(null);
    setConfirmDeleteItemId(null);

    const existing = pendingDeletionsRef.current.get(item.id);
    if (existing) {
      clearTimeout(existing.timeoutId);
      pendingDeletionsRef.current.delete(item.id);
    }

    const priorStore = { ...workspaceStoreRef.current };

    // Optimistically remove from result items
    setResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((i) => i.id !== item.id),
          }
        : null
    );

    // If local deletion is needed, calculate and apply immediately to workspaceStore
    if (scope === 'local' || scope === 'both') {
      if (item.entityType === 'workspace') {
        const cleanWsId = (
          item.localData?.id ||
          item.remoteData?.workspaceId ||
          item.remoteData?.id ||
          item.id.replace(/^ws_/, '')
        ).toString();
        const nextWorkspaces = workspaceStoreRef.current.workspaces.filter(
          (w) =>
            w.id !== cleanWsId &&
            w.id !== item.id &&
            `ws_${w.id}` !== item.id &&
            w.id.replace(/^workspace-/, '') !== cleanWsId.replace(/^workspace-/, '')
        );
        if (nextWorkspaces.length > 0 || workspaceStoreRef.current.workspaces.length > 0) {
          const nextStore: WorkspaceStoreState = {
            ...workspaceStoreRef.current,
            workspaces: nextWorkspaces,
            activeWorkspaceId:
              nextWorkspaces.find((w) => w.id === workspaceStoreRef.current.activeWorkspaceId)?.id ||
              nextWorkspaces[0]?.id ||
              workspaceStoreRef.current.activeWorkspaceId,
          };
          onUpdateWorkspaceStore(nextStore);
        }
      } else if (item.entityType === 'task') {
        const taskId =
          item.localData?.taskId ||
          item.localData?.temporaryId ||
          item.remoteData?.taskId ||
          item.remoteData?._id?.replace(/^task-/, '') ||
          item.id.replace(/^task_/, '');
        const updatedWorkspaces = workspaceStoreRef.current.workspaces.map((w) => ({
          ...w,
          branches: w.branches.map((b) => ({
            ...b,
            taskDocuments: b.taskDocuments.map((d) => {
              const newContent = deleteTaskFromMarkdown(
                d.content,
                taskId,
                item.localData?.title
              );
              return newContent !== d.content
                ? {
                    ...d,
                    content: newContent,
                    lastSavedContent: newContent,
                    updatedAt: new Date().toISOString(),
                  }
                : d;
            }),
          })),
        }));
        const nextStore: WorkspaceStoreState = {
          ...workspaceStoreRef.current,
          workspaces: updatedWorkspaces,
        };
        onUpdateWorkspaceStore(nextStore);
      }
    }

    // Schedule permanent execution after 30 seconds
    const deletionSession = getSyncSession();
    const deletionConfig = getSanityConfig();
    const timeoutId = setTimeout(async () => {
      if (getSyncSession() !== deletionSession) return;
      pendingDeletionsRef.current.delete(item.id);
      try {
        if (scope === 'remote' || scope === 'both') {
          const res = await deleteSyncItem(item, scope, workspaceStoreRef.current, deletionConfig);
          if (!res.success) {
            console.warn('Permanent remote deletion failed:', res.message);
          }
        }
      } catch (err) {
        console.warn('Error executing permanent deletion from Sanity:', err);
      }
    }, 30000);

    pendingDeletionsRef.current.set(item.id, {
      timeoutId,
      item,
      scope,
      priorStore,
    });

    const itemCleanName = item.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '');
    const scopeLabel =
      scope === 'both'
        ? i18n._(msg`localmente y en Sanity Cloud`)
        : scope === 'remote'
        ? i18n._(msg`en Sanity Cloud`)
        : i18n._(msg`en local`);

    onShowToast(
      i18n._(msg`"${itemCleanName}" marcado para eliminar ${scopeLabel}. Tienes 30s para deshacer.`),
      'warning',
      {
        label: i18n._(msg`Deshacer (30s)`),
        onClick: () => handleUndoDeletion(item.id),
      },
      30000
    );
  };

  const handleBatchSyncAction = async (mode: 'smart' | 'push_all' | 'pull_all') => {
    if (!result) return;
    const session = getSyncSession();
    setIsProcessing(true);
    try {
      const res = await executeBatchSync(result.items, mode, workspaceStore);
      if (getSyncSession() !== session) return;
      onUpdateWorkspaceStore(res.updatedStore);
      if (res.success) {
        onShowToast(res.message, 'success');
        onUpdateWorkspaceStore(res.updatedStore);
        await handleRunAnalysis();
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error durante la sincronización batch', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredItems = (result?.items || []).filter((item) => {
    switch (filterType) {
      case 'pending':
        return item.diffType !== 'synced';
      case 'local_override':
        return item.diffType === 'local_override';
      case 'remote_override':
        return item.diffType === 'remote_override';
      case 'conflicts':
        return item.diffType === 'conflict';
      case 'unique':
        return item.diffType === 'only_local' || item.diffType === 'only_remote';
      case 'synced':
        return item.diffType === 'synced';
      case 'all':
      default:
        return true;
    }
  });

  const getDiffStatus = (diffType: SyncDifferenceType) => {
    switch (diffType) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">check</span>
            <span>{i18n._(msg`Sincronizado`)}</span>
          </span>
        );
      case 'local_override':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-sky-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
            <span>{i18n._(msg`Local más reciente`)}</span>
          </span>
        );
      case 'remote_override':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
            <span>{i18n._(msg`Remoto más reciente`)}</span>
          </span>
        );
      case 'conflict':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">priority_high</span>
            <span>{i18n._(msg`Conflicto`)}</span>
          </span>
        );
      case 'only_local':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-indigo-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">add</span>
            <span>{i18n._(msg`Solo local`)}</span>
          </span>
        );
      case 'only_remote':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-purple-400 font-medium">
            <span className="material-symbols-outlined text-[15px]">cloud</span>
            <span>{i18n._(msg`Solo remoto`)}</span>
          </span>
        );
      default:
        return null;
    }
  };

  const groupedWorkspaces = useMemo(() => {
    interface WorkspaceGroup {
      workspaceItem?: SyncItemDiff;
      workspaceId: string;
      workspaceName: string;
      tasks: SyncItemDiff[];
    }
    const wsMap = new Map<string, WorkspaceGroup>();

    // 1. Identify all workspace items first
    for (const item of filteredItems) {
      if (item.entityType === 'workspace') {
        const wsId = item.workspaceId || item.id.replace(/^ws_/, '');
        const existing: WorkspaceGroup = wsMap.get(wsId) || {
          workspaceId: wsId,
          workspaceName: item.localData?.name || item.remoteData?.name || item.title.replace(/^Workspace:\s*/, ''),
          tasks: [],
        };
        existing.workspaceItem = item;
        if (item.localData?.name || item.remoteData?.name) {
          existing.workspaceName = item.localData?.name || item.remoteData?.name;
        }
        wsMap.set(wsId, existing);
      }
    }

    // 2. Map all task items into matching workspace groups
    for (const item of filteredItems) {
      if (item.entityType === 'task' || item.entityType === 'task_document') {
        const rawWsId = item.workspaceId || 'unassigned';
        const cleanWsId = rawWsId.replace(/^ws_/, '').replace(/^workspace-/, '');
        const cleanWsName = (item.workspaceName || '').trim().toLowerCase();

        let targetKey = rawWsId;
        for (const [key, group] of wsMap.entries()) {
          const groupCleanKey = key.replace(/^ws_/, '').replace(/^workspace-/, '');
          const groupCleanName = (group.workspaceName || '').trim().toLowerCase();
          if (
            key === rawWsId ||
            groupCleanKey === cleanWsId ||
            (cleanWsName && groupCleanName === cleanWsName)
          ) {
            targetKey = key;
            break;
          }
        }

        const existing: WorkspaceGroup = wsMap.get(targetKey) || {
          workspaceId: targetKey,
          workspaceName:
            item.workspaceName ||
            (targetKey === 'unassigned' ? i18n._(msg`Sanity Cloud (Sin Workspace local)`) : targetKey),
          tasks: [],
        };
        existing.tasks.push(item);
        wsMap.set(targetKey, existing);
      }
    }

    return Array.from(wsMap.values());
  }, [filteredItems, i18n]);

  const renderItemRow = (item: SyncItemDiff, isChildTask = false) => {
    if (item.entityType === 'task_document') return (
      <div key={item.id} data-document-path={item.documentPath} className="flex items-center justify-between gap-3 pl-10 pr-4 py-2 border-b border-[var(--outline)]/10">
        <div className="min-w-0">
          <div className="text-sm text-[var(--on-surface)] truncate">{item.documentPath}</div>
          <div className="text-xs text-[var(--on-surface-variant)]">{item.branchName}</div>
        </div>
        {getDiffStatus(item.diffType)}
      </div>
    );
    const isExpanded = expandedItemId === item.id;
    const isResolving = resolvingItemId === item.id;
    const isMenuOpen = activeMenuId === item.id;

    const localMs = item.localTimestamp ? new Date(item.localTimestamp).getTime() : 0;
    const remoteMs = item.remoteTimestamp ? new Date(item.remoteTimestamp).getTime() : 0;
    const isLocalNewer = item.diffType !== 'synced' && localMs > 0 && remoteMs > 0 && localMs > remoteMs + 1000;
    const isRemoteNewer = item.diffType !== 'synced' && localMs > 0 && remoteMs > 0 && remoteMs > localMs + 1000;

    return (
      <div key={item.id} id={`sync-row-${item.id}`} className="group flex flex-col transition-colors">
        {/* Main Row */}
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-container-high)]/40 ${
            selectedItemIds.has(item.id) ? 'bg-indigo-950/20' : ''
          } ${isChildTask ? 'pl-10 bg-[var(--surface-container-low)]/30' : ''}`}
        >
          {/* Left: Checkbox + Icon + Title + Metadata */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <input
              type="checkbox"
              id={`sync-select-item-${item.id}`}
              checked={selectedItemIds.has(item.id)}
              onChange={(e) => {
                e.stopPropagation();
                toggleSelectItem(item.id);
              }}
              className="w-4 h-4 rounded border-[var(--outline)] accent-indigo-500 cursor-pointer shrink-0"
              title={i18n._(msg`Seleccionar para acciones en lote`)}
            />

            <span className="material-symbols-outlined text-[17px] text-[var(--on-surface-variant)] shrink-0 opacity-80">
              {item.entityType === 'workspace' ? 'folder' : 'task_alt'}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--on-surface)] truncate">
                  {item.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '')}
                </span>
              </div>

              <div className="text-xs text-[var(--on-surface-variant)] flex items-center gap-2 truncate mt-0.5 font-mono">
                {item.subtitle && <span className="truncate">{item.subtitle}</span>}
                {item.subtitle && <span className="opacity-40">·</span>}
                <span className="shrink-0">
                  Local: {item.localTimestamp ? formatRelativeTime(item.localTimestamp) : <span className="italic opacity-60">No existe</span>}
                </span>
                <span className="opacity-40">·</span>
                <span className="shrink-0">
                  Remoto: {item.remoteTimestamp ? formatRelativeTime(item.remoteTimestamp) : <span className="italic opacity-60">No publicado</span>}
                </span>
              </div>
            </div>
          </div>

          {/* Center-Right: Diff Status */}
          <div className="shrink-0 hidden sm:flex items-center px-2">
            {getDiffStatus(item.diffType)}
          </div>

          {/* Right: Contextual Action + Overflow Menu */}
          <div className="flex items-center gap-1.5 shrink-0 relative sync-menu-container">
            {/* Primary contextual action (at most 1 prominent button) */}
            {item.diffType === 'only_local' && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured}
                onClick={() => handleResolveSingle(item, 'keep_local')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-sky-400 hover:bg-sky-950/40"
                title={i18n._(msg`Subir a Sanity Cloud`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{i18n._(msg`Subir`)}</span>
              </button>
            )}

            {item.diffType === 'only_remote' && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured}
                onClick={() => handleResolveSingle(item, 'keep_remote')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-amber-400 hover:bg-amber-950/40"
                title={i18n._(msg`Descargar a local`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                <span>{i18n._(msg`Bajar`)}</span>
              </button>
            )}

            {item.diffType === 'local_override' && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured}
                onClick={() => handleResolveSingle(item, 'keep_local')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-sky-400 hover:bg-sky-950/40"
                title={i18n._(msg`Subir cambios locales más recientes a Sanity`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{i18n._(msg`Subir`)}</span>
              </button>
            )}

            {item.diffType === 'remote_override' && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured || !item.remoteData}
                onClick={() => handleResolveSingle(item, 'keep_remote')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-amber-400 hover:bg-amber-950/40"
                title={i18n._(msg`Descargar cambios remotos más recientes`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                <span>{i18n._(msg`Bajar`)}</span>
              </button>
            )}

            {item.diffType === 'conflict' && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured}
                onClick={() => handleResolveSingle(item, 'keep_local')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-rose-400 hover:bg-rose-950/40"
                title={i18n._(msg`Mantener versión local`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{i18n._(msg`Subir`)}</span>
              </button>
            )}

            {/* Overflow menu trigger "⋯" */}
            <button
              type="button"
              id={`btn-sync-menu-trigger-${item.id}`}
              onClick={() => setActiveMenuId(isMenuOpen ? null : item.id)}
              className="btn-m3-icon w-7 h-7 cursor-pointer text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              title={i18n._(msg`Más opciones`)}
            >
              <span className="material-symbols-outlined text-[18px]">more_horiz</span>
            </button>

            {/* Contextual Dropdown Menu */}
            {isMenuOpen && (
              <div
                id={`sync-menu-dropdown-${item.id}`}
                className="absolute right-0 top-full mt-1 w-48 bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md shadow-xl py-1 z-30 text-xs animate-fade-in"
              >
                <button
                  type="button"
                  onClick={() => {
                    setExpandedItemId(isExpanded ? null : item.id);
                    setActiveMenuId(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-[var(--on-surface)]"
                >
                  <span className="material-symbols-outlined text-[15px] opacity-70">
                    {isExpanded ? 'unfold_less' : 'difference'}
                  </span>
                  <span>{isExpanded ? i18n._(msg`Ocultar diferencias`) : i18n._(msg`Ver diferencias`)}</span>
                </button>

                {item.diffType === 'local_override' && (
                  <button
                    type="button"
                    disabled={isResolving || !item.remoteData}
                    onClick={() => handleResolveSingle(item, 'keep_remote')}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-amber-400"
                  >
                    <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
                    <span>{i18n._(msg`Descartar y bajar remoto`)}</span>
                  </button>
                )}

                {item.diffType === 'remote_override' && (
                  <button
                    type="button"
                    disabled={isResolving}
                    onClick={() => handleResolveSingle(item, 'keep_local')}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-sky-400"
                  >
                    <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
                    <span>{i18n._(msg`Forzar subida de local`)}</span>
                  </button>
                )}

                {item.diffType === 'conflict' && (
                  <button
                    type="button"
                    disabled={isResolving || !item.remoteData}
                    onClick={() => handleResolveSingle(item, 'keep_remote')}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-amber-400"
                  >
                    <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
                    <span>{i18n._(msg`Mantener versión remota`)}</span>
                  </button>
                )}

                {item.diffType === 'synced' && (
                  <>
                    <button
                      type="button"
                      disabled={isResolving}
                      onClick={() => handleResolveSingle(item, 'keep_local')}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-[var(--on-surface)]"
                    >
                      <span className="material-symbols-outlined text-[15px] opacity-70">arrow_upward</span>
                      <span>{i18n._(msg`Forzar subida`)}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isResolving || !item.remoteData}
                      onClick={() => handleResolveSingle(item, 'keep_remote')}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-[var(--on-surface)]"
                    >
                      <span className="material-symbols-outlined text-[15px] opacity-70">arrow_downward</span>
                      <span>{i18n._(msg`Forzar descarga`)}</span>
                    </button>
                  </>
                )}

                <div className="border-t border-[var(--outline)]/40 my-1" />

                <button
                  type="button"
                  disabled={isResolving || isProcessing}
                  onClick={() => {
                    setConfirmDeleteItemId(item.id);
                    setDeleteScope(
                      item.diffType === 'only_remote'
                        ? 'remote'
                        : item.diffType === 'only_local'
                        ? 'local'
                        : 'local'
                    );
                    setActiveMenuId(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-rose-950/30 flex items-center gap-2 text-rose-400"
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                  <span>{i18n._(msg`Eliminar...`)}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Inline Delete Confirmation Bar */}
        {confirmDeleteItemId === item.id && (
          <div
            id={`sync-delete-confirm-${item.id}`}
            className="px-4 py-2.5 bg-rose-950/20 border-y border-rose-900/40 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 text-rose-300 font-medium">
              <span className="material-symbols-outlined text-[16px] text-rose-400">warning</span>
              <span>
                {item.diffType === 'only_local'
                  ? i18n._(msg`¿Eliminar de este equipo local?`)
                  : item.diffType === 'only_remote'
                  ? i18n._(msg`¿Eliminar de Sanity Cloud?`)
                  : i18n._(msg`¿Dónde deseas eliminar "${item.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '')}"?`)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {item.diffType !== 'only_local' && item.diffType !== 'only_remote' && (
                <div className="flex items-center gap-1 bg-[var(--surface)] p-0.5 rounded border border-[var(--outline)] text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDeleteScope('local')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      deleteScope === 'local' ? 'bg-sky-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Local`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteScope('remote')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      deleteScope === 'remote' ? 'bg-amber-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Sanity`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteScope('both')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      deleteScope === 'both' ? 'bg-rose-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Ambos`)}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setConfirmDeleteItemId(null)}
                className="btn-m3-secondary px-2.5 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cancelar`)}
              </button>
              <button
                type="button"
                disabled={isResolving}
                onClick={() =>
                  handleDeleteSingle(
                    item,
                    item.diffType === 'only_remote'
                      ? 'remote'
                      : item.diffType === 'only_local'
                      ? 'local'
                      : deleteScope
                  )
                }
                className="px-2.5 py-1 text-xs rounded font-medium bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer"
              >
                {i18n._(msg`Confirmar Eliminación`)}
              </button>
            </div>
          </div>
        )}

        {/* Expanded Diff Viewer */}
        {isExpanded && (
          <div
            id={`sync-diff-${item.id}`}
            className="px-4 py-3 bg-[var(--surface-container-low)]/50 border-y border-[var(--outline)]/40 flex flex-col gap-2 text-xs"
          >
            {item.summaryChanges.length > 0 && (
              <ul className="list-disc list-inside space-y-1 text-xs text-[var(--on-surface)] pl-1">
                {item.summaryChanges.map((change, idx) => (
                  <li key={idx} className="font-mono text-[11px]">
                    {change}
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
              <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col">
                <span className="text-[10px] font-mono font-semibold uppercase text-sky-400 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">laptop</span>
                  <span>{i18n._(msg`Versión Local`)}</span>
                </span>
                <pre className="text-[11px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-36 p-1.5 bg-[var(--surface-container-low)] rounded border border-[var(--outline)]/40">
                  {item.localData ? JSON.stringify(item.localData, null, 2) : i18n._(msg`(No existe en local)`)}
                </pre>
              </div>

              <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col">
                <span className="text-[10px] font-mono font-semibold uppercase text-amber-400 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">cloud</span>
                  <span>{i18n._(msg`Versión Sanity Cloud`)}</span>
                </span>
                <pre className="text-[11px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-36 p-1.5 bg-[var(--surface-container-low)] rounded border border-[var(--outline)]/40">
                  {item.remoteData ? JSON.stringify(item.remoteData, null, 2) : i18n._(msg`(No existe en Sanity)`)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      id="modal-sync-override-overlay"
      className="fixed inset-0 z-[65] overflow-y-auto p-3 sm:p-6 bg-black/75 flex justify-center items-center custom-modal-scrollbar animate-fade-in"
    >
      <div
        id="modal-sync-override-dialog"
        className="w-full max-w-4xl bg-[var(--surface)] border border-[var(--outline)] rounded-lg shadow-2xl flex flex-col overflow-hidden max-h-[85vh] h-[85vh] min-h-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. HEADER */}
        <div
          id="sync-modal-header"
          className="px-4 py-3 border-b border-[var(--outline)]/50 bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 id="sync-modal-title" className="text-sm font-semibold text-[var(--on-surface)] truncate">
              {i18n._(msg`Sync & Override Detection`)}
            </h2>
            <span className="text-xs text-[var(--on-surface-variant)] hidden sm:inline truncate">
              Dataset: <span className="font-mono text-[var(--on-surface)]">{sanityConfig.dataset || 'production'}</span> · Proyecto:{' '}
              <span className="font-mono text-[var(--on-surface)]">{sanityConfig.projectId || i18n._(msg`No conectado`)}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              id="btn-sync-open-sanity-config"
              type="button"
              onClick={onOpenSanityConfig}
              className={`btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer ${
                !isSanityConfigured ? 'text-amber-400 border-amber-500/40 bg-amber-950/30' : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
              title={i18n._(msg`Configurar credenciales de Sanity`)}
            >
              <span className="material-symbols-outlined text-[15px]">settings</span>
              <span>{i18n._(msg`Configuración`)}</span>
            </button>

            <button
              id="btn-sync-re-analyze"
              type="button"
              onClick={handleRunAnalysis}
              disabled={isAnalyzing || isProcessing}
              className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title={i18n._(msg`Volver a analizar diferencias`)}
            >
              <span className={`material-symbols-outlined text-[15px] ${isAnalyzing ? 'animate-spin' : ''}`}>
                refresh
              </span>
              <span>{isAnalyzing ? i18n._(msg`Analizando...`) : i18n._(msg`Re-analizar`)}</span>
            </button>

            <button
              id="btn-sync-close-modal"
              type="button"
              onClick={onClose}
              className="btn-m3-icon w-7 h-7 cursor-pointer text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              title={i18n._(msg`Cerrar`)}
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* 2. TOOLBAR */}
        <div
          id="sync-modal-toolbar"
          className="px-4 py-2 bg-[var(--surface)] border-b border-[var(--outline)]/50 flex flex-wrap items-center justify-between gap-3 shrink-0"
        >
          {/* Select All & Filters */}
          <div className="flex items-center gap-2 text-xs overflow-x-auto max-w-full py-0.5">
            {filteredItems.length > 0 && (
              <label
                className="flex items-center gap-1.5 text-xs text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer select-none pr-2 border-r border-[var(--outline)]/40 shrink-0"
                title={i18n._(msg`Seleccionar o deseleccionar todos los elementos visibles`)}
              >
                <input
                  type="checkbox"
                  id="sync-select-all-checkbox"
                  checked={filteredItems.length > 0 && filteredItems.every((item) => selectedItemIds.has(item.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-[var(--outline)] accent-indigo-500 cursor-pointer"
                />
                <span className="font-medium text-[11px]">{i18n._(msg`Todos`)}</span>
              </label>
            )}

            <button
              id="btn-sync-filter-all"
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterType === 'all'
                  ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
              }`}
            >
              <span>{i18n._(msg`Filtro: Todos`)}</span>
              <span className="font-mono text-[11px] opacity-70">{result?.counts.total || 0}</span>
            </button>

            <button
              id="btn-sync-filter-pending"
              type="button"
              onClick={() => setFilterType('pending')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterType === 'pending'
                  ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
              }`}
            >
              <span>{i18n._(msg`Con diferencias`)}</span>
              <span className="font-mono text-[11px] opacity-70">
                {(result?.counts.total || 0) - (result?.counts.synced || 0)}
              </span>
            </button>

            <button
              id="btn-sync-filter-local"
              type="button"
              onClick={() => setFilterType('local_override')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterType === 'local_override'
                  ? 'bg-[var(--surface-container-high)] text-sky-400 font-semibold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
              }`}
            >
              <span>{i18n._(msg`Local`)}</span>
              <span className="font-mono text-[11px] opacity-70">{result?.counts.localOverrides || 0}</span>
            </button>

            <button
              id="btn-sync-filter-remote"
              type="button"
              onClick={() => setFilterType('remote_override')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterType === 'remote_override'
                  ? 'bg-[var(--surface-container-high)] text-amber-400 font-semibold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
              }`}
            >
              <span>{i18n._(msg`Remoto`)}</span>
              <span className="font-mono text-[11px] opacity-70">{result?.counts.remoteOverrides || 0}</span>
            </button>

            {(result?.counts.conflicts || 0) > 0 && (
              <button
                id="btn-sync-filter-conflicts"
                type="button"
                onClick={() => setFilterType('conflicts')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                  filterType === 'conflicts'
                    ? 'bg-[var(--surface-container-high)] text-rose-400 font-semibold'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
                }`}
              >
                <span>{i18n._(msg`Conflictos`)}</span>
                <span className="font-mono text-[11px] opacity-70">{result?.counts.conflicts || 0}</span>
              </button>
            )}
          </div>

          {/* Batch Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-sync-batch-smart"
              type="button"
              disabled={isProcessing || !result?.hasPendingChanges || !isSanityConfigured}
              onClick={() => handleBatchSyncAction('smart')}
              className="btn-m3-primary text-xs px-3 py-1.5 flex items-center gap-1.5 font-medium cursor-pointer disabled:opacity-40 shadow-none"
              title={i18n._(msg`Resuelve automáticamente aplicando los cambios más recientes en ambas direcciones`)}
            >
              <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
              <span>{i18n._(msg`Smart Sync`)}</span>
            </button>

            <button
              id="btn-sync-batch-push-all"
              type="button"
              disabled={isProcessing || !isSanityConfigured || !result}
              onClick={() => handleBatchSyncAction('push_all')}
              className="btn-m3-secondary text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer disabled:opacity-40"
              title={i18n._(msg`Sobrescribe Sanity con el estado local de todos los workspaces`)}
            >
              <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
              <span>{i18n._(msg`Subir todo`)}</span>
            </button>

            <button
              id="btn-sync-batch-pull-all"
              type="button"
              disabled={isProcessing || !isSanityConfigured || !result}
              onClick={() => handleBatchSyncAction('pull_all')}
              className="btn-m3-secondary text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer disabled:opacity-40"
              title={i18n._(msg`Sobrescribe el estado local con los datos almacenados en Sanity`)}
            >
              <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
              <span>{i18n._(msg`Descargar todo`)}</span>
            </button>
          </div>
        </div>

        {/* 2.1 SELECTION ACTION BAR */}
        {selectedItemIds.size > 0 && (
          <div
            id="sync-modal-selection-bar"
            className="px-4 py-2 bg-indigo-950/40 border-b border-indigo-900/50 flex flex-wrap items-center justify-between gap-3 text-xs animate-fade-in shrink-0"
          >
            <div className="flex items-center gap-2 text-indigo-200 font-medium">
              <span className="material-symbols-outlined text-[16px] text-indigo-400">check_circle</span>
              <span>{i18n._(msg`${selectedItemIds.size} elemento(s) seleccionado(s)`)}</span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-indigo-300 hover:text-white underline ml-2 cursor-pointer"
              >
                {i18n._(msg`Deseleccionar todo`)}
              </button>
            </div>

            {!confirmBulkDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  className="px-2.5 py-1 text-xs rounded font-medium bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer flex items-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                  <span>{i18n._(msg`Eliminar seleccionados (${selectedItemIds.size})`)}</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-rose-300 font-medium">{i18n._(msg`Eliminar en:`)}</span>
                <div className="flex items-center gap-1 bg-[var(--surface)] p-0.5 rounded border border-[var(--outline)] text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBulkDeleteScope('local')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      bulkDeleteScope === 'local' ? 'bg-sky-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Local`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDeleteScope('remote')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      bulkDeleteScope === 'remote' ? 'bg-amber-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Sanity`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDeleteScope('both')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      bulkDeleteScope === 'both' ? 'bg-rose-600 text-white font-medium' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    {i18n._(msg`Ambos`)}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(false)}
                  className="btn-m3-secondary px-2 py-1 text-xs cursor-pointer"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="px-2.5 py-1 text-xs rounded font-medium bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer flex items-center gap-1 shadow-sm"
                >
                  {i18n._(msg`Confirmar Eliminación (${selectedItemIds.size})`)}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 3. CONTENT (Main Scrollable Divider List) */}
        <div
          id="sync-modal-content-list"
          className="flex-1 overflow-y-auto min-h-0 divide-y divide-[var(--outline)]/40 custom-modal-scrollbar"
        >
          {filteredItems.length === 0 ? (
            <div className="p-12 text-center text-[var(--on-surface-variant)] flex flex-col items-center justify-center gap-2">
              <span className="material-symbols-outlined text-3xl text-emerald-400">check_circle</span>
              <p className="text-sm font-medium text-[var(--on-surface)]">
                {filterType === 'pending'
                  ? i18n._(msg`No hay diferencias pendientes`)
                  : filterType === 'conflicts'
                  ? i18n._(msg`No hay conflictos divergentes`)
                  : filterType === 'local_override'
                  ? i18n._(msg`No hay cambios locales pendientes`)
                  : filterType === 'remote_override'
                  ? i18n._(msg`No hay cambios remotos pendientes`)
                  : i18n._(msg`Todos los elementos están sincronizados`)}
              </p>
              <p className="text-xs text-[var(--on-surface-variant)]">
                {i18n._(msg`El almacenamiento local y Sanity Cloud coinciden plenamente.`)}
              </p>
            </div>
          ) : (
            groupedWorkspaces.map((group) => {
              const isCollapsed = collapsedWorkspaceIds.has(group.workspaceId);
              const hasChildTasks = group.tasks.length > 0;

              return (
                <div key={group.workspaceId} className="flex flex-col">
                  {/* Workspace Row */}
                  {group.workspaceItem ? (
                    renderItemRow(group.workspaceItem, false)
                  ) : (
                    /* Default Workspace Header Row if no direct workspace item */
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-container-high)]/40 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="material-symbols-outlined text-[17px] text-[var(--on-surface-variant)] shrink-0 opacity-80">
                          folder
                        </span>
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-[var(--on-surface)] truncate">
                            {group.workspaceName}
                          </span>
                          <p className="text-xs text-[var(--on-surface-variant)] font-mono">
                            {i18n._(msg`Workspace sincronizado`)}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center">
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                          <span className="material-symbols-outlined text-[15px]">check</span>
                          <span>{i18n._(msg`Sincronizado`)}</span>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Tasks list under workspace */}
                  {hasChildTasks && (
                    <div className="flex flex-col">
                      {/* Sub-header toggle for tasks */}
                      <button
                        type="button"
                        onClick={() => toggleWorkspaceCollapse(group.workspaceId)}
                        className="flex items-center justify-between px-4 py-1.5 bg-[var(--surface-container-low)]/20 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]/30 text-xs font-medium cursor-pointer transition-colors border-t border-[var(--outline)]/20"
                      >
                        <div className="flex items-center gap-1.5 pl-6">
                          <span className="material-symbols-outlined text-[15px]">
                            {isCollapsed ? 'chevron_right' : 'expand_more'}
                          </span>
                          <span>{i18n._(msg`Tareas del Workspace`)}</span>
                          <span className="font-mono text-[11px] opacity-70">({group.tasks.length})</span>
                        </div>
                        <span className="text-[11px] opacity-70">
                          {isCollapsed ? i18n._(msg`Mostrar`) : i18n._(msg`Ocultar`)}
                        </span>
                      </button>

                      {/* Render Child Tasks */}
                      {!isCollapsed && (
                        <div className="divide-y divide-[var(--outline)]/20">
                          {group.tasks.map((taskItem) => renderItemRow(taskItem, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
