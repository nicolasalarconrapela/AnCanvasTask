import type { TaskPriority, TaskStatus } from './taskMarkdown';

export interface SubtaskItem {
  title: string;
  completed: boolean;
}

export interface TaskUpdatePayload {
  id?: string;
  title?: string;
  completed?: boolean;
  priority?: TaskPriority;
  status?: string;
  description?: string;
  tags?: string[];
  blockedBy?: string;
  subtasks?: {
    total?: number;
    completed?: number;
    items?: SubtaskItem[];
  };
}

export interface TaskBlockInfo {
  taskLineIndex: number;
  endLineIndex: number;
  rawTaskLine: string;
  detectedId?: string;
  temporaryId: string;
  detectedTitle: string;
  detectedPriority?: TaskPriority;
  rawPriority?: string;
  detectedBlockedBy?: string;
  detectedStatus?: string;
  detectedDescription?: string;
  detectedTags?: string[];
  detectedSubtasks?: {
    total: number;
    completed: number;
    items?: SubtaskItem[];
  };
  unknownMetadata: Array<{ key: string; rawLine: string }>;
  groupTitle: string;
  headingId?: string;
  headingLineIndex?: number;
  branchTitle?: string;
  groupPath?: string;
  isOutsideHeading: boolean;
  indentation: string;
}

export type MarkdownIssueSeverity = 'warning' | 'error' | 'info';

export type MarkdownIssueType =
  | 'missing_id'
  | 'duplicate_id'
  | 'unresolved_blocker'
  | 'invalid_priority'
  | 'missing_status'
  | 'invalid_status'
  | 'unknown_metadata'
  | 'task_outside_heading'
  | 'empty_heading';

export interface MarkdownIssue {
  id: string;
  type: MarkdownIssueType;
  severity: MarkdownIssueSeverity;
  message: string;
  taskId?: string;
  taskTitle?: string;
  groupTitle?: string;
  lineIndex?: number;
  details?: string;
}

export interface MarkdownValidationReport {
  issues: MarkdownIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  duplicateIds: Set<string>;
  missingIdTaskIds: Set<string>;
  missingStatusTaskIds: Set<string>;
  unresolvedBlockerMap: Map<string, string[]>; // taskId -> missing blocker IDs
}

export interface GroupHeadingInfo {
  id?: string;
  title: string;
  lineIndex: number;
  level?: number;
  parentTitle?: string;
  parentId?: string;
  branchTitle?: string;
  path?: string;
  color?: string;
  isParent?: boolean;
  hasDirectTasks?: boolean;
}

export interface ParentHeadingInfo {
  id?: string;
  title: string;
  lineIndex: number;
  level?: number;
  parentTitle?: string;
  parentId?: string;
  branchTitle?: string;
  path?: string;
  color?: string;
  hasDirectTasks?: boolean;
}

/**
 * Parses all task blocks and their associated groups from a Markdown string,
 * detecting unknown metadata, headings, and lines without modifying the document.
 */
