import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getSanityConfig,
  fetchSanityDocumentsList,
  fetchSanityDocumentById,
  saveSanityDocument,
  deleteDocumentFromSanity,
  writeTestingTaskToSanity,
  SanityConfig,
} from '../services/sanityService';
import { getSyncSession } from '../services/syncSessionService';
import { SanitySdkExplorer } from './SanitySdkExplorer';
import { SanityStudioEmbed } from './SanityStudioEmbed';

export interface SanityStudioProps {
  onOpenSanityConfig: () => void;
  onImportTaskToMarkdown?: (task: any) => void;
  onActivateWorkspace?: (workspace: any) => void;
  onOpenSyncDiffModal?: () => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
}

type DocumentTypeFilter = 'all' | 'workspace' | 'task' | 'canvasVisualState';
type InspectorViewMode = 'form' | 'json' | 'preview';
type StudioMode = 'native' | 'sdk' | 'desk';

export const SanityStudio: React.FC<SanityStudioProps> = ({
  onOpenSanityConfig,
  onImportTaskToMarkdown,
  onActivateWorkspace,
  onOpenSyncDiffModal,
  onShowToast,
  activeWorkspaceId,
  activeWorkspaceName,
}) => {
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [studioMode, setStudioMode] = useState<StudioMode>('native');
  const [activeDocType, setActiveDocType] = useState<DocumentTypeFilter>('task');
  const [documents, setDocuments] = useState<any[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Filter & Search state in Document List Pane
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inspectorMode, setInspectorMode] = useState<InspectorViewMode>('form');

  // Form edit state for currently selected document
  const [formState, setFormState] = useState<any>({});
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [tagInput, setTagInput] = useState<string>('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string>('');

  // Mobile navigation pane state: 'structure' | 'list' | 'inspector'
  const [mobilePane, setMobilePane] = useState<'structure' | 'list' | 'inspector'>('list');

  // Inline non-blocking modals (No window.alert/prompt/confirm)
  const [isCreateWsOpen, setIsCreateWsOpen] = useState<boolean>(false);
  const [newWsName, setNewWsName] = useState<string>('');
  const [newWsRepo, setNewWsRepo] = useState<string>('');
  const [newWsBranch, setNewWsBranch] = useState<string>('main');

  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState<boolean>(false);
  const [newTaskTitleInput, setNewTaskTitleInput] = useState<string>('');
  const [newTaskPriorityInput, setNewTaskPriorityInput] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P1');
  const [newTaskWorkspaceId, setNewTaskWorkspaceId] = useState<string>('');
  const [newTaskSectionInput, setNewTaskSectionInput] = useState<string>('General');
  const [isCustomTaskSectionInput, setIsCustomTaskSectionInput] = useState<boolean>(false);
  const [customTaskSectionInput, setCustomTaskSectionInput] = useState<string>('');
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('all');

  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState<boolean>(false);

  const isConfigured = Boolean(config.projectId && config.dataset);

  // Load all documents from Sanity
  const loadDocuments = useCallback(async () => {
    if (!config.projectId || !config.dataset) {
      setDocuments([]);
      return;
    }

    const session = getSyncSession(config);
    setIsLoadingList(true);
    try {
      const docs = await fetchSanityDocumentsList(config);
      if (getSyncSession(config) !== session) return;
      setDocuments(docs);
      // Auto-select first document if nothing selected
      if (!selectedDocId && docs.length > 0) {
        const firstTask = docs.find((d) => d._type === 'task') || docs[0];
        setSelectedDocId(firstTask._id);
      }
    } catch (err) {
      console.warn('Error loading Sanity documents:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, [config, selectedDocId]);

  // Initial load and listener for config updates
  useEffect(() => {
    const updateLocalConfig = () => {
      const latest = getSanityConfig();
      setDocuments([]); setSelectedDocId(null); setSelectedDoc(null); setFormState({}); setIsDirty(false);
      setConfig(latest);
    };

    updateLocalConfig();
    window.addEventListener('antask_sanity_config_updated', updateLocalConfig);
    return () => {
      window.removeEventListener('antask_sanity_config_updated', updateLocalConfig);
    };
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments, config]);

  // Load selected document details
  useEffect(() => {
    if (!selectedDocId) {
      setSelectedDoc(null);
      setFormState({});
      setIsDirty(false);
      return;
    }

    let isMounted = true;
    setIsLoadingDoc(true);

    fetchSanityDocumentById(selectedDocId, config).then((doc) => {
      if (!isMounted) return;
      setIsLoadingDoc(false);
      if (doc) {
        setSelectedDoc(doc);
        setFormState({ ...doc });
        setIsDirty(false);
      }
    }).catch((error) => { if (isMounted) { setIsLoadingDoc(false); onShowToast(error.message, 'error'); } });

    return () => {
      isMounted = false;
    };
  }, [selectedDocId, config]);

  const availableWorkspaces = useMemo(() => {
    return documents.filter((d) => d._type === 'workspace');
  }, [documents]);

  // Filtered documents list
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (activeDocType !== 'all' && doc._type !== activeDocType) {
        return false;
      }

      if (activeDocType === 'task' && workspaceFilter !== 'all') {
        const docWsId = doc.workspaceId || doc.workspace?._ref;
        if (docWsId !== workspaceFilter && doc._id !== workspaceFilter) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (doc.title || '').toLowerCase().includes(q);
        const matchName = (doc.name || '').toLowerCase().includes(q);
        const matchTaskId = (doc.taskId || '').toLowerCase().includes(q);
        const matchWsId = (doc.workspaceId || '').toLowerCase().includes(q);
        const matchRepo = (doc.githubRepo?.fullName || '').toLowerCase().includes(q);
        const matchId = (doc._id || '').toLowerCase().includes(q);
        const matchProject = (doc.projectId || '').toLowerCase().includes(q);
        if (!matchTitle && !matchName && !matchTaskId && !matchWsId && !matchRepo && !matchId && !matchProject) return false;
      }

      if (statusFilter !== 'all' && doc._type === 'task') {
        if (statusFilter === 'done' && !doc.completed) return false;
        if (statusFilter === 'todo' && doc.completed) return false;
      }

      return true;
    });
  }, [documents, activeDocType, workspaceFilter, searchQuery, statusFilter]);

  const taskCount = documents.filter((d) => d._type === 'task').length;
  const workspaceCount = documents.filter((d) => d._type === 'workspace').length;
  const canvasCount = documents.filter((d) => d._type === 'canvasVisualState').length;

  const handleFormFieldChange = (field: string, value: any) => {
    setFormState((prev: any) => ({
      ...prev,
      [field]: value,
    }));
    setIsDirty(true);
  };

  const handleSaveDocument = async () => {
    if (!selectedDocId || !isConfigured) return;
    const session = getSyncSession(config);
    setIsSaving(true);

    try {
      const res = await saveSanityDocument(formState, config);
      if (getSyncSession(config) !== session) return;
      if (res.ok) {
        onShowToast('Documento publicado con éxito en Sanity', 'success');
        setSelectedDoc(res.document || formState);
        setFormState(res.document || formState);
        setIsDirty(false);
        loadDocuments();
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error al guardar', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedDocId) return;
    setIsConfirmDeleteOpen(false);
    const session = getSyncSession(config);
    setIsDeleting(true);
    try {
      const res = await deleteDocumentFromSanity(selectedDocId, config);
      if (getSyncSession(config) !== session) return;
      if (res.ok) {
        onShowToast('Documento eliminado de Sanity', 'info');
        setSelectedDocId(null);
        setSelectedDoc(null);
        setFormState({});
        loadDocuments();
        setMobilePane('list');
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err) {
      onShowToast('Error al eliminar', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenCreateWorkspaceModal = () => {
    setNewWsName('Nuevo Proyecto Web');
    setNewWsRepo('usuario/nuevo-proyecto');
    setNewWsBranch('main');
    setIsCreateWsOpen(true);
  };

  const handleExecuteCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim() || !newWsRepo.trim()) {
      onShowToast('Ingresa un nombre y repositorio para el workspace', 'warning');
      return;
    }

    setIsCreateWsOpen(false);
    try {
      const now = new Date().toISOString();
      const wsId = 'ws_' + Date.now();
      const cleanRepo = newWsRepo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const parts = cleanRepo.split('/');
      const owner = parts[0] || 'usuario';
      const repo = parts[1] || parts[0] || 'proyecto';
      const fullName = `${owner}/${repo}`;
      const branchName = newWsBranch.trim() || 'main';

      const initialMd = `# ${newWsName.trim()} - TASKS.md\n\n## Tareas Principales\n- [ ] Configurar entorno y dependencias del proyecto\n  id: setup_env\n  priority: P0\n  status: in_progress\n- [ ] Conectar persistencia estructurada con Sanity CMS\n  id: sanity_struct\n  priority: P1\n  status: todo\n`;

      const newWs = {
        _id: `workspace-${wsId}`,
        _type: 'workspace',
        workspaceId: wsId,
        name: newWsName.trim(),
        githubRepo: {
          owner,
          repo,
          fullName,
          url: `https://github.com/${fullName}`,
          defaultBranch: branchName,
          isPrivate: false,
          description: `Workspace para ${fullName} administrado desde Sanity Studio`,
        },
        activeBranchName: branchName,
        branches: [
          {
            name: branchName,
            isProtected: true,
            activeDocumentId: `doc_${Date.now()}`,
            lastCommit: {
              hash: Math.random().toString(16).substring(2, 9),
              message: `chore: inicializar estructura de workspace ${newWsName.trim()} en Sanity`,
              author: 'Sanity Studio',
              timestamp: now,
            },
            taskDocuments: [
              {
                id: `doc_${Date.now()}`,
                name: 'TASKS.md',
                folder: '',
                path: 'TASKS.md',
                content: initialMd,
                lastSavedContent: initialMd,
                updatedAt: now,
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const res = await saveSanityDocument(newWs, config);
      if (res.ok) {
        onShowToast(`Workspace "${newWsName.trim()}" creado y guardado en Sanity`, 'success');
        await loadDocuments();
        setSelectedDocId(newWs._id);
        setActiveDocType('workspace');
        setMobilePane('inspector');
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      onShowToast('Error al crear workspace en Sanity', 'error');
    }
  };

  const handleOpenCreateTaskModal = (defaultWsId?: string) => {
    setNewTaskTitleInput('Nueva tarea de Sanity');
    setNewTaskPriorityInput('P1');
    setNewTaskWorkspaceId(defaultWsId || (formState._type === 'workspace' ? (formState.workspaceId || formState._id) : ''));
    setIsCreateTaskOpen(true);
  };

  const handleExecuteCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitleInput.trim()) return;

    setIsCreateTaskOpen(false);
    try {
      const selectedWs = availableWorkspaces.find(
        (w) => w.workspaceId === newTaskWorkspaceId || w._id === newTaskWorkspaceId
      );

      const availableSecs = Array.from(
        new Set(
          documents
            .filter((d) => d._type === 'task' && d.groupTitle && typeof d.groupTitle === 'string')
            .map((d) => (d.groupTitle as string).trim())
            .filter(Boolean)
        )
      );

      const finalGroupTitle = isCustomTaskSectionInput
        ? (customTaskSectionInput.trim() || 'General')
        : (newTaskSectionInput.trim() || (availableSecs[0] || 'General'));

      const targetBranch = selectedWs?.branches?.find((b: any) => b.name === selectedWs.activeBranchName) || selectedWs?.branches?.[0];
      const targetDoc = targetBranch?.taskDocuments?.find((d: any) => d.id === targetBranch.activeDocumentId) || targetBranch?.taskDocuments?.[0];
      if (selectedWs && !targetDoc) throw new Error('El workspace no contiene un documento de tareas');
      const res = await writeTestingTaskToSanity(config, {
        documentKey: targetDoc ? `${targetBranch.name}::${targetDoc.id}` : undefined,
        branchName: targetBranch?.name, documentPath: targetDoc?.path,
        title: newTaskTitleInput.trim(),
        taskId: 'task-' + Date.now().toString(36),
        priority: newTaskPriorityInput,
        status: 'todo',
        groupTitle: finalGroupTitle,
        workspaceId: selectedWs ? (selectedWs.workspaceId || selectedWs._id.replace(/^workspace-/, '')) : undefined,
        workspace: selectedWs ? { _type: 'reference', _ref: selectedWs._id } : undefined,
      });

      if (res.ok && res.document) {
        onShowToast('Documento _type: "task" creado en Sanity', 'success');
        await loadDocuments();
        setSelectedDocId(res.document._id);
        setActiveDocType('task');
        setMobilePane('inspector');
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err) {
      onShowToast('Error al crear tarea', 'error');
    }
  };

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const clean = tagInput.trim().replace(/^#/, '');
    const currentTags = Array.isArray(formState.tags) ? formState.tags : [];
    if (!currentTags.includes(clean)) {
      handleFormFieldChange('tags', [...currentTags, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = Array.isArray(formState.tags) ? formState.tags : [];
    handleFormFieldChange(
      'tags',
      currentTags.filter((t: string) => t !== tagToRemove)
    );
  };

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const currentSubtasks = Array.isArray(formState.subtasks) ? formState.subtasks : [];
    handleFormFieldChange('subtasks', [
      ...currentSubtasks,
      { title: newSubtaskTitle.trim(), completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleToggleSubtask = (index: number) => {
    const currentSubtasks = Array.isArray(formState.subtasks) ? [...formState.subtasks] : [];
    if (currentSubtasks[index]) {
      currentSubtasks[index] = {
        ...currentSubtasks[index],
        completed: !currentSubtasks[index].completed,
      };
      handleFormFieldChange('subtasks', currentSubtasks);
    }
  };

  const handleRemoveSubtask = (index: number) => {
    const currentSubtasks = Array.isArray(formState.subtasks) ? [...formState.subtasks] : [];
    handleFormFieldChange(
      'subtasks',
      currentSubtasks.filter((_: any, i: number) => i !== index)
    );
  };

  // If not configured, show sober prompt
  if (!isConfigured) {
    return (
      <div id="div-sanitystudio-1" className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--surface)] select-none">
        <div id="div-sanitystudio-2" className="w-14 h-14 rounded-md bg-sky-950/80 border border-sky-600/50 flex items-center justify-center text-sky-400 mb-3 shadow-md">
          <span className="material-symbols-outlined text-[30px]">cloud_off</span>
        </div>
        <h2 className="text-base font-semibold text-[var(--on-surface)] mb-1">
          Sanity Studio no conectado
        </h2>
        <p className="text-xs text-[var(--on-surface-variant)] max-w-md mb-4 leading-relaxed">
          Para explorar y editar tus esquemas <code className="font-mono text-sky-300">_type: "task"</code> y el estado visual del canvas, configura tu Project ID y Dataset de Sanity.
        </p>
        <button
          id="btn-sanity-studio-configure-unconnected"
          type="button"
          onClick={onOpenSanityConfig}
          className="btn-m3-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">settings</span>
          <span>Configurar credenciales de Sanity</span>
        </button>
      </div>
    );
  }

  return (
    <div id="div-sanitystudio-3" className="flex-1 h-full flex flex-col overflow-hidden bg-[var(--surface)] text-xs select-none">
      {/* Top App Bar: Studio Mode Switcher */}
      <div id="div-sanitystudio-4" className="px-3.5 py-2 border-b border-[var(--outline)] bg-[var(--surface-container)] flex items-center justify-between gap-3 shrink-0">
        <div id="div-sanitystudio-5" className="flex items-center gap-1.5 flex-wrap">
          <button
            id="btn-sanity-studio-mode-native"
            type="button"
            onClick={() => setStudioMode('native')}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              studioMode === 'native'
                ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">dashboard</span>
            <span>Studio Embebido</span>
          </button>

          <button
            id="btn-sanity-studio-mode-sdk"
            type="button"
            onClick={() => setStudioMode('sdk')}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              studioMode === 'sdk'
                ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">code</span>
            <span>Explorador SDK</span>
          </button>

          <button
            id="btn-sanity-studio-mode-desk"
            type="button"
            onClick={() => setStudioMode('desk')}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              studioMode === 'desk'
                ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">table_rows</span>
            <span>Desk Tool</span>
          </button>
        </div>

        <div id="div-sanitystudio-6" className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[var(--on-surface-variant)] hidden sm:inline">
            {config.projectId} · {config.dataset}
          </span>
          <button
            id="btn-sanity-studio-open-config-header"
            type="button"
            onClick={onOpenSanityConfig}
            className="px-2 py-0.5 text-[11px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] border border-[var(--outline)] hover:border-[var(--on-surface-variant)] transition cursor-pointer"
          >
            Configuración
          </button>
        </div>
      </div>

      {studioMode === 'native' ? (
        <div id="div-sanitystudio-7" className="flex-1 h-full overflow-hidden flex flex-col">
          <SanityStudioEmbed
            activeWorkspaceId={activeWorkspaceId}
            activeWorkspaceName={activeWorkspaceName}
            onOpenSanityConfig={onOpenSanityConfig}
            onShowToast={onShowToast}
            onImportTaskToMarkdown={onImportTaskToMarkdown}
          />
        </div>
      ) : studioMode === 'sdk' ? (
        <div id="div-sanitystudio-8" className="flex-1 overflow-y-auto p-4 bg-neutral-950 text-neutral-100">
          <SanitySdkExplorer
            activeWorkspaceId={activeWorkspaceId}
            activeWorkspaceName={activeWorkspaceName}
            onOpenSanityConfig={onOpenSanityConfig}
            onSwitchToDeskTool={() => setStudioMode('desk')}
            onSwitchToNativeStudio={() => setStudioMode('native')}
            onImportTaskToMarkdown={onImportTaskToMarkdown}
            onActivateWorkspace={onActivateWorkspace}
            onShowToast={onShowToast}
          />
        </div>
      ) : (
        <div id="div-sanitystudio-9" className="flex-1 h-full flex overflow-hidden">
          {/* ========================================================= */}
          {/* PANE 1: STRUCTURE TREE (Desk Tool Navigation) */}
          {/* ========================================================= */}
          <aside
            className={`w-full sm:w-56 md:w-64 bg-[var(--surface-container)] border-r border-[var(--outline)] flex flex-col justify-between shrink-0 ${
              mobilePane === 'structure' ? 'flex' : 'hidden sm:flex'
            }`}
          >
        {/* Studio Brand Header */}
        <div id="div-sanitystudio-10" className="px-3.5 py-3 border-b border-[var(--outline)] flex items-center justify-between bg-[var(--surface)]">
          <div id="div-sanitystudio-11" className="flex items-center gap-2 min-w-0">
            <div id="div-sanitystudio-12" className="w-6 h-6 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-[11px] shadow-xs shrink-0">
              S
            </div>
            <div id="div-sanitystudio-13" className="flex flex-col min-w-0">
              <div id="div-sanitystudio-14" className="flex items-center gap-1.5">
                <span className="font-bold text-xs text-[var(--on-surface)] tracking-tight truncate">Sanity Studio</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" title="Sincronizado en vivo" />
              </div>
              <span className="text-[10px] font-mono text-[var(--primary)] truncate">
                {config.projectId || 'Sanity'} • {config.dataset}
              </span>
            </div>
          </div>

          <button
            id="btn-sanity-studio-refresh-documents"
            type="button"
            onClick={loadDocuments}
            className="btn-m3-icon w-6 h-6 cursor-pointer shrink-0"
            title="Sincronizar y recargar datos de Sanity"
          >
            <span className={`material-symbols-outlined text-[15px] ${isLoadingList ? 'animate-spin' : ''}`}>
              refresh
            </span>
          </button>
        </div>

        {/* Structure Hierarchy Tree */}
        <div id="div-sanitystudio-15" className="flex-1 p-2 overflow-y-auto flex flex-col gap-1">
          <span className="px-2 py-1 text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
            Tipos de Contenido
          </span>

          {/* Workspace Document Type */}
          <button
            id="btn-sanity-studio-nav-workspace"
            type="button"
            onClick={() => {
              setActiveDocType('workspace');
              setMobilePane('list');
            }}
            className={`w-full px-2.5 py-2 rounded text-xs font-medium flex items-center justify-between text-left transition-colors cursor-pointer ${
              activeDocType === 'workspace'
                ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold border-l-2 border-l-[var(--primary)]'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <div id="div-sanitystudio-16" className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[17px] text-emerald-400">workspaces</span>
              <span className="truncate">Workspaces</span>
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)]">
              {workspaceCount}
            </span>
          </button>

          {/* Task Document Type */}
          <button
            id="btn-sanity-studio-nav-task"
            type="button"
            onClick={() => {
              setActiveDocType('task');
              setMobilePane('list');
            }}
            className={`w-full px-2.5 py-2 rounded text-xs font-medium flex items-center justify-between text-left transition-colors cursor-pointer ${
              activeDocType === 'task'
                ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold border-l-2 border-l-[var(--primary)]'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <div id="div-sanitystudio-17" className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[17px] text-sky-400">check_box</span>
              <span className="truncate">Tareas (task)</span>
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)]">
              {taskCount}
            </span>
          </button>

          {/* Canvas Visual State Document Type */}
          <button
            id="btn-sanity-studio-nav-canvas"
            type="button"
            onClick={() => {
              setActiveDocType('canvasVisualState');
              setMobilePane('list');
            }}
            className={`w-full px-2.5 py-2 rounded text-xs font-medium flex items-center justify-between text-left transition-colors cursor-pointer ${
              activeDocType === 'canvasVisualState'
                ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold border-l-2 border-l-[var(--primary)]'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <div id="div-sanitystudio-18" className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[17px] text-purple-400">grid_view</span>
              <span className="truncate">Canvas Visual State</span>
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)]">
              {canvasCount}
            </span>
          </button>

          {/* All Documents */}
          <button
            id="btn-sanity-studio-nav-all"
            type="button"
            onClick={() => {
              setActiveDocType('all');
              setMobilePane('list');
            }}
            className={`w-full px-2.5 py-2 rounded text-xs font-medium flex items-center justify-between text-left transition-colors cursor-pointer ${
              activeDocType === 'all'
                ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold border-l-2 border-l-[var(--primary)]'
                : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
            }`}
          >
            <div id="div-sanitystudio-19" className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[17px] text-amber-400">folder</span>
              <span className="truncate">Todos los docs</span>
            </div>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)]">
              {documents.length}
            </span>
          </button>
        </div>

        {/* Structure Footer */}
        <div id="div-sanitystudio-20" className="p-2.5 border-t border-[var(--outline)] bg-[var(--surface)] flex flex-col gap-1.5">
          {onOpenSyncDiffModal && (
            <button
              id="btn-sanity-studio-sync-diff"
              type="button"
              onClick={onOpenSyncDiffModal}
              className="btn-m3-primary w-full py-1.5 text-xs justify-start px-2.5 cursor-pointer shadow-xs flex items-center gap-1.5"
              title="Comparar y sincronizar diferencias / overrides con Sanity Cloud"
            >
              <span className="material-symbols-outlined text-[16px]">sync_problem</span>
              <span>Sincronizar & Overrides</span>
            </button>
          )}

          <button
            id="btn-sanity-studio-connection-settings"
            type="button"
            onClick={onOpenSanityConfig}
            className="btn-m3-secondary w-full py-1.5 text-xs justify-start px-2.5 cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            <span>Ajustes de conexión</span>
          </button>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* PANE 2: DOCUMENT LIST (Documents of selected type) */}
      {/* ========================================================= */}
      <section
        className={`w-full sm:w-72 md:w-80 lg:w-96 bg-[var(--surface)] border-r border-[var(--outline)] flex flex-col shrink-0 ${
          mobilePane === 'list' ? 'flex' : 'hidden sm:flex'
        }`}
      >
        {/* Document List Header */}
        <div id="div-sanitystudio-21" className="px-3.5 py-2.5 border-b border-[var(--outline)] flex items-center justify-between bg-[var(--surface-container)] gap-2">
          <div id="div-sanitystudio-22" className="flex items-center gap-2 min-w-0">
            <button
              id="btn-sanity-studio-back-to-structure"
              type="button"
              onClick={() => setMobilePane('structure')}
              className="sm:hidden btn-m3-icon w-6 h-6 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            </button>
            <div id="div-sanitystudio-23" className="flex flex-col min-w-0">
              <h3 className="font-semibold text-xs text-[var(--on-surface)] truncate">
                {activeDocType === 'task'
                  ? 'Documentos de Tarea'
                  : activeDocType === 'workspace'
                  ? 'Workspaces de Proyecto'
                  : activeDocType === 'canvasVisualState'
                  ? 'Estados de Lienzo'
                  : 'Todos los Documentos'}
              </h3>
              <span className="text-[10px] text-[var(--on-surface-variant)]">
                {filteredDocuments.length} documentos encontrados
              </span>
            </div>
          </div>

          {activeDocType === 'workspace' ? (
            <button
              id="btn-sanity-studio-open-create-workspace"
              type="button"
              onClick={handleOpenCreateWorkspaceModal}
              className="btn-m3-primary px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
              title="Crear un nuevo workspace estructurado en Sanity"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              <span>+ Crear Workspace</span>
            </button>
          ) : (
            <button
              id="btn-sanity-studio-open-create-task"
              type="button"
              onClick={() => handleOpenCreateTaskModal()}
              className="btn-m3-primary px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
              title="Crear un nuevo documento de tipo task en Sanity"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              <span>+ Crear Task</span>
            </button>
          )}
        </div>

        {/* Search & Quick Filters */}
        <div id="div-sanitystudio-24" className="p-2 border-b border-[var(--outline)] bg-[var(--surface)] flex flex-col gap-1.5">
          <div id="div-sanitystudio-25" className="relative w-full">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-[var(--on-surface-variant)]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por título, ID, repo o tag..."
              className="w-full bg-[var(--surface-container)] border border-[var(--outline)] rounded pl-8 pr-7 py-1 text-xs text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] focus:outline-none focus:border-[var(--primary)]"
            />
            {searchQuery && (
              <button
                id="btn-sanity-studio-clear-search"
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {activeDocType === 'task' && (
            <div id="div-sanitystudio-26" className="flex flex-col gap-1">
              {availableWorkspaces.length > 0 && (
                <div id="div-sanitystudio-27" className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[var(--on-surface-variant)] shrink-0 font-medium">Workspace:</span>
                  <select
                    value={workspaceFilter}
                    onChange={(e) => setWorkspaceFilter(e.target.value)}
                    className="flex-1 bg-[var(--surface-container)] border border-[var(--outline)] rounded px-1.5 py-0.5 text-[10px] text-[var(--on-surface)] focus:outline-none cursor-pointer truncate"
                  >
                    <option value="all">🏢 Todos los Workspaces ({taskCount})</option>
                    {availableWorkspaces.map((ws) => (
                      <option key={ws._id} value={ws.workspaceId || ws._id}>
                        🏢 {ws.name || ws._id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div id="div-sanitystudio-28" className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {[
                  { id: 'all', label: 'Todos' },
                  { id: 'todo', label: 'Pendientes' },
                  { id: 'done', label: 'Completados' },
                ].map((f) => (
                  <button
                    key={f.id}
                    id={`btn-sanity-studio-status-filter-${f.id}`}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors cursor-pointer ${
                      statusFilter === f.id
                        ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                        : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Documents Scrollable List */}
        <div id="div-sanitystudio-29" className="flex-1 overflow-y-auto divide-y divide-[var(--outline)]">
          {isLoadingList ? (
            <div id="div-sanitystudio-30" className="p-6 text-center text-[var(--on-surface-variant)] flex flex-col items-center gap-2">
              <span className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span>Consultando Sanity...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div id="div-sanitystudio-31" className="p-6 text-center text-[var(--on-surface-variant)] flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-[24px] text-slate-500">inventory_2</span>
              <span>No hay documentos que coincidan con el filtro.</span>
              {activeDocType === 'workspace' ? (
                <button
                  id="btn-sanity-studio-empty-create-workspace"
                  type="button"
                  onClick={handleOpenCreateWorkspaceModal}
                  className="btn-m3-secondary px-3 py-1 text-xs text-emerald-400 cursor-pointer mt-1"
                >
                  Crear primer Workspace en Sanity
                </button>
              ) : (
                <button
                  id="btn-sanity-studio-empty-create-task"
                  type="button"
                  onClick={() => handleOpenCreateTaskModal()}
                  className="btn-m3-secondary px-3 py-1 text-xs text-sky-400 cursor-pointer mt-1"
                >
                  Crear primer Task en Sanity
                </button>
              )}
            </div>
          ) : (
            filteredDocuments.map((doc) => {
              const isSelected = selectedDocId === doc._id;
              const isTask = doc._type === 'task';
              const isWorkspace = doc._type === 'workspace';
              const isCanvas = doc._type === 'canvasVisualState';

              const docTitle = isWorkspace
                ? doc.name || doc.title || doc._id
                : isTask
                ? doc.title || doc._id
                : doc.projectId || doc.title || doc._id;

              return (
                <div
                  key={doc._id}
                  id={`div-sanity-studio-doc-${doc._id}`}
                  onClick={() => {
                    setSelectedDocId(doc._id);
                    setMobilePane('inspector');
                  }}
                  className={`p-3 flex flex-col gap-1.5 transition-colors cursor-pointer border-l-2 ${
                    isSelected
                      ? 'bg-[var(--surface-container-high)] border-l-[var(--primary)]'
                      : 'border-l-transparent hover:bg-[var(--surface-container)]'
                  }`}
                >
                  <div id="div-sanitystudio-32" className="flex items-start justify-between gap-2">
                    <div id="div-sanitystudio-33" className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`material-symbols-outlined text-[16px] shrink-0 ${
                          isWorkspace
                            ? 'text-emerald-400'
                            : isTask
                            ? 'text-sky-400'
                            : 'text-purple-400'
                        }`}
                      >
                        {isWorkspace ? 'workspaces' : isTask ? 'check_box' : 'grid_view'}
                      </span>
                      <span className="font-semibold text-xs text-[var(--on-surface)] truncate">
                        {docTitle}
                      </span>
                    </div>

                    {isTask && doc.priority && (
                      <span className="px-1.5 py-0.2 rounded font-mono text-[9px] font-bold bg-rose-950/60 text-rose-300 border border-rose-800 shrink-0">
                        {doc.priority}
                      </span>
                    )}

                    {isWorkspace && onActivateWorkspace && (
                      <button
                        id={`btn-sanity-studio-activate-ws-${doc._id}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onActivateWorkspace(doc);
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 hover:bg-emerald-800 hover:text-white transition-colors cursor-pointer shrink-0"
                        title="Activar este workspace en el lienzo de la app"
                      >
                        Activar
                      </button>
                    )}
                  </div>

                  {isWorkspace && doc.githubRepo?.fullName && (
                    <div id="div-sanitystudio-34" className="flex items-center gap-1 text-[11px] font-mono text-[var(--on-surface-variant)] truncate">
                      <span className="material-symbols-outlined text-[12px] opacity-70">source</span>
                      <span className="truncate">{doc.githubRepo.fullName}</span>
                      {doc.branches?.length > 0 && (
                        <span className="text-[10px] opacity-60">· {doc.branches.length} ramas</span>
                      )}
                    </div>
                  )}

                  <div id="div-sanitystudio-35" className="flex items-center justify-between text-[10px] text-[var(--on-surface-variant)] font-mono">
                    <span className="truncate max-w-[140px]">
                      {isWorkspace
                        ? doc.workspaceId ? `ws: ${doc.workspaceId}` : `_id: ${doc._id}`
                        : doc.taskId ? `#${doc.taskId}` : `_id: ${doc._id}`}
                    </span>
                    <span className="shrink-0">
                      {doc._updatedAt ? new Date(doc._updatedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ========================================================= */}
      {/* PANE 3: DOCUMENT INSPECTOR & EDITOR */}
      {/* ========================================================= */}
      <main
        className={`flex-1 bg-[var(--surface)] flex flex-col overflow-hidden ${
          mobilePane === 'inspector' ? 'flex' : 'hidden sm:flex'
        }`}
      >
        {!selectedDocId ? (
          <div id="div-sanitystudio-36" className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[var(--on-surface-variant)]">
            <span className="material-symbols-outlined text-[36px] text-slate-600 mb-2">description</span>
            <h4 className="font-semibold text-sm text-[var(--on-surface)] mb-1">Ningún documento seleccionado</h4>
            <p className="text-xs max-w-sm">Selecciona una tarea de la lista para ver sus campos y modificarla en tiempo real en Sanity.</p>
          </div>
        ) : isLoadingDoc ? (
          <div id="div-sanitystudio-37" className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[var(--on-surface-variant)]">
            <span className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-2" />
            <span>Cargando datos del documento desde Sanity...</span>
          </div>
        ) : (
          <div id="div-sanitystudio-38" className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Inspector Top Bar */}
            <div id="div-sanitystudio-39" className="px-4 py-2.5 border-b border-[var(--outline)] bg-[var(--surface-container)] flex items-center justify-between gap-3 shrink-0">
              <div id="div-sanitystudio-40" className="flex items-center gap-2 min-w-0">
                <button
                  id="btn-sanity-studio-back-to-list"
                  type="button"
                  onClick={() => setMobilePane('list')}
                  className="sm:hidden btn-m3-icon w-6 h-6 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                </button>
                <div id="div-sanitystudio-41" className="flex flex-col min-w-0">
                  <div id="div-sanitystudio-42" className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-[var(--on-surface)] truncate">
                      {formState.title || formState._id}
                    </span>
                    <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-[var(--surface)] text-sky-300 border border-[var(--outline)]">
                      {formState._type}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--on-surface-variant)] truncate">
                    _id: {formState._id}
                  </span>
                </div>
              </div>

              {/* View Mode Switcher & Actions */}
              <div id="div-sanitystudio-43" className="flex items-center gap-1.5 shrink-0">
                <div id="div-sanitystudio-44" className="flex items-center bg-[var(--surface)] p-0.5 rounded border border-[var(--outline)]">
                  <button
                    id="btn-sanity-studio-inspector-mode-form"
                    type="button"
                    onClick={() => setInspectorMode('form')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                      inspectorMode === 'form' ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    Formulario
                  </button>
                  <button
                    id="btn-sanity-studio-inspector-mode-json"
                    type="button"
                    onClick={() => setInspectorMode('json')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                      inspectorMode === 'json' ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'text-[var(--on-surface-variant)]'
                    }`}
                  >
                    JSON
                  </button>
                </div>

                <button
                  id="btn-sanity-studio-open-confirm-delete"
                  type="button"
                  onClick={() => setIsConfirmDeleteOpen(true)}
                  disabled={isDeleting}
                  className="btn-m3-secondary px-2.5 py-1 text-xs text-rose-400 border-rose-900/60 hover:bg-rose-950/40 cursor-pointer"
                  title="Eliminar documento de Sanity"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                </button>

                <button
                  id="btn-sanity-studio-save-document"
                  type="button"
                  onClick={handleSaveDocument}
                  disabled={isSaving || !isDirty}
                  className="btn-m3-primary px-3.5 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {isSaving ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
                      <span>Publicar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Inspector Body Pane */}
            <div id="div-sanitystudio-45" className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
              {inspectorMode === 'json' ? (
                <div id="div-sanitystudio-46" className="flex flex-col gap-2">
                  <div id="div-sanitystudio-47" className="flex items-center justify-between text-xs text-[var(--on-surface-variant)]">
                    <span>Documento RAW almacenado en Sanity ({config.dataset}):</span>
                    <button
                      id="btn-sanity-studio-copy-json"
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(formState, null, 2));
                        onShowToast('JSON copiado al portapapeles', 'info');
                      }}
                      className="text-sky-400 hover:underline flex items-center gap-1 cursor-pointer text-[11px]"
                    >
                      <span className="material-symbols-outlined text-[13px]">content_copy</span>
                      <span>Copiar JSON</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded bg-black/60 border border-[var(--outline)] font-mono text-[11px] text-emerald-300 overflow-x-auto leading-relaxed select-text whitespace-pre-wrap">
                    {JSON.stringify(formState, null, 2)}
                  </pre>
                </div>
              ) : formState._type === 'workspace' ? (
                /* WORKSPACE STRUCTURE FORM INSPECTOR */
                <div id="div-sanitystudio-48" className="flex flex-col gap-4 max-w-3xl">
                  {/* Workspace Top Banner & App Activation */}
                  <div id="div-sanitystudio-49" className="p-3 rounded-md bg-[var(--surface-container-high)] border border-[var(--outline)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div id="div-sanitystudio-50" className="flex items-center gap-3 min-w-0">
                      <div id="div-sanitystudio-51" className="w-8 h-8 rounded-md bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-center text-[var(--on-surface)] shrink-0">
                        <span className="material-symbols-outlined text-[20px]">workspaces</span>
                      </div>
                      <div id="div-sanitystudio-52" className="flex flex-col min-w-0">
                        <div id="div-sanitystudio-53" className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[var(--on-surface)] truncate">
                            {formState.name || 'Workspace sin nombre'}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--surface)] text-[var(--on-surface-variant)] border border-[var(--outline)] shrink-0">
                            Sanity Workspace
                          </span>
                        </div>
                        <span className="text-xs text-[var(--on-surface-variant)] truncate font-mono">
                          {formState.githubRepo?.fullName || 'Sin repositorio vinculado'} · {formState.branches?.length || 0} ramas
                        </span>
                      </div>
                    </div>

                    {onActivateWorkspace && (
                      <button
                        id="btn-sanity-studio-load-ws-app"
                        type="button"
                        onClick={() => onActivateWorkspace(formState)}
                        className="btn-m3-primary bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
                      >
                        <span className="material-symbols-outlined text-[16px]">play_circle</span>
                        <span>Cargar este Workspace en la App</span>
                      </button>
                    )}
                  </div>

                  {/* Section 1: General Info */}
                  <div id="div-sanitystudio-54" className="p-3.5 rounded-md border border-[var(--outline)] bg-[var(--surface-container)] flex flex-col gap-3">
                    <div id="div-sanitystudio-55" className="flex items-center gap-2 border-b border-[var(--outline)] pb-2">
                      <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">info</span>
                      <span className="font-semibold text-xs text-[var(--on-surface)]">Información General</span>
                    </div>

                    <div id="div-sanitystudio-56" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div id="div-sanitystudio-57" className="flex flex-col gap-1">
                        <label className="font-semibold text-xs text-[var(--on-surface)]">Nombre del Workspace</label>
                        <input
                          type="text"
                          value={formState.name || ''}
                          onChange={(e) => handleFormFieldChange('name', e.target.value)}
                          className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                        />
                      </div>

                      <div id="div-sanitystudio-58" className="flex flex-col gap-1">
                        <label className="font-semibold text-xs text-[var(--on-surface)]">Workspace ID</label>
                        <input
                          type="text"
                          value={formState.workspaceId || ''}
                          onChange={(e) => handleFormFieldChange('workspaceId', e.target.value)}
                          className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: GitHub Repository */}
                  <div id="div-sanitystudio-59" className="p-3.5 rounded-md border border-[var(--outline)] bg-[var(--surface-container)] flex flex-col gap-3">
                    <div id="div-sanitystudio-60" className="flex items-center justify-between border-b border-[var(--outline)] pb-2">
                      <div id="div-sanitystudio-61" className="flex items-center gap-2">
                        <svg className="w-4 h-4 fill-current text-[var(--on-surface)] shrink-0" viewBox="0 0 24 24">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span className="font-semibold text-xs text-[var(--on-surface)]">Repositorio GitHub Vinculado</span>
                      </div>
                      {formState.githubRepo?.url && (
                        <a
                          href={formState.githubRepo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[var(--primary)] hover:underline flex items-center gap-1 font-mono"
                        >
                          <span>Ver en GitHub</span>
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                      )}
                    </div>

                    <div id="div-sanitystudio-62" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div id="div-sanitystudio-63" className="flex flex-col gap-1">
                        <label className="font-semibold text-xs text-[var(--on-surface)]">Repositorio (owner/repo)</label>
                        <input
                          type="text"
                          value={formState.githubRepo?.fullName || ''}
                          onChange={(e) => {
                            const full = e.target.value;
                            const [owner, repo] = full.split('/');
                            handleFormFieldChange('githubRepo', {
                              ...formState.githubRepo,
                              fullName: full,
                              owner: owner || formState.githubRepo?.owner || '',
                              repo: repo || formState.githubRepo?.repo || '',
                              url: `https://github.com/${full}`,
                            });
                          }}
                          placeholder="usuario/repositorio"
                          className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                        />
                      </div>

                      <div id="div-sanitystudio-64" className="flex flex-col gap-1">
                        <label className="font-semibold text-xs text-[var(--on-surface)]">Rama principal por defecto</label>
                        <input
                          type="text"
                          value={formState.githubRepo?.defaultBranch || 'main'}
                          onChange={(e) =>
                            handleFormFieldChange('githubRepo', {
                              ...formState.githubRepo,
                              defaultBranch: e.target.value,
                            })
                          }
                          placeholder="main"
                          className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div id="div-sanitystudio-65" className="flex flex-col gap-1">
                      <label className="font-semibold text-xs text-[var(--on-surface)]">Descripción del repositorio</label>
                      <input
                        type="text"
                        value={formState.githubRepo?.description || ''}
                        onChange={(e) =>
                          handleFormFieldChange('githubRepo', {
                            ...formState.githubRepo,
                            description: e.target.value,
                          })
                        }
                        placeholder="Descripción del proyecto..."
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Section 3: Branches & Task Documents in Sanity */}
                  <div id="div-sanitystudio-66" className="p-3.5 rounded-md border border-[var(--outline)] bg-[var(--surface-container)] flex flex-col gap-3">
                    <div id="div-sanitystudio-67" className="flex items-center justify-between border-b border-[var(--outline)] pb-2">
                      <div id="div-sanitystudio-68" className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">fork_right</span>
                        <span className="font-semibold text-xs text-[var(--on-surface)]">
                          Estructura de Ramas & Archivos Task MD ({formState.branches?.length || 0})
                        </span>
                      </div>
                      <div id="div-sanitystudio-69" className="flex items-center gap-1.5 text-xs">
                        <span className="text-[var(--on-surface-variant)]">Rama activa:</span>
                        <select
                          value={formState.activeBranchName || 'main'}
                          onChange={(e) => handleFormFieldChange('activeBranchName', e.target.value)}
                          className="bg-[var(--surface)] border border-[var(--outline)] rounded px-2 py-0.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none cursor-pointer"
                        >
                          {(formState.branches || []).map((b: any) => (
                            <option key={b.name} value={b.name}>
                              {b.name} {b.isProtected ? '(protegida)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div id="div-sanitystudio-70" className="flex flex-col gap-2.5">
                      {(formState.branches || []).map((branch: any, bIdx: number) => {
                        const isCurrentActive = branch.name === formState.activeBranchName;
                        return (
                          <div
                            key={branch.name || bIdx}
                            id={`div-sanity-studio-branch-${bIdx}`}
                            className={`p-3 rounded border flex flex-col gap-2 transition-colors ${
                              isCurrentActive
                                ? 'bg-[var(--surface)] border-[var(--primary)]/60'
                                : 'bg-[var(--surface)]/60 border-[var(--outline)]'
                            }`}
                          >
                            <div id="div-sanitystudio-71" className="flex items-center justify-between gap-2">
                              <div id="div-sanitystudio-72" className="flex items-center gap-2 min-w-0">
                                <span className="material-symbols-outlined text-[16px] text-sky-400">fork_right</span>
                                <span className="font-mono font-semibold text-xs text-[var(--on-surface)] truncate">
                                  {branch.name}
                                </span>
                                {isCurrentActive && (
                                  <span className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 text-[9px] font-mono border border-sky-800">
                                    Activa
                                  </span>
                                )}
                                {branch.isProtected && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 text-[9px] font-mono border border-amber-800">
                                    Protegida
                                  </span>
                                )}
                              </div>

                              <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
                                {branch.taskDocuments?.length || 0} archivo(s) .md
                              </span>
                            </div>

                            {branch.lastCommit && (
                              <div id="div-sanitystudio-73" className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--on-surface-variant)] bg-[var(--surface-container)] p-1.5 rounded">
                                <span className="material-symbols-outlined text-[12px] text-purple-400">commit</span>
                                <span className="text-purple-300">[{branch.lastCommit.hash?.substring(0, 7)}]</span>
                                <span className="truncate">{branch.lastCommit.message}</span>
                              </div>
                            )}

                            {/* Task Documents List */}
                            <div id="div-sanitystudio-74" className="flex flex-col gap-1.5 mt-1">
                              {(branch.taskDocuments || []).map((doc: any, dIdx: number) => (
                                <div
                                  key={doc.id || dIdx}
                                  id={`div-sanity-studio-branch-doc-${dIdx}`}
                                  className="p-2 rounded bg-[var(--surface-container-high)]/60 border border-[var(--outline)] flex items-start justify-between gap-2 text-xs"
                                >
                                  <div id="div-sanitystudio-75" className="flex flex-col min-w-0 flex-1">
                                    <div id="div-sanitystudio-76" className="flex items-center gap-1.5">
                                      <span className="material-symbols-outlined text-[14px] text-amber-400">description</span>
                                      <span className="font-mono font-medium text-[var(--on-surface)] truncate">
                                        {doc.path || doc.name}
                                      </span>
                                      {doc.folder && (
                                        <span className="text-[10px] font-mono px-1 rounded bg-[var(--surface)] text-[var(--on-surface-variant)]">
                                          📁 {doc.folder}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] font-mono text-[var(--on-surface-variant)] mt-0.5">
                                      {(doc.content || '').split('\n').length} líneas · {(doc.content || '').length} bytes
                                    </span>
                                  </div>

                                  <div id="div-sanitystudio-77" className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0">
                                    {doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString() : ''}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 4: Linked Tasks in this Workspace */}
                  {(() => {
                    const wsId = formState.workspaceId || formState._id?.replace(/^workspace-/, '');
                    const linkedTasks = documents.filter(
                      (d) =>
                        d._type === 'task' &&
                        (d.workspaceId === wsId || d.workspace?._ref === formState._id || d.workspaceId === formState._id)
                    );

                    return (
                      <div id="div-sanitystudio-78" className="p-3.5 rounded-md border border-[var(--outline)] bg-[var(--surface-container)] flex flex-col gap-3">
                        <div id="div-sanitystudio-79" className="flex items-center justify-between border-b border-[var(--outline)] pb-2">
                          <div id="div-sanitystudio-80" className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">check_box</span>
                            <span className="font-semibold text-xs text-[var(--on-surface)]">
                              Tareas asociadas a este Workspace ({linkedTasks.length})
                            </span>
                          </div>

                          <button
                            id="btn-sanity-studio-create-task-in-ws"
                            type="button"
                            onClick={() => handleOpenCreateTaskModal(wsId)}
                            className="btn-m3-primary px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">add</span>
                            <span>+ Crear Tarea en este Workspace</span>
                          </button>
                        </div>

                        {linkedTasks.length === 0 ? (
                          <div id="div-sanitystudio-81" className="p-3 text-center text-[var(--on-surface-variant)] text-xs">
                            No hay tareas de tipo <code className="font-mono text-sky-300">task</code> asignadas explícitamente a este workspace todavía.
                          </div>
                        ) : (
                          <div id="div-sanitystudio-82" className="divide-y divide-[var(--outline)] rounded border border-[var(--outline)] bg-[var(--surface)]">
                            {linkedTasks.map((t) => (
                              <div
                                key={t._id}
                                id={`div-sanity-studio-linked-task-${t._id}`}
                                onClick={() => {
                                  setSelectedDocId(t._id);
                                  setActiveDocType('task');
                                }}
                                className="p-2 flex items-center justify-between gap-2 hover:bg-[var(--surface-container-high)] cursor-pointer text-xs"
                              >
                                <div id="div-sanitystudio-83" className="flex items-center gap-2 min-w-0">
                                  <span className={`w-2 h-2 rounded-full ${t.completed ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                  <span className="font-medium text-[var(--on-surface)] truncate">
                                    {t.title || t._id}
                                  </span>
                                  {t.priority && (
                                    <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-[var(--surface-container)] text-sky-300 border border-[var(--outline)]">
                                      {t.priority}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0">
                                  #{t.taskId || t._id}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : formState._type === 'task' ? (
                /* TASK FORM FIELDS (Matching Task Schema) */
                <div id="div-sanitystudio-84" className="flex flex-col gap-3.5 max-w-2xl">
                  {/* Task Title */}
                  <div id="div-sanitystudio-85" className="flex flex-col gap-1">
                    <label className="font-semibold text-xs text-[var(--on-surface)]">Título de la tarea</label>
                    <input
                      type="text"
                      value={formState.title || ''}
                      onChange={(e) => handleFormFieldChange('title', e.target.value)}
                      className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                    />
                  </div>

                  {/* Workspace Association Selector */}
                  <div id="div-sanitystudio-86" className="flex flex-col gap-1">
                    <label className="font-semibold text-xs text-[var(--on-surface)] flex items-center justify-between">
                      <span>Workspace Asociado</span>
                      {formState.workspaceId && (
                        <span className="text-[10px] font-mono text-emerald-400">
                          ID: {formState.workspaceId}
                        </span>
                      )}
                    </label>
                    <select
                      value={formState.workspaceId || formState.workspace?._ref || ''}
                      onChange={(e) => {
                        const selectedVal = e.target.value;
                        const targetWs = availableWorkspaces.find(
                          (w) => w.workspaceId === selectedVal || w._id === selectedVal
                        );
                        handleFormFieldChange('workspaceId', targetWs ? (targetWs.workspaceId || targetWs._id.replace(/^workspace-/, '')) : selectedVal);
                        handleFormFieldChange('workspace', targetWs ? { _type: 'reference', _ref: targetWs._id } : undefined);
                      }}
                      className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Sin Workspace asignado (General) --</option>
                      {availableWorkspaces.map((ws) => (
                        <option key={ws._id} value={ws.workspaceId || ws._id}>
                          🏢 {ws.name || ws._id} {ws.githubRepo?.fullName ? `(${ws.githubRepo.fullName})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Task ID and Group */}
                  <div id="div-sanitystudio-87" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div id="div-sanitystudio-88" className="flex flex-col gap-1">
                      <label className="font-semibold text-xs text-[var(--on-surface)]">Task ID (Identificador)</label>
                      <input
                        type="text"
                        value={formState.taskId || ''}
                        onChange={(e) => handleFormFieldChange('taskId', e.target.value)}
                        className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                      />
                    </div>

                    <div id="div-sanitystudio-89" className="flex flex-col gap-1">
                      <label className="font-semibold text-xs text-[var(--on-surface)]">Sección / Grupo</label>
                      <input
                        type="text"
                        value={formState.groupTitle || ''}
                        onChange={(e) => handleFormFieldChange('groupTitle', e.target.value)}
                        className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Priority & Status */}
                  <div id="div-sanitystudio-90" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div id="div-sanitystudio-91" className="flex flex-col gap-1">
                      <label className="font-semibold text-xs text-[var(--on-surface)]">Prioridad</label>
                      <div id="div-sanitystudio-92" className="grid grid-cols-4 gap-1.5">
                        {['P0', 'P1', 'P2', 'P3'].map((p) => (
                          <button
                            key={p}
                            id={`btn-sanity-studio-priority-${p}`}
                            type="button"
                            onClick={() => handleFormFieldChange('priority', p)}
                            className={`py-1 rounded font-mono text-xs border text-center cursor-pointer ${
                              formState.priority === p
                                ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold border-[var(--primary)]'
                                : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)]'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div id="div-sanitystudio-93" className="flex flex-col gap-1">
                      <label className="font-semibold text-xs text-[var(--on-surface)]">Estado Kanban</label>
                      <select
                        value={formState.status || (formState.completed ? 'done' : 'todo')}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleFormFieldChange('status', val);
                          handleFormFieldChange('completed', val === 'done');
                        }}
                        className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none cursor-pointer"
                      >
                        <option value="todo">Por hacer (Todo)</option>
                        <option value="in_progress">En progreso (In Progress)</option>
                        <option value="blocked">Bloqueada (Blocked)</option>
                        <option value="done">Completada (Done)</option>
                      </select>
                    </div>
                  </div>

                  {/* BlockedBy DAG Dependency */}
                  <div id="div-sanitystudio-94" className="flex flex-col gap-1">
                    <label className="font-semibold text-xs text-[var(--on-surface)]">
                      Bloqueada por (blockedBy - Task ID)
                    </label>
                    <input
                      type="text"
                      value={formState.blockedBy || ''}
                      onChange={(e) => handleFormFieldChange('blockedBy', e.target.value)}
                      placeholder="ej. oauth, setup-db"
                      className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                    />
                  </div>

                  {/* Tags */}
                  <div id="div-sanitystudio-95" className="flex flex-col gap-1.5">
                    <label className="font-semibold text-xs text-[var(--on-surface)]">Etiquetas (#tags)</label>
                    <div id="div-sanitystudio-96" className="flex items-center gap-1.5 flex-wrap">
                      {(Array.isArray(formState.tags) ? formState.tags : []).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-700/60 text-sky-300 font-mono text-[10px] flex items-center gap-1"
                        >
                          <span>#{tag}</span>
                          <button
                            id={`btn-sanity-studio-remove-tag-${tag}`}
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="hover:text-white cursor-pointer"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <div id="div-sanitystudio-97" className="flex items-center gap-1">
                        <input
                          type="text"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddTag();
                            }
                          }}
                          placeholder="+ tag"
                          className="w-20 bg-[var(--surface-container)] border border-[var(--outline)] rounded px-2 py-0.5 text-[10px] font-mono text-[var(--on-surface)] focus:outline-none"
                        />
                        <button
                          id="btn-sanity-studio-add-tag"
                          type="button"
                          onClick={handleAddTag}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--surface-container)] border border-[var(--outline)] cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Subtasks Checklist */}
                  <div id="div-sanitystudio-98" className="flex flex-col gap-1.5">
                    <label className="font-semibold text-xs text-[var(--on-surface)]">Subtareas (Checklist)</label>
                    <div id="div-sanitystudio-99" className="divide-y divide-[var(--outline)] rounded border border-[var(--outline)] bg-[var(--surface-container)]">
                      {(Array.isArray(formState.subtasks) ? formState.subtasks : []).map(
                        (sub: any, idx: number) => (
                          <div id="div-sanitystudio-100" key={idx} className="p-2 flex items-center justify-between gap-2 text-xs">
                            <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(sub.completed)}
                                onChange={() => handleToggleSubtask(idx)}
                                className="w-3.5 h-3.5 accent-[var(--primary)] cursor-pointer"
                              />
                              <span className={sub.completed ? 'line-through opacity-60' : ''}>
                                {sub.title}
                              </span>
                            </label>
                            <button
                              id={`btn-sanity-studio-remove-subtask-${idx}`}
                              type="button"
                              onClick={() => handleRemoveSubtask(idx)}
                              className="text-rose-400 hover:text-rose-300 text-xs cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        )
                      )}
                      <div id="div-sanitystudio-101" className="p-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSubtask();
                            }
                          }}
                          placeholder="Añadir nueva subtarea..."
                          className="flex-1 bg-[var(--surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs text-[var(--on-surface)] focus:outline-none"
                        />
                        <button
                          id="btn-sanity-studio-add-subtask"
                          type="button"
                          onClick={handleAddSubtask}
                          className="btn-m3-secondary px-2.5 py-1 text-xs cursor-pointer"
                        >
                          Añadir
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Description / Notes */}
                  <div id="div-sanitystudio-102" className="flex flex-col gap-1">
                    <label className="font-semibold text-xs text-[var(--on-surface)]">Descripción / Notas</label>
                    <textarea
                      rows={3}
                      value={formState.description || ''}
                      onChange={(e) => handleFormFieldChange('description', e.target.value)}
                      placeholder="Detalles de la tarea..."
                      className="w-full bg-[var(--surface-container)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                    />
                  </div>

                  {/* Import to Markdown Action */}
                  {onImportTaskToMarkdown && (
                    <div id="div-sanitystudio-103" className="p-3 rounded bg-[var(--surface-container)] border border-[var(--outline)] flex items-center justify-between gap-3 mt-2">
                      <div id="div-sanitystudio-104" className="flex flex-col">
                        <span className="font-semibold text-xs text-[var(--on-surface)]">Sincronizar con TASKS.md</span>
                        <span className="text-[11px] text-[var(--on-surface-variant)]">
                          Importa esta tarea de Sanity al archivo local y lienzo
                        </span>
                      </div>
                      <button
                        id="btn-sanity-studio-import-to-markdown"
                        type="button"
                        onClick={() => onImportTaskToMarkdown(formState)}
                        className="btn-m3-secondary px-3 py-1.5 text-xs flex items-center gap-1 cursor-pointer text-emerald-400 border-emerald-800/60"
                      >
                        <span className="material-symbols-outlined text-[14px]">file_download</span>
                        <span>Importar al lienzo</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* CANVAS VISUAL STATE INSPECTOR */
                <div id="div-sanitystudio-105" className="flex flex-col gap-3">
                  <div id="div-sanitystudio-106" className="p-3 rounded bg-[var(--surface-container)] border border-[var(--outline)]">
                    <span className="font-semibold text-xs text-[var(--on-surface)]">
                      Coordenadas espaciales del lienzo ({Array.isArray(formState.tasks) ? formState.tasks.length : 0} tarjetas registradas)
                    </span>
                  </div>

                  <pre className="p-3 rounded bg-black/60 border border-[var(--outline)] font-mono text-[11px] text-purple-300 overflow-x-auto leading-relaxed select-text whitespace-pre-wrap">
                    {JSON.stringify(formState, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal: Crear Workspace Estructurado en Sanity */}
      {isCreateWsOpen && (
        <div
          id="modal-sanity-studio-create-ws-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-fade-in"
          onClick={() => setIsCreateWsOpen(false)}
        >
          <div
            id="modal-sanity-studio-create-ws-dialog"
            className="w-full max-w-md bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-sanitystudio-107" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <div id="div-sanitystudio-108" className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">workspaces</span>
                <h3 className="text-xs font-semibold text-[var(--on-surface)]">
                  Nuevo Workspace en Sanity Studio
                </h3>
              </div>
              <button
                id="btn-sanity-studio-create-ws-close-header"
                type="button"
                onClick={() => setIsCreateWsOpen(false)}
                className="btn-m3-icon w-6 h-6 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>

            <form onSubmit={handleExecuteCreateWorkspace} className="p-4 flex flex-col gap-3">
              <div id="div-sanitystudio-109" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">
                  Nombre del Workspace
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="ej. Ecommerce Platform, Backend API..."
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-sanitystudio-110" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">
                  Repositorio de GitHub (owner/repo)
                </label>
                <input
                  type="text"
                  required
                  value={newWsRepo}
                  onChange={(e) => setNewWsRepo(e.target.value)}
                  placeholder="ej. org/mi-proyecto o https://github.com/..."
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-sanitystudio-111" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">
                  Rama principal
                </label>
                <input
                  type="text"
                  value={newWsBranch}
                  onChange={(e) => setNewWsBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-sanitystudio-112" className="pt-2 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-sanity-studio-create-ws-cancel"
                  type="button"
                  onClick={() => setIsCreateWsOpen(false)}
                  className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-sanity-studio-create-ws-submit"
                  type="submit"
                  disabled={!newWsName.trim() || !newWsRepo.trim()}
                  className="btn-m3-primary bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs cursor-pointer shadow-sm disabled:opacity-50"
                >
                  Crear en Sanity
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Crear Tarea en Sanity */}
      {isCreateTaskOpen && (
        <div
          id="modal-sanity-studio-create-task-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-fade-in"
          onClick={() => setIsCreateTaskOpen(false)}
        >
          <div
            id="modal-sanity-studio-create-task-dialog"
            className="w-full max-w-sm bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-sanitystudio-113" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <div id="div-sanitystudio-114" className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[var(--primary)]">check_box</span>
                <h3 className="text-xs font-semibold text-[var(--on-surface)]">
                  Nuevo Documento de Tarea en Sanity
                </h3>
              </div>
              <button
                id="btn-sanity-studio-create-task-close-header"
                type="button"
                onClick={() => setIsCreateTaskOpen(false)}
                className="btn-m3-icon w-6 h-6 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>

            <form onSubmit={handleExecuteCreateTask} className="p-4 flex flex-col gap-3">
              <div id="div-sanitystudio-115" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">
                  Workspace Asociado
                </label>
                <select
                  value={newTaskWorkspaceId}
                  onChange={(e) => setNewTaskWorkspaceId(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none cursor-pointer"
                >
                  <option value="">-- Sin Workspace específico (General) --</option>
                  {availableWorkspaces.map((ws) => (
                    <option key={ws._id} value={ws.workspaceId || ws._id}>
                      🏢 {ws.name || ws._id} {ws.githubRepo?.fullName ? `(${ws.githubRepo.fullName})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section / Group Selector */}
              {(() => {
                const availableSecs = Array.from(
                  new Set(
                    documents
                      .filter((d) => d._type === 'task' && d.groupTitle && typeof d.groupTitle === 'string')
                      .map((d) => (d.groupTitle as string).trim())
                      .filter(Boolean)
                  )
                );

                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px] text-[var(--primary)]">folder</span>
                        <span>Sección / Grupo</span>
                      </label>
                      {availableSecs.length > 0 && (
                        <div className="inline-flex rounded-md p-0.5 bg-[var(--surface-container-high)] border border-[var(--outline)]">
                          <button
                            type="button"
                            onClick={() => setIsCustomTaskSectionInput(false)}
                            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                              !isCustomTaskSectionInput
                                ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                                : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                            }`}
                          >
                            Existente
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCustomTaskSectionInput(true)}
                            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                              isCustomTaskSectionInput
                                ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-xs'
                                : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                            }`}
                          >
                            + Nueva
                          </button>
                        </div>
                      )}
                    </div>

                    {!isCustomTaskSectionInput && availableSecs.length > 0 ? (
                      <select
                        value={newTaskSectionInput}
                        onChange={(e) => {
                          if (e.target.value === '__CREATE_NEW_SECTION__') {
                            setIsCustomTaskSectionInput(true);
                            setCustomTaskSectionInput('');
                          } else {
                            setNewTaskSectionInput(e.target.value);
                          }
                        }}
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none cursor-pointer"
                      >
                        {availableSecs.map((sec) => (
                          <option key={sec} value={sec}>
                            📁 {sec}
                          </option>
                        ))}
                        <option value="__CREATE_NEW_SECTION__" className="text-[var(--primary)] font-medium">
                          ➕ + Crear nueva sección...
                        </option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        autoFocus={isCustomTaskSectionInput}
                        value={customTaskSectionInput}
                        onChange={(e) => setCustomTaskSectionInput(e.target.value)}
                        placeholder="ej. Backend, Pagos, Autenticación..."
                        className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                      />
                    )}
                  </div>
                );
              })()}

              <div id="div-sanitystudio-116" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">
                  Título de la tarea
                </label>
                <input
                  type="text"
                  required
                  autoFocus={!isCustomTaskSectionInput}
                  value={newTaskTitleInput}
                  onChange={(e) => setNewTaskTitleInput(e.target.value)}
                  placeholder="ej. Implementar OAuth..."
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              <div id="div-sanitystudio-117" className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--on-surface)]">Prioridad</label>
                <div id="div-sanitystudio-118" className="grid grid-cols-4 gap-1.5">
                  {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
                    <button
                      key={p}
                      id={`btn-sanity-studio-new-task-priority-${p}`}
                      type="button"
                      onClick={() => setNewTaskPriorityInput(p)}
                      className={`py-1 rounded font-mono text-xs border text-center cursor-pointer ${
                        newTaskPriorityInput === p
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold border-[var(--primary)]'
                          : 'bg-[var(--surface)] text-[var(--on-surface-variant)] border-[var(--outline)]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div id="div-sanitystudio-119" className="pt-2 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
                <button
                  id="btn-sanity-studio-create-task-cancel"
                  type="button"
                  onClick={() => setIsCreateTaskOpen(false)}
                  className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-sanity-studio-create-task-submit"
                  type="submit"
                  disabled={!newTaskTitleInput.trim()}
                  className="btn-m3-primary px-3.5 py-1.5 text-xs cursor-pointer shadow-sm disabled:opacity-50"
                >
                  Crear Tarea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmación de Eliminación Seguro */}
      {isConfirmDeleteOpen && (
        <div
          id="modal-sanity-studio-confirm-delete-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-fade-in"
          onClick={() => setIsConfirmDeleteOpen(false)}
        >
          <div
            id="modal-sanity-studio-confirm-delete-dialog"
            className="w-full max-w-sm bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="div-sanitystudio-120" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
              <div id="div-sanitystudio-121" className="flex items-center gap-2 text-rose-400">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                <h3 className="text-xs font-semibold">Eliminar de Sanity</h3>
              </div>
              <button
                id="btn-sanity-studio-confirm-delete-close-header"
                type="button"
                onClick={() => setIsConfirmDeleteOpen(false)}
                className="btn-m3-icon w-6 h-6 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>

            <div id="div-sanitystudio-122" className="p-4 flex flex-col gap-2 text-xs text-[var(--on-surface-variant)]">
              <p>
                ¿Estás seguro de eliminar el documento <strong className="text-[var(--on-surface)]">"{formState.name || formState.title || selectedDocId}"</strong> ({formState._type}) de Sanity?
              </p>
              <p className="text-[11px] text-rose-400/80">Esta acción no se puede deshacer en el dataset remoto.</p>
            </div>

            <div id="div-sanitystudio-123" className="px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-end gap-2">
              <button
                id="btn-sanity-studio-confirm-delete-cancel"
                type="button"
                onClick={() => setIsConfirmDeleteOpen(false)}
                className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                id="btn-sanity-studio-confirm-delete-confirm"
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer shadow-sm"
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};
