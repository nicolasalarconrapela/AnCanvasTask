import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef, ExternalChange, Transaction } from '@uiw/react-codemirror';
import { diffChars } from 'diff';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import {
  MarkdownIssue,
  MarkdownValidationReport,
  validateMarkdownDocument,
} from '../utils/markdownSync';
import { SafeMarkdownNormalizerModal } from './SafeMarkdownNormalizerModal';

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
}: MarkdownSplitEditorProps) {
  const { i18n } = useLingui();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [copied, setCopied] = useState(false);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);
  const [isLocalNormalizerOpen, setIsLocalNormalizerOpen] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const sectionLines = lines.filter((l) => l.trim().startsWith('## '));
    const p0Lines = lines.filter((l) => l.toLowerCase().includes('priority: p0'));

    return {
      totalTasks: taskLines.length,
      completedTasks: completedLines.length,
      pendingTasks: taskLines.length - completedLines.length,
      sections: sectionLines.length,
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
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onShowToast(i18n._(msg`Markdown copiado al portapapeles`), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast(i18n._(msg`Error al copiar al portapapeles`), 'error');
    }
  }, [value, onShowToast, i18n]);

  // Open safe normalization dialog
  const handleOpenNormalizer = useCallback(() => {
    if (onOpenNormalizer) {
      onOpenNormalizer();
    } else {
      setIsLocalNormalizerOpen(true);
    }
  }, [onOpenNormalizer]);

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

  const extensions = useMemo(() => {
    return [
      markdown(),
      cursorTrackerPlugin,
      EditorView.lineWrapping,
    ];
  }, [cursorTrackerPlugin]);

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
        <div id="div-markdownspliteditor-4" className="flex items-center gap-1.5 shrink-0">
          {/* Preset Ratio Selector (35% / 50% / 65%) */}
          {onChangeSplitRatio && (
            <div id="div-markdownspliteditor-5" className="hidden sm:flex items-center bg-[var(--surface-container)] p-0.5 rounded border border-[var(--outline)] text-[10px]">
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
            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-950/60 text-sky-300 border border-sky-800/80 hover:bg-sky-900/80 cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
            title={i18n._(msg`Normalización segura de Markdown (Diff Git, AST y prevención de pérdidas)`)}
            aria-label={i18n._(msg`Normalización segura`)}
          >
            <span className="material-symbols-outlined text-[14px] text-sky-400">verified</span>
            <span className="hidden sm:inline">{i18n._(msg`Normalizar`)}</span>
          </button>

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
            onClick={() => insertText('\n- [ ] Nueva tarea\n  - Priority: P1\n')}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-[var(--on-surface)] flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar nueva tarea pendiente (- [ ])`)}
          >
            <span className="text-sky-400 font-bold">+</span>
            <span>- [ ] {i18n._(msg`Tarea`)}</span>
          </button>

          <button
            id="btn-markdown-insert-section"
            type="button"
            onClick={() => insertText('\n## Nueva Sección\n\n- [ ] Tarea inicial\n  - Priority: P1\n')}
            className="px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-highest)] border border-[var(--outline)] text-[11px] font-mono text-[var(--on-surface)] flex items-center gap-1 cursor-pointer transition-colors"
            title={i18n._(msg`Insertar nueva sección (## Sección)`)}
          >
            <span className="text-purple-400 font-bold">##</span>
            <span>{i18n._(msg`Sección`)}</span>
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
            <span className="text-emerald-400">{stats.completedTasks} {i18n._(msg`completadas`)}</span> /{' '}
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