export function scanTaskBlocks(markdown: string): {
  taskBlocks: TaskBlockInfo[];
  groupHeadings: GroupHeadingInfo[];
  parentHeadings: ParentHeadingInfo[];
} {
  const lines = markdown.split(/\r?\n/);
  const taskBlocks: TaskBlockInfo[] = [];
  const groupHeadings: GroupHeadingInfo[] = [];
  const parentHeadings: ParentHeadingInfo[] = [];

  interface ExtendedRawHeading {
    id: string;
    title: string;
    lineIndex: number;
    level: number;
    parentTitle?: string;
    parentId?: string;
    branchTitle?: string;
    path: string;
    color?: string;
  }

  const rawHeadings: ExtendedRawHeading[] = [];
  const headingStack: ExtendedRawHeading[] = [];
  let currentHeading: ExtendedRawHeading | null = null;
  let currentGroup = '';
  let currentBlock: TaskBlockInfo | null = null;
  let taskCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for Markdown headings: "# Heading" (Level 1) up to "###### Heading" (Level 6)
    const headingMatch = trimmed.match(/^([#]{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentBlock) {
        currentBlock.endLineIndex = i - 1;
        taskBlocks.push(currentBlock);
        currentBlock = null;
      }
      const level = headingMatch[1].length;
      let rawHeadingText = headingMatch[2].trim();
      let color: string | undefined = undefined;

      const colorMatch = rawHeadingText.match(/(?:<!--\s*color:\s*([a-zA-Z0-9_-]+)\s*-->|\[color:\s*([a-zA-Z0-9_-]+)\])/i);
      if (colorMatch) {
        color = (colorMatch[1] || colorMatch[2]).toLowerCase();
        rawHeadingText = rawHeadingText.replace(/(?:<!--\s*color:\s*([a-zA-Z0-9_-]+)\s*-->|\[color:\s*([a-zA-Z0-9_-]+)\])/i, '').trim();
      }
      const title = rawHeadingText;

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      const parent = headingStack.length > 0 ? headingStack[headingStack.length - 1] : undefined;
      const parentTitle = parent ? parent.title : undefined;
      const parentId = parent ? parent.id : undefined;

      // branchTitle: ancestor at level 2 (##) or if none, level 1 or self
      let branchTitle = title;
      if (level > 2) {
        const l2 = headingStack.find((h) => h.level === 2);
        if (l2) branchTitle = l2.title;
        else if (parent) branchTitle = parent.branchTitle || parent.title;
      }

      const pathParts = headingStack.map((h) => h.title);
      pathParts.push(title);
      const path = pathParts.join(' > ');

      const newHeading: ExtendedRawHeading = {
        id: `h_${i}`,
        title,
        lineIndex: i,
        level,
        parentTitle,
        parentId,
        branchTitle,
        path,
        color,
      };

      headingStack.push(newHeading);
      rawHeadings.push(newHeading);
      currentHeading = newHeading;
      currentGroup = title;
      continue;
    }

    // Check for task item: "- [ ] Title" or "- [x] Title"
    // Indented checkbox lines under an active task block are subtasks, not root tasks
    const isIndented = line.startsWith(' ') || line.startsWith('\t');
    const isMetadataLine =
      Boolean(currentBlock) &&
      /^(?:\s*[-*]\s*(?:\[[ xX]\]\s*)?)?(?:ID|Priority|Status|Description|Descripci[oó]n|Desc|Tags?|Blocked\s*(?:by|-by)?)\s*:/i.test(trimmed);
    const taskMatch = line.match(/^(\s*[-*]\s*\[)([ xX])(\]\s*)(.*)$/);
    if (taskMatch && (!currentBlock || !isIndented) && !isMetadataLine) {
      if (currentBlock) {
        currentBlock.endLineIndex = i - 1;
        taskBlocks.push(currentBlock);
      }
      taskCounter++;
      currentBlock = {
        taskLineIndex: i,
        endLineIndex: i,
        rawTaskLine: line,
        temporaryId: `temp-task-${taskCounter}`,
        detectedTitle: taskMatch[4].trim(),
        unknownMetadata: [],
        headingId: currentHeading ? currentHeading.id : undefined,
        headingLineIndex: currentHeading ? currentHeading.lineIndex : undefined,
        groupTitle: currentGroup || 'General',
        groupPath: currentHeading ? currentHeading.path : 'General',
        branchTitle: currentHeading ? currentHeading.branchTitle : 'General',
        isOutsideHeading: !currentGroup,
        indentation: taskMatch[1].match(/^\s*/)?.[0] || '',
      };
      continue;
    }

    // Inside a task block: detect metadata or unknown metadata lines
    if (currentBlock) {
      // Sub-bullet or key-value metadata under task
      const isSubLine =
        line.startsWith(' ') ||
        line.startsWith('\t') ||
        trimmed.startsWith('-') ||
        trimmed.startsWith('*') ||
        isMetadataLine;

      if (isSubLine && trimmed.length > 0) {
        const idMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?ID\s*:\s*(.+)$/i);
        if (idMatch) {
          currentBlock.detectedId = idMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const priorityMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?Priority\s*:\s*(.+)$/i);
        if (priorityMatch) {
          const rawP = priorityMatch[1].trim();
          currentBlock.rawPriority = rawP;
          const upperP = rawP.toUpperCase();
          if (['P0', 'P1', 'P2', 'P3'].includes(upperP)) {
            currentBlock.detectedPriority = upperP as TaskPriority;
          }
          currentBlock.endLineIndex = i;
          continue;
        }

        const blockedByMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?Blocked\s*(?:by|-by)?\s*:\s*(.+)$/i);
        if (blockedByMatch) {
          currentBlock.detectedBlockedBy = blockedByMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const statusMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?Status\s*:\s*(.+)$/i);
        if (statusMatch) {
          currentBlock.detectedStatus = statusMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const descriptionMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?(?:Description|Descripci[oó]n|Desc)\s*:\s*(.+)$/i);
        if (descriptionMatch) {
          currentBlock.detectedDescription = descriptionMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const tagsMatch = trimmed.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?)?(?:Tags?|Labels)\s*:\s*(.+)$/i);
        if (tagsMatch) {
          currentBlock.detectedTags = tagsMatch[1]
            .split(',')
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean);
          currentBlock.endLineIndex = i;
          continue;
        }

        const progressMatch = trimmed.match(/^(?:[-*]\s*)?(?:Progress|Subtasks)\s*:\s*(\d+)\s*\/\s*(\d+)$/i);
        if (progressMatch) {
          const completed = parseInt(progressMatch[1], 10);
          const total = parseInt(progressMatch[2], 10);
          if (!isNaN(completed) && !isNaN(total) && total > 0) {
            currentBlock.detectedSubtasks = { completed, total };
          }
          currentBlock.endLineIndex = i;
          continue;
        }

        // Subtask bullet line: "- [ ] Subtask title" or "- [x] Subtask title"
        const subtaskMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
        if (subtaskMatch) {
          if (!currentBlock.detectedSubtasks) {
            currentBlock.detectedSubtasks = { completed: 0, total: 0, items: [] };
          }
          if (!currentBlock.detectedSubtasks.items) {
            currentBlock.detectedSubtasks.items = [];
          }
          currentBlock.detectedSubtasks.total += 1;
          const isDone = subtaskMatch[1].toLowerCase() === 'x';
          if (isDone) {
            currentBlock.detectedSubtasks.completed += 1;
          }
          currentBlock.detectedSubtasks.items.push({
            title: subtaskMatch[2].trim(),
            completed: isDone,
          });
          currentBlock.endLineIndex = i;
          continue;
        }

        // Unknown metadata line (e.g. "Owner: Nicolas", "Estimate: 2h")
        const genericMetaMatch = trimmed.match(/^(?:[-*]\s*)?([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
        if (genericMetaMatch) {
          currentBlock.unknownMetadata.push({
            key: genericMetaMatch[1],
            rawLine: line,
          });
          currentBlock.endLineIndex = i;
          continue;
        }
      }

      if (trimmed.length > 0 && !trimmed.startsWith('#')) {
        if (
          !currentBlock.detectedDescription &&
          isIndented &&
          !trimmed.startsWith('```') &&
          !trimmed.startsWith('-') &&
          !trimmed.startsWith('*') &&
          !trimmed.includes(':')
        ) {
          currentBlock.detectedDescription = trimmed;
        }
        currentBlock.endLineIndex = i;
      }
    }
  }

  if (currentBlock) {
    taskBlocks.push(currentBlock);
  }

  // Classify headings:
  // Heading A is a parent if any heading B has parentId === A.id
  const parentIdsSet = new Set(rawHeadings.map((h) => h.parentId).filter(Boolean));

  for (const h of rawHeadings) {
    const isParent = parentIdsSet.has(h.id);
    const hasDirectTasks = taskBlocks.some((b) =>
      b.headingId ? b.headingId === h.id : b.groupTitle.toLowerCase() === h.title.toLowerCase()
    );

    if (isParent) {
      parentHeadings.push({
        id: h.id,
        title: h.title,
        lineIndex: h.lineIndex,
        level: h.level,
        parentTitle: h.parentTitle,
        parentId: h.parentId,
        branchTitle: h.branchTitle,
        path: h.path,
        color: h.color,
        hasDirectTasks,
      });
    }

    if (!isParent || hasDirectTasks) {
      groupHeadings.push({
        id: h.id,
        title: h.title,
        lineIndex: h.lineIndex,
        level: h.level,
        parentTitle: h.parentTitle,
        parentId: h.parentId,
        branchTitle: h.branchTitle,
        path: h.path,
        color: h.color,
        isParent,
        hasDirectTasks,
      });
    }
  }

  return { taskBlocks, groupHeadings, parentHeadings };
}

/**
 * Validates a Markdown document for errors and warnings:
 * - Tasks without ID
 * - Duplicate IDs
 * - Blocked by pointing to nonexistent IDs
 * - Invalid priorities
 * - Unknown metadata
 * - Tasks outside headings
 * - Empty headings
 */
