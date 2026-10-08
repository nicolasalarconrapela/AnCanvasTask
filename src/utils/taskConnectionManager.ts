export interface ConnectionPointAnchor {
  x: number;
  y: number;
  positionName: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface ActiveConnectionSource {
  shapeId: string;
  taskId: string;
  title: string;
  anchor: ConnectionPointAnchor;
}

type ConnectionListener = (source: ActiveConnectionSource | null) => void;

let currentSource: ActiveConnectionSource | null = null;
const listeners = new Set<ConnectionListener>();

export function getActiveConnectionSource(): ActiveConnectionSource | null {
  return currentSource;
}

export function setActiveConnectionSource(source: ActiveConnectionSource | null) {
  currentSource = source;
  listeners.forEach((fn) => {
    try {
      fn(source);
    } catch (e) {
      console.error('Error in connection listener', e);
    }
  });
}

export function subscribeToConnectionSource(listener: ConnectionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Creates an Excalidraw arrow element between two task cards.
 */
export function connectExcalidrawTasksWithArrow(
  elements: readonly any[],
  sourceTaskId: string,
  targetTaskId: string,
  onDependencyCreated?: (blockerTaskId: string, blockedTaskId: string) => void
): { updatedElements: any[]; arrowId: string | null } {
  if (sourceTaskId.toLowerCase() === targetTaskId.toLowerCase()) {
    return { updatedElements: [...elements], arrowId: null };
  }

  const sourceElem = elements.find(
    (e) => !e.isDeleted && e.type === 'rectangle' && e.customData?.type === 'task' && e.customData.taskId?.toLowerCase() === sourceTaskId.toLowerCase()
  );
  const targetElem = elements.find(
    (e) => !e.isDeleted && e.type === 'rectangle' && e.customData?.type === 'task' && e.customData.taskId?.toLowerCase() === targetTaskId.toLowerCase()
  );

  if (!sourceElem || !targetElem) {
    return { updatedElements: [...elements], arrowId: null };
  }

  const startX = sourceElem.x + sourceElem.width / 2;
  const startY = sourceElem.y + sourceElem.height;
  const endX = targetElem.x + targetElem.width / 2;
  const endY = targetElem.y;

  const dx = endX - startX;
  const dy = endY - startY;

  const arrowId = `arrow_${sourceTaskId}_to_${targetTaskId}_${Date.now()}`;

  const newArrow = {
    id: arrowId,
    type: 'arrow',
    x: startX,
    y: startY,
    width: Math.abs(dx) || 1,
    height: Math.abs(dy) || 1,
    angle: 0,
    strokeColor: '#94a3b8',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 90,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Date.now(),
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
      elementId: sourceElem.id,
      focus: 0,
      gap: 4,
    },
    endBinding: {
      elementId: targetElem.id,
      focus: 0,
      gap: 4,
    },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: true,
    customData: {
      type: 'dependency_arrow',
      fromTaskId: sourceTaskId,
      toTaskId: targetTaskId,
    },
  };

  // Update target element's blockedBy metadata
  const existingBlockedBy = targetElem.customData?.blockedBy || '';
  const currentList = existingBlockedBy
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

  let updatedTarget = targetElem;
  if (!currentList.includes(sourceTaskId.toLowerCase())) {
    const updatedBlockedBy = existingBlockedBy
      ? `${existingBlockedBy}, ${sourceTaskId}`
      : sourceTaskId;

    updatedTarget = {
      ...targetElem,
      customData: {
        ...targetElem.customData,
        blockedBy: updatedBlockedBy,
        status: targetElem.customData.status === 'done' ? 'done' : 'blocked',
      },
      version: (targetElem.version || 1) + 1,
      versionNonce: Date.now(),
    };

    if (onDependencyCreated) {
      onDependencyCreated(sourceTaskId, targetTaskId);
    }
  }

  const updatedElements = elements
    .map((el) => (el.id === targetElem.id ? updatedTarget : el))
    .concat(newArrow);

  return { updatedElements, arrowId };
}

export function connectTasksWithArrow(
  _editor: any,
  _source: any,
  _target: any,
  _onDependencyCreated?: any
): string | null {
  return null;
}
