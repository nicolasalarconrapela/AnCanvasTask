import { scanTaskBlocks } from '../utils/markdownSync';
import {
  useGlobalTaskFilters,
  getGlobalTaskFilters,
  hasActiveFilters,
  isTaskMatchingFilters,
} from '../utils/filterStore';
import { getGlobalSearchQuery } from '../utils/searchHighlight';
import { TaskFilterState } from '../components/FilterBar';

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

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';

export type TaskShapeProps = {
  w: number;
  h: number;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  taskId?: string;
  temporaryId?: string;
  status?: TaskStatus;
  groupTitle?: string;
  tags?: string[];
  subtasks?: { total: number; completed: number };
  blockedBy?: string;
  isDuplicateId?: boolean;
  hasMissingId?: boolean;
  unresolvedBlockers?: string[];
};

export interface ITaskShape {
  id: string;
  type: 'task';
  x?: number;
  y?: number;
  props: TaskShapeProps;
}

export interface ITaskGroupShape {
  id: string;
  type: 'task-group';
  x?: number;
  y?: number;
  props: {
    w: number;
    h: number;
    title: string;
    count?: number;
    isCollapsed?: boolean;
  };
}

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

export interface ParsedMarkdownTask {
  title: string;
  completed: boolean;
  taskId?: string;
  temporaryId?: string;
  priority: TaskPriority;
  status?: TaskStatus;
  tags?: string[];
  subtasks?: { total: number; completed: number };
  blockedBy?: string;
}

export interface ParsedGroup {
  title: string;
  tasks: ParsedMarkdownTask[];
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

export function parseTasksMarkdown(markdown: string): ParsedGroup[] {
  const { taskBlocks, groupHeadings } = scanTaskBlocks(markdown);
  const groupsMap = new Map<string, ParsedMarkdownTask[]>();

  // Ensure headings are preserved in order, excluding "Notas" / "Notes" sections
  groupHeadings.forEach((gh) => {
    const lower = gh.title.trim().toLowerCase();
    if (lower !== 'notas' && lower !== 'notes') {
      groupsMap.set(gh.title, []);
    }
  });

  taskBlocks.forEach((block) => {
    const grp = block.groupTitle || 'General';
    if (!groupsMap.has(grp)) {
      groupsMap.set(grp, []);
    }
    const isCompleted = block.rawTaskLine.includes('[x]') || block.rawTaskLine.includes('[X]');
    groupsMap.get(grp)!.push({
      title: block.detectedTitle,
      completed: isCompleted,
      taskId: block.detectedId,
      temporaryId: block.temporaryId,
      priority: block.detectedPriority || 'P1',
      status: (block.detectedStatus as any) || (isCompleted ? 'done' : 'todo'),
      tags: block.detectedTags,
      subtasks: block.detectedSubtasks,
      blockedBy: block.detectedBlockedBy,
    });
  });

  const parsedGroups: ParsedGroup[] = [];
  groupsMap.forEach((tasks, title) => {
    parsedGroups.push({ title, tasks });
  });

  return parsedGroups;
}

let isPopulatingCanvasFromMarkdownFlag = false;

export function isCanvasPopulatingFromMarkdown(): boolean {
  return isPopulatingCanvasFromMarkdownFlag;
}

export function setCanvasPopulatingFromMarkdown(val: boolean) {
  isPopulatingCanvasFromMarkdownFlag = val;
}

export class CustomNoteShapeUtil {}
export class TaskShapeUtil {}
export class TaskGroupShapeUtil {}

export type TLShapeId = string;
export function createShapeId(): string {
  return 'shape_' + Math.random().toString(36).substring(2, 9);
}

export function updateAllGroupCounts(_editor?: any): void {}

export function seedMockTasks(arg1?: any, _arg2?: any): any {
  const md = typeof arg1 === 'string' ? arg1 : '';
  const parsed = md ? parseTasksMarkdown(md) : INITIAL_MOCK_GROUPS;
  const taskCount = parsed.reduce((acc, g) => acc + g.tasks.length, 0);
  const groupCount = parsed.length;
  return Object.assign(parsed, { taskCount, groupCount });
}

export function loadTasksFromMarkdown(
  arg1?: any,
  arg2?: any,
  _arg3?: any,
  _arg4?: any
): any {
  const md = typeof arg1 === 'string' ? arg1 : typeof arg2 === 'string' ? arg2 : '';
  const parsed = parseTasksMarkdown(md);
  const taskCount = parsed.reduce((acc, g) => acc + g.tasks.length, 0);
  const groupCount = parsed.length;
  return Object.assign(parsed, { taskCount, groupCount });
}

