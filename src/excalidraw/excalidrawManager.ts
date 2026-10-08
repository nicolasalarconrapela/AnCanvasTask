import type {
  CanvasVisualDocument,
  TaskVisualState,
  GroupVisualState,
} from '../services/sanityService';
import {
  ParsedGroup,
  ParsedMarkdownTask,
  TaskPriority,
  TaskStatus,
} from '../shapes/TaskShapeUtil';
import { scanTaskBlocks, validateMarkdownDocument } from '../utils/markdownSync';
import dagre from 'dagre';
export { connectExcalidrawTasksWithArrow } from '../utils/taskConnectionManager';

export interface ExcalidrawTaskMetadata {
  type: 'task';
  taskId: string;
  temporaryId?: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  groupTitle?: string;
  tags?: string[];
  subtasks?: { total: number; completed: number };
  blockedBy?: string;
  isDuplicateId?: boolean;
  hasMissingId?: boolean;
  unresolvedBlockers?: string[];
}

export interface ExcalidrawGroupMetadata {
  type: 'group';
  groupTitle: string;
}

export interface ExcalidrawNoteMetadata {
  type: 'note';
  noteId: string;
  color: string;
}

export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 110;
export const GROUP_PADDING_X = 24;
export const GROUP_PADDING_TOP = 64;
export const GROUP_PADDING_BOTTOM = 24;
export const GROUP_GAP_X = 48;

export function getPriorityStrokeColor(priority?: TaskPriority, isDark = true): string {
  switch (priority) {
    case 'P0':
      return '#ef4444'; // Red
    case 'P1':
      return '#f59e0b'; // Amber / Orange
    case 'P2':
      return '#3b82f6'; // Blue
    case 'P3':
    default:
      return isDark ? '#475569' : '#94a3b8'; // Slate
  }
}

export function getPriorityBgColor(priority?: TaskPriority, isDark = true): string {
  if (isDark) {
    switch (priority) {
      case 'P0':
        return '#261214';
      case 'P1':
        return '#271b0e';
      case 'P2':
        return '#132137';
      case 'P3':
      default:
        return '#161b22';
    }
  } else {
    switch (priority) {
      case 'P0':
        return '#fef2f2';
      case 'P1':
        return '#fffbeb';
      case 'P2':
        return '#eff6ff';
      case 'P3':
      default:
        return '#f8fafc';
    }
  }
}

/**
 * Creates formatted label text for a task card in Excalidraw.
 */
export function formatTaskCardText(task: ParsedMarkdownTask): string {
  const check = task.completed ? '[x]' : '[ ]';
  const idBadge = task.taskId ? ` #${task.taskId}` : '';
  const prio = task.priority ? ` [${task.priority}]` : '';
  const statusBadge = task.status && task.status !== 'todo' && task.status !== 'done' ? ` (${task.status})` : '';
  const tagList = task.tags && task.tags.length > 0 ? `\n🏷️ ${task.tags.map((t) => `#${t}`).join(' ')}` : '';
  const blockerInfo = task.blockedBy ? `\n⛔ Blocker: ${task.blockedBy}` : '';
  const subtaskInfo = task.subtasks && task.subtasks.total > 0 ? `\n☑️ ${task.subtasks.completed}/${task.subtasks.total}` : '';

  return `${check} ${task.title}${idBadge}${prio}${statusBadge}${tagList}${blockerInfo}${subtaskInfo}`;
}

/**
 * Builds full Excalidraw scene elements from parsed groups and tasks.
 */
