import { Editor, createShapeId, TLShapeId } from 'tldraw';
import { scanTaskBlocks } from './markdownSync';
import { parseTasksMarkdown, ParsedGroup, ParsedMarkdownTask } from './taskMarkdown';
import { setCanvasPopulatingFromMarkdown } from '../shapes/TaskShapeUtil';

export interface AutoLayoutResult {
  taskCount: number;
  groupCount: number;
}

export interface ComputedTaskLayout {
  taskId: string;
  temporaryId?: string;
  title: string;
  description?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  groupTitle: string;
  branchTitle?: string;
  groupHeadingId?: string;
}

export interface ComputedGroupLayout {
  id?: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  completedCount: number;
  level: number;
  parentTitle?: string;
  parentId?: string;
  headingId?: string;
  branchTitle?: string;
  path?: string;
  isContainer: boolean;
  color?: string;
}

export interface ComputedAutoLayout {
  tasks: ComputedTaskLayout[];
  groups: ComputedGroupLayout[];
}

export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 110;
export const CARD_GAP = 16;
export const GROUP_PADDING_X = 20;
export const GROUP_HEADER_HEIGHT = 56;
export const GROUP_PADDING_TOP = 16;
export const GROUP_PADDING_BOTTOM = 20;
export const GROUP_WIDTH = CARD_WIDTH + GROUP_PADDING_X * 2; // 360px

export const MACRO_PAD_X = 28;
export const MACRO_HEADER_PAD_Y = 56;
export const MACRO_BOTTOM_PAD_Y = 28;

export const START_X = 80;
export const START_Y = 80;
export const COL_GAP_X = 40;
export const ROW_GAP_Y = 48;
export const BRANCH_GAP_X = 64;

export function getTaskCalculatedHeight(task: ParsedMarkdownTask): number {
  const subCount = task.subtasks?.items?.length || 0;
  const descExtra = task.description ? 24 : 0;
  return subCount > 0 ? CARD_HEIGHT + 20 + subCount * 22 + descExtra : CARD_HEIGHT + descExtra;
}

export function isRectOverlapping(
  r1: { x: number; y: number; w: number; h: number },
  r2: { x: number; y: number; w: number; h: number },
  margin = 20
): boolean {
  return (
    r1.x < r2.x + r2.w + margin &&
    r1.x + r1.w + margin > r2.x &&
    r1.y < r2.y + r2.h + margin &&
    r1.y + r1.h + margin > r2.y
  );
}

/**
 * Topologically sorts tasks within a section so blockers appear strictly above blocked tasks.
 * Preserves original document order when there are no dependencies.
 */
export function orderTasksTopologically(tasks: ParsedMarkdownTask[]): ParsedMarkdownTask[] {
  if (tasks.length <= 1) return tasks;

  const taskById = new Map<string, ParsedMarkdownTask>();
  tasks.forEach((t) => {
    const id = (t.taskId || t.temporaryId || '').toLowerCase();
    if (id) taskById.set(id, t);
  });

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  tasks.forEach((t) => {
    const id = (t.taskId || t.temporaryId || '').toLowerCase();
    inDegree.set(id, 0);
    adj.set(id, []);
  });

  tasks.forEach((t) => {
    const blockedId = (t.taskId || t.temporaryId || '').toLowerCase();
    if (t.blockedBy) {
      const blockerIds = t.blockedBy.split(',').map((s) => s.trim().toLowerCase());
      blockerIds.forEach((bId) => {
        if (taskById.has(bId) && bId !== blockedId) {
          adj.get(bId)!.push(blockedId);
          inDegree.set(blockedId, (inDegree.get(blockedId) || 0) + 1);
        }
      });
    }
  });

  const queue: string[] = [];
  tasks.forEach((t) => {
    const id = (t.taskId || t.temporaryId || '').toLowerCase();
    if ((inDegree.get(id) || 0) === 0) {
      queue.push(id);
    }
  });

  const ordered: ParsedMarkdownTask[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const u = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    const task = taskById.get(u);
    if (task) ordered.push(task);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      inDegree.set(v, (inDegree.get(v) || 1) - 1);
      if (inDegree.get(v) === 0 && !visited.has(v)) {
        queue.push(v);
      }
    }
  }

  // Append remaining tasks (cycles or missing IDs)
  tasks.forEach((t) => {
    const id = (t.taskId || t.temporaryId || '').toLowerCase();
    if (!id || !visited.has(id)) {
      ordered.push(t);
    }
  });

  return ordered;
}

/**
 * Computes deterministic, non-overlapping positions for all tasks and sections.
 * Guarantees that:
 * 1. Every task is strictly inside its section boundaries with defined margins.
 * 2. Section columns never overlap each other.
 * 3. Parent macro containers enclose their children with boundary clearance.
 */
