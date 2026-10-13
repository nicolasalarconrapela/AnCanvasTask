import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import { TaskPriority, TaskStatus, SubtaskItem } from '../shapes/TaskShapeUtil';

export interface TaskDetailsData {
  taskId: string;
  shapeId?: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  tags?: string[];
  subtasks?: { total: number; completed: number; items?: SubtaskItem[] };
  blockedBy?: string;
  groupTitle?: string;
  hasMissingId?: boolean;
}

export interface MinimalTaskInfo {
  taskId: string;
  title: string;
  groupTitle: string;
  completed?: boolean;
  priority?: TaskPriority;
  status?: TaskStatus;
  blockedBy?: string;
}

interface TaskDetailsPanelProps {
  task: TaskDetailsData | null;
  selectedTaskIds: string[];
  allTasks: MinimalTaskInfo[];
  allSections: string[];
  onUpdateTask: (
    taskId: string,
    updates: {
      title?: string;
      completed?: boolean;
      priority?: TaskPriority;
      status?: TaskStatus;
      groupTitle?: string;
      tags?: string[];
      blockedBy?: string;
    }
  ) => void;
  onBatchUpdateTasks: (
    taskIds: string[],
    updates: {
      completed?: boolean;
      priority?: TaskPriority;
      status?: TaskStatus;
      groupTitle?: string;
    }
  ) => void;
  onDeleteTask: (taskId: string, title: string) => void;
  onBatchDeleteTasks: (taskIds: string[]) => void;
  onSelectTask: (taskId: string | null) => void;
  onFocusOnCanvas?: (taskId: string, title: string) => void;
  onAssignId?: (taskId: string, title?: string) => void;
  onClose: () => void;
}