export function buildExcalidrawElementsFromTasks(
  groups: ParsedGroup[],
  savedVisualState?: CanvasVisualDocument | null,
  rawMarkdown?: string,
  isDark = true
): any[] {
  const elements: any[] = [];
  const validationReport = rawMarkdown ? validateMarkdownDocument(rawMarkdown) : null;
  const duplicateIds = validationReport?.duplicateIds || new Set<string>();
  const missingIdTaskIds = validationReport?.missingIdTaskIds || new Set<string>();
  const unresolvedBlockerMap = validationReport?.unresolvedBlockerMap || new Map<string, string[]>();

  // Map from normalized taskId -> elementId
  const taskIdToElementId = new Map<string, string>();
  const tasksWithDependencies: Array<{
    blockedTaskId: string;
    blockedElementId: string;
    blockerIds: string[];
  }> = [];

  // Index saved visual state
  const savedTaskMap = new Map<string, TaskVisualState>();
  if (savedVisualState?.tasks) {
    for (const t of savedVisualState.tasks) {
      if (t.taskId) {
        savedTaskMap.set(t.taskId.toLowerCase(), t);
      }
    }
  }

  const savedGroupMap = new Map<string, GroupVisualState>();
  if (savedVisualState?.groups) {
    for (const g of savedVisualState.groups) {
      if (g.groupTitle) {
        savedGroupMap.set(g.groupTitle.toLowerCase(), g);
      }
    }
  }

  let currentGroupX = 80;
  const GROUP_START_Y = 80;
  let seedCounter = 1000;

  groups.forEach((group, gIdx) => {
    const groupTitle = group.title;
    const taskCount = group.tasks.length;
    const groupSaved = savedGroupMap.get(groupTitle.toLowerCase());

    const groupWidth = groupSaved?.width || 360;
    const defaultCalculatedHeight = Math.max(
      220,
      GROUP_PADDING_TOP + taskCount * CARD_HEIGHT + Math.max(0, taskCount - 1) * 16 + GROUP_PADDING_BOTTOM
    );
    const groupHeight = groupSaved?.height || defaultCalculatedHeight;
    const groupX = groupSaved?.x !== undefined ? groupSaved.x : currentGroupX;
    const groupY = groupSaved?.y !== undefined ? groupSaved.y : GROUP_START_Y;

    const groupElementId = `group_${gIdx}_${groupTitle.replace(/\s+/g, '_')}`;
    const groupHeaderId = `header_${groupElementId}`;

    // 1. Group Container Rectangle
    elements.push({
      id: groupElementId,
      type: 'rectangle',
      x: groupX,
      y: groupY,
      width: groupWidth,
      height: groupHeight,
      angle: 0,
      strokeColor: isDark ? '#30363d' : '#cbd5e1',
      backgroundColor: isDark ? '#0d1117' : '#f8fafc',
      fillStyle: 'solid',
      strokeWidth: 1.5,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [groupElementId],
      frameId: null,
      roundness: { type: 3 },
      seed: seedCounter++,
      version: 1,
      versionNonce: seedCounter++,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      customData: {
        type: 'group',
        groupTitle,
      } as ExcalidrawGroupMetadata,
    });

    // 2. Group Header Text
    elements.push({
      id: groupHeaderId,
      type: 'text',
      x: groupX + 16,
      y: groupY + 16,
      width: groupWidth - 32,
      height: 28,
      angle: 0,
      strokeColor: isDark ? '#e6edf3' : '#0f172a',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [groupElementId],
      frameId: null,
      roundness: null,
      seed: seedCounter++,
      version: 1,
      versionNonce: seedCounter++,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text: `## ${groupTitle} (${taskCount})`,
      fontSize: 16,
      fontFamily: 2, // Helvetica / Sans-serif
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      originalText: `## ${groupTitle} (${taskCount})`,
      lineHeight: 1.25,
      customData: {
        type: 'group_header',
        groupTitle,
      },
    });

    // 3. Task Cards within Group
    let currentTaskY = groupY + GROUP_PADDING_TOP;

    group.tasks.forEach((task, tIdx) => {
      const normalizedTaskId = task.taskId ? task.taskId.toLowerCase() : `temp_${gIdx}_${tIdx}`;
      const savedTask = task.taskId ? savedTaskMap.get(task.taskId.toLowerCase()) : undefined;

      const taskX = savedTask?.x !== undefined ? savedTask.x : groupX + GROUP_PADDING_X;
      const taskY = savedTask?.y !== undefined ? savedTask.y : currentTaskY;
      const taskW = savedTask?.width || CARD_WIDTH;
      const taskH = savedTask?.height || CARD_HEIGHT;

      const cardId = `task_card_${normalizedTaskId}`;
      const textId = `task_text_${normalizedTaskId}`;

      taskIdToElementId.set(normalizedTaskId, cardId);

      if (task.blockedBy) {
        const blockerIds = task.blockedBy
          .split(',')
          .map((b) => b.trim().toLowerCase())
          .filter(Boolean);

        if (blockerIds.length > 0) {
          tasksWithDependencies.push({
            blockedTaskId: normalizedTaskId,
            blockedElementId: cardId,
            blockerIds,
          });
        }
      }

      const isDuplicate = Boolean(task.taskId && duplicateIds.has(task.taskId.toLowerCase()));
      const isMissingId = Boolean(!task.taskId && task.temporaryId && missingIdTaskIds.has(task.temporaryId));
      const unresolvedBlockers = task.taskId ? unresolvedBlockerMap.get(task.taskId.toLowerCase()) : undefined;

      const strokeColor = getPriorityStrokeColor(task.priority, isDark);
      const bgColor = getPriorityBgColor(task.priority, isDark);
      const textColor = isDark ? '#f0f6fc' : '#0f172a';

      const taskMeta: ExcalidrawTaskMetadata = {
        type: 'task',
        taskId: task.taskId || task.temporaryId || normalizedTaskId,
        temporaryId: task.temporaryId,
        title: task.title,
        completed: task.completed,
        priority: task.priority || 'P1',
        status: task.status || (task.completed ? 'done' : 'todo'),
        groupTitle,
        tags: task.tags,
        subtasks: task.subtasks,
        blockedBy: task.blockedBy,
        isDuplicateId: isDuplicate,
        hasMissingId: isMissingId,
        unresolvedBlockers,
      };

      const cardText = formatTaskCardText(task);

      // Task Card Box
      elements.push({
        id: cardId,
        type: 'rectangle',
        x: taskX,
        y: taskY,
        width: taskW,
        height: taskH,
        angle: 0,
        strokeColor,
        backgroundColor: bgColor,
        fillStyle: 'solid',
        strokeWidth: 1.5,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 75 : 100,
        groupIds: [groupElementId, cardId],
        frameId: null,
        roundness: { type: 3 },
        seed: seedCounter++,
        version: 1,
        versionNonce: seedCounter++,
        isDeleted: false,
        boundElements: [{ id: textId, type: 'text' }],
        updated: Date.now(),
        link: null,
        locked: false,
        customData: taskMeta,
      });

      // Task Card Inner Text
      elements.push({
        id: textId,
        type: 'text',
        x: taskX + 12,
        y: taskY + 12,
        width: taskW - 24,
        height: taskH - 24,
        angle: 0,
        strokeColor: textColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 75 : 100,
        groupIds: [groupElementId, cardId],
        frameId: null,
        roundness: null,
        seed: seedCounter++,
        version: 1,
        versionNonce: seedCounter++,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        text: cardText,
        fontSize: 14,
        fontFamily: 2, // Helvetica / Sans-serif
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: cardId,
        originalText: cardText,
        lineHeight: 1.35,
        customData: taskMeta,
      });

      currentTaskY += taskH + 16;
    });

    if (groupSaved?.x === undefined) {
      currentGroupX += groupWidth + GROUP_GAP_X;
    }
  });

  // 4. Dependency Arrows
  tasksWithDependencies.forEach(({ blockedTaskId, blockedElementId, blockerIds }) => {
    blockerIds.forEach((blockerId) => {
      const blockerElementId = taskIdToElementId.get(blockerId);
      if (!blockerElementId || blockerElementId === blockedElementId) return;

      const blockerElem = elements.find((e) => e.id === blockerElementId);
      const blockedElem = elements.find((e) => e.id === blockedElementId);
      if (!blockerElem || !blockedElem) return;

      const startX = blockerElem.x + blockerElem.width / 2;
      const startY = blockerElem.y + blockerElem.height;
      const endX = blockedElem.x + blockedElem.width / 2;
      const endY = blockedElem.y;

      const dx = endX - startX;
      const dy = endY - startY;

      const arrowId = `arrow_${blockerId}_to_${blockedTaskId}`;

      elements.push({
        id: arrowId,
        type: 'arrow',
        x: startX,
        y: startY,
        width: Math.abs(dx) || 1,
        height: Math.abs(dy) || 1,
        angle: 0,
        strokeColor: isDark ? '#94a3b8' : '#64748b',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1.5,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 90,
        groupIds: [],
        frameId: null,
        roundness: { type: 2 },
        seed: seedCounter++,
        version: 1,
        versionNonce: seedCounter++,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        points: [
          [0, 0],
          [dx, dy],
        ],
        lastCommittedPoint: [dx, dy],
        startBinding: {
          elementId: blockerElementId,
          focus: 0,
          gap: 4,
        },
        endBinding: {
          elementId: blockedElementId,
          focus: 0,
          gap: 4,
        },
        startArrowhead: null,
        endArrowhead: 'arrow',
        elbowed: true,
        customData: {
          type: 'dependency_arrow',
          fromTaskId: blockerId,
          toTaskId: blockedTaskId,
        },
      });
    });
  });

  return elements;
}

