import { scanTaskBlocks, SubtaskItem } from './markdownSync';
export type { SubtaskItem };
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
export interface ParsedMarkdownTask {
  title: string;
  completed: boolean;
  taskId?: string;
  temporaryId?: string;
  priority: TaskPriority;
  status?: TaskStatus;
  tags?: string[];
  subtasks?: { total: number; completed: number; items?: SubtaskItem[] };
  blockedBy?: string;
}

export interface ParsedGroup {
  id?: string;
  title: string;
  tasks: ParsedMarkdownTask[];
  level?: number;
  parentTitle?: string;
  parentId?: string;
  branchTitle?: string;
  path?: string;
  lineIndex?: number;
  isParent?: boolean;
}

export function parseTasksMarkdown(markdown: string): ParsedGroup[] {
  const { taskBlocks, groupHeadings } = scanTaskBlocks(markdown);
  const parsedGroups: ParsedGroup[] = [];
  const groupById = new Map<string, ParsedGroup>();

  // Ensure headings are preserved in order, excluding "Notas" / "Notes" sections
  groupHeadings.forEach((gh) => {
    const lower = gh.title.trim().toLowerCase();
    if (lower !== 'notas' && lower !== 'notes') {
      const gItem: ParsedGroup = {
        id: gh.id || `h_${gh.lineIndex}`,
        title: gh.title,
        tasks: [],
        level: gh.level || 2,
        parentTitle: gh.parentTitle,
        parentId: gh.parentId,
        branchTitle: gh.branchTitle,
        path: gh.path,
        lineIndex: gh.lineIndex,
        isParent: gh.isParent,
      };
      parsedGroups.push(gItem);
      groupById.set(gItem.id!, gItem);
    }
  });

  taskBlocks.forEach((block) => {
    let target = block.headingId ? groupById.get(block.headingId) : null;
    if (!target) {
      target =
        parsedGroups.find(
          (g) =>
            g.title.toLowerCase() === (block.groupTitle || '').toLowerCase() &&
            (!block.branchTitle || g.branchTitle === block.branchTitle)
        ) ||
        parsedGroups.find(
          (g) => g.title.toLowerCase() === (block.groupTitle || '').toLowerCase()
        );
    }

    const isCompleted = block.rawTaskLine.includes('[x]') || block.rawTaskLine.includes('[X]');
    const parsedTask: ParsedMarkdownTask = {
      title: block.detectedTitle,
      completed: isCompleted,
      taskId: block.detectedId,
      temporaryId: block.temporaryId,
      priority: block.detectedPriority || 'P1',
      status: (block.detectedStatus as any) || (isCompleted ? 'done' : 'todo'),
      tags: block.detectedTags,
      subtasks: block.detectedSubtasks,
      blockedBy: block.detectedBlockedBy,
    };

    if (target) {
      target.tasks.push(parsedTask);
    } else {
      const fallback: ParsedGroup = {
        id: `fallback-${block.groupTitle || 'General'}`,
        title: block.groupTitle || 'General',
        tasks: [parsedTask],
        level: 2,
      };
      parsedGroups.push(fallback);
      groupById.set(fallback.id!, fallback);
    }
  });

  return parsedGroups;
}

