import { parseTasksMarkdown, type ParsedGroup, type ParsedMarkdownTask } from '../utils/taskMarkdown';
export { parseTasksMarkdown, type ParsedGroup, type ParsedMarkdownTask } from '../utils/taskMarkdown';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { i18n, formatTaskCount } from '../i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  tags?: string[];
  subtasks?: { total: number; completed: number };
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
  const [isSelected, setIsSelected] = useState(false);

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
              id={`btn-task-card-menu-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
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
        {isMenuOpen && (
          <div
            id={`task-card-menu-dropdown-${shape.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-8 right-2 z-50 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md p-1 flex flex-col gap-0.5 min-w-[150px] text-xs font-sans"
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
          </div>
        )}

        {/* Middle Row: Unboxed Tags & Subtask progress */}
        {(tags?.length || subtasks) && (
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
            {subtasks && (
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
              <span
                className="text-[10px] font-semibold text-rose-400 font-mono"
                title={_(msg`ID duplicado en TASKS.md`)}
              >
                dup
              </span>
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
    tags: T.arrayOf(T.string).optional(),
    subtasks: T.object({ total: T.number, completed: T.number }).optional(),
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

    const groupShapes = this.editor
      .getCurrentPageShapes()
      .filter((s) => (s as any).type === 'task-group') as any[];

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

    const groupShapes = this.editor
      .getCurrentPageShapes()
      .filter((s) => (s as any).type === 'task-group') as any[];

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
            detail: { taskId, targetGroupTitle },
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
        },
      };
    } else {
      // Separated from its section into open canvas!
      // In Markdown, it must be assigned to ## Out
      if (taskId) {
        window.dispatchEvent(
          new CustomEvent('antask:task-moved-group', {
            detail: { taskId, targetGroupTitle: 'Out' },
          })
        );
      }

      return {
        id: current.id,
        type: 'task' as const,
        props: {
          ...current.props,
          groupTitle: 'Out',
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
    const tasksInGroup = taskShapes.filter(
      (t) => (t.props?.groupTitle || '').trim().toLowerCase() === gTitle
    );
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

function TaskGroupComponent({ shape }: { shape: ITaskGroupShape }) {
  const { title, count, completedCount, w, h } = shape.props;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isMenuOpen]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({
      x: Math.max(8, e.clientX - rect.left),
      y: Math.max(8, e.clientY - rect.top),
    });
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
        className="w-full h-full rounded-md bg-[var(--surface-container)]/30 border border-[var(--outline)] p-3 flex flex-col justify-start select-none transition-colors relative"
      >
        {/* Header */}
        <div
          id={`task-group-header-${shape.id}`}
          onContextMenu={handleContextMenu}
          className="flex items-center justify-between border-b border-[var(--outline)] pb-2 pointer-events-auto cursor-context-menu"
        >
          <div id={`task-group-title-group-${shape.id}`} className="flex items-center gap-1.5">
            <span className="text-[var(--on-surface-variant)] font-mono text-xs font-semibold">##</span>
            <h2 className="text-xs font-semibold text-[var(--on-surface)] font-sans tracking-tight truncate max-w-[180px]">
              {title}
            </h2>
            <span className="suction-indicator items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-[var(--primary)] bg-[var(--primary)]/10 border border-[var(--primary)]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
              {i18n._(msg`Ventosa`)}
            </span>
          </div>

          <div id={`task-group-actions-${shape.id}`} className="flex items-center gap-1.5">
            {count > 0 && (
              <span className="text-[11px] font-mono text-[var(--on-surface-variant)] tabular-nums">
                {completedCount > 0
                  ? i18n._(msg`${completedCount}/${count} completadas`)
                  : formatTaskCount(count)}
              </span>
            )}
            {/* Context menu trigger ⋮ */}
            <button
              id={`btn-task-group-menu-${shape.id}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setMenuPosition(null);
                setIsMenuOpen(!isMenuOpen);
              }}
              className="w-5 h-5 flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] rounded cursor-pointer transition-colors"
              title={i18n._(msg`Opciones de sección`)}
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
        {isMenuOpen && (
          <div
            ref={menuRef}
            id={`task-group-menu-dropdown-${shape.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: menuPosition ? `${menuPosition.x}px` : 'auto',
              top: menuPosition ? `${menuPosition.y}px` : '36px',
              right: menuPosition ? 'auto' : '8px',
              zIndex: 100,
            }}
            className="bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-lg p-1 flex flex-col gap-0.5 min-w-[170px] text-xs font-sans pointer-events-auto"
          >
            <div className="px-2 py-1 text-[11px] font-mono text-[var(--on-surface-variant)] border-b border-[var(--outline)] mb-0.5 truncate">
              ## {title}
            </div>
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
            <button
              id={`btn-task-group-menu-delete-${shape.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                window.dispatchEvent(
                  new CustomEvent('antask:delete-section', {
                    detail: { groupTitle: title, shapeId: shape.id },
                  })
                );
              }}
              className="px-2 py-1 rounded text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer transition-colors font-medium"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              <span>{i18n._(msg`Eliminar sección`)}</span>
            </button>
          </div>
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
  };

  getDefaultProps(): GroupShapeProps {
    return {
      w: 360,
      h: 300,
      title: 'Section',
      count: 0,
      completedCount: 0,
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
    return <TaskGroupComponent shape={shape} />;
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

  const savedGroupMap = new Map<string, { x: number; y: number; width: number; height: number; isCollapsed?: boolean }>();
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

  // Pass 1: Place groups that already have saved positions in savedGroupMap
  groups.forEach((group, index) => {
    const saved = savedGroupMap.get(group.title.toLowerCase());
    if (saved) {
      const taskCount = group.tasks.length;
      const defaultCalculatedHeight = Math.max(
        180,
        groupHeaderHeight +
          groupPaddingTop +
          taskCount * cardHeight +
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
  groups.forEach((group, index) => {
    if (groupPlacements.has(index)) return;

    const taskCount = group.tasks.length;
    const defaultCalculatedHeight = Math.max(
      180,
      groupHeaderHeight +
        groupPaddingTop +
        taskCount * cardHeight +
        Math.max(0, taskCount - 1) * cardGap +
        groupPaddingBottom
    );
    const w = groupWidth;
    const h = defaultCalculatedHeight;

    let x: number;
    let y: number;

    if (placedRects.length > 0) {
      const maxRight = Math.max(...placedRects.map((p) => p.x + p.w));
      const minY = Math.min(...placedRects.map((p) => p.y));
      x = maxRight + 40;
      y = minY;
    } else {
      x = 80;
      y = 80;
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
      },
    });

    // Create Task shapes
    group.tasks.forEach((task, taskIndex) => {
      const defaultTaskX = groupX + groupPaddingX;
      const defaultTaskY =
        groupY +
        groupHeaderHeight +
        groupPaddingTop +
        taskIndex * (cardHeight + cardGap);

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
      const taskH = savedTask && savedTask.height ? savedTask.height : cardHeight;

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