/**
 * Extracts visual positions and dimensions of tasks and groups from Excalidraw elements.
 */
export function extractVisualStateFromExcalidrawElements(elements: readonly any[]): {
  tasks: TaskVisualState[];
  groups: GroupVisualState[];
} {
  const tasks: TaskVisualState[] = [];
  const groups: GroupVisualState[] = [];

  for (const el of elements) {
    if (el.isDeleted) continue;

    const custom = el.customData;
    if (!custom) continue;

    if (custom.type === 'task' && el.type === 'rectangle') {
      const taskId = custom.taskId || custom.temporaryId;
      if (taskId) {
        tasks.push({
          taskId,
          x: el.x,
          y: el.y,
          width: el.width || CARD_WIDTH,
          height: el.height || CARD_HEIGHT,
          groupTitle: custom.groupTitle,
        });
      }
    } else if (custom.type === 'group' && el.type === 'rectangle') {
      const groupTitle = custom.groupTitle;
      if (groupTitle) {
        groups.push({
          groupTitle,
          x: el.x,
          y: el.y,
          width: el.width || 360,
          height: el.height || 220,
        });
      }
    }
  }

  return { tasks, groups };
}

/**
 * Applies Dagre automatic hierarchical layout directly to Excalidraw elements.
 */
export function applyExcalidrawAutoLayout(
  elements: readonly any[],
  markdown: string
): { updatedElements: any[]; taskCount: number; groupCount: number } {
  const { taskBlocks, groupHeadings } = scanTaskBlocks(markdown);

  const taskElementsMap = new Map<string, any>();
  const groupElementsMap = new Map<string, any>();

  elements.forEach((el) => {
    if (el.isDeleted) return;
    if (el.customData?.type === 'task' && el.type === 'rectangle') {
      const tid = el.customData.taskId?.toLowerCase();
      if (tid) taskElementsMap.set(tid, el);
    } else if (el.customData?.type === 'group' && el.type === 'rectangle') {
      const gtitle = el.customData.groupTitle?.toLowerCase();
      if (gtitle) groupElementsMap.set(gtitle, el);
    }
  });

  const tasksByGroup = new Map<string, typeof taskBlocks>();
  groupHeadings.forEach((gh) => {
    tasksByGroup.set(gh.title, []);
  });

  taskBlocks.forEach((tb) => {
    const grp = tb.groupTitle || 'General';
    if (!tasksByGroup.has(grp)) {
      tasksByGroup.set(grp, []);
    }
    tasksByGroup.get(grp)!.push(tb);
  });

  let currentGroupX = 80;
  const GROUP_START_Y = 80;
  const positionUpdates = new Map<string, { x: number; y: number; w?: number; h?: number }>();

  for (const [groupTitle, tasks] of tasksByGroup.entries()) {
    if (tasks.length === 0) {
      const grpElem = groupElementsMap.get(groupTitle.toLowerCase());
      if (grpElem) {
        positionUpdates.set(grpElem.id, {
          x: currentGroupX,
          y: GROUP_START_Y,
          w: 360,
          h: 200,
        });
      }
      currentGroupX += 360 + GROUP_GAP_X;
      continue;
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      nodesep: 24,
      ranksep: 42,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    tasks.forEach((t) => {
      const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
      g.setNode(taskId, { width: CARD_WIDTH, height: CARD_HEIGHT });
    });

    const taskIdsInGroup = new Set(
      tasks.map((t) => (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase())
    );

    tasks.forEach((t) => {
      const blockedTaskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
      if (t.detectedBlockedBy) {
        const blockerIds = t.detectedBlockedBy
          .split(',')
          .map((b) => b.trim().toLowerCase())
          .filter(Boolean);

        blockerIds.forEach((blockerId) => {
          if (taskIdsInGroup.has(blockerId) && blockerId !== blockedTaskId) {
            g.setEdge(blockerId, blockedTaskId);
          }
        });
      }
    });

    dagre.layout(g);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    tasks.forEach((t) => {
      const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
      const node = g.node(taskId);
      if (node) {
        const left = node.x - node.width / 2;
        const top = node.y - node.height / 2;
        const right = left + node.width;
        const bottom = top + node.height;

        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
      }
    });

    if (minX === Infinity) {
      minX = 0;
      maxX = CARD_WIDTH;
      minY = 0;
      maxY = CARD_HEIGHT;
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const groupWidth = Math.max(360, contentWidth + GROUP_PADDING_X * 2);
    const groupHeight = Math.max(220, contentHeight + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM);

    const groupX = currentGroupX;
    const groupY = GROUP_START_Y;

    const grpElem = groupElementsMap.get(groupTitle.toLowerCase());
    if (grpElem) {
      positionUpdates.set(grpElem.id, {
        x: groupX,
        y: groupY,
        w: groupWidth,
        h: groupHeight,
      });
    }

    tasks.forEach((t) => {
      const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
      const node = g.node(taskId);
      const cardElem = taskElementsMap.get(taskId);

      if (cardElem && node) {
        const nodeLeft = node.x - node.width / 2;
        const nodeTop = node.y - node.height / 2;

        const taskX = groupX + GROUP_PADDING_X + (nodeLeft - minX);
        const taskY = groupY + GROUP_PADDING_TOP + (nodeTop - minY);

        positionUpdates.set(cardElem.id, {
          x: taskX,
          y: taskY,
          w: CARD_WIDTH,
          h: CARD_HEIGHT,
        });
      }
    });

    currentGroupX += groupWidth + GROUP_GAP_X;
  }

  // Clone elements and apply position changes
  const updatedElements = elements.map((el) => {
    const pos = positionUpdates.get(el.id);
    if (pos) {
      return {
        ...el,
        x: pos.x,
        y: pos.y,
        width: pos.w || el.width,
        height: pos.h || el.height,
        version: (el.version || 1) + 1,
        versionNonce: Date.now(),
      };
    }

    // If it's a child text element inside a task or group header, position with offset
    if (el.type === 'text' && el.containerId) {
      const containerPos = positionUpdates.get(el.containerId);
      if (containerPos) {
        return {
          ...el,
          x: containerPos.x + 12,
          y: containerPos.y + 12,
          width: (containerPos.w || CARD_WIDTH) - 24,
          height: (containerPos.h || CARD_HEIGHT) - 24,
          version: (el.version || 1) + 1,
          versionNonce: Date.now(),
        };
      }
    }

    // Group header text
    if (el.type === 'text' && el.customData?.type === 'group_header') {
      const gtitle = el.customData.groupTitle?.toLowerCase();
      const grpElem = groupElementsMap.get(gtitle);
      if (grpElem) {
        const grpPos = positionUpdates.get(grpElem.id);
        if (grpPos) {
          return {
            ...el,
            x: grpPos.x + 16,
            y: grpPos.y + 16,
            width: (grpPos.w || 360) - 32,
            version: (el.version || 1) + 1,
            versionNonce: Date.now(),
          };
        }
      }
    }

    return el;
  });

  return {
    updatedElements,
    taskCount: taskElementsMap.size,
    groupCount: groupElementsMap.size,
  };
}
