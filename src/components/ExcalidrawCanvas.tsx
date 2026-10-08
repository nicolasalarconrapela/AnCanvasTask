import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import {
  buildExcalidrawElementsFromTasks,
  extractVisualStateFromExcalidrawElements,
  applyExcalidrawAutoLayout,
  connectExcalidrawTasksWithArrow,
  CARD_WIDTH,
  CARD_HEIGHT,
} from '../excalidraw/excalidrawManager';
import { CanvasVisualDocument, TaskVisualState, GroupVisualState } from '../services/sanityService';
import { ParsedGroup, parseTasksMarkdown } from '../shapes/TaskShapeUtil';
import { TaskFilterState } from './FilterBar';
import { hasActiveFilters, isTaskMatchingFilters } from '../utils/filterStore';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';

export interface ExcalidrawCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  zoomToFit: () => void;
  applyLayout: (markdown?: string) => { taskCount: number; groupCount: number };
  focusTask: (taskId: string) => boolean;
  focusSection: (sectionTitle: string) => boolean;
  getSceneElements: () => readonly any[];
  updateSceneElements: (elements: readonly any[]) => void;
  getImperativeAPI: () => any;
}

interface ExcalidrawCanvasProps {
  markdown: string;
  visualState?: CanvasVisualDocument | null;
  effectiveTheme: 'dark' | 'light';
  taskFilters: TaskFilterState;
  searchQuery: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onOpenTaskDetails: (taskId: string) => void;
  onOpenNewTaskModal?: (groupTitle?: string) => void;
  onVisualChange?: (visualState: { tasks: TaskVisualState[]; groups: GroupVisualState[] }) => void;
  onMarkdownChange?: (newMarkdown: string) => void;
  onToggleTaskCompletion?: (taskId: string) => void;
}

