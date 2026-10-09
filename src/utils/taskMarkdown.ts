import { scanTaskBlocks } from './markdownSync';
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
  subtasks?: { total: number; completed: number };
  blockedBy?: string;
}

export interface ParsedGroup {
  title: string;
  tasks: ParsedMarkdownTask[];
}

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

