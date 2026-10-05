import React, { useState, useEffect } from 'react';
import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import {
  getSanityConfig,
  saveSanityConfig,
  clearSanityConfig,
  testSanityConnection,
  writeTestingTaskToSanity,
  deleteDocumentFromSanity,
  fetchSanityDocumentsList,
  SanityConfig,
  SanityConnectionTestResult,
  SanityWriteTestResult,
} from '../services/sanityService';

export interface SanityConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: (config: SanityConfig) => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onSyncAllToSanity?: () => Promise<void>;
}

type ModalTab = 'config' | 'write-test' | 'schemas';

export const SanityConfigModal: React.FC<SanityConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
  onShowToast,
  onSyncAllToSanity,
}) => {
  const { i18n } = useLingui();
  const [activeTab, setActiveTab] = useState<ModalTab>('config');

  // Config fields
  const [projectId, setProjectId] = useState<string>('');
  const [dataset, setDataset] = useState<string>('production');
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);

  // Connection test state
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<SanityConnectionTestResult | null>(null);
  const [copiedOrigin, setCopiedOrigin] = useState<boolean>(false);

  // Write test state
  const [isWritingTest, setIsWritingTest] = useState<boolean>(false);
  const [isSyncingAll, setIsSyncingAll] = useState<boolean>(false);
  const [writeTestResult, setWriteTestResult] = useState<SanityWriteTestResult | null>(null);
  const [isDeletingTestDoc, setIsDeletingTestDoc] = useState<boolean>(false);

  // Document explorer state
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(false);
  const [remoteDocs, setRemoteDocs] = useState<Array<{ _id: string; _type: string; title?: string; taskId?: string; projectId?: string; _updatedAt?: string }>>([]);

  // Schemas viewer state
  const [selectedSchema, setSelectedSchema] = useState<'task' | 'canvasVisualState' | 'index'>('task');
  const [copiedSchema, setCopiedSchema] = useState<boolean>(false);

  // Sync state with current saved config when modal opens
  useEffect(() => {
    if (isOpen) {
      const current = getSanityConfig();
      setProjectId(current.projectId || '');
      setDataset(current.dataset || 'production');
      setToken(current.token || '');
      setTestResult(null);
      setWriteTestResult(null);
      setIsTesting(false);
      setShowToken(false);
      setRemoteDocs([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!projectId.trim()) {
      setTestResult({
        ok: false,
        mode: 'failed',
        message: 'Falta el Project ID',
        details: 'Por favor introduce el Project ID de tu proyecto en Sanity.',
      });
      return;
    }

    if (!dataset.trim()) {
      setTestResult({
        ok: false,
        mode: 'failed',
        message: 'Falta el Dataset',
        details: 'Por favor introduce el nombre del dataset (normalmente "production").',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await testSanityConnection({
        projectId: projectId.trim(),
        dataset: dataset.trim(),
        token: token.trim() || undefined,
      });
      setTestResult(res);
      if (res.ok) {
        onShowToast(res.message, 'success');
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        mode: 'failed',
        message: i18n._(msg`Error inesperado durante la verificación`),
        details: err?.message || String(err),
      });
      onShowToast(i18n._(msg`Error al verificar conexión con Sanity`), 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleExecuteWriteTest = async () => {
    if (!projectId.trim() || !dataset.trim()) {
      onShowToast(i18n._(msg`Configura primero el Project ID y Dataset`), 'warning');
      setActiveTab('config');
      return;
    }

    if (!token.trim()) {
      onShowToast(i18n._(msg`Se requiere un API Token con permisos de Editor para escribir datos`), 'warning');
      setActiveTab('config');
      return;
    }

    setIsWritingTest(true);
    setWriteTestResult(null);

    try {
      const res = await writeTestingTaskToSanity({
        projectId: projectId.trim(),
        dataset: dataset.trim(),
        token: token.trim(),
      });
      setWriteTestResult(res);
      if (res.ok) {
        onShowToast(i18n._(msg`Tarea de prueba escrita con éxito en ${res.dataset || dataset.trim()}`), 'success');
        handleFetchRemoteDocs();
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err: any) {
      setWriteTestResult({
        ok: false,
        action: 'failed',
        message: i18n._(msg`Error al ejecutar prueba de escritura`),
        details: err?.message || String(err),
      });
      onShowToast(i18n._(msg`Fallo al escribir en Sanity`), 'error');
    } finally {
      setIsWritingTest(false);
    }
  };

  const handleDeleteTestDoc = async (docId: string) => {
    setIsDeletingTestDoc(true);
    try {
      const res = await deleteDocumentFromSanity(docId, {
        projectId: projectId.trim(),
        dataset: dataset.trim(),
        token: token.trim(),
      });
      if (res.ok) {
        onShowToast(res.message, 'success');
        setWriteTestResult(null);
        handleFetchRemoteDocs();
      } else {
        onShowToast(res.message, 'error');
      }
    } catch (err) {
      onShowToast(i18n._(msg`Error al eliminar documento de prueba`), 'error');
    } finally {
      setIsDeletingTestDoc(false);
    }
  };

  const handleFetchRemoteDocs = async () => {
    if (!projectId.trim() || !dataset.trim()) return;
    setIsLoadingDocs(true);
    try {
      const docs = await fetchSanityDocumentsList({
        projectId: projectId.trim(),
        dataset: dataset.trim(),
        token: token.trim() || undefined,
      });
      setRemoteDocs(docs);
    } catch (err) {
      console.warn('Could not fetch remote docs:', err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = saveSanityConfig({
      projectId: projectId.trim(),
      dataset: dataset.trim(),
      token: token.trim(),
    });
    onConfigSaved(updated);
    onShowToast(i18n._(msg`Configuración de Sanity guardada y aplicada`), 'success');
    onClose();
  };

  const handleDisconnect = () => {
    const cleared = clearSanityConfig();
    setProjectId('');
    setDataset('production');
    setToken('');
    setTestResult(null);
    setWriteTestResult(null);
    setRemoteDocs([]);
    onConfigSaved(cleared);
    onShowToast(i18n._(msg`Conexión con Sanity eliminada. Operando en modo local.`), 'info');
    onClose();
  };

  const handleCopyOrigin = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.origin);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2000);
      onShowToast(i18n._(msg`Origen copiado al portapapeles`), 'info');
    }
  };

  const schemaCodeMap = {
    task: `// schemas/task.ts
export const taskSchema = {
  name: 'task',
  title: 'Task',
  type: 'document',
  fields: [
    { name: 'taskId', title: 'Task ID', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'title', title: 'Título', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'completed', title: 'Completada', type: 'boolean', initialValue: false },
    {
      name: 'status',
      title: 'Estado Kanban',
      type: 'string',
      options: {
        list: [
          { title: 'Por hacer (Todo)', value: 'todo' },
          { title: 'En progreso (In Progress)', value: 'in_progress' },
          { title: 'Bloqueada (Blocked)', value: 'blocked' },
          { title: 'Completada (Done)', value: 'done' },
        ],
      },
      initialValue: 'todo',
    },
    {
      name: 'priority',
      title: 'Prioridad',
      type: 'string',
      options: { list: ['P0', 'P1', 'P2', 'P3'] },
      initialValue: 'P1',
    },
    { name: 'groupTitle', title: 'Sección / Grupo', type: 'string', initialValue: 'General' },
    { name: 'blockedBy', title: 'Bloqueada Por (Task ID)', type: 'string' },
    { name: 'tags', title: 'Etiquetas (#tags)', type: 'array', of: [{ type: 'string' }] },
    {
      name: 'subtasks',
      title: 'Subtareas (Checklist)',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'title', title: 'Título', type: 'string' },
            { name: 'completed', title: 'Completada', type: 'boolean' },
          ],
        },
      ],
    },
    { name: 'description', title: 'Notas / Descripción', type: 'text' },
    { name: 'updatedAt', title: 'Última actualización', type: 'datetime' },
  ],
};`,
    canvasVisualState: `// schemas/canvasVisualState.ts
export const canvasVisualStateSchema = {
  name: 'canvasVisualState',
  title: 'Canvas Visual State',
  type: 'document',
  fields: [
    { name: 'projectId', title: 'Project ID', type: 'string', validation: (Rule) => Rule.required() },
    {
      name: 'tasks',
      title: 'Coordenadas de Tareas',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'taskId', title: 'Task ID', type: 'string' },
            { name: 'x', title: 'X', type: 'number' },
            { name: 'y', title: 'Y', type: 'number' },
            { name: 'width', title: 'Width', type: 'number' },
            { name: 'height', title: 'Height', type: 'number' },
          ],
        },
      ],
    },
    {
      name: 'groups',
      title: 'Coordenadas de Grupos',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'groupTitle', title: 'Título', type: 'string' },
            { name: 'x', title: 'X', type: 'number' },
            { name: 'y', title: 'Y', type: 'number' },
            { name: 'width', title: 'Width', type: 'number' },
            { name: 'height', title: 'Height', type: 'number' },
            { name: 'isCollapsed', title: 'Colapsado', type: 'boolean' },
          ],
        },
      ],
    },
    { name: 'updatedAt', title: 'Última actualización', type: 'datetime' },
  ],
};`,
    index: `// schemas/index.ts
import { taskSchema } from './task';
import { canvasVisualStateSchema } from './canvasVisualState';

export const schemaTypes = [taskSchema, canvasVisualStateSchema];`,
  };

  const handleCopySchema = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSchema(true);
    setTimeout(() => setCopiedSchema(false), 2000);
    onShowToast(i18n._(msg`Código de Schema copiado al portapapeles`), 'info');
  };

  const hasConfig = Boolean(projectId.trim());

  return (
    <div
      id="modal-sanity-config-overlay"
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sanity-config-dialog-title"
    >
      <div
        id="modal-sanity-config-dialog"
        className="w-full sm:max-w-xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none max-h-[92vh] sm:max-h-[85vh] pb-safe sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="div-sanityconfigmodal-1" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

        {/* Modal Header */}
        <div id="div-sanityconfigmodal-2" className="px-5 py-3 border-b border-[var(--outline)] flex items-center justify-between shrink-0 bg-[var(--surface)]">
          <div id="div-sanityconfigmodal-3" className="flex items-center gap-2.5">
            <div id="div-sanityconfigmodal-4" className="w-7 h-7 rounded bg-[var(--surface-container-high)] border border-[var(--outline)] flex items-center justify-center text-[var(--primary)]">
              <span className="material-symbols-outlined text-[17px]">cloud_sync</span>
            </div>
            <div id="div-sanityconfigmodal-header-titles">
              <h2 id="sanity-config-dialog-title" className="text-sm font-semibold text-[var(--on-surface)]">
                {i18n._(msg`Integración & Persistencia Sanity`)}
              </h2>
              <p className="text-[11px] text-[var(--on-surface-variant)]">
                {i18n._(msg`Dataset:`)} <span className="font-mono text-sky-400 font-semibold">{dataset || 'production'}</span> · {i18n._(msg`Project:`)} <span className="font-mono">{projectId || i18n._(msg`no configurado`)}</span>
              </p>
            </div>
          </div>

          <button
            id="btn-sanity-config-close-header"
            type="button"
            onClick={onClose}
            className="btn-m3-icon w-7 h-7 cursor-pointer"
            aria-label={i18n._(msg`Cerrar modal`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div id="div-sanityconfigmodal-5" className="flex border-b border-[var(--outline)] bg-[var(--surface)] px-4 gap-2 shrink-0">
          {[
            { id: 'config' as ModalTab, label: i18n._(msg`Configuración & Conexión`), icon: 'settings' },
            { id: 'write-test' as ModalTab, label: i18n._(msg`Verificar Escritura en Vivo`), icon: 'edit_note' },
            { id: 'schemas' as ModalTab, label: i18n._(msg`Esquemas (Schemas)`), icon: 'schema' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`btn-sanity-config-tab-${tab.id}`}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'write-test' && remoteDocs.length === 0 && projectId && dataset) {
                    handleFetchRemoteDocs();
                  }
                }}
                className={`py-2 px-2.5 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isActive
                    ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                    : 'border-transparent text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Content Body */}
        <div id="div-sanityconfigmodal-6" className="p-4 sm:p-5 overflow-y-auto flex-1 flex flex-col gap-4 text-xs">
          {/* TAB 1: CONFIGURATION & CONNECTION */}
          {activeTab === 'config' && (
            <>
              {/* Concept Banner with 3 Strategies / Modes */}
              <div id="div-sanityconfigmodal-7" className="p-3 rounded bg-[var(--surface-container-high)] border border-[var(--outline)] text-[11px] text-[var(--on-surface-variant)] leading-relaxed flex flex-col gap-2">
                <div className="flex items-center gap-2 font-semibold text-[var(--on-surface)]">
                  <span className="material-symbols-outlined text-[16px] text-emerald-400">cloud_done</span>
                  <span>{i18n._(msg`Modo de Funcionamiento Flexible & Privado`)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-[var(--outline)]/50">
                  <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col gap-1">
                    <span className="font-semibold text-emerald-300">1. Modo Local-First</span>
                    <span className="text-[10px] text-[var(--on-surface-variant)]">
                      {i18n._(msg`Por defecto. 100% privado en tu navegador, sin registrarse ni hacer login.`)}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col gap-1">
                    <span className="font-semibold text-sky-300">2. Nube con API Token</span>
                    <span className="text-[10px] text-[var(--on-surface-variant)]">
                      {i18n._(msg`Sincronización en segundo plano sin pantallas de login, usando tu Token personal.`)}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)]/60 flex flex-col gap-1">
                    <span className="font-semibold text-rose-300">3. Sanity Studio CMS</span>
                    <span className="text-[10px] text-[var(--on-surface-variant)]">
                      {i18n._(msg`Panel CMS avanzado opcional. Requiere inicio de sesión en Sanity.io.`)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Form */}
              <form id="sanity-config-form" onSubmit={handleSave} className="flex flex-col gap-3">
                {/* Project ID */}
                <div id="div-sanityconfigmodal-8" className="flex flex-col gap-1">
                  <label htmlFor="sanity-project-id" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                    <span>{i18n._(msg`Project ID`)} <span className="text-rose-400">*</span></span>
                    <span className="text-[10px] text-[var(--on-surface-variant)] font-normal">manage.sanity.io</span>
                  </label>
                  <input
                    id="sanity-project-id"
                    type="text"
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={i18n._(msg`ej. a1b2c3d4`)}
                    required
                    className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                  />
                </div>

                {/* Dataset */}
                <div id="div-sanityconfigmodal-9" className="flex flex-col gap-1">
                  <label htmlFor="sanity-dataset" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                    <span>{i18n._(msg`Dataset`)} <span className="text-rose-400">*</span></span>
                    <div id="div-sanityconfigmodal-10" className="flex items-center gap-1">
                      <button
                        id="btn-sanity-dataset-production"
                        type="button"
                        onClick={() => {
                          setDataset('production');
                          setTestResult(null);
                        }}
                        className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                      >
                        production
                      </button>
                      <span className="text-[10px] text-[var(--on-surface-variant)]">·</span>
                      <button
                        id="btn-sanity-dataset-staging"
                        type="button"
                        onClick={() => {
                          setDataset('staging');
                          setTestResult(null);
                        }}
                        className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                      >
                        staging
                      </button>
                    </div>
                  </label>
                  <input
                    id="sanity-dataset"
                    type="text"
                    value={dataset}
                    onChange={(e) => {
                      setDataset(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="production"
                    required
                    className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                  />
                </div>

                {/* API Token */}
                <div id="div-sanityconfigmodal-11" className="flex flex-col gap-1">
                  <label htmlFor="sanity-token" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                    <span>{i18n._(msg`API Token`)} <span className="text-[10px] text-[var(--on-surface-variant)] font-normal">{i18n._(msg`(Requerido para escribir en producción)`)}</span></span>
                    <button
                      id="btn-sanity-toggle-show-token"
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="text-[10px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-[13px]">{showToken ? 'visibility_off' : 'visibility'}</span>
                      <span>{showToken ? i18n._(msg`Ocultar`) : i18n._(msg`Mostrar`)}</span>
                    </button>
                  </label>
                  <input
                    id="sanity-token"
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="sk..."
                    className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                  />
                  <span className="text-[10px] text-[var(--on-surface-variant)]">
                    {i18n._(msg`Crea un token con rol`)} <code className="font-mono text-slate-300">Editor</code> {i18n._(msg`en`)} <span className="font-mono">manage.sanity.io &gt; API &gt; Tokens</span>.
                  </span>
                </div>
              </form>

              {/* Test Connection Button & Status Box */}
              <div id="div-sanityconfigmodal-12" className="pt-1 flex flex-col gap-2.5">
                <div id="div-sanityconfigmodal-13" className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--on-surface)] text-xs">{i18n._(msg`Comprobación de conectividad`)}</span>
                  <button
                    id="btn-sanity-test-connection"
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting || !projectId.trim() || !dataset.trim()}
                    className="btn-m3-secondary px-3 py-1.5 text-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed text-sky-400 border-sky-800/60 hover:bg-sky-950/40"
                  >
                    {isTesting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                        <span>{i18n._(msg`Verificando...`)}</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[15px]">network_check</span>
                        <span>{i18n._(msg`Probar conexión`)}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Test Result Display */}
                {testResult && (
                  <div
                    id="div-sanity-test-result"
                    className={`p-3 rounded border flex flex-col gap-1.5 transition-all text-xs ${
                      testResult.ok
                        ? testResult.mode === 'authenticated'
                          ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300'
                          : 'bg-sky-950/30 border-sky-800/70 text-sky-300'
                        : 'bg-rose-950/30 border-rose-800/70 text-rose-300'
                    }`}
                    role="status"
                  >
                    <div id="div-sanityconfigmodal-14" className="flex items-center justify-between font-semibold">
                      <div id="div-sanityconfigmodal-15" className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">
                          {testResult.ok ? 'check_circle' : 'error'}
                        </span>
                        <span>{testResult.message}</span>
                      </div>
                      {testResult.latencyMs !== undefined && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 border border-current opacity-80">
                          {testResult.latencyMs} ms
                        </span>
                      )}
                    </div>

                    {testResult.details && (
                      <p className="text-[11px] leading-relaxed opacity-90 pl-5">
                        {testResult.details}
                      </p>
                    )}

                    {!testResult.ok && (
                      <div id="div-sanityconfigmodal-16" className="mt-1 pt-2 border-t border-rose-900/40 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-300 truncate">{i18n._(msg`Origen CORS de la app:`)}</span>
                        <button
                          id="btn-sanity-copy-origin"
                          type="button"
                          onClick={handleCopyOrigin}
                          className="px-2 py-0.5 rounded bg-black/40 border border-[var(--outline)] hover:border-sky-500 text-sky-300 font-mono text-[10px] flex items-center gap-1 cursor-pointer shrink-0"
                          title={i18n._(msg`Copiar origen para añadir a Sanity CORS`)}
                        >
                          <span className="material-symbols-outlined text-[12px]">content_copy</span>
                          <span>{copiedOrigin ? i18n._(msg`¡Copiado!`) : i18n._(msg`Copiar URL de Origen`)}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: LIVE WRITE TEST (VERIFY WRITING IN PRODUCTION & CREATE TEST TASK SCHEMA) */}
          {activeTab === 'write-test' && (
            <div id="div-sanityconfigmodal-17" className="flex flex-col gap-3.5">
              <div id="div-sanityconfigmodal-18" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col gap-2">
                <div id="div-sanityconfigmodal-19" className="flex items-center justify-between">
                  <div id="div-sanityconfigmodal-20" className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded bg-emerald-400" />
                    <span className="font-semibold text-xs text-[var(--on-surface)]">
                      {i18n._(msg`Prueba de Escritura en Sanity Dataset (${dataset})`)}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
                    Type: <code className="text-sky-300">task</code>
                  </span>
                </div>
                <p className="text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                  {i18n._(msg`Esta acción enviará una mutación real de tipo`)} <strong className="text-[var(--on-surface)]">task</strong> {i18n._(msg`a tu dataset de Sanity y comprobará inmediatamente la lectura del documento creado (Read-After-Write).`)}
                </p>

                <div id="div-sanityconfigmodal-21" className="flex items-center gap-2 pt-1">
                  <button
                    id="btn-sanity-execute-write-test"
                    type="button"
                    onClick={handleExecuteWriteTest}
                    disabled={isWritingTest || !projectId.trim() || !dataset.trim() || !token.trim()}
                    className="btn-m3-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isWritingTest ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>{i18n._(msg`Escribiendo en ${dataset}...`)}</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[15px]">send_and_archive</span>
                        <span>{i18n._(msg`Crear y verificar primer Task en "${dataset}"`)}</span>
                      </>
                    )}
                  </button>

                  <button
                    id="btn-sanity-fetch-remote-docs"
                    type="button"
                    onClick={handleFetchRemoteDocs}
                    disabled={isLoadingDocs || !projectId.trim() || !dataset.trim()}
                    className="btn-m3-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className={`material-symbols-outlined text-[15px] ${isLoadingDocs ? 'animate-spin' : ''}`}>
                      refresh
                    </span>
                    <span>{i18n._(msg`Actualizar lista`)}</span>
                  </button>
                </div>
              </div>

              {/* Automatic Sync Info & Manual Sync All Button */}
              {onSyncAllToSanity && (
                <div id="div-sanityconfigmodal-22" className="p-3 rounded bg-sky-950/20 border border-sky-800/50 flex flex-col gap-2">
                  <div id="div-sanityconfigmodal-23" className="flex items-center justify-between">
                    <div id="div-sanityconfigmodal-24" className="flex items-center gap-1.5 font-semibold text-xs text-sky-300">
                      <span className="material-symbols-outlined text-[16px]">sync</span>
                      <span>{i18n._(msg`Sincronización Automática Bidireccional`)}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-900/40 text-sky-200 border border-sky-700/60">
                      {i18n._(msg`Auto-Sync Activo`)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                    {i18n._(msg`Todas las tareas que crees, edites, marques como completadas o muevas en el canvas/kanban se sincronizan automáticamente en tu dataset`)} <strong className="text-sky-300 font-mono">"{dataset}"</strong> {i18n._(msg`de Sanity con`)} <code className="font-mono text-sky-200">_type: 'task'</code>.
                  </p>
                  <div id="div-sanityconfigmodal-sync-all-action">
                    <button
                      id="btn-sanity-sync-all-now"
                      type="button"
                      onClick={async () => {
                        if (!token.trim()) {
                          onShowToast(i18n._(msg`Se requiere API Token con rol Editor para guardar en Sanity`), 'warning');
                          setActiveTab('config');
                          return;
                        }
                        setIsSyncingAll(true);
                        try {
                          await onSyncAllToSanity();
                          await handleFetchRemoteDocs();
                        } finally {
                          setIsSyncingAll(false);
                        }
                      }}
                      disabled={isSyncingAll || !projectId.trim() || !dataset.trim() || !token.trim()}
                      className="btn-m3-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isSyncingAll ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>{i18n._(msg`Sincronizando todas las tareas a Sanity...`)}</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[15px]">cloud_upload</span>
                          <span>{i18n._(msg`Sincronizar todas las tareas actuales a Sanity ahora`)}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Write Test Result Card */}
              {writeTestResult && (
                <div
                  id="div-sanity-write-test-result"
                  className={`p-3 rounded border flex flex-col gap-2 transition-all text-xs ${
                    writeTestResult.ok
                      ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-800/70 text-rose-300'
                  }`}
                >
                  <div id="div-sanityconfigmodal-25" className="flex items-center justify-between">
                    <div id="div-sanityconfigmodal-26" className="flex items-center gap-1.5 font-semibold">
                      <span className="material-symbols-outlined text-[16px]">
                        {writeTestResult.ok ? 'task_alt' : 'error'}
                      </span>
                      <span>{writeTestResult.message}</span>
                    </div>
                    {writeTestResult.latencyMs !== undefined && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 border border-current">
                        {writeTestResult.latencyMs} ms
                      </span>
                    )}
                  </div>

                  {writeTestResult.details && (
                    <p className="text-[11px] opacity-90 pl-5 leading-relaxed">
                      {writeTestResult.details}
                    </p>
                  )}

                  {/* Document JSON Preview */}
                  {writeTestResult.document && (
                    <div id="div-sanityconfigmodal-27" className="flex flex-col gap-1.5 mt-1">
                      <div id="div-sanityconfigmodal-28" className="flex items-center justify-between text-[11px] text-[var(--on-surface-variant)]">
                        <span>{i18n._(msg`Payload persistido en Sanity:`)}</span>
                        <button
                          id="btn-sanity-delete-test-doc"
                          type="button"
                          onClick={() => handleDeleteTestDoc(writeTestResult.document._id)}
                          disabled={isDeletingTestDoc}
                          className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[12px]">delete</span>
                          <span>{isDeletingTestDoc ? i18n._(msg`Eliminando...`) : i18n._(msg`Eliminar documento de prueba`)}</span>
                        </button>
                      </div>
                      <pre className="p-2.5 rounded bg-black/50 border border-[var(--outline)] font-mono text-[10px] text-emerald-200 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap select-text">
                        {JSON.stringify(writeTestResult.document, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Remote Documents Explorer */}
              <div id="div-sanityconfigmodal-29" className="flex flex-col gap-1.5">
                <div id="div-sanityconfigmodal-30" className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-[var(--on-surface)]">
                    {i18n._(msg`Documentos existentes en Sanity (${remoteDocs.length})`)}
                  </span>
                  <span className="text-[10px] text-[var(--on-surface-variant)]">{i18n._(msg`Dataset:`)} {dataset}</span>
                </div>

                {remoteDocs.length === 0 ? (
                  <div id="div-sanityconfigmodal-31" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] text-center text-[var(--on-surface-variant)] text-[11px]">
                    {isLoadingDocs ? i18n._(msg`Cargando documentos de Sanity...`) : i18n._(msg`No se han listado documentos aún. Pulsa "Actualizar lista" o crea el primer task.`)}
                  </div>
                ) : (
                  <div id="div-sanityconfigmodal-32" className="divide-y divide-[var(--outline)] rounded border border-[var(--outline)] bg-[var(--surface)] max-h-48 overflow-y-auto">
                    {remoteDocs.map((doc) => (
                      <div id="div-sanityconfigmodal-33" key={doc._id} className="p-2 px-2.5 flex items-center justify-between gap-2 text-xs hover:bg-[var(--surface-container-high)]">
                        <div id="div-sanityconfigmodal-34" className="flex items-center gap-2 min-w-0">
                          <span className={`material-symbols-outlined text-[15px] shrink-0 ${doc._type === 'task' ? 'text-sky-400' : 'text-purple-400'}`}>
                            {doc._type === 'task' ? 'check_box' : 'grid_view'}
                          </span>
                          <div id="div-sanityconfigmodal-35" className="flex flex-col min-w-0">
                            <span className="font-medium text-[var(--on-surface)] truncate">
                              {doc.title || doc.projectId || doc._id}
                            </span>
                            <span className="text-[10px] font-mono text-[var(--on-surface-variant)] truncate">
                              _id: {doc._id} · {i18n._(msg`tipo:`)} {doc._type}
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0">
                          {doc._updatedAt ? new Date(doc._updatedAt).toLocaleTimeString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SANITY SCHEMAS (STUDIO COMPATIBILITY) */}
          {activeTab === 'schemas' && (
            <div id="div-sanityconfigmodal-36" className="flex flex-col gap-3">
              <div id="div-sanityconfigmodal-37" className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
                {i18n._(msg`Archivos de esquema listos para incluir en tu proyecto de`)} <strong className="text-[var(--on-surface)]">Sanity Studio</strong> (<code className="font-mono text-sky-300">src/sanity/schemas/</code>).
              </div>

              {/* Schema selector buttons */}
              <div id="div-sanityconfigmodal-38" className="flex items-center gap-1 border-b border-[var(--outline)] pb-2">
                {[
                  { id: 'task' as const, label: i18n._(msg`task.ts (Documento de Tarea)`) },
                  { id: 'canvasVisualState' as const, label: i18n._(msg`canvasVisualState.ts (Canvas)`) },
                  { id: 'index' as const, label: 'index.ts' },
                ].map((s) => (
                  <button
                    key={s.id}
                    id={`btn-sanity-schema-${s.id}`}
                    type="button"
                    onClick={() => setSelectedSchema(s.id)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                      selectedSchema === s.id
                        ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                        : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Code viewer */}
              <div id="div-sanityconfigmodal-39" className="relative rounded bg-black/60 border border-[var(--outline)] overflow-hidden">
                <div id="div-sanityconfigmodal-40" className="px-3 py-1.5 bg-[var(--surface)] border-b border-[var(--outline)] flex items-center justify-between text-[11px]">
                  <span className="font-mono text-[var(--on-surface-variant)]">{selectedSchema}.ts</span>
                  <button
                    id="btn-sanity-copy-schema-code"
                    type="button"
                    onClick={() => handleCopySchema(schemaCodeMap[selectedSchema])}
                    className="text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">content_copy</span>
                    <span>{copiedSchema ? i18n._(msg`¡Copiado!`) : i18n._(msg`Copiar código`)}</span>
                  </button>
                </div>

                <pre className="p-3 text-[11px] font-mono text-slate-200 overflow-auto max-h-64 leading-relaxed whitespace-pre select-text">
                  {schemaCodeMap[selectedSchema]}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div id="div-sanityconfigmodal-41" className="px-5 py-3 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-between shrink-0">
          <div id="div-sanityconfigmodal-footer-left">
            {hasConfig && (
              <button
                id="btn-sanity-disconnect"
                type="button"
                onClick={handleDisconnect}
                className="btn-m3-text text-rose-400 hover:text-rose-300 px-2 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Desconectar`)}
              </button>
            )}
          </div>

          <div id="div-sanityconfigmodal-42" className="flex items-center gap-2">
            <button
              id="btn-sanity-cancel-footer"
              type="button"
              onClick={onClose}
              className="btn-m3-text px-3.5 py-1 text-xs cursor-pointer"
            >
              {i18n._(msg`Cerrar`)}
            </button>
            <button
              id="btn-sanity-save-footer"
              type="submit"
              form="sanity-config-form"
              className="btn-m3-primary px-4 py-1 text-xs cursor-pointer shadow-sm"
            >
              {i18n._(msg`Guardar y sincronizar`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
