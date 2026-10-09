import React, { useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { formatTaskCount } from '../i18n';
import { TaskPriority, TaskStatus } from '../shapes/TaskShapeUtil';

export type TaskSortOption = 'default' | 'priority' | 'status' | 'title';

export interface TaskFilterState {
  status: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  section: string | 'all';
  tag: string | 'all';
  onlyBlocked: boolean;
  sortBy: TaskSortOption;
}

interface FilterBarProps {
  filters: TaskFilterState;
  onFilterChange: (filters: TaskFilterState) => void;
  onResetFilters: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  availableSections: string[];
  availableTags: string[];
  totalTasksCount: number;
  filteredTasksCount: number;
  onOpenCommandPalette: () => void;
  onAutoOrganize?: () => void;
  isAutoOrganizing?: boolean;
  currentFileName?: string;
  hasUnsavedChanges?: boolean;
  onRenameDocument?: () => void;
  activeView?: string;
  syncStatus?: string;
  onOpenSanityModal?: () => void;
  onOpenSyncOverrideModal?: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  searchQuery,
  onSearchChange,
  availableSections,
  availableTags,
  totalTasksCount,
  filteredTasksCount,
  onOpenCommandPalette,
  onAutoOrganize,
  isAutoOrganizing,
  currentFileName,
  hasUnsavedChanges,
  onRenameDocument,
  activeView,
  syncStatus,
  onOpenSanityModal,
  onOpenSyncOverrideModal,
}) => {
  const { i18n } = useLingui();
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    if (!isFilterPopoverOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsFilterPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterPopoverOpen]);

  // Count active non-default filters
  const activeFiltersCount =
    (filters.status !== 'all' ? 1 : 0) +
    (filters.priority !== 'all' ? 1 : 0) +
    (filters.section !== 'all' ? 1 : 0) +
    (filters.tag !== 'all' ? 1 : 0) +
    (filters.onlyBlocked ? 1 : 0) +
    (filters.sortBy !== 'default' ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  const hasActiveFilters = activeFiltersCount > 0;

  const statusOptions: Array<{ id: TaskStatus | 'all'; label: string }> = [
    { id: 'all', label: 'Todos los estados' },
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'Todo (Pendiente)' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'done', label: 'Done (Completada)' },
  ];

  const priorityOptions: Array<{ id: TaskPriority | 'all'; label: string }> = [
    { id: 'all', label: 'Todas las prioridades' },
    { id: 'P0', label: 'P0 · Critical' },
    { id: 'P1', label: 'P1 · High' },
    { id: 'P2', label: 'P2 · Medium' },
    { id: 'P3', label: 'P3 · Low' },
  ];

  const sortOptions: Array<{ id: TaskSortOption; label: string }> = [
    { id: 'default', label: 'Orden del documento' },
    { id: 'priority', label: 'Prioridad (P0 → P3)' },
    { id: 'status', label: 'Estado' },
    { id: 'title', label: 'Título (A → Z)' },
  ];

  return (
    <div id="div-filterbar-1" className="w-full bg-[var(--surface-container)] border-b border-[var(--outline)] px-3 sm:px-4 py-1.5 flex flex-col gap-1.5 select-none shrink-0 z-10">
      {/* Top row of FilterBar: Filter popover toggle + Search trigger + Quick view summary */}
      <div id="div-filterbar-2" className="flex items-center justify-between gap-1.5 sm:gap-2">
        <div id="div-filterbar-3" className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
          {activeView !== 'studio' && (
            <>
              {/* Filter Popover Button */}
              <div id="div-filterbar-4" className="relative shrink-0" ref={popoverRef}>
                <button
                  id="btn-filter-popover-toggle"
                  type="button"
                  aria-expanded={isFilterPopoverOpen}
                  aria-haspopup="true"
                  aria-label={i18n._(msg`Abrir panel de filtros y ordenación`)}
                  onClick={() => setIsFilterPopoverOpen(!isFilterPopoverOpen)}
                  className={`btn-m3-secondary px-2.5 sm:px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    activeFiltersCount > (searchQuery ? 1 : 0)
                      ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]/20'
                      : ''
                  }`}
                  title={i18n._(msg`Abrir panel de filtros y ordenación`)}
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                  <span className="hidden xs:inline">{i18n._(msg`Filtros`)}</span>
                  {activeFiltersCount > 0 && (
                    <span className="w-4 h-4 rounded bg-[var(--primary)] text-[var(--on-primary)] text-[10px] font-bold flex items-center justify-center font-mono">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {/* Filter Popover Content */}
                {isFilterPopoverOpen && (
                  <div
                    id="div-filter-popover-content"
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute left-0 top-9 z-40 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md shadow-md p-3 flex flex-col gap-2.5 text-xs"
                  >
                    <div id="div-filterbar-5" className="flex items-center justify-between border-b border-[var(--outline)] pb-2">
                      <span className="font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">filter_list</span>
                        <span>{i18n._(msg`Filtros avanzados`)}</span>
                      </span>
                      <button
                        id="btn-filter-popover-close"
                        type="button"
                        onClick={() => setIsFilterPopoverOpen(false)}
                        className="btn-m3-icon w-6 h-6 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>

                    {/* 1. Estado */}
                    <div id="div-filterbar-6" className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                        {i18n._(msg`Estado`)}
                      </label>
                      <select
                        value={filters.status}
                        onChange={(e) =>
                          onFilterChange({ ...filters, status: e.target.value as any })
                        }
                        className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                      >
                        {statusOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 2. Prioridad */}
                    <div id="div-filterbar-7" className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                        {i18n._(msg`Prioridad`)}
                      </label>
                      <select
                        value={filters.priority}
                        onChange={(e) =>
                          onFilterChange({ ...filters, priority: e.target.value as any })
                        }
                        className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                      >
                        {priorityOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 3. Sección */}
                    {availableSections.length > 0 && (
                      <div id="div-filterbar-8" className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                          {i18n._(msg`Sección (Grupo)`)}
                        </label>
                        <select
                          value={filters.section}
                          onChange={(e) =>
                            onFilterChange({ ...filters, section: e.target.value })
                          }
                          className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                        >
                          <option value="all">{i18n._(msg`Todas las secciones`)}</option>
                          {availableSections.map((sec) => (
                            <option key={sec} value={sec}>
                              ## {sec}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 4. Etiqueta */}
                    {availableTags.length > 0 && (
                      <div id="div-filterbar-9" className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                          {i18n._(msg`Etiqueta`)}
                        </label>
                        <select
                          value={filters.tag}
                          onChange={(e) =>
                            onFilterChange({ ...filters, tag: e.target.value })
                          }
                          className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                        >
                          <option value="all">{i18n._(msg`Todas las etiquetas`)}</option>
                          {availableTags.map((tag) => (
                            <option key={tag} value={tag}>
                              #{tag}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 5. Solo bloqueadas */}
                    <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                      <input
                        type="checkbox"
                        checked={filters.onlyBlocked}
                        onChange={(e) =>
                          onFilterChange({ ...filters, onlyBlocked: e.target.checked })
                        }
                        className="w-3.5 h-3.5 rounded text-[var(--primary)] focus:ring-0 cursor-pointer"
                      />
                      <span className="text-xs text-[var(--on-surface)] font-medium">
                        {i18n._(msg`Mostrar únicamente tareas bloqueadas`)}
                      </span>
                    </label>

                    {/* 6. Ordenación */}
                    <div id="div-filterbar-10" className="flex flex-col gap-1 pt-1 border-t border-[var(--outline)]">
                      <label className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                        {i18n._(msg`Ordenar por`)}
                      </label>
                      <select
                        value={filters.sortBy}
                        onChange={(e) =>
                          onFilterChange({ ...filters, sortBy: e.target.value as any })
                        }
                        className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
                      >
                        {sortOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Footer Buttons */}
                    <div id="div-filterbar-11" className="flex items-center justify-between pt-2 border-t border-[var(--outline)] mt-1">
                      <button
                        id="btn-filter-reset-popover"
                        type="button"
                        onClick={() => {
                          onResetFilters();
                          setIsFilterPopoverOpen(false);
                        }}
                        className="btn-m3-text py-1 text-[11px] text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer"
                      >
                        {i18n._(msg`Restablecer`)}
                      </button>

                      <button
                        id="btn-filter-done-popover"
                        type="button"
                        onClick={() => setIsFilterPopoverOpen(false)}
                        className="btn-m3-primary px-3 py-1 text-xs cursor-pointer"
                      >
                        {i18n._(msg`Listo`)}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Command Palette Button (Cmd + K) on desktop */}
              <button
                id="btn-open-command-palette-filterbar"
                type="button"
                onClick={onOpenCommandPalette}
                className="btn-m3-secondary px-3 py-1.5 text-xs cursor-pointer hidden sm:flex items-center gap-1.5 shrink-0"
                title={i18n._(msg`Abrir paleta de comandos y búsqueda global (Ctrl/Cmd + K)`)}
              >
                <span className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">terminal</span>
                <span>{i18n._(msg`Comandos`)}</span>
                <kbd className="px-1.5 py-0.2 rounded bg-[var(--surface)] border border-[var(--outline)] font-mono text-[10px] text-[var(--on-surface-variant)]">
                  ⌘K
                </kbd>
              </button>
            </>
          )}

          {/* Mobile & Tablet Quick Search Input */}
          <div id="div-filterbar-12" className="relative flex-1 md:hidden min-w-[110px] max-w-[220px]">
            <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-[var(--on-surface-variant)] pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onSearchChange('');
                }
              }}
              placeholder={i18n._(msg`Buscar...`)}
              className="w-full bg-[var(--surface)] text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] border border-[var(--outline)] rounded pl-6 pr-5 py-1 text-xs font-sans focus:outline-none focus:border-[var(--primary)]"
            />
            {searchQuery && (
              <button
                id="btn-clear-search-filterbar"
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                title={i18n._(msg`Limpiar búsqueda`)}
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Current Document Indicator & Counter of matching tasks */}
        <div id="div-filterbar-13" className="flex items-center gap-2 text-xs font-mono text-[var(--on-surface-variant)] shrink-0">
          {activeView === 'studio' ? (
            <div id="div-filterbar-14" className="flex items-center gap-1.5 shrink-0">
              {onOpenSanityModal && (
                <button
                  id="btn-sanity-status-filterbar"
                  type="button"
                  onClick={onOpenSanityModal}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                  title={i18n._(msg`Estado y configuración de Sanity`)}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      syncStatus === 'synced'
                        ? 'bg-emerald-400'
                        : syncStatus === 'saving' || syncStatus === 'loading'
                        ? 'bg-sky-400 animate-pulse'
                        : 'bg-zinc-400'
                    }`}
                  />
                  <span>
                    {syncStatus === 'synced'
                      ? 'Sanity Sync'
                      : syncStatus === 'saving'
                      ? i18n._(msg`Guardando...`)
                      : 'Sanity Local'}
                  </span>
                </button>
              )}

              {onOpenSyncOverrideModal && (
                <button
                  id="btn-sync-override-filterbar"
                  type="button"
                  onClick={onOpenSyncOverrideModal}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] hover:border-[var(--primary)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                  title={i18n._(msg`Sincronizar y detectar diferencias, overrides y conflictos con Sanity Cloud`)}
                >
                  <span className="material-symbols-outlined text-[15px] text-[var(--primary)]">
                    sync_alt
                  </span>
                  <span>{i18n._(msg`Sincronizar`)}</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {currentFileName && onRenameDocument && (
                <div
                  id="div-current-document-indicator"
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] font-mono truncate cursor-pointer hover:bg-[var(--surface-container-high)] transition-colors"
                  onClick={onRenameDocument}
                  title={i18n._(msg`Documento activo: ${currentFileName} (Clic para renombrar/mover)`)}
                >
                  <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)]">
                    description
                  </span>
                  <span className="font-medium text-[var(--on-surface)] truncate max-w-[120px] lg:max-w-[160px]">
                    {currentFileName}
                  </span>
                  {hasUnsavedChanges ? (
                    <span className="flex items-center gap-1 text-amber-400 text-[10px] shrink-0 font-sans">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="hidden xl:inline">{i18n._(msg`modificado`)}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-400 text-[10px] shrink-0 font-sans">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="hidden xl:inline">{i18n._(msg`al día`)}</span>
                    </span>
                  )}
                </div>
              )}

              <span id="span-filterbar-task-counter" className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] font-mono">
                <span id="span-filterbar-counter-mobile" className="sm:hidden">{filteredTasksCount}/{totalTasksCount}</span>
                <span id="span-filterbar-counter-desktop" className="hidden sm:inline">
                  {filteredTasksCount === totalTasksCount
                    ? formatTaskCount(totalTasksCount)
                    : `${filteredTasksCount} de ${formatTaskCount(totalTasksCount)}`}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Active Filter Chips Bar (Visible when any filter or query is active) */}
      {hasActiveFilters && (
        <div id="div-filterbar-15" className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[var(--outline)]">
          <span className="text-[11px] text-[var(--on-surface-variant)] font-medium">
            {i18n._(msg`Filtros activos:`)}
          </span>

          {searchQuery.trim() && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--primary)]/60 text-[11px] text-[var(--primary)] font-medium flex items-center gap-1">
              <span>{i18n._(msg`Búsqueda:`)} “{searchQuery}”</span>
              <button
                id="btn-chip-remove-query"
                type="button"
                onClick={() => onSearchChange('')}
                className="hover:text-rose-400 cursor-pointer font-bold"
                title={i18n._(msg`Quitar búsqueda`)}
              >
                ×
              </button>
            </span>
          )}

          {filters.status !== 'all' && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface)] font-medium flex items-center gap-1">
              <span>{i18n._(msg`Estado:`)} {filters.status}</span>
              <button
                id="btn-chip-remove-status"
                type="button"
                onClick={() => onFilterChange({ ...filters, status: 'all' })}
                className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {filters.priority !== 'all' && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface)] font-mono font-medium flex items-center gap-1">
              <span>{i18n._(msg`Prioridad:`)} {filters.priority}</span>
              <button
                id="btn-chip-remove-priority"
                type="button"
                onClick={() => onFilterChange({ ...filters, priority: 'all' })}
                className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {filters.section !== 'all' && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface)] font-medium flex items-center gap-1">
              <span>{i18n._(msg`Sección:`)} ## {filters.section}</span>
              <button
                id="btn-chip-remove-section"
                type="button"
                onClick={() => onFilterChange({ ...filters, section: 'all' })}
                className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {filters.tag !== 'all' && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface)] font-mono flex items-center gap-1">
              <span>{i18n._(msg`Etiqueta:`)} #{filters.tag}</span>
              <button
                id="btn-chip-remove-tag"
                type="button"
                onClick={() => onFilterChange({ ...filters, tag: 'all' })}
                className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {filters.onlyBlocked && (
            <span className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-[11px] text-amber-300 font-medium flex items-center gap-1">
              <span>{i18n._(msg`Solo bloqueadas`)}</span>
              <button
                id="btn-chip-remove-blocked"
                type="button"
                onClick={() => onFilterChange({ ...filters, onlyBlocked: false })}
                className="hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {filters.sortBy !== 'default' && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface-variant)] font-medium flex items-center gap-1">
              <span>{i18n._(msg`Orden:`)} {filters.sortBy}</span>
              <button
                id="btn-chip-remove-sort"
                type="button"
                onClick={() => onFilterChange({ ...filters, sortBy: 'default' })}
                className="hover:text-rose-400 cursor-pointer font-bold"
              >
                ×
              </button>
            </span>
          )}

          {/* Reset All Button */}
          <button
            id="btn-chip-reset-all"
            type="button"
            onClick={onResetFilters}
            className="text-[11px] text-[var(--primary)] hover:underline ml-1 cursor-pointer font-medium"
          >
            {i18n._(msg`Limpiar todos`)}
          </button>
        </div>
      )}
    </div>
  );
};
