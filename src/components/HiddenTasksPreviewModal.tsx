import React, { useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { CompletedTaskGroup, getPriorityBadgeClasses } from './MarkdownSplitEditor';

export interface HiddenTasksPreviewModalProps {
  isOpen: boolean;
  group: CompletedTaskGroup | null;
  onClose: () => void;
  onUnhideInEditor?: () => void;
}

export const HiddenTasksPreviewModal: React.FC<HiddenTasksPreviewModalProps> = ({
  isOpen,
  group,
  onClose,
  onUnhideInEditor,
}) => {
  const { i18n } = useLingui();

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !group) return null;

  return (
    <div
      id="modal-hidden-tasks-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-hidden-tasks-title"
    >
      <div
        id="modal-hidden-tasks-dialog"
        className="w-full sm:max-w-xl bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-lg flex flex-col overflow-hidden max-h-[85vh] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          id="div-hidden-tasks-header"
          className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between gap-2 bg-[var(--surface)] shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[18px] text-emerald-500 shrink-0">
              task_alt
            </span>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2
                id="modal-hidden-tasks-title"
                className="text-xs sm:text-sm font-semibold text-[var(--on-surface)] truncate"
              >
                {i18n._(msg`Tareas completadas ocultas`)}
              </h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 shrink-0">
                {group.taskCount} {group.taskCount === 1 ? i18n._(msg`tarea`) : i18n._(msg`tareas`)}
              </span>
              {group.contextHeading && (
                <span className="text-[10px] text-[var(--on-surface-variant)] truncate hidden sm:inline">
                  {i18n._(msg`en`)} <strong className="font-mono text-[var(--on-surface)]">{group.contextHeading}</strong>
                </span>
              )}
            </div>
          </div>
          <button
            id="btn-hidden-tasks-close-header"
            type="button"
            onClick={onClose}
            className="btn-m3-icon w-7 h-7 cursor-pointer shrink-0"
            aria-label={i18n._(msg`Cerrar`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Informative Subheader */}
        <div className="px-4 py-1.5 bg-[var(--surface-container-low)] border-b border-[var(--outline)] text-[11px] text-[var(--on-surface-variant)] flex items-center justify-between gap-2 shrink-0">
          <span>
            {i18n._(msg`Estas tareas están ocultas en la vista en vivo de Markdown.`)}
          </span>
          <span className="font-mono text-[10px] opacity-75 shrink-0">
            {i18n._(msg`Líneas`)} {group.startLine}–{group.endLine}
          </span>
        </div>

        {/* Task List */}
        <div
          id="div-hidden-tasks-body"
          className="p-3 sm:p-4 overflow-y-auto flex flex-col gap-2.5 max-h-[55vh]"
        >
          {group.tasks.map((task, idx) => (
            <div
              key={`${task.id || 'task'}-${task.line}-${idx}`}
              className="bg-[var(--surface)] border border-[var(--outline)] rounded p-2.5 sm:p-3 flex flex-col gap-1.5 select-text hover:border-[var(--primary)]/40 transition-colors"
            >
              {/* Task Header: Checkbox + Title + Line */}
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[16px] text-emerald-500 shrink-0 mt-0.5">
                  check_circle
                </span>
                <span className="text-xs font-semibold text-[var(--on-surface)] break-words flex-1 leading-snug">
                  {task.title}
                </span>
                <span className="text-[9.5px] font-mono text-[var(--on-surface-variant)] opacity-70 shrink-0 mt-0.5">
                  L{task.line}
                </span>
              </div>

              {/* Task Metadata Chips (ID, Status, Priority) */}
              {(task.id || task.status || task.priority) && (
                <div className="flex items-center gap-1.5 flex-wrap pl-6">
                  {task.id && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[9px] font-mono border bg-slate-500/10 text-slate-600 border-slate-400/30 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/60">
                      <span className="material-symbols-outlined text-[8.5px] opacity-70">tag</span>
                      ID: {task.id}
                    </span>
                  )}
                  {task.status && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[9px] font-mono border bg-sky-100/50 text-sky-900 border-sky-200/80 dark:bg-sky-950/30 dark:text-sky-200/90 dark:border-sky-700/40">
                      <span className="material-symbols-outlined text-[8.5px] opacity-70">check_circle</span>
                      Status: {task.status}
                    </span>
                  )}
                  {task.priority && (
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[9px] font-mono border ${getPriorityBadgeClasses(
                        task.priority
                      )}`}
                    >
                      <span className="material-symbols-outlined text-[8.5px] opacity-70">flag</span>
                      Priority: {task.priority}
                    </span>
                  )}
                </div>
              )}

              {/* Task Description */}
              {task.description && (
                <div className="ml-6 text-[11px] text-[var(--on-surface-variant)] bg-[var(--surface-container)]/50 border border-[var(--outline)]/50 rounded px-2 py-1 leading-relaxed">
                  {task.description}
                </div>
              )}

              {/* Original Markdown Collapsible */}
              <details className="ml-6 text-[9.5px] font-mono text-[var(--on-surface-variant)] pt-1 border-t border-[var(--outline)]/30">
                <summary className="cursor-pointer hover:text-[var(--on-surface)] select-none opacity-80">
                  {i18n._(msg`Ver Markdown original`)}
                </summary>
                <pre className="mt-1 p-2 rounded bg-[var(--surface-container)] text-[10px] font-mono text-[var(--on-surface)] overflow-x-auto whitespace-pre-wrap border border-[var(--outline)]/40 leading-tight">
                  {task.rawMarkdown}
                </pre>
              </details>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          id="div-hidden-tasks-footer"
          className="px-4 py-2.5 border-t border-[var(--outline)] bg-[var(--surface)] flex items-center justify-between gap-2 shrink-0"
        >
          <div className="text-[11px] text-[var(--on-surface-variant)]">
            {group.tasks.length} {group.tasks.length === 1 ? i18n._(msg`tarea oculta`) : i18n._(msg`tareas ocultas`)}
          </div>
          <div className="flex items-center gap-2">
            <button
              id="btn-hidden-tasks-close"
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--outline)] bg-[var(--surface-container)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer transition-colors"
            >
              {i18n._(msg`Cerrar`)}
            </button>
            {onUnhideInEditor && (
              <button
                id="btn-hidden-tasks-unhide"
                type="button"
                onClick={() => {
                  onUnhideInEditor();
                  onClose();
                }}
                className="px-3 py-1.5 text-xs font-medium rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-500/20 cursor-pointer transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">visibility</span>
                <span>{i18n._(msg`Mostrar en editor`)}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
