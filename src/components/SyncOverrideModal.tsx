import React, { useState, useEffect, useCallback } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
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
import { WorkspaceStoreState } from '../services/workspaceService';
import { getSanityConfig } from '../services/sanityService';

interface SyncOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceStore: WorkspaceStoreState;
  onUpdateWorkspaceStore: (store: WorkspaceStoreState) => void;
  onShowToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
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
  const [filterType, setFilterType] = useState<'all' | 'pending' | 'conflicts' | 'synced'>('all');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [deleteScope, setDeleteScope] = useState<'local' | 'remote' | 'both'>('local');

  const [sanityConfig, setSanityConfig] = useState(getSanityConfig());
  const isSanityConfigured = Boolean(sanityConfig.projectId && sanityConfig.dataset);

  useEffect(() => {
    const updateConfig = () => setSanityConfig(getSanityConfig());
    updateConfig();
    window.addEventListener('antask_sanity_config_updated', updateConfig);
    return () => window.removeEventListener('antask_sanity_config_updated', updateConfig);
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const res = await analyzeSyncDifferences(workspaceStore);
      setResult(res);
      if (res.hasPendingChanges) {
        const count = res.counts.localOverrides + res.counts.remoteOverrides + res.counts.conflicts;
        onShowToast(i18n._(msg`Detección completada: ${count} overrides/diferencias encontrados`), 'info');
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

  if (!isOpen) return null;

  const handleResolveSingle = async (
    item: SyncItemDiff,
    strategy: 'keep_local' | 'keep_remote' | 'merge'
  ) => {
    setResolvingItemId(item.id);
    try {
      const res = await resolveSyncItem(item, strategy, workspaceStore);
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

  const handleDeleteSingle = async (
    item: SyncItemDiff,
    scope: 'local' | 'remote' | 'both'
  ) => {
    setResolvingItemId(item.id);
    try {
      const cleanWsId = (
        item.localData?.id ||
        item.remoteData?.workspaceId ||
        item.remoteData?.id ||
        item.id.replace(/^ws_/, '')
      ).toString();

      if (item.entityType === 'workspace' && onDeleteWorkspace && (scope === 'local' || scope === 'both')) {
        onDeleteWorkspace(cleanWsId, scope === 'both');

        // Optimistically remove from result items
        setResult((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.filter((i) => i.id !== item.id),
              }
            : null
        );
        setConfirmDeleteItemId(null);

        // Compute local filtered store for re-analysis so it does not re-detect the removed workspace
        const nextWorkspaces = workspaceStore.workspaces.filter(
          (w) =>
            w.id !== cleanWsId &&
            w.id !== item.id &&
            `ws_${w.id}` !== item.id &&
            w.id.replace(/^workspace-/, '') !== cleanWsId.replace(/^workspace-/, '')
        );
        const nextStore: WorkspaceStoreState = {
          ...workspaceStore,
          workspaces: nextWorkspaces,
          activeWorkspaceId:
            nextWorkspaces.find((w) => w.id === workspaceStore.activeWorkspaceId)?.id ||
            nextWorkspaces[0]?.id ||
            workspaceStore.activeWorkspaceId,
        };

        try {
          const fresh = await analyzeSyncDifferences(nextStore);
          setResult({
            ...fresh,
            items: fresh.items.filter((i) => i.id !== item.id),
          });
        } catch {
          // ignore
        }
        return;
      }

      const res = await deleteSyncItem(item, scope, workspaceStore);
      if (res.success) {
        onShowToast(res.message, 'info');
        const nextStore = res.updatedStore || workspaceStore;
        if (res.updatedStore) {
          onUpdateWorkspaceStore(res.updatedStore);
        }

        // Optimistically remove from result items
        setResult((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.filter((i) => i.id !== item.id),
              }
            : null
        );
        setConfirmDeleteItemId(null);

        try {
          const fresh = await analyzeSyncDifferences(nextStore);
          setResult({
            ...fresh,
            items: fresh.items.filter((i) => i.id !== item.id),
          });
        } catch {
          // ignore
        }
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error al eliminar elemento', 'error');
    } finally {
      setResolvingItemId(null);
    }
  };

  const handleBatchSyncAction = async (mode: 'smart' | 'push_all' | 'pull_all') => {
    if (!result) return;
    setIsProcessing(true);
    try {
      const res = await executeBatchSync(result.items, mode, workspaceStore);
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
    if (filterType === 'pending') {
      return item.diffType !== 'synced';
    }
    if (filterType === 'conflicts') {
      return item.diffType === 'conflict' || item.diffType === 'remote_override';
    }
    if (filterType === 'synced') {
      return item.diffType === 'synced';
    }
    return true;
  });

  const getDiffBadge = (diffType: SyncDifferenceType) => {
    switch (diffType) {
      case 'synced':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 shadow-xs"
            title={i18n._(msg`Totalmente sincronizado e idéntico entre local y Sanity Cloud`)}
          >
            <span className="material-symbols-outlined text-[13px] text-emerald-400">check_circle</span>
            <span>{i18n._(msg`Sincronizado`)}</span>
          </span>
        );
      case 'local_override':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-950/60 text-sky-300 border border-sky-800/80 shadow-xs"
            title={i18n._(msg`El estado local es más reciente. Pendiente de subir a Sanity Cloud.`)}
          >
            <span className="material-symbols-outlined text-[13px] text-sky-400">arrow_upward</span>
            <span>{i18n._(msg`Local más reciente`)}</span>
            <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-sky-900/60 text-sky-200 border border-sky-700/60">
              Local → Cloud
            </span>
          </span>
        );
      case 'remote_override':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/80 shadow-xs"
            title={i18n._(msg`El estado en Sanity Cloud es más reciente. Pendiente de descargar a local.`)}
          >
            <span className="material-symbols-outlined text-[13px] text-amber-400">arrow_downward</span>
            <span>{i18n._(msg`Remoto más reciente`)}</span>
            <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-amber-900/60 text-amber-200 border border-amber-700/60">
              Cloud → Local
            </span>
          </span>
        );
      case 'conflict':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/60 text-rose-300 border border-rose-800/80 shadow-xs"
            title={i18n._(msg`Conflicto detectado: modificaciones divergentes en local y Sanity Cloud.`)}
          >
            <span className="material-symbols-outlined text-[13px] text-rose-400">sync_problem</span>
            <span>{i18n._(msg`Conflicto detectado`)}</span>
            <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-rose-900/60 text-rose-200 border border-rose-700/60">
              Divergente
            </span>
          </span>
        );
      case 'only_local':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-950/60 text-indigo-300 border border-indigo-800/80 shadow-xs"
            title={i18n._(msg`Existe únicamente en local. No ha sido subido a Sanity Cloud.`)}
          >
            <span className="material-symbols-outlined text-[13px] text-indigo-400">add_circle</span>
            <span>{i18n._(msg`Solo local`)}</span>
            <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-indigo-900/60 text-indigo-200 border border-indigo-700/60">
              Nuevo
            </span>
          </span>
        );
      case 'only_remote':
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-950/60 text-purple-300 border border-purple-800/80 shadow-xs"
            title={i18n._(msg`Existe en Sanity Cloud pero no ha sido descargado localmente.`)}
          >
            <span className="material-symbols-outlined text-[13px] text-purple-400">cloud_download</span>
            <span>{i18n._(msg`Solo remoto`)}</span>
            <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-purple-900/60 text-purple-200 border border-purple-700/60">
              Por descargar
            </span>
          </span>
        );
    }
  };

  return (
    <div
      id="modal-sync-override-overlay"
      className="fixed inset-0 z-[65] flex items-center justify-center p-2 sm:p-4 bg-black/75 animate-fade-in"
    >
      <div
        id="modal-sync-override-dialog"
        className="w-full max-w-4xl bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md flex flex-col overflow-hidden max-h-[92vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div id="div-syncoverridemodal-1" className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[var(--outline)] bg-[var(--surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div id="div-syncoverridemodal-2" className="flex items-center gap-2.5 min-w-0">
            <div id="div-syncoverridemodal-3" className="w-7 h-7 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-xs shadow-xs shrink-0">
              S
            </div>
            <div id="div-sync-modal-header-info" className="min-w-0">
              <h2 id="sync-modal-title" className="text-sm font-semibold text-[var(--on-surface)] flex items-center gap-2 flex-wrap">
                <span>{i18n._(msg`Sincronización & Detección de Overrides`)}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] border border-[var(--outline)]">
                  Sanity Cloud
                </span>
              </h2>
              <p className="text-[11px] text-[var(--on-surface-variant)] truncate">
                {i18n._(msg`Dataset`)}: <span className="font-mono text-[var(--on-surface)]">{sanityConfig.dataset || 'production'}</span> • {i18n._(msg`Proyecto`)}: <span className="font-mono text-[var(--on-surface)]">{sanityConfig.projectId || i18n._(msg`No conectado`)}</span>
              </p>
            </div>
          </div>

          <div id="div-syncoverridemodal-4" className="flex items-center gap-2 flex-wrap self-end sm:self-auto shrink-0">
            <button
              id="btn-sync-open-sanity-config"
              type="button"
              onClick={onOpenSanityConfig}
              className={`btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer ${
                !isSanityConfigured ? 'text-amber-400 border-amber-500/40 bg-amber-950/30' : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
              title={i18n._(msg`Configurar credenciales, proyecto y perfiles de Sanity`)}
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
              title={i18n._(msg`Volver a analizar diferencias entre Local y Sanity`)}
            >
              <span className={`material-symbols-outlined text-[15px] ${isAnalyzing ? 'animate-spin' : ''}`}>
                refresh
              </span>
              <span>{isAnalyzing ? i18n._(msg`Analizando...`) : i18n._(msg`Re-analizar`)}</span>
            </button>
            <button id="btn-syncoverridemodal-1" type="button" onClick={onClose} className="btn-m3-icon w-7 h-7 cursor-pointer" title={i18n._(msg`Cerrar`)}>
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Status Summary & Quick Batch Actions */}
        <div id="div-syncoverridemodal-5" className="px-4 py-3 bg-[var(--surface-container-low)] border-b border-[var(--outline)] flex flex-col gap-3">
          {/* Stat Counters */}
          <div id="div-syncoverridemodal-6" className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
            <div id="div-syncoverridemodal-7" className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col justify-between">
              <span className="text-[10px] text-[var(--on-surface-variant)] flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">inventory_2</span>
                <span className="truncate">{i18n._(msg`Total Analizados`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-[var(--on-surface)] mt-1">
                {result?.counts.total || 0}
              </span>
            </div>

            <div id="div-syncoverridemodal-8" className="p-2 rounded bg-[var(--surface)] border border-emerald-900/30 flex flex-col justify-between">
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">check_circle</span>
                <span className="truncate">{i18n._(msg`Sincronizados`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-emerald-400 mt-1">
                {result?.counts.synced || 0}
              </span>
            </div>

            <div id="div-syncoverridemodal-9" className="p-2 rounded bg-[var(--surface)] border border-sky-900/30 flex flex-col justify-between">
              <span className="text-[10px] text-sky-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                <span className="truncate">{i18n._(msg`Local Overrides`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-sky-400 mt-1">
                {result?.counts.localOverrides || 0}
              </span>
            </div>

            <div id="div-syncoverridemodal-10" className="p-2 rounded bg-[var(--surface)] border border-amber-900/30 flex flex-col justify-between">
              <span className="text-[10px] text-amber-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                <span className="truncate">{i18n._(msg`Remote Overrides`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-amber-400 mt-1">
                {result?.counts.remoteOverrides || 0}
              </span>
            </div>

            <div id="div-syncoverridemodal-11" className="p-2 rounded bg-[var(--surface)] border border-rose-900/30 flex flex-col justify-between">
              <span className="text-[10px] text-rose-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">sync_problem</span>
                <span className="truncate">{i18n._(msg`Conflictos`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-rose-400 mt-1">
                {result?.counts.conflicts || 0}
              </span>
            </div>

            <div id="div-syncoverridemodal-12" className="p-2 rounded bg-[var(--surface)] border border-purple-900/30 flex flex-col justify-between">
              <span className="text-[10px] text-purple-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">difference</span>
                <span className="truncate">{i18n._(msg`Nuevos/Únicos`)}</span>
              </span>
              <span className="text-base font-semibold font-mono text-purple-400 mt-1">
                {(result?.counts.onlyLocal || 0) + (result?.counts.onlyRemote || 0)}
              </span>
            </div>
          </div>

          {/* Batch Actions Toolbar */}
          <div id="div-syncoverridemodal-13" className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Filter Tabs */}
            <div id="div-syncoverridemodal-14" className="flex items-center gap-1 bg-[var(--surface)] p-0.5 rounded border border-[var(--outline)] text-xs overflow-x-auto max-w-full">
              <button
                id="btn-sync-filter-all"
                type="button"
                onClick={() => setFilterType('all')}
                className={`px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                  filterType === 'all'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">list</span>
                <span>{i18n._(msg`Todos`)} ({result?.items.length || 0})</span>
              </button>
              <button
                id="btn-sync-filter-pending"
                type="button"
                onClick={() => setFilterType('pending')}
                className={`px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                  filterType === 'pending'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">change_circle</span>
                <span>{i18n._(msg`Con Diferencias`)} ({(result?.counts.total || 0) - (result?.counts.synced || 0)})</span>
              </button>
              <button
                id="btn-sync-filter-conflicts"
                type="button"
                onClick={() => setFilterType('conflicts')}
                className={`px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                  filterType === 'conflicts'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">warning</span>
                <span>{i18n._(msg`Conflictos & Remoto`)} ({(result?.counts.conflicts || 0) + (result?.counts.remoteOverrides || 0)})</span>
              </button>
              <button
                id="btn-sync-filter-synced"
                type="button"
                onClick={() => setFilterType('synced')}
                className={`px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                  filterType === 'synced'
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">check_circle</span>
                <span>{i18n._(msg`Al Día`)} ({result?.counts.synced || 0})</span>
              </button>
            </div>

            {/* Batch execution buttons */}
            <div id="div-syncoverridemodal-15" className="flex items-center gap-2">
              <button
                id="btn-sync-batch-smart"
                type="button"
                disabled={isProcessing || !result?.hasPendingChanges || !isSanityConfigured}
                onClick={() => handleBatchSyncAction('smart')}
                className="btn-m3-primary px-3 py-1 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shadow-xs"
                title={i18n._(msg`Resuelve automáticamente aplicando los cambios más recientes en ambas direcciones`)}
              >
                <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
                <span>{i18n._(msg`Sincronización Inteligente`)}</span>
              </button>

              <button
                id="btn-sync-batch-push-all"
                type="button"
                disabled={isProcessing || !result?.hasPendingChanges || !isSanityConfigured}
                onClick={() => handleBatchSyncAction('push_all')}
                className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-40"
                title={i18n._(msg`Sobrescribe Sanity con el estado local de todos los workspaces`)}
              >
                <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
                <span>{i18n._(msg`Subir Todo (Override Remoto)`)}</span>
              </button>

              <button
                id="btn-sync-batch-pull-all"
                type="button"
                disabled={isProcessing || !result?.hasPendingChanges || !isSanityConfigured}
                onClick={() => handleBatchSyncAction('pull_all')}
                className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-40"
                title={i18n._(msg`Sobrescribe el estado local con los datos almacenados en Sanity`)}
              >
                <span className="material-symbols-outlined text-[14px]">cloud_download</span>
                <span>{i18n._(msg`Descargar Todo (Override Local)`)}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Diff List */}
        <div id="div-syncoverridemodal-16" className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
          {filteredItems.length === 0 ? (
            <div id="div-syncoverridemodal-17" className="p-8 text-center text-[var(--on-surface-variant)] flex flex-col items-center justify-center gap-2">
              <span className="material-symbols-outlined text-4xl text-emerald-400">check_circle</span>
              <p className="text-sm font-medium text-[var(--on-surface)]">
                {filterType === 'pending'
                  ? i18n._(msg`No hay diferencias pendientes en esta vista`)
                  : i18n._(msg`Todos los elementos analizados están en sincronía`)}
              </p>
              <p className="text-xs">
                {i18n._(msg`Los workspaces y tareas coinciden exactamente entre el almacenamiento local y Sanity Cloud.`)}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isExpanded = expandedItemId === item.id;
              const isResolving = resolvingItemId === item.id;

              const localMs = item.localTimestamp ? new Date(item.localTimestamp).getTime() : 0;
              const remoteMs = item.remoteTimestamp ? new Date(item.remoteTimestamp).getTime() : 0;
              const isLocalNewer = localMs > 0 && remoteMs > 0 && localMs > remoteMs + 1000;
              const isRemoteNewer = localMs > 0 && remoteMs > 0 && remoteMs > localMs + 1000;

              return (
                <div
                  key={item.id}
                  id={`div-sync-item-${item.id}`}
                  className={`border rounded-md transition-colors shrink-0 overflow-visible min-h-fit ${
                    item.diffType === 'conflict'
                      ? 'border-rose-800/60 bg-rose-950/10'
                      : item.diffType === 'remote_override'
                      ? 'border-amber-800/60 bg-amber-950/10'
                      : item.diffType === 'local_override'
                      ? 'border-sky-800/60 bg-sky-950/10'
                      : item.diffType === 'only_local'
                      ? 'border-indigo-800/60 bg-indigo-950/10'
                      : item.diffType === 'only_remote'
                      ? 'border-purple-800/60 bg-purple-950/10'
                      : 'border-[var(--outline)] bg-[var(--surface)] hover:border-emerald-800/40'
                  }`}
                >
                  {/* Item Row Header */}
                  <div id="div-syncoverridemodal-18" className="p-3 flex items-start justify-between gap-3">
                    <div id="div-syncoverridemodal-19" className="flex items-start gap-2.5 min-w-0 flex-1">
                      {/* Leading Entity & Status Avatar */}
                      <div
                        className={`w-8 h-8 rounded flex items-center justify-center shrink-0 border relative mt-0.5 ${
                          item.diffType === 'conflict'
                            ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                            : item.diffType === 'remote_override'
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                            : item.diffType === 'local_override'
                            ? 'bg-sky-950/40 border-sky-800/60 text-sky-300'
                            : item.diffType === 'only_local'
                            ? 'bg-indigo-950/40 border-indigo-800/60 text-indigo-300'
                            : item.diffType === 'only_remote'
                            ? 'bg-purple-950/40 border-purple-800/60 text-purple-300'
                            : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400'
                        }`}
                        title={
                          item.entityType === 'workspace'
                            ? i18n._(msg`Elemento: Workspace`)
                            : i18n._(msg`Elemento: Tarea individual`)
                        }
                      >
                        <span className="material-symbols-outlined text-[17px]">
                          {item.entityType === 'workspace' ? 'folder' : 'task_alt'}
                        </span>
                        <span
                          className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] bg-[var(--surface-container)] border border-[var(--outline)] shadow-xs"
                          title={
                            item.diffType === 'synced'
                              ? i18n._(msg`Sincronizado`)
                              : item.diffType === 'local_override'
                              ? i18n._(msg`Local más reciente`)
                              : item.diffType === 'remote_override'
                              ? i18n._(msg`Remoto más reciente`)
                              : item.diffType === 'conflict'
                              ? i18n._(msg`Conflicto`)
                              : item.diffType === 'only_local'
                              ? i18n._(msg`Solo en local`)
                              : i18n._(msg`Solo en remoto`)
                          }
                        >
                          <span className="material-symbols-outlined text-[10px] leading-none">
                            {item.diffType === 'synced'
                              ? 'done'
                              : item.diffType === 'local_override'
                              ? 'arrow_upward'
                              : item.diffType === 'remote_override'
                              ? 'arrow_downward'
                              : item.diffType === 'conflict'
                              ? 'priority_high'
                              : item.diffType === 'only_local'
                              ? 'add'
                              : 'cloud'}
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-col min-w-0 flex-1">
                        <div id="div-syncoverridemodal-20" className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] border border-[var(--outline)]">
                            {item.entityType === 'workspace' ? i18n._(msg`Workspace`) : i18n._(msg`Tarea`)}
                          </span>
                          <span className="text-xs font-semibold text-[var(--on-surface)] font-sans truncate">
                            {item.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '')}
                          </span>
                          {getDiffBadge(item.diffType)}
                        </div>

                        {item.subtitle && (
                          <p className="text-xs text-[var(--on-surface-variant)] font-mono mt-0.5 truncate">
                            {item.subtitle}
                          </p>
                        )}

                        {/* Timestamps comparison */}
                        <div id={`div-sync-timestamps-${item.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-[var(--on-surface-variant)] mt-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[13px] text-sky-400">laptop</span>
                            <span>
                              {i18n._(msg`Local`)}:{' '}
                              {item.localTimestamp ? (
                                <span className="text-[var(--on-surface)]">{formatRelativeTime(item.localTimestamp)}</span>
                              ) : (
                                <span className="text-[var(--on-surface-variant)] italic">{i18n._(msg`No existe`)}</span>
                              )}
                            </span>
                            {isLocalNewer && (
                              <span className="text-[9px] font-sans font-medium px-1 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800">
                                {i18n._(msg`Más reciente`)}
                              </span>
                            )}
                          </span>

                          <span className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[13px] text-amber-400">cloud</span>
                            <span>
                              {i18n._(msg`Remoto`)}:{' '}
                              {item.remoteTimestamp ? (
                                <span className="text-[var(--on-surface)]">{formatRelativeTime(item.remoteTimestamp)}</span>
                              ) : (
                                <span className="text-[var(--on-surface-variant)] italic">{i18n._(msg`No publicado`)}</span>
                              )}
                            </span>
                            {isRemoteNewer && (
                              <span className="text-[9px] font-sans font-medium px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800">
                                {i18n._(msg`Más reciente`)}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div id="div-syncoverridemodal-22" className="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap">
                      {item.diffType !== 'synced' && (
                        <>
                          <button
                            id={`btn-sync-item-keep-local-${item.id}`}
                            type="button"
                            disabled={isResolving || !isSanityConfigured}
                            onClick={() => handleResolveSingle(item, 'keep_local')}
                            className={`px-2 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors ${
                              item.diffType === 'local_override' || item.diffType === 'only_local'
                                ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-xs'
                                : 'btn-m3-secondary text-[var(--on-surface)]'
                            }`}
                            title={i18n._(msg`Sobrescribir versión remota en Sanity con la versión local`)}
                          >
                            <span className="material-symbols-outlined text-[13px]">cloud_upload</span>
                            <span>{i18n._(msg`Subir Local`)}</span>
                          </button>

                          <button
                            id={`btn-sync-item-keep-remote-${item.id}`}
                            type="button"
                            disabled={isResolving || !isSanityConfigured || !item.remoteData}
                            onClick={() => handleResolveSingle(item, 'keep_remote')}
                            className={`px-2 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors ${
                              item.diffType === 'remote_override' || item.diffType === 'only_remote'
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-xs'
                                : 'btn-m3-secondary text-[var(--on-surface)]'
                            }`}
                            title={i18n._(msg`Sobrescribir versión local con los datos de Sanity`)}
                          >
                            <span className="material-symbols-outlined text-[13px]">cloud_download</span>
                            <span>{i18n._(msg`Bajar Remoto`)}</span>
                          </button>
                        </>
                      )}

                      <button
                        id={`btn-sync-item-delete-${item.id}`}
                        type="button"
                        disabled={isResolving || isProcessing}
                        onClick={() => {
                          if (confirmDeleteItemId === item.id) {
                            setConfirmDeleteItemId(null);
                          } else {
                            setConfirmDeleteItemId(item.id);
                            setDeleteScope(
                              item.diffType === 'only_remote'
                                ? 'remote'
                                : item.diffType === 'only_local'
                                ? 'local'
                                : 'local'
                            );
                          }
                        }}
                        className={`btn-m3-icon w-7 h-7 cursor-pointer transition-colors ${
                          confirmDeleteItemId === item.id
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-800'
                            : 'text-[var(--on-surface-variant)] hover:text-rose-400 hover:bg-rose-950/30'
                        }`}
                        title={i18n._(msg`Eliminar elemento`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>

                      <button
                        id={`btn-sync-item-toggle-expand-${item.id}`}
                        type="button"
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        className="btn-m3-icon w-7 h-7 cursor-pointer"
                        title={isExpanded ? i18n._(msg`Ocultar detalles de diferencias`) : i18n._(msg`Ver detalle de cambios`)}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {isExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Inline Delete Confirmation Bar */}
                  {confirmDeleteItemId === item.id && (
                    <div
                      id={`div-sync-item-delete-confirm-${item.id}`}
                      className="px-3.5 py-3 border-t border-rose-900/60 bg-rose-950/25 flex flex-col gap-2.5 text-xs rounded-b-md shrink-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium text-rose-300 min-w-0">
                          <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">delete</span>
                          <span className="truncate">
                            {item.diffType === 'only_local'
                              ? i18n._(msg`¿Eliminar de este equipo local?`)
                              : item.diffType === 'only_remote'
                              ? i18n._(msg`¿Eliminar de Sanity Cloud?`)
                              : i18n._(msg`¿Dónde deseas eliminar "${item.title.replace(/^(Workspace:\s*|Tarea:\s*)/, '')}"?`)}
                          </span>
                        </div>
                        {item.entityType === 'workspace' && (
                          <span className="text-[10px] text-amber-300 font-mono flex items-center gap-1 shrink-0 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/50">
                            <span className="material-symbols-outlined text-[12px]">history</span>
                            <span>{i18n._(msg`30s para deshacer`)}</span>
                          </span>
                        )}
                      </div>

                      {item.diffType !== 'only_local' && item.diffType !== 'only_remote' && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {/* Option A: Local */}
                          <button
                            type="button"
                            id={`btn-sync-delete-scope-local-${item.id}`}
                            onClick={() => setDeleteScope('local')}
                            className={`p-2 rounded-md border text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                              deleteScope === 'local'
                                ? 'border-sky-400 bg-sky-950/70 text-sky-100 ring-2 ring-sky-500/50 shadow-xs'
                                : 'border-sky-900/40 bg-sky-950/20 text-sky-300/80 hover:border-sky-700/60'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded bg-sky-900/60 border border-sky-700/60 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-[14px] text-sky-300">laptop</span>
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-xs text-sky-200">{i18n._(msg`Local`)}</span>
                                <span className="text-[10px] text-sky-300/70 leading-none">{i18n._(msg`Solo este equipo`)}</span>
                              </div>
                            </div>
                            <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">
                              {deleteScope === 'local' ? 'radio_button_checked' : 'radio_button_unchecked'}
                            </span>
                          </button>

                          {/* Option B: Sanity */}
                          <button
                            type="button"
                            id={`btn-sync-delete-scope-remote-${item.id}`}
                            onClick={() => setDeleteScope('remote')}
                            className={`p-2 rounded-md border text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                              deleteScope === 'remote'
                                ? 'border-amber-400 bg-amber-950/70 text-amber-100 ring-2 ring-amber-500/50 shadow-xs'
                                : 'border-amber-900/40 bg-amber-950/20 text-amber-300/80 hover:border-amber-700/60'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded bg-amber-900/60 border border-amber-700/60 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-[14px] text-amber-300">cloud</span>
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-xs text-amber-200">{i18n._(msg`Sanity`)}</span>
                                <span className="text-[10px] text-amber-300/70 leading-none">{i18n._(msg`Solo en la nube`)}</span>
                              </div>
                            </div>
                            <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">
                              {deleteScope === 'remote' ? 'radio_button_checked' : 'radio_button_unchecked'}
                            </span>
                          </button>

                          {/* Option C: Ambos */}
                          <button
                            type="button"
                            id={`btn-sync-delete-scope-both-${item.id}`}
                            onClick={() => setDeleteScope('both')}
                            className={`p-2 rounded-md border text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                              deleteScope === 'both'
                                ? 'border-rose-400 bg-rose-950/70 text-rose-100 ring-2 ring-rose-500/50 shadow-xs'
                                : 'border-rose-900/40 bg-rose-950/20 text-rose-300/80 hover:border-rose-700/60'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded bg-rose-900/60 border border-rose-700/60 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-[14px] text-rose-300">delete_forever</span>
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-xs text-rose-200">{i18n._(msg`Ambos`)}</span>
                                <span className="text-[10px] text-rose-300/70 leading-none">{i18n._(msg`Local + Nube`)}</span>
                              </div>
                            </div>
                            <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">
                              {deleteScope === 'both' ? 'radio_button_checked' : 'radio_button_unchecked'}
                            </span>
                          </button>
                        </div>
                      )}

                      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1 border-t border-rose-900/40">
                        <button
                          id={`btn-sync-item-cancel-delete-${item.id}`}
                          type="button"
                          onClick={() => setConfirmDeleteItemId(null)}
                          className="btn-m3-secondary px-3 py-1 text-xs cursor-pointer w-full sm:w-auto text-center"
                        >
                          {i18n._(msg`Cancelar`)}
                        </button>
                        <button
                          id={`btn-sync-item-confirm-delete-${item.id}`}
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
                          className={`px-3.5 py-1 text-xs rounded font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs w-full sm:w-auto transition-colors text-white ${
                            (item.diffType === 'only_remote' || deleteScope === 'remote')
                              ? 'bg-amber-600 hover:bg-amber-500'
                              : (item.diffType === 'only_local' || deleteScope === 'local')
                              ? 'bg-sky-600 hover:bg-sky-500'
                              : 'bg-rose-600 hover:bg-rose-500'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {(item.diffType === 'only_remote' || deleteScope === 'remote')
                              ? 'cloud_off'
                              : (item.diffType === 'only_local' || deleteScope === 'local')
                              ? 'laptop'
                              : 'delete_forever'}
                          </span>
                          <span>
                            {(item.diffType === 'only_remote' || deleteScope === 'remote')
                              ? i18n._(msg`Eliminar de Sanity`)
                              : (item.diffType === 'only_local' || deleteScope === 'local')
                              ? i18n._(msg`Eliminar de Local`)
                              : i18n._(msg`Eliminar de Ambos`)}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded Diff Viewer */}
                  {isExpanded && (
                    <div id="div-syncoverridemodal-23" className="px-3 pb-3 pt-2 border-t border-[var(--outline)] bg-[var(--surface-container-high)]/40 flex flex-col gap-2 animate-fade-in text-xs">
                      <div id="div-syncoverridemodal-24" className="font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px] text-amber-400">difference</span>
                        <span>{i18n._(msg`Cambios detectados y discrepancias:`)}</span>
                      </div>

                      <ul className="list-disc list-inside space-y-1 text-[var(--on-surface)] pl-1">
                        {item.summaryChanges.map((change, idx) => (
                          <li key={idx} className="font-mono text-[11px] text-[var(--on-surface)]">
                            {change}
                          </li>
                        ))}
                      </ul>

                      {/* Side by side preview */}
                      <div id="div-syncoverridemodal-25" className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 pt-2 border-t border-[var(--outline)]">
                        {/* Local side */}
                        <div id="div-syncoverridemodal-26" className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col">
                          <span className="font-semibold text-sky-400 text-[11px] mb-1 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">laptop</span>
                            <span>{i18n._(msg`Versión Local`)}</span>
                          </span>
                          {item.localData ? (
                            <pre className="text-[10px] font-mono text-[var(--on-surface)] overflow-x-auto p-1.5 bg-[var(--surface-container)] rounded max-h-32">
                              {JSON.stringify(
                                {
                                  name: item.localData.name || item.localData.title,
                                  branch: item.localData.activeBranchName || item.localData.groupTitle,
                                  branchesCount: item.localData.branches?.length,
                                  updatedAt: item.localData.updatedAt,
                                },
                                null,
                                2
                              )}
                            </pre>
                          ) : (
                            <span className="text-[11px] text-[var(--on-surface-variant)] italic">
                              {i18n._(msg`No existe en almacenamiento local`)}
                            </span>
                          )}
                        </div>

                        {/* Remote side */}
                        <div id="div-syncoverridemodal-27" className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col">
                          <span className="font-semibold text-amber-400 text-[11px] mb-1 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">cloud</span>
                            <span>{i18n._(msg`Versión Sanity Remote`)}</span>
                          </span>
                          {item.remoteData ? (
                            <pre className="text-[10px] font-mono text-[var(--on-surface)] overflow-x-auto p-1.5 bg-[var(--surface-container)] rounded max-h-32">
                              {JSON.stringify(
                                {
                                  _id: item.remoteData._id,
                                  _type: item.remoteData._type,
                                  name: item.remoteData.name || item.remoteData.title,
                                  branch: item.remoteData.activeBranchName || item.remoteData.groupTitle,
                                  branchesCount: item.remoteData.branches?.length,
                                  updatedAt: item.remoteData.updatedAt || item.remoteData._updatedAt,
                                },
                                null,
                                2
                              )}
                            </pre>
                          ) : (
                            <span className="text-[11px] text-[var(--on-surface-variant)] italic">
                              {i18n._(msg`No existe aún en Sanity Cloud`)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div id="div-syncoverridemodal-28" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-between">
          <span className="text-[11px] text-[var(--on-surface-variant)]">
            {result?.hasPendingChanges
              ? i18n._(msg`Existen diferencias que puedes resolver individualmente o con Sincronización Inteligente.`)
              : i18n._(msg`Todo sincronizado y al día.`)}
          </span>
          <button
            id="btn-sync-override-close-footer"
            type="button"
            onClick={onClose}
            className="btn-m3-secondary px-3.5 py-1 text-xs cursor-pointer"
          >
            {i18n._(msg`Cerrar`)}
          </button>
        </div>
      </div>
    </div>
  );
};
