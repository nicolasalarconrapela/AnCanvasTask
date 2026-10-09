import React, { useState, useMemo } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { SUPPORTED_LANGUAGES, SupportedLanguageCode, dynamicActivate } from '../i18n';
import { APP_VERSION, APP_ENV } from '../version';
import {
  AppUserSettings,
  clearRecentFilesHistory,
  resetUserSettingsToDefault,
} from '../services/settingsService';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppUserSettings;
  onUpdateSettings: (newSettings: AppUserSettings) => void;
  onOpenSanityConfig: () => void;
  onOpenFilePicker: () => void;
  onResetCanvasLayout: () => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

type SettingsSection =
  | 'general'
  | 'appearance'
  | 'workspace'
  | 'canvas'
  | 'kanban'
  | 'files'
  | 'accessibility'
  | 'advanced';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onOpenSanityConfig,
  onOpenFilePicker,
  onResetCanvasLayout,
  onShowToast,
}) => {
  const { i18n } = useLingui();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [searchFilter, setSearchFilter] = useState('');
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  if (!isOpen) return null;

  const handleUpdate = <K extends keyof AppUserSettings>(key: K, value: AppUserSettings[K]) => {
    const updated = { ...settings, [key]: value };
    onUpdateSettings(updated);
  };

  const handleExecuteResetSettings = () => {
    const defaults = resetUserSettingsToDefault();
    onUpdateSettings(defaults);
    setIsResetConfirmOpen(false);
    onShowToast(i18n._(msg`Preferencias restablecidas a los valores predeterminados`), 'success');
  };

  const handleClearRecents = () => {
    clearRecentFilesHistory();
    handleUpdate('recentFiles', []);
    onShowToast(i18n._(msg`Historial de archivos recientes limpiado`), 'info');
  };

  const sectionsList: Array<{ id: SettingsSection; label: string; icon: string; desc: string }> = [
    { id: 'general', label: i18n._(msg`General`), icon: 'settings', desc: i18n._(msg`Vista inicial y confirmaciones`) },
    { id: 'appearance', label: i18n._(msg`Apariencia`), icon: 'palette', desc: i18n._(msg`Tema y densidad visual`) },
    { id: 'workspace', label: i18n._(msg`Workspace`), icon: 'space_dashboard', desc: i18n._(msg`Comportamiento de paneles`) },
    { id: 'canvas', label: i18n._(msg`Canvas`), icon: 'grid_view', desc: i18n._(msg`Cuadrícula, zoom y snapping`) },
    { id: 'kanban', label: i18n._(msg`Kanban`), icon: 'view_kanban', desc: i18n._(msg`Columnas, etiquetas y checklist`) },
    { id: 'files', label: i18n._(msg`Archivos`), icon: 'folder_open', desc: i18n._(msg`Historial reciente y nube`) },
    { id: 'accessibility', label: i18n._(msg`Accesibilidad`), icon: 'accessibility_new', desc: i18n._(msg`Movimiento y atajos`) },
    { id: 'advanced', label: i18n._(msg`Avanzado`), icon: 'tune', desc: i18n._(msg`Zona de mantenimiento y reset`) },
  ];

  const filteredSections = searchFilter.trim()
    ? sectionsList.filter(
        (sec) =>
          sec.label.toLowerCase().includes(searchFilter.toLowerCase()) ||
          sec.desc.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : sectionsList;

  return (
    <div
      id="modal-settings-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
      <div
        id="modal-settings-dialog"
        className="w-full sm:max-w-3xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden animate-slide-up sm:animate-none h-[88vh] sm:h-[640px] max-h-[90vh] pb-safe sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="div-settingsmodal-1" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

        {/* Modal Header */}
        <div id="div-settingsmodal-2" className="px-5 py-3 border-b border-[var(--outline)] flex items-center justify-between shrink-0 bg-[var(--surface)]">
          <div id="div-settingsmodal-3" className="flex items-center gap-2.5">
            <div id="div-settingsmodal-4" className="w-7 h-7 rounded bg-[var(--surface-container-high)] border border-[var(--outline)] flex items-center justify-center text-[var(--primary)]">
              <span className="material-symbols-outlined text-[17px]">settings</span>
            </div>
            <div id="div-settings-title-group">
              <h2 id="settings-dialog-title" className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Configuración & Preferencias`)}</h2>
              <p className="text-[11px] text-[var(--on-surface-variant)]">{i18n._(msg`Personaliza la interfaz, el comportamiento del espacio de trabajo y persistencia`)}</p>
            </div>
          </div>

          <div id="div-settingsmodal-5" className="flex items-center gap-2">
            {/* Quick search input */}
            <div id="div-settingsmodal-6" className="hidden sm:flex items-center bg-[var(--surface-container-high)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs text-[var(--on-surface)] gap-1.5 focus-within:border-[var(--primary)]">
              <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)]">search</span>
              <input
                type="text"
                placeholder={i18n._(msg`Buscar ajuste...`)}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="bg-transparent border-none outline-none text-xs w-28 text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)]"
              />
              {searchFilter && (
                <button
                  id="btn-settings-search-clear"
                  type="button"
                  onClick={() => setSearchFilter('')}
                  className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">close</span>
                </button>
              )}
            </div>

            <button
              id="btn-settings-close-header"
              type="button"
              onClick={onClose}
              className="btn-m3-icon w-7 h-7 cursor-pointer"
              aria-label={i18n._(msg`Cerrar ajustes`)}
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Mobile Tab Bar */}
        <div id="div-settingsmodal-7" className="sm:hidden flex overflow-x-auto border-b border-[var(--outline)] bg-[var(--surface)] px-2 py-1.5 gap-1 shrink-0">
          {sectionsList.map((sec) => (
            <button
              key={sec.id}
              id={`btn-settings-tab-mobile-${sec.id}`}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeSection === sec.id
                  ? 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] bg-[var(--surface-container)]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{sec.icon}</span>
              <span>{sec.label}</span>
            </button>
          ))}
        </div>

        {/* Desktop Layout: Sidebar + Content */}
        <div id="div-settingsmodal-8" className="flex-1 flex overflow-hidden">
          {/* Desktop Left Sidebar */}
          <aside className="w-52 bg-[var(--surface)] border-r border-[var(--outline)] p-2 hidden sm:flex flex-col gap-0.5 shrink-0 select-none overflow-y-auto">
            {filteredSections.map((sec) => {
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  id={`btn-settings-tab-desktop-${sec.id}`}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-2 transition-colors text-left cursor-pointer ${
                    isActive
                      ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)] font-semibold border-l-2 border-l-[var(--primary)]'
                      : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[16px] ${isActive ? 'text-[var(--primary)]' : ''}`}>
                    {sec.icon}
                  </span>
                  <div id="div-settingsmodal-9" className="flex flex-col min-w-0">
                    <span className="truncate">{sec.label}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Right Content Pane */}
          <main className="flex-1 p-4 sm:p-5 overflow-y-auto flex flex-col gap-4 text-xs">
            {/* GENERAL SECTION */}
            {activeSection === 'general' && (
              <div id="div-settingsmodal-10" className="flex flex-col gap-3">
                <div id="div-settings-general-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`General`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">
                    {i18n._(msg`Comportamiento inicial y confirmaciones de seguridad`)}
                  </p>
                </div>

                {/* Interface Language */}
                <div id="div-settingsmodal-11" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-12" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Idioma de la interfaz`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Selecciona el idioma para textos y controles`)}</span>
                  </div>
                  <select
                    value={(i18n.locale || settings.language || 'es').slice(0, 2)}
                    onChange={(e) => {
                      const newLang = e.target.value as SupportedLanguageCode;
                      dynamicActivate(newLang);
                      handleUpdate('language', newLang);
                      const langLabel = SUPPORTED_LANGUAGES.find((l) => l.code === newLang)?.label || newLang;
                      onShowToast(`${i18n._(msg`Idioma`)}: ${langLabel}`, 'success');
                    }}
                    className="bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Default View */}
                <div id="div-settingsmodal-13" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-14" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Vista inicial al abrir`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Selecciona el modo predeterminado de inicio`)}</span>
                  </div>
                  <select
                    value={settings.defaultView}
                    onChange={(e) => handleUpdate('defaultView', e.target.value as 'canvas' | 'kanban' | 'split' | 'studio')}
                    className="bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                  >
                    <option value="canvas">{i18n._(msg`Lienzo (Canvas)`)}</option>
                    <option value="kanban">{i18n._(msg`Tablero Kanban`)}</option>
                    <option value="split">{i18n._(msg`Vista Dual (Canvas + Kanban)`)}</option>
                    <option value="studio">{i18n._(msg`Sanity Studio`)}</option>
                  </select>
                </div>

                {/* Confirm Delete with Dependents */}
                <div id="div-settingsmodal-15" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-16" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Confirmar eliminación con dependencias`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">
                      {i18n._(msg`Avisa con diálogo explícito si la tarea eliminada bloquea a otras tareas`)}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.confirmDeleteWithDependents}
                    onChange={(e) => handleUpdate('confirmDeleteWithDependents', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>

                {/* Automatic Auto-Save & Conflict Check */}
                <div id="div-settingsmodal-autosave" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Autoguardado automático`)}</span>
                      <span className="text-[var(--on-surface-variant)] text-[11px]">
                        {i18n._(msg`Guarda automáticamente y notifica si se detectan conflictos con la nube`)}
                      </span>
                    </div>
                    <input
                      id="checkbox-settings-autosave"
                      type="checkbox"
                      checked={settings.autoSave ?? true}
                      onChange={(e) => handleUpdate('autoSave', e.target.checked)}
                      className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                    />
                  </div>
                  {settings.autoSave && (
                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-[var(--outline)]/50">
                      <span className="text-[11px] text-[var(--on-surface-variant)]">{i18n._(msg`Frecuencia de autoguardado`)}</span>
                      <select
                        value={settings.autoSaveIntervalSeconds || 30}
                        onChange={(e) => handleUpdate('autoSaveIntervalSeconds', Number(e.target.value))}
                        className="bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                      >
                        <option value={10}>10s ({i18n._(msg`Rápido`)})</option>
                        <option value={30}>30s ({i18n._(msg`Normal`)})</option>
                        <option value={60}>60s (1 min)</option>
                        <option value={120}>120s (2 min)</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* APPEARANCE SECTION */}
            {activeSection === 'appearance' && (
              <div id="div-settingsmodal-17" className="flex flex-col gap-4">
                <div id="div-settings-appearance-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Apariencia`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">
                    {i18n._(msg`Tema visual y escala de densidad conforme a DESIGN.md`)}
                  </p>
                </div>

                {/* Theme Selection */}
                <div id="div-settingsmodal-18" className="flex flex-col gap-1.5">
                  <label className="font-semibold text-[var(--on-surface)]">{i18n._(msg`Tema de color`)}</label>
                  <div id="div-settingsmodal-19" className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'dark', label: i18n._(msg`Oscuro`), icon: 'dark_mode' },
                      { id: 'light', label: i18n._(msg`Claro`), icon: 'light_mode' },
                      { id: 'system', label: i18n._(msg`Seguir Sistema`), icon: 'devices' },
                    ].map((t) => {
                      const isSelected = settings.theme === t.id;
                      return (
                        <button
                          key={t.id}
                          id={`btn-settings-theme-${t.id}`}
                          type="button"
                          onClick={() => handleUpdate('theme', t.id as any)}
                          className={`p-2.5 rounded border text-left transition-colors cursor-pointer flex flex-col gap-1.5 ${
                            isSelected
                              ? 'bg-[var(--primary-container)]/30 border-[var(--primary)] text-[var(--on-surface)]'
                              : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px] text-sky-400">{t.icon}</span>
                          <span className="font-medium text-xs text-[var(--on-surface)]">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Density Selection */}
                <div id="div-settingsmodal-20" className="flex flex-col gap-1.5 pt-1">
                  <label className="font-semibold text-[var(--on-surface)]">{i18n._(msg`Densidad de la interfaz`)}</label>
                  <div id="div-settingsmodal-21" className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'compact', label: i18n._(msg`Compacta`), desc: 'Menor padding y alturas para más datos' },
                      { id: 'normal', label: i18n._(msg`Normal`), desc: 'Equilibrio estándar de productividad' },
                      { id: 'comfortable', label: i18n._(msg`Cómoda`), desc: 'Mayor separación táctil y amplitud' },
                    ].map((d) => {
                      const isSelected = settings.density === d.id;
                      return (
                        <button
                          key={d.id}
                          id={`btn-settings-density-${d.id}`}
                          type="button"
                          onClick={() => handleUpdate('density', d.id as any)}
                          className={`p-2.5 rounded border text-left transition-colors cursor-pointer flex flex-col gap-0.5 ${
                            isSelected
                              ? 'bg-[var(--primary-container)]/30 border-[var(--primary)] text-[var(--on-surface)]'
                              : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                          }`}
                        >
                          <span className="font-medium text-xs text-[var(--on-surface)]">{d.label}</span>
                          <span className="text-[10px] text-[var(--on-surface-variant)] leading-snug">{d.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* WORKSPACE SECTION */}
            {activeSection === 'workspace' && (
              <div id="div-settingsmodal-22" className="flex flex-col gap-3">
                <div id="div-settings-workspace-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Workspace`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">{i18n._(msg`Organización de paneles laterales y distribución del espacio`)}</p>
                </div>

                {/* Show Sidebar Default */}
                <div id="div-settingsmodal-23" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-24" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Mostrar panel lateral de inicio`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Mantener la barra de navegación abierta en desktop`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.workspaceShowSidebar}
                    onChange={(e) => handleUpdate('workspaceShowSidebar', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* CANVAS SECTION */}
            {activeSection === 'canvas' && (
              <div id="div-settingsmodal-25" className="flex flex-col gap-3">
                <div id="div-settings-canvas-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Canvas`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">{i18n._(msg`Comportamiento visual del lienzo y alineación interactiva`)}</p>
                </div>

                {/* Show Grid */}
                <div id="div-settingsmodal-26" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-27" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Mostrar cuadrícula de fondo`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Guía visual de puntos en el lienzo infinito`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.canvasShowGrid}
                    onChange={(e) => handleUpdate('canvasShowGrid', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>

                {/* Snap to Grid */}
                <div id="div-settingsmodal-28" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-29" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Alineación magnética (Snapping)`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Alinear tarjetas automáticamente con los ejes`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.canvasSnapToGrid}
                    onChange={(e) => handleUpdate('canvasSnapToGrid', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* KANBAN SECTION */}
            {activeSection === 'kanban' && (
              <div id="div-settingsmodal-30" className="flex flex-col gap-3">
                <div id="div-settings-kanban-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Kanban`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">{i18n._(msg`Opciones de visualización de columnas y tarjetas del tablero`)}</p>
                </div>

                {/* Default Group By */}
                <div id="div-settingsmodal-31" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-32" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Agrupación predeterminada`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Cómo se distribuyen las columnas en el tablero`)}</span>
                  </div>
                  <select
                    value={settings.kanbanDefaultGroupBy}
                    onChange={(e) => handleUpdate('kanbanDefaultGroupBy', e.target.value as 'status' | 'section')}
                    className="bg-[var(--surface-container)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                  >
                    <option value="status">{i18n._(msg`Por Estados (Backlog, Todo, In Progress...)`)}</option>
                    <option value="section">{i18n._(msg`Por Secciones de TASKS.md`)}</option>
                  </select>
                </div>

                {/* Show Tags in Kanban Cards */}
                <div id="div-settingsmodal-33" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-34" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Mostrar etiquetas (#tags)`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Mostrar etiquetas en las tarjetas Kanban`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.kanbanShowTags}
                    onChange={(e) => handleUpdate('kanbanShowTags', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>

                {/* Show Subtasks in Kanban */}
                <div id="div-settingsmodal-35" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-36" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Mostrar progreso de subtareas`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Indicador de checklist (ej. 2/4) en tarjetas`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.kanbanShowSubtasks}
                    onChange={(e) => handleUpdate('kanbanShowSubtasks', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* FILES & RECENTS SECTION */}
            {activeSection === 'files' && (
              <div id="div-settingsmodal-37" className="flex flex-col gap-3">
                <div id="div-settingsmodal-38" className="flex items-center justify-between">
                  <div id="div-settings-files-header">
                    <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Archivos Recientes`)}</h3>
                    <p className="text-[var(--on-surface-variant)] mt-0.5">
                      {i18n._(msg`Historial de documentos TASKS.md abiertos recientemente`)}
                    </p>
                  </div>
                  {settings.recentFiles && settings.recentFiles.length > 0 && (
                    <button
                      id="btn-settings-clear-recents"
                      type="button"
                      onClick={handleClearRecents}
                      className="text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      {i18n._(msg`Limpiar historial`)}
                    </button>
                  )}
                </div>

                <div id="div-settingsmodal-39" className="flex flex-col gap-1.5">
                  {(!settings.recentFiles || settings.recentFiles.length === 0) ? (
                    <div id="div-settingsmodal-40" className="p-4 rounded bg-[var(--surface)] border border-[var(--outline)] text-center text-[var(--on-surface-variant)] text-xs">
                      {i18n._(msg`No hay archivos recientes registrados.`)}
                    </div>
                  ) : (
                    settings.recentFiles.map((file) => (
                      <div
                        key={file.name}
                        id={`div-settings-recent-file-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`}
                        className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-3"
                      >
                        <div id="div-settingsmodal-41" className="flex items-center gap-2 min-w-0">
                          <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">description</span>
                          <div id="div-settingsmodal-42" className="flex flex-col min-w-0">
                            <span className="font-medium text-[var(--on-surface)] truncate font-mono text-xs">{file.name}</span>
                            <span className="text-[10px] text-[var(--on-surface-variant)] font-mono">
                              {new Date(file.lastOpened).toLocaleDateString()} · {file.taskCount || 0} {i18n._(msg`tareas`)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Cloud Persistence */}
                <div id="div-settingsmodal-43" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4 mt-1">
                  <div id="div-settingsmodal-44" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Persistencia Visual en la Nube (Sanity)`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Guarda las coordenadas espaciales del canvas`)}</span>
                  </div>
                  <button
                    id="btn-settings-configure-sanity"
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSanityConfig();
                    }}
                    className="btn-m3-secondary px-3 py-1 text-xs cursor-pointer shrink-0"
                  >{i18n._(msg`Configurar`)}</button>
                </div>
              </div>
            )}

            {/* ACCESSIBILITY SECTION */}
            {activeSection === 'accessibility' && (
              <div id="div-settingsmodal-45" className="flex flex-col gap-3">
                <div id="div-settings-accessibility-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Accesibilidad & Atajos`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">
                    {i18n._(msg`Opciones de contraste, movimiento y mapa de atajos de teclado`)}
                  </p>
                </div>

                {/* Reduced Motion */}
                <div id="div-settingsmodal-46" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-47" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Reducir animaciones (Reduced Motion)`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Minimiza o desactiva transiciones y efectos de movimiento`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.accessibilityReducedMotion}
                    onChange={(e) => handleUpdate('accessibilityReducedMotion', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>

                {/* High Contrast */}
                <div id="div-settingsmodal-48" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-49" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Modo de alto contraste`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Refuerza bordes y separadores de la interfaz`)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.accessibilityHighContrast}
                    onChange={(e) => handleUpdate('accessibilityHighContrast', e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                  />
                </div>

                {/* Keyboard Shortcuts Reference Table */}
                <div id="div-settingsmodal-50" className="flex flex-col gap-1.5 pt-1">
                  <span className="font-semibold text-xs text-[var(--on-surface)]">{i18n._(msg`Atajos de Teclado Principales`)}</span>
                  <div id="div-settingsmodal-51" className="rounded border border-[var(--outline)] bg-[var(--surface)] overflow-hidden divide-y divide-[var(--outline)]">
                    {[
                      { key: 'Ctrl/Cmd + K', desc: i18n._(msg`Búsqueda global y Command Palette`) },
                      { key: 'Ctrl/Cmd + ,', desc: i18n._(msg`Abrir Configuración y Preferencias`) },
                      { key: '?', desc: i18n._(msg`Abrir Guía rápida de sintaxis y ayuda`) },
                      { key: 'Esc', desc: i18n._(msg`Cerrar modal o deseleccionar tarea`) },
                      { key: 'D / Delete', desc: i18n._(msg`Eliminar tarea seleccionada (con confirmación)`) },
                      { key: 'Space + Arrastrar', desc: i18n._(msg`Desplazamiento panorámico (Pan) en Canvas`) },
                    ].map((item, idx) => (
                      <div id={`div-settings-shortcut-${idx}`} key={item.key} className="p-2 px-2.5 flex items-center justify-between gap-3 text-xs">
                        <span className="text-[var(--on-surface-variant)]">{item.desc}</span>
                        <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-container)] text-[var(--on-surface)] font-mono text-[10px] border border-[var(--outline)]">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ADVANCED SECTION */}
            {activeSection === 'advanced' && (
              <div id="div-settingsmodal-53" className="flex flex-col gap-3">
                <div id="div-settings-advanced-header">
                  <h3 className="text-sm font-semibold text-[var(--on-surface)]">{i18n._(msg`Avanzado`)}</h3>
                  <p className="text-[var(--on-surface-variant)] mt-0.5">
                    {i18n._(msg`Acciones de mantenimiento y restablecimiento de configuración`)}
                  </p>
                </div>

                {/* Reset Layout */}
                <div id="div-settingsmodal-54" className="p-3 rounded bg-[var(--surface)] border border-[var(--outline)] flex items-center justify-between gap-4">
                  <div id="div-settingsmodal-55" className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--on-surface)]">{i18n._(msg`Reiniciar lienzo del Canvas`)}</span>
                    <span className="text-[var(--on-surface-variant)] text-[11px]">{i18n._(msg`Restaura la distribución espacial de las tarjetas`)}</span>
                  </div>
                  <button
                    id="btn-settings-reset-canvas-layout"
                    type="button"
                    onClick={() => {
                      onClose();
                      onResetCanvasLayout();
                    }}
                    className="btn-m3-secondary px-3 py-1 text-xs cursor-pointer text-amber-400 border-amber-800/60 shrink-0"
                  >
                    {i18n._(msg`Reiniciar lienzo`)}
                  </button>
                </div>

                {/* Danger Zone: Reset Preferences */}
                <div id="div-settingsmodal-56" className="p-3 rounded bg-rose-950/20 border border-rose-900/40 flex flex-col gap-2 mt-1">
                  <div id="div-settingsmodal-57" className="flex items-center gap-2 text-rose-400 font-semibold">
                    <span className="material-symbols-outlined text-[16px]">warning</span>
                    <span>{i18n._(msg`Restablecer preferencias`)}</span>
                  </div>
                  <p className="text-[var(--on-surface-variant)] leading-relaxed text-[11px]">
                    {i18n._(msg`Se restablecerán los ajustes visuales y de comportamiento a sus valores de fábrica.`)}
                    <strong className="text-[var(--on-surface)]"> {i18n._(msg`Tus tareas y archivos TASKS.md no se modificarán.`)}</strong>
                  </p>
                  <div id="div-settingsmodal-58" className="flex justify-end pt-1">
                    <button
                      id="btn-settings-open-reset-confirm"
                      type="button"
                      onClick={() => setIsResetConfirmOpen(true)}
                      className="btn-m3-secondary px-3 py-1 text-xs text-rose-300 border-rose-800 hover:bg-rose-950/60 cursor-pointer"
                    >
                      {i18n._(msg`Restablecer valores predeterminados`)}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Modal Footer */}
        <div id="div-settingsmodal-59" className="px-5 py-3 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-[var(--on-surface-variant)] font-mono">
            <span>Tasks Canvas v{APP_VERSION}</span>
            <span>•</span>
            <div className={`flex items-center gap-1 px-1.5 py-0.2 rounded border ${APP_ENV.badgeClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${APP_ENV.dotClass}`} />
              <span className="capitalize">{APP_ENV.label}</span>
            </div>
          </div>
          <button
            id="btn-settings-done-footer"
            type="button"
            onClick={onClose}
            className="btn-m3-primary px-4 py-1 text-xs cursor-pointer shadow-sm"
          >
            {i18n._(msg`Listo`)}
          </button>
        </div>
      </div>

      {/* Confirmation Sub-Modal for Resetting Settings */}
      {isResetConfirmOpen && (
        <div
          id="modal-settings-reset-confirm-overlay"
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80"
          onClick={() => setIsResetConfirmOpen(false)}
        >
          <div
            id="modal-settings-reset-confirm-dialog"
            className="w-full max-w-sm bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md p-4 flex flex-col gap-2.5"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-reset-title"
          >
            <h4 id="confirm-reset-title" className="font-semibold text-xs text-rose-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>¿{i18n._(msg`Restablecer preferencias`)}?</span>
            </h4>
            <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
              {i18n._(msg`Se restablecerán los ajustes visuales y de comportamiento. Tus tareas y archivos no se modificarán.`)}
            </p>
            <div id="div-settingsmodal-60" className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--outline)]">
              <button
                id="btn-settings-cancel-reset"
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Cancelar`)}
              </button>
              <button
                id="btn-settings-execute-reset"
                type="button"
                onClick={handleExecuteResetSettings}
                className="btn-m3-primary bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1 text-xs cursor-pointer"
              >
                {i18n._(msg`Restablecer`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
