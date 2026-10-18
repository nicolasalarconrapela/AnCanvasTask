import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import { TaskPriority, TaskStatus } from '../shapes/TaskShapeUtil';
import { HighlightText } from '../utils/searchHighlight';

export interface CommandPaletteTask {
  taskId: string;
  title: string;
  groupTitle: string;
  completed: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  tags?: string[];
  blockedBy?: string;
}

export interface CommandPaletteAction {
  id: string;
  title: string;
  shortcut?: string;
  icon: string;
  category: 'action' | 'navigation' | 'view';
  perform: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: CommandPaletteTask[];
  sections: string[];
  tags: string[];
  recentTaskIds: string[];
  onSelectTask: (taskId: string) => void;
  onSelectSection: (section: string) => void;
  onSelectTag: (tag: string) => void;
  actions: CommandPaletteAction[];
}

type ResultItem =
  | { type: 'recent-task'; item: CommandPaletteTask; groupHeader?: string }
  | { type: 'action'; item: CommandPaletteAction; groupHeader?: string }
  | { type: 'task'; item: CommandPaletteTask; groupHeader?: string }
  | { type: 'section'; item: string; groupHeader?: string }
  | { type: 'tag'; item: string; groupHeader?: string };

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  tasks,
  sections,
  tags,
  recentTaskIds,
  onSelectTask,
  onSelectSection,
  onSelectTag,
  actions,
}) => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Focus input when opened and reset query
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build grouped results based on query
  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const items: ResultItem[] = [];

    if (!q) {
      // 1. If empty query, show Recent tasks first (if any)
      const recentTasks = recentTaskIds
        .map((id) => tasks.find((t) => t.taskId.toLowerCase() === id.toLowerCase()))
        .filter((t): t is CommandPaletteTask => Boolean(t))
        .slice(0, 4);

      if (recentTasks.length > 0) {
        recentTasks.forEach((t, i) =>
          items.push({
            type: 'recent-task',
            item: t,
            groupHeader: i === 0 ? i18n._(msg`Tareas recientes`) : undefined,
          })
        );
      }

      // 2. Frequent actions
      actions.slice(0, 6).forEach((a, i) =>
        items.push({
          type: 'action',
          item: a,
          groupHeader: i === 0 ? i18n._(msg`Acciones y Comandos`) : undefined,
        })
      );

      // 3. Sections
      sections.slice(0, 10).forEach((s, i) =>
        items.push({
          type: 'section',
          item: s,
          groupHeader: i === 0 ? i18n._(msg`Secciones (Grupos)`) : undefined,
        })
      );

      // 4. Tags
      tags.slice(0, 4).forEach((tag, i) =>
        items.push({
          type: 'tag',
          item: tag,
          groupHeader: i === 0 ? i18n._(msg`Etiquetas (#)`) : undefined,
        })
      );

      return items;
    }

    // A. Matching Actions
    const matchingActions = actions.filter((a) =>
      a.title.toLowerCase().includes(q)
    );
    matchingActions.forEach((a, i) =>
      items.push({
        type: 'action',
        item: a,
        groupHeader: i === 0 ? i18n._(msg`Acciones`) : undefined,
      })
    );

    // B. Matching Tasks (by title, ID, tags, status, priority, or group)
    const matchingTasks = tasks.filter((t) => {
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchId = t.taskId.toLowerCase().includes(q);
      const matchGroup = t.groupTitle.toLowerCase().includes(q);
      const matchTags = t.tags?.some((tag) => tag.toLowerCase().includes(q.replace(/^#/, '')));
      const matchStatus = t.status.toLowerCase().includes(q);
      const matchPriority = t.priority.toLowerCase().includes(q);
      return matchTitle || matchId || matchGroup || matchTags || matchStatus || matchPriority;
    });

    matchingTasks.slice(0, 10).forEach((t, i) =>
      items.push({
        type: 'task',
        item: t,
        groupHeader: i === 0 ? `${i18n._(msg`Tareas`)} (${matchingTasks.length})` : undefined,
      })
    );

    // C. Matching Sections
    const cleanSecQuery = q.replace(/^##\s*/, '');
    const matchingSections = sections.filter((s) =>
      s.toLowerCase().includes(cleanSecQuery)
    );
    matchingSections.slice(0, 10).forEach((s, i) =>
      items.push({
        type: 'section',
        item: s,
        groupHeader: i === 0 ? i18n._(msg`Secciones`) : undefined,
      })
    );

    // D. Matching Tags
    const cleanTagQuery = q.replace(/^#/, '');
    const matchingTags = tags.filter((tag) =>
      tag.toLowerCase().includes(cleanTagQuery)
    );
    matchingTags.slice(0, 4).forEach((tag, i) =>
      items.push({
        type: 'tag',
        item: tag,
        groupHeader: i === 0 ? i18n._(msg`Etiquetas`) : undefined,
      })
    );

    return items;
  }, [query, tasks, sections, tags, recentTaskIds, actions, i18n]);

  // Keep selected index within bounds
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (resultsContainerRef.current) {
      const activeEl = resultsContainerRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      ) as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Execute selected item
  const handleExecute = (item: ResultItem) => {
    onClose();
    if (item.type === 'action') {
      item.item.perform();
    } else if (item.type === 'task' || item.type === 'recent-task') {
      onSelectTask(item.item.taskId);
    } else if (item.type === 'section') {
      onSelectSection(item.item);
    } else if (item.type === 'tag') {
      onSelectTag(item.item);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? Math.max(0, results.length - 1) : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleExecute(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  const priorityStyles: Record<TaskPriority, string> = {
    P0: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
    P1: 'text-orange-400 bg-orange-950/40 border-orange-800/60',
    P2: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
    P3: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/60',
  };

  return (
    <div
      id="modal-command-palette-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={i18n._(msg`Paleta de comandos y búsqueda global`)}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-3 sm:p-6 pt-16 sm:pt-20"
    >
      <div
        id="modal-command-palette-dialog"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md overflow-hidden flex flex-col max-h-[82vh]"
      >
        {/* Search Input Header */}
        <div id="div-commandpalette-1" className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--outline)] bg-[var(--surface)]">
          <span className="material-symbols-outlined text-[18px] text-[var(--primary)] shrink-0">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={i18n._(msg`Escribe un comando o busca tareas, etiquetas (#), secciones (##)...`)}
            className="w-full bg-transparent text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] text-xs sm:text-sm font-sans focus:outline-none"
          />
          {query && (
            <button
              id="btn-command-palette-clear-query"
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] p-0.5 rounded cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          )}
          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[var(--surface-container)] border border-[var(--outline)] text-[10px] font-mono text-[var(--on-surface-variant)]">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div
          id="div-command-palette-results-list"
          ref={resultsContainerRef}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 min-h-[220px]"
        >
          {results.length === 0 ? (
            <div id="div-commandpalette-2" className="flex flex-col items-center justify-center p-8 text-center gap-2 text-[var(--on-surface-variant)]">
              <span className="material-symbols-outlined text-[32px] opacity-40">
                search_off
              </span>
              <p className="text-xs font-medium">
                {i18n._(msg`No se encontraron resultados para “${query}”`)}
              </p>
              <p className="text-[11px] text-[var(--on-surface-variant)]/80">
                {i18n._(msg`Prueba buscando por título, #ID, etiqueta o comando como “Kanban”`)}
              </p>
            </div>
          ) : (
            results.map((res, index) => {
              const isSelected = index === selectedIndex;

              return (
                <React.Fragment key={`${res.type}-${index}`}>
                  {res.groupHeader && (
                    <div id="div-commandpalette-3" className="text-[10px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider px-3 pt-2.5 pb-1 select-none">
                      {res.groupHeader}
                    </div>
                  )}

                  {res.type === 'action' && (
                    <button
                      id={`btn-cmd-palette-action-${index}`}
                      data-index={index}
                      type="button"
                      onClick={() => handleExecute(res)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                          : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                      }`}
                    >
                      <div id="div-commandpalette-4" className="flex items-center gap-2.5 truncate">
                        <span
                          className={`material-symbols-outlined text-[18px] ${
                            isSelected ? 'text-[var(--on-primary)]' : 'text-sky-400'
                          }`}
                        >
                          {res.item.icon}
                        </span>
                        <HighlightText text={res.item.title} query={query} className="truncate" />
                      </div>
                      {res.item.shortcut && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono border ${
                            isSelected
                              ? 'border-[var(--on-primary)]/40 bg-[var(--on-primary)]/10 text-[var(--on-primary)]'
                              : 'border-[var(--outline)] bg-[var(--surface)] text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {res.item.shortcut}
                        </span>
                      )}
                    </button>
                  )}

                  {(res.type === 'task' || res.type === 'recent-task') && (
                    <button
                      id={`btn-cmd-palette-task-${res.item.taskId || index}`}
                      data-index={index}
                      type="button"
                      onClick={() => handleExecute(res)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                          : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                      }`}
                    >
                      <div id="div-commandpalette-5" className="flex items-center gap-2 truncate flex-1 min-w-0">
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 border ${
                            res.item.completed
                              ? 'bg-emerald-500 text-white border-emerald-600'
                              : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--on-surface-variant)]'
                          }`}
                        >
                          {res.item.completed ? '✓' : ''}
                        </span>

                        <span
                          className={`font-mono text-[11px] px-1.5 py-0.2 rounded shrink-0 border ${
                            isSelected
                              ? 'bg-[var(--on-primary)]/20 border-[var(--on-primary)]/40 text-[var(--on-primary)]'
                              : 'bg-[var(--surface)] border-[var(--outline)] text-[var(--primary)]'
                          }`}
                        >
                          #<HighlightText text={res.item.taskId} query={query} />
                        </span>

                        <HighlightText
                          text={res.item.title}
                          query={query}
                          className={`truncate font-medium ${
                            res.item.completed ? 'line-through opacity-70' : ''
                          }`}
                        />
                      </div>

                      <div id="div-commandpalette-6" className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                            isSelected
                              ? 'border-[var(--on-primary)]/40 text-[var(--on-primary)]'
                              : priorityStyles[res.item.priority]
                          }`}
                        >
                          {res.item.priority}
                        </span>
                        <span className="text-[10px] font-mono opacity-70 hidden sm:inline truncate max-w-[100px]">
                          ## {res.item.groupTitle}
                        </span>
                      </div>
                    </button>
                  )}

                  {res.type === 'section' && (
                    <button
                      id={`btn-cmd-palette-section-${index}`}
                      data-index={index}
                      type="button"
                      onClick={() => handleExecute(res)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                          : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                      }`}
                    >
                      <div id="div-commandpalette-7" className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-amber-400">
                          folder
                        </span>
                        <span>
                          {i18n._(msg`Filtrar por sección:`)} <strong>## <HighlightText text={res.item} query={query} /></strong>
                        </span>
                      </div>
                      <span className="text-[10px] opacity-70">{i18n._(msg`Sección`)}</span>
                    </button>
                  )}

                  {res.type === 'tag' && (
                    <button
                      id={`btn-cmd-palette-tag-${index}`}
                      data-index={index}
                      type="button"
                      onClick={() => handleExecute(res)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--primary)] text-[var(--on-primary)] font-medium'
                          : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                      }`}
                    >
                      <div id="div-commandpalette-8" className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-purple-400">
                          label
                        </span>
                        <span>
                          {i18n._(msg`Filtrar por etiqueta:`)} <strong>#<HighlightText text={res.item} query={query} /></strong>
                        </span>
                      </div>
                      <span className="text-[10px] opacity-70">{i18n._(msg`Etiqueta`)}</span>
                    </button>
                  )}
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div id="div-commandpalette-9" className="px-4 py-2 bg-[var(--surface)] border-t border-[var(--outline)] flex items-center justify-between text-[11px] text-[var(--on-surface-variant)]">
          <div id="div-commandpalette-10" className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.2 rounded bg-[var(--surface-container)] border border-[var(--outline)] font-mono text-[10px]">
                ↑
              </kbd>
              <kbd className="px-1 py-0.2 rounded bg-[var(--surface-container)] border border-[var(--outline)] font-mono text-[10px]">
                ↓
              </kbd>
              <span>{i18n._(msg`Navegar`)}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.2 rounded bg-[var(--surface-container)] border border-[var(--outline)] font-mono text-[10px]">
                ↵
              </kbd>
              <span>{i18n._(msg`Seleccionar`)}</span>
            </span>
          </div>

          <span className="text-[10px] font-mono">
            {plural(results.length, { one: '# resultado', other: '# resultados' })}
          </span>
        </div>
      </div>
    </div>
  );
};
