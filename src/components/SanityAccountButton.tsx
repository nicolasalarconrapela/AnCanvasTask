import React, { useState, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import {
  getSanityConfig,
  clearSanityConfig,
  fetchSanityCurrentUser,
  getCachedSanityUser,
  SanityConfig,
  SanityUserProfile,
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

interface SanityAccountButtonProps {
  onOpenConfig: () => void;
  onOpenStudio?: () => void;
  onShowToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SanityAccountButton({
  onOpenConfig,
  onOpenStudio,
  onShowToast,
}: SanityAccountButtonProps) {
  const { i18n } = useLingui();
  const [config, setConfig] = useState<SanityConfig>(() => getSanityConfig());
  const [userProfile, setUserProfile] = useState<SanityUserProfile | null>(() => getCachedSanityUser());
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isConfigured = Boolean(config.projectId && config.dataset);
  const isAuthenticated = Boolean(isConfigured && config.token);

  useEffect(() => {
    const handleConfigUpdate = (e: any) => {
      const updatedConfig = e.detail || getSanityConfig();
      setConfig(updatedConfig);
      if (updatedConfig.token) {
        fetchSanityCurrentUser(updatedConfig).then(setUserProfile);
      } else {
        setUserProfile(null);
      }
    };

    window.addEventListener('antask_sanity_config_updated', handleConfigUpdate);

    if (config.token) {
      fetchSanityCurrentUser(config).then(setUserProfile);
    }

    return () => {
      window.removeEventListener('antask_sanity_config_updated', handleConfigUpdate);
    };
  }, [config.token]);

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
    setUserProfile(null);
    setIsOpen(false);
    onShowToast?.(i18n._(msg`Conexión con Sanity eliminada. Operando en modo local.`), 'info');
  };

  const displayName = userProfile?.name || (isConfigured ? `Sanity (${config.projectId})` : i18n._(msg`Sanity Cloud`));
  const displaySubtitle = userProfile?.email || (isConfigured ? `Dataset: ${config.dataset}` : i18n._(msg`No conectado`));

  return (
    <div id="div-sanity-account-container" className="relative shrink-0" ref={dropdownRef}>
      <button
        id="btn-sanity-account-badge"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-7 px-2 rounded-md border flex items-center gap-1.5 cursor-pointer transition-all text-xs font-sans select-none ${
          isConfigured
            ? 'bg-[var(--surface-container)] border-[var(--outline)] hover:border-[#F03E2F]/60 text-[var(--on-surface)]'
            : 'bg-[var(--surface-container)]/40 border-[var(--outline)] hover:border-[var(--on-surface-variant)] text-[var(--on-surface-variant)] opacity-80 hover:opacity-100'
        } ${isOpen ? 'ring-1 ring-[#F03E2F]/60' : ''}`}
        title={
          isConfigured
            ? i18n._(msg`Cuenta de Sanity: ${displayName}`)
            : i18n._(msg`Conectar con Sanity Cloud`)
        }
        aria-label={i18n._(msg`Cuenta de Sanity`)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {/* User avatar or Sanity logo */}
        {userProfile?.profileImage ? (
          <div className="relative w-4.5 h-4.5 shrink-0 flex items-center justify-center">
            <img
              src={userProfile.profileImage}
              alt={userProfile.name || 'Sanity User'}
              className="w-4.5 h-4.5 rounded-full object-cover border border-[#F03E2F]/40"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#F03E2F] border border-[var(--surface)]" />
          </div>
        ) : (
          <div className="relative shrink-0 flex items-center justify-center">
            <SanityLogoIcon className="w-4 h-4" isConnected={isConfigured} />
            {isConfigured && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                  isAuthenticated ? 'bg-emerald-500 ring-1 ring-emerald-400/40' : 'bg-amber-400'
                }`}
              />
            )}
          </div>
        )}

        {/* Short label on larger screens */}
        <span className="hidden md:inline font-medium text-[11px] max-w-[110px] truncate">
          {userProfile?.name ? userProfile.name.split(' ')[0] : isConfigured ? config.projectId : 'Sanity'}
        </span>
      </button>

      {/* Popover Account Menu */}
      {isOpen && (
        <div
          id="div-sanity-account-dropdown"
          role="menu"
          aria-label={i18n._(msg`Opciones de cuenta Sanity`)}
          className="absolute right-0 top-full mt-1.5 w-64 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-xl py-2 z-50 animate-fade-in select-none text-xs flex flex-col"
        >
          {/* Header with User / Project Profile */}
          <div className="px-3 py-2 border-b border-[var(--outline)] flex items-start gap-2.5">
            {userProfile?.profileImage ? (
              <img
                src={userProfile.profileImage}
                alt={userProfile.name || 'Avatar'}
                className="w-8 h-8 rounded-full object-cover border border-[#F03E2F] mt-0.5 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#F03E2F]/10 border border-[#F03E2F]/30 flex items-center justify-center shrink-0 mt-0.5">
                <SanityLogoIcon className="w-5 h-5" isConnected={isConfigured} />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[var(--on-surface)] truncate">
                {displayName}
              </div>
              <div className="text-[11px] text-[var(--on-surface-variant)] truncate">
                {displaySubtitle}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                {isConfigured ? (
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium font-mono px-1.5 py-0.2 rounded border ${
                      isAuthenticated
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isAuthenticated ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    {isAuthenticated ? i18n._(msg`Lectura & Escritura`) : i18n._(msg`Solo lectura`)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium font-mono px-1.5 py-0.2 rounded border bg-neutral-500/10 text-neutral-400 border-neutral-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                    {i18n._(msg`Desconectado`)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Account Actions */}
          <div className="py-1 flex flex-col">
            {onOpenStudio && isConfigured && (
              <button
                id="btn-sanity-account-open-studio"
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenStudio();
                }}
                className="w-full px-3 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer transition-colors"
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
              className="w-full px-3 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">settings</span>
              <span>{isConfigured ? i18n._(msg`Configurar Sanity`) : i18n._(msg`Conectar Sanity`)}</span>
            </button>

            {isConfigured && (
              <a
                id="link-sanity-account-manage"
                href={`https://manage.sanity.io/projects/${config.projectId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="w-full px-3 py-1.5 text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center justify-between cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
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
                  className="w-full px-3 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer transition-colors font-medium"
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
