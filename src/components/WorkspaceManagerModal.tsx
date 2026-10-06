import React, { useState } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  Workspace,
  parseGitHubRepoInput,
  TaskDocument,
  logWorkspaceTrace,
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
  onShowToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onSyncWorkspacesToSanity?: () => Promise<void>;
  onImportWorkspacesFromSanity?: () => Promise<void>;
  onSaveSingleWorkspaceToSanity?: (ws: Workspace) => Promise<void>;
  onOpenSyncDiffModal?: () => void;
  isSanityConfigured?: boolean;
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
  onShowToast,
  onSyncWorkspacesToSanity,
  onImportWorkspacesFromSanity,
  onSaveSingleWorkspaceToSanity,
  onOpenSyncDiffModal,
  isSanityConfigured = false,
}) => {
  const { i18n } = useLingui();
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'edit'>('list');
  const [isSyncingSanity, setIsSyncingSanity] = useState<boolean>(false);
  const [isImportingSanity, setIsImportingSanity] = useState<boolean>(false);
  const [savingWsId, setSavingWsId] = useState<string | null>(null);

  // Form state for creating new workspace
  const [name, setName] = useState('');
  const [repoInput, setRepoInput] = useState('');
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
          activeDocumentId: initialDocs[0]?.id || "doc_root",
          taskDocuments: initialDocs,
        },
      ],
    };

    onCreateWorkspace(newWorkspace);
    setName('');
    setRepoInput('');
    setDefaultBranch('main');
    setDescription('');
    setActiveTab('list');
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
    setActiveTab('list');
    setEditingWorkspace(null);
  };

  return (
    <div
      id="modal-workspace-manager-overlay"
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        id="modal-workspace-manager-dialog"
        className="w-full sm:max-w-2xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden max-h-[90vh] pb-safe sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div id="div-workspacemanagermodal-1" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
          <div id="div-workspacemanagermodal-2" className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0">
              workspaces
            </span>
            <h2 id="ws-manager-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans">
              {i18n._(msg`Gestión de Workspaces`)}
            </h2>
          </div>
          <button id="btn-workspacemanagermodal-1" type="button" onClick={onClose} className="btn-m3-icon w-7 h-7 cursor-pointer" aria-label={i18n._(msg`Cerrar`)}>
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Tab switcher */}
        <div id="div-workspacemanagermodal-3" className="flex border-b border-[var(--outline)] px-4 bg-[var(--surface)]">
          <button
            id="btn-workspace-tab-list"
            type="button"
            onClick={() => {
              setActiveTab('list');
              setEditingWorkspace(null);
            }}
            className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'list'
                ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            {i18n._(msg`Mis Workspaces`)} ({workspaces.length})
          </button>
          <button
            id="btn-workspace-tab-create"
            type="button"
            onClick={() => {
              setActiveTab('create');
              setEditingWorkspace(null);
            }}
            className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'create'
                ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            + {i18n._(msg`Nuevo Workspace`)}
          </button>
          {editingWorkspace && (
            <button
              id="btn-workspace-tab-edit"
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1 ${
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
        <div id="div-workspacemanagermodal-4" className="p-4 overflow-y-auto max-h-[60vh]">
          {activeTab === 'list' ? (
            <div id="div-workspacemanagermodal-5" className="flex flex-col gap-3">
              {/* Sanity Cloud Persistence Bar */}
              <div id="div-workspacemanagermodal-6" className="p-3 rounded-md bg-[var(--surface)] border border-[var(--outline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div id="div-workspacemanagermodal-7" className="flex items-center gap-2 min-w-0">
                  <div id="div-workspacemanagermodal-8" className="w-6 h-6 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-[10px] shadow-xs shrink-0">
                    S
                  </div>
                  <div id="div-workspacemanagermodal-9" className="flex flex-col min-w-0">
                    <div id="div-workspacemanagermodal-10" className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-[var(--on-surface)]">{i18n._(msg`Estructura en Sanity`)}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-mono border ${
                          isSanityConfigured
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isSanityConfigured ? i18n._(msg`Conectado`) : i18n._(msg`Sin configurar`)}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--on-surface-variant)] truncate">
                      {i18n._(msg`Sincroniza y almacena tus workspaces como esquemas nativos en Sanity`)}
                    </span>
                  </div>
                </div>

                <div id="div-workspacemanagermodal-11" className="flex items-center gap-1.5 shrink-0 flex-wrap">
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
                      <span>{i18n._(msg`Sincronizar & Overrides`)}</span>
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
                      <span>{isSyncingSanity ? i18n._(msg`Sincronizando...`) : i18n._(msg`Guardar`)}</span>
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
                      <span>{isImportingSanity ? i18n._(msg`Importando...`) : i18n._(msg`Cargar`)}</span>
                    </button>
                  )}
                </div>
              </div>

              {(workspaces || []).map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const totalDocs = (ws.branches || []).reduce(
                  (acc, b) => acc + (b.taskDocuments?.length || 0),
                  0
                );
                const isConfirmingThis = confirmDeleteId === ws.id;

                return (
                  <div
                    key={ws.id}
                    id={`div-workspace-card-${ws.id}`}
                    className={`p-3 rounded-md border transition-all ${
                      isActive
                        ? 'bg-[var(--primary-container)]/20 border-[var(--primary)]'
                        : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--outline-variant)]'
                    }`}
                  >
                    <div id="div-workspacemanagermodal-12" className="flex items-start justify-between gap-3">
                      <div id="div-workspacemanagermodal-13" className="flex flex-col min-w-0 flex-1">
                        <div id="div-workspacemanagermodal-14" className="flex items-center gap-2">
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

                        {/* Stats */}
                        <div id="div-workspacemanagermodal-16" className="flex items-center gap-3 text-[11px] font-mono text-[var(--on-surface-variant)] mt-2">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px] text-sky-400">fork_right</span>
                            <span>{ws.branches.length} {i18n._(msg`Ramas`).toLowerCase()} ({ws.activeBranchName})</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px] text-amber-400">description</span>
                            <span>{totalDocs} Task MD</span>
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div id="div-workspacemanagermodal-17" className="flex items-center gap-1.5 shrink-0">
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

                    {/* Inline Delete Confirmation without checkboxes */}
                    {isConfirmingThis && (
                      <div
                        id={`div-ws-delete-confirm-box-${ws.id}`}
                        className="mt-3 p-3 rounded-md bg-[var(--surface-container-high)]/60 border border-rose-800/40 flex flex-col gap-2.5 animate-fade-in text-xs"
                      >
                        <div className="flex items-center gap-2 text-rose-300 font-semibold">
                          <span className="material-symbols-outlined text-[16px] text-rose-400">warning</span>
                          <span>{i18n._(msg`Eliminar workspace`)}: "{ws.name}"</span>
                        </div>

                        {isSanityConfigured ? (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] font-medium text-[var(--on-surface-variant)]">
                              {i18n._(msg`Selecciona el alcance de la eliminación:`)}
                            </span>

                            {/* Visual Scope Cards - No Checkboxes */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {/* Option A: Solo Local */}
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

                              {/* Option B: Local y Remoto */}
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
                                  {i18n._(msg`Destrucción definitiva. Se borrará permanentemente de la nube para todos los dispositivos.`)}
                                </p>
                              </button>
                            </div>

                            {/* Explicit verification input when deleting from cloud */}
                            {deleteScope === 'both' && (
                              <div className="mt-1 p-2.5 rounded-md bg-rose-950/40 border border-rose-600/50 flex flex-col gap-2 animate-fade-in">
                                <div className="flex items-center gap-1.5 text-rose-300 font-bold text-xs">
                                  <span className="material-symbols-outlined text-[15px] text-rose-400">gpp_bad</span>
                                  <span>{i18n._(msg`Verificación de seguridad requerida`)}</span>
                                </div>
                                <p className="text-[11px] text-rose-200/90 leading-tight">
                                  {i18n._(msg`Esta acción es IRREVERSIBLE. Para confirmar que comprendes que se perderá para siempre, escribe el nombre del workspace:`)}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded bg-black/40 border border-rose-800/60 font-mono text-xs text-rose-200 select-all shrink-0">
                                    {ws.name}
                                  </span>
                                  <input
                                    type="text"
                                    id={`input-verify-delete-name-${ws.id}`}
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder={i18n._(msg`Escribe el nombre aquí`)}
                                    className="flex-1 bg-black/50 border border-rose-600/60 focus:border-rose-400 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none"
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

                        {/* Action buttons */}
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--outline)]">
                          <button
                            id={`btn-ws-cancel-delete-${ws.id}`}
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              setDeleteScope('local');
                              setDeleteConfirmText('');
                            }}
                            className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
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
                            className={`px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5 ${
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
              })}
            </div>
          ) : activeTab === 'edit' && editingWorkspace ? (
            <form onSubmit={handleUpdate} className="flex flex-col gap-3.5">
              <div id="div-ws-edit-header" className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between text-xs text-[var(--on-surface-variant)]">
                <span>{i18n._(msg`Editando:`)} <strong className="text-[var(--on-surface)]">{editingWorkspace.name}</strong></span>
                <span className="font-mono text-[10px] text-[var(--on-surface-variant)]">ID: {editingWorkspace.id}</span>
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

              <div id="div-ws-edit-actions" className="pt-3 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-ws-edit-cancel"
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setEditingWorkspace(null);
                  }}
                  className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  id="btn-ws-edit-submit"
                  type="submit"
                  disabled={!editName.trim()}
                  className="btn-m3-primary px-4 py-1.5 text-xs cursor-pointer shadow-sm"
                >
                  {i18n._(msg`Guardar Cambios`)}
                </button>
              </div>
            </form>
          ) : (
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

              <div id="div-workspacemanagermodal-25" className="pt-3 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-ws-create-cancel"
                  type="button"
                  onClick={() => setActiveTab('list')}
                  className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                >
                  {i18n._(msg`Cancelar`)}
                </button>
                <button
                  id="btn-ws-create-submit"
                  type="submit"
                  disabled={!name.trim()}
                  className="btn-m3-primary px-4 py-1.5 text-xs cursor-pointer shadow-sm"
                >
                  {i18n._(msg`Crear Workspace`)}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div id="div-workspacemanagermodal-26" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex justify-end">
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