export const TaskDetailsPanel: React.FC<TaskDetailsPanelProps> = ({
  task,
  selectedTaskIds,
  allTasks,
  allSections,
  onUpdateTask,
  onBatchUpdateTasks,
  onDeleteTask,
  onBatchDeleteTasks,
  onSelectTask,
  onFocusOnCanvas,
  onAssignId,
  onClose,
}) => {
  const { i18n } = useLingui();
  const isMultiSelect = selectedTaskIds.length > 1;

  // Single task local editing states
  const [localTitle, setLocalTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<'saved' | 'saving' | null>('saved');

  // Debounce ref for auto-saving edits
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (task) {
      setLocalTitle(task.title);
      setIsEditingTitle(false);
      setIsMenuOpen(false);
      setIsAddingTag(false);
      setNewTagInput('');
    }
  }, [task?.taskId, task?.title]);

  // Global escape handler to close panel when not editing inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        const isInput =
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable);
        if (!isInput && !isEditingTitle && !isAddingTag) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditingTitle, isAddingTag, onClose]);

  // Current task index and navigation
  const currentTaskIndex = useMemo(() => {
    if (!task) return -1;
    return allTasks.findIndex(
      (t) => t.taskId.toLowerCase() === task.taskId.toLowerCase()
    );
  }, [allTasks, task]);

  const prevTask = currentTaskIndex > 0 ? allTasks[currentTaskIndex - 1] : null;
  const nextTask =
    currentTaskIndex >= 0 && currentTaskIndex < allTasks.length - 1
      ? allTasks[currentTaskIndex + 1]
      : null;

  // Tasks that this task blocks (tasks whose blockedBy contains this taskId)
  const blockingTasks = useMemo(() => {
    if (!task) return [];
    const normalizedId = task.taskId.toLowerCase();
    return allTasks.filter((t) => {
      if (t.taskId.toLowerCase() === normalizedId) return false;
      if (!t.blockedBy) return false;
      const blockers = t.blockedBy.split(',').map((b) => b.trim().toLowerCase());
      return blockers.includes(normalizedId);
    });
  }, [allTasks, task]);

  const blockerIds = useMemo(() => {
    if (!task || !task.blockedBy) return [];
    return task.blockedBy
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
  }, [task?.blockedBy]);

  const handleTitleCommit = () => {
    if (!task) return;
    const trimmed = localTitle.trim();
    if (trimmed && trimmed !== task.title) {
      setSaveIndicator('saving');
      onUpdateTask(task.taskId, { title: trimmed });
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        setSaveIndicator('saved');
      }, 500);
    } else {
      setLocalTitle(task.title);
    }
    setIsEditingTitle(false);
  };

  const handleCopyId = () => {
    if (!task) return;
    navigator.clipboard.writeText(task.taskId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyMarkdownSnippet = () => {
    if (!task) return;
    const completedMark = task.completed ? 'x' : ' ';
    const tagsStr = task.tags && task.tags.length > 0 ? ` #${task.tags.join(' #')}` : '';
    const line = `- [${completedMark}] ${task.title}${tagsStr}\n  id: ${task.taskId}\n  priority: ${task.priority}\n  status: ${task.status}`;
    navigator.clipboard.writeText(line);
    setIsMenuOpen(false);
  };

  const handleAddTag = (tagStr: string) => {
    if (!task) return;
    const clean = tagStr.trim().replace(/^#/, '');
    if (!clean) return;
    const currentTags = task.tags || [];
    if (!currentTags.includes(clean)) {
      const updated = [...currentTags, clean];
      onUpdateTask(task.taskId, { tags: updated });
    }
    setNewTagInput('');
    setIsAddingTag(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!task) return;
    const currentTags = task.tags || [];
    const updated = currentTags.filter((t) => t !== tagToRemove);
    onUpdateTask(task.taskId, { tags: updated });
  };

  const handleAddBlocker = (blockerId: string) => {
    if (!task || !blockerId) return;
    const currentBlockers = blockerIds;
    if (!currentBlockers.includes(blockerId)) {
      const updatedStr = [...currentBlockers, blockerId].join(', ');
      onUpdateTask(task.taskId, { blockedBy: updatedStr });
    }
  };

  const handleRemoveBlocker = (blockerIdToRemove: string) => {
    if (!task) return;
    const updated = blockerIds.filter((b) => b.toLowerCase() !== blockerIdToRemove.toLowerCase());
    onUpdateTask(task.taskId, { blockedBy: updated.join(', ') });
  };

  const priorityOptions: Array<{ id: TaskPriority; label: string; desc: string; text: string; bg: string; border: string }> = [
    { id: 'P0', label: i18n._(msg`P0 · Crítica`), desc: i18n._(msg`Urgente`), text: 'text-rose-400', bg: 'bg-rose-950/40', border: 'border-rose-800/60' },
    { id: 'P1', label: i18n._(msg`P1 · Alta`), desc: i18n._(msg`Alta`), text: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-800/60' },
    { id: 'P2', label: i18n._(msg`P2 · Media`), desc: i18n._(msg`Media`), text: 'text-sky-400', bg: 'bg-sky-950/40', border: 'border-sky-800/60' },
    { id: 'P3', label: i18n._(msg`P3 · Baja`), desc: i18n._(msg`Baja`), text: 'text-zinc-400', bg: 'bg-zinc-800/40', border: 'border-zinc-700/60' },
  ];

  const statusOptions: Array<{ id: TaskStatus; label: string; icon: string; color: string }> = [
    { id: 'backlog', label: i18n._(msg`Backlog`), icon: 'inventory_2', color: 'text-slate-400' },
    { id: 'todo', label: i18n._(msg`Por Hacer`), icon: 'pending_actions', color: 'text-amber-400' },
    { id: 'in_progress', label: i18n._(msg`En Progreso`), icon: 'play_circle', color: 'text-sky-400' },
    { id: 'review', label: i18n._(msg`En Revisión`), icon: 'rate_review', color: 'text-purple-400' },
    { id: 'blocked', label: i18n._(msg`Bloqueada`), icon: 'lock', color: 'text-rose-400' },
    { id: 'done', label: i18n._(msg`Completada`), icon: 'check_circle', color: 'text-emerald-400' },
  ];

  // ----------------------------------------------------
  // MULTI-SELECTION VIEW
  // ----------------------------------------------------
  if (isMultiSelect) {
    const selectedCount = selectedTaskIds.length;
    return (
      <>
        {/* Mobile Backdrop Overlay */}
        <div
          id="modal-task-details-batch-backdrop"
          className="fixed inset-0 bg-black/60 z-30 sm:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />

        <aside
          aria-label={i18n._(msg`Panel de edición múltiple`)}
          className="fixed inset-x-0 bottom-0 max-h-[85vh] sm:static sm:max-h-none sm:w-96 bg-[var(--surface-container)] border-t sm:border-t-0 sm:border-l border-[var(--outline)] rounded-t-md sm:rounded-none flex flex-col justify-between p-4 z-40 flex-shrink-0 animate-slide-up sm:animate-none overflow-y-auto shadow-md sm:shadow-none pb-safe"
        >
          <div id="div-taskdetailspanel-1" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto mb-2 sm:hidden shrink-0" />
          <div id="div-taskdetailspanel-2" className="flex flex-col gap-4">
          {/* Header */}
          <div id="div-taskdetailspanel-3" className="flex items-center justify-between border-b border-[var(--outline)] pb-3">
            <div id="div-taskdetailspanel-4" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />
              <h2 className="text-sm font-semibold text-[var(--on-surface)]">
                {plural(selectedCount, { one: '# tarea seleccionada', other: '# tareas seleccionadas' })}
              </h2>
            </div>
            <button
              id="btn-batch-close"
              type="button"
              onClick={onClose}
              className="btn-m3-icon w-7 h-7 cursor-pointer"
              title={i18n._(msg`Cerrar panel`)}
              aria-label={i18n._(msg`Cerrar panel`)}
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <p className="text-xs text-[var(--on-surface-variant)] leading-relaxed">
            {i18n._(msg`Aplica cambios simultáneos a las ${selectedCount} tareas seleccionadas en el Workspace.`)}
          </p>

          {/* Batch Status Change */}
          <div id="div-taskdetailspanel-5" className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Cambiar Estado en Lote`)}
            </span>
            <div id="div-taskdetailspanel-6" className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {statusOptions.map((st) => (
                <button
                  id={`btn-batch-status-${st.id}`}
                  key={st.id}
                  type="button"
                  onClick={() => {
                    const isDone = st.id === 'done';
                    onBatchUpdateTasks(selectedTaskIds, {
                      status: st.id,
                      completed: isDone,
                    });
                  }}
                  className="py-1 px-2 rounded border border-[var(--outline)] bg-[var(--surface)] hover:bg-[var(--surface-container-high)] text-[11px] font-medium text-[var(--on-surface)] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span className={`material-symbols-outlined text-[14px] ${st.color}`}>
                    {st.icon}
                  </span>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Batch Priority Change */}
          <div id="div-taskdetailspanel-7" className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Cambiar Prioridad en Lote`)}
            </span>
            <div id="div-taskdetailspanel-8" className="grid grid-cols-4 gap-1.5">
              {priorityOptions.map((p) => (
                <button
                  id={`btn-batch-priority-${p.id}`}
                  key={p.id}
                  type="button"
                  onClick={() => onBatchUpdateTasks(selectedTaskIds, { priority: p.id })}
                  className={`py-1 rounded border text-xs font-mono font-medium text-center cursor-pointer transition-colors ${p.text} ${p.bg} ${p.border} hover:brightness-110`}
                >
                  {p.id}
                </button>
              ))}
            </div>
          </div>

          {/* Batch Section Change */}
          {allSections.length > 0 && (
            <div id="div-taskdetailspanel-9" className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                {i18n._(msg`Mover a Sección`)}
              </span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    onBatchUpdateTasks(selectedTaskIds, { groupTitle: e.target.value });
                  }
                }}
                className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2.5 py-1.5 text-xs font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
              >
                <option value="" disabled>
                  {i18n._(msg`Seleccionar sección de destino...`)}
                </option>
                {allSections.map((sec) => (
                  <option key={sec} value={sec}>
                    ## {sec}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div id="div-taskdetailspanel-10" className="pt-3 border-t border-[var(--outline)] flex items-center justify-between gap-2 mt-4">
          <button
            id="btn-batch-delete"
            type="button"
            onClick={() => onBatchDeleteTasks(selectedTaskIds)}
            className="btn-m3-secondary flex-1 py-1.5 text-xs text-[var(--error)] border-rose-800/60 bg-rose-950/30 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">delete</span>
            <span>{i18n._(msg`Eliminar ${selectedCount} tareas`)}</span>
          </button>
          <button
            id="btn-batch-deselect"
            type="button"
            onClick={onClose}
            className="btn-m3-text px-3 py-1.5 text-xs cursor-pointer"
          >
            {i18n._(msg`Deseleccionar`)}
          </button>
        </div>
      </aside>
      </>
    );
  }

  // If no task is selected at all
  if (!task) return null;

  const currentStatusId = task.completed ? 'done' : task.status || 'todo';

  // ----------------------------------------------------
  // SINGLE TASK DETAILS PANEL
  // ----------------------------------------------------
  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        id="modal-task-details-single-backdrop"
        className="fixed inset-0 bg-black/60 z-30 sm:hidden animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label={i18n._(msg`Panel de detalles de la tarea`)}
        className="fixed inset-x-0 bottom-0 max-h-[85vh] sm:static sm:max-h-none sm:w-88 bg-[var(--surface-container)] border-t sm:border-t-0 sm:border-l border-[var(--outline)] rounded-t-md sm:rounded-none flex flex-col justify-between p-3.5 z-40 flex-shrink-0 animate-slide-up sm:animate-none overflow-y-auto shadow-md sm:shadow-none pb-safe"
      >
        <div id="div-taskdetailspanel-11" className="w-10 h-1 bg-[var(--outline)] rounded mx-auto mb-2 sm:hidden shrink-0" />
        <div id="div-taskdetailspanel-12" className="flex flex-col gap-3.5">
        {/* 1. Header: #ID + Navigation + Menu + Close */}
        <div id="div-taskdetailspanel-13" className="flex items-center justify-between border-b border-[var(--outline)] pb-2.5">
          <div id="div-taskdetailspanel-14" className="flex items-center gap-1.5">
            {task.hasMissingId ? (
              <button
                id="btn-task-generate-id"
                type="button"
                onClick={() => {
                  if (onAssignId) {
                    onAssignId(task.taskId, task.title);
                  } else {
                    window.dispatchEvent(
                      new CustomEvent('antask:assign-task-id', {
                        detail: { taskId: task.taskId, taskTitle: task.title },
                      })
                    );
                  }
                }}
                className="flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/50 text-amber-300 hover:bg-amber-500/25 cursor-pointer transition-colors"
                title={i18n._(msg`Generar ID automático permanente en Markdown`)}
              >
                <span className="material-symbols-outlined text-[13px]">auto_fix_high</span>
                <span>{i18n._(msg`Generar ID`)}</span>
              </button>
            ) : (
              <button
                id="btn-task-copy-id"
                type="button"
                onClick={handleCopyId}
                className="group/id flex items-center gap-1 text-xs font-mono font-medium px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] hover:border-[var(--primary)] text-[var(--primary)] cursor-pointer transition-colors"
                title={i18n._(msg`Clic para copiar ID`)}
              >
                <span className="text-[var(--on-surface-variant)]">#</span>
                <span>{task.taskId}</span>
                <span className="material-symbols-outlined text-[12px] opacity-0 group-hover/id:opacity-100 transition-opacity">
                  {copiedId ? 'check' : 'content_copy'}
                </span>
              </button>
            )}

            {copiedId && (
              <span className="text-[10px] font-sans text-emerald-400">
                {i18n._(msg`¡Copiado!`)}
              </span>
            )}
          </div>

          <div id="div-taskdetailspanel-15" className="flex items-center gap-0.5">
            {/* Previous Task */}
            <button
              id="btn-task-prev"
              type="button"
              disabled={!prevTask}
              onClick={() => prevTask && onSelectTask(prevTask.taskId)}
              className="btn-m3-icon w-6 h-6 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={prevTask ? `${i18n._(msg`Anterior:`)} ${prevTask.title}` : i18n._(msg`No hay tarea anterior`)}
              aria-label={i18n._(msg`Tarea anterior`)}
            >
              <span className="material-symbols-outlined text-[15px]">arrow_back</span>
            </button>

            {/* Next Task */}
            <button
              id="btn-task-next"
              type="button"
              disabled={!nextTask}
              onClick={() => nextTask && onSelectTask(nextTask.taskId)}
              className="btn-m3-icon w-6 h-6 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={nextTask ? `${i18n._(msg`Siguiente:`)} ${nextTask.title}` : i18n._(msg`No hay tarea siguiente`)}
              aria-label={i18n._(msg`Tarea siguiente`)}
            >
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </button>

            {/* Context Menu Trigger ⋮ */}
            <div id="div-taskdetailspanel-16" className="relative">
              <button
                id="btn-task-menu-trigger"
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="btn-m3-icon w-6 h-6 cursor-pointer"
                title={i18n._(msg`Más opciones`)}
                aria-label={i18n._(msg`Más opciones`)}
              >
                <span className="material-symbols-outlined text-[16px]">more_vert</span>
              </button>

              {isMenuOpen && (
                <div
                  id="div-task-menu-dropdown"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-0 top-7 z-50 bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md shadow-lg p-1 flex flex-col gap-0.5 min-w-[170px] text-xs font-sans"
                >
                  {task.hasMissingId && (
                    <button
                      id="btn-task-menu-generate-id"
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        if (onAssignId) {
                          onAssignId(task.taskId, task.title);
                        } else {
                          window.dispatchEvent(
                            new CustomEvent('antask:assign-task-id', {
                              detail: { taskId: task.taskId, taskTitle: task.title },
                            })
                          );
                        }
                      }}
                      className="px-2 py-1 rounded text-left text-amber-300 hover:bg-[var(--surface-container-highest)] flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      <span>{i18n._(msg`Generar ID automático`)}</span>
                    </button>
                  )}

                  <button
                    id="btn-task-menu-copy-id"
                    type="button"
                    onClick={() => {
                      handleCopyId();
                      setIsMenuOpen(false);
                    }}
                    className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] flex items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">tag</span>
                    <span>{i18n._(msg`Copiar ID`)} (#{task.taskId})</span>
                  </button>

                  <button
                    id="btn-task-menu-copy-md"
                    type="button"
                    onClick={handleCopyMarkdownSnippet}
                    className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] flex items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    <span>{i18n._(msg`Copiar en Markdown`)}</span>
                  </button>

                  {onFocusOnCanvas && (
                    <button
                      id="btn-task-menu-focus-canvas"
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onFocusOnCanvas(task.taskId, task.title);
                      }}
                      className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] flex items-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">center_focus_strong</span>
                      <span>{i18n._(msg`Enfocar en Canvas`)}</span>
                    </button>
                  )}

                  <div id="div-taskdetailspanel-17" className="h-px bg-[var(--outline)] my-0.5" />

                  <button
                    id="btn-task-menu-delete"
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onDeleteTask(task.taskId, task.title);
                    }}
                    className="px-2 py-1 rounded text-left text-[var(--error)] hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    <span>{i18n._(msg`Eliminar tarea`)}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Close Button */}
            <button
              id="btn-task-close"
              type="button"
              onClick={onClose}
              className="btn-m3-icon w-6 h-6 cursor-pointer"
              title={i18n._(msg`Cerrar panel de detalles`)}
              aria-label={i18n._(msg`Cerrar panel de detalles`)}
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* 2. Title (Direct Inline Edit with clean focus) */}
        <div id="div-taskdetailspanel-18" className="flex flex-col gap-1">
          <div id="div-taskdetailspanel-19" className="flex items-center justify-between">
            <label className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Título`)}
            </label>
            <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
              {saveIndicator === 'saving' ? i18n._(msg`Guardando...`) : i18n._(msg`✓ Sincronizado`)}
            </span>
          </div>

          {isEditingTitle ? (
            <textarea
              autoFocus
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleTitleCommit();
                } else if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                  setLocalTitle(task.title);
                }
              }}
              rows={2}
              className="w-full bg-transparent text-[var(--on-surface)] border-0 border-b border-[var(--primary)] rounded-none px-1 py-1 text-xs font-semibold font-sans focus:outline-none resize-none leading-relaxed"
            />
          ) : (
            <div
              id="div-task-title-display"
              onDoubleClick={() => setIsEditingTitle(true)}
              onClick={() => setIsEditingTitle(true)}
              title={i18n._(msg`Clic o doble clic para editar`)}
              className="group/title px-1.5 py-1 rounded hover:bg-[var(--surface-container-high)]/50 border border-transparent hover:border-[var(--outline)] cursor-text transition-colors flex items-start justify-between gap-2"
            >
              <p
                className={`text-xs font-semibold leading-relaxed ${
                  task.completed ? 'text-[var(--on-surface-variant)] line-through' : 'text-[var(--on-surface)]'
                }`}
              >
                {task.title}
              </p>
              <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)] opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0 mt-0.5">
                edit
              </span>
            </div>
          )}
        </div>

        {/* 3. Section / Group Selection */}
        {allSections.length > 0 && (
          <div id="div-taskdetailspanel-20" className="flex flex-col gap-1">
            <label className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Sección`)}
            </label>
            <select
              value={task.groupTitle || allSections[0]}
              onChange={(e) => {
                onUpdateTask(task.taskId, { groupTitle: e.target.value });
              }}
              className="w-full select-integrated font-sans text-xs cursor-pointer"
            >
              {allSections.map((sec) => (
                <option key={sec} value={sec}>
                  ## {sec}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 4. Status Grid */}
        <div id="div-taskdetailspanel-21" className="flex flex-col gap-1.5">
          <label className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
            {i18n._(msg`Estado`)}
          </label>
          <div id="div-taskdetailspanel-22" className="grid grid-cols-3 gap-1">
            {statusOptions.map((st) => {
              const isCurrent = currentStatusId === st.id;
              return (
                <button
                  id={`btn-task-status-${st.id}`}
                  key={st.id}
                  type="button"
                  onClick={() => {
                    const isDone = st.id === 'done';
                    onUpdateTask(task.taskId, {
                      status: st.id,
                      completed: isDone,
                    });
                  }}
                  className={`py-1 px-1.5 rounded border text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] font-semibold'
                      : 'bg-[var(--surface)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:border-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[13px] ${
                      isCurrent ? 'text-[var(--on-primary)]' : st.color
                    }`}
                  >
                    {st.icon}
                  </span>
                  <span className="truncate">{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Priority Selector */}
        <div id="div-taskdetailspanel-23" className="flex flex-col gap-1.5">
          <label className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
            {i18n._(msg`Prioridad`)}
          </label>
          <div id="div-taskdetailspanel-24" className="grid grid-cols-4 gap-1">
            {priorityOptions.map((p) => {
              const isSelected = task.priority === p.id;
              return (
                <button
                  id={`btn-task-priority-${p.id}`}
                  key={p.id}
                  type="button"
                  onClick={() => onUpdateTask(task.taskId, { priority: p.id })}
                  className={`py-1 rounded border text-xs font-mono font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    isSelected
                      ? `${p.text} ${p.bg} ${p.border} ring-1 ring-current font-semibold`
                      : 'bg-[var(--surface)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:border-[var(--on-surface-variant)]'
                  }`}
                  title={`${p.label} - ${p.desc}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  <span>{p.id}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 6. Tags Section */}
        <div id="div-taskdetailspanel-25" className="flex flex-col gap-1.5">
          <div id="div-taskdetailspanel-26" className="flex items-center justify-between">
            <label className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Etiquetas`)}
            </label>
            {!isAddingTag && (
              <button
                id="btn-task-add-tag-trigger"
                type="button"
                onClick={() => setIsAddingTag(true)}
                className="text-[11px] text-[var(--primary)] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>+ {i18n._(msg`Añadir`)}</span>
              </button>
            )}
          </div>

          <div id="div-taskdetailspanel-27" className="flex flex-wrap gap-1 min-h-[24px] items-center">
            {task.tags && task.tags.length > 0 ? (
              task.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface)] font-mono flex items-center gap-1"
                >
                  <span>#{tag}</span>
                  <button
                    id={`btn-task-remove-tag-${tag}`}
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer leading-none"
                    title={i18n._(msg`Eliminar etiqueta`)}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="text-[11px] text-[var(--on-surface-variant)] italic">
                {i18n._(msg`Sin etiquetas asignadas`)}
              </span>
            )}
          </div>

          {/* New Tag Input */}
          {isAddingTag && (
            <div id="div-taskdetailspanel-28" className="flex items-center gap-1 mt-1">
              <input
                type="text"
                autoFocus
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag(newTagInput);
                  } else if (e.key === 'Escape') {
                    setIsAddingTag(false);
                    setNewTagInput('');
                  }
                }}
                placeholder={i18n._(msg`Nombre de etiqueta...`)}
                className="flex-1 bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--primary)] rounded px-2 py-0.5 text-xs font-mono focus:outline-none"
              />
              <button
                id="btn-task-confirm-add-tag"
                type="button"
                onClick={() => handleAddTag(newTagInput)}
                className="btn-m3-primary px-2 py-0.5 text-xs cursor-pointer"
              >
                {i18n._(msg`Añadir`)}
              </button>
              <button
                id="btn-task-cancel-add-tag"
                type="button"
                onClick={() => setIsAddingTag(false)}
                className="btn-m3-icon w-5 h-5 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* 7. Subtasks / Checklist Progress */}
        {task.subtasks && (
          <div id="div-taskdetailspanel-29" className="flex flex-col gap-1 pt-2 border-t border-[var(--outline)]">
            <div id="div-taskdetailspanel-30" className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
                {i18n._(msg`Subtareas`)}
              </span>
              <span className="text-[11px] font-mono text-[var(--on-surface-variant)]">
                {task.subtasks.completed}/{task.subtasks.total} (
                {Math.round((task.subtasks.completed / task.subtasks.total) * 100)}%)
              </span>
            </div>

            <div id="div-taskdetailspanel-31" className="w-full h-1 bg-[var(--surface-container-highest)] rounded overflow-hidden">
              <div
                id="div-task-subtasks-progress-bar"
                className="h-full bg-[var(--primary)] transition-all duration-200"
                style={{
                  width: `${(task.subtasks.completed / task.subtasks.total) * 100}%`,
                }}
              />
            </div>

            {task.subtasks.items && task.subtasks.items.length > 0 && (
              <div className="border-l-2 border-[var(--outline)] pl-2 space-y-1 mt-1.5">
                {task.subtasks.items.map((sub, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('antask:toggle-subtask', {
                            detail: {
                              taskId: task.taskId,
                              subtaskIndex: idx,
                              completed: !sub.completed,
                              taskTitle: task.title,
                            },
                          })
                        );
                      }}
                      className="mt-0.5 flex-shrink-0 flex items-center justify-center cursor-pointer focus:outline-none"
                    >
                      <span
                        className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${
                          sub.completed
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)]'
                            : 'bg-[var(--surface-container-high)] border-[var(--outline)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {sub.completed && (
                          <svg className="w-2 h-2 stroke-current stroke-[3]" fill="none" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </button>
                    <span
                      className={`flex-1 ${
                        sub.completed
                          ? 'text-[var(--on-surface-variant)] line-through opacity-75'
                          : 'text-[var(--on-surface)]'
                      }`}
                    >
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 8. Dependencies & Blockers Section */}
        <div id="div-taskdetailspanel-32" className="flex flex-col gap-2 pt-2 border-t border-[var(--outline)] text-xs">
          <div id="div-taskdetailspanel-33" className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider flex items-center gap-1">
              <span>{i18n._(msg`Dependencias`)}</span>
            </span>
            <span className="text-[10px] font-mono text-[var(--on-surface-variant)]">
              {plural(blockerIds.length, { one: '# bloqueo', other: '# bloqueos' })}
            </span>
          </div>

          {/* Blocked by (Depende de) */}
          <div id="div-taskdetailspanel-34" className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--on-surface-variant)] font-medium">
              {i18n._(msg`Depende de:`)}
            </span>

            {blockerIds.length > 0 ? (
              <div id="div-taskdetailspanel-35" className="flex flex-col gap-1">
                {blockerIds.map((bId) => {
                  const blockerTask = allTasks.find(
                    (t) => t.taskId.toLowerCase() === bId.toLowerCase()
                  );
                  return (
                    <div
                      id={`div-task-blocker-item-${bId}`}
                      key={bId}
                      className="flex items-center justify-between px-2 py-1 rounded bg-[var(--surface)] border border-[var(--outline)] text-xs"
                    >
                      <button
                        id={`btn-task-inspect-blocker-${bId}`}
                        type="button"
                        onClick={() => onSelectTask(bId)}
                        className="flex items-center gap-1.5 text-left text-[var(--on-surface)] hover:text-[var(--primary)] truncate flex-1 cursor-pointer"
                        title={i18n._(msg`Clic para inspeccionar tarea bloqueadora`)}
                      >
                        <span className="font-mono text-[11px] text-[var(--primary)] shrink-0">
                          #{bId}
                        </span>
                        <span className="truncate text-[11px]">
                          {blockerTask ? blockerTask.title : i18n._(msg`(ID no resuelto)`)}
                        </span>
                      </button>

                      <button
                        id={`btn-task-remove-blocker-${bId}`}
                        type="button"
                        onClick={() => handleRemoveBlocker(bId)}
                        className="text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer p-0.5 ml-1 shrink-0"
                        title={i18n._(msg`Eliminar dependencia`)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-[11px] text-[var(--on-surface-variant)] italic">
                {i18n._(msg`Sin dependencias previas`)}
              </span>
            )}

            {/* Quick Add Blocker Dropdown */}
            <div id="div-taskdetailspanel-36" className="mt-0.5">
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddBlocker(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="w-full bg-[var(--surface)] text-[var(--on-surface)] border border-[var(--outline)] rounded px-2 py-1 text-[11px] font-sans focus:outline-none focus:border-[var(--primary)] cursor-pointer"
              >
                <option value="" disabled>
                  + {i18n._(msg`Vincular tarea bloqueadora...`)}
                </option>
                {allTasks
                  .filter((t) => t.taskId.toLowerCase() !== task.taskId.toLowerCase() && !blockerIds.includes(t.taskId))
                  .map((t) => (
                    <option key={t.taskId} value={t.taskId}>
                      #{t.taskId} - {t.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Reverse dependencies */}
          {blockingTasks.length > 0 && (
            <div id="div-taskdetailspanel-37" className="flex flex-col gap-1 pt-1.5 border-t border-[var(--outline)]">
              <span className="text-[10px] text-amber-400 font-mono font-medium flex items-center gap-1">
                <span>⚠ {i18n._(msg`Bloquea a ${blockingTasks.length} tareas:`)}</span>
              </span>
              <div id="div-taskdetailspanel-38" className="flex flex-col gap-1">
                {blockingTasks.map((bTask) => (
                  <div
                    id={`div-task-blocking-item-${bTask.taskId}`}
                    key={bTask.taskId}
                    className="flex items-center justify-between px-2 py-1 rounded bg-[var(--surface)] border border-[var(--outline)] text-xs"
                  >
                    <button
                      id={`btn-task-inspect-blocked-${bTask.taskId}`}
                      type="button"
                      onClick={() => onSelectTask(bTask.taskId)}
                      className="flex items-center gap-1.5 text-left text-[var(--on-surface)] hover:text-[var(--primary)] truncate flex-1 cursor-pointer"
                      title={i18n._(msg`Clic para inspeccionar tarea bloqueada`)}
                    >
                      <span className="font-mono text-[11px] text-amber-400 shrink-0">
                        #{bTask.taskId}
                      </span>
                      <span className="truncate text-[11px]">
                        {bTask.title}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div id="div-taskdetailspanel-39" className="pt-3 border-t border-[var(--outline)] flex items-center justify-between gap-2 mt-4">
        {onFocusOnCanvas && (
          <button
            id="btn-task-footer-focus-canvas"
            type="button"
            onClick={() => onFocusOnCanvas(task.taskId, task.title)}
            className="btn-m3-secondary flex-1 py-1.5 text-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">center_focus_strong</span>
            <span>{i18n._(msg`Enfocar en Canvas`)}</span>
          </button>
        )}

        <button
          id="btn-task-footer-delete"
          type="button"
          onClick={() => onDeleteTask(task.taskId, task.title)}
          className="btn-m3-icon w-8 h-8 text-[var(--error)] hover:bg-rose-950/40 cursor-pointer"
          title={i18n._(msg`Eliminar tarea`)}
          aria-label={i18n._(msg`Eliminar tarea`)}
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </div>
    </aside>
    </>
  );
};
