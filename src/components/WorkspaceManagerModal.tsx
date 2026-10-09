import React, { useState, useMemo, useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  Workspace,
  parseGitHubRepoInput,
  TaskDocument,
  logWorkspaceTrace,
  BranchConfig,
} from '../services/workspaceService';

interface WorkspaceManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: (workspace: Workspace) => void;
  onUpdateWorkspace?: (workspace: Workspace) => void;
  onDeleteWorkspace: (id: string, deleteRemote?: boolean) => void;
  onCloneWorkspace?: (id: string) => void;
  onSelectBranch?: (workspaceId: string, branchName: string) => void;
  onCreateBranch?: (workspaceId: string, branchName: string, sourceBranchName: string | null) => void;
  onRenameBranch?: (workspaceId: string, oldBranchName: string, newBranchName: string) => void;
  onDeleteBranch?: (workspaceId: string, branchName: string) => void;
  onToggleBranchProtection?: (workspaceId: string, branchName: string) => void;
  onShowToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onSyncWorkspacesToSanity?: () => Promise<void>;
  onImportWorkspacesFromSanity?: () => Promise<void>;
  onSaveSingleWorkspaceToSanity?: (ws: Workspace) => Promise<void>;
  onOpenSyncDiffModal?: () => void;
  isSanityConfigured?: boolean;
  initialTab?: 'workspaces' | 'branches' | 'create';
  initialSelectedWorkspaceId?: string;
}