export function validateMarkdownDocument(markdown: string): MarkdownValidationReport {
  const { taskBlocks, groupHeadings, parentHeadings } = scanTaskBlocks(markdown);
  const issues: MarkdownIssue[] = [];

  const duplicateIds = new Set<string>();
  const missingIdTaskIds = new Set<string>();
  const missingStatusTaskIds = new Set<string>();
  const unresolvedBlockerMap = new Map<string, string[]>();

  const idCounts = new Map<string, TaskBlockInfo[]>();
  const allKnownIds = new Set<string>();
  const VALID_STATUSES = new Set(['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked']);

  // 1. Index all detected IDs and check for missing IDs
  taskBlocks.forEach((block, idx) => {
    if (!block.detectedId) {
      const tempId = block.temporaryId || `temp-${idx + 1}`;
      missingIdTaskIds.add(tempId);
      issues.push({
        id: `missing-id-${idx}`,
        type: 'missing_id',
        severity: 'warning',
        message: `Tarea sin ID: "${block.detectedTitle || 'Sin título'}"`,
        taskId: tempId,
        taskTitle: block.detectedTitle,
        groupTitle: block.groupTitle,
        lineIndex: block.taskLineIndex,
        details: 'Se generó un ID temporal en el canvas. Edita la tarea para asignarle un ID permanente.',
      });
    } else {
      const normalized = block.detectedId.toLowerCase();
      allKnownIds.add(normalized);
      if (!idCounts.has(normalized)) {
        idCounts.set(normalized, []);
      }
      idCounts.get(normalized)!.push(block);
    }
  });

  // 2. Check for Duplicate IDs
  idCounts.forEach((blocks, id) => {
    if (blocks.length > 1) {
      duplicateIds.add(id);
      blocks.forEach((block, i) => {
        issues.push({
          id: `dup-id-${id}-${i}`,
          type: 'duplicate_id',
          severity: 'error',
          message: `ID duplicado #${id} en "${block.detectedTitle}"`,
          taskId: block.detectedId,
          taskTitle: block.detectedTitle,
          groupTitle: block.groupTitle,
          lineIndex: block.taskLineIndex,
          details: `Hay ${blocks.length} tareas con el mismo ID #${id}. Cambia uno de los IDs para evitar conflictos.`,
        });
      });
    }
  });

  // 3. Check for Unresolved Blockers (Blocked by pointing to nonexistent ID)
  taskBlocks.forEach((block, idx) => {
    if (block.detectedBlockedBy) {
      const blockerIds = block.detectedBlockedBy
        .split(',')
        .map((b) => b.trim().toLowerCase())
        .filter(Boolean);

      const missingForThisTask: string[] = [];

      blockerIds.forEach((bId) => {
        if (!allKnownIds.has(bId)) {
          missingForThisTask.push(bId);
          issues.push({
            id: `unresolved-blocker-${block.detectedId || idx}-${bId}`,
            type: 'unresolved_blocker',
            severity: 'warning',
            message: `"${block.detectedTitle}" depende de un ID inexistente: #${bId}`,
            taskId: block.detectedId || block.temporaryId,
            taskTitle: block.detectedTitle,
            groupTitle: block.groupTitle,
            lineIndex: block.taskLineIndex,
            details: `La tarea #${block.detectedId || 'sin-id'} tiene "Blocked by: ${bId}", pero no existe ninguna tarea con ese ID.`,
          });
        }
      });

      if (missingForThisTask.length > 0) {
        unresolvedBlockerMap.set(
          (block.detectedId || block.temporaryId).toLowerCase(),
          missingForThisTask
        );
      }
    }
  });

  // 4. Check for Invalid Priorities
  taskBlocks.forEach((block, idx) => {
    if (block.rawPriority && !block.detectedPriority) {
      issues.push({
        id: `invalid-prio-${block.detectedId || idx}`,
        type: 'invalid_priority',
        severity: 'warning',
        message: `Prioridad desconocida "${block.rawPriority}" en "${block.detectedTitle}"`,
        taskId: block.detectedId || block.temporaryId,
        taskTitle: block.detectedTitle,
        groupTitle: block.groupTitle,
        lineIndex: block.taskLineIndex,
        details: 'Valores válidos: P0 (crítica), P1 (alta), P2 (media), P3 (baja). Se usará P1 en el canvas.',
      });
    }
  });

  // 5. Check for Mandatory Status (missing or invalid)
  taskBlocks.forEach((block, idx) => {
    const taskKey = block.detectedId || block.temporaryId || `temp-${idx + 1}`;
    if (!block.detectedStatus) {
      missingStatusTaskIds.add(taskKey);
      issues.push({
        id: `missing-status-${block.detectedId || idx}`,
        type: 'missing_status',
        severity: 'warning',
        message: `Tarea sin Estado: "${block.detectedTitle || 'Sin título'}"`,
        taskId: taskKey,
        taskTitle: block.detectedTitle,
        groupTitle: block.groupTitle,
        lineIndex: block.taskLineIndex,
        details: 'El campo "- Status:" es obligatorio. Asigna un estado (ej. backlog, todo, in_progress, review, done, blocked).',
      });
    } else if (!VALID_STATUSES.has(block.detectedStatus.trim().toLowerCase())) {
      issues.push({
        id: `invalid-status-${block.detectedId || idx}`,
        type: 'invalid_status',
        severity: 'warning',
        message: `Estado no válido "${block.detectedStatus}" en "${block.detectedTitle}"`,
        taskId: taskKey,
        taskTitle: block.detectedTitle,
        groupTitle: block.groupTitle,
        lineIndex: block.taskLineIndex,
        details: 'Valores válidos: backlog, todo, in_progress, review, done, blocked. Se usará backlog por defecto.',
      });
    }
  });

  // 5. Check for Unknown Metadata (Preserved info)
  taskBlocks.forEach((block, idx) => {
    if (block.unknownMetadata.length > 0) {
      block.unknownMetadata.forEach((meta, mIdx) => {
        issues.push({
          id: `unknown-meta-${block.detectedId || idx}-${mIdx}`,
          type: 'unknown_metadata',
          severity: 'info',
          message: `Metadato no estándar en "${block.detectedTitle}": ${meta.key}`,
          taskId: block.detectedId || block.temporaryId,
          taskTitle: block.detectedTitle,
          groupTitle: block.groupTitle,
          lineIndex: block.taskLineIndex,
          details: `Línea preservada: "${meta.rawLine.trim()}"`,
        });
      });
    }
  });

  // 6. Check for Tasks outside headings
  taskBlocks.forEach((block, idx) => {
    if (block.isOutsideHeading) {
      issues.push({
        id: `outside-heading-${block.detectedId || idx}`,
        type: 'task_outside_heading',
        severity: 'info',
        message: `Tarea fuera de sección: "${block.detectedTitle}"`,
        taskId: block.detectedId || block.temporaryId,
        taskTitle: block.detectedTitle,
        groupTitle: 'General',
        lineIndex: block.taskLineIndex,
        details: 'Se ubicó visualmente en el grupo "General". Agrega un encabezado ## Sección para organizarla.',
      });
    }
  });

  // 7. Check for Empty Headings
  groupHeadings.forEach((gh, idx) => {
    const tasksInHeading = taskBlocks.filter((b) =>
      b.headingId ? b.headingId === gh.id : b.groupTitle.toLowerCase() === gh.title.toLowerCase()
    );
    const isParent = Boolean(gh.isParent || parentHeadings.some((ph) => ph.id ? ph.id === gh.id : ph.title.toLowerCase() === gh.title.toLowerCase()));
    if (tasksInHeading.length === 0 && !isParent) {
      issues.push({
        id: `empty-heading-${idx}`,
        type: 'empty_heading',
        severity: 'info',
        message: `Sección vacía: "${'#'.repeat(gh.level || 2)} ${gh.title}"`,
        groupTitle: gh.title,
        lineIndex: gh.lineIndex,
        details: 'Esta sección no contiene tareas actualmente.',
      });
    }
  });

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return {
    issues,
    hasErrors: errorCount > 0,
    hasWarnings: warningCount > 0,
    errorCount,
    warningCount,
    infoCount,
    duplicateIds,
    missingIdTaskIds,
    missingStatusTaskIds,
    unresolvedBlockerMap,
  };
}