export const ExcalidrawCanvas = forwardRef<ExcalidrawCanvasHandle, ExcalidrawCanvasProps>(
  (
    {
      markdown,
      visualState,
      effectiveTheme,
      taskFilters,
      searchQuery,
      selectedTaskId,
      onSelectTask,
      onOpenTaskDetails,
      onOpenNewTaskModal,
      onVisualChange,
      onMarkdownChange,
      onToggleTaskCompletion,
    },
    ref
  ) => {
    const { i18n } = useLingui();
    const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
    const [elements, setElements] = useState<readonly any[]>([]);
    const [zoomLevel, setZoomLevel] = useState<number>(100);
    const isInternalUpdateRef = useRef<boolean>(false);
    const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isDark = effectiveTheme === 'dark';

    // 1. Synchronize Excalidraw elements whenever markdown or visualState changes
    useEffect(() => {
      const parsedGroups: ParsedGroup[] = parseTasksMarkdown(markdown);
      const newElements = buildExcalidrawElementsFromTasks(
        parsedGroups,
        visualState,
        markdown,
        isDark
      );

      // Apply filtering visibility / opacity
      const isFilterActive = hasActiveFilters(taskFilters, searchQuery);
      const filteredElements = newElements.map((el) => {
        if (el.customData?.type === 'task') {
          const t = el.customData;
          const normalizedStatus = t.completed ? 'done' : t.status || 'todo';
          const matches = !isFilterActive || isTaskMatchingFilters(
            {
              title: t.title,
              taskId: t.taskId,
              completed: t.completed,
              priority: t.priority,
              status: normalizedStatus,
              groupTitle: t.groupTitle,
              tags: t.tags,
              blockedBy: t.blockedBy,
            },
            taskFilters,
            searchQuery
          );

          if (!matches) {
            return {
              ...el,
              opacity: 15,
            };
          }
        }
        return el;
      });

      setElements(filteredElements);

      if (excalidrawAPI) {
        isInternalUpdateRef.current = true;
        excalidrawAPI.updateScene({ elements: filteredElements });
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, 50);
      }
    }, [markdown, visualState, isDark, taskFilters, searchQuery, excalidrawAPI]);

    // 2. Handle scene changes (drag, move, resize)
    const handleChange = useCallback(
      (sceneElements: readonly any[], appState: any) => {
        if (isInternalUpdateRef.current) return;

        // Update zoom level indicator
        if (appState?.zoom?.value) {
          const z = Math.round(appState.zoom.value * 100);
          setZoomLevel((prev) => (prev !== z ? z : prev));
        }

        // Selection & Checkbox click detection
        const selectedElementIds = appState?.selectedElementIds || {};
        const selectedIds = Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]);

        if (selectedIds.length === 1) {
          const selId = selectedIds[0];
          const elem = sceneElements.find((e) => e.id === selId);

          // If user clicked the checkbox or checkmark icon
          if (
            (elem?.customData?.type === 'task_checkbox' || elem?.customData?.type === 'task_check_icon') &&
            elem.customData.taskId &&
            onToggleTaskCompletion
          ) {
            onToggleTaskCompletion(elem.customData.taskId);
            return;
          }

          const tId = elem?.customData?.taskId || elem?.customData?.temporaryId;
          if (tId) {
            onSelectTask(tId);
          }
        } else if (selectedIds.length === 0) {
          onSelectTask(null);
        }

        // Debounced visual state extraction & save
        if (onVisualChange) {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
          }
          saveDebounceTimerRef.current = setTimeout(() => {
            const visual = extractVisualStateFromExcalidrawElements(sceneElements);
            onVisualChange(visual);
          }, 300);
        }
      },
      [onSelectTask, onVisualChange, onToggleTaskCompletion]
    );

    // 3. Expose imperative commands via forwardRef
    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          if (!excalidrawAPI) return;
          const currentZoom = excalidrawAPI.getAppState()?.zoom?.value || 1;
          const nextZoom = Math.min(3, currentZoom + 0.2);
          excalidrawAPI.setAppState({ zoom: { value: nextZoom } });
          setZoomLevel(Math.round(nextZoom * 100));
        },
        zoomOut: () => {
          if (!excalidrawAPI) return;
          const currentZoom = excalidrawAPI.getAppState()?.zoom?.value || 1;
          const nextZoom = Math.max(0.2, currentZoom - 0.2);
          excalidrawAPI.setAppState({ zoom: { value: nextZoom } });
          setZoomLevel(Math.round(nextZoom * 100));
        },
        resetZoom: () => {
          if (!excalidrawAPI) return;
          excalidrawAPI.setAppState({ zoom: { value: 1 } });
          setZoomLevel(100);
        },
        zoomToFit: () => {
          if (!excalidrawAPI) return;
          excalidrawAPI.scrollToContent(undefined, { fitToViewport: true, animate: true });
        },
        applyLayout: (md?: string) => {
          if (!excalidrawAPI) return { taskCount: 0, groupCount: 0 };
          const sceneElems = excalidrawAPI.getSceneElements();
          const targetMd = md || markdown;
          const { updatedElements, taskCount, groupCount } = applyExcalidrawAutoLayout(sceneElems, targetMd);
          isInternalUpdateRef.current = true;
          excalidrawAPI.updateScene({ elements: updatedElements });
          setTimeout(() => {
            excalidrawAPI.scrollToContent(undefined, { fitToViewport: true, animate: true });
            isInternalUpdateRef.current = false;
          }, 50);
          return { taskCount, groupCount };
        },
        focusTask: (taskId: string) => {
          if (!excalidrawAPI || !taskId) return false;
          const sceneElems = excalidrawAPI.getSceneElements();
          const target = sceneElems.find(
            (e: any) =>
              !e.isDeleted &&
              e.type === 'rectangle' &&
              e.customData?.type === 'task' &&
              e.customData.taskId?.toLowerCase() === taskId.toLowerCase()
          );
          if (target) {
            excalidrawAPI.scrollToContent(target, { fitToViewport: true, animate: true });
            excalidrawAPI.setAppState({
              selectedElementIds: { [target.id]: true },
            });
            return true;
          }
          return false;
        },
        focusSection: (sectionTitle: string) => {
          if (!excalidrawAPI || !sectionTitle) return false;
          const sceneElems = excalidrawAPI.getSceneElements();
          const target = sceneElems.find(
            (e: any) =>
              !e.isDeleted &&
              e.type === 'rectangle' &&
              e.customData?.type === 'group' &&
              e.customData.groupTitle?.toLowerCase() === sectionTitle.toLowerCase()
          );
          if (target) {
            excalidrawAPI.scrollToContent(target, { fitToViewport: true, animate: true });
            excalidrawAPI.setAppState({
              selectedElementIds: { [target.id]: true },
            });
            return true;
          }
          return false;
        },
        getSceneElements: () => {
          if (!excalidrawAPI) return [];
          return excalidrawAPI.getSceneElements();
        },
        updateSceneElements: (newElems: readonly any[]) => {
          if (!excalidrawAPI) return;
          isInternalUpdateRef.current = true;
          excalidrawAPI.updateScene({ elements: newElems });
          setTimeout(() => {
            isInternalUpdateRef.current = false;
          }, 50);
        },
        getImperativeAPI: () => excalidrawAPI,
      }),
      [excalidrawAPI, markdown]
    );

    // Double-click handler on canvas
    const handleCanvasDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        if (!excalidrawAPI) return;
        const appState = excalidrawAPI.getAppState();
        const selectedIds = Object.keys(appState?.selectedElementIds || {}).filter(
          (id) => appState.selectedElementIds[id]
        );

        if (selectedIds.length === 1) {
          const target = excalidrawAPI
            .getSceneElements()
            .find((el: any) => el.id === selectedIds[0]);
          const tid = target?.customData?.taskId || target?.customData?.temporaryId;
          if (tid) {
            onOpenTaskDetails(tid);
          }
        }
      },
      [excalidrawAPI, onOpenTaskDetails]
    );

    return (
      <div
        id="excalidraw-canvas-wrapper"
        className="relative w-full h-full overflow-hidden flex flex-col bg-[var(--surface)]"
        onDoubleClick={handleCanvasDoubleClick}
      >
        <Excalidraw
          excalidrawAPI={(api) => {
            setExcalidrawAPI(api);
          }}
          initialData={{
            elements,
            appState: {
              theme: isDark ? 'dark' : 'light',
              viewBackgroundColor: isDark ? '#0d1117' : '#ffffff',
              currentItemFontFamily: 2,
              zenModeEnabled: false,
              gridSize: 20,
            },
          }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
            },
          }}
        />

        {/* Floating Canvas Navigation & Zoom Controls */}
        <div
          id="div-app-24"
          className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 sm:gap-1 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md p-1 shadow-sm select-none"
        >
          <button
            id="btn-canvas-zoom-out"
            type="button"
            onClick={() => {
              if (excalidrawAPI) {
                const z = Math.max(0.2, (excalidrawAPI.getAppState()?.zoom?.value || 1) - 0.2);
                excalidrawAPI.setAppState({ zoom: { value: z } });
                setZoomLevel(Math.round(z * 100));
              }
            }}
            className="btn-m3-icon w-7 h-7 cursor-pointer hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] rounded"
            title={i18n._(msg`Alejar zoom`)}
            aria-label={i18n._(msg`Alejar zoom`)}
          >
            <span className="material-symbols-outlined text-[16px]">remove</span>
          </button>

          <button
            id="btn-canvas-zoom-reset"
            type="button"
            onClick={() => {
              if (excalidrawAPI) {
                excalidrawAPI.setAppState({ zoom: { value: 1 } });
                setZoomLevel(100);
              }
            }}
            className="px-2 py-0.5 text-xs font-mono font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] rounded cursor-pointer transition-colors"
            title={i18n._(msg`Restablecer zoom al 100%`)}
            aria-label={i18n._(msg`Restablecer zoom al 100%`)}
          >
            {zoomLevel}%
          </button>

          <button
            id="btn-canvas-zoom-in"
            type="button"
            onClick={() => {
              if (excalidrawAPI) {
                const z = Math.min(3, (excalidrawAPI.getAppState()?.zoom?.value || 1) + 0.2);
                excalidrawAPI.setAppState({ zoom: { value: z } });
                setZoomLevel(Math.round(z * 100));
              }
            }}
            className="btn-m3-icon w-7 h-7 cursor-pointer hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] rounded"
            title={i18n._(msg`Acercar zoom`)}
            aria-label={i18n._(msg`Acercar zoom`)}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
          </button>

          <div className="w-px h-4 bg-[var(--outline)] my-auto mx-0.5" />

          <button
            id="btn-canvas-zoom-fit"
            type="button"
            onClick={() => {
              if (excalidrawAPI) {
                excalidrawAPI.scrollToContent(undefined, { fitToViewport: true, animate: true });
              }
            }}
            className="btn-m3-icon w-7 h-7 cursor-pointer hover:bg-[var(--surface-container-high)] text-[var(--on-surface)] rounded"
            title={i18n._(msg`Ajustar contenido a la pantalla`)}
            aria-label={i18n._(msg`Ajustar a la pantalla`)}
          >
            <span className="material-symbols-outlined text-[16px]">fit_screen</span>
          </button>
        </div>
      </div>
    );
  }
);
