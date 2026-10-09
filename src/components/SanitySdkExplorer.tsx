import React, { Suspense, useState, useMemo, useCallback } from 'react';
import {
  SanityApp,
  useDocuments,
  useQuery,
  useDocument,
  useCreateDocument,
  useEditDocument,
  useDocumentSyncStatus,
  useDocumentEvent,
  CORE_SDK_VERSION,
  type DocumentHandle,
  type DocumentEvent,
} from '@sanity/sdk-react';
import { getSanityConfig, SanityConfig, sanitizeSanityDocId } from '../services/sanityService';
import {
  Database,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Code2,
  CheckCircle2,
  AlertCircle,
  Activity,
  Check,
  Edit3,
  Terminal,
  Zap,
  ArrowRight,
  FolderSync,
  Layers,
} from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SdkErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('Sanity App SDK Error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

export interface SanitySdkExplorerProps {
  onOpenSanityConfig: () => void;
  onSwitchToDeskTool?: () => void;
  onSwitchToNativeStudio?: () => void;
  onImportTaskToMarkdown?: (task: any) => void;
  onActivateWorkspace?: (workspace: any) => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
}

// -------------------------------------------------------------
// Live Document Event Listener using `useDocumentEvent` hook
// -------------------------------------------------------------
function SdkDocumentEventListener({
  onEventReceived,
}: {
  onEventReceived: (evt: DocumentEvent) => void;
}) {
  useDocumentEvent({
    onEvent: (event) => {
      onEventReceived(event);
    },
  });
  return null;
}

// -------------------------------------------------------------
// Single Document Inspector using `useDocument` & `useEditDocument`
// -------------------------------------------------------------
function SdkDocumentInspector({
  handle,
  onClose,
  onImportTaskToMarkdown,
  onActivateWorkspace,
  onShowToast,
  activeWorkspaceId,
}: {
  handle: DocumentHandle;
  onClose: () => void;
  onImportTaskToMarkdown?: (task: any) => void;
  onActivateWorkspace?: (workspace: any) => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  activeWorkspaceId?: string;
}) {
  const { data: document } = useDocument<any>({
    documentId: handle.documentId,
    documentType: handle.documentType,
  });
  const isSynced = useDocumentSyncStatus(handle);
  const editDocument = useEditDocument<any>({
    documentId: handle.documentId,
    documentType: handle.documentType,
  });

  const [editTitle, setEditTitle] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sync form edit state with live document updates
  React.useEffect(() => {
    if (document) {
      setEditTitle(document.title || document.name || '');
      setEditStatus(document.status || (document.completed ? 'done' : 'todo'));
    }
  }, [document]);

  if (!document) {
    return (
      <div id="div-sanitysdkexplorer-1" className="p-4 bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" />
        Sincronizando documento reactivo {handle.documentId}...
      </div>
    );
  }

  const handleApplyQuickEdit = async () => {
    setIsSaving(true);
    try {
      const cleanWs = activeWorkspaceId
        ? sanitizeSanityDocId(activeWorkspaceId.replace(/^workspace-/, ''))
        : undefined;
      await editDocument((current: any) => ({
        ...current,
        title: editTitle,
        name: editTitle,
        status: editStatus,
        completed: editStatus === 'done',
        workspaceId: current?.workspaceId || cleanWs,
        ...(cleanWs && !current?.workspace ? { workspace: { _type: 'reference', _ref: `workspace-${cleanWs}` } } : {}),
        updatedAt: new Date().toISOString(),
      }));
      setIsEditing(false);
      onShowToast('Documento actualizado reactivamente vía useEditDocument', 'success');
    } catch (err: any) {
      onShowToast(err?.message || 'Error al actualizar', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const isTask = handle.documentType === 'task';
  const isWorkspace = handle.documentType === 'workspace';

  return (
    <div id="div-sanitysdkexplorer-2" className="bg-neutral-900 border border-neutral-800 p-4 space-y-4">
      {/* Header */}
      <div id="div-sanitysdkexplorer-3" className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
        <div id="div-sanitysdkexplorer-4" className="space-y-1 min-w-0">
          <div id="div-sanitysdkexplorer-5" className="flex items-center gap-2 text-xs font-mono text-neutral-400">
            <span className="text-emerald-400 font-semibold">{handle.documentType}</span>
            <span>·</span>
            <span className="truncate max-w-[200px]">{handle.documentId}</span>
            <span>·</span>
            <span className={isSynced ? 'text-emerald-400' : 'text-amber-400'}>
              {isSynced ? 'Sincronizado' : 'Pendiente'}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-neutral-100 truncate">
            {document.title || document.name || handle.documentId}
          </h3>
        </div>
        <button
          id="btn-sanity-sdk-close-inspector"
          onClick={onClose}
          className="text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 transition"
        >
          Cerrar
        </button>
      </div>

      {/* Integration Actions */}
      <div id="div-sanitysdkexplorer-6" className="flex flex-wrap gap-2">
        {isTask && onImportTaskToMarkdown && (
          <button
            id="btn-sanity-sdk-import-task"
            onClick={() => onImportTaskToMarkdown(document)}
            className="px-3 py-1.5 text-xs bg-emerald-800 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition"
            title="Importar al archivo TASKS.md activo"
          >
            <ArrowRight className="w-3 h-3" />
            Importar tarea a TASKS.md
          </button>
        )}
        {isWorkspace && onActivateWorkspace && (
          <button
            id="btn-sanity-sdk-activate-workspace"
            onClick={() => onActivateWorkspace(document)}
            className="px-3 py-1.5 text-xs bg-sky-800 hover:bg-sky-700 text-white flex items-center gap-1.5 transition"
            title="Activar como Workspace activo de la app"
          >
            <FolderSync className="w-3 h-3" />
            Activar como Workspace
          </button>
        )}
      </div>

      {/* Quick Edit Form */}
      {isEditing ? (
        <div id="div-sanitysdkexplorer-7" className="space-y-3 p-3 bg-neutral-950 border border-neutral-800">
          <div id="div-sanity-sdk-edit-title-group">
            <label className="text-[11px] uppercase tracking-wider text-neutral-400 font-mono block mb-1">
              Título / Nombre
            </label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-neutral-500 font-mono"
            />
          </div>
          {isTask && (
            <div id="div-sanity-sdk-edit-status-group">
              <label className="text-[11px] uppercase tracking-wider text-neutral-400 font-mono block mb-1">
                Estado
              </label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-neutral-500 font-mono"
              >
                <option value="todo">Por hacer (todo)</option>
                <option value="in_progress">En progreso (in_progress)</option>
                <option value="blocked">Bloqueada (blocked)</option>
                <option value="done">Completada (done)</option>
              </select>
            </div>
          )}
          <div id="div-sanitysdkexplorer-8" className="flex gap-2 justify-end pt-1">
            <button
              id="btn-sanity-sdk-cancel-quick-edit"
              onClick={() => setIsEditing(false)}
              className="px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700"
            >
              Cancelar
            </button>
            <button
              id="btn-sanity-sdk-save-quick-edit"
              onClick={handleApplyQuickEdit}
              disabled={isSaving}
              className="px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white font-medium flex items-center gap-1.5"
            >
              {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Guardar con useEditDocument
            </button>
          </div>
        </div>
      ) : (
        <div id="div-sanitysdkexplorer-9" className="flex items-center justify-between">
          <div id="div-sanitysdkexplorer-10" className="text-xs text-neutral-400">
            Última actualización:{' '}
            <span className="font-mono text-neutral-300">
              {document.updatedAt || document._updatedAt || 'Reciente'}
            </span>
          </div>
          <button
            id="btn-sanity-sdk-open-quick-edit"
            onClick={() => setIsEditing(true)}
            className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1.5 transition"
          >
            <Edit3 className="w-3 h-3" />
            Editar con useEditDocument
          </button>
        </div>
      )}

      {/* JSON Payload Inspector */}
      <div id="div-sanity-sdk-payload-inspector">
        <div id="div-sanitysdkexplorer-11" className="text-[11px] uppercase tracking-wider text-neutral-400 font-mono mb-1.5 flex items-center gap-1.5">
          <Code2 className="w-3.5 h-3.5 text-neutral-500" />
          Estado reactivo en memoria (Content Lake)
        </div>
        <pre className="bg-neutral-950 border border-neutral-800 p-2.5 text-[11px] font-mono text-neutral-300 overflow-x-auto max-h-56">
          {JSON.stringify(document, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Live Document List using `useDocuments` hook
// -------------------------------------------------------------
function SdkDocumentsList({
  docType,
  searchQuery,
  onSelectHandle,
  selectedHandleId,
}: {
  docType: string;
  searchQuery: string;
  onSelectHandle: (handle: DocumentHandle) => void;
  selectedHandleId: string | null;
}) {
  const { data: handles, count, hasMore, isPending, loadMore } = useDocuments({
    documentType: docType === 'all' ? undefined : docType,
    search: searchQuery.trim() || undefined,
    batchSize: 20,
  });

  return (
    <div id="div-sanitysdkexplorer-12" className="space-y-3">
      <div id="div-sanitysdkexplorer-13" className="flex items-center justify-between text-xs text-neutral-400 px-1">
        <span>
          Documentos en el dataset:{' '}
          <strong className="text-neutral-200 font-mono">{count ?? handles.length}</strong>
        </span>
        {isPending && (
          <span className="flex items-center gap-1 text-emerald-400">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Actualizando live...
          </span>
        )}
      </div>

      {handles.length === 0 ? (
        <div id="div-sanitysdkexplorer-14" className="p-8 text-center bg-neutral-900 border border-neutral-800 text-neutral-400 text-xs">
          No se encontraron documentos de tipo{' '}
          <span className="font-mono text-neutral-200 font-semibold">{docType}</span> en el dataset activo.
        </div>
      ) : (
        <div id="div-sanitysdkexplorer-15" className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {handles.map((h) => {
            const isSelected = selectedHandleId === h.documentId;
            return (
              <button
                key={h.documentId}
                id={`btn-sanity-sdk-handle-${h.documentId}`}
                onClick={() => onSelectHandle(h)}
                className={`text-left p-3 border transition flex flex-col justify-between gap-2 cursor-pointer ${isSelected
                    ? 'bg-neutral-800 border-neutral-500'
                    : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
                  }`}
              >
                <div id="div-sanitysdkexplorer-16" className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-neutral-950 border border-neutral-800 text-neutral-300">
                    {h.documentType}
                  </span>
                  <span className="text-[11px] font-mono text-neutral-500 truncate max-w-[140px]">
                    {h.documentId}
                  </span>
                </div>
                <div id="div-sanitysdkexplorer-17" className="text-xs font-medium text-neutral-200 truncate">
                  {h.documentId}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div id="div-sanitysdkexplorer-18" className="pt-2 text-center">
          <button
            id="btn-sanity-sdk-load-more"
            onClick={() => loadMore()}
            disabled={isPending}
            className="px-4 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 transition"
          >
            {isPending ? 'Cargando más...' : 'Cargar más documentos (batch)'}
          </button>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Live GROQ Query Sandbox using `useQuery` hook
// -------------------------------------------------------------
function SdkGroqSandbox({
  activeWorkspaceId,
  onShowToast,
}: {
  activeWorkspaceId?: string;
  onShowToast: (msg: string, type?: any) => void;
}) {
  const cleanWs = activeWorkspaceId
    ? sanitizeSanityDocId(activeWorkspaceId.replace(/^workspace-/, ''))
    : null;

  const PRESET_QUERIES = [
    ...(cleanWs
      ? [
        {
          label: 'Tareas del Workspace actual',
          query: `*[_type == "task" && (workspaceId == "${cleanWs}" || workspace._ref == "workspace-${cleanWs}")] | order(_updatedAt desc)[0...15]`,
        },
      ]
      : []),
    { label: 'Todas las tareas', query: `*[_type == "task"] | order(_updatedAt desc)[0...10]` },
    { label: 'Workspaces y ramas', query: `*[_type == "workspace"] | order(_updatedAt desc)` },
    { label: 'Canvas visual state', query: `*[_type == "canvasVisualState"][0...5]` },
    { label: 'Tareas prioritarias (P0/P1)', query: `*[_type == "task" && priority in ["P0", "P1"]]` },
  ];

  const [activeQuery, setActiveQuery] = useState<string>(PRESET_QUERIES[0].query);
  const [inputQuery, setInputQuery] = useState<string>(PRESET_QUERIES[0].query);

  const { data: results, isPending } = useQuery<any>({
    query: activeQuery,
  });

  return (
    <div id="div-sanitysdkexplorer-19" className="space-y-4">
      {/* Preset buttons */}
      <div id="div-sanitysdkexplorer-20" className="flex flex-wrap gap-2">
        {PRESET_QUERIES.map((preset) => (
          <button
            key={preset.label}
            id={`btn-sanity-sdk-preset-${preset.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
            onClick={() => {
              setInputQuery(preset.query);
              setActiveQuery(preset.query);
            }}
            className={`px-2.5 py-1 text-xs border transition ${activeQuery === preset.query
                ? 'bg-neutral-800 border-neutral-500 text-neutral-100 font-medium'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Query input editor */}
      <div id="div-sanitysdkexplorer-21" className="space-y-2">
        <div id="div-sanitysdkexplorer-22" className="flex items-center justify-between">
          <label className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            Consulta GROQ Reactiva (useQuery)
          </label>
          {isPending && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Ejecutando en Content Lake...
            </span>
          )}
        </div>
        <div id="div-sanitysdkexplorer-23" className="flex gap-2">
          <textarea
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            rows={2}
            className="flex-1 bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-neutral-600 resize-none"
            placeholder="Escribe tu consulta GROQ..."
          />
          <button
            id="btn-sanity-sdk-run-query"
            onClick={() => setActiveQuery(inputQuery)}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 border border-neutral-700 flex items-center gap-1.5 transition"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Ejecutar
          </button>
        </div>
      </div>

      {/* Query output */}
      <div id="div-sanity-sdk-groq-results">
        <div id="div-sanitysdkexplorer-24" className="text-[11px] font-mono text-neutral-400 mb-1 flex items-center justify-between">
          <span>
            Resultados devueltos:{' '}
            <strong className="text-neutral-200 font-mono">
              {Array.isArray(results) ? (results as any[]).length : results ? 1 : 0}
            </strong>
          </span>
          <span className="text-[10px] text-neutral-500">Live subscription activa</span>
        </div>
        <pre className="bg-neutral-950 border border-neutral-800 p-3 text-xs font-mono text-neutral-300 max-h-80 overflow-y-auto">
          {JSON.stringify(results, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Document Creator using `useCreateDocument` hook
// -------------------------------------------------------------
function SdkDocumentCreator({
  activeWorkspaceId,
  onCreated,
  onShowToast,
}: {
  activeWorkspaceId?: string;
  onCreated: (handle: DocumentHandle) => void;
  onShowToast: (msg: string, type?: any) => void;
}) {
  const createTask = useCreateDocument<any>({ documentType: 'task' });
  const [title, setTitle] = useState<string>('');
  const [priority, setPriority] = useState<string>('P1');
  const [groupTitle, setGroupTitle] = useState<string>('Desarrollo SDK');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onShowToast('Ingresa un título para la tarea', 'warning');
      return;
    }

    setIsCreating(true);
    try {
      const now = new Date().toISOString();
      const cleanWorkspaceId = activeWorkspaceId
        ? sanitizeSanityDocId(activeWorkspaceId.replace(/^workspace-/, ''))
        : 'default';
      const rawTaskId = 'sdk-' + Date.now().toString(36);
      const newHandle = await createTask({
        taskId: rawTaskId,
        title: title.trim(),
        completed: false,
        status: 'todo',
        priority: priority as any,
        groupTitle: groupTitle.trim(),
        tags: ['sanity-app-sdk', 'reactive'],
        description: `Creada en tiempo real con @sanity/sdk-react useCreateDocument a las ${new Date().toLocaleTimeString()}.`,
        workspaceId: cleanWorkspaceId,
        workspace: {
          _type: 'reference',
          _ref: `workspace-${cleanWorkspaceId}`,
        },
        updatedAt: now,
      });

      onShowToast('Documento creado exitosamente mediante Sanity App SDK', 'success');
      setTitle('');
      if (newHandle) {
        onCreated(newHandle);
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Error al crear documento con el SDK', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} className="bg-neutral-900 border border-neutral-800 p-4 space-y-3">
      <div id="div-sanitysdkexplorer-25" className="flex items-center gap-2 text-xs font-mono text-neutral-300 border-b border-neutral-800 pb-2">
        <Plus className="w-3.5 h-3.5 text-emerald-400" />
        <span>Crear tarea con useCreateDocument</span>
      </div>

      <div id="div-sanitysdkexplorer-26" className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div id="div-sanitysdkexplorer-27" className="md:col-span-2">
          <label className="text-[11px] font-mono uppercase text-neutral-400 block mb-1">
            Título de la tarea
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ej: Implementar mutaciones en tiempo real"
            className="w-full bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-600 font-mono"
          />
        </div>
        <div id="div-sanity-sdk-creator-priority-group">
          <label className="text-[11px] font-mono uppercase text-neutral-400 block mb-1">
            Prioridad
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-600 font-mono"
          >
            <option value="P0">P0 - Crítica</option>
            <option value="P1">P1 - Alta</option>
            <option value="P2">P2 - Media</option>
            <option value="P3">P3 - Baja</option>
          </select>
        </div>
      </div>

      <div id="div-sanitysdkexplorer-28" className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-neutral-500 font-mono">
          Escribe a la Content Lake con sincronización reactiva
        </span>
        <button
          id="btn-sanity-sdk-submit-new-task"
          type="submit"
          disabled={isCreating}
          className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium flex items-center gap-1.5 transition"
        >
          {isCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Crear tarea SDK
        </button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------
// Main Interior View wrapped in SanityApp
// -------------------------------------------------------------
function SdkExplorerInner({
  config,
  onOpenSanityConfig,
  onSwitchToDeskTool,
  onSwitchToNativeStudio,
  onImportTaskToMarkdown,
  onActivateWorkspace,
  onShowToast,
  activeWorkspaceId,
  activeWorkspaceName,
}: {
  config: SanityConfig;
  onOpenSanityConfig: () => void;
  onSwitchToDeskTool?: () => void;
  onSwitchToNativeStudio?: () => void;
  onImportTaskToMarkdown?: (task: any) => void;
  onActivateWorkspace?: (workspace: any) => void;
  onShowToast: (msg: string, type?: any) => void;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
}) {
  const [activeTab, setActiveTab] = useState<'documents' | 'groq' | 'events'>('documents');
  const [selectedDocType, setSelectedDocType] = useState<string>('task');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedHandle, setSelectedHandle] = useState<DocumentHandle | null>(null);
  const [eventsLog, setEventsLog] = useState<Array<{ id: string; time: string; type: string; docId?: string }>>([]);

  const handleDocumentEvent = useCallback((event: DocumentEvent) => {
    const docEvt = event as any;
    setEventsLog((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        time: new Date().toLocaleTimeString(),
        type: docEvt.type || 'mutation',
        docId: docEvt.documentId || docEvt.id,
      },
      ...prev.slice(0, 49),
    ]);
  }, []);

  return (
    <div id="div-sanitysdkexplorer-29" className="space-y-4">
      {/* Listen to document events in real time */}
      <SdkDocumentEventListener onEventReceived={handleDocumentEvent} />

      {/* Top Banner: Sanity App SDK Active Status */}
      <div id="div-sanitysdkexplorer-30" className="bg-neutral-900 border border-neutral-800 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div id="div-sanitysdkexplorer-31" className="space-y-1">
          <div id="div-sanitysdkexplorer-32" className="flex items-center gap-2">
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500 shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
              Sanity App SDK Activo
            </span>
            <span className="text-xs text-neutral-500 font-mono">v{String(CORE_SDK_VERSION || '3.7.0')}</span>
          </div>
          <div id="div-sanitysdkexplorer-33" className="text-xs text-neutral-400 flex flex-wrap items-center gap-2">
            <span>
              Proyecto: <strong className="font-mono text-neutral-200">{config.projectId}</strong>
            </span>
            <span>·</span>
            <span>
              Dataset: <strong className="font-mono text-neutral-200">{config.dataset}</strong>
            </span>
            {activeWorkspaceName && (
              <>
                <span>·</span>
                <span className="text-sky-300 font-mono">Workspace: {activeWorkspaceName}</span>
              </>
            )}
            <span>·</span>
            <span className="text-emerald-400 font-mono">Suscripciones reactivas en vivo</span>
          </div>
        </div>

        <div id="div-sanitysdkexplorer-34" className="flex items-center gap-2 flex-wrap">
          {onSwitchToNativeStudio && (
            <button
              id="btn-sanity-sdk-switch-native-studio"
              onClick={onSwitchToNativeStudio}
              className="px-3 py-1.5 text-xs bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800/80 flex items-center gap-1.5 transition cursor-pointer"
              title="Abrir interfaz nativa de Sanity Studio con formularios enriquecidos"
            >
              <div id="div-sanitysdkexplorer-35" className="w-3.5 h-3.5 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-[9px]">S</div>
              <span>Studio Nativo Embebido</span>
            </button>
          )}
          {onSwitchToDeskTool && (
            <button
              id="btn-sanity-sdk-switch-desk-tool"
              onClick={onSwitchToDeskTool}
              className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-1.5 transition cursor-pointer"
              title="Abrir el Desk Tool clásico de 3 paneles"
            >
              <Layers className="w-3.5 h-3.5 text-neutral-400" />
              <span>Desk Tool Clásico</span>
            </button>
          )}
          <button
            id="btn-sanity-sdk-open-config"
            onClick={onOpenSanityConfig}
            className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition"
          >
            Ajustes Sanity
          </button>
          <a
            href="https://www.sanity.io/docs/app-sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1.5 transition"
          >
            <span>Docs</span>
            <ExternalLink className="w-3 h-3 text-neutral-400" />
          </a>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div id="div-sanitysdkexplorer-36" className="flex border-b border-neutral-800 gap-1">
        <button
          id="btn-sanity-sdk-tab-documents"
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition flex items-center gap-1.5 ${activeTab === 'documents'
              ? 'border-emerald-500 text-neutral-100 bg-neutral-900/60'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
        >
          <Database className="w-3.5 h-3.5 text-emerald-400" />
          Documentos Reactivos (useDocuments)
        </button>
        <button
          id="btn-sanity-sdk-tab-groq"
          onClick={() => setActiveTab('groq')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition flex items-center gap-1.5 ${activeTab === 'groq'
              ? 'border-emerald-500 text-neutral-100 bg-neutral-900/60'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
        >
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          Consultas GROQ Live (useQuery)
        </button>
        <button
          id="btn-sanity-sdk-tab-events"
          onClick={() => setActiveTab('events')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition flex items-center gap-1.5 ${activeTab === 'events'
              ? 'border-emerald-500 text-neutral-100 bg-neutral-900/60'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
        >
          <Activity className="w-3.5 h-3.5 text-sky-400" />
          Eventos en Tiempo Real ({eventsLog.length})
        </button>
      </div>

      {/* Tab: Documents */}
      {activeTab === 'documents' && (
        <div id="div-sanitysdkexplorer-37" className="space-y-4">
          {/* Creator Form */}
          <SdkDocumentCreator
            activeWorkspaceId={activeWorkspaceId}
            onCreated={(handle) => setSelectedHandle(handle)}
            onShowToast={onShowToast}
          />

          {/* Controls: Type selector and Search */}
          <div id="div-sanitysdkexplorer-38" className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
            <div id="div-sanitysdkexplorer-39" className="flex gap-1 bg-neutral-900 p-1 border border-neutral-800">
              {['task', 'workspace', 'canvasVisualState', 'all'].map((t) => (
                <button
                  key={t}
                  id={`btn-sanity-sdk-filter-type-${t}`}
                  onClick={() => {
                    setSelectedDocType(t);
                    setSelectedHandle(null);
                  }}
                  className={`px-2.5 py-1 text-xs font-mono transition ${selectedDocType === t
                      ? 'bg-neutral-800 text-neutral-100 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div id="div-sanitysdkexplorer-40" className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por texto..."
                className="w-full bg-neutral-900 border border-neutral-800 pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-700 font-mono"
              />
            </div>
          </div>

          {/* Split View: List and Selected Document Inspector */}
          <div id="div-sanitysdkexplorer-41" className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div id="div-sanitysdkexplorer-42" className={selectedHandle ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <Suspense
                fallback={
                  <div id="div-sanitysdkexplorer-43" className="p-8 text-center text-xs text-neutral-400 bg-neutral-900 border border-neutral-800 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-neutral-500" />
                    Cargando stream de documentos desde Sanity Content Lake...
                  </div>
                }
              >
                <SdkDocumentsList
                  docType={selectedDocType}
                  searchQuery={searchQuery}
                  onSelectHandle={(h) => setSelectedHandle(h)}
                  selectedHandleId={selectedHandle?.documentId || null}
                />
              </Suspense>
            </div>

            {selectedHandle && (
              <div id="div-sanitysdkexplorer-44" className="lg:col-span-5">
                <Suspense
                  fallback={
                    <div id="div-sanitysdkexplorer-45" className="p-4 bg-neutral-900 border border-neutral-800 text-xs text-neutral-400">
                      Cargando inspector reactivo...
                    </div>
                  }
                >
                  <SdkDocumentInspector
                    handle={selectedHandle}
                    onClose={() => setSelectedHandle(null)}
                    onImportTaskToMarkdown={onImportTaskToMarkdown}
                    onActivateWorkspace={onActivateWorkspace}
                    onShowToast={onShowToast}
                    activeWorkspaceId={activeWorkspaceId}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: GROQ Sandbox */}
      {activeTab === 'groq' && (
        <Suspense
          fallback={
            <div id="div-sanitysdkexplorer-46" className="p-8 text-center text-xs text-neutral-400 bg-neutral-900 border border-neutral-800 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-neutral-500" />
              Conectando con el motor GROQ de Sanity App SDK...
            </div>
          }
        >
          <SdkGroqSandbox activeWorkspaceId={activeWorkspaceId} onShowToast={onShowToast} />
        </Suspense>
      )}

      {/* Tab: Real-Time Event Log */}
      {activeTab === 'events' && (
        <div id="div-sanitysdkexplorer-47" className="space-y-3">
          <div id="div-sanitysdkexplorer-48" className="flex items-center justify-between text-xs text-neutral-400">
            <span>
              Registro de eventos en vivo interceptados por{' '}
              <code className="text-sky-400">useDocumentEvent</code>
            </span>
            {eventsLog.length > 0 && (
              <button
                id="btn-sanity-sdk-clear-events"
                onClick={() => setEventsLog([])}
                className="text-[11px] text-neutral-400 hover:text-neutral-200 underline"
              >
                Limpiar log
              </button>
            )}
          </div>

          {eventsLog.length === 0 ? (
            <div id="div-sanitysdkexplorer-49" className="p-8 text-center bg-neutral-900 border border-neutral-800 text-neutral-400 text-xs">
              <Activity className="w-6 h-6 mx-auto mb-2 text-neutral-600 animate-pulse" />
              Esperando eventos de mutación en el dataset... Edita un documento o crea una tarea para ver el evento en tiempo real.
            </div>
          ) : (
            <div id="div-sanitysdkexplorer-50" className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
              {eventsLog.map((evt) => (
                <div
                  key={evt.id}
                  id={`div-sanity-sdk-event-${evt.id}`}
                  className="p-2.5 bg-neutral-900 border border-neutral-800 flex items-center justify-between gap-2"
                >
                  <div id="div-sanitysdkexplorer-51" className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-500">{evt.time}</span>
                    <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold bg-sky-950 text-sky-300 border border-sky-800">
                      {evt.type}
                    </span>
                    <span className="text-neutral-300 font-semibold">{evt.docId}</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">Procesado vía SDK</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Root Exported Component with SanityApp Provider
// -------------------------------------------------------------
export const SanitySdkExplorer: React.FC<SanitySdkExplorerProps> = ({
  onOpenSanityConfig,
  onSwitchToDeskTool,
  onSwitchToNativeStudio,
  onImportTaskToMarkdown,
  onActivateWorkspace,
  onShowToast,
  activeWorkspaceId,
  activeWorkspaceName,
}) => {
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());

  // Listen for configuration updates
  React.useEffect(() => {
    const handleUpdate = () => {
      setConfig(getSanityConfig());
    };
    window.addEventListener('antask_sanity_config_updated', handleUpdate);
    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleUpdate);
    };
  }, []);

  const isConfigured = Boolean(config.projectId && config.dataset);

  if (!isConfigured) {
    return (
      <div id="div-sanitysdkexplorer-52" className="p-8 bg-neutral-900 border border-neutral-800 text-center space-y-4 max-w-xl mx-auto my-8">
        <div id="div-sanitysdkexplorer-53" className="w-12 h-12 mx-auto rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
          <Database className="w-6 h-6 text-neutral-300" />
        </div>
        <div id="div-sanitysdkexplorer-54" className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-100">
            Sanity App SDK no configurado
          </h3>
          <p className="text-xs text-neutral-400">
            Para activar los hooks reactivos (@sanity/sdk-react), introduce tu Project ID y Dataset de Sanity.
          </p>
        </div>
        <button
          id="btn-sanity-sdk-configure-credentials"
          onClick={onOpenSanityConfig}
          className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition"
        >
          Configurar Credenciales de Sanity
        </button>
      </div>
    );
  }

  return (
    <SdkErrorBoundary
      fallback={(error, reset) => (
        <div id="div-sanitysdkexplorer-55" className="p-6 bg-neutral-900 border border-red-900/60 text-xs text-neutral-300 space-y-3">
          <div id="div-sanitysdkexplorer-56" className="flex items-center gap-2 text-red-400 font-semibold">
            <AlertCircle className="w-4 h-4" />
            <span>Error al conectar con Sanity App SDK</span>
          </div>
          <p className="text-neutral-400">{error.message || String(error)}</p>
          <div id="div-sanitysdkexplorer-57" className="text-[11px] text-neutral-400 bg-neutral-950 p-2.5 border border-neutral-800">
            Si se trata de un error de red o política CORS, recuerda agregar{' '}
            <code className="text-emerald-400">{typeof window !== 'undefined' ? window.location.origin : 'esta URL'}</code>{' '}
            en la sección de <strong>CORS Origins</strong> en manage.sanity.io.
          </div>
          <div id="div-sanitysdkexplorer-58" className="flex gap-2 pt-1">
            <button
              id="btn-sanity-sdk-error-retry"
              onClick={reset}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
            >
              Reintentar
            </button>
            {onSwitchToDeskTool && (
              <button
                id="btn-sanity-sdk-error-desk-tool"
                onClick={onSwitchToDeskTool}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
              >
                Abrir Desk Tool Clásico
              </button>
            )}
            <button
              id="btn-sanity-sdk-error-open-config"
              onClick={onOpenSanityConfig}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
            >
              Abrir Ajustes de Sanity
            </button>
          </div>
        </div>
      )}
    >
      <SanityApp
        config={{
          projectId: config.projectId.trim(),
          dataset: config.dataset.trim(),
        }}
        fallback={
          <div id="div-sanitysdkexplorer-59" className="p-8 text-center text-xs text-neutral-400 bg-neutral-900 border border-neutral-800 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-neutral-500" />
            Inicializando Sanity App SDK (@sanity/sdk-react)...
          </div>
        }
      >
        <SdkExplorerInner
          config={config}
          onOpenSanityConfig={onOpenSanityConfig}
          onSwitchToDeskTool={onSwitchToDeskTool}
          onSwitchToNativeStudio={onSwitchToNativeStudio}
          onImportTaskToMarkdown={onImportTaskToMarkdown}
          onActivateWorkspace={onActivateWorkspace}
          onShowToast={onShowToast}
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceName={activeWorkspaceName}
        />
      </SanityApp>
    </SdkErrorBoundary>
  );
};