export function computeAutoLayout(markdown: string): ComputedAutoLayout {
  const parsedGroups = parseTasksMarkdown(markdown);
  const { parentHeadings } = scanTaskBlocks(markdown);

  if (parsedGroups.length === 0) {
    return { tasks: [], groups: [] };
  }

  const computedTasks: ComputedTaskLayout[] = [];
  const leafGroups: ComputedGroupLayout[] = [];

  // Partition parsedGroups by distinct branch title (preserving root groups with branchTitle = '')
  const branchMap = new Map<string, ParsedGroup[]>();
  parsedGroups.forEach((g) => {
    const b = g.branchTitle || '';
    if (!branchMap.has(b)) {
      branchMap.set(b, []);
    }
    branchMap.get(b)!.push(g);
  });

  const hasMultipleBranches = branchMap.size > 1 || (branchMap.size === 1 && !branchMap.has(''));

  const MAX_ROW_WIDTH = 1400; // Comfortable canvas row width threshold
  let currentBranchX = START_X;
  let currentBranchY = START_Y;
  let rowMaxBottom = currentBranchY;

  // Order: unbranched/root groups first, then named branches in order of appearance
  const branchEntries = Array.from(branchMap.entries()).sort(([a], [b]) => {
    if (a === '' && b !== '') return -1;
    if (a !== '' && b === '') return 1;
    return 0;
  });

  branchEntries.forEach(([branchName, branchGroups]) => {
    if (branchGroups.length === 0) return;

    const numCols = branchGroups.length;
    const branchColsWidth = numCols * GROUP_WIDTH + Math.max(0, numCols - 1) * COL_GAP_X;
    const isNamedBranch = Boolean(branchName);
    const branchBlockWidth = isNamedBranch ? branchColsWidth + MACRO_PAD_X * 2 : branchColsWidth;

    // Wrap branch block if exceeding comfortable row width
    if (currentBranchX > START_X && currentBranchX + branchBlockWidth > MAX_ROW_WIDTH + START_X) {
      currentBranchX = START_X;
      currentBranchY = rowMaxBottom + ROW_GAP_Y;
      rowMaxBottom = currentBranchY;
    }

    const branchStartX = currentBranchX;
    const branchStartY = currentBranchY;
    let colX = isNamedBranch ? branchStartX + MACRO_PAD_X : branchStartX;
    const colY = isNamedBranch ? branchStartY + MACRO_HEADER_PAD_Y : branchStartY;
    let branchMaxColBottom = colY;

    branchGroups.forEach((group) => {
      const taskCount = group.tasks.length;
      const completedCount = group.tasks.filter((t) => t.completed).length;

      // Position tasks inside this section column
      let currentTaskY = colY + GROUP_HEADER_HEIGHT + GROUP_PADDING_TOP;
      const orderedTasks = orderTasksTopologically(group.tasks);

      orderedTasks.forEach((task, tIdx) => {
        const taskH = getTaskCalculatedHeight(task);
        const tId = task.taskId || task.temporaryId || `task-${group.id || group.title}-${tIdx + 1}`;

        computedTasks.push({
          taskId: tId,
          temporaryId: task.temporaryId,
          title: task.title,
          description: task.description,
          x: colX + GROUP_PADDING_X,
          y: currentTaskY,
          w: CARD_WIDTH,
          h: taskH,
          groupTitle: group.title,
          branchTitle: group.branchTitle,
          groupHeadingId: group.id,
        });

        currentTaskY += taskH + CARD_GAP;
      });

      const calculatedGroupH = Math.max(
        180,
        currentTaskY - colY - CARD_GAP + GROUP_PADDING_BOTTOM
      );

      const leafG: ComputedGroupLayout = {
        id: group.id,
        title: group.title,
        x: colX,
        y: colY,
        w: GROUP_WIDTH,
        h: calculatedGroupH,
        count: taskCount,
        completedCount,
        level: group.level || 2,
        parentTitle: group.parentTitle,
        parentId: group.parentId,
        headingId: group.id,
        branchTitle: group.branchTitle,
        path: group.path,
        isContainer: false,
        color: group.color,
      };

      leafGroups.push(leafG);

      if (colY + calculatedGroupH > branchMaxColBottom) {
        branchMaxColBottom = colY + calculatedGroupH;
      }

      colX += GROUP_WIDTH + COL_GAP_X;
    });

    const branchHeight = (branchMaxColBottom - currentBranchY) + MACRO_BOTTOM_PAD_Y;
    if (currentBranchY + branchHeight > rowMaxBottom) {
      rowMaxBottom = currentBranchY + branchHeight;
    }

    currentBranchX += branchBlockWidth + COL_GAP_X;
  });

  // Create parent macro-group shapes enclosing their child sections
  const macroGroups: ComputedGroupLayout[] = [];

  if (parentHeadings && parentHeadings.length > 0) {
    // Only pure macro parents (modules that don't have direct tasks as leaf columns themselves)
    const pureParents = parentHeadings.filter(
      (ph) => !parsedGroups.some((g) => g.id === ph.id)
    );

    const sortedParents = [...pureParents].sort((a, b) => (b.level || 1) - (a.level || 1));

    sortedParents.forEach((ph) => {
      const directChildren = [...leafGroups, ...macroGroups].filter((s) => {
        if (ph.level === 2 && s.branchTitle && s.branchTitle.toLowerCase() === ph.title.toLowerCase()) {
          return true;
        }
        if (s.parentId && ph.id && s.parentId === ph.id) {
          return true;
        }
        const ptMatches = (s.parentTitle || '').trim().toLowerCase() === ph.title.trim().toLowerCase();
        if (ptMatches) return true;
        return false;
      });

      if (directChildren.length === 0) return;

      const minX = Math.min(...directChildren.map((s) => s.x));
      const minY = Math.min(...directChildren.map((s) => s.y));
      const maxRight = Math.max(...directChildren.map((s) => s.x + s.w));
      const maxBottom = Math.max(...directChildren.map((s) => s.y + s.h));

      const totalTasks = directChildren.reduce((sum, s) => sum + (s.count || 0), 0);
      const completedTasks = directChildren.reduce((sum, s) => sum + (s.completedCount || 0), 0);

      const calcX = minX - MACRO_PAD_X;
      const calcY = minY - MACRO_HEADER_PAD_Y;
      const calcW = (maxRight - minX) + MACRO_PAD_X * 2;
      const calcH = (maxBottom - minY) + MACRO_HEADER_PAD_Y + MACRO_BOTTOM_PAD_Y;

      macroGroups.push({
        id: ph.id,
        title: ph.title,
        x: calcX,
        y: calcY,
        w: calcW,
        h: calcH,
        count: totalTasks,
        completedCount: completedTasks,
        level: ph.level || 1,
        parentTitle: ph.parentTitle,
        parentId: ph.parentId,
        headingId: ph.id,
        branchTitle: ph.branchTitle,
        path: ph.path,
        isContainer: true,
        color: ph.color,
      });
    });
  }

  // Outermost containers first in array
  macroGroups.sort((a, b) => (a.level || 1) - (b.level || 1));

  return {
    tasks: computedTasks,
    groups: [...macroGroups, ...leafGroups],
  };
}

