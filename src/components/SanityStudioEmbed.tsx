import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Studio, defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import 'sanity/bundle.css';
import { schemaTypes } from '../sanity/schemas';
import {
  getSanityConfig,
  saveSanityConfig,
  checkSanityAccountStatus,
  detectSanityStudioSession,
  SanityConfig,
  SanityAccountStatus,
  SanityUserProjectInfo,
} from '../services/sanityService';
import { SanitySdkExplorer } from './SanitySdkExplorer';
import {
  ExternalLink,
  Settings,
  Maximize2,
  Minimize2,
  X,
  Layers,
  Sparkles,
  Database,
  AlertTriangle,
  RefreshCw,
  Check,
  FolderGit2,
} from 'lucide-react';

export interface SanityStudioEmbedProps {
  onOpenSanityConfig: () => void;
  onClose?: () => void;
  isModal?: boolean;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
  onImportTaskToMarkdown?: (task: any) => void;
}

export const SanityStudioEmbed: React.FC<SanityStudioEmbedProps> = ({
  onOpenSanityConfig,
  onClose,
  isModal = false,
  onShowToast,
  activeWorkspaceId,
  activeWorkspaceName,
  onImportTaskToMarkdown,
}) => {
  const { _ } = useLingui();
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [viewMode, setViewMode] = useState<'studio' | 'sdk'>('studio');
  const [accountStatus, setAccountStatus] = useState<SanityAccountStatus | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [renderKey, setRenderKey] = useState<number>(0);
  const [isSwitchingProject, setIsSwitchingProject] = useState<boolean>(false);
  const lastDetectedUserId = useRef<string | null>(null);

  const refreshAccountStatus = (cfg?: SanityConfig) => {
    checkSanityAccountStatus(cfg || config).then((status) => {
      setAccountStatus(status);
    });
  };

  // Listen for config updates
  useEffect(() => {
    const handleUpdate = () => {
      const latest = getSanityConfig();
      setConfig(latest);
      refreshAccountStatus(latest);
      setRenderKey((k) => k + 1);
    };
    window.addEventListener('antask_sanity_config_updated', handleUpdate);
    refreshAccountStatus(config);

    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleUpdate);
    };
  }, []);

  // Detect login in Sanity Studio / CMS and automatically open configuration modal
  useEffect(() => {
    let isCancelled = false;

    const checkForLogin = async () => {
      try {
        const session = await detectSanityStudioSession();
        if (!isCancelled && session.loggedIn && session.user) {
          const userId = session.user.id || session.user.email;
          if (userId && userId !== lastDetectedUserId.current) {
            lastDetectedUserId.current = userId;

            // If a token was captured from studio storage, save it
            if (session.token && !config.token) {
              saveSanityConfig({ token: session.token });
            }

            // Auto-select first project if project mismatch or unconfigured
            if (session.projects && session.projects.length > 0) {
              const hasMatching = session.projects.some((p) => p.id === config.projectId);
              if (!hasMatching && session.projects[0]) {
                saveSanityConfig({ projectId: session.projects[0].id });
              }
            }

            const userName = session.user.name || session.user.email || 'usuario';
            onShowToast?.(
              `Sesión de Sanity detectada (${userName}). Abriendo configuración para completar sincronización...`,
              'success'
            );

            // Open configuration modal
            onOpenSanityConfig();
          }
        }
      } catch {}
    };

    // Check on mount
    checkForLogin();

    // Check when user returns to tab / popup closes
    const handleWindowFocus = () => {
      checkForLogin();
    };
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('storage', handleWindowFocus);

    // Periodic check while Studio is open (every 4 seconds)
    const interval = setInterval(checkForLogin, 4000);

    return () => {
      isCancelled = true;
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('storage', handleWindowFocus);
      clearInterval(interval);
    };
  }, [config.token, config.projectId]);

  const isConfigured = Boolean(config.projectId && config.dataset);
  const isMismatch = Boolean(accountStatus?.isProjectMismatch);
  const userProjects = accountStatus?.userProjects || [];
  const userProfile = accountStatus?.user || null;

  const handleSwitchProject = (project: SanityUserProjectInfo) => {
    setIsSwitchingProject(true);
    try {
      const updated = saveSanityConfig({
        projectId: project.id,
        dataset: config.dataset || 'production',
      });
      setConfig(updated);
      refreshAccountStatus(updated);
      setRenderKey((k) => k + 1);
      onShowToast?.(_(msg`Sanity Studio cambiado al proyecto "${project.displayName}" (${project.id})`), 'success');
    } finally {
      setIsSwitchingProject(false);
    }
  };

  const studioConfig = useMemo(() => {
    const projectId = config.projectId?.trim() || '';
    const dataset = config.dataset?.trim() || 'production';

    return defineConfig({
      name: `antask-studio-${projectId || 'default'}`,
      title: 'AnTask Canvas Content Studio',
      projectId,
      dataset,
      basePath: '/',
      plugins: [
        structureTool({
          title: 'Contenido',
        }),
        visionTool({
          title: 'Vision (GROQ)',
          defaultApiVersion: config.apiVersion || '2024-03-01',
          defaultDataset: dataset,
        }),
      ],
      schema: {
        types: schemaTypes,
      },
    });
  }, [config.projectId, config.dataset, config.apiVersion, renderKey]);

  if (!isConfigured) {
    return (
      <div id="div-sanitystudioembed-1" className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-neutral-950 text-neutral-200">
        <div id="div-sanitystudioembed-2" className="w-14 h-14 rounded-md bg-rose-950/80 border border-rose-800/60 flex items-center justify-center text-rose-400 mb-3 shadow-md">
          <Database className="w-7 h-7" />
        </div>
        <h2 className="text-base font-semibold text-neutral-100 mb-1">
          {_(msg`Sanity Studio Nativo no configurado`)}
        </h2>
        <p className="text-xs text-neutral-400 max-w-md mb-4 leading-relaxed">
          {_(msg`Para cargar la interfaz nativa de Sanity Studio con formularios enriquecidos y validación de esquemas en tiempo real, configura tu Project ID y Dataset.`)}
        </p>
        <button
          id="btn-sanity-studio-embed-config-credentials"
          onClick={onOpenSanityConfig}
          className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition cursor-pointer"
        >
          {_(msg`Configurar Credenciales de Sanity`)}
        </button>
      </div>
    );
  }

  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-neutral-950'
    : isModal
    ? 'flex-1 h-full flex flex-col bg-neutral-950 overflow-hidden'
    : 'flex-1 h-full flex flex-col bg-neutral-950 overflow-hidden';

  return (
    <div id="div-sanitystudioembed-3" className={containerClasses}>
      {/* Native Studio Control Bar */}
      <div id="div-sanitystudioembed-4" className="px-3.5 py-2 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between gap-3 shrink-0 select-none">
        <div id="div-sanitystudioembed-5" className="flex items-center gap-2 min-w-0">
          <div id="div-sanitystudioembed-6" className="w-6 h-6 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-xs shadow-xs shrink-0">
            S
          </div>
          <div id="div-sanitystudioembed-7" className="flex flex-col min-w-0">
            <div id="div-sanitystudioembed-8" className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-neutral-100 truncate">
                {_(msg`Sanity Studio CMS`)}
              </span>
              {isMismatch ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-950 border border-amber-800 text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span>{_(msg`Proyecto Ajeno`)}</span>
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-950 border border-rose-800 text-rose-300">
                  v6.17
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-neutral-400 truncate">
              {accountStatus?.projectDisplayName ? `${accountStatus.projectDisplayName} (${config.projectId})` : config.projectId} · {config.dataset}
            </span>
          </div>
        </div>

        {/* Studio Mode Switcher: Studio Nativo vs App SDK (@sanity/sdk-react) */}
        <div className="flex items-center bg-neutral-950 p-0.5 rounded border border-neutral-800 text-[11px] shrink-0">
          <button
            id="btn-sanity-studio-view-native"
            type="button"
            onClick={() => setViewMode('studio')}
            className={`px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'studio'
                ? 'bg-neutral-800 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Layers className="w-3 h-3 text-rose-400" />
            <span className="hidden sm:inline">{_(msg`Studio Nativo`)}</span>
            <span className="sm:hidden">Studio</span>
          </button>
          <button
            id="btn-sanity-studio-view-sdk"
            type="button"
            onClick={() => setViewMode('sdk')}
            className={`px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'sdk'
                ? 'bg-neutral-800 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Database className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">App SDK (@sanity/sdk-react)</span>
            <span className="sm:hidden">SDK</span>
          </button>
        </div>

        {/* Project Selector in Studio Toolbar (when user has accessible projects) */}
        {userProjects.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 bg-neutral-800/80 px-2 py-1 rounded border border-neutral-700 text-xs">
            <span className="text-[10px] text-neutral-400 font-sans">{_(msg`Proyecto:`)}</span>
            <select
              id="select-sanity-studio-project"
              value={config.projectId}
              onChange={(e) => {
                const selected = userProjects.find((p) => p.id === e.target.value);
                if (selected) handleSwitchProject(selected);
              }}
              className="bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:border-rose-500 cursor-pointer max-w-[160px] truncate"
            >
              {userProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.id})
                </option>
              ))}
              {isMismatch && (
                <option value={config.projectId} disabled>
                  ⚠️ {config.projectId} ({_(msg`Sin acceso`)})
                </option>
              )}
            </select>
          </div>
        )}

        <div id="div-sanitystudioembed-9" className="flex items-center gap-1.5 shrink-0">
          <button
            id="btn-sanity-studio-embed-reload"
            type="button"
            onClick={() => {
              refreshAccountStatus();
              setRenderKey((k) => k + 1);
            }}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition cursor-pointer"
            title={_(msg`Recargar Sanity Studio`)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-sanity-studio-embed-fullscreen"
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition cursor-pointer"
            title={isFullscreen ? _(msg`Salir de pantalla completa`) : _(msg`Pantalla completa`)}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            id="btn-sanity-studio-embed-settings"
            type="button"
            onClick={onOpenSanityConfig}
            className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-1 transition cursor-pointer"
            title={_(msg`Configurar credenciales de Sanity`)}
          >
            <Settings className="w-3 h-3 text-neutral-400" />
            <span className="hidden sm:inline">{_(msg`Ajustes`)}</span>
          </button>

          <a
            href={`https://${config.projectId}.sanity.studio/`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-1 transition cursor-pointer"
            title={_(msg`Abrir Studio hosteado en Sanity Cloud`)}
          >
            <span className="hidden sm:inline">Studio Cloud</span>
            <ExternalLink className="w-3 h-3 text-neutral-400" />
          </a>

          {onClose && (
            <button
              id="btn-sanity-studio-embed-close"
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded transition cursor-pointer"
              title={_(msg`Cerrar Studio`)}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Viewport */}
      {viewMode === 'sdk' ? (
        <div id="div-sanity-studio-sdk-container" className="flex-1 h-full overflow-y-auto p-4 bg-neutral-950 text-neutral-100">
          <SanitySdkExplorer
            activeWorkspaceId={activeWorkspaceId}
            activeWorkspaceName={activeWorkspaceName}
            onOpenSanityConfig={onOpenSanityConfig}
            onSwitchToNativeStudio={() => setViewMode('studio')}
            onImportTaskToMarkdown={onImportTaskToMarkdown}
            onShowToast={onShowToast || (() => {})}
          />
        </div>
      ) : isMismatch ? (
        /* Mismatch Prevention Screen: Avoids native 403 access confrontation */
        <div id="div-sanitystudioembed-mismatch-screen" className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-neutral-950 text-neutral-200 overflow-y-auto">
          <div className="w-12 h-12 rounded-full bg-amber-950/80 border border-amber-600/60 flex items-center justify-center text-amber-400 mb-3 shadow-md">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <h2 className="text-base font-semibold text-neutral-100 mb-1">
            {_(msg`Discrepancia de Proyecto en Sanity Studio`)}
          </h2>

          <p className="text-xs text-neutral-400 max-w-lg mb-4 leading-relaxed">
            {_(
              msg`Estás conectado a Sanity como ${userProfile?.name || userProfile?.email || 'tu usuario'}, pero la aplicación tiene configurado el Project ID "${config.projectId}", al cual tu cuenta no tiene permisos.`
            )}
          </p>

          {userProjects.length > 0 ? (
            <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-md p-4 flex flex-col gap-2.5 shadow-lg mb-4">
              <span className="text-xs font-semibold text-amber-300 text-left flex items-center gap-1.5">
                <FolderGit2 className="w-4 h-4" />
                <span>{_(msg`Tus proyectos disponibles en Sanity:`)}</span>
              </span>

              <div className="flex flex-col gap-2">
                {userProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isSwitchingProject}
                    onClick={() => handleSwitchProject(p)}
                    className="w-full p-2.5 rounded bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 hover:border-amber-400/60 text-left text-xs text-neutral-100 flex items-center justify-between cursor-pointer transition shadow-xs"
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="font-semibold text-sm truncate">{p.displayName}</span>
                      <span className="text-[11px] font-mono text-neutral-400 truncate">ID: {p.id}</span>
                    </div>
                    <span className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs shrink-0 flex items-center gap-1">
                      <span>{_(msg`Abrir en Studio`)}</span>
                      <span>➔</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={onOpenSanityConfig}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-semibold text-xs rounded transition cursor-pointer"
              >
                {_(msg`Configurar Project ID o Token`)}
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <button
              type="button"
              onClick={onOpenSanityConfig}
              className="text-sky-400 hover:underline cursor-pointer"
            >
              {_(msg`Abrir Ajustes de Conexión`)}
            </button>
            <span>·</span>
            <a
              href="https://manage.sanity.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{_(msg`Ir a manage.sanity.io`)}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      ) : (
        /* Embedded Sanity Studio Engine */
        <div id="div-sanitystudioembed-10" className="flex-1 w-full h-full overflow-hidden relative">
          <Studio
            key={`${config.projectId}_${config.dataset}_${renderKey}`}
            config={studioConfig}
            scheme="dark"
          />
        </div>
      )}
    </div>
  );
};


