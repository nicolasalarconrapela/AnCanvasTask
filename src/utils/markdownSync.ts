import type { TaskPriority } from './taskMarkdown';

export interface TaskUpdatePayload {
  id?: string;
  title?: string;
  completed?: boolean;
  priority?: TaskPriority;
  status?: string;
  tags?: string[];
  blockedBy?: string;
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
  detectedTags?: string[];
  detectedSubtasks?: { total: number; completed: number };
  unknownMetadata: Array<{ key: string; rawLine: string }>;
  groupTitle: string;
  isOutsideHeading: boolean;
  indentation: string;
}

export type MarkdownIssueSeverity = 'warning' | 'error' | 'info';

export type MarkdownIssueType =
  | 'missing_id'
  | 'duplicate_id'
  | 'unresolved_blocker'
  | 'invalid_priority'
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
  unresolvedBlockerMap: Map<string, string[]>; // taskId -> missing blocker IDs
}

/**
 * Parses all task blocks and their associated groups from a Markdown string,
 * detecting unknown metadata, headings, and lines without modifying the document.
 */
export function scanTaskBlocks(markdown: string): {
  taskBlocks: TaskBlockInfo[];
  groupHeadings: Array<{ title: string; lineIndex: number }>;
} {
  const lines = markdown.split(/\r?\n/);
  const taskBlocks: TaskBlockInfo[] = [];
  const groupHeadings: Array<{ title: string; lineIndex: number }> = [];

  let currentGroup = '';
  let currentBlock: TaskBlockInfo | null = null;
  let taskCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for "## Heading"
    const headingMatch = trimmed.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentBlock) {
        currentBlock.endLineIndex = i - 1;
        taskBlocks.push(currentBlock);
        currentBlock = null;
      }
      currentGroup = headingMatch[1].trim();
      groupHeadings.push({ title: currentGroup, lineIndex: i });
      continue;
    }

    // Check for task item: "- [ ] Title" or "- [x] Title"
    const taskMatch = line.match(/^(\s*[-*]\s*\[)([ xX])(\]\s*)(.*)$/);
    if (taskMatch) {
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
        groupTitle: currentGroup || 'General',
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
        trimmed.startsWith('*');

      if (isSubLine && trimmed.length > 0) {
        const idMatch = trimmed.match(/^(?:[-*]\s*)?ID\s*:\s*(.+)$/i);
        if (idMatch) {
          currentBlock.detectedId = idMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const priorityMatch = trimmed.match(/^(?:[-*]\s*)?Priority\s*:\s*(.+)$/i);
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

        const blockedByMatch = trimmed.match(/^(?:[-*]\s*)?Blocked\s*(?:by|-by)?\s*:\s*(.+)$/i);
        if (blockedByMatch) {
          currentBlock.detectedBlockedBy = blockedByMatch[1].trim();
          currentBlock.endLineIndex = i;
          continue;
        }

        const statusMatch = trimmed.match(/^(?:[-*]\s*)?Status\s*:\s*(.+)$/i);
        if (statusMatch) {
          currentBlock.detectedStatus = statusMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
          currentBlock.endLineIndex = i;
          continue;
        }

        const tagsMatch = trimmed.match(/^(?:[-*]\s*)?(?:Tags|Labels)\s*:\s*(.+)$/i);
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
            currentBlock.detectedSubtasks = { completed: 0, total: 0 };
          }
          currentBlock.detectedSubtasks.total += 1;
          if (subtaskMatch[1].toLowerCase() === 'x') {
            currentBlock.detectedSubtasks.completed += 1;
          }
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
        currentBlock.endLineIndex = i;
      }
    }
  }

  if (currentBlock) {
    taskBlocks.push(currentBlock);
  }

  return { taskBlocks, groupHeadings };
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
  const { taskBlocks, groupHeadings } = scanTaskBlocks(markdown);
  const issues: MarkdownIssue[] = [];

  const duplicateIds = new Set<string>();
  const missingIdTaskIds = new Set<string>();
  const unresolvedBlockerMap = new Map<string, string[]>();

  const idCounts = new Map<string, TaskBlockInfo[]>();
  const allKnownIds = new Set<string>();

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
    const tasksInHeading = taskBlocks.filter(
      (b) => b.groupTitle.toLowerCase() === gh.title.toLowerCase()
    );
    if (tasksInHeading.length === 0) {
      issues.push({
        id: `empty-heading-${idx}`,
        type: 'empty_heading',
        severity: 'info',
        message: `Sección vacía: "## ${gh.title}"`,
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
  metadata(/^(\s*(?:[-*]\s*)?Priority\s*:\s*).*$/i, 'Priority', updates.priority);
  metadata(/^(\s*(?:[-*]\s*)?Status\s*:\s*).*$/i, 'Status', updates.status, !['todo', 'done'].includes(updates.status || ''));
  metadata(/^(\s*(?:[-*]\s*)?(?:Tags|Labels)\s*:\s*).*$/i, 'Tags', updates.tags?.join(', '));
  metadata(/^(\s*(?:[-*]\s*)?Blocked\s*(?:by|-by)?\s*:\s*).*$/i, 'Blocked by', updates.blockedBy?.trim());
  metadata(/^(\s*(?:[-*]\s*)?ID\s*:\s*).*$/i, 'ID', updates.id?.trim());
  lines.splice(block.taskLineIndex + 1, block.endLineIndex - block.taskLineIndex, ...body);
  return lines.join('\n');
}

/**
 * Adds a new task into the specified group in Markdown.
 */
export function addTaskToMarkdown(
  markdown: string,
  payload: {
    title: string;
    priority?: TaskPriority;
    groupTitle: string;
    customId?: string;
    blockedBy?: string;
    tags?: string[];
    subtasks?: Array<{ title: string; completed?: boolean }>;
  }
): { updatedMarkdown: string; taskId: string } {
  const cleanTitle = payload.title.trim();
  const cleanGroup = payload.groupTitle.trim() || 'General';
  const priority = payload.priority || 'P1';
  const finalId = payload.customId?.trim() || generateUniqueTaskId(cleanTitle, markdown);

  const lines = markdown.split(/\r?\n/);
  const { groupHeadings } = scanTaskBlocks(markdown);

  const taskLines: string[] = [
    `- [ ] ${cleanTitle}`,
    `  - ID: ${finalId}`,
    `  - Priority: ${priority}`,
  ];

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
  const existingGroupHeading = groupHeadings.find(
    (g) => g.title.toLowerCase() === cleanGroup.toLowerCase()
  );

  if (existingGroupHeading) {
    let insertLineIndex = lines.length;
    for (let i = existingGroupHeading.lineIndex + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) {
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
  groupTitle: string
): string {
  if (!markdown || !groupTitle) return markdown;

  const lines = markdown.split(/\r?\n/);
  const { groupHeadings } = scanTaskBlocks(markdown);

  const cleanGroup = groupTitle.trim().toLowerCase().replace(/^#+\s*/, '');
  const targetHeading = groupHeadings.find(
    (gh) => gh.title.trim().toLowerCase().replace(/^#+\s*/, '') === cleanGroup
  );

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
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ') || trimmed.startsWith('### ')) {
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
  taskTitle?: string
): string {
  const cleanTargetGroup = targetGroupTitle.trim();
  const { taskBlocks } = scanTaskBlocks(markdown);

  const targetBlock = findMatchingTaskBlock(taskBlocks, taskId, taskTitle);

  if (!targetBlock || targetBlock.groupTitle.toLowerCase() === cleanTargetGroup.toLowerCase()) {
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
  const targetHeading = reScanned.groupHeadings.find(
    (g) => g.title.toLowerCase() === cleanTargetGroup.toLowerCase()
  );

  if (targetHeading) {
    let insertLine = lines.length;
    for (let i = targetHeading.lineIndex + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) {
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

