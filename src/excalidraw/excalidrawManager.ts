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
export const CARD_HEIGHT = 92;
export const GROUP_PADDING_X = 20;
export const GROUP_PADDING_TOP = 64;
export const GROUP_PADDING_BOTTOM = 20;
export const GROUP_GAP_X = 48;
export const TASK_GAP_Y = 14;

export function getPriorityTextColor(priority?: TaskPriority): string {
  switch (priority) {
    case 'P0':
      return '#f85149'; // Red
    case 'P1':
      return '#e3b341'; // Amber / Orange
    case 'P2':
      return '#58a6ff'; // Blue
    case 'P3':
    default:
      return '#8b949e'; // Gray
  }
}

export function getPriorityStrokeColor(priority?: TaskPriority, isDark = true): string {
  if (isDark) {
    switch (priority) {
      case 'P0':
        return '#f85149';
      case 'P1':
        return '#d29922';
      case 'P2':
        return '#388bfd';
      case 'P3':
      default:
        return '#30363d';
    }
  } else {
    switch (priority) {
      case 'P0':
        return '#cf222e';
      case 'P1':
        return '#9a6700';
      case 'P2':
        return '#0969da';
      case 'P3':
      default:
        return '#d0d7de';
    }
  }
}

export function getPriorityBgColor(priority?: TaskPriority, isDark = true): string {
  if (isDark) {
    return '#161b22';
  } else {
    return '#ffffff';
  }
}

export function getStatusColor(task: ParsedMarkdownTask): string {
  if (task.completed) return '#3fb950'; // Green
  const st = (task.status || 'todo').toLowerCase();
  switch (st) {
    case 'done':
      return '#3fb950';
    case 'in_progress':
    case 'in-progress':
      return '#58a6ff';
    case 'blocked':
      return '#f85149';
    case 'review':
      return '#a371f7';
    case 'todo':
    case 'backlog':
    default:
      return '#e3b341';
  }
}

