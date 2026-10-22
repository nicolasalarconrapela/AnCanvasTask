import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef, ExternalChange, Transaction } from '@uiw/react-codemirror';
import { diffChars } from 'diff';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, Decoration, DecorationSet, keymap, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState, Prec, Extension } from '@codemirror/state';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import {
  MarkdownIssue,
  MarkdownValidationReport,
  validateMarkdownDocument,
  scanTaskBlocks,
  isTaskIdLine,
  isTaskStatusLine,
  isTaskPriorityLine,
  stripTaskIdsFromMarkdown,
  stripStatusFromMarkdown,
  stripPriorityFromMarkdown,
  stripMetadataFieldsFromMarkdown,
  sanitizeTaskMetadataOrder,
  buildTaskEnterSnippet,
  generateUniqueTaskId,
} from '../utils/markdownSync';
import { SafeMarkdownNormalizerModal } from './SafeMarkdownNormalizerModal';

export interface HiddenTaskItemInfo {
  type: 'id' | 'status' | 'priority' | 'metadata';
  label: string;
  rawText: string;
}

export function getPriorityBadgeClasses(labelOrRaw: string): string {
  const match = labelOrRaw.match(/Priority\s*:\s*(P[0-3])/i) || labelOrRaw.match(/\b(P[0-3])\b/i);
  const p = match ? match[1].toUpperCase() : 'P3';
  switch (p) {
    case 'P0':
      return 'bg-rose-500/10 text-rose-500 border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80';
    case 'P1':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/30 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/80';
    case 'P2':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80';
    case 'P3':
    default:
      return 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30 dark:bg-zinc-800/40 dark:text-zinc-300 dark:border-zinc-700/60';
  }
}

export class InlineHiddenTaskLabelsWidget extends WidgetType {
  constructor(
    readonly items: HiddenTaskItemInfo[],
    readonly onToggleLabels?: () => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className =
      'cm-inline-task-labels inline-flex items-center gap-1 ml-1.5 align-middle select-none';

    for (const item of this.items) {
      const badge = document.createElement('span');
      badge.className =
        'inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded-[3px] text-[8px] font-mono leading-none border transition-colors ' +
        (item.type === 'id'
          ? 'bg-slate-500/10 text-slate-600 border-slate-400/30 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/60'
          : item.type === 'status'
          ? 'bg-sky-100/50 text-sky-900 border-sky-200/80 dark:bg-sky-950/30 dark:text-sky-200/90 dark:border-sky-700/40'
          : item.type === 'priority'
          ? getPriorityBadgeClasses(item.rawText || item.label)
          : 'bg-stone-100/60 text-stone-700 border-stone-200 dark:bg-stone-900/40 dark:text-stone-300 dark:border-stone-800');
      badge.style.fontSize = '8px';
      badge.style.padding = '1px 3px';
      badge.style.lineHeight = '1';
      badge.style.borderRadius = '3px';

      // Subtle Icon
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined text-[8.5px] opacity-70 shrink-0';
      icon.style.fontSize = '8.5px';
      icon.style.lineHeight = '1';
      icon.textContent =
        item.type === 'id'
          ? 'tag'
          : item.type === 'status'
          ? 'check_circle'
          : item.type === 'priority'
          ? 'flag'
          : 'label';
      badge.appendChild(icon);

      // Label Text: e.g. "ID: auth-01", "Status: todo", "Priority: P1"
      const text = document.createElement('span');
      text.className = 'font-medium tracking-tight';
      text.style.fontSize = '8px';
      text.style.lineHeight = '1';
      text.textContent = item.label;
      badge.appendChild(text);

      wrap.appendChild(badge);
    }

    return wrap;
  }

  eq(other: InlineHiddenTaskLabelsWidget): boolean {
    if (this.items.length !== other.items.length) return false;
    return this.items.every(
      (it, i) => it.label === other.items[i].label && it.type === other.items[i].type
    );
  }
}

// Backwards compatibility alias
export const HiddenItemWidget = InlineHiddenTaskLabelsWidget;

export class PrecedingHiddenTasksBadgeWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly onToggle?: () => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    if (typeof document === 'undefined') return {} as HTMLElement;
    const badge = document.createElement('span');
    badge.className =
      'cm-preceding-hidden-tasks-badge inline-flex items-center gap-1 ml-1.5 px-1.5 py-[0.5px] rounded-[3px] text-[8.5px] font-mono leading-none border transition-colors select-none cursor-pointer align-middle ' +
      'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20 ' +
      'dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 dark:hover:bg-emerald-900/60';
    badge.style.fontSize = '8.5px';
    badge.style.padding = '1px 4px';
    badge.style.lineHeight = '1';
    badge.style.borderRadius = '3px';
    badge.title = `${this.count} tarea${this.count > 1 ? 's' : ''} completada${this.count > 1 ? 's' : ''} oculta${this.count > 1 ? 's' : ''}. Clic para mostrar.`;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined text-[9px] opacity-80 shrink-0';
    icon.style.fontSize = '9px';
    icon.style.lineHeight = '1';
    icon.textContent = 'check_circle';
    badge.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'font-semibold tracking-tight';
    text.style.fontSize = '8.5px';
    text.style.lineHeight = '1';
    text.textContent = `${this.count} oculta${this.count > 1 ? 's' : ''}`;
    badge.appendChild(text);

    badge.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onToggle) {
        this.onToggle();
      } else {
        window.dispatchEvent(new CustomEvent('antask:toggle-hide-completed-tasks'));
      }
    };

    return badge;
  }

  eq(other: PrecedingHiddenTasksBadgeWidget): boolean {
    return this.count === other.count;
  }
}

export class BlockHiddenTasksPlaceholderWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly onToggle?: () => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    if (typeof document === 'undefined') return {} as HTMLElement;
    const container = document.createElement('div');
    container.className = 'cm-block-hidden-tasks-placeholder py-0.5 select-none';

    const badge = document.createElement('span');
    badge.className =
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ' +
      'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20 ' +
      'dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 dark:hover:bg-emerald-900/60';
    badge.title = `${this.count} tarea${this.count > 1 ? 's' : ''} completada${this.count > 1 ? 's' : ''} oculta${this.count > 1 ? 's' : ''}. Clic para mostrar.`;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined text-[11px] opacity-80 shrink-0';
    icon.textContent = 'check_circle';
    badge.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'font-semibold tracking-tight';
    text.textContent = `${this.count} tarea${this.count > 1 ? 's' : ''} completada${this.count > 1 ? 's' : ''} oculta${this.count > 1 ? 's' : ''} (clic para mostrar)`;
    badge.appendChild(text);

    badge.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onToggle) {
        this.onToggle();
      } else {
        window.dispatchEvent(new CustomEvent('antask:toggle-hide-completed-tasks'));
      }
    };

    container.appendChild(badge);
    return container;
  }

  eq(other: BlockHiddenTasksPlaceholderWidget): boolean {
    return this.count === other.count;
  }
}

export interface HideTaskMetadataOptions {
  hideIds: boolean;
  hideStatus: boolean;
  hidePriority: boolean;
  hideCompletedTasks?: boolean;
  showLabels: boolean;
  labelTypes?: {
    id?: boolean;
    status?: boolean;
    priority?: boolean;
  };
  onToggleLabels?: () => void;
  onToggleHideCompleted?: () => void;
}

interface CompletedTaskGroup {
  startLine: number;
  endLine: number;
  taskCount: number;
}

