import React, { useState, useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  SanityLocalProfile,
  SanityConfig,
  getSavedSanityProfiles,
  saveSanityProfile,
  deleteSanityProfile,
  getActiveSanityProfileId,
  activateSanityProfile,
  duplicateSanityProfile,
  exportSanityProfilesJson,
  importSanityProfilesJson,
  fetchSanityUserProjects,
  fetchSanityCurrentUser,
  testSanityConnection,
  SanityUserProjectInfo,
  SanityUserProfile,
  SanityConnectionTestResult,
} from '../services/sanityService';

export interface SanityProfileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialView?: 'list' | 'editor';
  initialProfileId?: string | null;
  onProfileActivated?: (config: SanityConfig, profile: SanityLocalProfile) => void;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

type ProfileModalView = 'list' | 'editor';

export const SanityProfileManagerModal: React.FC<SanityProfileManagerModalProps> = ({
  isOpen,
  onClose,
  initialView = 'list',
  initialProfileId = null,
  onProfileActivated,
  onShowToast,
}) => {
  const { i18n } = useLingui();
  const [view, setView] = useState<ProfileModalView>('list');
  const [profiles, setProfiles] = useState<SanityLocalProfile[]>(() => getSavedSanityProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => getActiveSanityProfileId());

  // Editing profile state
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [alias, setAlias] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [dataset, setDataset] = useState<string>('production');
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);

  // Discovery / validation
  const [userProjects, setUserProjects] = useState<SanityUserProjectInfo[]>([]);
  const [userProfile, setUserProfile] = useState<SanityUserProfile | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<SanityConnectionTestResult | null>(null);

  // Inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshList = () => {
    const list = getSavedSanityProfiles();
    const actId = getActiveSanityProfileId();
    setProfiles(list);
    setActiveProfileId(actId);
  };

  const loadProjectsForToken = async (t: string) => {
    setIsLoadingProjects(true);
    try {
      const projects = await fetchSanityUserProjects(t || undefined);
      setUserProjects(projects);

      if (t.trim()) {
        try {
          const profile = await fetchSanityCurrentUser({
            projectId: projectId || 'temp',
            dataset: dataset || 'production',
            apiVersion: '2024-03-01',
            token: t,
            useCdn: false,
          });
          setUserProfile(profile);
        } catch {
          setUserProfile(null);
        }
      } else {
        setUserProfile(null);
      }
    } catch {
      setUserProjects([]);
      setUserProfile(null);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const list = getSavedSanityProfiles();
      const actId = getActiveSanityProfileId();
      setProfiles(list);
      setActiveProfileId(actId);
      setTestResult(null);
      setConfirmDeleteId(null);

      const targetId = initialProfileId || (initialView === 'editor' ? actId : null);
      if (initialView === 'editor' && targetId) {
        const found = list.find((p) => p.id === targetId);
        if (found) {
          setEditingProfileId(found.id);
          setAlias(found.alias);
          setProjectId(found.projectId);
          setDataset(found.dataset);
          setToken(found.token || '');
          setShowToken(false);
          loadProjectsForToken(found.token || '');
          setView('editor');
          return;
        }
      }

      if (initialView === 'editor' && !targetId) {
        setEditingProfileId(null);
        setAlias('');
        setProjectId('');
        setDataset('production');
        setToken('');
        setShowToken(false);
        loadProjectsForToken('');
        setView('editor');
        return;
      }

      setView('list');
      setEditingProfileId(null);
    }
  }, [isOpen, initialView, initialProfileId]);

  // Debounced projects detection when editing token
  useEffect(() => {
    if (isOpen && view === 'editor') {
      const timer = setTimeout(() => {
        loadProjectsForToken(token.trim());
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [token, view, isOpen]);

  useEffect(() => {
    const handleUpdate = () => refreshList();
    window.addEventListener('antask_sanity_profiles_updated', handleUpdate);
    return () => window.removeEventListener('antask_sanity_profiles_updated', handleUpdate);
  }, []);

  const handleOpenCreateNew = () => {
    setEditingProfileId(null);
    setAlias('');
    setProjectId('');
    setDataset('production');
    setToken('');
    setShowToken(false);
    setTestResult(null);
    setUserProjects([]);
    setUserProfile(null);
    setView('editor');
  };

  const handleOpenEdit = (p: SanityLocalProfile) => {
    setEditingProfileId(p.id);
    setAlias(p.alias);
    setProjectId(p.projectId);
    setDataset(p.dataset);
    setToken(p.token || '');
    setShowToken(false);
    setTestResult(null);
    if (p.token) {
      loadProjectsForToken(p.token);
    } else {
      setUserProjects([]);
      setUserProfile(null);
    }
    setView('editor');
  };

  const handleActivate = (p: SanityLocalProfile) => {
    const applied = activateSanityProfile(p.id);
    if (applied) {
      refreshList();
      onProfileActivated?.(applied, p);
      onShowToast(i18n._(msg`Perfil "${p.alias}" activado como principal`), 'success');
      onClose();
    }
  };

  const handleDuplicate = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const copy = duplicateSanityProfile(id);
    if (copy) {
      refreshList();
      onShowToast(i18n._(msg`Perfil duplicado como "${copy.alias}"`), 'success');
    }
  };

  const handleDelete = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    deleteSanityProfile(id);
    setConfirmDeleteId(null);
    refreshList();
    onShowToast(i18n._(msg`Perfil eliminado`), 'info');
  };

  const handleSaveProfileForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId.trim()) {
      onShowToast(i18n._(msg`Por favor introduce el Project ID de Sanity`), 'warning');
      return;
    }

    const finalAlias = alias.trim() || `Proyecto ${projectId.trim()} (${dataset.trim()})`;
    const isCurrentlyActive = editingProfileId ? activeProfileId === editingProfileId : (!activeProfileId || profiles.length === 0);

    const saved = saveSanityProfile(
      {
        id: editingProfileId || undefined,
        alias: finalAlias,
        projectId: projectId.trim(),
        dataset: dataset.trim() || 'production',
        token: token.trim(),
      },
      isCurrentlyActive
    );

    refreshList();

    if (isCurrentlyActive) {
      const appliedConfig = getSanityConfig();
      onProfileActivated?.(appliedConfig, saved);
    }

    onShowToast(
      editingProfileId
        ? i18n._(msg`Perfil "${saved.alias}" actualizado`)
        : i18n._(msg`Nuevo perfil "${saved.alias}" creado con éxito`),
      'success'
    );
    setView('list');
  };

  const handleTestInEditor = async () => {
    if (!projectId.trim()) {
      onShowToast(i18n._(msg`Introduce el Project ID para probar la conexión`), 'warning');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testSanityConnection({
        projectId: projectId.trim(),
        dataset: dataset.trim() || 'production',
        apiVersion: '2024-03-01',
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
        message: i18n._(msg`Error al verificar conexión`),
        details: err?.message || String(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleExportJson = () => {
    try {
      const json = exportSanityProfilesJson(true);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `antask_sanity_profiles_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onShowToast(i18n._(msg`Perfiles exportados a JSON con éxito`), 'success');
    } catch (err: any) {
      onShowToast(i18n._(msg`Error al exportar: ${err?.message || String(err)}`), 'error');
    }
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const res = importSanityProfilesJson(content);
        refreshList();
        if (res.importedCount > 0) {
          onShowToast(res.message, 'success');
        } else {
          onShowToast(res.message, 'warning');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div
      id="modal-sanity-profiles-overlay"
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sanity-profiles-modal-title"
    >
      <div
        id="modal-sanity-profiles-dialog"
        className="w-full sm:max-w-2xl bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden max-h-[92vh] sm:max-h-[85vh] animate-slide-up sm:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[var(--outline)] rounded mx-auto my-2 sm:hidden" />

        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[var(--outline)] flex items-center justify-between shrink-0 bg-[var(--surface)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-[var(--surface-container-high)] border border-[var(--outline)] flex items-center justify-center text-emerald-400">
              <span className="material-symbols-outlined text-[18px]">badge</span>
            </div>
            <div>
              <h2 id="sanity-profiles-modal-title" className="text-sm font-semibold text-[var(--on-surface)] flex items-center gap-2">
                <span>{i18n._(msg`Gestor de Perfiles Sanity`)}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-container-highest)] text-[var(--on-surface-variant)] border border-[var(--outline)]">
                  {profiles.length} {profiles.length === 1 ? i18n._(msg`perfil`) : i18n._(msg`perfiles`)}
                </span>
              </h2>
              <p className="text-[11px] text-[var(--on-surface-variant)]">
                {i18n._(msg`Guarda y cambia al instante entre proyectos, datasets y tokens sin salir de tu navegador.`)}
              </p>
            </div>
          </div>

          <button
            id="btn-sanity-profiles-close-header"
            type="button"
            onClick={onClose}
            className="btn-m3-icon w-7 h-7 cursor-pointer"
            aria-label={i18n._(msg`Cerrar modal`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Modal Toolbar & Actions */}
        <div className="px-5 py-2 border-b border-[var(--outline)] bg-[var(--surface-container-low)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                view === 'list'
                  ? 'bg-[var(--surface)] border border-[var(--outline)] text-[var(--on-surface)] shadow-xs'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">list</span>
              <span>{i18n._(msg`Ver Perfiles`)}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenCreateNew}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                view === 'editor' && !editingProfileId
                  ? 'bg-[var(--surface)] border border-[var(--outline)] text-[var(--on-surface)] shadow-xs'
                  : 'text-sky-400 hover:text-sky-300'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              <span>{i18n._(msg`Nuevo Perfil`)}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="file"
              id="input-sanity-profile-modal-import"
              accept=".json,application/json"
              onChange={handleImportJson}
              className="hidden"
            />
            <label
              htmlFor="input-sanity-profile-modal-import"
              className="px-2 py-1 rounded text-[11px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] border border-[var(--outline)] hover:bg-[var(--surface)] flex items-center gap-1 cursor-pointer transition select-none"
              title={i18n._(msg`Importar perfiles desde un archivo JSON`)}
            >
              <span className="material-symbols-outlined text-[13px]">upload</span>
              <span>{i18n._(msg`Importar`)}</span>
            </label>

            {profiles.length > 0 && (
              <button
                type="button"
                onClick={handleExportJson}
                className="px-2 py-1 rounded text-[11px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] border border-[var(--outline)] hover:bg-[var(--surface)] flex items-center gap-1 cursor-pointer transition select-none"
                title={i18n._(msg`Exportar perfiles a un archivo JSON`)}
              >
                <span className="material-symbols-outlined text-[13px]">download</span>
                <span>{i18n._(msg`Exportar`)}</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 flex flex-col gap-3 text-xs">
          {/* VIEW 1: PROFILES LIST */}
          {view === 'list' && (
            <div className="flex flex-col gap-2.5">
              {profiles.length === 0 ? (
                <div className="p-8 rounded bg-[var(--surface)] border border-[var(--outline)] text-center flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--surface-container-high)] flex items-center justify-center text-[var(--on-surface-variant)]">
                    <span className="material-symbols-outlined text-[22px]">badge</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-xs text-[var(--on-surface)]">
                      {i18n._(msg`Aún no tienes perfiles guardados`)}
                    </p>
                    <p className="text-[11px] text-[var(--on-surface-variant)] max-w-sm">
                      {i18n._(msg`Crea perfiles locales para guardar credenciales de múltiples proyectos y cambiar entre ellos con un solo clic.`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenCreateNew}
                    className="btn-m3-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>{i18n._(msg`Crear primer perfil`)}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {profiles.map((p) => {
                    const isActive = activeProfileId === p.id;
                    const hasToken = Boolean(p.token && p.token.trim());
                    const isConfirmingDelete = confirmDeleteId === p.id;

                    return (
                      <div
                        key={p.id}
                        className={`p-3 rounded border flex flex-col gap-2 transition-all ${
                          isActive
                            ? 'bg-[var(--surface-container-high)] border-emerald-500/70 shadow-xs'
                            : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--on-surface-variant)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className={`material-symbols-outlined text-[18px] shrink-0 ${
                                isActive ? 'text-emerald-400' : 'text-[var(--on-surface-variant)]'
                              }`}
                            >
                              {isActive ? 'check_circle' : 'account_circle'}
                            </span>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-xs text-[var(--on-surface)] truncate" title={p.alias}>
                                {p.alias}
                              </span>
                              <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono text-[var(--on-surface-variant)] mt-0.5">
                                <span className="px-1.5 py-0.2 rounded bg-[var(--surface-container-highest)] border border-[var(--outline)]" title={`Project ID: ${p.projectId}`}>
                                  {p.projectId}
                                </span>
                                <span className="px-1.5 py-0.2 rounded bg-[var(--surface-container-highest)] border border-[var(--outline)]">
                                  {p.dataset}
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 rounded border flex items-center gap-0.5 ${
                                    hasToken
                                      ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                                      : 'bg-neutral-900/40 border-neutral-800 text-neutral-400'
                                  }`}
                                >
                                  <span className="material-symbols-outlined text-[10px]">{hasToken ? 'key' : 'key_off'}</span>
                                  <span>{hasToken ? i18n._(msg`Token guardado`) : i18n._(msg`Sin token`)}</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isActive ? (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>{i18n._(msg`Activo`)}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleActivate(p)}
                                className="px-2.5 py-1 rounded bg-[var(--surface-container)] hover:bg-emerald-950/50 border border-[var(--outline)] hover:border-emerald-500/60 text-[var(--on-surface)] hover:text-emerald-300 text-xs font-medium cursor-pointer transition flex items-center gap-1"
                                title={i18n._(msg`Activar este perfil inmediatamente`)}
                              >
                                <span className="material-symbols-outlined text-[14px]">login</span>
                                <span>{i18n._(msg`Usar`)}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Actions Row */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-[var(--outline)]/50 text-[11px]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(p)}
                              className="text-sky-400 hover:text-sky-300 flex items-center gap-0.5 cursor-pointer font-medium"
                              title={i18n._(msg`Editar nombre o credenciales de este perfil`)}
                            >
                              <span className="material-symbols-outlined text-[13px]">edit</span>
                              <span>{i18n._(msg`Editar`)}</span>
                            </button>
                            <span className="text-[var(--outline)]">·</span>
                            <button
                              type="button"
                              onClick={(e) => handleDuplicate(p.id, e)}
                              className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] flex items-center gap-0.5 cursor-pointer"
                              title={i18n._(msg`Duplicar como nuevo perfil`)}
                            >
                              <span className="material-symbols-outlined text-[13px]">content_copy</span>
                              <span>{i18n._(msg`Duplicar`)}</span>
                            </button>
                          </div>

                          <div>
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1 bg-rose-950/40 p-0.5 px-1.5 rounded border border-rose-800/60">
                                <span className="text-[10px] text-rose-300">{i18n._(msg`¿Eliminar?`)}</span>
                                <button
                                  type="button"
                                  onClick={(e) => handleDelete(p.id, e)}
                                  className="text-[10px] text-rose-400 hover:text-rose-200 font-semibold underline cursor-pointer"
                                >
                                  {i18n._(msg`Sí`)}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-[10px] text-neutral-400 hover:text-neutral-200 cursor-pointer ml-1"
                                >
                                  {i18n._(msg`No`)}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(p.id)}
                                className="text-neutral-400 hover:text-rose-400 flex items-center gap-0.5 cursor-pointer p-0.5"
                                title={i18n._(msg`Eliminar este perfil`)}
                              >
                                <span className="material-symbols-outlined text-[14px]">delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: PROFILE EDITOR (CREATE OR UPDATE) */}
          {view === 'editor' && (
            <form onSubmit={handleSaveProfileForm} className="flex flex-col gap-3">
              <div className="flex items-center justify-between pb-1 border-b border-[var(--outline)]">
                <span className="font-semibold text-xs text-[var(--on-surface)] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-sky-400">
                    {editingProfileId ? 'edit' : 'add_circle'}
                  </span>
                  <span>
                    {editingProfileId ? i18n._(msg`Editar Perfil Existente`) : i18n._(msg`Crear Nuevo Perfil`)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="text-[11px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                >
                  ← {i18n._(msg`Volver a la lista`)}
                </button>
              </div>

              {/* Alias */}
              <div className="flex flex-col gap-1">
                <label htmlFor="modal-profile-alias" className="font-medium text-[var(--on-surface)]">
                  {i18n._(msg`Alias / Nombre del Perfil:`)} <span className="text-rose-400">*</span>
                </label>
                <input
                  id="modal-profile-alias"
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder={i18n._(msg`ej. Mi Proyecto Web, Empresa - Staging, Cliente Demo`)}
                  required
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              {/* Quick Project Suggestions if Token is active */}
              {userProjects.length > 0 && (
                <div className="p-2 rounded bg-[var(--surface)] border border-[var(--outline)] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[var(--on-surface)] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] text-sky-400">folder_shared</span>
                      <span>{i18n._(msg`Proyectos detectados en tu cuenta:`)}</span>
                    </span>
                    {isLoadingProjects && (
                      <span className="text-[10px] text-[var(--on-surface-variant)] flex items-center gap-1">
                        <span className="w-2.5 h-2.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                        <span>{i18n._(msg`Actualizando...`)}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {userProjects.map((p) => {
                      const isSelected = projectId.trim() === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProjectId(p.id);
                            if (!alias.trim() || alias.startsWith('Proyecto ')) {
                              setAlias(p.displayName || p.id);
                            }
                            setTestResult(null);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold ring-1 ring-sky-400/40'
                              : 'bg-[var(--surface-container-high)] border-[var(--outline)] text-[var(--on-surface)] hover:border-sky-500/50'
                          }`}
                          title={`Project ID: ${p.id}`}
                        >
                          <span>{p.displayName}</span>
                          <span className="text-[9px] opacity-60">({p.id})</span>
                          {isSelected && (
                            <span className="material-symbols-outlined text-[12px] text-sky-400">check</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Project ID */}
              <div className="flex flex-col gap-1">
                <label htmlFor="modal-profile-project-id" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                  <span>{i18n._(msg`Project ID`)} <span className="text-rose-400">*</span></span>
                  <span className="text-[10px] text-[var(--on-surface-variant)] font-mono">manage.sanity.io</span>
                </label>
                <input
                  id="modal-profile-project-id"
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
              <div className="flex flex-col gap-1">
                <label htmlFor="modal-profile-dataset" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                  <span>{i18n._(msg`Dataset`)} <span className="text-rose-400">*</span></span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDataset('production')}
                      className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                    >
                      production
                    </button>
                    <span className="text-[10px] text-[var(--on-surface-variant)]">·</span>
                    <button
                      type="button"
                      onClick={() => setDataset('staging')}
                      className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                    >
                      staging
                    </button>
                  </div>
                </label>
                <input
                  id="modal-profile-dataset"
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
              <div className="flex flex-col gap-1">
                <label htmlFor="modal-profile-token" className="font-medium text-[var(--on-surface)] flex items-center justify-between">
                  <span>{i18n._(msg`API Token`)} <span className="text-[10px] text-[var(--on-surface-variant)] font-normal">{i18n._(msg`(Opcional para lectura pública, requerido para escritura)`)}</span></span>
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="text-[10px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[13px]">{showToken ? 'visibility_off' : 'visibility'}</span>
                    <span>{showToken ? i18n._(msg`Ocultar`) : i18n._(msg`Mostrar`)}</span>
                  </button>
                </label>
                <input
                  id="modal-profile-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setTestResult(null);
                  }}
                  onBlur={() => {
                    if (token.trim()) loadProjectsForToken(token.trim());
                  }}
                  placeholder="sk..."
                  className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-3 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
                />
              </div>

              {/* Test Connection Button in Editor */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestInEditor}
                  disabled={isTesting || !projectId.trim()}
                  className="btn-m3-secondary px-3 py-1 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[14px] ${isTesting ? 'animate-spin' : ''}`}>
                    {isTesting ? 'sync' : 'network_check'}
                  </span>
                  <span>{isTesting ? i18n._(msg`Verificando...`) : i18n._(msg`Probar conexión`)}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
                  >
                    {i18n._(msg`Cancelar`)}
                  </button>
                  <button
                    type="submit"
                    className="btn-m3-primary px-3.5 py-1 text-xs cursor-pointer shadow-xs"
                  >
                    {editingProfileId ? i18n._(msg`Guardar Cambios`) : i18n._(msg`Crear Perfil`)}
                  </button>
                </div>
              </div>

              {/* Test Result Display */}
              {testResult && (
                <div
                  className={`p-2.5 rounded border flex flex-col gap-1 text-xs ${
                    testResult.ok
                      ? testResult.mode === 'authenticated'
                        ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300'
                        : 'bg-sky-950/30 border-sky-800/70 text-sky-300'
                      : 'bg-rose-950/30 border-rose-800/70 text-rose-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px]">
                        {testResult.ok ? 'check_circle' : 'error'}
                      </span>
                      <span>{testResult.message}</span>
                    </div>
                    {testResult.latencyMs !== undefined && (
                      <span className="text-[10px] font-mono px-1 rounded bg-black/40 border border-current opacity-80">
                        {testResult.latencyMs} ms
                      </span>
                    )}
                  </div>
                  {testResult.details && (
                    <p className="text-[10px] leading-relaxed opacity-90 pl-5">{testResult.details}</p>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-end shrink-0">
          <button
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