/**
 * Automatically reorganizes the Canvas autonomously:
 * - Keeps container borders and padding strictly respected.
 * - Prevents any overlapping between tasks or sections.
 * - Strictly maintains each task within its exact section group.
 */
export function applyAutoLayout(editor: Editor, markdown: string): AutoLayoutResult {
  setCanvasPopulatingFromMarkdown(true);
  try {
    const computed = computeAutoLayout(markdown);

    if (computed.tasks.length === 0 && computed.groups.length === 0) {
      return { taskCount: 0, groupCount: 0 };
    }

  const existingShapes = editor.getCurrentPageShapes();
  const existingTaskShapes = existingShapes.filter((s) => (s as any).type === 'task') as any[];
  const existingGroupShapes = existingShapes.filter((s) => (s as any).type === 'task-group') as any[];

  // Index existing tasks by normalized taskId and fallback by title + group
  const taskShapeMap = new Map<string, any>();
  const taskShapeByTitleAndGroup = new Map<string, any>();
  const matchedTaskShapeIds = new Set<string>();

  existingTaskShapes.forEach((s) => {
    const tid = s.props?.taskId;
    if (tid) {
      taskShapeMap.set(tid.toLowerCase(), s);
    }
    const titleKey = `${(s.props?.title || '').trim().toLowerCase()}::${(s.props?.groupTitle || '').trim().toLowerCase()}`;
    if (!taskShapeByTitleAndGroup.has(titleKey)) {
      taskShapeByTitleAndGroup.set(titleKey, s);
    }
  });

  // Index existing group shapes by headingId + isContainer and key
  const groupShapeByHeadingAndContainer = new Map<string, any>();
  const groupShapeByKey = new Map<string, any>();
  const matchedGroupShapeIds = new Set<string>();

  existingGroupShapes.forEach((g) => {
    const hId = g.props?.headingId;
    const isCont = Boolean(g.props?.isContainer);
    if (hId) {
      groupShapeByHeadingAndContainer.set(`${hId}::${isCont}`, g);
    }
    const key = `${(g.props?.branchTitle || '').toLowerCase()}::${(g.props?.title || '').toLowerCase()}::${isCont}`;
    if (!groupShapeByKey.has(key)) {
      groupShapeByKey.set(key, g);
    }
  });

  const updates: any[] = [];
  const shapesToCreate: any[] = [];

  // 1. Update or create task-group shapes
  computed.groups.forEach((g) => {
    let existingShape: any = null;
    const isCont = Boolean(g.isContainer);
    if (g.headingId) {
      const matchKey = `${g.headingId}::${isCont}`;
      if (groupShapeByHeadingAndContainer.has(matchKey)) {
        existingShape = groupShapeByHeadingAndContainer.get(matchKey);
      }
    }
    if (!existingShape) {
      const key = `${(g.branchTitle || '').toLowerCase()}::${g.title.toLowerCase()}::${isCont}`;
      const candidate = groupShapeByKey.get(key);
      if (candidate && !matchedGroupShapeIds.has(candidate.id)) {
        existingShape = candidate;
      }
    }

    if (existingShape) {
      matchedGroupShapeIds.add(existingShape.id);
      updates.push({
        id: existingShape.id,
        type: 'task-group',
        x: g.x,
        y: g.y,
        props: {
          ...existingShape.props,
          w: g.w,
          h: g.h,
          title: g.title,
          count: g.count,
          completedCount: g.completedCount,
          level: g.level,
          parentTitle: g.parentTitle,
          parentId: g.parentId,
          headingId: g.headingId,
          branchTitle: g.branchTitle,
          path: g.path,
          isContainer: g.isContainer,
          color: g.color || existingShape.props?.color,
        },
      });
    } else {
      shapesToCreate.push({
        id: createShapeId(),
        type: 'task-group' as const,
        x: g.x,
        y: g.y,
        props: {
          w: g.w,
          h: g.h,
          title: g.title,
          count: g.count,
          completedCount: g.completedCount,
          level: g.level,
          parentTitle: g.parentTitle,
          parentId: g.parentId,
          headingId: g.headingId,
          branchTitle: g.branchTitle,
          path: g.path,
          isContainer: g.isContainer,
          color: g.color,
        },
      });
    }
  });

  // 2. Update or create task shapes
  computed.tasks.forEach((t) => {
    let existingTask: any = null;
    if (t.taskId && taskShapeMap.has(t.taskId.toLowerCase())) {
      const candidate = taskShapeMap.get(t.taskId.toLowerCase());
      if (!matchedTaskShapeIds.has(candidate.id)) {
        existingTask = candidate;
      }
    }
    if (!existingTask) {
      const titleKey = `${t.title.trim().toLowerCase()}::${t.groupTitle.trim().toLowerCase()}`;
      const candidate = taskShapeByTitleAndGroup.get(titleKey);
      if (candidate && !matchedTaskShapeIds.has(candidate.id)) {
        existingTask = candidate;
      }
    }

    if (existingTask) {
      matchedTaskShapeIds.add(existingTask.id);
      updates.push({
        id: existingTask.id,
        type: 'task',
        x: t.x,
        y: t.y,
        props: {
          ...existingTask.props,
          w: t.w,
          h: t.h,
          description: t.description !== undefined ? t.description : existingTask.props?.description,
          groupTitle: t.groupTitle,
          branchTitle: t.branchTitle,
          groupHeadingId: t.groupHeadingId,
        },
      });
    } else {
      shapesToCreate.push({
        id: createShapeId(),
        type: 'task' as const,
        x: t.x,
        y: t.y,
        props: {
          w: t.w,
          h: t.h,
          title: t.title,
          completed: false,
          priority: 'P3',
          taskId: t.taskId,
          status: 'todo',
          description: t.description,
          groupTitle: t.groupTitle,
          branchTitle: t.branchTitle,
          groupHeadingId: t.groupHeadingId,
        },
      });
    }
  });

  // 3. Remove shapes that no longer exist in the document (orphaned from previous manual edits or deletes)
  const shapesToDelete: TLShapeId[] = [];
  existingTaskShapes.forEach((s) => {
    if (!matchedTaskShapeIds.has(s.id)) {
      shapesToDelete.push(s.id);
    }
  });
  existingGroupShapes.forEach((g) => {
    if (!matchedGroupShapeIds.has(g.id)) {
      shapesToDelete.push(g.id);
    }
  });

  if (shapesToDelete.length > 0) {
    editor.deleteShapes(shapesToDelete);
  }

  if (updates.length > 0) {
    editor.updateShapes(updates);
  }

  if (shapesToCreate.length > 0) {
    editor.createShapes(shapesToCreate);
  }

  // Smoothly center and fit the newly organized layout in viewport
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 300 } });
  }, 50);

    return {
      taskCount: computed.tasks.length,
      groupCount: computed.groups.length,
    };
  } finally {
    setTimeout(() => {
      setCanvasPopulatingFromMarkdown(false);
    }, 150);
  }
}