export function buildHideTaskMetadataDeco(
  state: EditorState,
  opts: HideTaskMetadataOptions
): DecorationSet {
  // Step 1: Scan all tasks to detect completed tasks and line spans
  interface TaskSpan {
    rootLine: number;
    startLine: number;
    endLine: number;
    isCompleted: boolean;
  }
  const allTasks: TaskSpan[] = [];
  if (opts.hideCompletedTasks) {
    let l = 1;
    while (l <= state.doc.lines) {
      const line = state.doc.line(l);
      const rootTaskMatch = line.text.match(/^(\s*)([-*+]\s*\[([ xX])\])/);
      if (rootTaskMatch) {
        const baseIndent = rootTaskMatch[1].length;
        let isCompleted = rootTaskMatch[3].toLowerCase() === 'x';
        let subL = l + 1;

        while (subL <= state.doc.lines) {
          const subLine = state.doc.line(subL);
          const subText = subLine.text;
          if (subText.trim().length === 0 || subText.startsWith('#')) break;
          const subIndent = (subText.match(/^(\s*)/)?.[1] || '').length;
          if (subIndent <= baseIndent && /^(\s*)[-*+]\s*\[([ xX])\]/.test(subText)) break;

          if (isTaskStatusLine(subText)) {
            const statusMatch = subText.match(/Status\s*:\s*(.+)$/i);
            if (statusMatch) {
              const clean = statusMatch[1].trim().toLowerCase();
              if (clean === 'done' || clean === 'completed') isCompleted = true;
            }
          }
          subL++;
        }

        allTasks.push({
          rootLine: l,
          startLine: l,
          endLine: subL - 1,
          isCompleted,
        });
        l = subL;
      } else {
        l++;
      }
    }
  }

  // Group contiguous completed tasks
  const completedGroups: CompletedTaskGroup[] = [];
  if (opts.hideCompletedTasks) {
    const completedTasks = allTasks.filter((t) => t.isCompleted);
    let currentGroup: CompletedTaskGroup | null = null;

    for (const task of completedTasks) {
      if (!currentGroup) {
        currentGroup = {
          startLine: task.startLine,
          endLine: task.endLine,
          taskCount: 1,
        };
      } else {
        let onlyBlank = true;
        for (let k = currentGroup.endLine + 1; k < task.startLine; k++) {
          if (state.doc.line(k).text.trim().length > 0) {
            onlyBlank = false;
            break;
          }
        }
        if (onlyBlank) {
          currentGroup.endLine = task.endLine;
          currentGroup.taskCount += 1;
        } else {
          completedGroups.push(currentGroup);
          currentGroup = {
            startLine: task.startLine,
            endLine: task.endLine,
            taskCount: 1,
          };
        }
      }
    }
    if (currentGroup) completedGroups.push(currentGroup);
  }

  // Preceding line badges mapping: line index (1-based) -> taskCount
  const precedingBadges = new Map<number, number>();

  for (const group of completedGroups) {
    if (group.startLine > 1) {
      let prevLineNum = group.startLine - 1;
      while (prevLineNum > 1 && state.doc.line(prevLineNum).text.trim().length === 0) {
        prevLineNum--;
      }
      const containingTask = allTasks.find(
        (t) => !t.isCompleted && prevLineNum >= t.startLine && prevLineNum <= t.endLine
      );
      const targetLine = containingTask ? containingTask.rootLine : prevLineNum;
      precedingBadges.set(targetLine, (precedingBadges.get(targetLine) || 0) + group.taskCount);
    }
  }

  const builder = new RangeSetBuilder<Decoration>();
  let l = 1;
  while (l <= state.doc.lines) {
    const line = state.doc.line(l);

    // Check if l is the start of a completed group
    const completedGroup = completedGroups.find((g) => g.startLine === l);
    if (completedGroup) {
      const from = line.from;
      const endLine = state.doc.line(completedGroup.endLine);
      const to = completedGroup.endLine < state.doc.lines ? state.doc.line(completedGroup.endLine + 1).from : endLine.to;

      if (completedGroup.startLine === 1) {
        builder.add(
          from,
          to,
          Decoration.replace({
            block: true,
            widget: new BlockHiddenTasksPlaceholderWidget(completedGroup.taskCount, opts.onToggleHideCompleted),
          })
        );
      } else {
        builder.add(from, to, Decoration.replace({ block: true }));
      }
      l = completedGroup.endLine + 1;
      continue;
    }

    const rootTaskMatch = line.text.match(/^(\s*)([-*+]\s*\[([ xX])\])/);
    if (rootTaskMatch) {
      const baseIndent = rootTaskMatch[1].length;
      const taskLine = line;
      const hiddenItems: HiddenTaskItemInfo[] = [];
      const hiddenRanges: Array<{ from: number; to: number }> = [];
      let subL = l + 1;

      while (subL <= state.doc.lines) {
        const subLine = state.doc.line(subL);
        const subText = subLine.text;
        if (subText.trim().length === 0 || subText.startsWith('#')) break;
        const subIndent = (subText.match(/^(\s*)/)?.[1] || '').length;
        if (subIndent <= baseIndent && /^(\s*)[-*+]\s*\[([ xX])\]/.test(subText)) break;

        let type: 'id' | 'status' | 'priority' | null = null;
        if (opts.hideIds && isTaskIdLine(subText)) type = 'id';
        else if (opts.hideStatus && isTaskStatusLine(subText)) type = 'status';
        else if (opts.hidePriority && isTaskPriorityLine(subText)) type = 'priority';

        if (type) {
          const isLabelAllowed =
            opts.showLabels &&
            (opts.labelTypes ? opts.labelTypes[type] !== false : true);
          if (isLabelAllowed) {
            const cleanLabel = subText.trim().replace(/^[-*]\s*/, '');
            hiddenItems.push({ type, label: cleanLabel, rawText: subText });
          }
          const lFrom = subLine.from;
          const lTo = subL < state.doc.lines ? subLine.to + 1 : subLine.to;
          hiddenRanges.push({ from: lFrom, to: lTo });
        }
        subL++;
      }

      // Add labels widget for pending task
      if (opts.showLabels && hiddenItems.length > 0) {
        builder.add(
          taskLine.to,
          taskLine.to,
          Decoration.widget({
            widget: new InlineHiddenTaskLabelsWidget(hiddenItems, opts.onToggleLabels),
            side: 1,
          })
        );
      }

      // If this task line has a preceding badge for hidden completed tasks right after it
      const badgeCount = precedingBadges.get(l);
      if (badgeCount) {
        builder.add(
          taskLine.to,
          taskLine.to,
          Decoration.widget({
            widget: new PrecedingHiddenTasksBadgeWidget(badgeCount, opts.onToggleHideCompleted),
            side: 2,
          })
        );
      }

      for (const r of hiddenRanges) {
        builder.add(r.from, r.to, Decoration.replace({ block: true }));
      }

      l = subL;
    } else {
      // Non-task line (e.g. heading or plain text line)
      const badgeCount = precedingBadges.get(l);
      if (badgeCount) {
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new PrecedingHiddenTasksBadgeWidget(badgeCount, opts.onToggleHideCompleted),
            side: 1,
          })
        );
      }

      let type: 'id' | 'status' | 'priority' | null = null;
      if (opts.hideIds && isTaskIdLine(line.text)) type = 'id';
      else if (opts.hideStatus && isTaskStatusLine(line.text)) type = 'status';
      else if (opts.hidePriority && isTaskPriorityLine(line.text)) type = 'priority';
      if (type) {
        const lFrom = line.from;
        const lTo = l < state.doc.lines ? line.to + 1 : line.to;
        builder.add(lFrom, lTo, Decoration.replace({ block: true }));
      }
      l++;
    }
  }

  return builder.finish();
}

export function buildHideCompletedTasksDeco(state: EditorState): DecorationSet {
  return buildHideTaskMetadataDeco(state, {
    hideIds: false,
    hideStatus: false,
    hidePriority: false,
    hideCompletedTasks: true,
    showLabels: false,
  });
}

