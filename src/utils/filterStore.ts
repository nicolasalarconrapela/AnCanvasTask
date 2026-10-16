import { useSyncExternalStore } from 'react';
import { TaskFilterState } from '../components/FilterBar';

export interface TaskFilterData {
  title?: string;
  taskId?: string;
  completed?: boolean;
  priority?: string;
  status?: string;
  description?: string;
  groupTitle?: string;
  section?: string;
  tags?: string[];
  blockedBy?: string;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = {
  status: 'all',
  priority: 'all',
  section: 'all',
  tag: 'all',
  onlyBlocked: false,
  sortBy: 'default',
  showTaskIds: true,
  showTaskStatus: true,
  showTaskPriority: true,
  showHiddenItemLabels: true,
};

let currentGlobalFilters: TaskFilterState = { ...DEFAULT_TASK_FILTERS };
const listeners = new Set<() => void>();

export function getGlobalTaskFilters(): TaskFilterState {
  return currentGlobalFilters;
}

export function setGlobalTaskFilters(filters: Partial<TaskFilterState>): void {
  currentGlobalFilters = {
    ...currentGlobalFilters,
    ...filters,
  };
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('Error in filter listener', e);
    }
  });
}

export function resetGlobalTaskFilters(): void {
  currentGlobalFilters = { ...DEFAULT_TASK_FILTERS };
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('Error in filter listener', e);
    }
  });
}

export function useGlobalTaskFilters(): TaskFilterState {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getGlobalTaskFilters,
    () => DEFAULT_TASK_FILTERS
  );
}

/**
 * Checks whether any filter or search query is currently active.
 */
export function hasActiveFilters(filters?: TaskFilterState | null, searchQuery?: string | null): boolean {
  if (searchQuery && searchQuery.trim().length > 0) return true;
  if (!filters) return false;
  return (
    filters.status !== 'all' ||
    filters.priority !== 'all' ||
    filters.section !== 'all' ||
    filters.tag !== 'all' ||
    Boolean(filters.onlyBlocked)
  );
}

/**
 * Universal evaluator that checks if a task matches all active filters and search query.
 * Used identically across Canvas, Kanban, and stats.
 */
export function isTaskMatchingFilters(
  task: TaskFilterData,
  filters?: TaskFilterState | null,
  searchQuery?: string | null
): boolean {
  // 1. Check Search Query
  if (searchQuery && searchQuery.trim()) {
    const rawTerms = searchQuery
      .trim()
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    for (const term of rawTerms) {
      const cleanTerm = term.replace(/^[#@]/, '');
      const title = (task.title || '').toLowerCase();
      const desc = (task.description || '').toLowerCase();
      const id = (task.taskId || '').toLowerCase();
      const group = (task.groupTitle || task.section || '').toLowerCase();
      const priority = (task.priority || '').toLowerCase();
      const status = (task.status || '').toLowerCase();
      const isCompleted = Boolean(task.completed);

      const matchTitle = title.includes(term) || (cleanTerm && title.includes(cleanTerm));
      const matchDesc = desc.includes(term) || (cleanTerm && desc.includes(cleanTerm));
      const matchId = id.includes(term) || (cleanTerm && id.includes(cleanTerm));
      const matchGroup = group.includes(term) || (cleanTerm && group.includes(cleanTerm));
      const matchTags = task.tags?.some(
        (t) => t.toLowerCase().includes(term) || (cleanTerm && t.toLowerCase().includes(cleanTerm))
      );
      const matchPriority = priority === term || priority === cleanTerm;
      const matchStatus =
        status.includes(term) ||
        status.includes(cleanTerm) ||
        ((term === 'done' || term === 'hecho' || term === 'completado' || term === 'completada') && isCompleted) ||
        ((term === 'todo' || term === 'pendiente' || term === 'por hacer') && !isCompleted);

      // Every term in a multi-word search must match at least one field
      if (!matchTitle && !matchDesc && !matchId && !matchGroup && !matchTags && !matchPriority && !matchStatus) {
        return false;
      }
    }
  }

  // Helper to normalize task status strings
  const normalizeStatus = (s?: string): string => {
    if (!s) return 'todo';
    const clean = s.toLowerCase().trim().replace(/[-\s]+/g, '_');
    if (clean === 'progress') return 'in_progress';
    return clean;
  };

  // 2. Comprehensive Filters
  if (filters) {
    // Status Filter
    if (filters.status && filters.status !== 'all') {
      const isCompleted = Boolean(task.completed) || task.status === 'done';
      const targetStatus = normalizeStatus(filters.status);
      const currentStatus = isCompleted ? 'done' : normalizeStatus(task.status);

      if (targetStatus === 'done') {
        if (!isCompleted) return false;
      } else if (targetStatus === 'todo') {
        if (isCompleted) return false;
        if (currentStatus !== 'todo' && currentStatus !== 'backlog') return false;
      } else if (targetStatus === 'blocked') {
        if (isCompleted) return false;
        const hasBlocker = Boolean(task.blockedBy && task.blockedBy.trim().length > 0);
        if (!hasBlocker && currentStatus !== 'blocked') return false;
      } else {
        // in_progress, review, backlog
        if (isCompleted || currentStatus !== targetStatus) return false;
      }
    }

    // Priority Filter
    if (filters.priority && filters.priority !== 'all') {
      const p = (task.priority || 'P3').toUpperCase();
      if (p !== filters.priority.toUpperCase()) return false;
    }

    // Section / Group Filter
    if (filters.section && filters.section !== 'all') {
      const taskSection = (task.groupTitle || task.section || '').trim().toLowerCase();
      const targetSection = filters.section.trim().toLowerCase();
      if (taskSection !== targetSection) return false;
    }

    // Tag Filter
    if (filters.tag && filters.tag !== 'all') {
      const targetTag = filters.tag.replace(/^[#@]/, '').trim().toLowerCase();
      const hasTag = task.tags?.some((t) => t.replace(/^[#@]/, '').trim().toLowerCase() === targetTag);
      if (!hasTag) return false;
    }

    // Only Blocked Filter
    if (filters.onlyBlocked) {
      if (task.completed) return false;
      const hasBlocker = Boolean(task.blockedBy && task.blockedBy.trim().length > 0);
      const isBlockedStatus = normalizeStatus(task.status) === 'blocked';
      if (!hasBlocker && !isBlockedStatus) return false;
    }
  }

  return true;
}
