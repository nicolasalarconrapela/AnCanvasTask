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
  exportSyncBundle,
  downloadSyncBundleAsFile,
  parseAndValidateSyncBundle,
  applySyncBundle,
  SyncBundle,
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
  const [activeTab, setActiveTab] = useState<'elements' | 'summary'>('elements');
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(new Set());
  const [collapsedDocKeys, setCollapsedDocKeys] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<boolean>(false);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<'local' | 'remote' | 'both'>('local');
  const [collapsedSummaryConflictDiffs, setCollapsedSummaryConflictDiffs] = useState<Set<string>>(new Set());
  const [pendingImportBundle, setPendingImportBundle] = useState<{
    bundle: SyncBundle;
    filename: string;
  } | null>(null);
  const [importSyncMode, setImportSyncMode] = useState<'local' | 'cloud' | 'both' | 'compare'>('local');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleSummaryConflictDiff = (id: string) => {
    setCollapsedSummaryConflictDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDocCollapse = (docKey: string) => {
    setCollapsedDocKeys((prev) => {
      const next = new Set(prev);
      if (next.has(docKey)) next.delete(docKey);
      else next.add(docKey);
      return next;
    });
  };

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
      // Flush any pending remote deletions before unmounting so they are not cancelled
      const currentPending = Array.from(pendingDeletionsRef.current.values());
      pendingDeletionsRef.current.clear();
      currentPending.forEach((p) => {
        clearTimeout(p.timeoutId);
        if (p.scope === 'remote' || p.scope === 'both') {
          deleteSyncItem(p.item, p.scope, workspaceStoreRef.current, getSanityConfig()).catch(() => {});
        }
      });
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
        const count = res.counts.localOverrides + res.counts.remoteOverrides + res.counts.autoMerged + res.counts.conflicts;
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

    // If scope is remote-only, execute immediately
    if (bulkDeleteScope === 'remote') {
      try {
        let successCount = 0;
        for (const item of itemsToDelete) {
          const res = await deleteSyncItem(item, 'remote', workspaceStoreRef.current, getSanityConfig());
          if (res.success) successCount++;
        }
        onShowToast(
          i18n._(msg`${successCount} elemento(s) eliminados de Sanity Cloud`),
          'success'
        );
      } catch (err: any) {
        console.warn('Error executing bulk permanent deletion from Sanity:', err);
      }
      return;
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

    // For remote-only items, execute deletion immediately so the user gets instant feedback
    if (scope === 'remote') {
      try {
        const res = await deleteSyncItem(item, 'remote', workspaceStoreRef.current, deletionConfig);
        if (res.success) {
          onShowToast(res.message, 'success');
        } else {
          onShowToast(res.message, 'error');
          setResult((prev) => (prev ? { ...prev, items: [...prev.items, item] } : null));
        }
      } catch (err: any) {
        onShowToast(err?.message || 'Error al eliminar en remoto', 'error');
        setResult((prev) => (prev ? { ...prev, items: [...prev.items, item] } : null));
      }
      return;
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

  const handleExportSyncBundle = () => {
    try {
      const bundle = exportSyncBundle(workspaceStore, result);
      downloadSyncBundleAsFile(bundle);
      onShowToast(
        i18n._(
          msg`Snapshot de Sync exportado en JSON (${bundle.metadata.summary.totalWorkspaces} workspaces, ${bundle.metadata.summary.totalTasks} tareas)`
        ),
        'success'
      );
    } catch (err: any) {
      onShowToast(err?.message || 'Error al exportar JSON', 'error');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;
      const res = parseAndValidateSyncBundle(text);
      if (!res.valid || !res.bundle) {
        onShowToast(res.error || 'Archivo JSON no compatible', 'error');
        return;
      }
      setPendingImportBundle({ bundle: res.bundle, filename: file.name });
      setImportSyncMode('local');
    };
    reader.onerror = () => {
      onShowToast('Error al leer el archivo JSON', 'error');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExecuteImportSync = async () => {
    if (!pendingImportBundle) return;
    const { bundle } = pendingImportBundle;
    setIsProcessing(true);
    try {
      if (importSyncMode === 'compare') {
        onShowToast(i18n._(msg`Analizando diferencias con Sanity Cloud para los datos importados...`), 'info');
        const comp = await analyzeSyncDifferences(bundle.workspaceStore);
        setResult(comp);
        onShowToast(
          i18n._(msg`Comparación de Sync completada: ${comp.items.length} elemento(s) analizados`),
          'info'
        );
        setPendingImportBundle(null);
        return;
      }

      const res = await applySyncBundle(bundle, importSyncMode, workspaceStore);
      if (res.success) {
        onUpdateWorkspaceStore(res.updatedStore);
        onShowToast(res.message, 'success');
        setPendingImportBundle(null);
        setTimeout(() => {
          handleRunAnalysis();
        }, 100);
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error durante la sincronización del archivo JSON', 'error');
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
      case 'auto_merged':
        return <span className="text-xs text-[var(--on-surface-variant)]">{i18n._(msg`Fusionar (3-way merge)`)}</span>;
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

  interface MarkdownDocumentGroup {
    docKey: string;
    docId: string;
    documentPath: string;
    branchName: string;
    documentItem?: SyncItemDiff;
    tasks: SyncItemDiff[];
  }

  interface WorkspaceGroup {
    workspaceItem?: SyncItemDiff;
    workspaceId: string;
    workspaceName: string;
    documents: MarkdownDocumentGroup[];
    orphanTasks: SyncItemDiff[];
  }

  const groupedWorkspaces = useMemo(() => {
    const wsMap = new Map<string, WorkspaceGroup>();

    const getOrCreateWorkspaceGroup = (wsId: string, wsName?: string): WorkspaceGroup => {
      const cleanWsId = wsId.replace(/^ws_/, '').replace(/^workspace-/, '');
      const cleanWsName = (wsName || '').trim().toLowerCase();

      let targetKey = wsId;
      for (const [key, group] of wsMap.entries()) {
        const groupCleanKey = key.replace(/^ws_/, '').replace(/^workspace-/, '');
        const groupCleanName = (group.workspaceName || '').trim().toLowerCase();
        if (
          key === wsId ||
          groupCleanKey === cleanWsId ||
          (cleanWsName && groupCleanName === cleanWsName)
        ) {
          targetKey = key;
          break;
        }
      }

      let existing = wsMap.get(targetKey);
      if (!existing) {
        existing = {
          workspaceId: targetKey,
          workspaceName:
            wsName ||
            (targetKey === 'unassigned'
              ? i18n._(msg`Sanity Cloud (Sin Workspace local)`)
              : targetKey),
          documents: [],
          orphanTasks: [],
        };
        wsMap.set(targetKey, existing);
      } else if (wsName && (!existing.workspaceName || existing.workspaceName === targetKey)) {
        existing.workspaceName = wsName;
      }
      return existing;
    };

    // 1. Identify all workspace items first
    for (const item of filteredItems) {
      if (item.entityType === 'workspace') {
        const wsId = item.workspaceId || item.id.replace(/^ws_/, '');
        const wsName =
          item.localData?.name || item.remoteData?.name || item.title.replace(/^Workspace:\s*/, '');
        const group = getOrCreateWorkspaceGroup(wsId, wsName);
        group.workspaceItem = item;
      }
    }

    // 2. Identify all task_document items (each document retains its individual identity)
    for (const item of filteredItems) {
      if (item.entityType === 'task_document') {
        const wsId = item.workspaceId || 'unassigned';
        const group = getOrCreateWorkspaceGroup(wsId, item.workspaceName);
        const docPath = item.documentPath || item.title || 'TASKS.md';
        const branchName = item.branchName || 'main';
        let parsedDocId = item.localData?.id || item.remoteData?.id;
        if (!parsedDocId && item.id.startsWith('md_')) {
          try {
            parsedDocId = JSON.parse(item.id.slice(3))[2];
          } catch {
            parsedDocId = item.id;
          }
        }
        const docId = String(parsedDocId || item.id || docPath);
        const docKey = `${group.workspaceId}::${branchName}::${docId}`;

        let docGroup = group.documents.find(
          (d) => d.docKey === docKey || (d.docId === docId && d.branchName === branchName)
        );
        if (!docGroup) {
          docGroup = {
            docKey,
            docId,
            documentPath: docPath,
            branchName,
            documentItem: item,
            tasks: [],
          };
          group.documents.push(docGroup);
        } else {
          docGroup.documentItem = item;
          docGroup.documentPath = docPath;
          docGroup.branchName = branchName;
        }
      }
    }

    // 3. Map all task items into matching document groups inside their workspace
    for (const item of filteredItems) {
      if (item.entityType === 'task') {
        const rawWsId = item.workspaceId || 'unassigned';
        const group = getOrCreateWorkspaceGroup(rawWsId, item.workspaceName);
        const docPath =
          item.documentPath ||
          item.remoteData?.documentPath ||
          item.subtitle?.match(/Doc:\s*"([^"]+)"/)?.[1] ||
          '';
        const branchName = item.branchName || item.remoteData?.branchName || '';

        // Determine matching document ID for the task
        let taskDocId = '';
        if (item.remoteData?.documentKey) {
          taskDocId = item.remoteData.documentKey.split('::')[1] || '';
        }
        if (!taskDocId && item.id.startsWith('task_')) {
          const parts = item.id.split('_');
          if (parts.length >= 5) {
            taskDocId = parts[parts.length - 2];
          }
        }

        if (docPath || taskDocId) {
          const resolvedBranch = branchName || 'main';
          let docGroup = group.documents.find(
            (d) =>
              (taskDocId && d.docId === taskDocId) ||
              (d.documentPath === docPath && (!branchName || d.branchName === branchName))
          );
          if (!docGroup) {
            const docId = taskDocId || docPath;
            const docKey = `${group.workspaceId}::${resolvedBranch}::${docId}`;
            docGroup = {
              docKey,
              docId,
              documentPath: docPath || 'TASKS.md',
              branchName: resolvedBranch,
              tasks: [],
            };
            group.documents.push(docGroup);
          }
          docGroup.tasks.push(item);
        } else {
          group.orphanTasks.push(item);
        }
      }
    }

    return Array.from(wsMap.values());
  }, [filteredItems, i18n]);

  const computeTextLineDiff = (localStr: string = '', remoteStr: string = '') => {
    const localLines = localStr ? localStr.split('\n') : [];
    const remoteLines = remoteStr ? remoteStr.split('\n') : [];
    const max = Math.max(localLines.length, remoteLines.length);
    const rows: Array<{
      type: 'same' | 'local_only' | 'remote_only' | 'modified';
      localLine?: string;
      remoteLine?: string;
      lineNum: number;
    }> = [];

    for (let i = 0; i < max; i++) {
      const l = localLines[i];
      const r = remoteLines[i];
      if (l !== undefined && r !== undefined) {
        if (l === r) {
          rows.push({ type: 'same', localLine: l, remoteLine: r, lineNum: i + 1 });
        } else {
          rows.push({ type: 'modified', localLine: l, remoteLine: r, lineNum: i + 1 });
        }
      } else if (l !== undefined) {
        rows.push({ type: 'local_only', localLine: l, lineNum: i + 1 });
      } else if (r !== undefined) {
        rows.push({ type: 'remote_only', remoteLine: r, lineNum: i + 1 });
      }
    }
    return rows;
  };

  const renderStructuredDiff = (item: SyncItemDiff) => {
    if (item.entityType === 'task') {
      const local = item.localData || {};
      const remote = item.remoteData || {};
      const fields = [
        {
          label: i18n._(msg`Título`),
          local: local.title || <span className="italic opacity-60">{i18n._(msg`Sin título`)}</span>,
          remote: remote.title || <span className="italic opacity-60">{i18n._(msg`Sin título`)}</span>,
          isDiff: (local.title || '') !== (remote.title || ''),
        },
        {
          label: i18n._(msg`Estado`),
          local: local.completed ? i18n._(msg`Completada`) : i18n._(msg`Pendiente`),
          remote: remote.completed ? i18n._(msg`Completada`) : i18n._(msg`Pendiente`),
          isDiff: Boolean(local.completed) !== Boolean(remote.completed),
        },
        {
          label: i18n._(msg`Prioridad`),
          local: local.priority || 'P1',
          remote: remote.priority || 'P1',
          isDiff: (local.priority || 'P1') !== (remote.priority || 'P1'),
        },
        {
          label: i18n._(msg`Sección`),
          local: local.groupTitle || 'General',
          remote: remote.groupTitle || 'General',
          isDiff: (local.groupTitle || 'General') !== (remote.groupTitle || 'General'),
        },
        {
          label: i18n._(msg`Etiquetas`),
          local: Array.isArray(local.tags) ? (local.tags.length > 0 ? local.tags.join(', ') : '-') : local.tags || '-',
          remote: Array.isArray(remote.tags) ? (remote.tags.length > 0 ? remote.tags.join(', ') : '-') : remote.tags || '-',
          isDiff: JSON.stringify(local.tags || []) !== JSON.stringify(remote.tags || []),
        },
        {
          label: i18n._(msg`Bloqueado por`),
          local: local.blockedBy || '-',
          remote: remote.blockedBy || '-',
          isDiff: (local.blockedBy || '') !== (remote.blockedBy || ''),
        },
      ];

      return (
        <div className="overflow-x-auto rounded border border-[var(--outline)]/40 bg-[var(--surface)]">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className="border-b border-[var(--outline)]/40 bg-[var(--surface-container-high)]/40 text-[11px] text-[var(--on-surface-variant)]">
                <th className="py-2 px-3 font-semibold w-28">{i18n._(msg`Campo`)}</th>
                <th className="py-2 px-3 font-semibold text-sky-400 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">laptop</span>
                    <span>{i18n._(msg`Versión Local`)}</span>
                    {item.localTimestamp && (
                      <span className="text-[10px] text-sky-300/70 font-normal font-mono">
                        ({formatRelativeTime(item.localTimestamp)})
                      </span>
                    )}
                  </div>
                </th>
                <th className="py-2 px-3 font-semibold text-amber-400 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">cloud</span>
                    <span>{i18n._(msg`Versión Sanity Cloud`)}</span>
                    {item.remoteTimestamp && (
                      <span className="text-[10px] text-amber-300/70 font-normal font-mono">
                        ({formatRelativeTime(item.remoteTimestamp)})
                      </span>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--outline)]/20 text-[11px]">
              {fields.map((f, i) => (
                <tr key={i} className={f.isDiff ? 'bg-amber-950/15' : ''}>
                  <td className="py-2 px-3 font-medium text-[var(--on-surface-variant)] flex items-center gap-1.5">
                    {f.isDiff && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" title={i18n._(msg`Diferencia detectada`)} />
                    )}
                    <span>{f.label}</span>
                  </td>
                  <td className={`py-2 px-3 font-mono ${f.isDiff ? 'text-sky-300 font-semibold bg-sky-950/20' : 'text-[var(--on-surface)]'}`}>
                    {f.local}
                  </td>
                  <td className={`py-2 px-3 font-mono ${f.isDiff ? 'text-amber-300 font-semibold bg-amber-950/20' : 'text-[var(--on-surface)]'}`}>
                    {f.remote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (item.entityType === 'task_document') {
      const localContent = typeof item.localData?.content === 'string' ? item.localData.content : '';
      const remoteContent = typeof item.remoteData?.content === 'string' ? item.remoteData.content : '';
      const diffRows = computeTextLineDiff(localContent, remoteContent);

      return (
        <div className="flex flex-col gap-2 rounded border border-[var(--outline)]/40 bg-[var(--surface)] p-2">
          <div className="flex items-center justify-between text-[11px] font-mono border-b border-[var(--outline)]/30 pb-1.5">
            <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
              <span className="material-symbols-outlined text-[14px]">laptop</span>
              <span>Local {item.localTimestamp ? `(${formatRelativeTime(item.localTimestamp)})` : ''}</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
              <span className="material-symbols-outlined text-[14px]">cloud</span>
              <span>Sanity Cloud {item.remoteTimestamp ? `(${formatRelativeTime(item.remoteTimestamp)})` : ''}</span>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto font-mono text-[11px] divide-y divide-[var(--outline)]/10 rounded bg-[var(--surface-container-low)]">
            {diffRows.map((row, idx) => (
              <div
                key={idx}
                className={`grid grid-cols-2 gap-2 py-0.5 px-2 ${
                  row.type === 'modified'
                    ? 'bg-amber-950/20'
                    : row.type === 'local_only'
                    ? 'bg-sky-950/20'
                    : row.type === 'remote_only'
                    ? 'bg-rose-950/20'
                    : ''
                }`}
              >
                <div className={`overflow-x-auto whitespace-pre font-mono ${row.type === 'local_only' || row.type === 'modified' ? 'text-sky-300 font-medium' : 'text-[var(--on-surface-variant)]'}`}>
                  <span className="text-[10px] opacity-40 select-none mr-2">{row.lineNum}</span>
                  {row.localLine !== undefined ? row.localLine : <span className="opacity-20 select-none">-</span>}
                </div>
                <div className={`overflow-x-auto whitespace-pre font-mono ${row.type === 'remote_only' || row.type === 'modified' ? 'text-amber-300 font-medium' : 'text-[var(--on-surface-variant)]'}`}>
                  <span className="text-[10px] opacity-40 select-none mr-2">{row.lineNum}</span>
                  {row.remoteLine !== undefined ? row.remoteLine : <span className="opacity-20 select-none">-</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (item.entityType === 'workspace') {
      const local = item.localData || {};
      const remote = item.remoteData || {};
      const fields = [
        {
          label: i18n._(msg`Nombre`),
          local: local.name || '-',
          remote: remote.name || '-',
          isDiff: (local.name || '') !== (remote.name || ''),
        },
        {
          label: i18n._(msg`Rama activa`),
          local: local.activeBranchName || '-',
          remote: remote.activeBranchName || '-',
          isDiff: (local.activeBranchName || '') !== (remote.activeBranchName || ''),
        },
        {
          label: i18n._(msg`Repositorio`),
          local: local.githubRepo?.fullName || '-',
          remote: remote.githubRepo?.fullName || '-',
          isDiff: (local.githubRepo?.fullName || '') !== (remote.githubRepo?.fullName || ''),
        },
        {
          label: i18n._(msg`Ramas`),
          local: `${local.branches?.length || 0} ${i18n._(msg`rama(s)`)}`,
          remote: `${remote.branches?.length || 0} ${i18n._(msg`rama(s)`)}`,
          isDiff: (local.branches?.length || 0) !== (remote.branches?.length || 0),
        },
      ];

      return (
        <div className="overflow-x-auto rounded border border-[var(--outline)]/40 bg-[var(--surface)]">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className="border-b border-[var(--outline)]/40 bg-[var(--surface-container-high)]/40 text-[11px] text-[var(--on-surface-variant)]">
                <th className="py-2 px-3 font-semibold w-28">{i18n._(msg`Propiedad`)}</th>
                <th className="py-2 px-3 font-semibold text-sky-400 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">laptop</span>
                    <span>{i18n._(msg`Versión Local`)}</span>
                  </div>
                </th>
                <th className="py-2 px-3 font-semibold text-amber-400 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">cloud</span>
                    <span>{i18n._(msg`Versión Sanity Cloud`)}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--outline)]/20 text-[11px]">
              {fields.map((f, i) => (
                <tr key={i} className={f.isDiff ? 'bg-amber-950/15' : ''}>
                  <td className="py-2 px-3 font-medium text-[var(--on-surface-variant)] flex items-center gap-1.5">
                    {f.isDiff && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" title={i18n._(msg`Diferencia detectada`)} />
                    )}
                    <span>{f.label}</span>
                  </td>
                  <td className={`py-2 px-3 font-mono ${f.isDiff ? 'text-sky-300 font-semibold bg-sky-950/20' : 'text-[var(--on-surface)]'}`}>
                    {f.local}
                  </td>
                  <td className={`py-2 px-3 font-mono ${f.isDiff ? 'text-amber-300 font-semibold bg-amber-950/20' : 'text-[var(--on-surface)]'}`}>
                    {f.remote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return null;
  };

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
          } ${isChildTask ? 'pl-10 sm:pl-12 bg-[var(--surface-container-low)]/20' : ''}`}
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

            {(item.diffType === 'local_override' || item.diffType === 'auto_merged') && (
              <button
                type="button"
                id={`btn-sync-action-${item.id}`}
                disabled={isResolving || !isSanityConfigured}
                onClick={() => handleResolveSingle(item, item.diffType === 'auto_merged' ? 'merge' : 'keep_local')}
                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-sky-400 hover:bg-sky-950/40"
                title={i18n._(msg`Subir cambios locales más recientes a Sanity`)}
              >
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{item.diffType === 'auto_merged' ? i18n._(msg`Fusionar (3-way merge)`) : i18n._(msg`Subir`)}</span>
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
                id={`btn-sync-conflict-toggle-${item.id}`}
                disabled={isResolving}
                onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                  isExpanded
                    ? 'bg-rose-950/60 text-rose-300 border border-rose-500/50'
                    : 'bg-rose-950/30 text-rose-400 hover:bg-rose-950/50 border border-rose-500/30'
                }`}
                title={i18n._(msg`Ver el detalle del conflicto y opciones de resolución`)}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {isExpanded ? 'unfold_less' : 'difference'}
                </span>
                <span>{isExpanded ? i18n._(msg`Ocultar`) : i18n._(msg`Resolver conflicto`)}</span>
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
                className="absolute right-0 top-full mt-1 w-52 bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md shadow-xl py-1 z-30 text-xs animate-fade-in"
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
                  <>
                    <button
                      type="button"
                      disabled={isResolving || !isSanityConfigured}
                      onClick={() => handleResolveSingle(item, 'keep_local')}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-sky-400"
                    >
                      <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
                      <span>{i18n._(msg`Conservar versión local`)}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isResolving || !item.remoteData || !isSanityConfigured}
                      onClick={() => handleResolveSingle(item, 'keep_remote')}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-amber-400"
                    >
                      <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
                      <span>{i18n._(msg`Aceptar versión remota`)}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isResolving || !isSanityConfigured}
                      onClick={() => handleResolveSingle(item, 'merge')}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-container)] flex items-center gap-2 text-indigo-400"
                    >
                      <span className="material-symbols-outlined text-[15px]">call_merge</span>
                      <span>{i18n._(msg`Fusionar cambios (3-way)`)}</span>
                    </button>
                  </>
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

        {/* Expanded Diff Viewer & Conflict Resolution */}
        {isExpanded && (
          <div
            id={`sync-diff-${item.id}`}
            className="px-4 py-3 bg-[var(--surface-container-low)]/50 border-y border-[var(--outline)]/40 flex flex-col gap-2.5 text-xs animate-fade-in"
          >
            {/* Conflict Solution Action Banner */}
            {item.diffType === 'conflict' && (
              <div
                id={`sync-conflict-resolution-bar-${item.id}`}
                className="p-3 rounded-md bg-rose-950/20 border border-rose-900/40 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-rose-300 font-medium text-xs">
                  <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">
                    priority_high
                  </span>
                  <span>{i18n._(msg`Conflicto detectado: selecciona qué solución aplicar`)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    id={`btn-conflict-keep-local-${item.id}`}
                    disabled={isResolving || !isSanityConfigured}
                    onClick={() => handleResolveSingle(item, 'keep_local')}
                    className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-sky-400 hover:bg-sky-950/40"
                    title={i18n._(msg`Conservar los cambios locales y sobrescribir en Sanity Cloud`)}
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                    <span>{i18n._(msg`Mantener Local`)}</span>
                  </button>
                  <button
                    type="button"
                    id={`btn-conflict-keep-remote-${item.id}`}
                    disabled={isResolving || !isSanityConfigured || !item.remoteData}
                    onClick={() => handleResolveSingle(item, 'keep_remote')}
                    className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 text-amber-400 hover:bg-amber-950/40"
                    title={i18n._(msg`Aceptar la versión de Sanity Cloud y sobrescribir los cambios locales`)}
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                    <span>{i18n._(msg`Aceptar Remoto`)}</span>
                  </button>
                  <button
                    type="button"
                    id={`btn-conflict-merge-${item.id}`}
                    disabled={isResolving || !isSanityConfigured}
                    onClick={() => handleResolveSingle(item, 'merge')}
                    className="px-3 py-1 text-xs rounded font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-40 bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
                    title={i18n._(msg`Fusionar cambios automáticamente conservando ediciones no conflictivas`)}
                  >
                    <span className="material-symbols-outlined text-[14px]">call_merge</span>
                    <span>{i18n._(msg`Fusionar (3-way merge)`)}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Differences Summary */}
            {item.summaryChanges.length > 0 && (
              <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)]/40 flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                  {i18n._(msg`Resumen de discrepancias`)}
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-xs text-[var(--on-surface)] pl-1">
                  {item.summaryChanges.map((change, idx) => (
                    <li key={idx} className="font-mono text-[11px]">
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Structured Field-by-Field Comparison */}
            {renderStructuredDiff(item)}

            {/* Raw JSON Details (collapsible) */}
            <details className="mt-1">
              <summary className="text-[11px] font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer select-none py-1">
                {i18n._(msg`Ver datos JSON sin procesar`)}
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col">
                  <span className="text-[10px] font-mono font-semibold uppercase text-sky-400 mb-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">laptop</span>
                    <span>{i18n._(msg`Versión Local (JSON)`)}</span>
                  </span>
                  <pre className="text-[11px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-36 p-1.5 bg-[var(--surface-container-low)] rounded border border-[var(--outline)]/40">
                    {item.localData ? JSON.stringify(item.localData, null, 2) : i18n._(msg`(No existe en local)`)}
                  </pre>
                </div>

                <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col">
                  <span className="text-[10px] font-mono font-semibold uppercase text-amber-400 mb-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">cloud</span>
                    <span>{i18n._(msg`Versión Sanity Cloud (JSON)`)}</span>
                  </span>
                  <pre className="text-[11px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-36 p-1.5 bg-[var(--surface-container-low)] rounded border border-[var(--outline)]/40">
                    {item.remoteData ? JSON.stringify(item.remoteData, null, 2) : i18n._(msg`(No existe en Sanity)`)}
                  </pre>
                </div>
              </div>
            </details>
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
              id="btn-sync-export-json"
              type="button"
              onClick={handleExportSyncBundle}
              disabled={isProcessing}
              className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title={i18n._(msg`Exportar todos los workspaces, documentos y estado de Sync a un archivo JSON`)}
            >
              <span className="material-symbols-outlined text-[15px]">download</span>
              <span>{i18n._(msg`Exportar JSON`)}</span>
            </button>

            <button
              id="btn-sync-import-json"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title={i18n._(msg`Importar archivo JSON de Sync y aplicar opciones de sincronización`)}
            >
              <span className="material-symbols-outlined text-[15px]">upload</span>
              <span>{i18n._(msg`Importar JSON`)}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileInputChange}
            />

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

        {/* TAB NAVIGATION BAR */}
        <div
          id="sync-modal-tabs"
          className="px-4 border-b border-[var(--outline)]/50 bg-[var(--surface)] flex items-center gap-1 shrink-0"
        >
          <button
            type="button"
            id="tab-btn-sync-elements"
            onClick={() => setActiveTab('elements')}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'elements'
                ? 'border-indigo-500 text-[var(--on-surface)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">account_tree</span>
            <span>{i18n._(msg`Elementos y Tareas`)}</span>
            <span className="font-mono text-[11px] opacity-75 px-1.5 py-0.5 rounded bg-[var(--surface-container-high)]">
              {filteredItems.length}
            </span>
          </button>

          <button
            type="button"
            id="tab-btn-sync-summary"
            onClick={() => setActiveTab('summary')}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'summary'
                ? 'border-indigo-500 text-[var(--on-surface)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">summarize</span>
            <span>{i18n._(msg`Resumen`)}</span>
            {(result?.counts.conflicts || 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-900/60 text-rose-300 border border-rose-500/40">
                {result?.counts.conflicts} {i18n._(msg`conflicto(s)`)}
              </span>
            )}
          </button>
        </div>

        {/* =================== TAB 1: ELEMENTOS Y TAREAS =================== */}
        {activeTab === 'elements' && (
          <>
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
                  const isWorkspaceCollapsed = collapsedWorkspaceIds.has(group.workspaceId);
                  const totalWorkspaceTasks =
                    group.documents.reduce((acc, d) => acc + d.tasks.length, 0) +
                    group.orphanTasks.length;
                  const hasContent = group.documents.length > 0 || group.orphanTasks.length > 0;

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

                      {/* Workspace Content (Markdown Documents + Tasks) */}
                      {hasContent && (
                        <div className="flex flex-col">
                          {/* Workspace Sub-header Toggle */}
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceCollapse(group.workspaceId)}
                            className="flex items-center justify-between px-4 py-1.5 bg-[var(--surface-container-low)]/20 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]/30 text-xs font-medium cursor-pointer transition-colors border-t border-[var(--outline)]/20 select-none"
                          >
                            <div className="flex items-center gap-1.5 pl-4">
                              <span className="material-symbols-outlined text-[15px]">
                                {isWorkspaceCollapsed ? 'chevron_right' : 'expand_more'}
                              </span>
                              <span>{i18n._(msg`Documentos y tareas del Workspace`)}</span>
                              <span className="font-mono text-[11px] opacity-70">
                                ({group.documents.length}{' '}
                                {group.documents.length === 1
                                  ? i18n._(msg`archivo`)
                                  : i18n._(msg`archivos`)}
                                , {totalWorkspaceTasks}{' '}
                                {totalWorkspaceTasks === 1
                                  ? i18n._(msg`tarea`)
                                  : i18n._(msg`tareas`)}
                                )
                              </span>
                            </div>
                            <span className="text-[11px] opacity-70">
                              {isWorkspaceCollapsed ? i18n._(msg`Mostrar`) : i18n._(msg`Ocultar`)}
                            </span>
                          </button>

                          {/* Render Markdown Document Groups under Workspace */}
                          {!isWorkspaceCollapsed && (
                            <div className="flex flex-col">
                              {group.documents.map((docGroup) => {
                                const isDocCollapsed = collapsedDocKeys.has(docGroup.docKey);

                                return (
                                  <div
                                    key={docGroup.docKey}
                                    data-document-path={docGroup.documentPath}
                                    className="flex flex-col border-t border-[var(--outline)]/20"
                                  >
                                    {/* Markdown Document Header with Collapse/Expand */}
                                    <button
                                      type="button"
                                      onClick={() => toggleDocCollapse(docGroup.docKey)}
                                      className="flex items-center justify-between gap-3 pl-8 pr-4 py-2 bg-[var(--surface-container-low)]/40 hover:bg-[var(--surface-container-high)]/40 transition-colors text-xs font-medium cursor-pointer select-none text-left w-full"
                                      aria-expanded={!isDocCollapsed}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)] transition-transform shrink-0">
                                          {isDocCollapsed ? 'chevron_right' : 'expand_more'}
                                        </span>
                                        <span className="material-symbols-outlined text-[16px] text-indigo-400 shrink-0">
                                          description
                                        </span>
                                        <span className="font-mono text-xs font-semibold text-[var(--on-surface)] truncate">
                                          {docGroup.documentPath}
                                        </span>
                                        {docGroup.branchName && (
                                          <span className="text-[10px] text-[var(--on-surface-variant)] px-1.5 py-0.5 rounded bg-[var(--surface-container-high)] font-mono border border-[var(--outline)]/20 shrink-0">
                                            {docGroup.branchName}
                                          </span>
                                        )}
                                        <span className="text-[11px] text-[var(--on-surface-variant)] font-mono opacity-75 shrink-0">
                                          ({docGroup.tasks.length}{' '}
                                          {docGroup.tasks.length === 1
                                            ? i18n._(msg`tarea`)
                                            : i18n._(msg`tareas`)}
                                          )
                                        </span>
                                      </div>

                                      <div className="shrink-0 flex items-center gap-3">
                                        {docGroup.documentItem &&
                                          getDiffStatus(docGroup.documentItem.diffType)}
                                        <span className="text-[11px] text-[var(--on-surface-variant)] opacity-70 hidden sm:inline">
                                          {isDocCollapsed ? i18n._(msg`Expandir`) : i18n._(msg`Colapsar`)}
                                        </span>
                                      </div>
                                    </button>

                                    {/* Child Tasks under this Markdown Document */}
                                    {!isDocCollapsed &&
                                      (docGroup.tasks.length > 0 ? (
                                        <div className="divide-y divide-[var(--outline)]/15">
                                          {docGroup.tasks.map((taskItem) =>
                                            renderItemRow(taskItem, true)
                                          )}
                                        </div>
                                      ) : (
                                        <div className="pl-14 pr-4 py-2 text-xs text-[var(--on-surface-variant)] italic bg-[var(--surface-container-lowest)]/10">
                                          {i18n._(msg`No hay tareas en este documento`)}
                                        </div>
                                      ))}
                                  </div>
                                );
                              })}

                              {/* Unassigned / Orphan Tasks */}
                              {group.orphanTasks.length > 0 && (
                                <div className="flex flex-col border-t border-[var(--outline)]/20">
                                  <div className="flex items-center gap-2 pl-8 pr-4 py-2 bg-[var(--surface-container-low)]/30 text-xs text-[var(--on-surface-variant)] font-medium">
                                    <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">
                                      checklist
                                    </span>
                                    <span>{i18n._(msg`Otras tareas sin documento`)}</span>
                                    <span className="font-mono text-[11px] opacity-70">
                                      ({group.orphanTasks.length})
                                    </span>
                                  </div>
                                  <div className="divide-y divide-[var(--outline)]/15">
                                    {group.orphanTasks.map((taskItem) =>
                                      renderItemRow(taskItem, true)
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* =================== TAB 2: RESUMEN =================== */}
        {activeTab === 'summary' && (
          <div
            id="sync-modal-summary-content"
            className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 flex flex-col gap-4 text-xs custom-modal-scrollbar"
          >
            {/* 1. Global Sync Health Banner */}
            <div className="p-4 rounded-lg bg-[var(--surface-container-low)] border border-[var(--outline)]/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`material-symbols-outlined text-2xl ${
                    (result?.counts.conflicts || 0) > 0
                      ? 'text-rose-400'
                      : result?.hasPendingChanges
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {(result?.counts.conflicts || 0) > 0
                    ? 'warning'
                    : result?.hasPendingChanges
                    ? 'sync_problem'
                    : 'check_circle'}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">
                    {(result?.counts.conflicts || 0) > 0
                      ? i18n._(msg`Se requieren resoluciones de conflicto`)
                      : result?.hasPendingChanges
                      ? i18n._(msg`Existen diferencias pendientes de sincronizar`)
                      : i18n._(msg`Todo el espacio está sincronizado`)}
                  </h3>
                  <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                    {(result?.counts.conflicts || 0) > 0
                      ? i18n._(
                          msg`Hay ${result!.counts.conflicts} elemento(s) con cambios incompatibles en local y Sanity Cloud.`
                        )
                      : result?.hasPendingChanges
                      ? i18n._(
                          msg`Hay ${(result?.counts.total || 0) - (result?.counts.synced || 0)} cambio(s) listos para sincronizar.`
                        )
                      : i18n._(msg`Todos los Workspaces, documentos Markdown y tareas coinciden plenamente.`)}
                  </p>
                </div>
              </div>

              {/* Quick Batch Sync Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing || !result?.hasPendingChanges || !isSanityConfigured}
                  onClick={() => handleBatchSyncAction('smart')}
                  className="btn-m3-primary text-xs px-3 py-1.5 flex items-center gap-1.5 font-medium cursor-pointer disabled:opacity-40 shadow-none"
                  title={i18n._(msg`Resuelve automáticamente aplicando los cambios más recientes`)}
                >
                  <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
                  <span>{i18n._(msg`Smart Sync`)}</span>
                </button>

                <button
                  type="button"
                  disabled={isProcessing || !isSanityConfigured || !result}
                  onClick={() => handleBatchSyncAction('push_all')}
                  className="btn-m3-secondary text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  title={i18n._(msg`Subir todo a Sanity Cloud`)}
                >
                  <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                  <span>{i18n._(msg`Subir todo`)}</span>
                </button>

                <button
                  type="button"
                  disabled={isProcessing || !isSanityConfigured || !result}
                  onClick={() => handleBatchSyncAction('pull_all')}
                  className="btn-m3-secondary text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  title={i18n._(msg`Descargar todo de Sanity Cloud`)}
                >
                  <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                  <span>{i18n._(msg`Descargar todo`)}</span>
                </button>
              </div>
            </div>

            {/* 2. Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-3 rounded-md bg-[var(--surface)] border border-[var(--outline)]/40 flex flex-col">
                <span className="text-[11px] text-[var(--on-surface-variant)]">{i18n._(msg`Total analizados`)}</span>
                <span className="text-lg font-bold font-mono text-[var(--on-surface)] mt-0.5">
                  {result?.counts.total || 0}
                </span>
              </div>

              <div className="p-3 rounded-md bg-[var(--surface)] border border-emerald-500/20 flex flex-col">
                <span className="text-[11px] text-emerald-400">{i18n._(msg`Sincronizados`)}</span>
                <span className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                  {result?.counts.synced || 0}
                </span>
              </div>

              <div className="p-3 rounded-md bg-[var(--surface)] border border-sky-500/20 flex flex-col">
                <span className="text-[11px] text-sky-400">{i18n._(msg`Cambios locales`)}</span>
                <span className="text-lg font-bold font-mono text-sky-400 mt-0.5">
                  {(result?.counts.localOverrides || 0) + (result?.counts.onlyLocal || 0)}
                </span>
              </div>

              <div className="p-3 rounded-md bg-[var(--surface)] border border-amber-500/20 flex flex-col">
                <span className="text-[11px] text-amber-400">{i18n._(msg`Cambios remotos`)}</span>
                <span className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                  {(result?.counts.remoteOverrides || 0) + (result?.counts.onlyRemote || 0)}
                </span>
              </div>

              <div className="p-3 rounded-md bg-[var(--surface)] border border-rose-500/20 flex flex-col">
                <span className="text-[11px] text-rose-400">{i18n._(msg`Conflictos`)}</span>
                <span className="text-lg font-bold font-mono text-rose-400 mt-0.5">
                  {result?.counts.conflicts || 0}
                </span>
              </div>
            </div>

            {/* 3. Conflicting Items Section (if any) */}
            {(result?.counts.conflicts || 0) > 0 && (
              <div className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-900/40 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
                    <span className="material-symbols-outlined text-[16px] text-rose-400">priority_high</span>
                    <span>{i18n._(msg`Conflictos pendientes de resolución (${result?.counts.conflicts ?? 0})`)}</span>
                  </div>
                </div>

                <div className="divide-y divide-rose-900/30 rounded border border-rose-900/30 bg-[var(--surface)]">
                  {(result?.items || [])
                    .filter((i) => i.diffType === 'conflict')
                    .map((conflictItem) => {
                      const isDiffCollapsed = collapsedSummaryConflictDiffs.has(conflictItem.id);
                      return (
                        <div key={conflictItem.id} className="p-3 flex flex-col gap-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">
                                {conflictItem.entityType === 'workspace' ? 'folder' : conflictItem.entityType === 'task_document' ? 'description' : 'task_alt'}
                              </span>
                              <span className="font-semibold text-[var(--on-surface)] truncate text-xs sm:text-sm">
                                {conflictItem.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '')}
                              </span>
                              {conflictItem.documentPath && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] truncate">
                                  {conflictItem.documentPath}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleSummaryConflictDiff(conflictItem.id)}
                                className="btn-m3-secondary px-2 py-1 text-xs rounded font-medium text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] flex items-center gap-1 cursor-pointer"
                                title={isDiffCollapsed ? i18n._(msg`Ver visor de diferencias`) : i18n._(msg`Ocultar visor de diferencias`)}
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {isDiffCollapsed ? 'visibility' : 'visibility_off'}
                                </span>
                                <span>{isDiffCollapsed ? i18n._(msg`Ver Diff`) : i18n._(msg`Ocultar Diff`)}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isProcessing || !isSanityConfigured}
                                onClick={() => handleResolveSingle(conflictItem, 'keep_local')}
                                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium text-sky-400 hover:bg-sky-950/40 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                title={i18n._(msg`Conservar local y subir a Sanity Cloud`)}
                              >
                                <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                                <span>{i18n._(msg`Mantener Local`)}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isProcessing || !isSanityConfigured || !conflictItem.remoteData}
                                onClick={() => handleResolveSingle(conflictItem, 'keep_remote')}
                                className="btn-m3-secondary px-2.5 py-1 text-xs rounded font-medium text-amber-400 hover:bg-amber-950/40 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                title={i18n._(msg`Aceptar versión de Sanity Cloud`)}
                              >
                                <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                                <span>{i18n._(msg`Aceptar Remoto`)}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isProcessing || !isSanityConfigured}
                                onClick={() => handleResolveSingle(conflictItem, 'merge')}
                                className="px-2.5 py-1 text-xs rounded font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                title={i18n._(msg`Fusionar (3-way merge)`)}
                              >
                                <span className="material-symbols-outlined text-[13px]">call_merge</span>
                                <span>{i18n._(msg`Fusionar`)}</span>
                              </button>
                            </div>
                          </div>

                          {conflictItem.summaryChanges.length > 0 && (
                            <ul className="list-disc list-inside text-[11px] font-mono text-[var(--on-surface-variant)] pl-2 space-y-0.5">
                              {conflictItem.summaryChanges.map((change, idx) => (
                                <li key={idx}>{change}</li>
                              ))}
                            </ul>
                          )}

                          {/* Diff Viewer (Structured table / side-by-side) */}
                          {!isDiffCollapsed && (
                            <div className="flex flex-col gap-2 mt-1">
                              {renderStructuredDiff(conflictItem)}

                              <details className="mt-0.5">
                                <summary className="text-[10px] font-mono text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer select-none py-0.5">
                                  {i18n._(msg`Ver datos JSON sin procesar`)}
                                </summary>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                                  <div className="p-2 rounded bg-[var(--surface-container-low)] border border-[var(--outline)]/40 flex flex-col">
                                    <span className="text-[10px] font-mono font-semibold uppercase text-sky-400 mb-1 flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[12px]">laptop</span>
                                      <span>{i18n._(msg`Versión Local (JSON)`)}</span>
                                    </span>
                                    <pre className="text-[10px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-28 p-1 bg-[var(--surface)] rounded border border-[var(--outline)]/20">
                                      {conflictItem.localData ? JSON.stringify(conflictItem.localData, null, 2) : i18n._(msg`(No existe en local)`)}
                                    </pre>
                                  </div>

                                  <div className="p-2 rounded bg-[var(--surface-container-low)] border border-[var(--outline)]/40 flex flex-col">
                                    <span className="text-[10px] font-mono font-semibold uppercase text-amber-400 mb-1 flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[12px]">cloud</span>
                                      <span>{i18n._(msg`Versión Sanity Cloud (JSON)`)}</span>
                                    </span>
                                    <pre className="text-[10px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap max-h-28 p-1 bg-[var(--surface)] rounded border border-[var(--outline)]/20">
                                      {conflictItem.remoteData ? JSON.stringify(conflictItem.remoteData, null, 2) : i18n._(msg`(No existe en Sanity)`)}
                                    </pre>
                                  </div>
                                </div>
                              </details>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 4. Markdown Files Distribution Table */}
            <div className="rounded-lg border border-[var(--outline)]/40 bg-[var(--surface)] overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-[var(--surface-container-high)]/40 border-b border-[var(--outline)]/40 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--on-surface)]">
                  {i18n._(msg`Distribución de Documentos Markdown y Tareas`)}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('elements')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>{i18n._(msg`Ver en Explorador`)}</span>
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-[var(--outline)]/30 text-[11px] text-[var(--on-surface-variant)] bg-[var(--surface-container-low)]/30">
                      <th className="py-2 px-3 font-semibold">{i18n._(msg`Workspace`)}</th>
                      <th className="py-2 px-3 font-semibold">{i18n._(msg`Documento Markdown`)}</th>
                      <th className="py-2 px-3 font-semibold">{i18n._(msg`Rama`)}</th>
                      <th className="py-2 px-3 font-semibold text-center">{i18n._(msg`Tareas`)}</th>
                      <th className="py-2 px-3 font-semibold">{i18n._(msg`Estado Sincronización`)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--outline)]/20 text-[11px]">
                    {groupedWorkspaces.flatMap((wsGroup) =>
                      wsGroup.documents.map((doc) => (
                        <tr key={doc.docKey} className="hover:bg-[var(--surface-container-high)]/30 transition-colors">
                          <td className="py-2 px-3 font-medium text-[var(--on-surface)]">
                            {wsGroup.workspaceName}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-[var(--on-surface)]">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[15px] text-indigo-400">description</span>
                              <span>{doc.documentPath}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-[var(--on-surface-variant)]">
                            {doc.branchName || 'main'}
                          </td>
                          <td className="py-2 px-3 font-mono text-center text-[var(--on-surface)] font-semibold">
                            {doc.tasks.length}
                          </td>
                          <td className="py-2 px-3">
                            {doc.documentItem
                              ? getDiffStatus(doc.documentItem.diffType)
                              : (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                                  <span className="material-symbols-outlined text-[15px]">check</span>
                                  <span>{i18n._(msg`Sincronizado`)}</span>
                                </span>
                              )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Import & Sync Support Dialog */}
      {pendingImportBundle && (
        <div
          id="modal-sync-import-overlay"
          className="fixed inset-0 z-[70] bg-black/75 flex justify-center items-center p-3 sm:p-6 animate-fade-in"
          onClick={() => !isProcessing && setPendingImportBundle(null)}
        >
          <div
            id="modal-sync-import-dialog"
            className="w-full max-w-lg bg-[var(--surface)] border border-[var(--outline)] rounded-lg shadow-2xl overflow-hidden flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--outline)]/50 flex items-center justify-between gap-3 bg-[var(--surface)]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-[20px]">upload_file</span>
                <h3 id="import-dialog-title" className="text-sm font-semibold text-[var(--on-surface)]">
                  {i18n._(msg`Importación y Soporte de Sync`)}
                </h3>
              </div>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setPendingImportBundle(null)}
                className="btn-m3-icon w-6 h-6 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col gap-3 text-xs overflow-y-auto max-h-[70vh]">
              {/* Metadata summary */}
              <div className="p-3 rounded bg-[var(--surface-container-low)] border border-[var(--outline)]/40 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--on-surface-variant)]">
                  <span className="font-medium truncate max-w-[260px] text-[var(--on-surface)] font-mono">
                    {pendingImportBundle.filename}
                  </span>
                  <span className="font-mono text-[10px]">
                    {formatRelativeTime(pendingImportBundle.bundle.metadata.exportedAt)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-[var(--outline)]/20">
                  <div className="p-1.5 rounded bg-[var(--surface)] border border-[var(--outline)]/20">
                    <div className="text-[10px] text-[var(--on-surface-variant)]">{i18n._(msg`Workspaces`)}</div>
                    <div className="font-mono text-sm font-semibold text-[var(--on-surface)]">
                      {pendingImportBundle.bundle.metadata.summary.totalWorkspaces}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[var(--surface)] border border-[var(--outline)]/20">
                    <div className="text-[10px] text-[var(--on-surface-variant)]">{i18n._(msg`Documentos`)}</div>
                    <div className="font-mono text-sm font-semibold text-[var(--on-surface)]">
                      {pendingImportBundle.bundle.metadata.summary.totalDocuments}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[var(--surface)] border border-[var(--outline)]/20">
                    <div className="text-[10px] text-[var(--on-surface-variant)]">{i18n._(msg`Tareas`)}</div>
                    <div className="font-mono text-sm font-semibold text-[var(--on-surface)]">
                      {pendingImportBundle.bundle.metadata.summary.totalTasks}
                    </div>
                  </div>
                </div>

                {pendingImportBundle.bundle.metadata.environment?.projectId && (
                  <div className="text-[10px] text-[var(--on-surface-variant)] flex items-center gap-1.5 pt-1 border-t border-[var(--outline)]/10">
                    <span className="material-symbols-outlined text-[13px] text-amber-400">cloud</span>
                    <span>{i18n._(msg`Origen Sanity:`)}</span>
                    <span className="font-mono text-[var(--on-surface)]">
                      {pendingImportBundle.bundle.metadata.environment.projectId} (
                      {pendingImportBundle.bundle.metadata.environment.dataset || 'production'})
                    </span>
                  </div>
                )}
              </div>

              {/* Sync mode options */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                  {i18n._(msg`Selecciona cómo sincronizar el archivo`)}
                </span>

                <div className="flex flex-col gap-2">
                  {/* Option 1: Local */}
                  <label
                    className={`p-2.5 rounded border transition cursor-pointer flex items-start gap-2.5 ${
                      importSyncMode === 'local'
                        ? 'border-indigo-500 bg-indigo-950/20'
                        : 'border-[var(--outline)]/40 hover:bg-[var(--surface-container-high)]/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importSyncMode"
                      checked={importSyncMode === 'local'}
                      onChange={() => setImportSyncMode('local')}
                      className="mt-0.5 accent-indigo-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px] text-sky-400">laptop</span>
                        <span>{i18n._(msg`Aplicar en Local`)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                        {i18n._(msg`Actualiza tu almacén local con los workspaces y tareas del archivo JSON.`)}
                      </div>
                    </div>
                  </label>

                  {/* Option 2: Cloud */}
                  <label
                    className={`p-2.5 rounded border transition flex items-start gap-2.5 ${
                      !isSanityConfigured ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      importSyncMode === 'cloud'
                        ? 'border-indigo-500 bg-indigo-950/20'
                        : 'border-[var(--outline)]/40 hover:bg-[var(--surface-container-high)]/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importSyncMode"
                      disabled={!isSanityConfigured}
                      checked={importSyncMode === 'cloud'}
                      onChange={() => setImportSyncMode('cloud')}
                      className="mt-0.5 accent-indigo-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px] text-amber-400">cloud_upload</span>
                        <span>{i18n._(msg`Subir a Sanity Cloud`)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                        {i18n._(msg`Publica directamente los workspaces del archivo en Sanity Cloud.`)}
                        {!isSanityConfigured && (
                          <span className="block text-amber-400/80 mt-0.5">
                            {i18n._(msg`(Requiere configurar credenciales de Sanity)`)}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>

                  {/* Option 3: Both */}
                  <label
                    className={`p-2.5 rounded border transition flex items-start gap-2.5 ${
                      !isSanityConfigured ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      importSyncMode === 'both'
                        ? 'border-indigo-500 bg-indigo-950/20'
                        : 'border-[var(--outline)]/40 hover:bg-[var(--surface-container-high)]/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importSyncMode"
                      disabled={!isSanityConfigured}
                      checked={importSyncMode === 'both'}
                      onChange={() => setImportSyncMode('both')}
                      className="mt-0.5 accent-indigo-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px] text-emerald-400">sync</span>
                        <span>{i18n._(msg`Sincronización Total (Local + Sanity Cloud)`)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                        {i18n._(msg`Actualiza tu almacén local y publica simultáneamente los datos en Sanity Cloud.`)}
                      </div>
                    </div>
                  </label>

                  {/* Option 4: Compare */}
                  <label
                    className={`p-2.5 rounded border transition cursor-pointer flex items-start gap-2.5 ${
                      importSyncMode === 'compare'
                        ? 'border-indigo-500 bg-indigo-950/20'
                        : 'border-[var(--outline)]/40 hover:bg-[var(--surface-container-high)]/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importSyncMode"
                      checked={importSyncMode === 'compare'}
                      onChange={() => setImportSyncMode('compare')}
                      className="mt-0.5 accent-indigo-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px] text-purple-400">compare_arrows</span>
                        <span>{i18n._(msg`Comparar en Sync (Inspeccionar diferencias)`)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">
                        {i18n._(msg`Carga los datos en el analizador de Sync para revisar diferencias contra Sanity Cloud sin guardar cambios aún.`)}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-[var(--outline)]/50 bg-[var(--surface-container-low)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImportBundle(null)}
                disabled={isProcessing}
                className="btn-m3-secondary px-3 py-1.5 text-xs cursor-pointer disabled:opacity-50"
              >
                {i18n._(msg`Cancelar`)}
              </button>
              <button
                type="button"
                onClick={handleExecuteImportSync}
                disabled={isProcessing}
                className="btn-m3-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isProcessing && <span className="material-symbols-outlined text-[14px] animate-spin">refresh</span>}
                <span>
                  {importSyncMode === 'compare'
                    ? i18n._(msg`Comparar en Sync`)
                    : i18n._(msg`Ejecutar Sincronización`)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
