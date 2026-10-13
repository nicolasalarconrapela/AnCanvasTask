import { parseTasksMarkdown, type ParsedGroup, type ParsedMarkdownTask, type SubtaskItem } from '../utils/taskMarkdown';
export { parseTasksMarkdown, type ParsedGroup, type ParsedMarkdownTask, type SubtaskItem } from '../utils/taskMarkdown';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { i18n, formatTaskCount } from '../i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BaseBoxShapeUtil,
  createShapeId,
  Editor,
  HandleSnapGeometry,
  HTMLContainer,
  NoteShapeUtil,
  RecordProps,
  Rectangle2d,
  resizeBox,
  ShapeUtil,
  T,
  TLBaseShape,
  TLNoteShape,
  TLShapePartial,
} from 'tldraw';
import { CanvasVisualDocument } from '../services/sanityService';
import { scanNotesFromMarkdown, scanTaskBlocks, validateMarkdownDocument } from '../utils/markdownSync';
import {
  useGlobalSearchQuery,
  HighlightText,
  checkTaskMatchesQuery,
} from '../utils/searchHighlight';

export const NOTE_COLOR_OPTIONS = [
  { id: 'yellow', name: 'Amarillo', tldrawColor: 'yellow', bgClass: 'bg-[#fef08a] dark:bg-[#713f12]', borderClass: 'border-[#ca8a04]' },
  { id: 'green', name: 'Verde', tldrawColor: 'green', bgClass: 'bg-[#bbf7d0] dark:bg-[#14532d]', borderClass: 'border-[#16a34a]' },
  { id: 'blue', name: 'Azul', tldrawColor: 'blue', bgClass: 'bg-[#bfdbfe] dark:bg-[#1e3a8a]', borderClass: 'border-[#2563eb]' },
  { id: 'violet', name: 'Violeta', tldrawColor: 'violet', bgClass: 'bg-[#e9d5ff] dark:bg-[#581c87]', borderClass: 'border-[#9333ea]' },
  { id: 'orange', name: 'Naranja', tldrawColor: 'orange', bgClass: 'bg-[#fed7aa] dark:bg-[#7c2d12]', borderClass: 'border-[#ea580c]' },
  { id: 'red', name: 'Rojo', tldrawColor: 'red', bgClass: 'bg-[#fecaca] dark:bg-[#7f1d1d]', borderClass: 'border-[#dc2626]' },
  { id: 'grey', name: 'Gris', tldrawColor: 'grey', bgClass: 'bg-[#e5e7eb] dark:bg-[#374151]', borderClass: 'border-[#6b7280]' },
  { id: 'black', name: 'Oscuro', tldrawColor: 'black', bgClass: 'bg-[#18181b] dark:bg-[#09090b]', borderClass: 'border-[#52525b]' },
];

/**
 * Enhanced NoteShapeUtil that enables interactive corner scaling and resize handles for sticky notes.
 */
export class CustomNoteShapeUtil extends NoteShapeUtil {
  static override type = 'note' as const;
  override options: any = {
    resizeMode: 'scale' as const,
  };

  override hideResizeHandles(_shape: TLNoteShape): boolean {
    return false;
  }

  override getDefaultProps(): TLNoteShape['props'] {
    return {
      ...super.getDefaultProps(),
      color: 'yellow',
      size: 'm',
    };
  }
}

import {
  ActiveConnectionSource,
  ConnectionPointAnchor,
  connectTasksWithArrow,
  getActiveConnectionSource,
  setActiveConnectionSource,
  subscribeToConnectionSource,
} from '../utils/taskConnectionManager';
import {
  useGlobalTaskFilters,
  getGlobalTaskFilters,
  hasActiveFilters,
  isTaskMatchingFilters,
} from '../utils/filterStore';
import { getGlobalSearchQuery } from '../utils/searchHighlight';
import { TaskFilterState } from '../components/FilterBar';

export function isShapeFilteredOut(
  shape: ITaskShape,
  filters?: TaskFilterState,
  query?: string
): boolean {
  const globalFilters = filters || getGlobalTaskFilters();
  const searchQuery = query !== undefined ? query : getGlobalSearchQuery();
  if (!hasActiveFilters(globalFilters, searchQuery)) return false;

  const p = shape.props;
  const normalizedStatus = p.completed ? 'done' : p.status || 'todo';
  const matches = isTaskMatchingFilters(
    {
      title: p.title,
      taskId: p.taskId,
      completed: p.completed,
      priority: p.priority,
      status: normalizedStatus,
      groupTitle: p.groupTitle,
      tags: p.tags,
      blockedBy: p.blockedBy,
    },
    globalFilters,
    searchQuery
  );
  return !matches;
}

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';

export type TaskShapeProps = {
  w: number;
  h: number;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  taskId?: string;
  status?: TaskStatus;
  groupTitle?: string;
  groupHeadingId?: string;
  branchTitle?: string;
  tags?: string[];
  subtasks?: { total: number; completed: number; items?: SubtaskItem[] };
  blockedBy?: string;
  isDuplicateId?: boolean;
  hasMissingId?: boolean;
  unresolvedBlockers?: string[];
};

export type ITaskShape = TLBaseShape<'task', TaskShapeProps>;

