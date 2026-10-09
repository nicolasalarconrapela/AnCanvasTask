import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Workspace, BranchConfig, logWorkspaceTrace } from '../services/workspaceService';

interface WorkspaceSelectorProps {
  workspace: Workspace;
  allWorkspaces: Workspace[];
  activeBranch: BranchConfig;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectBranch: (branchName: string) => void;
  onOpenWorkspaceManager: (tab?: 'workspaces' | 'branches' | 'create') => void;
  onOpenCreateBranch: () => void;
  onOpenGitHubSync?: () => void;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  workspace,
  allWorkspaces,
  activeBranch,
  onSelectWorkspace,
  onSelectBranch,
  onOpenWorkspaceManager,
  onOpenCreateBranch,
}) => {
  const { i18n } = useLingui();
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);

  const [wsFilter, setWsFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  const wsDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setIsBranchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredWorkspaces = useMemo(() => {
    if (!wsFilter.trim()) return allWorkspaces || [];
    const q = wsFilter.toLowerCase();
    return (allWorkspaces || []).filter((w) => w.name.toLowerCase().includes(q));
  }, [allWorkspaces, wsFilter]);

  const filteredBranches = useMemo(() => {
    if (!branchFilter.trim()) return workspace?.branches || [];
    const q = branchFilter.toLowerCase();
    return (workspace?.branches || []).filter((b) => b.name.toLowerCase().includes(q));
  }, [workspace, branchFilter]);

  return (
    <div id="div-workspaceselector-1" className="flex items-center gap-1 sm:gap-1.5 shrink-0">
      {/* Workspace Picker Dropdown */}
      <div id="div-workspaceselector-2" className="relative" ref={wsDropdownRef}>
        <button
          id="btn-workspace-selector-trigger"
          type="button"
          onClick={() => {
            setIsWorkspaceMenuOpen((prev) => !prev);
            setIsBranchMenuOpen(false);
            setWsFilter('');
          }}
          className="btn-m3-secondary flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-sans font-medium cursor-pointer shrink-0"
          title={`Workspace: ${workspace?.name || 'Principal'}`}
        >
          {/* Workspace Icon */}
          <span className="material-symbols-outlined text-[15px] text-[var(--primary)] shrink-0">
            workspaces
          </span>

          <span className="font-semibold truncate max-w-[70px] sm:max-w-[120px]">
            {workspace?.name || 'Principal'}
          </span>

          <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)] shrink-0">
            arrow_drop_down
          </span>
        </button>

        {/* Workspace Dropdown Menu */}
        {isWorkspaceMenuOpen && (
          <div id="div-workspaceselector-3" className="absolute left-0 top-full mt-1 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in select-none">
            <div id="div-workspaceselector-4" className="px-3 py-1.5 border-b border-[var(--outline)] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                {i18n._(msg`Workspaces`)}
              </span>
              <button
                id="btn-manage-workspaces-header"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logWorkspaceTrace('Clic en botón Administrar desde Barra Superior -> abriendo WorkspaceManagerModal');
                  setIsWorkspaceMenuOpen(false);
                  onOpenWorkspaceManager('workspaces');
                }}
                className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer font-medium"
              >
                {i18n._(msg`Administrar`)}
              </button>
            </div>

            {(allWorkspaces || []).length > 3 && (
              <div className="px-2 pt-1 pb-1">
                <input
                  type="text"
                  value={wsFilter}
                  onChange={(e) => setWsFilter(e.target.value)}
                  placeholder={i18n._(msg`Filtrar workspaces...`)}
                  className="w-full px-2 py-1 text-xs rounded bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] text-[var(--on-surface)] focus:outline-none"
                />
              </div>
            )}

            <div id="div-workspaceselector-5" className="max-h-56 overflow-y-auto py-1">
              {filteredWorkspaces.map((ws) => {
                const isCurrent = ws.id === workspace?.id;
                const totalDocs = (ws.branches || []).reduce(
                  (acc, b) => acc + (b.taskDocuments?.length || 0),
                  0
                );
                return (
                  <button
                    key={ws.id}
                    id={`btn-select-workspace-${ws.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      logWorkspaceTrace(`Clic para seleccionar Workspace desde Barra Superior: "${ws.name}" (${ws.id})`, {
                        id: ws.id,
                        name: ws.name,
                        esActual: isCurrent,
                      });
                      onSelectWorkspace(ws.id);
                      setIsWorkspaceMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-start justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-[var(--primary-container)]/30 text-[var(--primary)] font-medium'
                        : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                    }`}
                  >
                    <div id="div-workspaceselector-6" className="flex flex-col min-w-0">
                      <div id="div-workspaceselector-7" className="flex items-center gap-1.5">
                        <span className="font-semibold truncate">{ws.name}</span>
                        {isCurrent && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] font-sans text-[var(--on-surface-variant)] truncate">
                        {ws.githubRepo?.description || `${(ws.branches || []).length} ramas`}
                      </span>
                    </div>

                    <div id="div-workspaceselector-8" className="flex flex-col items-end shrink-0 text-[10px] font-mono text-[var(--on-surface-variant)]">
                      <span>{(ws.branches || []).length} {i18n._(msg`Ramas`).toLowerCase()}</span>
                      <span>{totalDocs} {i18n._(msg`Task MD`)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div id="div-workspaceselector-9" className="pt-1 border-t border-[var(--outline)] px-2 py-1">
              <button
                id="btn-new-workspace-dropdown"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logWorkspaceTrace('Clic en + Nuevo Workspace desde Barra Superior -> abriendo WorkspaceManagerModal');
                  setIsWorkspaceMenuOpen(false);
                  onOpenWorkspaceManager('create');
                }}
                className="btn-m3-secondary w-full py-1 text-xs justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>+ {i18n._(msg`Nuevo Workspace`)}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Branch Selector Dropdown */}
      <div id="div-workspaceselector-10" className="relative" ref={branchDropdownRef}>
        <button
          id="btn-branch-selector-trigger"
          type="button"
          onClick={() => {
            setIsBranchMenuOpen((prev) => !prev);
            setIsWorkspaceMenuOpen(false);
            setBranchFilter('');
          }}
          className="btn-m3-secondary flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-mono font-medium cursor-pointer shrink-0"
          title={`${i18n._(msg`Rama actual`)}: ${activeBranch?.name || 'main'}`}
        >
          <span className="material-symbols-outlined text-[14px] text-sky-400 shrink-0">
            fork_right
          </span>
          <span className="font-medium truncate max-w-[70px] sm:max-w-[120px]">
            {activeBranch?.name || 'main'}
          </span>
          <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)] shrink-0">
            arrow_drop_down
          </span>
        </button>

        {/* Branch Dropdown Menu */}
        {isBranchMenuOpen && (
          <div id="div-workspaceselector-11" className="absolute left-0 top-full mt-1 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in select-none">
            <div id="div-workspaceselector-12" className="px-3 py-1.5 border-b border-[var(--outline)] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                {i18n._(msg`Ramas`)} ({(workspace?.branches || []).length})
              </span>
              <button
                id="btn-manage-branches-header"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsBranchMenuOpen(false);
                  onOpenWorkspaceManager('branches');
                }}
                className="text-[10px] text-sky-400 hover:underline cursor-pointer font-medium"
              >
                {i18n._(msg`Administrar`)}
              </button>
            </div>

            {(workspace?.branches || []).length > 3 && (
              <div className="px-2 pt-1 pb-1">
                <input
                  type="text"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  placeholder={i18n._(msg`Filtrar ramas...`)}
                  className="w-full px-2 py-1 text-xs rounded bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] text-[var(--on-surface)] focus:outline-none"
                />
              </div>
            )}

            <div id="div-workspaceselector-13" className="max-h-56 overflow-y-auto py-1">
              {filteredBranches.map((b) => {
                const isCurrent = b.name === activeBranch?.name;
                const docCount = b.taskDocuments?.length || 0;
                return (
                  <button
                    key={b.name}
                    id={`btn-select-branch-${b.name}`}
                    type="button"
                    onClick={() => {
                      onSelectBranch(b.name);
                      setIsBranchMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-start justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-[var(--primary-container)]/30 text-[var(--primary)] font-medium'
                        : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                    }`}
                  >
                    <div id="div-workspaceselector-14" className="flex flex-col min-w-0">
                      <div id="div-workspaceselector-15" className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px] text-sky-400 shrink-0">
                          fork_right
                        </span>
                        <span className="font-mono font-medium truncate">{b.name}</span>
                        {b.isProtected && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300">
                            lock
                          </span>
                        )}
                      </div>
                      {b.lastCommit && (
                        <span className="text-[10px] text-[var(--on-surface-variant)] truncate pl-5">
                          {b.lastCommit.message}
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0 pt-0.5">
                      {docCount} doc{docCount !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <div id="div-workspaceselector-16" className="pt-1 border-t border-[var(--outline)] px-2 py-1 flex items-center gap-1.5">
              <button
                id="btn-new-branch-dropdown"
                type="button"
                onClick={() => {
                  setIsBranchMenuOpen(false);
                  onOpenCreateBranch();
                }}
                className="btn-m3-secondary flex-1 py-1 text-xs justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>+ {i18n._(msg`Nueva rama`)}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