export const WorkspaceManagerModal: React.FC<WorkspaceManagerModalProps> = ({
  isOpen,
  onClose,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onCloneWorkspace,
  onSelectBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onToggleBranchProtection,
  onShowToast,
  onSyncWorkspacesToSanity,
  onImportWorkspacesFromSanity,
  onSaveSingleWorkspaceToSanity,
  onOpenSyncDiffModal,
  isSanityConfigured = false,
  initialTab = 'workspaces',
  initialSelectedWorkspaceId,
}) => {
  const { i18n } = useLingui();
  const [activeTab, setActiveTab] = useState<'workspaces' | 'branches' | 'create' | 'edit'>('workspaces');
  const [isSyncingSanity, setIsSyncingSanity] = useState<boolean>(false);
  const [isImportingSanity, setIsImportingSanity] = useState<boolean>(false);
  const [savingWsId, setSavingWsId] = useState<string | null>(null);

  // Search filter states
  const [workspaceSearch, setWorkspaceSearch] = useState<string>('');
  const [branchSearch, setBranchSearch] = useState<string>('');

  // Selected workspace for branch management tab
  const [selectedBranchWsId, setSelectedBranchWsId] = useState<string>(
    initialSelectedWorkspaceId || activeWorkspaceId || workspaces[0]?.id || ''
  );

  // Expanded branch preview in workspaces tab
  const [expandedWsPreview, setExpandedWsPreview] = useState<Record<string, boolean>>({});

  // Form state for creating new workspace
  const [name, setName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [description, setDescription] = useState('');

  // Form state for editing workspace
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editName, setEditName] = useState('');
  const [editRepoInput, setEditRepoInput] = useState('');
  const [editDefaultBranch, setEditDefaultBranch] = useState('main');
  const [editDescription, setEditDescription] = useState('');

  // Inline delete confirmation state (workspace id to delete)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteScope, setDeleteScope] = useState<'local' | 'both'>('local');
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');

  // Branch creation / rename / delete state inside Branches tab
  const [isCreatingBranch, setIsCreatingBranch] = useState<boolean>(false);
  const [newBranchName, setNewBranchName] = useState<string>('');
  const [newBranchSource, setNewBranchSource] = useState<string>('main');

  const [renamingBranchName, setRenamingBranchName] = useState<string | null>(null);
  const [renameBranchInput, setRenameBranchInput] = useState<string>('');

  const [confirmDeleteBranchName, setConfirmDeleteBranchName] = useState<string | null>(null);

  // Keep selected branch workspace valid
  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveTab(initialTab === 'workspaces' ? 'workspaces' : initialTab);
      if (initialSelectedWorkspaceId && workspaces.some((w) => w.id === initialSelectedWorkspaceId)) {
        setSelectedBranchWsId(initialSelectedWorkspaceId);
      } else if (!workspaces.some((w) => w.id === selectedBranchWsId)) {
        setSelectedBranchWsId(activeWorkspaceId || workspaces[0]?.id || '');
      }
    }
  }, [isOpen, initialTab, initialSelectedWorkspaceId, activeWorkspaceId, workspaces]);

  const targetBranchWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === selectedBranchWsId) || workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
  }, [workspaces, selectedBranchWsId, activeWorkspaceId]);

  // Filtered workspaces
  const filteredWorkspaces = useMemo(() => {
    if (!workspaceSearch.trim()) return workspaces;
    const query = workspaceSearch.toLowerCase().trim();
    return workspaces.filter(
      (ws) =>
        ws.name.toLowerCase().includes(query) ||
        ws.githubRepo?.fullName?.toLowerCase().includes(query) ||
        ws.githubRepo?.description?.toLowerCase().includes(query)
    );
  }, [workspaces, workspaceSearch]);

  // Filtered branches in current selected workspace
  const filteredBranches = useMemo(() => {
    if (!targetBranchWorkspace || !targetBranchWorkspace.branches) return [];
    if (!branchSearch.trim()) return targetBranchWorkspace.branches;
    const query = branchSearch.toLowerCase().trim();
    return targetBranchWorkspace.branches.filter(
      (b) => b.name.toLowerCase().includes(query) || b.lastCommit?.message?.toLowerCase().includes(query)
    );
  }, [targetBranchWorkspace, branchSearch]);

  if (!isOpen) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onShowToast(i18n._(msg`Por favor completa el nombre del workspace`), 'warning');
      return;
    }

    const safeRepoInput = `local/${name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'workspace'}`;
    const repoInfo = parseGitHubRepoInput(safeRepoInput);
    const wsId = 'ws_' + Date.now();
    const branchName = defaultBranch.trim() || 'main';

    const initialDocs: TaskDocument[] = [
      {
        id: `doc_root_${Date.now()}`,
        name: 'TASKS.md',
        folder: '',
        path: 'TASKS.md',
        content: `# ${name.trim()} - Tareas\n\n## Tareas Iniciales\n- [ ] Configurar entorno y estructura del proyecto\n  id: init_task_1\n  priority: P0\n- [ ] Definir arquitectura y tareas principales\n  id: init_task_2\n  priority: P1\n`,
        lastSavedContent: `# ${name.trim()} - Tareas\n\n## Tareas Iniciales\n- [ ] Configurar entorno y estructura del proyecto\n  id: init_task_1\n  priority: P0\n- [ ] Definir arquitectura y tareas principales\n  id: init_task_2\n  priority: P1\n`,
        updatedAt: new Date().toISOString(),
      },
    ];

    const newWorkspace: Workspace = {
      id: wsId,
      name: name.trim(),
      githubRepo: {
        ...repoInfo,
        defaultBranch: branchName,
        isPrivate: false,
        description: description.trim() || undefined,
      },
      activeBranchName: branchName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      branches: [
        {
          name: branchName,
          isProtected: branchName === 'main' || branchName === 'master',
          lastCommit: {
            hash: Math.random().toString(16).substring(2, 9),
            message: `chore: inicializar workspace ${name.trim()}`,
            author: 'Developer',
            timestamp: new Date().toISOString(),
          },
          activeDocumentId: initialDocs[0]?.id || 'doc_root',
          taskDocuments: initialDocs,
        },
      ],
    };

    onCreateWorkspace(newWorkspace);
    setName('');
    setDefaultBranch('main');
    setDescription('');
    setActiveTab('workspaces');
  };

  const handleConfirmDelete = (wsId: string) => {
    onDeleteWorkspace(wsId, deleteScope === 'both');
    setConfirmDeleteId(null);
    setDeleteScope('local');
    setDeleteConfirmText('');
  };

  const handleStartEdit = (ws: Workspace) => {
    setEditingWorkspace(ws);
    setEditName(ws.name || '');
    setEditRepoInput(ws.githubRepo?.fullName || ws.githubRepo?.url || '');
    setEditDefaultBranch(ws.githubRepo?.defaultBranch || ws.activeBranchName || 'main');
    setEditDescription(ws.githubRepo?.description || '');
    setActiveTab('edit');
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace) return;
    if (!editName.trim()) {
      onShowToast(i18n._(msg`Por favor completa el nombre del workspace`), 'warning');
      return;
    }

    const safeRepoInput =
      editRepoInput.trim() ||
      `local/${editName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'workspace'}`;
    const repoInfo = parseGitHubRepoInput(safeRepoInput);
    const branchName = editDefaultBranch.trim() || editingWorkspace.activeBranchName || 'main';

    const updatedWorkspace: Workspace = {
      ...editingWorkspace,
      name: editName.trim(),
      githubRepo: {
        ...editingWorkspace.githubRepo,
        ...repoInfo,
        defaultBranch: branchName,
        description: editDescription.trim() || undefined,
      },
      activeBranchName: branchName,
      updatedAt: new Date().toISOString(),
    };

    onUpdateWorkspace?.(updatedWorkspace);
    setActiveTab('workspaces');
    setEditingWorkspace(null);
  };

  const handleCreateBranchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBranchWorkspace) return;
    const cleanName = newBranchName.trim().replace(/\s+/g, '-');
    if (!cleanName) {
      onShowToast(i18n._(msg`Introduce un nombre válido de rama`), 'warning');
      return;
    }
    if (targetBranchWorkspace.branches.some((b) => b.name.toLowerCase() === cleanName.toLowerCase())) {
      onShowToast(i18n._(msg`Ya existe una rama llamada "${cleanName}"`), 'error');
      return;
    }

    onCreateBranch?.(targetBranchWorkspace.id, cleanName, newBranchSource || null);
    setNewBranchName('');
    setIsCreatingBranch(false);
  };

  const handleRenameBranchSubmit = (oldName: string) => {
    if (!targetBranchWorkspace) return;
    const cleanName = renameBranchInput.trim().replace(/\s+/g, '-');
    if (!cleanName) {
      onShowToast(i18n._(msg`El nombre de la rama no puede estar vacío`), 'warning');
      return;
    }
    if (
      cleanName.toLowerCase() !== oldName.toLowerCase() &&
      targetBranchWorkspace.branches.some((b) => b.name.toLowerCase() === cleanName.toLowerCase())
    ) {
      onShowToast(i18n._(msg`Ya existe una rama llamada "${cleanName}"`), 'error');
      return;
    }

    onRenameBranch?.(targetBranchWorkspace.id, oldName, cleanName);
    setRenamingBranchName(null);
    setRenameBranchInput('');
  };

  const togglePreview = (wsId: string) => {
    setExpandedWsPreview((prev) => ({ ...prev, [wsId]: !prev[wsId] }));
  };

  return (
    <div
      id="modal-workspace-manager-overlay"
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        id="modal-workspace-manager-dialog"
        className="w-full sm:max-w-3xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden max-h-[92vh] pb-safe sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div id="div-workspacemanagermodal-header" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0">
              workspaces
            </span>
            <h2 id="ws-manager-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans">
              {i18n._(msg`Administración de Workspaces & Ramas`)}
            </h2>
          </div>
          <button
            id="btn-workspacemanagermodal-close"
            type="button"
            onClick={onClose}
            className="btn-m3-icon w-7 h-7 cursor-pointer"
            aria-label={i18n._(msg`Cerrar`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Tab switcher */}
        <div id="div-workspacemanagermodal-tabs" className="flex border-b border-[var(--outline)] px-2 sm:px-4 bg-[var(--surface)] overflow-x-auto no-scrollbar gap-1 shrink-0">
          <button
            id="btn-workspace-tab-list"
            type="button"
            onClick={() => {
              setActiveTab('workspaces');
              setEditingWorkspace(null);
            }}
            className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'workspaces'
                ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">source</span>
            <span>{i18n._(msg`Workspaces`)}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] font-mono">
              {workspaces.length}
            </span>
          </button>

          <button
            id="btn-workspace-tab-branches"
            type="button"
            onClick={() => {
              setActiveTab('branches');
              setEditingWorkspace(null);
            }}
            className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'branches'
                ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px] text-sky-400">fork_right</span>
            <span>{i18n._(msg`Ramas`)}</span>
            {targetBranchWorkspace && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface-container-high)] text-sky-300 font-mono">
                {targetBranchWorkspace.branches.length}
              </span>
            )}
          </button>

          <button
            id="btn-workspace-tab-create"
            type="button"
            onClick={() => {
              setActiveTab('create');
              setEditingWorkspace(null);
            }}
            className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 ${
              activeTab === 'create'
                ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            <span>{i18n._(msg`Nuevo Workspace`)}</span>
          </button>

          {editingWorkspace && (
            <button
              id="btn-workspace-tab-edit"
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
                activeTab === 'edit'
                  ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                  : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">edit</span>
              <span>{i18n._(msg`Editar`)}: {editingWorkspace.name}</span>
            </button>
          )}
        </div>

        {/* Content */}
        <div id="div-workspacemanagermodal-content" className="p-3 sm:p-4 overflow-y-auto max-h-[calc(92vh-115px)] sm:max-h-[70vh]">
          {/* TAB 1: WORKSPACES */}
          {activeTab === 'workspaces' && (
            <div className="flex flex-col gap-3">
              {/* Search & Cloud Persistence Bar */}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-[var(--on-surface-variant)]">
                    search
                  </span>
                  <input
                    type="text"
                    id="input-search-workspaces"
                    value={workspaceSearch}
                    onChange={(e) => setWorkspaceSearch(e.target.value)}
                    placeholder={i18n._(msg`Buscar workspace por nombre o repositorio...`)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] focus:outline-none"
                  />
                  {workspaceSearch && (
                    <button
                      type="button"
                      onClick={() => setWorkspaceSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 justify-end">
                  {onOpenSyncDiffModal && (
                    <button
                      id="btn-ws-sync-diff-modal"
                      type="button"
                      disabled={!isSanityConfigured}
                      onClick={onOpenSyncDiffModal}
                      className="btn-m3-primary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                      title={i18n._(msg`Analizar y resolver diferencias, overrides y conflictos con Sanity Cloud`)}
                    >
                      <span className="material-symbols-outlined text-[14px]">sync_problem</span>
                      <span>{i18n._(msg`Overrides`)}</span>
                    </button>
                  )}

                  {onSyncWorkspacesToSanity && (
                    <button
                      id="btn-ws-sync-sanity"
                      type="button"
                      disabled={isSyncingSanity || !isSanityConfigured}
                      onClick={async () => {
                        setIsSyncingSanity(true);
                        try {
                          await onSyncWorkspacesToSanity();
                        } finally {
                          setIsSyncingSanity(false);
                        }
                      }}
                      className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title={i18n._(msg`Guardar todos los workspaces en Sanity Cloud`)}
                    >
                      <span className={`material-symbols-outlined text-[14px] ${isSyncingSanity ? 'animate-spin' : ''}`}>
                        {isSyncingSanity ? 'refresh' : 'cloud_upload'}
                      </span>
                      <span>{isSyncingSanity ? i18n._(msg`Guardando...`) : i18n._(msg`Guardar`)}</span>
                    </button>
                  )}

                  {onImportWorkspacesFromSanity && (
                    <button
                      id="btn-ws-import-sanity"
                      type="button"
                      disabled={isImportingSanity || !isSanityConfigured}
                      onClick={async () => {
                        setIsImportingSanity(true);
                        try {
                          await onImportWorkspacesFromSanity();
                        } finally {
                          setIsImportingSanity(false);
                        }
                      }}
                      className="btn-m3-secondary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title={i18n._(msg`Cargar workspaces remotos desde Sanity Cloud`)}
                    >
                      <span className={`material-symbols-outlined text-[14px] ${isImportingSanity ? 'animate-spin' : ''}`}>
                        {isImportingSanity ? 'refresh' : 'cloud_download'}
                      </span>
                      <span>{isImportingSanity ? i18n._(msg`Cargando...`) : i18n._(msg`Cargar`)}</span>
                    </button>
                  )}
                </div>
              </div>

              {filteredWorkspaces.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--on-surface-variant)] bg-[var(--surface)] border border-[var(--outline)] rounded-md">
                  {i18n._(msg`No se encontraron workspaces que coincidan con la búsqueda.`)}
                </div>
              ) : (
                filteredWorkspaces.map((ws) => {
                  const isActive = ws.id === activeWorkspaceId;
                  const totalDocs = (ws.branches || []).reduce(
                    (acc, b) => acc + (b.taskDocuments?.length || 0),
                    0
                  );
                  const isConfirmingThis = confirmDeleteId === ws.id;
                  const isPreviewExpanded = Boolean(expandedWsPreview[ws.id]);

                  return (
                    <div
                      key={ws.id}
                      id={`div-workspace-card-${ws.id}`}
                      className={`p-3 rounded-md border transition-all flex flex-col gap-2.5 ${
                        isActive
                          ? 'bg-[var(--primary-container)]/20 border-[var(--primary)]'
                          : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--outline-variant)]'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-3">
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-sm font-semibold text-[var(--on-surface)] font-sans truncate">
                              {ws.name}
                            </span>
                            {isActive && (
                              <span className="px-1.5 py-0.2 rounded bg-[var(--primary)] text-[var(--on-primary)] text-[10px] font-mono">
                                {i18n._(msg`Activo`)}
                              </span>
                            )}
                          </div>

                          {ws.githubRepo?.description && (
                            <p className="text-xs text-[var(--on-surface-variant)] mt-1 line-clamp-2">
                              {ws.githubRepo.description}
                            </p>
                          )}

                          {/* Stats & Quick Preview Switch */}
                          <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--on-surface-variant)] mt-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => togglePreview(ws.id)}
                              className="flex items-center gap-1 text-sky-400 hover:underline cursor-pointer"
                              title={i18n._(msg`Ver ramas de este workspace`)}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {isPreviewExpanded ? 'expand_less' : 'fork_right'}
                              </span>
                              <span>{ws.branches.length} {i18n._(msg`Ramas`).toLowerCase()} ({ws.activeBranchName})</span>
                            </button>
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px] text-amber-400">description</span>
                              <span>{totalDocs} Task MD</span>
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap self-end sm:self-start mt-1 sm:mt-0">
                          {/* Branch Management Shortcut */}
                          <button
                            id={`btn-ws-manage-branches-${ws.id}`}
                            type="button"
                            onClick={() => {
                              setSelectedBranchWsId(ws.id);
                              setActiveTab('branches');
                            }}
                            className="btn-m3-secondary px-2 py-1 text-xs flex items-center gap-1 cursor-pointer"
                            title={i18n._(msg`Gestionar ramas de este workspace`)}
                          >
                            <span className="material-symbols-outlined text-[13px] text-sky-400">fork_right</span>
                            <span>{i18n._(msg`Ramas`)}</span>
                          </button>

                          {/* Clone Workspace */}
                          {onCloneWorkspace && (
                            <button
                              id={`btn-ws-clone-${ws.id}`}
                              type="button"
                              onClick={() => onCloneWorkspace(ws.id)}
                              className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-emerald-400 cursor-pointer"
                              title={i18n._(msg`Clonar este workspace`)}
                            >
                              <span className="material-symbols-outlined text-[15px]">content_copy</span>
                            </button>
                          )}

                          {onSaveSingleWorkspaceToSanity && isSanityConfigured && (
                            <button
                              id={`btn-ws-save-sanity-${ws.id}`}
                              type="button"
                              disabled={savingWsId === ws.id}
                              onClick={async () => {
                                setSavingWsId(ws.id);
                                try {
                                  await onSaveSingleWorkspaceToSanity(ws);
                                } finally {
                                  setSavingWsId(null);
                                }
                              }}
                              className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-emerald-400 cursor-pointer"
                              title={i18n._(msg`Guardar este workspace en Sanity`)}
                            >
                              <span className={`material-symbols-outlined text-[15px] ${savingWsId === ws.id ? 'animate-spin' : ''}`}>
                                {savingWsId === ws.id ? 'refresh' : 'cloud_upload'}
                              </span>
                            </button>
                          )}

                          {onUpdateWorkspace && (
                            <button
                              id={`btn-ws-edit-${ws.id}`}
                              type="button"
                              onClick={() => handleStartEdit(ws)}
                              className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-sky-400 cursor-pointer"
                              title={i18n._(msg`Editar workspace`)}
                            >
                              <span className="material-symbols-outlined text-[15px]">edit</span>
                            </button>
                          )}

                          {!isActive && (
                            <button
                              id={`btn-ws-open-${ws.id}`}
                              type="button"
                              onClick={() => {
                                logWorkspaceTrace(`Clic en Abrir Workspace desde Modal: "${ws.name}" (${ws.id})`);
                                onSelectWorkspace(ws.id);
                                onClose();
                              }}
                              className="btn-m3-secondary px-2.5 py-1 text-xs cursor-pointer"
                            >
                              {i18n._(msg`Abrir`)}
                            </button>
                          )}

                          <button
                            id={`btn-ws-delete-trigger-${ws.id}`}
                            type="button"
                            onClick={() => {
                              if (isConfirmingThis) {
                                setConfirmDeleteId(null);
                                setDeleteScope('local');
                                setDeleteConfirmText('');
                              } else {
                                setConfirmDeleteId(ws.id);
                                setDeleteScope('local');
                                setDeleteConfirmText('');
                              }
                            }}
                            className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer"
                            title={i18n._(msg`Eliminar workspace`)}
                          >
                            <span className="material-symbols-outlined text-[15px]">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Collapsible Branches Preview */}
                      {isPreviewExpanded && (
                        <div className="mt-1 p-2 bg-[var(--surface-container-high)]/40 border border-[var(--outline)] rounded text-xs animate-fade-in flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--on-surface-variant)]">
                            <span>{i18n._(msg`Ramas de este workspace:`)}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBranchWsId(ws.id);
                                setActiveTab('branches');
                              }}
                              className="text-sky-400 hover:underline cursor-pointer"
                            >
                              {i18n._(msg`Abrir en Administrador de Ramas`)} →
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {ws.branches.map((b) => (
                              <div
                                key={b.name}
                                className={`p-1.5 rounded border text-xs flex items-center justify-between ${
                                  b.name === ws.activeBranchName
                                    ? 'bg-sky-950/30 border-sky-600/40 text-sky-200'
                                    : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface-variant)]'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="material-symbols-outlined text-[13px] text-sky-400">fork_right</span>
                                  <span className="font-mono truncate">{b.name}</span>
                                  {b.isProtected && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300">
                                      lock
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0">
                                  {b.taskDocuments?.length || 0} doc{b.taskDocuments?.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Inline Delete Confirmation */}
                      {isConfirmingThis && (
                        <div
                          id={`div-ws-delete-confirm-box-${ws.id}`}
                          className="mt-2 p-2.5 sm:p-3 rounded-md bg-[var(--surface-container-high)]/60 border border-rose-800/40 flex flex-col gap-2.5 animate-fade-in text-xs"
                        >
                          <div className="flex items-center gap-2 text-rose-300 font-semibold flex-wrap">
                            <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">warning</span>
                            <span className="break-words">{i18n._(msg`Eliminar workspace`)}: "{ws.name}"</span>
                          </div>

                          {isSanityConfigured ? (
                            <div className="flex flex-col gap-2">
                              <span className="text-[11px] font-medium text-[var(--on-surface-variant)]">
                                {i18n._(msg`Selecciona el alcance de la eliminación:`)}
                              </span>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  id={`btn-delete-scope-local-${ws.id}`}
                                  onClick={() => {
                                    setDeleteScope('local');
                                    setDeleteConfirmText('');
                                  }}
                                  className={`p-2.5 rounded-md border text-left flex flex-col gap-1 transition cursor-pointer ${
                                    deleteScope === 'local'
                                      ? 'border-sky-500 bg-sky-950/30 text-[var(--on-surface)] ring-1 ring-sky-500/50'
                                      : 'border-[var(--outline)] bg-[var(--surface)] text-[var(--on-surface-variant)] hover:border-[var(--outline-variant)]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 font-semibold text-xs text-[var(--on-surface)]">
                                      <span className="material-symbols-outlined text-[15px] text-sky-400">devices</span>
                                      <span>{i18n._(msg`Solo en este equipo`)}</span>
                                    </div>
                                    {deleteScope === 'local' && (
                                      <span className="material-symbols-outlined text-[16px] text-sky-400">check_circle</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-[var(--on-surface-variant)] leading-tight">
                                    {i18n._(msg`Se borra de este navegador. La copia en Sanity Cloud queda protegida para poder restaurarla.`)}
                                  </p>
                                </button>

                                <button
                                  type="button"
                                  id={`btn-delete-scope-both-${ws.id}`}
                                  onClick={() => {
                                    setDeleteScope('both');
                                    setDeleteConfirmText('');
                                  }}
                                  className={`p-2.5 rounded-md border text-left flex flex-col gap-1 transition cursor-pointer ${
                                    deleteScope === 'both'
                                      ? 'border-rose-500 bg-rose-950/40 text-rose-200 ring-1 ring-rose-500/50'
                                      : 'border-[var(--outline)] bg-[var(--surface)] text-[var(--on-surface-variant)] hover:border-rose-900/50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 font-semibold text-xs text-rose-300">
                                      <span className="material-symbols-outlined text-[15px] text-rose-400">cloud_off</span>
                                      <span>{i18n._(msg`Local y Sanity Cloud`)}</span>
                                    </div>
                                    {deleteScope === 'both' && (
                                      <span className="material-symbols-outlined text-[16px] text-rose-400">check_circle</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-rose-300/80 leading-tight">
                                    {i18n._(msg`Destrucción definitiva. Se programa la eliminación permanente tras 30s (con opción de deshacer).`)}
                                  </p>
                                </button>
                              </div>

                              {deleteScope === 'both' && (
                                <div className="mt-1 p-2.5 rounded-md bg-rose-950/40 border border-rose-600/50 flex flex-col gap-2 animate-fade-in">
                                  <div className="flex items-center gap-1.5 text-rose-300 font-bold text-xs">
                                    <span className="material-symbols-outlined text-[15px] text-rose-400 shrink-0">gpp_bad</span>
                                    <span>{i18n._(msg`Verificación de seguridad requerida`)}</span>
                                  </div>
                                  <p className="text-[11px] text-rose-200/90 leading-tight">
                                    {i18n._(msg`Para confirmar la destrucción total (con 30 segundos para revertir), escribe el nombre del workspace:`)}
                                  </p>
                                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                    <span className="px-2 py-1 rounded bg-black/40 border border-rose-800/60 font-mono text-xs text-rose-200 select-all shrink-0 text-center sm:text-left truncate max-w-full">
                                      {ws.name}
                                    </span>
                                    <input
                                      type="text"
                                      id={`input-verify-delete-name-${ws.id}`}
                                      value={deleteConfirmText}
                                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                                      placeholder={i18n._(msg`Escribe el nombre aquí`)}
                                      className="flex-1 min-w-0 bg-black/50 border border-rose-600/60 focus:border-rose-400 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none w-full"
                                      autoFocus
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                              {i18n._(
                                msg`Esta acción eliminará el workspace de tu almacenamiento local en este dispositivo.`
                              )}
                            </p>
                          )}

                          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1.5 border-t border-[var(--outline)]">
                            <button
                              id={`btn-ws-cancel-delete-${ws.id}`}
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                setDeleteScope('local');
                                setDeleteConfirmText('');
                              }}
                              className="btn-m3-text px-3 py-1.5 text-xs cursor-pointer w-full sm:w-auto text-center"
                            >
                              {i18n._(msg`Cancelar`)}
                            </button>
                            <button
                              id={`btn-ws-confirm-delete-${ws.id}`}
                              type="button"
                              disabled={
                                deleteScope === 'both' &&
                                deleteConfirmText.trim().toLowerCase() !== ws.name.trim().toLowerCase()
                              }
                              onClick={() => handleConfirmDelete(ws.id)}
                              className={`px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center justify-center gap-1.5 w-full sm:w-auto ${
                                deleteScope === 'both'
                                  ? deleteConfirmText.trim().toLowerCase() === ws.name.trim().toLowerCase()
                                    ? 'bg-rose-700 hover:bg-rose-800 text-white'
                                    : 'bg-rose-900/30 text-rose-400/40 cursor-not-allowed border border-rose-800/40'
                                  : 'bg-rose-700 hover:bg-rose-800 text-white'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {deleteScope === 'both' ? 'delete_forever' : 'delete'}
                              </span>
                              <span>
                                {deleteScope === 'both'
                                  ? i18n._(msg`Destruir definitivamente`)
                                  : i18n._(msg`Eliminar de este equipo`)}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: RAMAS (BRANCHES) */}
          {activeTab === 'branches' && (
            <div className="flex flex-col gap-3">
              {/* Workspace Selector for Branch Management */}
              <div className="p-2.5 rounded-md bg-[var(--surface)] border border-[var(--outline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">
                    fork_right
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                      {i18n._(msg`Workspace a administrar:`)}
                    </span>
                    <select
                      id="select-branch-workspace-target"
                      value={selectedBranchWsId}
                      onChange={(e) => setSelectedBranchWsId(e.target.value)}
                      className="bg-[var(--surface-container-high)] text-xs font-semibold text-[var(--on-surface)] rounded px-2 py-1 border border-[var(--outline)] focus:border-[var(--primary)] focus:outline-none cursor-pointer"
                    >
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} {w.id === activeWorkspaceId ? `(${i18n._(msg`Activo`)})` : ''} - {w.branches.length} {i18n._(msg`ramas`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    id="btn-trigger-create-branch-inline"
                    type="button"
                    onClick={() => {
                      setIsCreatingBranch((prev) => !prev);
                      setNewBranchName('');
                      setNewBranchSource(targetBranchWorkspace?.branches[0]?.name || 'main');
                    }}
                    className="btn-m3-primary px-2.5 py-1 text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {isCreatingBranch ? 'close' : 'add'}
                    </span>
                    <span>{isCreatingBranch ? i18n._(msg`Cancelar`) : `+ ${i18n._(msg`Nueva Rama`)}`}</span>
                  </button>
                </div>
              </div>

              {/* Inline Create Branch Form */}
              {isCreatingBranch && (
                <form
                  onSubmit={handleCreateBranchSubmit}
                  className="p-3 bg-[var(--surface-container-high)]/60 border border-sky-600/40 rounded-md flex flex-col gap-3 animate-fade-in text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold text-sky-300">
                    <span className="material-symbols-outlined text-[15px]">add_circle</span>
                    <span>{i18n._(msg`Crear nueva rama en`)} "{targetBranchWorkspace?.name}"</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-[var(--on-surface)]">
                        {i18n._(msg`Nombre de la rama:`)}
                      </label>
                      <input
                        type="text"
                        required
                        autoFocus
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="feature/nueva-funcionalidad"
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-[var(--on-surface)]">
                        {i18n._(msg`Crear a partir de:`)}
                      </label>
                      <select
                        value={newBranchSource}
                        onChange={(e) => setNewBranchSource(e.target.value)}
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none cursor-pointer"
                      >
                        <option value="">{i18n._(msg`Empezar desde cero`)}</option>
                        {targetBranchWorkspace?.branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name} ({b.taskDocuments?.length || 0} Task MD)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--outline)]">
                    <button
                      type="button"
                      onClick={() => setIsCreatingBranch(false)}
                      className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                    >
                      {i18n._(msg`Cancelar`)}
                    </button>
                    <button
                      type="submit"
                      disabled={!newBranchName.trim()}
                      className="btn-m3-primary px-4 py-1 text-xs cursor-pointer"
                    >
                      {i18n._(msg`Crear Rama`)}
                    </button>
                  </div>
                </form>
              )}

              {/* Branch Search */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-[var(--on-surface-variant)]">
                  search
                </span>
                <input
                  type="text"
                  id="input-search-branches"
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  placeholder={i18n._(msg`Filtrar ramas por nombre...`)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] focus:outline-none"
                />
              </div>

              {/* Branch Cards List */}
              <div className="flex flex-col gap-2">
                {filteredBranches.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--on-surface-variant)] bg-[var(--surface)] border border-[var(--outline)] rounded-md">
                    {i18n._(msg`No se encontraron ramas en este workspace.`)}
                  </div>
                ) : (
                  filteredBranches.map((branch) => {
                    const isCurrentActive = branch.name === targetBranchWorkspace?.activeBranchName;
                    const isRenamingThis = renamingBranchName === branch.name;
                    const isConfirmingDelete = confirmDeleteBranchName === branch.name;
                    const canDelete = (targetBranchWorkspace?.branches.length || 0) > 1;

                    return (
                      <div
                        key={branch.name}
                        className={`p-2.5 sm:p-3 rounded-md border transition-all flex flex-col gap-2 ${
                          isCurrentActive
                            ? 'bg-sky-950/20 border-sky-600/50 ring-1 ring-sky-600/20'
                            : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--outline-variant)]'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">
                              fork_right
                            </span>

                            {isRenamingThis ? (
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameBranchInput}
                                  onChange={(e) => setRenameBranchInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameBranchSubmit(branch.name);
                                    if (e.key === 'Escape') setRenamingBranchName(null);
                                  }}
                                  className="px-2 py-0.5 text-xs font-mono rounded bg-black/50 border border-sky-500 text-white focus:outline-none flex-1 max-w-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRenameBranchSubmit(branch.name)}
                                  className="btn-m3-primary px-2 py-0.5 text-[11px] cursor-pointer"
                                >
                                  {i18n._(msg`Guardar`)}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRenamingBranchName(null)}
                                  className="btn-m3-text px-2 py-0.5 text-[11px] cursor-pointer"
                                >
                                  {i18n._(msg`Cancelar`)}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="font-mono text-xs font-semibold text-[var(--on-surface)] truncate">
                                  {branch.name}
                                </span>

                                {isCurrentActive && (
                                  <span className="px-1.5 py-0.2 rounded bg-sky-600 text-white text-[9px] font-mono">
                                    {i18n._(msg`Activa`)}
                                  </span>
                                )}

                                {branch.isProtected && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 text-[9px] font-mono flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[11px]">lock</span>
                                    <span>{i18n._(msg`Protegida`)}</span>
                                  </span>
                                )}

                                <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
                                  ({branch.taskDocuments?.length || 0} Task MD)
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Branch Actions */}
                          {!isRenamingThis && (
                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                              {/* Activate Branch */}
                              {!isCurrentActive && (
                                <button
                                  type="button"
                                  id={`btn-activate-branch-${branch.name}`}
                                  onClick={() => {
                                    onSelectBranch?.(targetBranchWorkspace.id, branch.name);
                                    if (targetBranchWorkspace.id === activeWorkspaceId) {
                                      onClose();
                                    }
                                  }}
                                  className="btn-m3-secondary px-2.5 py-0.5 text-xs cursor-pointer"
                                  title={i18n._(msg`Activar esta rama`)}
                                >
                                  {i18n._(msg`Activar`)}
                                </button>
                              )}

                              {/* Toggle Protection */}
                              {onToggleBranchProtection && (
                                <button
                                  type="button"
                                  id={`btn-toggle-protect-${branch.name}`}
                                  onClick={() => onToggleBranchProtection(targetBranchWorkspace.id, branch.name)}
                                  className={`btn-m3-icon w-7 h-7 cursor-pointer ${
                                    branch.isProtected ? 'text-amber-400 hover:text-amber-300' : 'text-[var(--on-surface-variant)] hover:text-amber-400'
                                  }`}
                                  title={branch.isProtected ? i18n._(msg`Desproteger rama`) : i18n._(msg`Proteger rama contra eliminación accidental`)}
                                >
                                  <span className="material-symbols-outlined text-[15px]">
                                    {branch.isProtected ? 'lock' : 'lock_open'}
                                  </span>
                                </button>
                              )}

                              {/* Rename Branch */}
                              {onRenameBranch && (
                                <button
                                  type="button"
                                  id={`btn-rename-branch-trigger-${branch.name}`}
                                  onClick={() => {
                                    setRenamingBranchName(branch.name);
                                    setRenameBranchInput(branch.name);
                                  }}
                                  className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-sky-400 cursor-pointer"
                                  title={i18n._(msg`Renombrar rama`)}
                                >
                                  <span className="material-symbols-outlined text-[15px]">edit</span>
                                </button>
                              )}

                              {/* Clone / Duplicate Branch */}
                              {onCreateBranch && (
                                <button
                                  type="button"
                                  id={`btn-clone-branch-${branch.name}`}
                                  onClick={() => {
                                    const copyName = `${branch.name}-copy`;
                                    onCreateBranch(targetBranchWorkspace.id, copyName, branch.name);
                                  }}
                                  className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-emerald-400 cursor-pointer"
                                  title={i18n._(msg`Duplicar rama`)}
                                >
                                  <span className="material-symbols-outlined text-[15px]">content_copy</span>
                                </button>
                              )}

                              {/* Delete Branch */}
                              {onDeleteBranch && (
                                <button
                                  type="button"
                                  id={`btn-delete-branch-trigger-${branch.name}`}
                                  disabled={!canDelete}
                                  onClick={() => {
                                    setConfirmDeleteBranchName(isConfirmingDelete ? null : branch.name);
                                  }}
                                  className={`btn-m3-icon w-7 h-7 cursor-pointer ${
                                    canDelete
                                      ? 'text-[var(--on-surface-variant)] hover:text-rose-400'
                                      : 'text-[var(--on-surface-variant)]/30 cursor-not-allowed'
                                  }`}
                                  title={
                                    canDelete
                                      ? i18n._(msg`Eliminar rama`)
                                      : i18n._(msg`No se puede eliminar la única rama del workspace`)
                                  }
                                >
                                  <span className="material-symbols-outlined text-[15px]">delete</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Commit & Metadata Details */}
                        {branch.lastCommit && (
                          <div className="pl-6 text-[11px] text-[var(--on-surface-variant)] flex items-center gap-2 flex-wrap font-mono">
                            <span className="px-1 rounded bg-[var(--surface-container-high)] text-[10px] text-sky-300">
                              {branch.lastCommit.hash}
                            </span>
                            <span className="truncate max-w-sm">{branch.lastCommit.message}</span>
                            <span className="text-[10px] text-[var(--on-surface-variant)]/70">
                              {branch.lastCommit.author}
                            </span>
                          </div>
                        )}

                        {/* Inline Delete Branch Confirmation */}
                        {isConfirmingDelete && (
                          <div className="mt-1 p-2.5 rounded bg-rose-950/40 border border-rose-800/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 animate-fade-in text-xs">
                            <div className="flex items-center gap-1.5 text-rose-300">
                              <span className="material-symbols-outlined text-[15px] text-rose-400">warning</span>
                              <span>{i18n._(msg`¿Eliminar la rama`)} <strong>"{branch.name}"</strong>?</span>
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteBranchName(null)}
                                className="btn-m3-text px-2.5 py-1 text-xs cursor-pointer"
                              >
                                {i18n._(msg`Cancelar`)}
                              </button>
                              <button
                                type="button"
                                id={`btn-confirm-delete-branch-${branch.name}`}
                                onClick={() => {
                                  onDeleteBranch?.(targetBranchWorkspace.id, branch.name);
                                  setConfirmDeleteBranchName(null);
                                }}
                                className="bg-rose-700 hover:bg-rose-800 text-white px-3 py-1 rounded text-xs font-semibold cursor-pointer"
                              >
                                {i18n._(msg`Eliminar Rama`)}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: EDIT WORKSPACE */}
          {activeTab === 'edit' && editingWorkspace && (
            <form onSubmit={handleUpdate} className="flex flex-col gap-3.5">
              <div id="div-ws-edit-header" className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-[var(--on-surface-variant)]">
                <span className="truncate">{i18n._(msg`Editando:`)} <strong className="text-[var(--on-surface)]">{editingWorkspace.name}</strong></span>
                <span className="font-mono text-[10px] text-[var(--on-surface-variant)] shrink-0">ID: {editingWorkspace.id}</span>
              </div>

              <div id="div-ws-edit-name" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Nombre del Workspace`)}
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={i18n._(msg`Nombre del workspace`)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-ws-edit-repo" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Repositorio (GitHub / Local)`)}
                </label>
                <input
                  type="text"
                  value={editRepoInput}
                  onChange={(e) => setEditRepoInput(e.target.value)}
                  placeholder="usuario/repositorio"
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-ws-edit-branch" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Rama activa / por defecto`)}
                </label>
                <input
                  type="text"
                  value={editDefaultBranch}
                  onChange={(e) => setEditDefaultBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-ws-edit-desc" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Descripción (opcional)`)}
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={i18n._(msg`Breve resumen del propósito de este workspace`)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-ws-edit-actions" className="pt-3 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-ws-edit-cancel"
                  type="button"
                  onClick={() => {
                    setActiveTab('workspaces');
                    setEditingWorkspace(null);
                  }}
                  className="btn-m3-text px-3 py-1.5 text-xs cursor-pointer w-full sm:w-auto text-center"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  id="btn-ws-edit-submit"
                  type="submit"
                  disabled={!editName.trim()}
                  className="btn-m3-primary px-4 py-1.5 text-xs cursor-pointer shadow-sm w-full sm:w-auto text-center justify-center"
                >
                  {i18n._(msg`Guardar Cambios`)}
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: CREATE WORKSPACE */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
              <div id="div-workspacemanagermodal-21" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Nombre del Workspace`)}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={i18n._(msg`ej. Ecommerce Monorepo, SaaS Backend...`)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-workspacemanagermodal-23" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Rama inicial`)}
                </label>
                <input
                  type="text"
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-workspacemanagermodal-24" className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Descripción (opcional)`)}
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={i18n._(msg`Breve resumen del propósito de este workspace`)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-workspacemanagermodal-25" className="pt-3 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-ws-create-cancel"
                  type="button"
                  onClick={() => setActiveTab('workspaces')}
                  className="btn-m3-text px-3 py-1.5 text-xs cursor-pointer w-full sm:w-auto text-center"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  id="btn-ws-create-submit"
                  type="submit"
                  disabled={!name.trim()}
                  className="btn-m3-primary px-4 py-1.5 text-xs cursor-pointer shadow-sm w-full sm:w-auto text-center justify-center"
                >
                  {i18n._(msg`Crear Workspace`)}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div id="div-workspacemanagermodal-footer" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex justify-end">
          <button
            id="btn-ws-manager-close-footer"
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