function TaskCardComponent({
  shape,
  editor,
}: {
  shape: ITaskShape;
  editor: Editor;
}) {
  const { _ } = useLingui();
  const {
    title,
    completed,
    priority,
    taskId,
    status,
    tags,
    subtasks,
    blockedBy,
    isDuplicateId,
    hasMissingId,
    unresolvedBlockers,
    w,
    h,
  } = shape.props;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = () => setIsMenuOpen(false);
    const handlePointerDown = (e: PointerEvent) => {
      const dropdown = document.getElementById(`task-card-menu-dropdown-${shape.id}`);
      if (
        dropdown &&
        !dropdown.contains(e.target as Node) &&
        !menuButtonRef.current?.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
    };
  }, [isMenuOpen, shape.id]);
  const [isSelected, setIsSelected] = useState(false);
  const [isSubtasksOpen, setIsSubtasksOpen] = useState(true);

  const handleToggleSubtask = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!subtasks?.items) return;
    const currentSub = subtasks.items[index];
    const nextCompleted = !currentSub.completed;

    const nextItems = subtasks.items.map((sub, i) =>
      i === index ? { ...sub, completed: nextCompleted } : sub
    );
    const nextCompletedCount = nextItems.filter((s) => s.completed).length;

    editor.updateShape({
      id: shape.id,
      type: 'task',
      props: {
        subtasks: {
          ...subtasks,
          completed: nextCompletedCount,
          items: nextItems,
        },
      },
    } as any);

    window.dispatchEvent(
      new CustomEvent('antask:toggle-subtask', {
        detail: {
          taskId: shape.props?.taskId || taskId,
          subtaskIndex: index,
          completed: nextCompleted,
          taskTitle: title,
        },
      })
    );
  };

  useEffect(() => {
    setEditedTitle(title);
  }, [title]);

  useEffect(() => {
    let isMounted = true;
    const checkSelection = () => {
      queueMicrotask(() => {
        if (!isMounted) return;
        try {
          const selected = editor.getSelectedShapeIds().includes(shape.id);
          setIsSelected((prev) => (prev !== selected ? selected : prev));
        } catch {
          // ignore
        }
      });
    };
    checkSelection();
    const unsub = editor.store.listen(checkSelection);
    return () => {
      isMounted = false;
      unsub();
    };
  }, [editor, shape.id]);

  const [connectingSource, setConnectingSource] = useState<ActiveConnectionSource | null>(null);

  useEffect(() => {
    setConnectingSource(getActiveConnectionSource());
    return subscribeToConnectionSource((source) => {
      setConnectingSource(source);
    });
  }, []);

  const isConnectingSource = connectingSource?.shapeId === shape.id;
  const isAnyConnecting = Boolean(connectingSource);

  const handleConnectionPointClick = (
    e: React.MouseEvent,
    anchor: ConnectionPointAnchor
  ) => {
    e.stopPropagation();
    if (isConnectingSource) {
      setActiveConnectionSource(null);
      return;
    }

    if (connectingSource) {
      connectTasksWithArrow(
        editor,
        connectingSource,
        {
          shapeId: shape.id,
          taskId,
          anchor,
        },
        (blockerId, blockedId) => {
          window.dispatchEvent(
            new CustomEvent('antask:dependency-created', {
              detail: { blockerTaskId: blockerId, blockedTaskId: blockedId },
            })
          );
        }
      );
      setActiveConnectionSource(null);
    } else {
      setActiveConnectionSource({
        shapeId: shape.id,
        taskId: taskId || 'task',
        title,
        anchor,
      });
    }
  };

  const lastClickTimeRef = useRef<number>(0);

  const openDetails = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
      (e.nativeEvent as any)?.stopImmediatePropagation?.();
    }
    try {
      editor.select(shape.id);
    } catch {
      // ignore
    }
    window.dispatchEvent(
      new CustomEvent('antask:open-task-details', {
        detail: {
          shapeId: shape.id,
          taskId: taskId || shape.props?.taskId || shape.id,
        },
      })
    );
  };

  const pointerDownPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!pointerDownPosRef.current) return;
    const dx = e.clientX - pointerDownPosRef.current.x;
    const dy = e.clientY - pointerDownPosRef.current.y;
    pointerDownPosRef.current = null;

    // Detect tap/click without significant mouse drag
    if (Math.hypot(dx, dy) < 8) {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 400) {
        openDetails();
        lastTapTimeRef.current = 0;
      } else {
        lastTapTimeRef.current = now;
      }
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastClickTimeRef.current < 350) {
      openDetails(e);
      lastClickTimeRef.current = 0;
      return;
    }
    lastClickTimeRef.current = now;

    if (isAnyConnecting && !isConnectingSource) {
      e.stopPropagation();
      handleConnectionPointClick(e, { x: 0.5, y: 0.5, positionName: 'center' });
    }
  };

  const toggleCompleted = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    editor.updateShape({
      id: shape.id,
      type: 'task',
      props: {
        completed: !completed,
        status: !completed ? 'done' : 'todo',
      },
    } as any);
  };

  const cyclePriority = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    const priorities: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
    const nextIndex = (priorities.indexOf(priority) + 1) % priorities.length;
    editor.updateShape({
      id: shape.id,
      type: 'task',
      props: {
        priority: priorities[nextIndex],
      },
    } as any);
  };

  const commitTitle = () => {
    setIsEditingTitle(false);
    const cleanTitle = editedTitle.trim();
    if (cleanTitle && cleanTitle !== title) {
      editor.updateShape({
        id: shape.id,
        type: 'task',
        props: {
          title: cleanTitle,
        },
      } as any);
    } else {
      setEditedTitle(title);
    }
  };

  const [isConnectionPointsVisible, setIsConnectionPointsVisible] = useState(false);

  const priorityConfig: Record<TaskPriority, { label: string; dot: string; text: string }> = {
    P0: { label: _(msg`P0 · Crítica`), dot: 'bg-rose-500', text: 'text-rose-400' },
    P1: { label: _(msg`P1 · Alta`), dot: 'bg-amber-500', text: 'text-amber-400' },
    P2: { label: _(msg`P2 · Media`), dot: 'bg-blue-500', text: 'text-blue-400' },
    P3: { label: _(msg`P3 · Baja`), dot: 'bg-zinc-500', text: 'text-zinc-400' },
  };

  const currentPriority = priorityConfig[priority] || priorityConfig.P1;

  const statusConfig: Record<string, { label: string; text: string }> = {
    backlog: { label: _(msg`Backlog`), text: 'text-slate-400' },
    todo: { label: _(msg`Por hacer`), text: 'text-amber-400' },
    in_progress: { label: _(msg`En progreso`), text: 'text-blue-400' },
    review: { label: _(msg`Revisión`), text: 'text-purple-400' },
    done: { label: _(msg`Hecho`), text: 'text-emerald-400' },
    blocked: { label: _(msg`Bloqueado`), text: 'text-rose-400' },
  };

  const normalizedStatus = completed ? 'done' : status || 'todo';
  const currentStatus = statusConfig[normalizedStatus] || statusConfig.todo;

  const searchQuery = useGlobalSearchQuery();
  const globalFilters = useGlobalTaskFilters();
  const isFilterActive = hasActiveFilters(globalFilters, searchQuery);
  const isMatch = isTaskMatchingFilters(
    {
      title,
      taskId,
      completed,
      priority,
      status: normalizedStatus,
      groupTitle: shape.props.groupTitle,
      tags,
      blockedBy,
    },
    globalFilters,
    searchQuery
  );

  const isHidden = isFilterActive && !isMatch;

  useLayoutEffect(() => {
    const container = document.querySelector(`[data-shape-id="${shape.id}"]`) as HTMLElement | null;
    if (container) {
      if (isHidden) {
        container.style.display = 'none';
        container.style.pointerEvents = 'none';
        container.setAttribute('data-task-hidden', 'true');
      } else {
        container.style.display = '';
        container.style.pointerEvents = '';
        container.removeAttribute('data-task-hidden');
      }
    }
  }, [isHidden, shape.id]);

  // If any filter or search is active and this task does NOT match, hide the card completely
  if (isHidden) {
    return (
      <HTMLContainer
        id={shape.id}
        data-task-hidden="true"
        style={{
          width: w,
          height: h,
          pointerEvents: 'none',
          display: 'none',
          visibility: 'hidden',
          opacity: 0,
        }}
      />
    );
  }

  const hasActiveSearch = Boolean(searchQuery.trim());
  const isSearchMatch = hasActiveSearch && isMatch;

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: w,
        height: h,
        pointerEvents: 'all',
      }}
    >
      <div
        id={`task-card-container-${shape.id}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={handleCardClick}
        onDoubleClick={openDetails}
        className={`group/card w-full h-full rounded-md bg-[var(--surface-container)] border transition-all duration-120 select-none flex flex-col justify-between p-2.5 relative ${
          isConnectingSource
            ? 'border-[var(--primary)] ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--surface)] bg-[var(--primary-container)]/20 shadow-sm'
            : isAnyConnecting
            ? 'border-[var(--primary)]/70 hover:border-[var(--primary)] hover:ring-2 hover:ring-[var(--primary)]/60 cursor-pointer shadow-xs'
            : isSelected
            ? 'border-[var(--primary)] ring-2 ring-[var(--primary)] bg-[var(--surface-container-high)] shadow-sm'
            : isDuplicateId
            ? 'border-rose-600/80 bg-rose-950/20'
            : isSearchMatch
            ? 'border-amber-400 ring-2 ring-amber-400/60 bg-amber-500/10 shadow-sm'
            : completed
            ? 'border-[var(--outline)] bg-[var(--surface)] opacity-75'
            : 'border-[var(--outline)] hover:border-[var(--on-surface-variant)]'
        }`}
      >
        {/* Floating Indicator when this task is the active connection source */}
        {isConnectingSource && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-[var(--primary)] text-[var(--on-primary)] text-[9px] font-medium whitespace-nowrap shadow-sm flex items-center gap-1 z-30 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            <span>{_(msg`Punto central activo · Elige tarea a unir`)}</span>
          </div>
        )}

        {/* Central Connection Points (Puntos Centrales para unir tareas) */}
        {/* Top Center Point */}
        <button
          id={`btn-task-connect-top-${shape.id}`}
          type="button"
          onClick={(e) =>
            handleConnectionPointClick(e, { x: 0.5, y: 0, positionName: 'top' })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-3.5 h-3.5 rounded-full border flex items-center justify-center cursor-crosshair transition-all duration-150 ${
            isConnectingSource
              ? 'bg-[var(--primary)] border-white scale-110 shadow-sm ring-2 ring-[var(--primary)]'
              : isAnyConnecting
              ? 'bg-[var(--primary-container)] border-[var(--primary)] ring-2 ring-[var(--primary)]/60 scale-105'
              : `${isConnectionPointsVisible ? 'opacity-100' : 'opacity-0'} bg-[var(--surface-container-high)] border-[var(--primary)] hover:scale-110 hover:bg-[var(--primary)]`
          }`}
          title={_(msg`Punto central superior: Clic para unir tareas`)}
          aria-label={_(msg`Punto central superior`)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] group-hover/card:bg-white" />
        </button>

        {/* Bottom Center Point */}
        <button
          id={`btn-task-connect-bottom-${shape.id}`}
          type="button"
          onClick={(e) =>
            handleConnectionPointClick(e, { x: 0.5, y: 1, positionName: 'bottom' })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-20 w-3.5 h-3.5 rounded-full border flex items-center justify-center cursor-crosshair transition-all duration-150 ${
            isConnectingSource
              ? 'bg-[var(--primary)] border-white scale-110 shadow-sm ring-2 ring-[var(--primary)]'
              : isAnyConnecting
              ? 'bg-[var(--primary-container)] border-[var(--primary)] ring-2 ring-[var(--primary)]/60 scale-105'
              : `${isConnectionPointsVisible ? 'opacity-100' : 'opacity-0'} bg-[var(--surface-container-high)] border-[var(--primary)] hover:scale-110 hover:bg-[var(--primary)]`
          }`}
          title={_(msg`Punto central inferior: Clic para unir tareas`)}
          aria-label={_(msg`Punto central inferior`)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] group-hover/card:bg-white" />
        </button>

        {/* Left Center Point */}
        <button
          id={`btn-task-connect-left-${shape.id}`}
          type="button"
          onClick={(e) =>
            handleConnectionPointClick(e, { x: 0, y: 0.5, positionName: 'left' })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 z-20 w-3.5 h-3.5 rounded-full border flex items-center justify-center cursor-crosshair transition-all duration-150 ${
            isConnectingSource
              ? 'bg-[var(--primary)] border-white scale-110 shadow-sm ring-2 ring-[var(--primary)]'
              : isAnyConnecting
              ? 'bg-[var(--primary-container)] border-[var(--primary)] ring-2 ring-[var(--primary)]/60 scale-105'
              : `${isConnectionPointsVisible ? 'opacity-100' : 'opacity-0'} bg-[var(--surface-container-high)] border-[var(--primary)] hover:scale-110 hover:bg-[var(--primary)]`
          }`}
          title={_(msg`Punto central izquierdo: Clic para unir tareas`)}
          aria-label={_(msg`Punto central izquierdo`)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] group-hover/card:bg-white" />
        </button>

        {/* Right Center Point */}
        <button
          id={`btn-task-connect-right-${shape.id}`}
          type="button"
          onClick={(e) =>
            handleConnectionPointClick(e, { x: 1, y: 0.5, positionName: 'right' })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 z-20 w-3.5 h-3.5 rounded-full border flex items-center justify-center cursor-crosshair transition-all duration-150 ${
            isConnectingSource
              ? 'bg-[var(--primary)] border-white scale-110 shadow-sm ring-2 ring-[var(--primary)]'
              : isAnyConnecting
              ? 'bg-[var(--primary-container)] border-[var(--primary)] ring-2 ring-[var(--primary)]/60 scale-105'
              : `${isConnectionPointsVisible ? 'opacity-100' : 'opacity-0'} bg-[var(--surface-container-high)] border-[var(--primary)] hover:scale-110 hover:bg-[var(--primary)]`
          }`}
          title={_(msg`Punto central derecho: Clic para unir tareas`)}
          aria-label={_(msg`Punto central derecho`)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] group-hover/card:bg-white" />
        </button>
        {/* Top Row: Checkbox + Title / Inline Edit + Context Menu + Priority */}
        <div id={`task-card-header-${shape.id}`} className="flex items-start justify-between gap-2">
          <div id={`task-card-title-group-${shape.id}`} className="flex items-start gap-2 flex-1 min-w-0">
            {/* Checkbox */}
            <button
              id={`btn-task-card-toggle-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleCompleted}
              aria-label={completed ? _(msg`Marcar tarea como pendiente`) : _(msg`Marcar tarea como completada`)}
              className="mt-0.5 flex-shrink-0 flex items-center justify-center cursor-pointer focus:outline-none"
            >
              <span
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                  completed
                    ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)]'
                    : 'bg-[var(--surface-container-high)] border-[var(--outline)] hover:border-[var(--primary)]'
                }`}
              >
                {completed && (
                  <svg
                    className="w-2.5 h-2.5 stroke-current stroke-[3]"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
            </button>

            {isEditingTitle ? (
              <input
                type="text"
                autoFocus
                value={editedTitle}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    commitTitle();
                  } else if (e.key === 'Escape') {
                    setIsEditingTitle(false);
                    setEditedTitle(title);
                  }
                }}
                className="w-full text-xs font-medium input-seamless text-[var(--on-surface)] -mt-0.5 leading-snug"
              />
            ) : (
              <div
                id={`task-card-title-view-${shape.id}`}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onDoubleClick={openDetails}
                title={_(msg`Doble clic para ver detalles`)}
                className="group/title flex items-start gap-1 flex-1 cursor-pointer min-w-0"
              >
                <span
                  className={`text-xs font-medium leading-snug transition-colors line-clamp-2 ${
                    completed ? 'text-[var(--on-surface-variant)] line-through' : 'text-[var(--on-surface)]'
                  }`}
                >
                  <HighlightText text={title} query={searchQuery} />
                </span>
                <button
                  id={`btn-task-card-edit-${shape.id}`}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingTitle(true);
                  }}
                  className="opacity-0 group-hover/title:opacity-100 transition-opacity text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] p-0.5 shrink-0 cursor-pointer"
                  title={_(msg`Editar título`)}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div id={`task-card-actions-${shape.id}`} className="flex items-center gap-1 shrink-0">
            {/* Discreet Priority Indicator */}
            <button
              id={`btn-task-card-priority-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={cyclePriority}
              title={_(msg`Clic para cambiar prioridad (P0-P3)`)}
              className={`px-1 py-0.5 text-[11px] font-mono font-medium hover:opacity-100 cursor-pointer shrink-0 transition-opacity flex items-center gap-1 ${currentPriority.text}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${currentPriority.dot}`} />
              <span><HighlightText text={priority} query={searchQuery} /></span>
            </button>

            {/* Quick Central Connector Button */}
            <button
              id={`btn-task-card-connect-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) =>
                handleConnectionPointClick(e, { x: 0.5, y: 0.5, positionName: 'center' })
              }
              title={
                isConnectingSource
                  ? _(msg`Cancelar unión de tareas`)
                  : _(msg`Unir tarea (Punto Central)`)
              }
              aria-label={_(msg`Punto central para unir tareas`)}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${
                isConnectingSource
                  ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--primary)]'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>

            {/* Contextual Action Menu Trigger ⋮ */}
            <button
              ref={menuButtonRef}
              id={`btn-task-card-menu-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  setIsMenuOpen(false);
                } else if (menuButtonRef.current) {
                  const rect = menuButtonRef.current.getBoundingClientRect();
                  const menuWidth = 175;
                  const menuHeight = 220;
                  let top = rect.bottom + 4;
                  if (top + menuHeight > window.innerHeight && rect.top - menuHeight > 0) {
                    top = Math.max(8, rect.top - menuHeight - 4);
                  }
                  let left = rect.right - menuWidth;
                  if (left < 8) left = 8;
                  if (left + menuWidth > window.innerWidth - 8) {
                    left = window.innerWidth - menuWidth - 8;
                  }
                  setMenuCoords({ top, left });
                  setIsMenuOpen(true);
                }
              }}
              className="w-5 h-5 flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] rounded cursor-pointer"
              title={_(msg`Más acciones`)}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Popover Contextual Menu */}
        {isMenuOpen && menuCoords && typeof document !== 'undefined' && createPortal(
          <div
            id={`task-card-menu-dropdown-${shape.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              left: `${menuCoords.left}px`,
              zIndex: 99999,
            }}
            className="bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-xl p-1 flex flex-col gap-0.5 min-w-[170px] text-xs font-sans pointer-events-auto"
          >
            <button
              id={`btn-task-card-menu-toggle-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                toggleCompleted(e);
              }}
              className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer"
            >
              <span>{completed ? _(msg`↺ Marcar pendiente`) : _(msg`✓ Marcar completada`)}</span>
            </button>

            {hasMissingId && (
              <button
                id={`btn-task-card-menu-generate-id-${shape.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(false);
                  window.dispatchEvent(
                    new CustomEvent('antask:assign-task-id', {
                      detail: { taskId: shape.props?.taskId || taskId || title, taskTitle: title },
                    })
                  );
                }}
                className="px-2 py-1 rounded text-left text-amber-300 hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer font-medium"
              >
                <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                <span>{_(msg`Generar ID automático`)}</span>
              </button>
            )}

            <button
              id={`btn-task-card-menu-connect-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                handleConnectionPointClick(e, { x: 0.5, y: 0.5, positionName: 'center' });
              }}
              className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer"
            >
              <span>{_(msg`🔗 Unir tarea (Punto Central)`)}</span>
            </button>

            <button
              id={`btn-task-card-menu-priority-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                cyclePriority(e);
              }}
              className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer"
            >
              <span>{_(msg`⚡ Cambiar prioridad`)}</span>
            </button>

            <button
              id={`btn-task-card-menu-details-${shape.id}`}
              type="button"
              onClick={(e) => {
                setIsMenuOpen(false);
                openDetails(e);
              }}
              className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer"
            >
              <span>{_(msg`🔍 Ver detalles`)}</span>
            </button>

            <div id={`task-card-menu-divider-${shape.id}`} className="h-px bg-[var(--outline)] my-0.5" />

            <button
              id={`btn-task-card-menu-delete-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                window.dispatchEvent(
                  new CustomEvent('antask-request-delete-task', {
                    detail: {
                      shapeId: shape.id,
                      taskId: taskId || '',
                      title,
                    },
                  })
                );
              }}
              className="px-2 py-1 rounded text-left text-[var(--error)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer"
            >
              <span>{_(msg`🗑 Eliminar`)}</span>
            </button>
          </div>,
          document.body
        )}

        {/* Subtasks Section (Option A: Checklist Integrado Compacto) */}
        {subtasks && subtasks.items && subtasks.items.length > 0 && (
          <div id={`task-card-subtasks-${shape.id}`} className="my-1 text-xs">
            {/* Collapsible toggle header */}
            <button
              id={`btn-task-card-toggle-subtasks-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsSubtasksOpen((prev) => !prev);
              }}
              className="flex items-center gap-1 text-[10px] font-mono font-medium text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] transition-colors py-0.5 cursor-pointer focus:outline-none"
              title={isSubtasksOpen ? _(msg`Ocultar subtareas`) : _(msg`Mostrar subtareas`)}
            >
              <span className="text-[9px] select-none">{isSubtasksOpen ? '▾' : '▸'}</span>
              <span>{_(msg`Subtareas`)}</span>
              <span className="opacity-75">({subtasks.completed}/{subtasks.total})</span>
            </button>

            {/* Subtask list */}
            {isSubtasksOpen && (
              <div className="border-l-2 border-[var(--outline)] pl-2 space-y-1 mt-1 mb-1">
                {subtasks.items.map((sub, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-1.5 text-[11px] leading-tight group/subtask"
                  >
                    <button
                      id={`btn-task-card-subtask-${shape.id}-${idx}`}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => handleToggleSubtask(idx, e)}
                      aria-label={
                        sub.completed
                          ? _(msg`Marcar subtarea como pendiente`)
                          : _(msg`Marcar subtarea como completada`)
                      }
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
                          <svg
                            className="w-2 h-2 stroke-current stroke-[3]"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </button>
                    <span
                      className={`flex-1 transition-colors select-none ${
                        sub.completed
                          ? 'text-[var(--on-surface-variant)] line-through opacity-75'
                          : 'text-[var(--on-surface)]'
                      }`}
                    >
                      <HighlightText text={sub.title} query={searchQuery} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Middle Row: Unboxed Tags & Subtask progress summary if collapsed or no items */}
        {(tags?.length || (subtasks && (!subtasks.items?.length || !isSubtasksOpen))) && (
          <div id={`task-card-tags-${shape.id}`} className="flex items-center gap-1.5 flex-wrap py-0.5 text-[10px] text-[var(--on-surface-variant)]">
            {tags?.slice(0, 3).map((t) => (
              <span key={t} className="font-mono text-[var(--on-surface-variant)]">
                #<HighlightText text={t} query={searchQuery} />
              </span>
            ))}
            {tags && tags.length > 3 && (
              <span className="font-mono text-[var(--on-surface-variant)]">
                +{tags.length - 3}
              </span>
            )}
            {subtasks && (!subtasks.items?.length || !isSubtasksOpen) && (
              <span className="font-mono text-[var(--on-surface-variant)] flex items-center gap-0.5">
                <span>✓</span>
                <span>{subtasks.completed}/{subtasks.total}</span>
              </span>
            )}
          </div>
        )}

        {/* Bottom Row: Metadata & Status */}
        <div id={`task-card-footer-${shape.id}`} className="flex items-center justify-between text-xs text-[var(--on-surface-variant)] pt-1.5 border-t border-[var(--outline)] mt-0.5">
          <div id={`task-card-footer-meta-${shape.id}`} className="flex items-center gap-1.5 truncate max-w-[200px]">
            {taskId && !hasMissingId ? (
              <span className="text-[var(--on-surface-variant)] font-mono text-[11px] truncate tracking-tight" title={`ID: ${taskId}`}>
                #<HighlightText text={taskId} query={searchQuery} />
              </span>
            ) : (
              <button
                id={`btn-task-card-generate-id-${shape.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent('antask:assign-task-id', {
                      detail: { taskId: shape.props?.taskId || taskId || title, taskTitle: title },
                    })
                  );
                }}
                className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono text-[10px] font-medium transition-colors cursor-pointer"
                title={_(msg`Tarea sin ID explícito. Clic para generar ID automático en Markdown.`)}
              >
                <span>+ ID</span>
                <span className="material-symbols-outlined text-[10px]">auto_fix_high</span>
              </button>
            )}

            {isDuplicateId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent('antask:resolve-single-duplicate-id', {
                      detail: { taskId: shape.props?.taskId || taskId, taskTitle: title },
                    })
                  );
                }}
                className="flex items-center gap-0.5 text-rose-400 hover:text-rose-300 font-mono text-[10px] font-semibold transition-colors cursor-pointer px-1 py-0.2 rounded bg-rose-950/80 border border-rose-800/80"
                title={_(msg`ID duplicado en TASKS.md. Clic para resolver y asignar nuevo ID único.`)}
              >
                <span>dup</span>
                <span className="material-symbols-outlined text-[9px]">auto_fix_high</span>
              </button>
            )}

            {unresolvedBlockers && unresolvedBlockers.length > 0 && (
              <span
                className="text-[10px] font-semibold text-amber-400 font-mono"
                title={_(msg`Dependencia no resuelta: #${unresolvedBlockers.join(', #')}`)}
              >
                dep?
              </span>
            )}

            {blockedBy && !completed && !unresolvedBlockers?.length && (
              <span
                className="text-[10px] font-mono text-amber-400 flex items-center gap-0.5"
                title={_(msg`Bloqueada por #${blockedBy}`)}
              >
                <span>🔒</span>
                <span>#{blockedBy}</span>
              </span>
            )}
          </div>

          <div id={`task-card-footer-status-${shape.id}`} className="flex items-center gap-1 shrink-0">
            <span className={`text-[10px] font-mono uppercase tracking-wider ${currentStatus.text}`}>
              {currentStatus.label}
            </span>
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

