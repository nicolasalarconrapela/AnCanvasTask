import React, { useState, useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  getSanityConfig,
  saveSanityConfig,
  testSanityConnection,
  SanityConnectionTestResult,
} from '../services/sanityService';

export interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartDemoMode: () => void;
  onConnectSanitySuccess: () => void;
  onShowToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  onStartDemoMode,
  onConnectSanitySuccess,
  onShowToast,
}) => {
  const { i18n } = useLingui();
  const [selectedMode, setSelectedMode] = useState<'demo' | 'sanity'>('demo');

  // Sanity form credentials
  const [projectId, setProjectId] = useState('');
  const [dataset, setDataset] = useState('production');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Testing status
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<SanityConnectionTestResult | null>(null);

  // Don't show again toggle
  const [dontShowAgain, setDontShowAgain] = useState(true);

  // Load existing config if available
  useEffect(() => {
    if (isOpen) {
      const config = getSanityConfig();
      if (config.projectId) {
        setProjectId(config.projectId);
        setSelectedMode('sanity');
      }
      if (config.dataset) {
        setDataset(config.dataset);
      }
      if (config.token) {
        setToken(config.token);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (dontShowAgain) {
      localStorage.setItem('antask_welcome_dismissed', 'true');
    }
    onClose();
  };

  const handleStartDemo = () => {
    if (dontShowAgain) {
      localStorage.setItem('antask_welcome_dismissed', 'true');
    }
    onStartDemoMode();
    onClose();
  };

  const handleTestConnection = async () => {
    if (!projectId.trim()) {
      onShowToast(i18n._(msg`Por favor introduce el Project ID de Sanity`), 'warning');
      return;
    }
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await testSanityConnection({
        projectId: projectId.trim(),
        dataset: dataset.trim() || 'production',
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
        message: err?.message || i18n._(msg`Error al verificar conexión con Sanity`),
      });
      onShowToast(i18n._(msg`Error al verificar conexión con Sanity`), 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndConnect = async () => {
    if (!projectId.trim()) {
      onShowToast(i18n._(msg`Por favor introduce un Project ID válido`), 'warning');
      return;
    }

    const cleanDataset = dataset.trim() || 'production';
    const cleanToken = token.trim();

    saveSanityConfig({
      projectId: projectId.trim(),
      dataset: cleanDataset,
      token: cleanToken || undefined,
    });

    if (dontShowAgain) {
      localStorage.setItem('antask_welcome_dismissed', 'true');
    }

    onShowToast(i18n._(msg`Conectado a Sanity (${cleanDataset}) con éxito`), 'success');
    onConnectSanitySuccess();
    onClose();
  };

  return (
    <div
      id="modal-welcome-overlay"
      className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/80 animate-fade-in"
      onClick={handleDismiss}
    >
      <div
        id="modal-welcome-dialog"
        className="w-full max-w-3xl bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-lg flex flex-col overflow-hidden max-h-[94vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          id="div-welcome-header"
          className="px-5 py-4 border-b border-[var(--outline)] bg-[var(--surface)] flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
              <span className="material-symbols-outlined text-[20px]">hub</span>
            </div>
            <div>
              <h2
                id="welcome-modal-title"
                className="text-base font-semibold text-[var(--on-surface)] flex items-center gap-2"
              >
                <span>{i18n._(msg`Bienvenido a AnCanvasTask`)}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-container-high)] text-[var(--on-surface-variant)] border border-[var(--outline)]">
                  v1.0
                </span>
              </h2>
              <p className="text-xs text-[var(--on-surface-variant)] mt-0.5">
                {i18n._(msg`Gestión visual de tareas, Markdown interactivo y sincronización en tiempo real con Sanity Cloud.`)}
              </p>
            </div>
          </div>

          <button
            id="btn-welcome-close-header"
            type="button"
            onClick={handleDismiss}
            className="btn-m3-icon w-7 h-7 cursor-pointer"
            title={i18n._(msg`Cerrar`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Body Content */}
        <div id="div-welcome-body" className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          <p className="text-xs text-[var(--on-surface)] font-medium">
            {i18n._(msg`Selecciona el modo de inicio para tu sesión:`)}
          </p>

          {/* Mode Selection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Card 1: Modo Demo */}
            <div
              id="card-mode-demo"
              onClick={() => setSelectedMode('demo')}
              className={`p-4 rounded-md border cursor-pointer transition-all flex flex-col justify-between ${
                selectedMode === 'demo'
                  ? 'border-[var(--primary)] bg-[var(--surface-container-high)] ring-1 ring-[var(--primary)]'
                  : 'border-[var(--outline)] bg-[var(--surface)] hover:border-[var(--on-surface-variant)]'
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-2xl text-emerald-400">
                      play_circle
                    </span>
                    <span className="text-sm font-semibold text-[var(--on-surface)]">
                      {i18n._(msg`Modo Demo (Local)`)}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                    {i18n._(msg`Sin Credenciales`)}
                  </span>
                </div>

                <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
                  {i18n._(
                    msg`Inicia inmediatamente con un proyecto de ejemplo pre-cargado. Explora el lienzo visual, tablero Kanban, grafo de dependencias y edición Markdown completa de manera 100% local en tu navegador.`
                  )}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--outline)] flex items-center justify-between">
                <span className="text-[11px] text-[var(--on-surface-variant)]">
                  {i18n._(msg`Ideal para probar la herramienta`)}
                </span>
                <button
                  id="btn-welcome-start-demo"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartDemo();
                  }}
                  className="btn-m3-primary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                  <span>{i18n._(msg`Iniciar Demo`)}</span>
                </button>
              </div>
            </div>

            {/* Card 2: Sanity Cloud */}
            <div
              id="card-mode-sanity"
              onClick={() => setSelectedMode('sanity')}
              className={`p-4 rounded-md border cursor-pointer transition-all flex flex-col justify-between ${
                selectedMode === 'sanity'
                  ? 'border-[var(--primary)] bg-[var(--surface-container-high)] ring-1 ring-[var(--primary)]'
                  : 'border-[var(--outline)] bg-[var(--surface)] hover:border-[var(--on-surface-variant)]'
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-2xl text-rose-500">
                      cloud_sync
                    </span>
                    <span className="text-sm font-semibold text-[var(--on-surface)]">
                      {i18n._(msg`Conectar Sanity Cloud`)}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800">
                    {i18n._(msg`Tiempo Real`)}
                  </span>
                </div>

                <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
                  {i18n._(
                    msg`Conecta tu dataset de Sanity para sincronización bidireccional continua, almacenamiento en la nube, colaboración entre dispositivos y compatibilidad total con Sanity Studio.`
                  )}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--outline)] flex items-center justify-between">
                <span className="text-[11px] text-[var(--on-surface-variant)]">
                  {i18n._(msg`Requiere Project ID y Dataset`)}
                </span>
                <span className="text-xs font-semibold text-[var(--primary)] flex items-center gap-0.5">
                  {i18n._(msg`Configurar abajo`)}
                  <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                </span>
              </div>
            </div>
          </div>

          {/* Sanity Credentials Form (visible or highlighted when sanity mode is selected) */}
          {selectedMode === 'sanity' && (
            <div
              id="div-welcome-sanity-form"
              className="p-4 rounded-md bg-[var(--surface)] border border-[var(--outline)] flex flex-col gap-3 animate-fade-in"
            >
              <div className="flex items-center justify-between border-b border-[var(--outline)] pb-2">
                <span className="text-xs font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-rose-500">
                    key
                  </span>
                  {i18n._(msg`Credenciales de Sanity Content Lake`)}
                </span>
                <a
                  href="https://manage.sanity.io"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[var(--primary)] hover:underline flex items-center gap-0.5"
                >
                  <span>manage.sanity.io</span>
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Project ID */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="welcome-sanity-project-id"
                    className="text-[11px] font-medium text-[var(--on-surface)] flex items-center gap-1"
                  >
                    <span>{i18n._(msg`Project ID`)}</span>
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="welcome-sanity-project-id"
                    type="text"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="ej: a1b2c3d4"
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-[var(--surface-container)] border border-[var(--outline)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:outline-hidden"
                  />
                </div>

                {/* Dataset */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="welcome-sanity-dataset"
                    className="text-[11px] font-medium text-[var(--on-surface)] flex items-center gap-1"
                  >
                    <span>{i18n._(msg`Dataset`)}</span>
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="welcome-sanity-dataset"
                    type="text"
                    value={dataset}
                    onChange={(e) => setDataset(e.target.value)}
                    placeholder="production"
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-[var(--surface-container)] border border-[var(--outline)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* API Token */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="welcome-sanity-token"
                    className="text-[11px] font-medium text-[var(--on-surface)]"
                  >
                    {i18n._(msg`API Token (Rol Editor para lectura y escritura)`)}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="text-[11px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {showToken ? 'visibility_off' : 'visibility'}
                    </span>
                    <span>{showToken ? i18n._(msg`Ocultar`) : i18n._(msg`Mostrar`)}</span>
                  </button>
                </div>
                <input
                  id="welcome-sanity-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="sk..."
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-[var(--surface-container)] border border-[var(--outline)] text-[var(--on-surface)] focus:border-[var(--primary)] focus:outline-hidden"
                />
              </div>

              {/* Test Result Message */}
              {testResult && (
                <div
                  id="div-welcome-test-result"
                  className={`p-2.5 rounded border flex items-start gap-2 text-xs ${
                    testResult.ok
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800 text-rose-300'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                    {testResult.ok ? 'check_circle' : 'error'}
                  </span>
                  <div className="flex flex-col">
                    <span className="font-semibold">{testResult.message}</span>
                    {testResult.details && (
                      <span className="text-[11px] opacity-80 mt-0.5 font-mono">
                        {testResult.details}
                      </span>
                    )}
                    {testResult.latencyMs && (
                      <span className="text-[10px] opacity-70 font-mono mt-0.5">
                        {i18n._(msg`Latencia`)}: {testResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Connection Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  id="btn-welcome-test-connection"
                  type="button"
                  disabled={isTesting || !projectId.trim()}
                  onClick={handleTestConnection}
                  className="btn-m3-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[15px] ${isTesting ? 'animate-spin' : ''}`}>
                    {isTesting ? 'autorenew' : 'network_check'}
                  </span>
                  <span>{isTesting ? i18n._(msg`Comprobando...`) : i18n._(msg`Probar Conexión`)}</span>
                </button>

                <button
                  id="btn-welcome-save-connect"
                  type="button"
                  disabled={!projectId.trim()}
                  onClick={handleSaveAndConnect}
                  className="btn-m3-primary px-4 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">cloud_done</span>
                  <span>{i18n._(msg`Guardar y Conectar Sanity`)}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          id="div-welcome-footer"
          className="px-5 py-3 border-t border-[var(--outline)] bg-[var(--surface)] flex items-center justify-between text-xs"
        >
          <label className="flex items-center gap-2 text-[var(--on-surface-variant)] cursor-pointer select-none">
            <input
              id="chk-welcome-dont-show-again"
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded"
            />
            <span>{i18n._(msg`No volver a mostrar automáticamente al iniciar`)}</span>
          </label>

          <button
            id="btn-welcome-dismiss"
            type="button"
            onClick={handleDismiss}
            className="btn-m3-secondary px-3.5 py-1 cursor-pointer"
          >
            {i18n._(msg`Cerrar`)}
          </button>
        </div>
      </div>
    </div>
  );
};
