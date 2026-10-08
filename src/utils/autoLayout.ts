import { applyExcalidrawAutoLayout } from '../excalidraw/excalidrawManager';

export interface AutoLayoutResult {
  taskCount: number;
  groupCount: number;
}

/**
 * Automatically computes a clean, hierarchical DAG layout for all groups and tasks
 * placing blockers above blocked tasks, preventing overlaps, and sizing groups appropriately.
 */
export function applyAutoLayout(canvasOrApi: any, markdown: string): AutoLayoutResult {
  if (!canvasOrApi) return { taskCount: 0, groupCount: 0 };

  // Excalidraw Imperative API
  if (typeof canvasOrApi.getSceneElements === 'function') {
    const elements = canvasOrApi.getSceneElements();
    const { updatedElements, taskCount, groupCount } = applyExcalidrawAutoLayout(elements, markdown);
    canvasOrApi.updateScene({ elements: updatedElements });
    if (typeof canvasOrApi.scrollToContent === 'function') {
      setTimeout(() => {
        canvasOrApi.scrollToContent(undefined, { fitToViewport: true, animate: true });
      }, 50);
    }
    return { taskCount, groupCount };
  }

  return { taskCount: 0, groupCount: 0 };
}

export { applyExcalidrawAutoLayout };
