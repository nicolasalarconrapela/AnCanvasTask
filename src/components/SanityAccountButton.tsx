import React, { useState, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  getSanityConfig,
  saveSanityConfig,
  clearSanityConfig,
  checkSanityAccountStatus,
  getSavedSanityProfiles,
  activateSanityProfile,
  getActiveSanityProfileId,
  SanityConfig,
  SanityUserProfile,
  SanityAuthType,
  SanityAccountStatus,
  SanityUserProjectInfo,
  SanityLocalProfile,
} from '../services/sanityService';

export function SanityLogoIcon({
  className = 'w-4 h-4',
  isConnected = true,
}: {
  className?: string;
  isConnected?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 28.4 28.4"
      className={className}
      aria-label="Sanity"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill={isConnected ? '#F03E2F' : 'currentColor'}
        d="M19.7,7.2c-1.3-1.6-3.2-2.7-5.5-2.7c-3.9,0-7.1,3.2-7.1,7.1c0,1.8,0.7,3.5,1.8,4.8l2.9-2.9 c-0.6-0.5-0.9-1.2-0.9-1.9c0-1.6,1.3-2.9,2.9-2.9c1,0,1.9,0.5,2.4,1.3L19.7,7.2z M8.7,21.2c1.3,1.6,3.2,2.7,5.5,2.7 c3.9,0,7.1-3.2,7.1-7.1c0-1.8-0.7-3.5-1.8-4.8l-2.9,2.9c0.6,0.5,0.9,1.2,0.9,1.9c0,1.6-1.3,2.9-2.9,2.9c-1,0-1.9-0.5-2.4-1.3 L8.7,21.2z"
      />
    </svg>
  );
}

function getInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface SanityAccountButtonProps {
  onOpenConfig: () => void;
  onOpenStudio?: () => void;
  onOpenProfilesModal?: () => void;
  onShowToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SanityAccountButton({
  onOpenConfig,
  onOpenStudio,
  onOpenProfilesModal,
  onShowToast,
}: SanityAccountButtonProps) {
  const { i18n } = useLingui();
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [savedProfiles, setSavedProfiles] = useState<SanityLocalProfile[]>(() => getSavedSanityProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => getActiveSanityProfileId());
  const [accountStatus, setAccountStatus] = useState<SanityAccountStatus | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isSwitchingProject, setIsSwitchingProject] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refreshStatus = (cfg?: SanityConfig) => {
    checkSanityAccountStatus(cfg || config).then((status) => {
      setAccountStatus(status);
    });
    setSavedProfiles(getSavedSanityProfiles());
    setActiveProfileId(getActiveSanityProfileId());
  };

  useEffect(() => {
    const handleConfigUpdate = (e: any) => {
      const updatedConfig = e.detail || getSanityConfig();
      setConfig(updatedConfig);
      refreshStatus(updatedConfig);
    };

    const handleProfilesUpdate = () => {
      setSavedProfiles(getSavedSanityProfiles());
      setActiveProfileId(getActiveSanityProfileId());
    };

    window.addEventListener('antask_sanity_config_updated', handleConfigUpdate);
    window.addEventListener('antask_sanity_profiles_updated', handleProfilesUpdate);
    refreshStatus(config);

    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleConfigUpdate);
      window.removeEventListener('antask_sanity_profiles_updated', handleProfilesUpdate);
    };
  }, [config.projectId, config.dataset, config.token]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [isOpen]);

  const handleDisconnect = () => {
    clearSanityConfig();
    setAccountStatus(null);
    setIsOpen(false);
    onShowToast?.(i18n._(msg`Conexión con Sanity eliminada. Operando en modo local.`), 'info');
  };

  const handleSwitchProject = async (project: SanityUserProjectInfo) => {
    setIsSwitchingProject(true);
    try {
      const updated = saveSanityConfig({
        projectId: project.id,
        dataset: config.dataset || 'production',
      });
      setConfig(updated);
      refreshStatus(updated);
      onShowToast?.(i18n._(msg`Cambiado al proyecto "${project.displayName}" (${project.id})`), 'success');
      setIsOpen(false);
    } finally {
      setIsSwitchingProject(false);
    }
  };

  const handleActivateProfile = (profile: SanityLocalProfile) => {
    const applied = activateSanityProfile(profile.id);
    if (applied) {
      setConfig(applied);
      refreshStatus(applied);
      onShowToast?.(i18n._(msg`Perfil "${profile.alias}" activado`), 'success');
      setIsOpen(false);
    }
  };

  const userProfile = accountStatus?.user || null;
  const authType: SanityAuthType = accountStatus?.authType || 'local';
  const isConfigured = accountStatus?.isConfigured ?? Boolean(config.projectId && config.dataset);
  const isProjectMismatch = Boolean(accountStatus?.isProjectMismatch);

  // Auth type details configuration
  const authTypeConfig: Record<
    SanityAuthType,
    {
      badgeLabel: string;
      badgeClass: string;
      icon: string;
      description: string;
    }
  > = {
    user_token: {
      badgeLabel: i18n._(msg`Token Personal (Usuario)`),
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      icon: 'person',
      description: i18n._(msg`Autenticado con Token de Usuario (Lectura y Escritura)`),
    },
    robot_token: {
      badgeLabel: i18n._(msg`Token de Servicio (Robot / M2M)`),
      badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
      icon: 'smart_toy',
      description: i18n._(msg`Autenticado con Token de Servicio / Robot`),
    },
    public_read: {
      badgeLabel: i18n._(msg`Lectura Pública (Sin Token)`),
      badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      icon: 'visibility',
      description: i18n._(msg`Conectado a dataset público (Solo lectura)`),
    },
    local: {
      badgeLabel: i18n._(msg`Almacenamiento Local`),
      badgeClass: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/40',
      icon: 'database',
      description: i18n._(msg`Sin conexión a Sanity (Modo local en navegador)`),
    },
  };

  const currentAuth = authTypeConfig[authType];

  // Helper to render the appropriate avatar
  const renderAvatar = (size: 'sm' | 'md' = 'sm') => {
    const isSm = size === 'sm';
    const dim = isSm ? 'w-5 h-5' : 'w-9 h-9';
    const iconSize = isSm ? 'text-[13px]' : 'text-[18px]';

    if (authType === 'user_token') {
      if (userProfile?.profileImage) {
        return (
          <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
            <img
              src={userProfile.profileImage}
              alt={userProfile.name || 'User Avatar'}
              className={`${dim} rounded-full object-cover border ${
                isProjectMismatch ? 'border-amber-400' : 'border-[#F03E2F]/60'
              }`}
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 ${
                isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'
              } rounded-full ${
                isProjectMismatch ? 'bg-amber-400' : 'bg-[#F03E2F]'
              } border border-[var(--surface)]`}
              title={isProjectMismatch ? 'Discrepancia de proyecto' : 'Sanity'}
            />
          </div>
        );
      }

      // Initials Avatar
      const initials = getInitials(userProfile?.name);
      return (
        <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
          <div
            className={`${dim} rounded-full bg-gradient-to-tr from-[#F03E2F]/80 to-amber-500/80 text-white font-bold font-mono ${
              isSm ? 'text-[9px]' : 'text-xs'
            } flex items-center justify-center border ${
              isProjectMismatch ? 'border-amber-400' : 'border-white/20'
            }`}
          >
            {initials}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${
              isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'
            } rounded-full ${
              isProjectMismatch ? 'bg-amber-400' : 'bg-emerald-500'
            } border border-[var(--surface)]`}
          />
        </div>
      );
    }

    if (authType === 'robot_token') {
      return (
        <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
          <div
            className={`${dim} rounded-full bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-300`}
          >
            <span className={`material-symbols-outlined ${iconSize}`}>smart_toy</span>
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${
              isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'
            } rounded-full bg-[#F03E2F] border border-[var(--surface)]`}
          />
        </div>
      );
    }

    if (authType === 'public_read') {
      return (
        <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
          <div
            className={`${dim} rounded-full bg-[#F03E2F]/10 border border-[#F03E2F]/40 flex items-center justify-center`}
          >
            <SanityLogoIcon className={isSm ? 'w-3.5 h-3.5' : 'w-5 h-5'} isConnected={true} />
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${
              isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'
            } rounded-full bg-amber-400 border border-[var(--surface)]`}
          />
        </div>
      );
    }

    // Local / Unauthenticated
    return (
      <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
        <div
          className={`${dim} rounded-full bg-[var(--surface-container-high)] border border-[var(--outline)] flex items-center justify-center text-[var(--on-surface-variant)]`}
        >
          <span className={`material-symbols-outlined ${iconSize}`}>database</span>
        </div>
      </div>
    );
  };

  const displayName =
    userProfile?.name ||
    (isConfigured
      ? accountStatus?.projectDisplayName
        ? accountStatus.projectDisplayName
        : config.projectId
        ? `Sanity (${config.projectId})`
        : 'Sanity'
      : i18n._(msg`Modo Local`));

  const displaySubtitle =
    userProfile?.email ||
    (isConfigured ? `Dataset: ${config.dataset}` : i18n._(msg`Almacenamiento en navegador`));

  return (
    <div id="div-sanity-account-container" className="relative shrink-0" ref={dropdownRef}>
      <button
        id="btn-sanity-account-badge"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-7 px-2 rounded-md border flex items-center gap-1.5 cursor-pointer transition-all text-xs font-sans select-none ${
          isProjectMismatch
            ? 'bg-amber-950/30 border-amber-500/60 text-amber-200 hover:border-amber-400'
            : isConfigured
            ? 'bg-[var(--surface-container)] border-[var(--outline)] hover:border-[#F03E2F]/60 text-[var(--on-surface)]'
            : 'bg-[var(--surface-container)]/40 border-[var(--outline)] hover:border-[var(--on-surface-variant)] text-[var(--on-surface-variant)] opacity-80 hover:opacity-100'
        } ${isOpen ? 'ring-1 ring-[#F03E2F]/60' : ''}`}
        title={
          isProjectMismatch
            ? `${displayName} — ⚠️ Discrepancia de proyecto (${config.projectId})`
            : `${displayName} — ${currentAuth.badgeLabel}`
        }
        aria-label={i18n._(msg`Cuenta de Sanity`)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {/* Dynamic Avatar */}
        {renderAvatar('sm')}

        {/* Short user / auth label */}
        <div className="hidden sm:flex items-center gap-1">
          <span className="font-medium text-[11px] max-w-[90px] md:max-w-[120px] truncate">
            {userProfile?.name
              ? userProfile.name.split(' ')[0]
              : isConfigured
              ? config.projectId
              : i18n._(msg`Local`)}
          </span>
          {isProjectMismatch ? (
            <span className="material-symbols-outlined text-[13px] text-amber-400" title="Discrepancia de proyecto">
              warning
            </span>
          ) : (
            <span className="text-[9px] font-mono opacity-60 hidden lg:inline">
              ({authType === 'user_token' ? 'User' : authType === 'robot_token' ? 'Bot' : authType === 'public_read' ? 'Read' : 'Local'})
            </span>
          )}
        </div>
      </button>

      {/* Popover Account Menu */}
      {isOpen && (
        <div
          id="div-sanity-account-dropdown"
          role="menu"
          aria-label={i18n._(msg`Opciones de cuenta Sanity`)}
          className="absolute right-0 top-full mt-1.5 w-80 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-xl py-2 z-50 animate-fade-in select-none text-xs flex flex-col"
        >
          {/* Header Card: Avatar + Name + Auth Type */}
          <div className="px-3.5 py-2.5 border-b border-[var(--outline)] flex items-start gap-3">
            {renderAvatar('md')}

            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-[var(--on-surface)] truncate leading-tight">
                {displayName}
              </div>
              <div className="text-[11px] text-[var(--on-surface-variant)] truncate mt-0.5">
                {displaySubtitle}
              </div>

              {/* Authentication Type Pill */}
              <div className="mt-2 flex flex-col gap-1">
                <div
                  className={`inline-flex items-center gap-1 text-[10px] font-medium font-mono px-2 py-0.5 rounded border w-fit ${currentAuth.badgeClass}`}
                >
                  <span className="material-symbols-outlined text-[12px]">{currentAuth.icon}</span>
                  <span>{currentAuth.badgeLabel}</span>
                </div>
                {userProfile?.role && (
                  <span className="text-[10px] text-[var(--on-surface-variant)] font-mono">
                    Rol: {userProfile.role}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* MISMATCH WARNING BANNER & PROJECT SWITCHER */}
          {isProjectMismatch && (
            <div className="px-3.5 py-2.5 bg-amber-950/40 border-b border-amber-800/60 text-amber-200 flex flex-col gap-2">
              <div className="flex items-start gap-1.5 text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0 mt-0.5">warning</span>
                <span>{i18n._(msg`Discrepancia de cuenta detectada`)}</span>
              </div>
              <p className="text-[11px] text-amber-300/90 leading-relaxed pl-5">
                {accountStatus?.mismatchReason ||
                  i18n._(
                    msg`Has iniciado sesión con tu cuenta, pero el Project ID configurado (${config.projectId}) no pertenece a tus proyectos.`
                  )}
              </p>

              {/* Available Projects from this User */}
              {accountStatus && accountStatus.userProjects.length > 0 && (
                <div className="mt-1 pl-5 flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium text-amber-200/80">
                    {i18n._(msg`Selecciona uno de tus proyectos en Sanity:`)}
                  </span>
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {accountStatus.userProjects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={isSwitchingProject}
                        onClick={() => handleSwitchProject(p)}
                        className="w-full px-2 py-1 rounded bg-black/40 hover:bg-black/70 border border-amber-500/40 hover:border-amber-400 text-left text-[11px] text-amber-100 flex items-center justify-between cursor-pointer transition-colors"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold truncate">{p.displayName}</span>
                          <span className="text-[9px] font-mono opacity-70 truncate">ID: {p.id}</span>
                        </div>
                        <span className="material-symbols-outlined text-[14px] text-amber-400 shrink-0">
                          arrow_forward
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Saved Local Profiles Switcher */}
          {savedProfiles.length > 0 && (
            <div className="px-3.5 py-2 border-b border-[var(--outline)] bg-[var(--surface)] flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10px] text-[var(--on-surface-variant)]">
                <span className="font-semibold flex items-center gap-1 text-[var(--on-surface)]">
                  <span className="material-symbols-outlined text-[13px] text-emerald-400">badge</span>
                  <span>{i18n._(msg`Perfiles Guardados:`)}</span>
                </span>
                <span className="font-mono text-[9px] opacity-70">
                  {savedProfiles.length} {savedProfiles.length === 1 ? 'perfil' : 'perfiles'}
                </span>
              </div>

              <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                {savedProfiles.map((p) => {
                  const isActive = activeProfileId === p.id || (config.projectId === p.projectId && config.dataset === p.dataset);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleActivateProfile(p)}
                      className={`w-full px-2 py-1 rounded text-left text-[11px] flex items-center justify-between cursor-pointer transition border ${
                        isActive
                          ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200 font-semibold'
                          : 'bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] border-[var(--outline)] text-[var(--on-surface)]'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-1.5">
                        <span className="truncate">{p.alias}</span>
                        <span className="text-[9px] font-mono opacity-70 truncate">{p.projectId} · {p.dataset}</span>
                      </div>
                      {isActive ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-900/60 text-emerald-300 border border-emerald-700/60 shrink-0">
                          {i18n._(msg`Activo`)}
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-[13px] text-[var(--on-surface-variant)] shrink-0">
                          swap_horiz
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {onOpenProfilesModal && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenProfilesModal();
                  }}
                  className="mt-1 w-full text-center py-1 text-[10px] text-sky-400 hover:text-sky-300 font-medium hover:underline flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[12px]">tune</span>
                  <span>{i18n._(msg`Administrar perfiles (Modal)...`)}</span>
                </button>
              )}
            </div>
          )}

          {/* Account & Connection Details */}
          {isConfigured && !isProjectMismatch && (
            <div className="px-3.5 py-2 border-b border-[var(--outline)] bg-[var(--surface-container-high)]/30 flex flex-col gap-1 text-[11px] font-mono text-[var(--on-surface-variant)]">
              {accountStatus?.projectDisplayName && (
                <div className="flex items-center justify-between">
                  <span>Proyecto:</span>
                  <span className="text-[var(--on-surface)] font-medium truncate max-w-[140px]">
                    {accountStatus.projectDisplayName}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Project ID:</span>
                <span className="text-[var(--on-surface)] font-semibold">{config.projectId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Dataset:</span>
                <span className="text-[var(--on-surface)]">{config.dataset}</span>
              </div>

              {/* Other projects switcher when user has multiple projects */}
              {accountStatus && accountStatus.userProjects.length > 1 && (
                <div className="mt-1 pt-1.5 border-t border-[var(--outline)] flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--on-surface-variant)] font-sans">
                    {i18n._(msg`Cambiar de proyecto:`)}
                  </span>
                  <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                    {accountStatus.userProjects
                      .filter((p) => p.id !== config.projectId)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={isSwitchingProject}
                          onClick={() => handleSwitchProject(p)}
                          className="w-full px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--surface-container-high)] border border-[var(--outline)] text-left text-[10px] text-[var(--on-surface)] flex items-center justify-between cursor-pointer transition-colors"
                        >
                          <span className="truncate">{p.displayName}</span>
                          <span className="font-mono text-[9px] text-[var(--on-surface-variant)]">{p.id}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions List */}
          <div className="py-1 flex flex-col">
            {onOpenStudio && isConfigured && (
              <button
                id="btn-sanity-account-open-studio"
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenStudio();
                }}
                className="w-full px-3.5 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2.5 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-[#F03E2F]">web</span>
                <span>{i18n._(msg`Abrir Sanity Studio`)}</span>
              </button>
            )}

            <button
              id="btn-sanity-account-open-config"
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenConfig();
              }}
              className="w-full px-3.5 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2.5 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">settings</span>
              <span>{isConfigured ? i18n._(msg`Configuración de Sanity`) : i18n._(msg`Conectar con Sanity Cloud`)}</span>
            </button>

            {isConfigured && (
              <a
                id="link-sanity-account-manage"
                href={`https://manage.sanity.io/projects/${config.projectId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="w-full px-3.5 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center justify-between cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">open_in_new</span>
                  <span>{i18n._(msg`manage.sanity.io`)}</span>
                </div>
                <span className="text-[10px] text-[var(--on-surface-variant)]">➔</span>
              </a>
            )}

            {isConfigured && (
              <>
                <div className="my-1 border-t border-[var(--outline)]" />
                <button
                  id="btn-sanity-account-disconnect"
                  type="button"
                  onClick={handleDisconnect}
                  className="w-full px-3.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 cursor-pointer transition-colors font-medium"
                >
                  <span className="material-symbols-outlined text-[16px]">logout</span>
                  <span>{i18n._(msg`Desconectar`)}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