export class TaskShapeUtil extends ShapeUtil<any> {
  static override type = 'task' as const;

  static override props: RecordProps<any> = {
    w: T.number,
    h: T.number,
    title: T.string,
    completed: T.boolean,
    priority: T.string,
    taskId: T.string.optional(),
    status: T.string.optional(),
    groupTitle: T.string.optional(),
    groupHeadingId: T.string.optional(),
    branchTitle: T.string.optional(),
    tags: T.arrayOf(T.string).optional(),
    subtasks: T.object({
      total: T.number,
      completed: T.number,
      items: T.arrayOf(T.object({ title: T.string, completed: T.boolean })).optional(),
    }).optional(),
    blockedBy: T.string.optional(),
    isDuplicateId: T.boolean.optional(),
    hasMissingId: T.boolean.optional(),
    unresolvedBlockers: T.arrayOf(T.string).optional(),
  };

  getDefaultProps(): TaskShapeProps {
    return {
      w: 320,
      h: 110,
      title: 'New developer task',
      completed: false,
      priority: 'P1',
      taskId: 'task',
    };
  }

  private activeSuctionGroupId: string | null = null;

  getGeometry(shape: ITaskShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override hideSelectionBoundsBg(shape: ITaskShape): boolean {
    return true;
  }

  override hideSelectionBoundsFg(shape: ITaskShape): boolean {
    return isShapeFilteredOut(shape);
  }

  override hideRotateHandle = () => true;
  override hideResizeHandles = () => true;

  override onDoubleClick(shape: ITaskShape) {
    const targetId = shape.props?.taskId || (shape.props as any)?.temporaryId || shape.id;
    window.dispatchEvent(
      new CustomEvent('antask:open-task-details', {
        detail: {
          shapeId: shape.id,
          taskId: targetId,
        },
      })
    );
  }

  override canBind(opts?: any) {
    const targetShape = (opts?.toShape || opts?.fromShape) as ITaskShape;
    if (targetShape?.type === 'task' && isShapeFilteredOut(targetShape)) {
      return false;
    }
    return true;
  }

  override canSnap() {
    return true;
  }

  override getHandleSnapGeometry(shape: ITaskShape): HandleSnapGeometry {
    if (isShapeFilteredOut(shape)) {
      return { points: [] };
    }
    const { w, h } = shape.props;
    const geom = this.getGeometry(shape);
    return {
      outline: geom,
      points: [
        { x: w / 2, y: h / 2 }, // Punto central exacto (centro)
        { x: w / 2, y: 0 },     // Punto central superior
        { x: w / 2, y: h },     // Punto central inferior
        { x: 0, y: h / 2 },     // Punto central izquierdo
        { x: w, y: h / 2 },     // Punto central derecho
        ...geom.bounds.corners,
      ],
    };
  }

  getIndicatorPath(shape: ITaskShape) {
    if (isShapeFilteredOut(shape)) {
      return undefined;
    }

    if (typeof Path2D !== 'undefined') {
      const path = new Path2D();
      if (typeof path.roundRect === 'function') {
        path.roundRect(0, 0, shape.props.w, shape.props.h, 5);
      } else {
        path.rect(0, 0, shape.props.w, shape.props.h);
      }
      return path;
    }
    return undefined;
  }

  override onTranslate(initial: any, current: any): any {
    const cardW = current.props?.w || 320;
    const cardH = current.props?.h || 110;
    const cardCenterX = current.x + cardW / 2;
    const cardCenterY = current.y + cardH / 2;

    const allGroupShapes = this.editor
      .getCurrentPageShapes()
      .filter((s) => (s as any).type === 'task-group') as any[];
    const groupShapes = allGroupShapes.filter((g) => {
      return !g.props?.isContainer && g.props?.level !== 1;
    });

    let capturedGroup: any = null;
    const MAGNETIC_MARGIN = 50;

    for (const g of groupShapes) {
      const gW = g.props?.w || 360;
      const gH = g.props?.h || 240;
      const inZone =
        cardCenterX >= g.x - MAGNETIC_MARGIN &&
        cardCenterX <= g.x + gW + MAGNETIC_MARGIN &&
        cardCenterY >= g.y - MAGNETIC_MARGIN &&
        cardCenterY <= g.y + gH + MAGNETIC_MARGIN;

      if (inZone) {
        capturedGroup = g;
        break;
      }
    }

    const capturedId = capturedGroup ? capturedGroup.id : null;
    if (this.activeSuctionGroupId !== capturedId) {
      if (this.activeSuctionGroupId) {
        const prevEl = document.getElementById(`task-group-container-${this.activeSuctionGroupId}`);
        if (prevEl) prevEl.removeAttribute('data-suction-active');
      }
      if (capturedId) {
        const nextEl = document.getElementById(`task-group-container-${capturedId}`);
        if (nextEl) nextEl.setAttribute('data-suction-active', 'true');
      }
      this.activeSuctionGroupId = capturedId;
    }
  }

  override onTranslateEnd(initial: any, current: any): any {
    if (this.activeSuctionGroupId) {
      const el = document.getElementById(`task-group-container-${this.activeSuctionGroupId}`);
      if (el) el.removeAttribute('data-suction-active');
      this.activeSuctionGroupId = null;
    }

    const allGroupShapes = this.editor
      .getCurrentPageShapes()
      .filter((s) => (s as any).type === 'task-group') as any[];
    const groupShapes = allGroupShapes.filter((g) => {
      return !g.props?.isContainer && g.props?.level !== 1;
    });

    const cardW = current.props?.w || 320;
    const cardH = current.props?.h || 110;
    const cardCenterX = current.x + cardW / 2;
    const cardCenterY = current.y + cardH / 2;

    let targetGroup: any = null;
    const MAGNETIC_MARGIN = 50;

    for (const g of groupShapes) {
      const gW = g.props?.w || 360;
      const gH = g.props?.h || 240;
      const inZone =
        cardCenterX >= g.x - MAGNETIC_MARGIN &&
        cardCenterX <= g.x + gW + MAGNETIC_MARGIN &&
        cardCenterY >= g.y - MAGNETIC_MARGIN &&
        cardCenterY <= g.y + gH + MAGNETIC_MARGIN;

      if (inZone) {
        targetGroup = g;
        break;
      }
    }

    const taskId = current.props?.taskId || current.props?.title;

    if (targetGroup) {
      // Ventosa snap: align directly into section column
      const targetGroupTitle = targetGroup.props.title;
      const snappedX = targetGroup.x + 20;

      // Find other tasks in target group
      const otherTasks = (this.editor
        .getCurrentPageShapes()
        .filter(
          (s) =>
            (s as any).type === 'task' &&
            s.id !== current.id &&
            ((s as any).props?.groupTitle || '').trim().toLowerCase() === targetGroupTitle.trim().toLowerCase()
        ) as any[]).sort((a, b) => a.y - b.y);

      let snappedY = targetGroup.y + 72;
      if (otherTasks.length > 0) {
        const lastTask = otherTasks[otherTasks.length - 1];
        if (current.y >= lastTask.y) {
          snappedY = lastTask.y + (lastTask.props?.h || 110) + 16;
        } else {
          let insertIdx = 0;
          for (let i = 0; i < otherTasks.length; i++) {
            if (current.y > otherTasks[i].y + (otherTasks[i].props?.h || 110) / 2) {
              insertIdx = i + 1;
            }
          }
          if (insertIdx === 0) {
            snappedY = targetGroup.y + 72;
          } else {
            const prev = otherTasks[insertIdx - 1];
            snappedY = prev.y + (prev.props?.h || 110) + 16;
          }

          // Shift subsequent tasks down to make room and prevent overlap
          const shiftUpdates: any[] = [];
          for (let i = insertIdx; i < otherTasks.length; i++) {
            const shiftTask = otherTasks[i];
            shiftUpdates.push({
              id: shiftTask.id,
              type: 'task',
              y: shiftTask.y + cardH + 16,
            });
          }
          if (shiftUpdates.length > 0) {
            (this.editor.updateShapes as any)(shiftUpdates);
          }
        }
      }

      // Check if group height needs expanding to fully contain the snapped card
      const neededHeight = (snappedY - targetGroup.y) + cardH + 24;
      if (neededHeight > (targetGroup.props?.h || 240)) {
        (this.editor.updateShape as any)({
          id: targetGroup.id,
          type: 'task-group',
          props: {
            ...targetGroup.props,
            h: Math.ceil(neededHeight),
          },
        });
      }

      // Dispatch event to update Markdown
      if (taskId) {
        window.dispatchEvent(
          new CustomEvent('antask:task-moved-group', {
            detail: {
              taskId,
              targetGroupTitle,
              targetHeadingId: targetGroup.props?.headingId,
              targetBranchTitle: targetGroup.props?.branchTitle,
            },
          })
        );
      }

      return {
        id: current.id,
        type: 'task' as const,
        x: snappedX,
        y: snappedY,
        props: {
          ...current.props,
          groupTitle: targetGroupTitle,
          groupHeadingId: targetGroup.props?.headingId,
          branchTitle: targetGroup.props?.branchTitle,
        },
      };
    } else {
      // Retain current group association without forcing synthetic Out section
      return {
        id: current.id,
        type: 'task' as const,
        props: {
          ...current.props,
        },
      };
    }
  }

  override onTranslateCancel(initial: any, current: any): void {
    if (this.activeSuctionGroupId) {
      const el = document.getElementById(`task-group-container-${this.activeSuctionGroupId}`);
      if (el) el.removeAttribute('data-suction-active');
      this.activeSuctionGroupId = null;
    }
  }

  component(shape: ITaskShape) {
    return <TaskCardComponent shape={shape} editor={this.editor} />;
  }
}

export function updateAllGroupCounts(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  const groupShapes = shapes.filter((s) => (s as any).type === 'task-group') as any[];
  const taskShapes = shapes.filter((s) => (s as any).type === 'task') as any[];

  const updates: any[] = [];
  for (const g of groupShapes) {
    const gTitle = (g.props?.title || '').trim().toLowerCase();
    const gHeadingId = g.props?.headingId;
    const gBranch = g.props?.branchTitle;

    const childGroups = groupShapes.filter((cg) => {
      if (cg.id === g.id) return false;
      if (gHeadingId && cg.props?.parentId === gHeadingId) return true;
      const ptMatch = (cg.props?.parentTitle || '').trim().toLowerCase() === gTitle;
      if (!ptMatch) return false;
      if (gBranch && cg.props?.branchTitle) {
        return cg.props.branchTitle.toLowerCase() === gBranch.toLowerCase();
      }
      return true;
    });

    let tasksInGroup: any[] = [];
    if (childGroups.length > 0 || g.props?.isContainer || g.props?.level === 1) {
      const descendantHeadingIds = new Set<string>();
      const descendantTitles = new Set<string>([gTitle]);
      if (gHeadingId) descendantHeadingIds.add(gHeadingId);

      const addDescendants = (pHeadingId?: string, pTitleLower?: string) => {
        for (const cg of groupShapes) {
          if (cg.id === g.id) continue;
          const matchById = pHeadingId && cg.props?.parentId === pHeadingId;
          const matchByTitle = pTitleLower && (cg.props?.parentTitle || '').trim().toLowerCase() === pTitleLower &&
            (!gBranch || !cg.props?.branchTitle || cg.props.branchTitle.toLowerCase() === gBranch.toLowerCase());

          if (matchById || matchByTitle) {
            const cgHeadId = cg.props?.headingId;
            const cLower = (cg.props?.title || '').trim().toLowerCase();
            const notYetVisited = (cgHeadId && !descendantHeadingIds.has(cgHeadId)) || (!cgHeadId && !descendantTitles.has(cLower));
            if (notYetVisited) {
              if (cgHeadId) descendantHeadingIds.add(cgHeadId);
              if (cLower) descendantTitles.add(cLower);
              addDescendants(cgHeadId, cLower);
            }
          }
        }
      };
      addDescendants(gHeadingId, gTitle);

      tasksInGroup = taskShapes.filter((t) => {
        if (t.props?.groupHeadingId && descendantHeadingIds.size > 0) {
          return descendantHeadingIds.has(t.props.groupHeadingId);
        }
        const tTitle = (t.props?.groupTitle || '').trim().toLowerCase();
        if (!descendantTitles.has(tTitle)) return false;
        if (gBranch && t.props?.branchTitle) {
          return t.props.branchTitle.toLowerCase() === gBranch.toLowerCase();
        }
        return true;
      });
    } else {
      tasksInGroup = taskShapes.filter((t) => {
        if (gHeadingId && t.props?.groupHeadingId) {
          return t.props.groupHeadingId === gHeadingId;
        }
        const tTitle = (t.props?.groupTitle || '').trim().toLowerCase();
        if (tTitle !== gTitle) return false;
        if (gBranch && t.props?.branchTitle) {
          return t.props.branchTitle.toLowerCase() === gBranch.toLowerCase();
        }
        return true;
      });
    }

    const count = tasksInGroup.length;
    const completedCount = tasksInGroup.filter((t) => t.props?.completed).length;

    if (g.props?.count !== count || g.props?.completedCount !== completedCount) {
      updates.push({
        id: g.id,
        type: 'task-group',
        props: {
          ...g.props,
          count,
          completedCount,
        },
      });
    }
  }

  if (updates.length > 0) {
    editor.updateShapes(updates);
  }
}

export interface SectionColorOption {
  id: string;
  name: string;
  swatchClass: string;
  leafBgClass: string;
  leafBorderClass: string;
  containerBgClass: string;
  containerBorderClass: string;
  headerAccentClass?: string;
  badgeClass?: string;
}

export const SECTION_COLOR_OPTIONS: Record<string, SectionColorOption> = {
  default: {
    id: 'default',
    name: 'Por defecto',
    swatchClass: 'bg-zinc-400 dark:bg-zinc-600',
    leafBgClass: 'bg-[var(--surface-container)]/35',
    leafBorderClass: 'border-[var(--outline)]',
    containerBgClass: 'bg-[var(--surface-container-lowest)]/50',
    containerBorderClass: 'border-[var(--outline-variant)]',
  },
  blue: {
    id: 'blue',
    name: 'Azul',
    swatchClass: 'bg-blue-500',
    leafBgClass: 'bg-blue-500/10 dark:bg-blue-950/30',
    leafBorderClass: 'border-blue-500/35 dark:border-blue-400/35',
    containerBgClass: 'bg-blue-500/8 dark:bg-blue-950/20',
    containerBorderClass: 'border-blue-500/35 dark:border-blue-400/35',
    headerAccentClass: 'text-blue-600 dark:text-blue-400',
    badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30',
  },
  purple: {
    id: 'purple',
    name: 'Púrpura',
    swatchClass: 'bg-purple-500',
    leafBgClass: 'bg-purple-500/10 dark:bg-purple-950/30',
    leafBorderClass: 'border-purple-500/35 dark:border-purple-400/35',
    containerBgClass: 'bg-purple-500/8 dark:bg-purple-950/20',
    containerBorderClass: 'border-purple-500/35 dark:border-purple-400/35',
    headerAccentClass: 'text-purple-600 dark:text-purple-400',
    badgeClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30',
  },
  emerald: {
    id: 'emerald',
    name: 'Esmeralda',
    swatchClass: 'bg-emerald-500',
    leafBgClass: 'bg-emerald-500/10 dark:bg-emerald-950/30',
    leafBorderClass: 'border-emerald-500/35 dark:border-emerald-400/35',
    containerBgClass: 'bg-emerald-500/8 dark:bg-emerald-950/20',
    containerBorderClass: 'border-emerald-500/35 dark:border-emerald-400/35',
    headerAccentClass: 'text-emerald-600 dark:text-emerald-400',
    badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  },
  amber: {
    id: 'amber',
    name: 'Ámbar',
    swatchClass: 'bg-amber-500',
    leafBgClass: 'bg-amber-500/10 dark:bg-amber-950/30',
    leafBorderClass: 'border-amber-500/35 dark:border-amber-400/35',
    containerBgClass: 'bg-amber-500/8 dark:bg-amber-950/20',
    containerBorderClass: 'border-amber-500/35 dark:border-amber-400/35',
    headerAccentClass: 'text-amber-600 dark:text-amber-400',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  },
  rose: {
    id: 'rose',
    name: 'Rosa',
    swatchClass: 'bg-rose-500',
    leafBgClass: 'bg-rose-500/10 dark:bg-rose-950/30',
    leafBorderClass: 'border-rose-500/35 dark:border-rose-400/35',
    containerBgClass: 'bg-rose-500/8 dark:bg-rose-950/20',
    containerBorderClass: 'border-rose-500/35 dark:border-rose-400/35',
    headerAccentClass: 'text-rose-600 dark:text-rose-400',
    badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
  },
  cyan: {
    id: 'cyan',
    name: 'Cian',
    swatchClass: 'bg-cyan-500',
    leafBgClass: 'bg-cyan-500/10 dark:bg-cyan-950/30',
    leafBorderClass: 'border-cyan-500/35 dark:border-cyan-400/35',
    containerBgClass: 'bg-cyan-500/8 dark:bg-cyan-950/20',
    containerBorderClass: 'border-cyan-500/35 dark:border-cyan-400/35',
    headerAccentClass: 'text-cyan-600 dark:text-cyan-400',
    badgeClass: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
  },
  slate: {
    id: 'slate',
    name: 'Pizarra',
    swatchClass: 'bg-slate-500',
    leafBgClass: 'bg-slate-500/10 dark:bg-slate-900/35',
    leafBorderClass: 'border-slate-500/35 dark:border-slate-500/35',
    containerBgClass: 'bg-slate-500/8 dark:bg-slate-900/25',
    containerBorderClass: 'border-slate-500/35 dark:border-slate-400/35',
    headerAccentClass: 'text-slate-600 dark:text-slate-300',
    badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
  },
};

function TaskGroupComponent({ shape, editor }: { shape: ITaskGroupShape; editor?: Editor }) {
  const { title, count, completedCount, w, h, level, color } = shape.props;
  const isContainer = Boolean(shape.props.isContainer || level === 1);
  const headingLevel = Math.max(1, Math.min(6, level || (isContainer ? 1 : 2)));
  const headingPrefix = '#'.repeat(headingLevel);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const groupMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeColorKey = color && SECTION_COLOR_OPTIONS[color] ? color : 'default';
  const colorConfig = SECTION_COLOR_OPTIONS[activeColorKey] || SECTION_COLOR_OPTIONS.default;

  const handleSelectColor = (selectedColor: string) => {
    const finalColor = selectedColor && selectedColor !== 'default' ? selectedColor : undefined;
    if (editor) {
      editor.updateShape({
        id: shape.id,
        type: 'task-group',
        props: {
          ...shape.props,
          color: finalColor,
        },
      } as any);
    }
    window.dispatchEvent(
      new CustomEvent('antask:section-color-changed', {
        detail: {
          groupTitle: title,
          color: finalColor || '',
          headingId: shape.props?.headingId,
          branchTitle: shape.props?.branchTitle,
          shapeId: shape.id,
        },
      })
    );
  };

  const globalFilters = useGlobalTaskFilters();
  const isSectionFilteredOut =
    globalFilters.section !== 'all' &&
    title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase();

  useLayoutEffect(() => {
    const container = document.querySelector(`[data-shape-id="${shape.id}"]`) as HTMLElement | null;
    if (container) {
      if (isSectionFilteredOut) {
        container.style.display = 'none';
        container.style.pointerEvents = 'none';
        container.setAttribute('data-task-hidden', 'true');
      } else {
        container.style.display = '';
        container.style.pointerEvents = '';
        container.removeAttribute('data-task-hidden');
      }
    }
  }, [isSectionFilteredOut, shape.id]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = () => setIsMenuOpen(false);
    const handlePointerDown = (e: MouseEvent) => {
      const dropdown = document.getElementById(`task-group-menu-dropdown-${shape.id}`);
      if (
        dropdown &&
        !dropdown.contains(e.target as Node) &&
        !groupMenuBtnRef.current?.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
    };
  }, [isMenuOpen, shape.id]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 205;
    const menuHeight = 240;
    let top = e.clientY + 2;
    if (top + menuHeight > window.innerHeight && e.clientY - menuHeight > 0) {
      top = Math.max(8, e.clientY - menuHeight - 2);
    }
    let left = e.clientX + 2;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    setMenuCoords({ top, left });
    setIsMenuOpen(true);
  };

  if (isSectionFilteredOut) {
    return (
      <HTMLContainer
        id={shape.id}
        data-task-hidden="true"
        style={{
          width: w,
          height: h,
          pointerEvents: 'none',
          display: 'none',
          visibility: 'hidden',
          opacity: 0,
        }}
      />
    );
  }

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: w,
        height: h,
        pointerEvents: 'none',
      }}
    >
      <div
        id={`task-group-container-${shape.id}`}
        onContextMenu={handleContextMenu}
        style={{
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
        className={
          isContainer
            ? `w-full h-full rounded-xl backdrop-blur-md ${colorConfig.containerBgClass} border-2 border-dashed ${colorConfig.containerBorderClass} p-4 flex flex-col justify-start select-none transition-colors relative`
            : `w-full h-full rounded-md backdrop-blur-md ${colorConfig.leafBgClass} border ${colorConfig.leafBorderClass} p-3 flex flex-col justify-start select-none transition-colors relative`
        }
      >
        {/* Header */}
        <div
          id={`task-group-header-${shape.id}`}
          onContextMenu={handleContextMenu}
          className={
            isContainer
              ? `flex items-center justify-between border-b ${colorConfig.containerBorderClass}/60 pb-2.5 pointer-events-auto cursor-context-menu`
              : `flex items-center justify-between border-b ${colorConfig.leafBorderClass} pb-2 pointer-events-auto cursor-context-menu`
          }
        >
          <div id={`task-group-title-group-${shape.id}`} className="flex items-center gap-1.5">
            <span className={colorConfig.headerAccentClass || (isContainer ? "text-[var(--primary)] font-mono text-sm font-bold" : "text-[var(--on-surface-variant)] font-mono text-xs font-semibold")}>
              {headingPrefix}
            </span>
            <h2 className={isContainer ? "text-sm font-bold text-[var(--on-surface)] font-sans tracking-tight truncate max-w-[280px]" : "text-xs font-semibold text-[var(--on-surface)] font-sans tracking-tight truncate max-w-[180px]"}>
              {title}
            </h2>
            {isContainer ? (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${colorConfig.badgeClass || 'text-[var(--on-surface-variant)] bg-[var(--surface-container-high)] border border-[var(--outline)]'}`}>
                {headingPrefix}
              </span>
            ) : (
              <span className="suction-indicator items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-[var(--primary)] bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
                {i18n._(msg`Ventosa`)}
              </span>
            )}
          </div>

          <div id={`task-group-actions-${shape.id}`} className="flex items-center gap-1.5">
            {count > 0 && (
              <span className={isContainer ? "text-xs font-mono font-medium text-[var(--on-surface-variant)] tabular-nums" : "text-[11px] font-mono text-[var(--on-surface-variant)] tabular-nums"}>
                {completedCount > 0
                  ? i18n._(msg`${completedCount}/${count} completadas`)
                  : formatTaskCount(count)}
              </span>
            )}
            {/* Context menu trigger ⋮ */}
            <button
              ref={groupMenuBtnRef}
              id={`btn-task-group-menu-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  setIsMenuOpen(false);
                } else if (groupMenuBtnRef.current) {
                  const rect = groupMenuBtnRef.current.getBoundingClientRect();
                  const menuWidth = 205;
                  const menuHeight = 240;
                  let top = rect.bottom + 4;
                  if (top + menuHeight > window.innerHeight && rect.top - menuHeight > 0) {
                    top = Math.max(8, rect.top - menuHeight - 4);
                  }
                  let left = rect.right - menuWidth;
                  if (left < 8) left = 8;
                  if (left + menuWidth > window.innerWidth - 8) {
                    left = window.innerWidth - menuWidth - 8;
                  }
                  setMenuCoords({ top, left });
                  setIsMenuOpen(true);
                }
              }}
              className="w-5 h-5 flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] rounded cursor-pointer transition-colors"
              title={isContainer ? i18n._(msg`Opciones de contenedor`) : i18n._(msg`Opciones de sección`)}
            >
              <svg className={isContainer ? "w-3.5 h-3.5" : "w-3 h-3"} fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Popover Contextual Menu */}
        {isMenuOpen && menuCoords && typeof document !== 'undefined' && createPortal(
          <div
            ref={menuRef}
            id={`task-group-menu-dropdown-${shape.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: `${menuCoords.left}px`,
              top: `${menuCoords.top}px`,
              zIndex: 99999,
            }}
            className="bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-xl p-1.5 flex flex-col gap-1 min-w-[200px] text-xs font-sans pointer-events-auto"
          >
            <div className="px-2 py-1 text-[11px] font-mono text-[var(--on-surface-variant)] border-b border-[var(--outline)] mb-0.5 truncate">
              {`${headingPrefix} ${title}`}
            </div>

            {/* Selector de color blur */}
            <div className="px-2 py-1 border-b border-[var(--outline)] pb-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--on-surface-variant)] mb-1 flex items-center justify-between">
                <span>{i18n._(msg`Fondo Blur`)}</span>
                {activeColorKey !== 'default' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectColor('default');
                    }}
                    className="text-[9px] hover:underline text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                  >
                    {i18n._(msg`Restablecer`)}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1.5 py-0.5">
                {Object.entries(SECTION_COLOR_OPTIONS).map(([cKey, opt]) => {
                  const isSelected = activeColorKey === cKey;
                  return (
                    <button
                      key={cKey}
                      type="button"
                      title={opt.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectColor(cKey);
                      }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${opt.swatchClass} ${
                        isSelected
                          ? 'ring-2 ring-offset-1 ring-offset-[var(--surface-container)] ring-[var(--primary)] scale-110'
                          : 'opacity-80 hover:opacity-100 hover:scale-105'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-900 shadow-xs" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {!isContainer && (
              <button
                id={`btn-task-group-menu-add-task-${shape.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(false);
                  window.dispatchEvent(
                    new CustomEvent('antask:open-new-task-modal', {
                      detail: { groupTitle: title },
                    })
                  );
                }}
                className="px-2 py-1 rounded text-left text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-2 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>{i18n._(msg`Añadir tarea`)}</span>
              </button>
            )}
            <button
              id={`btn-task-group-menu-delete-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                window.dispatchEvent(
                  new CustomEvent('antask:delete-section', {
                    detail: {
                      groupTitle: title,
                      shapeId: shape.id,
                      headingId: shape.props?.headingId,
                      branchTitle: shape.props?.branchTitle,
                    },
                  })
                );
              }}
              className="px-2 py-1 rounded text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer transition-colors font-medium"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              <span>{isContainer ? i18n._(msg`Eliminar contenedor`) : i18n._(msg`Eliminar sección`)}</span>
            </button>
          </div>,
          document.body
        )}
      </div>
    </HTMLContainer>
  );
}

export type GroupShapeProps = {
  w: number;
  h: number;
  title: string;
  count: number;
  completedCount: number;
  level?: number;
  parentTitle?: string;
  parentId?: string;
  headingId?: string;
  branchTitle?: string;
  path?: string;
  isContainer?: boolean;
  color?: string;
};

export type ITaskGroupShape = TLBaseShape<'task-group', GroupShapeProps>;

export class TaskGroupShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = 'task-group' as const;

  static override props: RecordProps<any> = {
    w: T.number,
    h: T.number,
    title: T.string,
    count: T.number,
    completedCount: T.number,
    level: T.optional(T.number),
    parentTitle: T.optional(T.string),
    parentId: T.optional(T.string),
    headingId: T.optional(T.string),
    branchTitle: T.optional(T.string),
    path: T.optional(T.string),
    isContainer: T.optional(T.boolean),
    color: T.optional(T.string),
  };

  getDefaultProps(): GroupShapeProps {
    return {
      w: 360,
      h: 300,
      title: 'Section',
      count: 0,
      completedCount: 0,
      level: 2,
      isContainer: false,
    };
  }

  getGeometry(shape: ITaskGroupShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canResize = () => true;
  override isAspectRatioLocked = () => false;
  override onResize(shape: ITaskGroupShape, info: any) {
    return resizeBox(shape as any, info, { minWidth: 200, minHeight: 120 });
  }

  override hideSelectionBoundsBg(shape: ITaskGroupShape): boolean {
    const globalFilters = getGlobalTaskFilters();
    return (
      globalFilters.section !== 'all' &&
      shape.props.title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase()
    );
  }

  override hideSelectionBoundsFg(shape: ITaskGroupShape): boolean {
    const globalFilters = getGlobalTaskFilters();
    return (
      globalFilters.section !== 'all' &&
      shape.props.title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase()
    );
  }

  override canBind(opts?: any) {
    const globalFilters = getGlobalTaskFilters();
    if (globalFilters.section !== 'all') {
      const targetShape = (opts?.toShape || opts?.fromShape) as ITaskGroupShape;
      if (
        targetShape?.type === 'task-group' &&
        targetShape.props.title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase()
      ) {
        return false;
      }
    }
    return true;
  }

  override canSnap() {
    return true;
  }

  override getHandleSnapGeometry(shape: ITaskGroupShape): HandleSnapGeometry {
    const globalFilters = getGlobalTaskFilters();
    if (
      globalFilters.section !== 'all' &&
      shape.props.title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase()
    ) {
      return { points: [] };
    }
    const { w, h } = shape.props;
    const geom = this.getGeometry(shape);
    return {
      outline: geom,
      points: [
        { x: w / 2, y: h / 2 },
        { x: w / 2, y: 0 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
        { x: w, y: h / 2 },
        ...geom.bounds.corners,
      ],
    };
  }

  getIndicatorPath(shape: ITaskGroupShape) {
    const globalFilters = getGlobalTaskFilters();
    if (
      globalFilters.section !== 'all' &&
      shape.props.title.trim().toLowerCase() !== globalFilters.section.trim().toLowerCase()
    ) {
      return undefined;
    }
    if (typeof Path2D !== 'undefined') {
      const path = new Path2D();
      if (typeof path.roundRect === 'function') {
        path.roundRect(0, 0, shape.props.w, shape.props.h, 6);
      } else {
        path.rect(0, 0, shape.props.w, shape.props.h);
      }
      return path;
    }
    return undefined;
  }

  component(shape: ITaskGroupShape) {
    return <TaskGroupComponent shape={shape} editor={this.editor} />;
  }
}

export const INITIAL_MOCK_GROUPS: ParsedGroup[] = [
  {
    title: 'Autenticación',
    tasks: [
      {
        title: 'Configurar OAuth',
        completed: false,
        priority: 'P0',
        status: 'todo',
        taskId: 'oauth',
      },
      {
        title: 'Persistir sesión',
        completed: false,
        priority: 'P0',
        status: 'todo',
        taskId: 'session',
        blockedBy: 'oauth',
      },
    ],
  },
  {
    title: 'Perfil',
    tasks: [
      {
        title: 'Crear pantalla de perfil',
        completed: false,
        priority: 'P2',
        status: 'todo',
        taskId: 'profile',
      },
      {
        title: 'Añadir avatar',
        completed: true,
        priority: 'P3',
        status: 'done',
        taskId: 'avatar',
        blockedBy: 'profile',
      },
    ],
  },
];

function toRichTextHelper(text: string) {
  const lines = text.split('\n');
  const content = lines.map((line) => {
    if (!line) {
      return { type: 'paragraph' };
    }
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    };
  });
  return {
    type: 'doc',
    content,
  };
}

let isPopulatingCanvasFromMarkdownFlag = false;

export function isCanvasPopulatingFromMarkdown(): boolean {
  return isPopulatingCanvasFromMarkdownFlag;
}

export function setCanvasPopulatingFromMarkdown(val: boolean) {
  isPopulatingCanvasFromMarkdownFlag = val;
}

export function populateCanvasWithGroups(
  editor: Editor,
  groups: ParsedGroup[],
  savedVisualState?: CanvasVisualDocument | null,
  rawMarkdown?: string,
  options?: { shouldZoomToFit?: boolean; clearNotes?: boolean }
): { taskCount: number; groupCount: number } {
  isPopulatingCanvasFromMarkdownFlag = true;
  try {
    // Clear existing task, group, and arrow shapes on canvas
  const existingShapes = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        (s as any).type === 'task' ||
        (s as any).type === 'task-group' ||
        (s as any).type === 'arrow'
    );

  if (existingShapes.length > 0) {
    editor.deleteShapes(existingShapes.map((s) => s.id));
  }

  const validationReport = rawMarkdown ? validateMarkdownDocument(rawMarkdown) : null;
  const duplicateIds = validationReport?.duplicateIds || new Set<string>();
  const missingIdTaskIds = validationReport?.missingIdTaskIds || new Set<string>();
  const unresolvedBlockerMap = validationReport?.unresolvedBlockerMap || new Map<string, string[]>();

  const cardWidth = 320;
  const cardHeight = 110;
  const cardGap = 16;
  const groupPaddingX = 20;
  const groupHeaderHeight = 56;
  const groupPaddingTop = 16;
  const groupPaddingBottom = 20;

  const groupWidth = cardWidth + groupPaddingX * 2; // 360px
  const groupSpacingX = groupWidth + 40; // 400px

  const groupShapesToCreate: any[] = [];
  const taskShapesToCreate: any[] = [];
  const arrowShapesToCreate: any[] = [];
  const bindingsToCreate: any[] = [];

  // Map from normalized taskId -> shapeId for dependency resolution
  const taskIdToShapeId = new Map<string, string>();
  const tasksWithDependencies: Array<{
    blockedShapeId: string;
    blockedByStr: string;
  }> = [];

  // Index saved visual state for rapid retrieval
  const savedTaskMap = new Map<string, { x: number; y: number; width: number; height: number; groupTitle?: string }>();
  if (savedVisualState?.tasks) {
    for (const t of savedVisualState.tasks) {
      if (t.taskId) {
        savedTaskMap.set(t.taskId.toLowerCase(), t);
      }
    }
  }

  const savedGroupMap = new Map<string, { x: number; y: number; width: number; height: number; isCollapsed?: boolean; color?: string }>();
  if (savedVisualState?.groups) {
    for (const g of savedVisualState.groups) {
      if (g.groupTitle) {
        savedGroupMap.set(g.groupTitle.toLowerCase(), g);
      }
    }
  }

  interface PlacedGroup {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const isRectOverlapping = (
    r1: { x: number; y: number; w: number; h: number },
    r2: { x: number; y: number; w: number; h: number },
    margin = 20
  ) => {
    return (
      r1.x < r2.x + r2.w + margin &&
      r1.x + r1.w + margin > r2.x &&
      r1.y < r2.y + r2.h + margin &&
      r1.y + r1.h + margin > r2.y
    );
  };

  const groupPlacements = new Map<number, PlacedGroup>();
  const placedRects: PlacedGroup[] = [];

  const getTaskCalculatedHeight = (task: ParsedMarkdownTask) => {
    const subCount = task.subtasks?.items?.length || 0;
    return subCount > 0 ? cardHeight + 20 + subCount * 22 : cardHeight;
  };

  // Pass 1: Place groups that already have saved positions in savedGroupMap
  groups.forEach((group, index) => {
    const saved = savedGroupMap.get(group.title.toLowerCase());
    if (saved) {
      const taskCount = group.tasks.length;
      const totalGroupTasksHeight = group.tasks.reduce(
        (acc, t) => acc + getTaskCalculatedHeight(t),
        0
      );
      const defaultCalculatedHeight = Math.max(
        180,
        groupHeaderHeight +
          groupPaddingTop +
          totalGroupTasksHeight +
          Math.max(0, taskCount - 1) * cardGap +
          groupPaddingBottom
      );
      const w = saved.width || groupWidth;
      const h = saved.height || defaultCalculatedHeight;
      let x = saved.x;
      let y = saved.y;

      while (placedRects.some((p) => isRectOverlapping({ x, y, w, h }, p))) {
        const maxRight = Math.max(...placedRects.map((p) => p.x + p.w));
        x = maxRight + 40;
      }

      const placed = { x, y, w, h };
      groupPlacements.set(index, placed);
      placedRects.push(placed);
    }
  });

  // Pass 2: Place new groups (not present in savedGroupMap), avoiding any overlap
  const MAX_GROUPS_PER_ROW = 5;
  groups.forEach((group, index) => {
    if (groupPlacements.has(index)) return;

    const taskCount = group.tasks.length;
    const totalGroupTasksHeight = group.tasks.reduce(
      (acc, t) => acc + getTaskCalculatedHeight(t),
      0
    );
    const defaultCalculatedHeight = Math.max(
      180,
      groupHeaderHeight +
        groupPaddingTop +
        totalGroupTasksHeight +
        Math.max(0, taskCount - 1) * cardGap +
        groupPaddingBottom
    );
    const w = groupWidth;
    const h = defaultCalculatedHeight;

    let x: number;
    let y: number;

    if (placedRects.length === 0) {
      x = 80;
      y = 80;
    } else if (placedRects.length % MAX_GROUPS_PER_ROW === 0) {
      // Wrap to next row to accommodate up to 10 sections in a clean 2-row grid
      const maxBottom = Math.max(...placedRects.map((p) => p.y + p.h));
      x = 80;
      y = maxBottom + 64;
    } else {
      const prev = placedRects[placedRects.length - 1];
      const prevGroup = groups[index - 1];
      const isNewBranch = prevGroup && group.branchTitle && prevGroup.branchTitle !== group.branchTitle;
      const tentativeX = prev.x + prev.w + (isNewBranch ? 64 : 40);
      if (isNewBranch || tentativeX + w > 1400 + 80) {
        const maxBottom = Math.max(...placedRects.map((p) => p.y + p.h));
        x = 80;
        y = maxBottom + 64;
      } else {
        x = tentativeX;
        y = prev.y;
      }
    }

    while (placedRects.some((p) => isRectOverlapping({ x, y, w, h }, p))) {
      x += 40;
    }

    const placed = { x, y, w, h };
    groupPlacements.set(index, placed);
    placedRects.push(placed);
  });

  let totalTasks = 0;

  groups.forEach((group, groupIndex) => {
    const taskCount = group.tasks.length;
    totalTasks += taskCount;
    const completedCount = group.tasks.filter((t) => t.completed).length;

    const placed = groupPlacements.get(groupIndex)!;
    const groupX = placed.x;
    const groupY = placed.y;
    const groupW = placed.w;
    const groupH = placed.h;
    const isNewGroup = !savedGroupMap.has(group.title.toLowerCase());
    const saved = savedGroupMap.get(group.title.toLowerCase());

    // If this group is a parent container with child headings AND has direct tasks:
    // Its parentId for the leaf column is ITSELF (group.id), so its macro container encloses it!
    const leafParentId = (group.isParent && group.id) ? group.id : group.parentId;

    // Create Group container shape
    groupShapesToCreate.push({
      id: createShapeId(),
      type: 'task-group' as const,
      x: groupX,
      y: groupY,
      props: {
        w: groupW,
        h: groupH,
        title: group.title,
        count: taskCount,
        completedCount,
        level: group.level || 2,
        parentTitle: group.parentTitle,
        parentId: leafParentId,
        headingId: group.id,
        branchTitle: group.branchTitle,
        path: group.path,
        isContainer: false,
        color: group.color || saved?.color,
      },
    });

    // Create Task shapes
    let currentTaskY = groupY + groupHeaderHeight + groupPaddingTop;
    group.tasks.forEach((task, taskIndex) => {
      const taskCalculatedH = getTaskCalculatedHeight(task);
      const defaultTaskX = groupX + groupPaddingX;
      const defaultTaskY = currentTaskY;
      currentTaskY += taskCalculatedH + cardGap;

      const shapeId = createShapeId();
      const resolvedTaskId = task.taskId || task.temporaryId || `temp-task-${groupIndex + 1}-${taskIndex + 1}`;
      const normalizedId = resolvedTaskId.toLowerCase();

      // Only associate for arrow bindings if not duplicated collision
      const isDuplicate = task.taskId ? duplicateIds.has(task.taskId.toLowerCase()) : false;
      const isMissingId = !task.taskId || missingIdTaskIds.has(resolvedTaskId);
      const unresolvedBlockers = unresolvedBlockerMap.get(normalizedId);

      if (!isDuplicate) {
        taskIdToShapeId.set(normalizedId, shapeId);
      }

      if (task.blockedBy) {
        tasksWithDependencies.push({
          blockedShapeId: shapeId,
          blockedByStr: task.blockedBy,
        });
      }

      const savedTask = savedTaskMap.get(normalizedId);
      const belongsToCurrentGroup = !isNewGroup && (savedTask?.groupTitle
        ? savedTask.groupTitle.toLowerCase() === group.title.toLowerCase()
        : true);
      const taskX = savedTask && belongsToCurrentGroup ? savedTask.x : defaultTaskX;
      const taskY = savedTask && belongsToCurrentGroup ? savedTask.y : defaultTaskY;
      const taskW = savedTask && savedTask.width ? savedTask.width : cardWidth;
      const taskH = savedTask && savedTask.height ? Math.max(savedTask.height, taskCalculatedH) : taskCalculatedH;

      taskShapesToCreate.push({
        id: shapeId,
        type: 'task' as const,
        x: taskX,
        y: taskY,
        props: {
          w: taskW,
          h: taskH,
          title: task.title,
          completed: task.completed,
          priority: task.priority || 'P1',
          taskId: resolvedTaskId,
          status: task.status,
          groupTitle: group.title,
          groupHeadingId: group.id,
          branchTitle: group.branchTitle,
          tags: task.tags,
          subtasks: task.subtasks,
          blockedBy: task.blockedBy,
          isDuplicateId: isDuplicate,
          hasMissingId: isMissingId,
          unresolvedBlockers,
        },
      });
    });
  });

  // Create native arrows from blocker task -> blocked task (ignoring nonexistent/duplicate targets)
  tasksWithDependencies.forEach(({ blockedShapeId, blockedByStr }) => {
    const blockerIds = blockedByStr
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean);

    blockerIds.forEach((blockerId) => {
      const blockerShapeId = taskIdToShapeId.get(blockerId);
      if (blockerShapeId && blockerShapeId !== blockedShapeId) {
        const arrowId = createShapeId();

        arrowShapesToCreate.push({
          id: arrowId,
          type: 'arrow' as const,
          props: {
            color: 'grey',
            size: 's',
            arrowheadEnd: 'arrow',
            arrowheadStart: 'none',
            bend: 0,
          },
        });

        const blockerShape = taskShapesToCreate.find((s) => s.id === blockerShapeId);
        const blockedShape = taskShapesToCreate.find((s) => s.id === blockedShapeId);

        let startAnchor = { x: 0.5, y: 1 };
        let endAnchor = { x: 0.5, y: 0 };

        if (blockerShape && blockedShape) {
          const dx = blockedShape.x - blockerShape.x;
          const dy = blockedShape.y - blockerShape.y;

          if (Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx > 0) {
              startAnchor = { x: 1, y: 0.5 }; // Right center
              endAnchor = { x: 0, y: 0.5 };   // Left center
            } else {
              startAnchor = { x: 0, y: 0.5 }; // Left center
              endAnchor = { x: 1, y: 0.5 };   // Right center
            }
          } else {
            if (dy > 0) {
              startAnchor = { x: 0.5, y: 1 }; // Bottom center
              endAnchor = { x: 0.5, y: 0 };   // Top center
            } else {
              startAnchor = { x: 0.5, y: 0 }; // Top center
              endAnchor = { x: 0.5, y: 1 };   // Bottom center
            }
          }
        }

        bindingsToCreate.push(
          {
            fromId: arrowId,
            toId: blockerShapeId,
            type: 'arrow',
            props: {
              terminal: 'start',
              normalizedAnchor: startAnchor,
              isExact: false,
              isPrecise: false,
            },
          },
          {
            fromId: arrowId,
            toId: blockedShapeId,
            type: 'arrow',
            props: {
              terminal: 'end',
              normalizedAnchor: endAnchor,
              isExact: false,
              isPrecise: false,
            },
          }
        );
      }
    });
  });

  // Pass 3: Create parent macro-group shapes enclosing their child sections
  const { parentHeadings } = rawMarkdown ? scanTaskBlocks(rawMarkdown) : { parentHeadings: [] };

  const MACRO_PAD_X = 28;
  const MACRO_HEADER_PAD_Y = 56;
  const MACRO_BOTTOM_PAD_Y = 28;
  const macroGroupShapesToCreate: any[] = [];

  // Sort parent headings by level descending so deeper parents (e.g. level 4, then level 3) are bounded first,
  // then enclosing higher-level parents (e.g. level 2 or level 1) can enclose them.
  const sortedParents = [...parentHeadings].sort((a, b) => (b.level || 1) - (a.level || 1));

  sortedParents.forEach((ph) => {
    // Direct children: match by branchTitle for level 2, or parentId === ph.id first, with fallback to parentTitle
    const directChildren = [...groupShapesToCreate, ...macroGroupShapesToCreate].filter((s) => {
      if (ph.level === 2 && s.props?.branchTitle && s.props.branchTitle.toLowerCase() === ph.title.toLowerCase()) {
        return true;
      }
      if (s.props?.parentId && ph.id) {
        return s.props.parentId === ph.id;
      }
      const ptMatches = (s.props?.parentTitle || '').trim().toLowerCase() === ph.title.trim().toLowerCase();
      if (!ptMatches) return false;
      if (s.props?.branchTitle && ph.branchTitle) {
        return s.props.branchTitle.toLowerCase() === ph.branchTitle.toLowerCase();
      }
      return true;
    });

    if (directChildren.length === 0) return;

    const minX = Math.min(...directChildren.map((s) => s.x));
    const minY = Math.min(...directChildren.map((s) => s.y));
    const maxRight = Math.max(...directChildren.map((s) => s.x + s.props.w));
    const maxBottom = Math.max(...directChildren.map((s) => s.y + s.props.h));

    const totalTasks = directChildren.reduce((sum, s) => sum + (s.props?.count || 0), 0);
    const completedTasks = directChildren.reduce((sum, s) => sum + (s.props?.completedCount || 0), 0);

    const pSaved = savedGroupMap.get(ph.title.toLowerCase());
    const calcX = minX - MACRO_PAD_X;
    const calcY = minY - MACRO_HEADER_PAD_Y;
    const calcW = (maxRight - minX) + MACRO_PAD_X * 2;
    const calcH = (maxBottom - minY) + MACRO_HEADER_PAD_Y + MACRO_BOTTOM_PAD_Y;

    macroGroupShapesToCreate.push({
      id: createShapeId(),
      type: 'task-group' as const,
      x: pSaved ? Math.min(pSaved.x, calcX) : calcX,
      y: pSaved ? Math.min(pSaved.y, calcY) : calcY,
      props: {
        w: pSaved ? Math.max(pSaved.width, (maxRight - Math.min(pSaved.x, calcX)) + MACRO_PAD_X) : calcW,
        h: pSaved ? Math.max(pSaved.height, (maxBottom - Math.min(pSaved.y, calcY)) + MACRO_BOTTOM_PAD_Y) : calcH,
        title: ph.title,
        count: totalTasks,
        completedCount: completedTasks,
        level: ph.level || 1,
        parentTitle: ph.parentTitle,
        parentId: ph.parentId,
        headingId: ph.id,
        branchTitle: ph.branchTitle,
        path: ph.path,
        isContainer: true,
        color: ph.color || pSaved?.color,
      },
    });
  });

  // Sort macro group shapes by level ASC so outermost containers (lower level numbers) are created first in editor (placed behind)
  macroGroupShapesToCreate.sort((a, b) => (a.props.level || 1) - (b.props.level || 1));

  if (macroGroupShapesToCreate.length > 0) {
    (editor.createShapes as any)(macroGroupShapesToCreate);
  }
  if (groupShapesToCreate.length > 0) {
    (editor.createShapes as any)(groupShapesToCreate);
  }
  if (taskShapesToCreate.length > 0) {
    (editor.createShapes as any)(taskShapesToCreate);
  }
  if (arrowShapesToCreate.length > 0) {
    (editor.createShapes as any)(arrowShapesToCreate);
  }
  if (bindingsToCreate.length > 0) {
    (editor.createBindings as any)(bindingsToCreate);
  }

  // Populate note shapes from Markdown "## Notas" section if needed
  if (rawMarkdown) {
    const existingNotes = editor
      .getCurrentPageShapes()
      .filter((s) => (s as any).type === 'note' || (s as any).type === 'text');

    if (existingNotes.length === 0 || options?.clearNotes) {
      if (options?.clearNotes && existingNotes.length > 0) {
        editor.deleteShapes(existingNotes.map((s) => s.id));
      }
      const scannedNotes = scanNotesFromMarkdown(rawMarkdown);
      if (scannedNotes.length > 0) {
        let maxRight = 40;
        for (const g of groupShapesToCreate) {
          const right = (g.x || 0) + (g.props?.w || 360);
          if (right > maxRight) maxRight = right;
        }

        const noteShapesToCreate = scannedNotes.map((noteText, idx) => ({
          id: createShapeId(),
          type: 'note' as const,
          x: maxRight + 40,
          y: 40 + idx * 220,
          props: {
            richText: toRichTextHelper(noteText),
            color: 'yellow',
            size: 'm',
          },
        }));

        (editor.createShapes as any)(noteShapesToCreate);
      }
    }
  }

  if (options?.shouldZoomToFit ?? true) {
    editor.zoomToFit({ animation: { duration: 250 } });
  }
  return { taskCount: totalTasks, groupCount: groups.length };
  } finally {
    setTimeout(() => {
      isPopulatingCanvasFromMarkdownFlag = false;
    }, 100);
  }
}

export function seedMockTasks(
  editor: Editor,
  savedVisualState?: CanvasVisualDocument | null
) {
  const existingShapes = editor
    .getCurrentPageShapes()
    .filter((s) => (s as any).type === 'task' || (s as any).type === 'task-group');

  if (existingShapes.length === 0) {
    populateCanvasWithGroups(editor, INITIAL_MOCK_GROUPS, savedVisualState);
  }
}

export function loadTasksFromMarkdown(
  editor: Editor,
  markdown: string,
  savedVisualState?: CanvasVisualDocument | null,
  options?: { shouldZoomToFit?: boolean; clearNotes?: boolean }
): { taskCount: number; groupCount: number } {
  const parsedGroups = parseTasksMarkdown(markdown);
  return populateCanvasWithGroups(editor, parsedGroups, savedVisualState, markdown, options);
}
