import React, { useSyncExternalStore } from 'react';

let currentSearchQuery = '';
const listeners = new Set<() => void>();

export function getGlobalSearchQuery(): string {
  return currentSearchQuery;
}

export function setGlobalSearchQuery(query: string): void {
  if (currentSearchQuery === query) return;
  currentSearchQuery = query;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export function useGlobalSearchQuery(): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getGlobalSearchQuery,
    () => ''
  );
}

export interface HighlightTextProps {
  text: string | null | undefined;
  query?: string;
  className?: string;
  highlightClassName?: string;
}

export const HighlightText: React.FC<HighlightTextProps> = ({
  text,
  query,
  className = '',
  highlightClassName,
}) => {
  const globalQuery = useGlobalSearchQuery();
  const effectiveQuery = query !== undefined ? query : globalQuery;

  if (!text) return null;
  if (!effectiveQuery || !effectiveQuery.trim()) {
    return <span className={className}>{text}</span>;
  }

  const rawTerms = effectiveQuery
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const termSet = new Set<string>();
  for (const t of rawTerms) {
    termSet.add(t);
    const clean = t.replace(/^[#@]/, '');
    if (clean) termSet.add(clean);
  }

  const terms = Array.from(termSet).sort((a, b) => b.length - a.length);
  if (terms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const splitRegex = new RegExp(`(${escaped})`, 'gi');
  const testRegex = new RegExp(`^(${escaped})$`, 'i');

  const parts = text.split(splitRegex);
  const defaultHighlightClass =
    'bg-amber-400/35 text-amber-200 [data-theme=light]:text-amber-950 [data-theme=light]:bg-amber-300/80 rounded-[2px] px-0.5 font-semibold not-italic';

  return (
    <span className={className}>
      {parts.map((part, i) =>
        testRegex.test(part) ? (
          <mark key={i} className={highlightClassName || defaultHighlightClass}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </span>
  );
};

export function checkTaskMatchesQuery(
  task: {
    title?: string;
    taskId?: string;
    tags?: string[];
    priority?: string;
    status?: string;
    description?: string;
    groupTitle?: string;
  },
  query: string
): boolean {
  if (!query || !query.trim()) return false;
  const q = query.trim().toLowerCase();
  const cleanQ = q.replace(/^#/, '');

  if (task.title && (task.title.toLowerCase().includes(q) || task.title.toLowerCase().includes(cleanQ))) return true;
  if (task.description && (task.description.toLowerCase().includes(q) || task.description.toLowerCase().includes(cleanQ))) return true;
  if (task.taskId && task.taskId.toLowerCase().includes(cleanQ)) return true;
  if (task.tags && task.tags.some((t) => t.toLowerCase().includes(cleanQ))) return true;
  if (task.groupTitle && task.groupTitle.toLowerCase().includes(q)) return true;
  if (task.priority && task.priority.toLowerCase() === cleanQ) return true;
  if (task.status && task.status.toLowerCase() === cleanQ) return true;

  return false;
}
