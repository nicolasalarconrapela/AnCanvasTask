import React, { useState, useMemo, useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Studio, defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import 'sanity/bundle.css';
import { schemaTypes } from '../sanity/schemas';
import { getSanityConfig, SanityConfig } from '../services/sanityService';
import {
  ExternalLink,
  Settings,
  Maximize2,
  Minimize2,
  X,
  Layers,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export interface SanityStudioEmbedProps {
  onOpenSanityConfig: () => void;
  onClose?: () => void;
  isModal?: boolean;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SanityStudioEmbed: React.FC<SanityStudioEmbedProps> = ({
  onOpenSanityConfig,
  onClose,
  isModal = false,
  onShowToast,
}) => {
  const { _ } = useLingui();
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [renderKey, setRenderKey] = useState<number>(0);

  // Listen for config updates
  useEffect(() => {
    const handleUpdate = () => {
      setConfig(getSanityConfig());
      setRenderKey((k) => k + 1);
    };
    window.addEventListener('antask_sanity_config_updated', handleUpdate);
    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleUpdate);
    };
  }, []);

  const isConfigured = Boolean(config.projectId && config.dataset);

  const studioConfig = useMemo(() => {
    const projectId = config.projectId?.trim() || '';
    const dataset = config.dataset?.trim() || 'production';

    return defineConfig({
      name: 'antask-studio',
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
                {_(msg`Sanity Studio CMS (Herramienta Opcional)`)}
              </span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-950 border border-rose-800 text-rose-300">
                v6.17
              </span>
            </div>
            <span className="text-[10px] font-mono text-neutral-400 truncate">
              {config.projectId} · dataset: {config.dataset}
            </span>
          </div>
        </div>

        <div id="div-sanitystudioembed-9" className="flex items-center gap-1.5 shrink-0">
          <button
            id="btn-sanity-studio-embed-reload"
            type="button"
            onClick={() => setRenderKey((k) => k + 1)}
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

      {/* Informative notice regarding Studio login vs background token sync */}
      <div id="div-sanitystudioembed-notice" className="px-3.5 py-1.5 bg-neutral-900/90 border-b border-neutral-800 text-[11px] text-neutral-400 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">
            {_(msg`Sanity Studio es opcional (requiere login en sanity.io). Tu app principal sincroniza en segundo plano mediante tu API Token sin necesidad de login.`)}
          </span>
        </div>
        <button
          id="btn-sanity-studio-open-token-config"
          type="button"
          onClick={onOpenSanityConfig}
          className="text-sky-400 hover:underline shrink-0 text-[11px] cursor-pointer"
        >
          {_(msg`Ajustes de Token`)}
        </button>
      </div>

      {/* Embedded Sanity Studio Engine */}
      <div id="div-sanitystudioembed-10" className="flex-1 w-full h-full overflow-hidden relative">
        <Studio key={renderKey} config={studioConfig} scheme="dark" />
      </div>
    </div>
  );
};