export function createHideTaskMetadataExtension(opts: HideTaskMetadataOptions): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildHideTaskMetadataDeco(state, opts);
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return buildHideTaskMetadataDeco(tr.state, opts);
      }
      return decorations.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildHideTaskIdsDeco(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let l = 1; l <= state.doc.lines; l++) {
    const line = state.doc.line(l);
    if (isTaskIdLine(line.text)) {
      const lFrom = line.from;
      const lTo = l < state.doc.lines ? line.to + 1 : line.to;
      builder.add(lFrom, lTo, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

const hideTaskIdsExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildHideTaskIdsDeco(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildHideTaskIdsDeco(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildHideTaskStatusDeco(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let l = 1; l <= state.doc.lines; l++) {
    const line = state.doc.line(l);
    if (isTaskStatusLine(line.text)) {
      const lFrom = line.from;
      const lTo = l < state.doc.lines ? line.to + 1 : line.to;
      builder.add(lFrom, lTo, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

const hideTaskStatusExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildHideTaskStatusDeco(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildHideTaskStatusDeco(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildHideTaskPriorityDeco(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let l = 1; l <= state.doc.lines; l++) {
    const line = state.doc.line(l);
    if (isTaskPriorityLine(line.text)) {
      const lFrom = line.from;
      const lTo = l < state.doc.lines ? line.to + 1 : line.to;
      builder.add(lFrom, lTo, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

const hideTaskPriorityExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildHideTaskPriorityDeco(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildHideTaskPriorityDeco(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface TaskFieldRange {
  line: number;
  from: number;
  to: number;
}

interface TaskFieldNavigationOptions {
  showTaskIds?: boolean;
  showTaskStatus?: boolean;
  showTaskPriority?: boolean;
  hideCompletedTasks?: boolean;
}

function isCompletedTaskLine(state: EditorState, lineNumber: number): boolean {
  const line = state.doc.line(lineNumber);
  const match = line.text.match(/^(\s*)([-*+]\s*\[([ xX])\])/);
  if (!match) return false;
  if (match[3].toLowerCase() === 'x') return true;
  const baseIndent = match[1].length;
  for (let k = lineNumber + 1; k <= state.doc.lines; k++) {
    const subLine = state.doc.line(k);
    const subText = subLine.text;
    if (subText.trim().length === 0 || subText.startsWith('#')) break;
    const subIndent = (subText.match(/^(\s*)/)?.[1] || '').length;
    if (subIndent <= baseIndent && /^(\s*)[-*+]\s*\[([ xX])\]/.test(subText)) break;
    if (isTaskStatusLine(subText)) {
      const statusMatch = subText.match(/Status\s*:\s*(.+)$/i);
      if (statusMatch) {
        const clean = statusMatch[1].trim().toLowerCase();
        if (clean === 'done' || clean === 'completed') return true;
      }
    }
  }
  return false;
}

function navigateTaskFields(
  view: EditorView,
  direction: 'next' | 'prev',
  opts?: TaskFieldNavigationOptions
): boolean {
  const selection = view.state.selection.main;
  const pos = selection.head;
  const curLine = view.state.doc.lineAt(pos);

  const isTaskRoot = /^(\s*)[-*+]\s*\[([ xX])\]/.test(curLine.text);
  const isMetadata = /^\s*[-*]?\s*(?:Description|Descripci[oó]n|Desc|ID|Status|Priority|Blocked|Tags?|Progress)\s*:/i.test(curLine.text);

  if (!isTaskRoot && !isMetadata) return false;

  // Find task root line
  let taskLineNumber = curLine.number;
  if (!isTaskRoot) {
    let found = false;
    for (let k = curLine.number - 1; k >= Math.max(1, curLine.number - 25); k--) {
      const prevLine = view.state.doc.line(k);
      if (/^(\s*)[-*+]\s*\[([ xX])\]/.test(prevLine.text)) {
        taskLineNumber = k;
        found = true;
        break;
      }
      if (prevLine.text.startsWith('#') || (prevLine.text.trim().length === 0 && k < curLine.number - 1)) {
        break;
      }
    }
    if (!found) return false;
  }

  const taskLine = view.state.doc.line(taskLineNumber);
  const fields: TaskFieldRange[] = [];

  // 1. Task root title field
  const checkIdx = taskLine.text.indexOf(']');
  if (checkIdx !== -1) {
    let valStart = checkIdx + 1;
    while (valStart < taskLine.text.length && taskLine.text[valStart] === ' ') valStart++;
    fields.push({
      line: taskLine.number,
      from: taskLine.from + valStart,
      to: taskLine.to,
    });
  }

  // 2. Metadata lines under task
  for (let k = taskLineNumber + 1; k <= view.state.doc.lines; k++) {
    const subLine = view.state.doc.line(k);
    if (subLine.text.trim().length === 0 || /^(\s*)[-*+]\s*\[([ xX])\]/.test(subLine.text) || subLine.text.startsWith('#')) {
      break;
    }
    if (opts?.showTaskIds === false && isTaskIdLine(subLine.text)) {
      continue;
    }
    if (opts?.showTaskStatus === false && isTaskStatusLine(subLine.text)) {
      continue;
    }
    if (opts?.showTaskPriority === false && isTaskPriorityLine(subLine.text)) {
      continue;
    }
    const colonIdx = subLine.text.indexOf(':');
    if (colonIdx !== -1 && /^\s*[-*]?\s*[a-zA-Z]/i.test(subLine.text)) {
      let valStart = colonIdx + 1;
      while (valStart < subLine.text.length && subLine.text[valStart] === ' ') valStart++;
      fields.push({
        line: subLine.number,
        from: subLine.from + valStart,
        to: subLine.to,
      });
    }
  }

  if (fields.length === 0) return false;

  const curFieldIdx = fields.findIndex((f) => f.line === curLine.number);

  let targetField: TaskFieldRange | null = null;
  if (direction === 'next') {
    if (curFieldIdx >= 0 && curFieldIdx < fields.length - 1) {
      targetField = fields[curFieldIdx + 1];
    } else if (curFieldIdx === fields.length - 1) {
      // Look for next task in document
      for (let m = curLine.number + 1; m <= view.state.doc.lines; m++) {
        const nextTaskLine = view.state.doc.line(m);
        if (/^(\s*)[-*+]\s*\[([ xX])\]/.test(nextTaskLine.text)) {
          if (opts?.hideCompletedTasks && isCompletedTaskLine(view.state, m)) {
            continue;
          }
          const cIdx = nextTaskLine.text.indexOf(']');
          let vStart = cIdx + 1;
          while (vStart < nextTaskLine.text.length && nextTaskLine.text[vStart] === ' ') vStart++;
          targetField = {
            line: nextTaskLine.number,
            from: nextTaskLine.from + vStart,
            to: nextTaskLine.to,
          };
          break;
        }
      }
    }
  } else {
    // direction === 'prev'
    if (curFieldIdx > 0) {
      targetField = fields[curFieldIdx - 1];
    } else if (curFieldIdx === 0) {
      // Look for previous task in document
      for (let m = taskLineNumber - 1; m >= 1; m--) {
        const prevTaskLine = view.state.doc.line(m);
        if (/^(\s*)[-*+]\s*\[([ xX])\]/.test(prevTaskLine.text)) {
          if (opts?.hideCompletedTasks && isCompletedTaskLine(view.state, m)) {
            continue;
          }
          let lastF: TaskFieldRange = {
            line: prevTaskLine.number,
            from: prevTaskLine.from + (prevTaskLine.text.indexOf(']') + 2),
            to: prevTaskLine.to,
          };
          for (let p = m + 1; p < taskLineNumber; p++) {
            const pLine = view.state.doc.line(p);
            if (pLine.text.trim().length === 0 || pLine.text.startsWith('#')) break;
            if (opts?.showTaskIds === false && isTaskIdLine(pLine.text)) continue;
            if (opts?.showTaskStatus === false && isTaskStatusLine(pLine.text)) continue;
            if (opts?.showTaskPriority === false && isTaskPriorityLine(pLine.text)) continue;
            const cIdx = pLine.text.indexOf(':');
            if (cIdx !== -1) {
              let vStart = cIdx + 1;
              while (vStart < pLine.text.length && pLine.text[vStart] === ' ') vStart++;
              lastF = { line: pLine.number, from: pLine.from + vStart, to: pLine.to };
            }
          }
          targetField = lastF;
          break;
        }
      }
    }
  }

  if (!targetField) return false;

  if (targetField.from < targetField.to) {
    view.dispatch({
      selection: { anchor: targetField.from, head: targetField.to },
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      selection: { anchor: targetField.from },
      scrollIntoView: true,
    });
  }

  return true;
}

function createEnterTaskSnippetExtension(opts?: TaskFieldNavigationOptions): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run(view: EditorView): boolean {
          const selection = view.state.selection.main;
          if (!selection.empty) return false;

          const pos = selection.head;
          const line = view.state.doc.lineAt(pos);
          const lineText = line.text;

          // Check if line contains a task checkbox
          const checkboxIndex = lineText.indexOf(']');
          if (checkboxIndex === -1) return false;

          const col = pos - line.from;
          // Only trigger if cursor is after the checkbox
          if (col <= checkboxIndex) return false;

          // Only trigger if cursor is at the end of the line (or only whitespace remains after cursor)
          const afterCursor = lineText.slice(col);
          if (afterCursor.trim().length > 0) return false;

          // Prevent duplicate snippet if next line already starts with metadata
          if (line.number < view.state.doc.lines) {
            const nextLineText = view.state.doc.line(line.number + 1).text.trim();
            if (
              /^(?:[-*]\s*)?(?:Description|Descripci[oó]n|Desc|ID|Status|Priority|Blocked|Tags?|Progress)\s*:/i.test(
                nextLineText
              )
            ) {
              return false;
            }
          }

          const result = buildTaskEnterSnippet(lineText, view.state.doc.toString());
          if (!result) return false;

          const insertPos = line.to;
          view.dispatch({
            changes: { from: insertPos, to: insertPos, insert: result.snippetText },
            selection: { anchor: insertPos + result.cursorOffset },
            scrollIntoView: true,
          });

          return true;
        },
      },
      {
        key: 'Tab',
        run(view: EditorView): boolean {
          return navigateTaskFields(view, 'next', opts);
        },
        shift(view: EditorView): boolean {
          return navigateTaskFields(view, 'prev', opts);
        },
      },
    ])
  );
}

interface MarkdownSplitEditorProps {
  value: string;
  fileName: string;
  theme: 'dark' | 'light';
  onChange: (val: string) => void;
  onClose: () => void;
  onExport: () => void;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  splitRatio: number;
  onChangeSplitRatio?: (ratio: number) => void;
  onOpenNormalizer?: () => void;
  showTaskIds?: boolean;
  onToggleShowTaskIds?: () => void;
  showTaskStatus?: boolean;
  onToggleShowTaskStatus?: () => void;
  showTaskPriority?: boolean;
  onToggleShowTaskPriority?: () => void;
  showHiddenItemLabels?: boolean;
  onToggleShowHiddenItemLabels?: () => void;
  hiddenItemLabelTypes?: { id: boolean; status: boolean; priority: boolean };
  onChangeHiddenItemLabelTypes?: (types: { id: boolean; status: boolean; priority: boolean }) => void;
  hideCompletedTasks?: boolean;
  onToggleHideCompletedTasks?: () => void;
}

export function MarkdownSplitEditor({
  value,
  fileName,
  theme,
  onChange,
  onClose,
  onExport,
  onShowToast,
  splitRatio,
  onChangeSplitRatio,
  onOpenNormalizer,
  showTaskIds,
  onToggleShowTaskIds,
  showTaskStatus,
  onToggleShowTaskStatus,
  showTaskPriority,
  onToggleShowTaskPriority,
  showHiddenItemLabels,
  onToggleShowHiddenItemLabels,
  hiddenItemLabelTypes,
  onChangeHiddenItemLabelTypes,
  hideCompletedTasks,
  onToggleHideCompletedTasks,
}: MarkdownSplitEditorProps) {
  const { i18n } = useLingui();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [copied, setCopied] = useState(false);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);
  const [isLocalNormalizerOpen, setIsLocalNormalizerOpen] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localHideCompleted, setLocalHideCompleted] = useState(false);
  const hideCompleted = hideCompletedTasks !== undefined ? hideCompletedTasks : localHideCompleted;
  const handleToggleHideCompleted = useCallback(() => {
    if (onToggleHideCompletedTasks) {
      onToggleHideCompletedTasks();
    } else {
      setLocalHideCompleted((prev) => !prev);
    }
  }, [onToggleHideCompletedTasks]);

  useEffect(() => {
    const handleToggleHideCompletedEvent = () => handleToggleHideCompleted();
    window.addEventListener('antask:toggle-hide-completed-tasks', handleToggleHideCompletedEvent);
    return () => {
      window.removeEventListener('antask:toggle-hide-completed-tasks', handleToggleHideCompletedEvent);
    };
  }, [handleToggleHideCompleted]);

  const [localShowHiddenLabels, setLocalShowHiddenLabels] = useState(true);
  const showHiddenLabels = showHiddenItemLabels !== undefined ? showHiddenItemLabels : localShowHiddenLabels;
  const handleToggleHiddenLabels = useCallback(() => {
    if (onToggleShowHiddenItemLabels) {
      onToggleShowHiddenItemLabels();
    } else {
      setLocalShowHiddenLabels((prev) => !prev);
    }
  }, [onToggleShowHiddenItemLabels]);

  const [localLabelTypes, setLocalLabelTypes] = useState<{ id: boolean; status: boolean; priority: boolean }>({
    id: true,
    status: true,
    priority: true,
  });

  const effectiveLabelTypes = useMemo(() => ({
    id: hiddenItemLabelTypes?.id !== undefined ? hiddenItemLabelTypes.id : localLabelTypes.id,
    status: hiddenItemLabelTypes?.status !== undefined ? hiddenItemLabelTypes.status : localLabelTypes.status,
    priority: hiddenItemLabelTypes?.priority !== undefined ? hiddenItemLabelTypes.priority : localLabelTypes.priority,
  }), [hiddenItemLabelTypes, localLabelTypes]);

  const [isLabelsDropdownOpen, setIsLabelsDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const labelsDropdownRef = useRef<HTMLDivElement>(null);

  const handleToggleLabelsDropdown = useCallback(() => {
    setIsLabelsDropdownOpen((prev) => {
      const next = !prev;
      if (next && labelsDropdownRef.current) {
        const rect = labelsDropdownRef.current.getBoundingClientRect();
        setDropdownPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isLabelsDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const menuEl = document.getElementById('menu-markdown-hidden-labels-dropdown');
      if (
        labelsDropdownRef.current &&
        !labelsDropdownRef.current.contains(target) &&
        (!menuEl || !menuEl.contains(target))
      ) {
        setIsLabelsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isLabelsDropdownOpen]);

  const handleToggleLabelType = useCallback(
    (type: 'id' | 'status' | 'priority') => {
      const next = {
        ...effectiveLabelTypes,
        [type]: !effectiveLabelTypes[type],
      };
      if (onChangeHiddenItemLabelTypes) {
        onChangeHiddenItemLabelTypes(next);
      } else {
        setLocalLabelTypes(next);
      }
      if (!effectiveLabelTypes[type] && showHiddenLabels === false && onToggleShowHiddenItemLabels) {
        onToggleShowHiddenItemLabels();
      }
    },
    [effectiveLabelTypes, onChangeHiddenItemLabelTypes, showHiddenLabels, onToggleShowHiddenItemLabels]
  );

  const handleSetAllLabelTypes = useCallback(
    (enabled: boolean) => {
      const next = { id: enabled, status: enabled, priority: enabled };
      if (onChangeHiddenItemLabelTypes) {
        onChangeHiddenItemLabelTypes(next);
      } else {
        setLocalLabelTypes(next);
      }
      if (enabled && showHiddenLabels === false && onToggleShowHiddenItemLabels) {
        onToggleShowHiddenItemLabels();
      }
    },
    [onChangeHiddenItemLabelTypes, showHiddenLabels, onToggleShowHiddenItemLabels]
  );

  // Apply remote changes before the controlled editor replaces its whole value.
  // CodeMirror maps the cursor through these edits and excludes them from undo.
  useLayoutEffect(() => {
    const view = editorRef.current?.view;
    if (!view || view.state.doc.toString() === value) return;
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    let position = 0;
    for (const part of diffChars(view.state.doc.toString(), value)) {
      if (!part.added && !part.removed) { position += part.value.length; continue; }
      const previous = changes[changes.length - 1];
      if (previous?.to === position) {
        if (part.added) previous.insert += part.value;
        else previous.to += part.value.length;
      } else changes.push({ from: position, to: position + (part.removed ? part.value.length : 0), insert: part.added ? part.value : '' });
      if (part.removed) position += part.value.length;
    }
    view.dispatch({ changes, annotations: [ExternalChange.of(true), Transaction.addToHistory.of(false)] });
  }, [value]);

  // Validation report in real time
  const validationReport: MarkdownValidationReport = useMemo(
    () => validateMarkdownDocument(value),
    [value]
  );

  // Parse basic counts
  const stats = useMemo(() => {
    const lines = value.split(/\r?\n/);
    const taskLines = lines.filter((l) => l.trim().match(/^[-*]\s*\[[ xX]\]/));
    const completedLines = lines.filter((l) => l.trim().match(/^[-*]\s*\[[xX]\]/));
    const { groupHeadings } = scanTaskBlocks(value);
    const p0Lines = lines.filter((l) => l.toLowerCase().includes('priority: p0'));

    return {
      totalTasks: taskLines.length,
      completedTasks: completedLines.length,
      pendingTasks: taskLines.length - completedLines.length,
      sections: groupHeadings.length,
      criticalCount: p0Lines.length,
      linesCount: lines.length,
    };
  }, [value]);

  // Handle local text changes with typing status
  const handleChange = useCallback(
    (newVal: string) => {
      setIsTyping(true);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = setTimeout(() => {
        setIsTyping(false);
      }, 500);

      onChange(newVal);
    },
    [onChange]
  );

  // Helper to insert snippet at current cursor or end
  const insertText = useCallback(
    (snippet: string, cursorOffset?: number) => {
      const view = editorRef.current?.view;
      if (!view) return;

      const selection = view.state.selection.main;
      const from = selection.from;
      const to = selection.to;

      view.dispatch({
        changes: { from, to, insert: snippet },
        selection: {
          anchor: from + (cursorOffset !== undefined ? cursorOffset : snippet.length),
        },
      });
      view.focus();
    },
    []
  );

  // Jump to specific line (1-based index)
  const jumpToLine = useCallback((lineNumber: number) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const doc = view.state.doc;
    const safeLine = Math.max(1, Math.min(lineNumber + 1, doc.lines));
    const lineInfo = doc.line(safeLine);

    view.dispatch({
      selection: { anchor: lineInfo.from },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  // Copy markdown to clipboard
  const handleCopy = useCallback(async () => {
    try {
      const textToCopy = stripMetadataFieldsFromMarkdown(value, {
        stripIds: showTaskIds === false,
        stripStatus: showTaskStatus === false,
        stripPriority: showTaskPriority === false,
      });
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      onShowToast(i18n._(msg`Markdown copiado al portapapeles`), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast(i18n._(msg`Error al copiar al portapapeles`), 'error');
    }
  }, [value, showTaskIds, showTaskStatus, showTaskPriority, onShowToast, i18n]);

  // Open safe normalization dialog
  const handleOpenNormalizer = useCallback(() => {
    if (onOpenNormalizer) {
      onOpenNormalizer();
    } else {
      setIsLocalNormalizerOpen(true);
    }
  }, [onOpenNormalizer]);

  // Sanitize task metadata order (Description -> ID -> Status -> Priority)
  const handleSanitizeMetadataOrder = useCallback(() => {
    const { updatedMarkdown, reorderedCount } = sanitizeTaskMetadataOrder(value);
    if (reorderedCount > 0) {
      onChange(updatedMarkdown);
      onShowToast(
        i18n._(msg`Orden sanitizado en ${reorderedCount} tarea(s) (Description / ID / Status / Priority)`),
        'success'
      );
    } else {
      onShowToast(
        i18n._(msg`El orden de los metadatos ya está sanitizado (Description / ID / Status / Priority)`),
        'info'
      );
    }
  }, [value, onChange, onShowToast, i18n]);

  useEffect(() => {
    const handleEvent = () => handleSanitizeMetadataOrder();
    window.addEventListener('antask:sanitize-task-metadata-order', handleEvent);
    return () => {
      window.removeEventListener('antask:sanitize-task-metadata-order', handleEvent);
    };
  }, [handleSanitizeMetadataOrder]);

  // Track cursor position
  const cursorTrackerPlugin = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        setCursorPos({
          line: line.number,
          col: pos - line.from + 1,
        });
      }
    });
  }, []);

  const navOptions = useMemo(
    () => ({ showTaskIds, showTaskStatus, showTaskPriority, hideCompletedTasks: hideCompleted }),
    [showTaskIds, showTaskStatus, showTaskPriority, hideCompleted]
  );

  const enterTaskSnippetExt = useMemo(
    () => createEnterTaskSnippetExtension(navOptions),
    [navOptions]
  );

  const extensions = useMemo(() => {
    const exts = [
      enterTaskSnippetExt,
      markdown(),
      cursorTrackerPlugin,
      EditorView.lineWrapping,
    ];
    const hasHiddenFields =
      showTaskIds === false ||
      showTaskStatus === false ||
      showTaskPriority === false ||
      hideCompleted;
    if (hasHiddenFields) {
      exts.push(
        createHideTaskMetadataExtension({
          hideIds: showTaskIds === false,
          hideStatus: showTaskStatus === false,
          hidePriority: showTaskPriority === false,
          hideCompletedTasks: hideCompleted,
          showLabels: showHiddenLabels !== false,
          labelTypes: effectiveLabelTypes,
          onToggleLabels: handleToggleHiddenLabels,
          onToggleHideCompleted: handleToggleHideCompleted,
        })
      );
    }
    return exts;
  }, [
    enterTaskSnippetExt,
    cursorTrackerPlugin,
    showTaskIds,
    showTaskStatus,
    showTaskPriority,
    hideCompleted,
    showHiddenLabels,
    effectiveLabelTypes,
    handleToggleHiddenLabels,
    handleToggleHideCompleted,
  ]);

  return (
    <aside
      aria-label={i18n._(msg`Editor Markdown en panel dividido`)}
      className="flex flex-col h-full bg-[var(--surface-container)] border-r border-[var(--outline)] overflow-hidden shrink-0 shadow-sm"
      style={{ width: '100%' }}
    >
      {/* Top Header Bar */}
      <div id="div-markdownspliteditor-1" className="h-10 px-3 border-b border-[var(--outline)] bg-[var(--surface)] flex items-center justify-between gap-2 select-none shrink-0">
        {/* Left: File Title & State Indicator */}
        <div id="div-markdownspliteditor-2" className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">
            description
          </span>
          <div id="div-markdownspliteditor-3" className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--on-surface)] truncate font-mono">
              {fileName}
            </span>
            <span
              className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                isTyping
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
              title={isTyping ? i18n._(msg`Escribiendo cambios...`) : i18n._(msg`Sincronizado con Canvas`)}
            />
          </div>
        </div>

        {/* Right: Quick actions & controls */}
        <div id="div-markdownspliteditor-4" className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar shrink-0">
          {/* Preset Ratio Selector (35% / 50% / 65%) */}
          {onChangeSplitRatio && (
            <div id="div-markdownspliteditor-5" className="hidden sm:flex items-center bg-[var(--surface-container)] p-0.5 rounded border border-[var(--outline)] text-[10px] shrink-0">
              <button
                id="btn-split-ratio-35"
                type="button"
                onClick={() => onChangeSplitRatio(35)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                  Math.round(splitRatio) === 35
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
                title={i18n._(msg`Dividir 35% Editor / 65% Canvas o Kanban`)}
              >
                35%
              </button>
              <button
                id="btn-split-ratio-50"
                type="button"
                onClick={() => onChangeSplitRatio(50)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                  Math.round(splitRatio) === 50
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
                title={i18n._(msg`Dividir 50% / 50%`)}
              >
                50%
              </button>
              <button
                id="btn-split-ratio-65"
                type="button"
                onClick={() => onChangeSplitRatio(65)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                  Math.round(splitRatio) === 65
                    ? 'bg-[var(--primary)] text-[var(--on-primary)] font-bold'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
                title={i18n._(msg`Dividir 65% Editor / 35% Canvas o Kanban`)}
              >
                65%
              </button>
            </div>
          )}

          {/* Normalización Segura button */}
          <button
            id="btn-markdown-normalizer"
            type="button"
            onClick={handleOpenNormalizer}
            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-950/60 text-sky-300 border border-sky-800/80 hover:bg-sky-900/80 cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0"
            title={i18n._(msg`Normalización segura de Markdown (Diff Git, AST y prevención de pérdidas)`)}
            aria-label={i18n._(msg`Normalización segura`)}
          >
            <span className="material-symbols-outlined text-[14px] text-sky-400">verified</span>
            <span className="hidden sm:inline">{i18n._(msg`Normalizar`)}</span>
          </button>

          {/* Sanitize Metadata Order (Description / ID / Status / Priority) */}
          <button
            id="btn-markdown-sanitize-order"
            type="button"
            onClick={handleSanitizeMetadataOrder}
            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-800/80 hover:bg-indigo-900/80 cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0"
            title={i18n._(msg`Sanitizar orden de metadatos (Description / ID / Status / Priority)`)}
            aria-label={i18n._(msg`Sanitizar orden`)}
          >
            <span className="material-symbols-outlined text-[14px] text-indigo-400">low_priority</span>
            <span className="hidden lg:inline">{i18n._(msg`Sanitizar`)}</span>
          </button>

          {/* Toggle Show/Hide Task IDs in Editor */}
          {onToggleShowTaskIds && (
            <button
              id="btn-markdown-toggle-ids"
              type="button"
              onClick={onToggleShowTaskIds}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0 ${
                showTaskIds !== false
                  ? 'bg-slate-800/40 text-slate-300 border-slate-700/80 hover:bg-slate-800/60'
                  : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
              title={
                showTaskIds !== false
                  ? i18n._(msg`Ocultar identificadores (id:) en el editor Markdown`)
                  : i18n._(msg`Mostrar identificadores (id:) en el editor Markdown`)
              }
              aria-label={
                showTaskIds !== false
                  ? i18n._(msg`Ocultar IDs en Markdown`)
                  : i18n._(msg`Mostrar IDs en Markdown`)
              }
            >
              <span className="material-symbols-outlined text-[13px]">tag</span>
              <span className="font-mono text-[10px] font-bold">#ID</span>
            </button>
          )}

          {/* Toggle Show/Hide Task Status in Editor */}
          {onToggleShowTaskStatus && (
            <button
              id="btn-markdown-toggle-status"
              type="button"
              onClick={onToggleShowTaskStatus}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0 ${
                showTaskStatus !== false
                  ? 'bg-cyan-950/40 text-cyan-300 border-cyan-800/80 hover:bg-cyan-900/60'
                  : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
              title={
                showTaskStatus !== false
                  ? i18n._(msg`Ocultar estado (Status:) en el editor Markdown`)
                  : i18n._(msg`Mostrar estado (Status:) en el editor Markdown`)
              }
              aria-label={
                showTaskStatus !== false
                  ? i18n._(msg`Ocultar Status en Markdown`)
                  : i18n._(msg`Mostrar Status en Markdown`)
              }
            >
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              <span className="font-mono text-[10px] font-bold">#Status</span>
            </button>
          )}

          {/* Toggle Show/Hide Task Priority in Editor */}
          {onToggleShowTaskPriority && (
            <button
              id="btn-markdown-toggle-priority"
              type="button"
              onClick={onToggleShowTaskPriority}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0 ${
                showTaskPriority !== false
                  ? 'bg-rose-950/40 text-rose-300 border-rose-800/80 hover:bg-rose-900/60'
                  : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
              title={
                showTaskPriority !== false
                  ? i18n._(msg`Ocultar prioridad (Priority:) en el editor Markdown`)
                  : i18n._(msg`Mostrar prioridad (Priority:) en el editor Markdown`)
              }
              aria-label={
                showTaskPriority !== false
                  ? i18n._(msg`Ocultar Priority en Markdown`)
                  : i18n._(msg`Mostrar Priority en Markdown`)
              }
            >
              <span className="material-symbols-outlined text-[13px]">flag</span>
              <span className="font-mono text-[10px] font-bold">#Prio</span>
            </button>
          )}

          {/* Toggle Hide/Show Completed Tasks in Editor */}
          <button
            id="btn-markdown-toggle-completed"
            type="button"
            onClick={handleToggleHideCompleted}
            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0 ${
              hideCompleted
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/80 hover:bg-emerald-900/60'
                : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
            }`}
            title={
              hideCompleted
                ? i18n._(msg`Mostrar tareas ya realizadas en el editor Markdown`)
                : i18n._(msg`Ocultar tareas ya realizadas en el editor Markdown`)
            }
            aria-label={
              hideCompleted
                ? i18n._(msg`Mostrar tareas realizadas en Markdown`)
                : i18n._(msg`Ocultar tareas realizadas en Markdown`)
            }
            aria-pressed={hideCompleted}
          >
            <span className="material-symbols-outlined text-[13px]">
              {hideCompleted ? 'visibility_off' : 'check_circle'}
            </span>
            <span className="font-mono text-[10px] font-bold">#Done</span>
            {hideCompleted && stats.completedTasks > 0 && (
              <span className="text-[9px] px-1 py-0 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/60 font-mono">
                {stats.completedTasks}
              </span>
            )}
          </button>

          {/* Dropdown to select which hidden item labels to show */}
          {(showTaskIds === false || showTaskStatus === false || showTaskPriority === false) && (
            <div className="relative shrink-0" ref={labelsDropdownRef}>
              <button
                id="btn-markdown-toggle-hidden-labels"
                type="button"
                onClick={handleToggleLabelsDropdown}
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition-colors flex items-center gap-1 shadow-xs shrink-0 ${
                  showHiddenLabels && (effectiveLabelTypes.id || effectiveLabelTypes.status || effectiveLabelTypes.priority)
                    ? 'bg-sky-950/40 text-sky-300 border-sky-800/80 hover:bg-sky-900/60'
                    : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline)] hover:text-[var(--on-surface)]'
                }`}
                title={i18n._(msg`Elegir qué etiquetas mostrar para items ocultos`)}
                aria-label={i18n._(msg`Elegir etiquetas de items ocultos`)}
                aria-expanded={isLabelsDropdownOpen}
                aria-haspopup="true"
              >
                <span className="material-symbols-outlined text-[13px]">
                  {showHiddenLabels && (effectiveLabelTypes.id || effectiveLabelTypes.status || effectiveLabelTypes.priority)
                    ? 'visibility'
                    : 'visibility_off'}
                </span>
                <span className="font-mono text-[10px] font-bold">Labels</span>
                <span className="material-symbols-outlined text-[12px] opacity-75">
                  {isLabelsDropdownOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {isLabelsDropdownOpen && (
                <div
                  id="menu-markdown-hidden-labels-dropdown"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'fixed',
                    top: `${dropdownPos.top}px`,
                    right: `${dropdownPos.right}px`,
                    zIndex: 9999,
                  }}
                  className="w-72 bg-[var(--surface-container-high)] border border-[var(--outline)] rounded-md shadow-xl p-2 flex flex-col gap-1.5 text-xs select-none"
                >
                  <div className="flex items-center justify-between pb-1 border-b border-[var(--outline)]">
                    <span className="font-semibold text-[var(--on-surface)] text-[11px] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-[var(--primary)]">label</span>
                      <span>{i18n._(msg`Mostrar etiquetas de:`)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsLabelsDropdownOpen(false)}
                      className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] text-[12px] p-0.5 rounded cursor-pointer leading-none"
                      title={i18n._(msg`Cerrar`)}
                      aria-label={i18n._(msg`Cerrar menú`)}
                    >
                      ✕
                    </button>
                  </div>

                  {/* ID Option */}
                  <label
                    id="label-opt-hidden-id"
                    className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer ${
                      effectiveLabelTypes.id
                        ? 'bg-[var(--primary)]/10 border-[var(--primary)]/35 text-[var(--on-surface)] shadow-2xs'
                        : 'border-transparent text-[var(--on-surface-variant)] opacity-75 hover:opacity-100 hover:bg-[var(--surface-container)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={effectiveLabelTypes.id}
                        onChange={() => handleToggleLabelType('id')}
                        className="sr-only"
                      />
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
                          effectiveLabelTypes.id
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                            : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {effectiveLabelTypes.id && (
                          <svg className="w-2.5 h-2.5 stroke-current stroke-[3]" fill="none" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded-[3px] text-[8px] font-mono leading-none bg-slate-500/10 text-slate-600 border border-slate-400/30 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/60 shrink-0 transition-opacity ${
                          effectiveLabelTypes.id ? 'opacity-100' : 'opacity-40 grayscale'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[8.5px]">tag</span>
                        <span>ID</span>
                      </span>
                      <span className={`text-[11px] truncate transition-colors ${effectiveLabelTypes.id ? 'font-medium text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'}`}>
                        {i18n._(msg`Identificador`)}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      {showTaskIds !== false && (
                        <span className="text-[9px] text-[var(--on-surface-variant)] italic">
                          ({i18n._(msg`no oculto`)})
                        </span>
                      )}
                      {effectiveLabelTypes.id ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                          <span className="material-symbols-outlined text-[10px]">check</span>
                          <span>{i18n._(msg`Activo`)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--surface-container-highest)]/50 text-[var(--on-surface-variant)] opacity-60 border border-[var(--outline)]/40">
                          <span>{i18n._(msg`Inactivo`)}</span>
                        </span>
                      )}
                    </div>
                  </label>

                  {/* Status Option */}
                  <label
                    id="label-opt-hidden-status"
                    className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer ${
                      effectiveLabelTypes.status
                        ? 'bg-[var(--primary)]/10 border-[var(--primary)]/35 text-[var(--on-surface)] shadow-2xs'
                        : 'border-transparent text-[var(--on-surface-variant)] opacity-75 hover:opacity-100 hover:bg-[var(--surface-container)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={effectiveLabelTypes.status}
                        onChange={() => handleToggleLabelType('status')}
                        className="sr-only"
                      />
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
                          effectiveLabelTypes.status
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                            : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {effectiveLabelTypes.status && (
                          <svg className="w-2.5 h-2.5 stroke-current stroke-[3]" fill="none" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded-[3px] text-[8px] font-mono leading-none bg-sky-100/50 text-sky-900 border border-sky-200/80 dark:bg-sky-950/30 dark:text-sky-200/90 dark:border-sky-700/40 shrink-0 transition-opacity ${
                          effectiveLabelTypes.status ? 'opacity-100' : 'opacity-40 grayscale'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[8.5px]">check_circle</span>
                        <span>Status</span>
                      </span>
                      <span className={`text-[11px] truncate transition-colors ${effectiveLabelTypes.status ? 'font-medium text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'}`}>
                        {i18n._(msg`Estado`)}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      {showTaskStatus !== false && (
                        <span className="text-[9px] text-[var(--on-surface-variant)] italic">
                          ({i18n._(msg`no oculto`)})
                        </span>
                      )}
                      {effectiveLabelTypes.status ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                          <span className="material-symbols-outlined text-[10px]">check</span>
                          <span>{i18n._(msg`Activo`)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--surface-container-highest)]/50 text-[var(--on-surface-variant)] opacity-60 border border-[var(--outline)]/40">
                          <span>{i18n._(msg`Inactivo`)}</span>
                        </span>
                      )}
                    </div>
                  </label>

                  {/* Priority Option */}
                  <label
                    id="label-opt-hidden-priority"
                    className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer ${
                      effectiveLabelTypes.priority
                        ? 'bg-[var(--primary)]/10 border-[var(--primary)]/35 text-[var(--on-surface)] shadow-2xs'
                        : 'border-transparent text-[var(--on-surface-variant)] opacity-75 hover:opacity-100 hover:bg-[var(--surface-container)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={effectiveLabelTypes.priority}
                        onChange={() => handleToggleLabelType('priority')}
                        className="sr-only"
                      />
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
                          effectiveLabelTypes.priority
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)] shadow-2xs'
                            : 'bg-[var(--surface)] border-[var(--outline)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {effectiveLabelTypes.priority && (
                          <svg className="w-2.5 h-2.5 stroke-current stroke-[3]" fill="none" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded-[3px] text-[8px] font-mono leading-none bg-rose-500/10 text-rose-400 border border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80 shrink-0 transition-opacity ${
                          effectiveLabelTypes.priority ? 'opacity-100' : 'opacity-40 grayscale'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[8.5px]">flag</span>
                        <span>Prio</span>
                      </span>
                      <span className={`text-[11px] truncate transition-colors ${effectiveLabelTypes.priority ? 'font-medium text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'}`}>
                        {i18n._(msg`Prioridad`)}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      {showTaskPriority !== false && (
                        <span className="text-[9px] text-[var(--on-surface-variant)] italic">
                          ({i18n._(msg`no oculto`)})
                        </span>
                      )}
                      {effectiveLabelTypes.priority ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                          <span className="material-symbols-outlined text-[10px]">check</span>
                          <span>{i18n._(msg`Activo`)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--surface-container-highest)]/50 text-[var(--on-surface-variant)] opacity-60 border border-[var(--outline)]/40">
                          <span>{i18n._(msg`Inactivo`)}</span>
                        </span>
                      )}
                    </div>
                  </label>

                  {/* Quick actions */}
                  <div className="pt-1 mt-0.5 border-t border-[var(--outline)] flex items-center justify-between text-[10px]">
                    <button
                      id="btn-hidden-labels-select-all"
                      type="button"
                      onClick={() => handleSetAllLabelTypes(true)}
                      className="text-[var(--primary)] hover:underline cursor-pointer font-medium"
                    >
                      {i18n._(msg`Mostrar todas`)}
                    </button>
                    <button
                      id="btn-hidden-labels-select-none"
                      type="button"
                      onClick={() => handleSetAllLabelTypes(false)}
                      className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:underline cursor-pointer"
                    >
                      {i18n._(msg`Ocultar todas`)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Copy Markdown */}
          <button
            id="btn-markdown-copy"
            type="button"
            onClick={handleCopy}
            className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
            title={copied ? i18n._(msg`¡Copiado!`) : i18n._(msg`Copiar todo el Markdown`)}
            aria-label={i18n._(msg`Copiar Markdown`)}
          >
            <span className="material-symbols-outlined text-[15px]">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>

          {/* Download file */}
          <button
            id="btn-markdown-export"
            type="button"
            onClick={onExport}
            className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
            title={i18n._(msg`Descargar archivo .md`)}
            aria-label={i18n._(msg`Descargar archivo .md`)}
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
          </button>

          <div id="div-markdownspliteditor-6" className="w-px h-3.5 bg-[var(--outline)] my-auto mx-0.5" />

          {/* Close split view */}
          <button
            id="btn-markdown-close-split"
            type="button"
            onClick={onClose}
            className="btn-m3-icon w-7 h-7 text-[var(--on-surface-variant)] hover:text-rose-400 cursor-pointer"
            title={i18n._(msg`Cerrar visor en tiempo real`)}
            aria-label={i18n._(msg`Cerrar visor en tiempo real`)}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* Markdown Snippet & Structure Toolbar */}
      <div id="div-markdownspliteditor-7" className="px-2.5 py-1.5 bg-[var(--surface)] border-b border-[var(--outline)] flex items-center justify-between gap-1 overflow-x-auto select-none shrink-0">
        <div id="div-markdownspliteditor-8" className="flex items-center gap-1 shrink-0">
          <button
            id="btn-markdown-insert-task"
            type="button"
            onClick={() => {
              const nextId = generateUniqueTaskId('', value);
              const snippet = `\n- [ ] \n  - Description: \n  - ID: ${nextId}\n  - Status: backlog\n  - Priority: P3\n`;
              insertText(snippet, '\n- [ ] '.length);
            }}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-[var(--on-surface)] flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar nueva tarea pendiente (- [ ])`)}
          >
            <span className="text-sky-400 font-bold">+</span>
            <span>- [ ] {i18n._(msg`Tarea`)}</span>
          </button>

          <button
            id="btn-markdown-insert-section"
            type="button"
            onClick={() => {
              const nextId = generateUniqueTaskId('', value);
              const snippet = `\n## Nueva Sección\n\n- [ ] \n  - Description: \n  - ID: ${nextId}\n  - Status: backlog\n  - Priority: P3\n`;
              insertText(snippet, '\n## Nueva Sección\n\n- [ ] '.length);
            }}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-[var(--on-surface)] flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar nueva sección (## Sección)`)}
          >
            <span className="text-purple-400 font-bold">##</span>
            <span>{i18n._(msg`Sección`)}</span>
          </button>

          <button
            id="btn-markdown-insert-comment"
            type="button"
            onClick={() => insertText('\n## Comentarios\n- ')}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar sección de comentarios / notas adhesivas (## Comentarios)`)}
          >
            <span className="material-symbols-outlined text-[13px]">sticky_note_2</span>
            <span>{i18n._(msg`Comentario`)}</span>
          </button>

          <div id="div-markdownspliteditor-9" className="w-px h-3.5 bg-[var(--outline)] mx-1" />

          {/* Quick Priorities */}
          <div id="div-markdownspliteditor-10" className="flex items-center gap-0.5">
            <button
              id="btn-markdown-insert-p0"
              type="button"
              onClick={() => insertText('  - Priority: P0\n')}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/60 text-rose-300 border border-rose-800/80 hover:bg-rose-900/80 cursor-pointer"
              title={i18n._(msg`Insertar Priority: P0 (Crítica)`)}
            >
              P0
            </button>
            <button
              id="btn-markdown-insert-p1"
              type="button"
              onClick={() => insertText('  - Priority: P1\n')}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/60 text-amber-300 border border-amber-800/80 hover:bg-amber-900/80 cursor-pointer"
              title={i18n._(msg`Insertar Priority: P1 (Alta)`)}
            >
              P1
            </button>
            <button
              id="btn-markdown-insert-p2"
              type="button"
              onClick={() => insertText('  - Priority: P2\n')}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-950/60 text-blue-300 border border-blue-800/80 hover:bg-blue-900/80 cursor-pointer"
              title={i18n._(msg`Insertar Priority: P2 (Media)`)}
            >
              P2
            </button>
            <button
              id="btn-markdown-insert-p3"
              type="button"
              onClick={() => insertText('  - Priority: P3\n')}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800/80 text-slate-300 border border-slate-700/80 hover:bg-slate-700/80 cursor-pointer"
              title={i18n._(msg`Insertar Priority: P3 (Baja)`)}
            >
              P3
            </button>
          </div>

          <div id="div-markdownspliteditor-11" className="w-px h-3.5 bg-[var(--outline)] mx-1" />

          <button
            id="btn-markdown-insert-blocked-by"
            type="button"
            onClick={() => insertText('  - Blocked by: id-tarea\n')}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar dependencia (Blocked by: id)`)}
          >
            <span className="material-symbols-outlined text-[13px]">lock</span>
            <span>Blocked by</span>
          </button>

          <button
            id="btn-markdown-insert-tags"
            type="button"
            onClick={() => insertText('  - Tags: frontend, auth\n')}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-sky-300 flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar etiquetas (Tags: ...)`)}
          >
            <span className="material-symbols-outlined text-[13px]">label</span>
            <span>Tags</span>
          </button>
        </div>

        {/* Problems Indicator Toggle */}
        {validationReport.issues.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              id="btn-markdown-toggle-issues"
              type="button"
              onClick={() => setShowIssuesPanel((prev) => !prev)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 cursor-pointer shrink-0 transition-colors ${
                validationReport.hasErrors
                  ? 'bg-rose-950/80 text-rose-300 border-rose-700 animate-pulse'
                  : 'bg-amber-950/80 text-amber-300 border-amber-700'
              }`}
              title={i18n._(msg`Ver/Ocultar problemas detectados en el Markdown`)}
            >
              <span>⚠</span>
              <span>{plural(validationReport.issues.length, { one: '# problema', other: '# problemas' })}</span>
            </button>

            {validationReport.duplicateIds.size > 0 && (
              <button
                id="btn-markdown-resolve-duplicate-ids"
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('antask:resolve-duplicate-ids'));
                }}
                className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                title={i18n._(msg`Resolver IDs duplicados asignando identificadores únicos`)}
              >
                <span className="material-symbols-outlined text-[11px]">auto_fix_high</span>
                <span>{i18n._(msg`Resolver IDs duplicados (${validationReport.duplicateIds.size})`)}</span>
              </button>
            )}

            {validationReport.missingIdTaskIds.size > 0 && (
              <button
                id="btn-markdown-auto-assign-all-ids"
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('antask:auto-assign-all-ids'));
                }}
                className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                title={i18n._(msg`Generar y asignar IDs automáticos a todas las tareas sin ID`)}
              >
                <span className="material-symbols-outlined text-[11px]">auto_fix_high</span>
                <span>{i18n._(msg`Generar IDs (${validationReport.missingIdTaskIds.size})`)}</span>
              </button>
            )}

            {validationReport.missingStatusTaskIds.size > 0 && (
              <button
                id="btn-markdown-auto-assign-all-statuses"
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('antask:auto-assign-all-statuses'));
                }}
                className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                title={i18n._(msg`Asignar estado a todas las tareas sin estado`)}
              >
                <span className="material-symbols-outlined text-[11px]">check_circle</span>
                <span>{i18n._(msg`Asignar Status (${validationReport.missingStatusTaskIds.size})`)}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Embedded Issues Drawer (if active) */}
      {showIssuesPanel && validationReport.issues.length > 0 && (
        <div id="div-markdownspliteditor-12" className="bg-[var(--surface-container-high)] border-b border-[var(--outline)] p-2 max-h-36 overflow-y-auto flex flex-col gap-1.5 select-none shrink-0 animate-slide-down">
          <div id="div-markdownspliteditor-13" className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider">
              {i18n._(msg`Diagnósticos de sincronización`)}
            </span>
            <button
              id="btn-markdown-close-issues"
              type="button"
              onClick={() => setShowIssuesPanel(false)}
              className="text-[10px] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
            >
              {i18n._(msg`Cerrar`)}
            </button>
          </div>
          {validationReport.issues.map((issue: MarkdownIssue) => (
            <div
              id={`div-markdown-issue-${issue.id}`}
              key={issue.id}
              onClick={() => {
                if (issue.lineIndex !== undefined) {
                  jumpToLine(issue.lineIndex);
                }
              }}
              className="p-1.5 rounded bg-[var(--surface)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] flex items-center justify-between gap-2 text-xs font-mono cursor-pointer transition-colors"
              title={i18n._(msg`Clic para saltar a esta línea en el editor`)}
            >
              <div id="div-markdownspliteditor-14" className="flex items-center gap-1.5 truncate">
                <span
                  className={
                    issue.severity === 'error'
                      ? 'text-rose-400 font-bold'
                      : issue.severity === 'warning'
                      ? 'text-amber-400 font-bold'
                      : 'text-sky-400'
                  }
                >
                  {issue.severity === 'error' ? '✖' : '⚠'}
                </span>
                <span className="truncate text-[var(--on-surface)] text-[11px]">
                  {issue.message}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {issue.type === 'duplicate_id' && (
                  <button
                    id={`btn-issue-resolve-dup-${issue.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('antask:resolve-single-duplicate-id', {
                          detail: { lineIndex: issue.lineIndex, taskId: issue.taskId, taskTitle: issue.taskTitle },
                        })
                      );
                    }}
                    className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 border border-rose-500/50 cursor-pointer transition-colors flex items-center gap-0.5"
                    title={i18n._(msg`Resolver ID duplicado asignando identificador único`)}
                  >
                    <span className="material-symbols-outlined text-[10px]">auto_fix_high</span>
                    <span>{i18n._(msg`Resolver`)}</span>
                  </button>
                )}
                {issue.type === 'missing_id' && (
                  <button
                    id={`btn-issue-assign-id-${issue.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('antask:assign-task-id', {
                          detail: { taskId: issue.taskId || issue.lineIndex, taskTitle: issue.taskTitle },
                        })
                      );
                    }}
                    className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-500/50 cursor-pointer transition-colors flex items-center gap-0.5"
                    title={i18n._(msg`Asignar ID automático a esta tarea`)}
                  >
                    <span>+ ID</span>
                  </button>
                )}
                {issue.type === 'missing_status' && (
                  <button
                    id={`btn-issue-assign-status-${issue.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('antask:assign-task-status', {
                          detail: { taskId: issue.taskId, taskTitle: issue.taskTitle },
                        })
                      );
                    }}
                    className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-500/50 cursor-pointer transition-colors flex items-center gap-0.5"
                    title={i18n._(msg`Asignar estado obligatorio a esta tarea`)}
                  >
                    <span>+ Status</span>
                  </button>
                )}
                {issue.lineIndex !== undefined && (
                  <span className="text-[10px] text-[var(--on-surface-variant)] shrink-0 px-1 py-0.2 rounded bg-[var(--surface-container)]">
                    L{issue.lineIndex + 1}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main CodeMirror Editor Area */}
      <div id="div-markdownspliteditor-15" className="flex-1 w-full h-full overflow-auto bg-[var(--surface)] text-xs font-mono">
        <CodeMirror
          ref={editorRef}
          value={value}
          height="100%"
          extensions={extensions}
          onChange={handleChange}
          theme={theme === 'dark' ? oneDark : 'light'}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            history: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: true,
            historyKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
          className="h-full antask-codemirror text-[12px] leading-relaxed"
        />
      </div>

      {/* Status Bar */}
      <div id="div-markdownspliteditor-16" className="h-7 px-3 bg-[var(--surface-container-high)] border-t border-[var(--outline)] flex items-center justify-between text-[11px] font-mono text-[var(--on-surface-variant)] select-none shrink-0">
        <div id="div-markdownspliteditor-17" className="flex items-center gap-3">
          <span>
            {i18n._(msg`Tareas`)}: <strong className="text-[var(--on-surface)]">{stats.totalTasks}</strong> (
            <span className="text-emerald-400">
              {stats.completedTasks} {hideCompleted ? i18n._(msg`completadas (ocultas)`) : i18n._(msg`completadas`)}
            </span> /{' '}
            <span className="text-amber-400">{stats.pendingTasks} {i18n._(msg`pendientes`)}</span>)
          </span>
          <span className="hidden sm:inline">
            {i18n._(msg`Secciones`)}: <strong className="text-[var(--on-surface)]">{stats.sections}</strong>
          </span>
          {stats.criticalCount > 0 && (
            <span className="text-rose-400 font-bold hidden md:inline">
              P0: {stats.criticalCount}
            </span>
          )}
        </div>

        <div id="div-markdownspliteditor-18" className="flex items-center gap-3">
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span className="hidden sm:inline">UTF-8</span>
          <span className="hidden md:inline">Markdown</span>
        </div>
      </div>

      {/* Safe Markdown Normalizer Modal */}
      {isLocalNormalizerOpen && (
        <SafeMarkdownNormalizerModal
          isOpen={isLocalNormalizerOpen}
          documentTitle={fileName}
          originalMarkdown={value}
          theme={theme}
          onClose={() => setIsLocalNormalizerOpen(false)}
          onApply={(normalizedMd) => {
            onChange(normalizedMd);
          }}
          onShowToast={onShowToast}
        />
      )}
    </aside>
  );
}