/**
 * Generates a clean, stable slug identifier from a task title.
 */
export function slugify(text: string): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-_]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'task';
}

/**
 * Generates a unique task ID given the title and current markdown document.
 */
export function generateUniqueTaskId(title: string, markdown: string): string {
  const { taskBlocks } = scanTaskBlocks(markdown);
  const existingIds = new Set(
    taskBlocks.map((b) => (b.detectedId || '').toLowerCase()).filter(Boolean)
  );

  const baseSlug = slugify(title);
  let candidate = baseSlug;
  let counter = 2;

  while (existingIds.has(candidate.toLowerCase())) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  return candidate;
}

/**
 * Helper to flexibly match a TaskBlockInfo by ID (#-stripped, raw, tempId, slug) or taskTitle.
 */
export function findMatchingTaskBlock(
  taskBlocks: TaskBlockInfo[],
  taskId?: string,
  taskTitle?: string
): TaskBlockInfo | undefined {
  const normTargetId = (taskId || '').trim().toLowerCase().replace(/^#/, '');
  const rawTargetId = (taskId || '').trim().toLowerCase();
  const normTitle = (taskTitle || '').trim().toLowerCase();

  // 1. Try matching by detectedId (exact or without # prefix)
  if (normTargetId) {
    const byId = taskBlocks.find((b) => {
      if (!b.detectedId) return false;
      const normDetected = b.detectedId.trim().toLowerCase().replace(/^#/, '');
      const rawDetected = b.detectedId.trim().toLowerCase();
      return (
        normDetected === normTargetId ||
        rawDetected === rawTargetId ||
        rawDetected === normTargetId
      );
    });
    if (byId) return byId;

    // 2. Try matching by temporaryId
    const byTempId = taskBlocks.find(
      (b) => b.temporaryId && b.temporaryId.toLowerCase() === rawTargetId
    );
    if (byTempId) return byTempId;

    // 3. Try matching by title if normTargetId matches title
    const byIdAsTitle = taskBlocks.find((b) => {
      if (!b.detectedTitle) return false;
      const t = b.detectedTitle.trim().toLowerCase();
      return t === rawTargetId || t === normTargetId;
    });
    if (byIdAsTitle) return byIdAsTitle;
  }

  // 4. Try matching by taskTitle if provided
  if (normTitle) {
    const byTitle = taskBlocks.find((b) => {
      if (!b.detectedTitle) return false;
      return b.detectedTitle.trim().toLowerCase() === normTitle;
    });
    if (byTitle) return byTitle;
  }

  return undefined;
}

/**
 * Finds tasks that list `targetTaskId` in their "Blocked by" field.
 */
export function findDependentTasks(
  markdown: string,
  targetTaskId: string,
  targetTaskTitle?: string
): Array<{ taskId: string; title: string; groupTitle: string }> {
  const { taskBlocks } = scanTaskBlocks(markdown);
  const normalizedTargetId = targetTaskId.trim().toLowerCase().replace(/^#/, '');
  const rawTargetId = targetTaskId.trim().toLowerCase();

  const dependents: Array<{ taskId: string; title: string; groupTitle: string }> = [];

  for (const block of taskBlocks) {
    if (block.detectedBlockedBy) {
      const blockers = block.detectedBlockedBy
        .split(',')
        .map((b) => b.trim().toLowerCase().replace(/^#/, ''));

      if (
        (normalizedTargetId && blockers.includes(normalizedTargetId)) ||
        (rawTargetId && blockers.includes(rawTargetId))
      ) {
        dependents.push({
          taskId: block.detectedId || block.temporaryId,
          title: block.detectedTitle,
          groupTitle: block.groupTitle,
        });
      }
    }
  }

  return dependents;
}

/**
 * Updates a specific task's title, completed status, or priority in a markdown string
 * while preserving unknown metadata, surrounding text, comments, and structure.
 */
export function updateTaskInMarkdown(markdown: string, taskId: string, updates: TaskUpdatePayload, taskTitle?: string): string {
  const lines = markdown.split(/\r?\n/);
  const block = findMatchingTaskBlock(scanTaskBlocks(markdown).taskBlocks, taskId, taskTitle || updates.title);
  if (!block) return markdown;
  const taskLine = lines[block.taskLineIndex].match(/^(\s*[-*]\s*\[)([ xX])(\]\s*)(.*)$/)!;
  const completed = updates.completed ?? (updates.status !== undefined ? updates.status === 'done' : /[xX]/.test(taskLine[2]));
  lines[block.taskLineIndex] = `${taskLine[1]}${completed ? 'x' : ' '}${taskLine[3]}${updates.title ?? taskLine[4]}`;
  const body = lines.slice(block.taskLineIndex + 1, block.endLineIndex + 1);
  const metadata = (pattern: RegExp, label: string, value: string | undefined, insert = true) => {
    if (value === undefined) return;
    const index = body.findIndex(line => pattern.test(line));
    if (index >= 0) {
      if (value) body[index] = body[index].replace(pattern, (_, prefix) => prefix + value);
      else body.splice(index, 1);
    } else if (value && insert) body.unshift(`${block.indentation}  - ${label}: ${value}`);
  };
  const statusToSet = updates.status !== undefined
    ? updates.status
    : updates.completed === true
      ? 'done'
      : updates.completed === false && block.detectedStatus === 'done'
        ? 'backlog'
        : undefined;

  metadata(/^(\s*(?:[-*]\s*)?Priority\s*:\s*).*$/i, 'Priority', updates.priority);
  metadata(/^(\s*(?:[-*]\s*)?Status\s*:\s*).*$/i, 'Status', statusToSet, !['todo', 'done'].includes(statusToSet || ''));
  metadata(/^(\s*(?:[-*]\s*)?(?:Description|Descripci[oó]n|Desc)\s*:\s*).*$/i, 'Description', updates.description !== undefined ? updates.description.trim() : undefined, Boolean(updates.description && updates.description.trim()));
  metadata(/^(\s*(?:[-*]\s*)?(?:Tags|Labels)\s*:\s*).*$/i, 'Tags', updates.tags?.join(', '));
  metadata(/^(\s*(?:[-*]\s*)?Blocked\s*(?:by|-by)?\s*:\s*).*$/i, 'Blocked by', updates.blockedBy?.trim());
  metadata(/^(\s*(?:[-*]\s*)?ID\s*:\s*).*$/i, 'ID', updates.id?.trim());

  if (updates.subtasks?.items) {
    let subIdx = 0;
    for (let i = 0; i < body.length; i++) {
      const bTrimmed = body[i].trim();
      const match = bTrimmed.match(/^([-*]\s*\[)([ xX])(\]\s*.*)$/);
      if (match && subIdx < updates.subtasks.items.length) {
        const targetSub = updates.subtasks.items[subIdx];
        const leadingWhitespace = body[i].match(/^\s*/)?.[0] || `${block.indentation}  `;
        body[i] = `${leadingWhitespace}${match[1]}${targetSub.completed ? 'x' : ' '}${match[3]}`;
        subIdx++;
      }
    }
  }

  lines.splice(block.taskLineIndex + 1, block.endLineIndex - block.taskLineIndex, ...body);
  return lines.join('\n');
}

/**
 * Toggles a specific subtask's completion state within a task block in Markdown.
 */
export function toggleSubtaskInMarkdown(
  markdown: string,
  taskId: string,
  subtaskIndex: number,
  forceCompleted?: boolean,
  taskTitle?: string
): string {
  const lines = markdown.split(/\r?\n/);
  const { taskBlocks } = scanTaskBlocks(markdown);
  const block = findMatchingTaskBlock(taskBlocks, taskId, taskTitle);
  if (!block) return markdown;

  let currentSubtaskIdx = 0;
  for (let i = block.taskLineIndex + 1; i <= block.endLineIndex; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isSubLine = line.startsWith(' ') || line.startsWith('\t');
    if (isSubLine) {
      const match = trimmed.match(/^([-*]\s*\[)([ xX])(\]\s*.*)$/);
      if (match) {
        if (currentSubtaskIdx === subtaskIndex) {
          const currentIsDone = match[2].toLowerCase() === 'x';
          const nextIsDone = forceCompleted !== undefined ? forceCompleted : !currentIsDone;
          const leadingWhitespace = line.match(/^\s*/)?.[0] || '  ';
          lines[i] = `${leadingWhitespace}${match[1]}${nextIsDone ? 'x' : ' '}${match[3]}`;
          return lines.join('\n');
        }
        currentSubtaskIdx++;
      }
    }
  }

  return markdown;
}

/**
 * Adds a new task into the specified group in Markdown.
 */
export function addTaskToMarkdown(
  markdown: string,
  payload: {
    title: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    groupTitle: string;
    customId?: string;
    description?: string;
    blockedBy?: string;
    tags?: string[];
    subtasks?: Array<{ title: string; completed?: boolean }>;
    groupHeadingId?: string;
    branchTitle?: string;
  }
): { updatedMarkdown: string; taskId: string } {
  const cleanTitle = payload.title.trim();
  const cleanGroup = payload.groupTitle.trim() || 'General';
  const priority = payload.priority || 'P3';
  const status = payload.status || 'backlog';
  const finalId = payload.customId?.trim() || generateUniqueTaskId(cleanTitle, markdown);

  const lines = markdown.split(/\r?\n/);
  const { groupHeadings, parentHeadings } = scanTaskBlocks(markdown);

  const taskLines: string[] = [
    `- [ ] ${cleanTitle}`,
    `  - ID: ${finalId}`,
    `  - Priority: ${priority}`,
    `  - Status: ${status}`,
  ];

  if (payload.description && payload.description.trim()) {
    taskLines.push(`  - Description: ${payload.description.trim()}`);
  }

  if (payload.blockedBy && payload.blockedBy.trim()) {
    taskLines.push(`  - Blocked by: ${payload.blockedBy.trim()}`);
  }

  if (payload.tags && payload.tags.length > 0) {
    taskLines.push(`  - Tags: ${payload.tags.join(', ')}`);
  }

  if (payload.subtasks && payload.subtasks.length > 0) {
    for (const sub of payload.subtasks) {
      taskLines.push(`  - [${sub.completed ? 'x' : ' '}] ${sub.title}`);
    }
  }

  const taskBlockText = taskLines.join('\n');

  // Check if target group heading exists
  const allPossibleHeadings = [...groupHeadings, ...parentHeadings];
  const existingGroupHeading = allPossibleHeadings.find((g) => {
    if (payload.groupHeadingId && g.id === payload.groupHeadingId) return true;
    if (g.title.toLowerCase() !== cleanGroup.toLowerCase()) return false;
    if (payload.branchTitle && g.branchTitle) {
      return g.branchTitle.toLowerCase() === payload.branchTitle.toLowerCase();
    }
    return true;
  });

  if (existingGroupHeading) {
    let insertLineIndex = lines.length;
    for (let i = existingGroupHeading.lineIndex + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i].trim())) {
        insertLineIndex = i;
        break;
      }
    }

    const beforeLines = lines.slice(0, insertLineIndex);
    const afterLines = lines.slice(insertLineIndex);

    const updatedLines = [...beforeLines, '', taskBlockText, ...afterLines];
    return {
      updatedMarkdown: updatedLines.join('\n').replace(/\n{3,}/g, '\n\n'),
      taskId: finalId,
    };
  } else {
    const newSection = `\n\n## ${cleanGroup}\n\n${taskBlockText}`;
    const updated = (markdown.trim() + newSection).trim();
    return {
      updatedMarkdown: updated,
      taskId: finalId,
    };
  }
}

/**
 * Deletes a task block from Markdown by its taskId or title.
 */
export function deleteTaskFromMarkdown(
  markdown: string,
  taskId: string,
  taskTitle?: string
): string {
  const lines = markdown.split(/\r?\n/);
  const { taskBlocks } = scanTaskBlocks(markdown);

  const targetBlock = findMatchingTaskBlock(taskBlocks, taskId, taskTitle);

  if (!targetBlock) {
    return markdown;
  }

  const countToRemove = targetBlock.endLineIndex - targetBlock.taskLineIndex + 1;
  lines.splice(targetBlock.taskLineIndex, countToRemove);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Deletes an entire section (group heading and its content/tasks) from Markdown.
 */
export function deleteSectionFromMarkdown(
  markdown: string,
  groupTitle: string,
  headingId?: string,
  branchTitle?: string
): string {
  if (!markdown || !groupTitle) return markdown;

  const lines = markdown.split(/\r?\n/);
  const { groupHeadings, parentHeadings } = scanTaskBlocks(markdown);

  const cleanGroup = groupTitle.trim().toLowerCase().replace(/^#+\s*/, '');
  const allHeadings = [...groupHeadings, ...parentHeadings];
  const targetHeading = allHeadings.find((gh) => {
    if (headingId && gh.id === headingId) return true;
    if (gh.title.trim().toLowerCase().replace(/^#+\s*/, '') !== cleanGroup) return false;
    if (branchTitle && gh.branchTitle) {
      return gh.branchTitle.toLowerCase() === branchTitle.toLowerCase();
    }
    return true;
  });

  let startLine = targetHeading ? targetHeading.lineIndex : -1;

  // Fallback: search line by line if scanTaskBlocks didn't find the exact heading
  if (startLine === -1) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(/^#+\s+(.+)$/);
      if (match && match[1].trim().toLowerCase().replace(/^#+\s*/, '') === cleanGroup) {
        startLine = i;
        break;
      }
    }
  }

  if (startLine === -1) {
    return markdown;
  }

  let actualStart = startLine;
  while (actualStart > 0 && lines[actualStart - 1].trim() === '') {
    actualStart--;
  }

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      endLine = i;
      break;
    }
  }

  lines.splice(actualStart, endLine - actualStart);

  const result = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return result ? `${result}\n` : '';
}

/**
 * Moves a task block from its current section to a target section in Markdown,
 * preserving all existing attributes and unknown metadata lines.
 */
export function moveTaskToGroupInMarkdown(
  markdown: string,
  taskId: string,
  targetGroupTitle: string,
  taskTitle?: string,
  targetHeadingId?: string,
  targetBranchTitle?: string
): string {
  const cleanTargetGroup = targetGroupTitle.trim();
  const { taskBlocks } = scanTaskBlocks(markdown);

  const targetBlock = findMatchingTaskBlock(taskBlocks, taskId, taskTitle);

  if (!targetBlock) {
    return markdown;
  }
  const isAlreadyThere =
    targetBlock.groupTitle.toLowerCase() === cleanTargetGroup.toLowerCase() &&
    (!targetHeadingId || targetBlock.headingId === targetHeadingId) &&
    (!targetBranchTitle || targetBlock.branchTitle?.toLowerCase() === targetBranchTitle.toLowerCase());
  if (isAlreadyThere) {
    return markdown;
  }

  const lines = markdown.split(/\r?\n/);

  // Extract raw block lines
  const blockLines = lines.slice(
    targetBlock.taskLineIndex,
    targetBlock.endLineIndex + 1
  );

  // Delete from original position
  lines.splice(targetBlock.taskLineIndex, targetBlock.endLineIndex - targetBlock.taskLineIndex + 1);

  // Find target group
  const reScanned = scanTaskBlocks(lines.join('\n'));
  const allPossibleTargets = [...reScanned.groupHeadings, ...reScanned.parentHeadings];
  const targetHeading = allPossibleTargets.find((g) => {
    if (targetHeadingId && g.id === targetHeadingId) return true;
    if (g.title.toLowerCase() !== cleanTargetGroup.toLowerCase()) return false;
    if (targetBranchTitle && g.branchTitle) {
      return g.branchTitle.toLowerCase() === targetBranchTitle.toLowerCase();
    }
    return true;
  });

  if (targetHeading) {
    let insertLine = lines.length;
    for (let i = targetHeading.lineIndex + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i].trim())) {
        insertLine = i;
        break;
      }
    }

    lines.splice(insertLine, 0, '', ...blockLines);
  } else {
    lines.push('', `## ${cleanTargetGroup}`, '', ...blockLines);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Assigns an explicit ID to a specific task block in Markdown that currently lacks one.
 */
export function assignTaskIdToTask(
  markdown: string,
  targetIdOrLine: string | number,
  taskTitle?: string,
  customId?: string
): { updatedMarkdown: string; taskId: string | null } {
  const { taskBlocks } = scanTaskBlocks(markdown);

  let targetBlock: TaskBlockInfo | undefined;
  if (typeof targetIdOrLine === 'number') {
    targetBlock = taskBlocks.find((b) => b.taskLineIndex === targetIdOrLine);
  } else {
    targetBlock = findMatchingTaskBlock(taskBlocks, targetIdOrLine, taskTitle);
  }

  if (!targetBlock) {
    return { updatedMarkdown: markdown, taskId: null };
  }

  // If it already has an explicit ID, return it
  if (targetBlock.detectedId) {
    return { updatedMarkdown: markdown, taskId: targetBlock.detectedId };
  }

  const lines = markdown.split(/\r?\n/);
  const finalId = customId?.trim() || generateUniqueTaskId(targetBlock.detectedTitle || taskTitle || 'task', markdown);
  const baseIndent = targetBlock.indentation ? `${targetBlock.indentation}  ` : '  ';
  const newIdLine = `${baseIndent}- ID: ${finalId}`;

  lines.splice(targetBlock.taskLineIndex + 1, 0, newIdLine);

  return {
    updatedMarkdown: lines.join('\n'),
    taskId: finalId,
  };
}

/**
 * Automatically generates and assigns unique IDs to all tasks in Markdown that do not have an ID.
 */
export function autoAssignAllMissingTaskIds(markdown: string): {
  updatedMarkdown: string;
  assignedCount: number;
  assignedTasks: Array<{ taskId: string; title: string }>;
} {
  const { taskBlocks } = scanTaskBlocks(markdown);
  const missingBlocks = taskBlocks.filter((b) => !b.detectedId);

  if (missingBlocks.length === 0) {
    return { updatedMarkdown: markdown, assignedCount: 0, assignedTasks: [] };
  }

  // Collect all already used IDs in lower-case
  const existingIdSet = new Set<string>(
    taskBlocks.map((b) => (b.detectedId || '').toLowerCase()).filter(Boolean)
  );

  const lines = markdown.split(/\r?\n/);
  const assignedTasks: Array<{ taskId: string; title: string }> = [];

  // Sort blocks in reverse line order (highest lineIndex first) to prevent index shifting on insertion
  const sortedBlocks = [...missingBlocks].sort((a, b) => b.taskLineIndex - a.taskLineIndex);

  for (const block of sortedBlocks) {
    const baseSlug = slugify(block.detectedTitle);
    let candidate = baseSlug;
    let counter = 2;
    while (existingIdSet.has(candidate.toLowerCase())) {
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }

    existingIdSet.add(candidate.toLowerCase());
    assignedTasks.unshift({ taskId: candidate, title: block.detectedTitle });

    const baseIndent = block.indentation ? `${block.indentation}  ` : '  ';
    const newIdLine = `${baseIndent}- ID: ${candidate}`;
    lines.splice(block.taskLineIndex + 1, 0, newIdLine);
  }

  return {
    updatedMarkdown: lines.join('\n'),
    assignedCount: assignedTasks.length,
    assignedTasks,
  };
}

/**
 * Automatically assigns a valid Status to all tasks in Markdown that do not have a Status field.
 * Completed tasks (- [x]) get 'done', pending tasks get the defaultStatus (defaults to 'backlog').
 */
export function autoAssignAllMissingTaskStatuses(
  markdown: string,
  defaultStatus: TaskStatus = 'backlog'
): {
  updatedMarkdown: string;
  assignedCount: number;
  assignedTasks: Array<{ taskId: string; title: string; status: TaskStatus }>;
} {
  const { taskBlocks } = scanTaskBlocks(markdown);
  const missingBlocks = taskBlocks.filter((b) => !b.detectedStatus);

  if (missingBlocks.length === 0) {
    return { updatedMarkdown: markdown, assignedCount: 0, assignedTasks: [] };
  }

  const lines = markdown.split(/\r?\n/);
  const assignedTasks: Array<{ taskId: string; title: string; status: TaskStatus }> = [];

  // Sort blocks in reverse line order to prevent index shifting on insertion
  const sortedBlocks = [...missingBlocks].sort((a, b) => b.taskLineIndex - a.taskLineIndex);

  for (const block of sortedBlocks) {
    const isCompleted = block.rawTaskLine.includes('[x]') || block.rawTaskLine.includes('[X]');
    const assignedStatus: TaskStatus = isCompleted ? 'done' : defaultStatus;
    const baseIndent = block.indentation ? `${block.indentation}  ` : '  ';
    const statusLine = `${baseIndent}- Status: ${assignedStatus}`;

    // Find the best insertion point after ID or Priority if present
    let insertOffset = 1;
    for (let i = block.taskLineIndex + 1; i <= block.endLineIndex; i++) {
      const lineText = lines[i];
      if (/^\s*(?:[-*]\s*)?(?:ID|Priority)\s*:/i.test(lineText)) {
        insertOffset = i - block.taskLineIndex + 1;
      }
    }

    lines.splice(block.taskLineIndex + insertOffset, 0, statusLine);
    assignedTasks.unshift({
      taskId: block.detectedId || block.temporaryId,
      title: block.detectedTitle,
      status: assignedStatus,
    });
  }

  return {
    updatedMarkdown: lines.join('\n'),
    assignedCount: assignedTasks.length,
    assignedTasks,
  };
}

/**
 * Assigns or updates the Status field of a single task in Markdown.
 */
export function assignStatusToTask(
  markdown: string,
  taskIdOrTitle: string,
  status: TaskStatus = 'backlog'
): string {
  const { taskBlocks } = scanTaskBlocks(markdown);
  const targetBlock = findMatchingTaskBlock(taskBlocks, taskIdOrTitle);
  if (!targetBlock) {
    return markdown;
  }
  if (targetBlock.detectedStatus) {
    return updateTaskInMarkdown(markdown, taskIdOrTitle, { status });
  }
  const lines = markdown.split(/\r?\n/);
  const baseIndent = targetBlock.indentation ? `${targetBlock.indentation}  ` : '  ';
  const statusLine = `${baseIndent}- Status: ${status}`;

  let insertOffset = 1;
  for (let i = targetBlock.taskLineIndex + 1; i <= targetBlock.endLineIndex; i++) {
    const lineText = lines[i];
    if (/^\s*(?:[-*]\s*)?(?:ID|Priority)\s*:/i.test(lineText)) {
      insertOffset = i - targetBlock.taskLineIndex + 1;
    }
  }

  lines.splice(targetBlock.taskLineIndex + insertOffset, 0, statusLine);
  return lines.join('\n');
}

/**
 * Resolves all duplicate task IDs in Markdown by keeping the first occurrence
 * and generating fresh unique IDs for any subsequent colliding task blocks.
 */
export function resolveDuplicateTaskIds(markdown: string): {
  updatedMarkdown: string;
  resolvedCount: number;
  resolvedTasks: Array<{ oldId: string; newId: string; title: string }>;
} {
  const { taskBlocks } = scanTaskBlocks(markdown);
  if (taskBlocks.length === 0) {
    return { updatedMarkdown: markdown, resolvedCount: 0, resolvedTasks: [] };
  }

  // Find all used IDs
  const allUsedIds = new Set<string>();
  taskBlocks.forEach((b) => {
    if (b.detectedId) allUsedIds.add(b.detectedId.toLowerCase());
  });

  const seenIds = new Set<string>();
  const duplicateBlocks: Array<{ block: TaskBlockInfo; oldId: string }> = [];

  // Identify duplicate occurrences (any occurrence after the first)
  for (const block of taskBlocks) {
    if (!block.detectedId) continue;
    const lower = block.detectedId.toLowerCase();
    if (seenIds.has(lower)) {
      duplicateBlocks.push({ block, oldId: block.detectedId });
    } else {
      seenIds.add(lower);
    }
  }

  if (duplicateBlocks.length === 0) {
    return { updatedMarkdown: markdown, resolvedCount: 0, resolvedTasks: [] };
  }

  const lines = markdown.split(/\r?\n/);
  const resolvedTasks: Array<{ oldId: string; newId: string; title: string }> = [];

  // Sort duplicate blocks in reverse line order to ensure line modifications don't shift prior indices
  const sorted = [...duplicateBlocks].sort((a, b) => b.block.taskLineIndex - a.block.taskLineIndex);

  for (const { block, oldId } of sorted) {
    const baseSlug = slugify(block.detectedTitle || oldId) || 'task';
    let candidate = baseSlug;
    let counter = 2;
    while (allUsedIds.has(candidate.toLowerCase())) {
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }

    allUsedIds.add(candidate.toLowerCase());
    resolvedTasks.unshift({ oldId, newId: candidate, title: block.detectedTitle });

    // Find the line that has `- ID: ...` in this block
    let replaced = false;
    for (let i = block.taskLineIndex; i <= block.endLineIndex && i < lines.length; i++) {
      const line = lines[i];
      const idMatch = line.match(/^(\s*[-*]\s*ID\s*:\s*)(.+)$/i);
      if (idMatch) {
        lines[i] = `${idMatch[1]}${candidate}`;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      const baseIndent = block.indentation ? `${block.indentation}  ` : '  ';
      lines.splice(block.taskLineIndex + 1, 0, `${baseIndent}- ID: ${candidate}`);
    }
  }

  return {
    updatedMarkdown: lines.join('\n'),
    resolvedCount: resolvedTasks.length,
    resolvedTasks,
  };
}

/**
 * Resolves a single duplicate task ID at a specific line or taskId.
 */
export function resolveSingleDuplicateTaskId(
  markdown: string,
  targetLineIndexOrTaskId: number | string,
  taskTitle?: string
): { updatedMarkdown: string; oldId: string | null; newId: string | null } {
  const { taskBlocks } = scanTaskBlocks(markdown);
  let targetBlock: TaskBlockInfo | undefined;

  if (typeof targetLineIndexOrTaskId === 'number') {
    targetBlock = taskBlocks.find((b) => b.taskLineIndex === targetLineIndexOrTaskId);
  } else {
    const matches = taskBlocks.filter(
      (b) => b.detectedId && b.detectedId.toLowerCase() === targetLineIndexOrTaskId.toLowerCase()
    );
    if (matches.length > 1) {
      if (taskTitle) {
        targetBlock =
          matches.find((m) => m.detectedTitle.toLowerCase() === taskTitle.toLowerCase()) ||
          matches[matches.length - 1];
      } else {
        targetBlock = matches[matches.length - 1];
      }
    } else {
      targetBlock = matches[0];
    }
  }

  if (!targetBlock || !targetBlock.detectedId) {
    return { updatedMarkdown: markdown, oldId: null, newId: null };
  }

  const oldId = targetBlock.detectedId;
  const allUsedIds = new Set<string>(
    taskBlocks.map((b) => (b.detectedId || '').toLowerCase()).filter(Boolean)
  );

  const baseSlug = slugify(targetBlock.detectedTitle || oldId) || 'task';
  let candidate = baseSlug;
  let counter = 2;
  while (allUsedIds.has(candidate.toLowerCase())) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  const lines = markdown.split(/\r?\n/);
  let replaced = false;
  for (let i = targetBlock.taskLineIndex; i <= targetBlock.endLineIndex && i < lines.length; i++) {
    const line = lines[i];
    const idMatch = line.match(/^(\s*[-*]\s*ID\s*:\s*)(.+)$/i);
    if (idMatch) {
      lines[i] = `${idMatch[1]}${candidate}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    const baseIndent = targetBlock.indentation ? `${targetBlock.indentation}  ` : '  ';
    lines.splice(targetBlock.taskLineIndex + 1, 0, `${baseIndent}- ID: ${candidate}`);
  }

  return {
    updatedMarkdown: lines.join('\n'),
    oldId,
    newId: candidate,
  };
}

/**
 * Scans note items from the "## Notas" or "## Notes" section of the Markdown.
 */
export function scanNotesFromMarkdown(markdown: string): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  let inNotesSection = false;
  const notes: string[] = [];
  let currentNoteLines: string[] = [];

  const flushCurrent = () => {
    if (currentNoteLines.length > 0) {
      const fullNote = currentNoteLines.join('\n').trim();
      if (fullNote) {
        notes.push(fullNote);
      }
      currentNoteLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^##\s+(?:Notas|Notes)\b/i.test(trimmed)) {
      flushCurrent();
      inNotesSection = true;
      continue;
    } else if (trimmed.startsWith('## ') && inNotesSection) {
      flushCurrent();
      inNotesSection = false;
      continue;
    }

    if (!inNotesSection) continue;

    // Inside notes section: check for bullet point "- " or "* "
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushCurrent();
      currentNoteLines.push(bulletMatch[2]);
    } else if (trimmed.length > 0) {
      currentNoteLines.push(trimmed);
    } else {
      flushCurrent();
    }
  }

  flushCurrent();
  return notes;
}

/**
 * Synchronizes canvas notes into the Markdown document under the "## Notas" section.
 */
export function syncNotesToMarkdown(markdown: string, notes: string[]): string {
  const validNotes = notes.map((n) => n.trim()).filter(Boolean);
  const lines = (markdown || '').split(/\r?\n/);

  let sectionStart = -1;
  let sectionEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^##\s+(?:Notas|Notes)\b/i.test(trimmed)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart !== -1) {
    sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
  }

  const newNotesLines: string[] = [];
  if (validNotes.length > 0) {
    newNotesLines.push('## Notas');
    for (const note of validNotes) {
      const noteLines = note.split(/\r?\n/);
      newNotesLines.push(`- ${noteLines[0]}`);
      for (let j = 1; j < noteLines.length; j++) {
        newNotesLines.push(`  ${noteLines[j]}`);
      }
    }
  }

  if (sectionStart !== -1) {
    if (validNotes.length === 0) {
      // Remove empty section
      lines.splice(sectionStart, sectionEnd - sectionStart);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    } else {
      lines.splice(sectionStart, sectionEnd - sectionStart, ...newNotesLines);
      return lines.join('\n');
    }
  } else {
    if (validNotes.length === 0) {
      return markdown;
    }
    const trimmedMd = markdown.trimEnd();
    return `${trimmedMd}\n\n${newNotesLines.join('\n')}\n`;
  }
}


// Restore a removed task without losing its original metadata or subtasks.
export function restoreTaskFromMarkdown(markdown: string, source: string, taskId: string): string {
  if (scanTaskBlocks(markdown).taskBlocks.some(b => b.detectedId === taskId)) return markdown;
  const original = scanTaskBlocks(source).taskBlocks.find(b => b.detectedId === taskId);
  if (!original) return markdown;
  const inserted = addTaskToMarkdown(markdown, { title: original.detectedTitle, customId: taskId,
    groupTitle: original.groupTitle, priority: original.detectedPriority }).updatedMarkdown;
  const target = scanTaskBlocks(inserted).taskBlocks.find(b => b.detectedId === taskId)!;
  const lines = inserted.split(/\r?\n/);
  lines.splice(target.taskLineIndex, target.endLineIndex - target.taskLineIndex + 1,
    ...source.split(/\r?\n/).slice(original.taskLineIndex, original.endLineIndex + 1));
  return lines.join('\n');
}

/**
 * Updates or sets a section's blur background color in Markdown (via <!-- color: <color> -->).
 * If color is omitted or undefined, any existing color tag is removed.
 */
export function updateSectionColorInMarkdown(
  markdown: string,
  groupTitle: string,
  color?: string,
  headingId?: string,
  branchTitle?: string
): string {
  if (!markdown || !groupTitle) return markdown;

  const lines = markdown.split(/\r?\n/);
  const { groupHeadings, parentHeadings } = scanTaskBlocks(markdown);
  const allHeadings = [...groupHeadings, ...parentHeadings];

  const cleanGroup = groupTitle.trim().toLowerCase().replace(/^#+\s*/, '');
  const targetHeading = allHeadings.find((gh) => {
    if (headingId && gh.id === headingId) return true;
    if (gh.title.trim().toLowerCase().replace(/^#+\s*/, '') !== cleanGroup) return false;
    if (branchTitle && gh.branchTitle) {
      return gh.branchTitle.toLowerCase() === branchTitle.toLowerCase();
    }
    return true;
  });

  const lineIdx = targetHeading ? targetHeading.lineIndex : -1;
  if (lineIdx === -1 || lineIdx >= lines.length) return markdown;

  const originalLine = lines[lineIdx];
  const hMatch = originalLine.match(/^([#]{1,6}\s+)(.*?)(?:\s*(?:<!--\s*color:\s*[a-zA-Z0-9_-]+\s*-->|\[color:\s*[a-zA-Z0-9_-]+\]))?\s*$/i);
  if (!hMatch) return markdown;

  const prefix = hMatch[1];
  const cleanTitle = hMatch[2].trim();

  if (color) {
    lines[lineIdx] = `${prefix}${cleanTitle} <!-- color: ${color} -->`;
  } else {
    lines[lineIdx] = `${prefix}${cleanTitle}`;
  }

  return lines.join('\n');
}

/**
 * Detects whether a line represents a task ID metadata entry (e.g. `  id: task-1`, `  - ID: 123`).
 * Excludes normal root task lines that have checkboxes.
 */
export function isTaskIdLine(lineText: string): boolean {
  const trimmed = lineText.trim();
  if (/^[-*]\s*\[[ xX]\]/i.test(trimmed)) return false;
  return /^(?:[-*]\s*)?ID\s*:\s*.+$/i.test(trimmed);
}

/**
 * Strips task ID metadata lines from a Markdown document for clean viewing/copying.
 */
export function stripTaskIdsFromMarkdown(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !isTaskIdLine(line))
    .join('\n');
}