/**
 * Creates formatted label text for fallback representation.
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
 * Builds full Excalidraw scene elements matching the professional sober dark/light cards design.
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

  // Map from normalized taskId -> elementId (cardId)
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

  let currentGroupX = 60;
  const GROUP_START_Y = 60;
  let seedCounter = 1000;

  groups.forEach((group, gIdx) => {
    const groupTitle = group.title;
    const taskCount = group.tasks.length;
    const completedCount = group.tasks.filter((t) => t.completed).length;
    const groupSaved = savedGroupMap.get(groupTitle.toLowerCase());

    const groupWidth = groupSaved?.width || 360;
    const defaultCalculatedHeight = Math.max(
      200,
      GROUP_PADDING_TOP + taskCount * CARD_HEIGHT + Math.max(0, taskCount - 1) * TASK_GAP_Y + GROUP_PADDING_BOTTOM
    );
    const groupHeight = groupSaved?.height || defaultCalculatedHeight;
    const groupX = groupSaved?.x !== undefined ? groupSaved.x : currentGroupX;
    const groupY = groupSaved?.y !== undefined ? groupSaved.y : GROUP_START_Y;

    const groupElementId = `group_${gIdx}_${groupTitle.replace(/\s+/g, '_')}`;
    const groupHeaderId = `header_${groupElementId}`;
    const groupStatsId = `stats_${groupElementId}`;

    // 1. Group Container Rectangle (Sleek dark card frame)
    elements.push({
      id: groupElementId,
      type: 'rectangle',
      x: groupX,
      y: groupY,
      width: groupWidth,
      height: groupHeight,
      angle: 0,
      strokeColor: isDark ? '#21262d' : '#d0d7de',
      backgroundColor: isDark ? '#0d1117' : '#f6f8fa',
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

    // 2. Group Header Title Text (## Section Title)
    elements.push({
      id: groupHeaderId,
      type: 'text',
      x: groupX + 20,
      y: groupY + 20,
      width: 190,
      height: 24,
      angle: 0,
      strokeColor: isDark ? '#f0f6fc' : '#1f2328',
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
      text: `## ${groupTitle}`,
      fontSize: 15,
      fontFamily: 2, // Helvetica / Sans-serif
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      originalText: `## ${groupTitle}`,
      lineHeight: 1.25,
      customData: {
        type: 'group_header',
        groupTitle,
      },
    });

    // 3. Group Header Stats Text (1/3 completed or 3 tasks)
    const statsText = completedCount > 0 ? `${completedCount}/${taskCount} completed` : `${taskCount} tasks`;
    elements.push({
      id: groupStatsId,
      type: 'text',
      x: groupX + groupWidth - 145,
      y: groupY + 22,
      width: 125,
      height: 20,
      angle: 0,
      strokeColor: isDark ? '#8b949e' : '#656d76',
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
      text: statsText,
      fontSize: 13,
      fontFamily: 2,
      textAlign: 'right',
      verticalAlign: 'top',
      containerId: null,
      originalText: statsText,
      lineHeight: 1.25,
      customData: {
        type: 'group_stats',
        groupTitle,
      },
    });

    // 4. Task Cards within Group
    let currentTaskY = groupY + GROUP_PADDING_TOP;

    group.tasks.forEach((task, tIdx) => {
      const normalizedTaskId = task.taskId ? task.taskId.toLowerCase() : `temp_${gIdx}_${tIdx}`;
      const savedTask = task.taskId ? savedTaskMap.get(task.taskId.toLowerCase()) : undefined;

      const taskX = savedTask?.x !== undefined ? savedTask.x : groupX + GROUP_PADDING_X;
      const taskY = savedTask?.y !== undefined ? savedTask.y : currentTaskY;
      const taskW = savedTask?.width || CARD_WIDTH;
      const taskH = savedTask?.height || CARD_HEIGHT;

      const cardId = `task_card_${normalizedTaskId}`;
      const checkId = `task_check_${normalizedTaskId}`;
      const checkIconId = `task_check_icon_${normalizedTaskId}`;
      const titleId = `task_title_${normalizedTaskId}`;
      const prioId = `task_prio_${normalizedTaskId}`;
      const tagsId = `task_tags_${normalizedTaskId}`;
      const statusId = `task_status_${normalizedTaskId}`;

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

      const strokeColor = isDark
        ? task.completed
          ? '#21262d'
          : '#30363d'
        : '#d0d7de';
      const bgColor = isDark ? '#161b22' : '#ffffff';

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

      const cardGroupIds = [groupElementId, cardId];

      // A. Task Card Background Rectangle
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
        strokeWidth: 1.2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 80 : 100,
        groupIds: cardGroupIds,
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
        customData: taskMeta,
      });

      // B. Checkbox Box
      elements.push({
        id: checkId,
        type: 'rectangle',
        x: taskX + 14,
        y: taskY + 16,
        width: 16,
        height: 16,
        angle: 0,
        strokeColor: task.completed ? '#388bfd' : isDark ? '#3d444d' : '#8c959f',
        backgroundColor: task.completed ? '#1f6feb' : isDark ? '#21262d' : '#f6f8fa',
        fillStyle: 'solid',
        strokeWidth: 1.5,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 85 : 100,
        groupIds: cardGroupIds,
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
        customData: { type: 'task_checkbox', taskId: taskMeta.taskId },
      });

      // If completed, add checkmark text inside checkbox
      if (task.completed) {
        elements.push({
          id: checkIconId,
          type: 'text',
          x: taskX + 16,
          y: taskY + 16,
          width: 12,
          height: 14,
          angle: 0,
          strokeColor: '#ffffff',
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          strokeWidth: 1,
          strokeStyle: 'solid',
          roughness: 0,
          opacity: 100,
          groupIds: cardGroupIds,
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
          text: '✓',
          fontSize: 12,
          fontFamily: 2,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: null,
          originalText: '✓',
          lineHeight: 1,
          customData: { type: 'task_check_icon', taskId: taskMeta.taskId },
        });
      }

      // C. Task Title Text
      const titleColor = isDark
        ? task.completed
          ? '#7d8590'
          : '#e6edf3'
        : task.completed
        ? '#8c959f'
        : '#1f2328';

      elements.push({
        id: titleId,
        type: 'text',
        x: taskX + 40,
        y: taskY + 14,
        width: 165,
        height: 42,
        angle: 0,
        strokeColor: titleColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 80 : 100,
        groupIds: cardGroupIds,
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
        text: task.title,
        fontSize: 13,
        fontFamily: 2, // Helvetica / Sans-serif
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        originalText: task.title,
        lineHeight: 1.25,
        customData: { type: 'task_title', taskId: taskMeta.taskId },
      });

      // D. Priority Pill & Options Icons (● P0  🔗  ⋮)
      const prioColor = getPriorityTextColor(task.priority);
      const prioText = `● ${task.priority || 'P1'}  🔗  ⋮`;

      elements.push({
        id: prioId,
        type: 'text',
        x: taskX + 210,
        y: taskY + 15,
        width: 96,
        height: 18,
        angle: 0,
        strokeColor: prioColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 80 : 100,
        groupIds: cardGroupIds,
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
        text: prioText,
        fontSize: 12,
        fontFamily: 2,
        textAlign: 'right',
        verticalAlign: 'top',
        containerId: null,
        originalText: prioText,
        lineHeight: 1.2,
        customData: { type: 'task_prio', taskId: taskMeta.taskId },
      });

      // E. Tags / Dependencies info on bottom-left
      let tagsText = '';
      if (task.tags && task.tags.length > 0) {
        tagsText = task.tags.map((t) => `#${t}`).join(' ');
      }
      if (task.blockedBy) {
        const blockerTag = `🔒 #${task.blockedBy}`;
        tagsText = tagsText ? `${tagsText}  ${blockerTag}` : blockerTag;
      }
      if (!tagsText) {
        tagsText = `#${task.taskId || 'task'}`;
      }

      elements.push({
        id: tagsId,
        type: 'text',
        x: taskX + 14,
        y: taskY + 65,
        width: 200,
        height: 16,
        angle: 0,
        strokeColor: task.blockedBy ? '#e3b341' : isDark ? '#58a6ff' : '#0969da',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 75 : 100,
        groupIds: cardGroupIds,
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
        text: tagsText,
        fontSize: 11,
        fontFamily: 3, // Cascadia / Monospace
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        originalText: tagsText,
        lineHeight: 1.2,
        customData: { type: 'task_tags', taskId: taskMeta.taskId },
      });

      // F. Status on bottom-right (TODO / IN_PROGRESS / DONE / BLOCKED)
      const statusText = (task.completed ? 'DONE' : task.status || 'TODO').toUpperCase();
      const statusColor = getStatusColor(task);

      elements.push({
        id: statusId,
        type: 'text',
        x: taskX + 220,
        y: taskY + 65,
        width: 86,
        height: 16,
        angle: 0,
        strokeColor: statusColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: task.completed ? 75 : 100,
        groupIds: cardGroupIds,
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
        text: statusText,
        fontSize: 11,
        fontFamily: 3, // Cascadia / Monospace
        textAlign: 'right',
        verticalAlign: 'top',
        containerId: null,
        originalText: statusText,
        lineHeight: 1.2,
        customData: { type: 'task_status', taskId: taskMeta.taskId },
      });

      currentTaskY += taskH + TASK_GAP_Y;
    });

    if (groupSaved?.x === undefined) {
      currentGroupX += groupWidth + GROUP_GAP_X;
    }
  });

  // 5. Dependency Arrows with Smart Port Routing
  tasksWithDependencies.forEach(({ blockedTaskId, blockedElementId, blockerIds }) => {
    blockerIds.forEach((blockerId) => {
      const blockerElementId = taskIdToElementId.get(blockerId);
      if (!blockerElementId || blockerElementId === blockedElementId) return;

      const blockerElem = elements.find((e) => e.id === blockerElementId);
      const blockedElem = elements.find((e) => e.id === blockedElementId);
      if (!blockerElem || !blockedElem) return;

      let startX: number;
      let startY: number;
      let endX: number;
      let endY: number;

      // Smart directional anchor calculation
      if (blockerElem.x + blockerElem.width <= blockedElem.x + 40) {
        // Horizontal connection: Blocker (left) -> Blocked (right)
        startX = blockerElem.x + blockerElem.width;
        startY = blockerElem.y + blockerElem.height / 2;
        endX = blockedElem.x;
        endY = blockedElem.y + blockedElem.height / 2;
      } else if (blockerElem.y + blockerElem.height <= blockedElem.y + 40) {
        // Vertical connection: Blocker (above) -> Blocked (below)
        startX = blockerElem.x + blockerElem.width / 2;
        startY = blockerElem.y + blockerElem.height;
        endX = blockedElem.x + blockedElem.width / 2;
        endY = blockedElem.y;
      } else {
        // Fallback smooth routing
        startX = blockerElem.x + blockerElem.width;
        startY = blockerElem.y + blockerElem.height / 2;
        endX = blockedElem.x;
        endY = blockedElem.y + blockedElem.height / 2;
      }

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
        strokeColor: isDark ? '#7d8590' : '#8c959f',
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

  let currentGroupX = 60;
  const GROUP_START_Y = 60;
  const positionDeltas = new Map<string, { dx: number; dy: number }>();
  const groupPositionUpdates = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const [groupTitle, tasks] of tasksByGroup.entries()) {
    if (tasks.length === 0) {
      const grpElem = groupElementsMap.get(groupTitle.toLowerCase());
      if (grpElem) {
        groupPositionUpdates.set(grpElem.id, {
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
      ranksep: 36,
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
    const groupHeight = Math.max(200, contentHeight + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM);

    const groupX = currentGroupX;
    const groupY = GROUP_START_Y;

    const grpElem = groupElementsMap.get(groupTitle.toLowerCase());
    if (grpElem) {
      groupPositionUpdates.set(grpElem.id, {
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

        const dx = taskX - cardElem.x;
        const dy = taskY - cardElem.y;

        positionDeltas.set(cardElem.id, { dx, dy });
      }
    });

    currentGroupX += groupWidth + GROUP_GAP_X;
  }

  // Clone elements and apply position changes for cards, groups, and sub-elements
  const updatedElements = elements.map((el) => {
    // 1. Group containers
    const grpUpdate = groupPositionUpdates.get(el.id);
    if (grpUpdate) {
      return {
        ...el,
        x: grpUpdate.x,
        y: grpUpdate.y,
        width: grpUpdate.w,
        height: grpUpdate.h,
        version: (el.version || 1) + 1,
        versionNonce: Date.now(),
      };
    }

    // 2. Group headers
    if (el.customData?.type === 'group_header' || el.customData?.type === 'group_stats') {
      const gtitle = el.customData.groupTitle?.toLowerCase();
      const grpElem = groupElementsMap.get(gtitle);
      if (grpElem) {
        const grpPos = groupPositionUpdates.get(grpElem.id);
        if (grpPos) {
          const isStats = el.customData.type === 'group_stats';
          return {
            ...el,
            x: isStats ? grpPos.x + grpPos.w - 145 : grpPos.x + 20,
            y: isStats ? grpPos.y + 22 : grpPos.y + 20,
            version: (el.version || 1) + 1,
            versionNonce: Date.now(),
          };
        }
      }
    }

    // 3. Task cards and grouped sub-elements
    const parentCardId = el.groupIds?.find((gid: string) => gid.startsWith('task_card_'));
    if (parentCardId) {
      const delta = positionDeltas.get(parentCardId);
      if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
        return {
          ...el,
          x: el.x + delta.dx,
          y: el.y + delta.dy,
          version: (el.version || 1) + 1,
          versionNonce: Date.now(),
        };
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
