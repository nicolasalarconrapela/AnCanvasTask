import dagre from 'dagre';
import { Editor, createShapeId } from 'tldraw';
import { scanTaskBlocks } from './markdownSync';

export interface AutoLayoutResult {
  taskCount: number;
  groupCount: number;
}

/**
 * Automatically computes a clean, hierarchical DAG layout for all groups and tasks
 * placing blockers above blocked tasks, preventing overlaps, and sizing groups appropriately.
 */
export function applyAutoLayout(editor: Editor, markdown: string): AutoLayoutResult {
  const { taskBlocks, groupHeadings, parentHeadings } = scanTaskBlocks(markdown);
  const shapes = editor.getCurrentPageShapes();

  // Find all task shapes and task-group shapes
  const taskShapes = shapes.filter((s) => (s as any).type === 'task') as any[];
  const groupShapes = shapes.filter((s) => (s as any).type === 'task-group') as any[];

  if (taskShapes.length === 0 && groupShapes.length === 0) {
    return { taskCount: 0, groupCount: 0 };
  }

  // Map normalized taskId -> taskShape
  const taskIdToShapeMap = new Map<string, any>();
  taskShapes.forEach((s) => {
    const tid = s.props?.taskId;
    if (tid) {
      taskIdToShapeMap.set(tid.toLowerCase(), s);
    }
  });

  // Map normalized groupTitle -> groupShape
  const groupTitleToShapeMap = new Map<string, any>();
  groupShapes.forEach((g) => {
    const title = g.props?.title;
    if (title) {
      groupTitleToShapeMap.set(title.toLowerCase(), g);
    }
  });

  // Organize tasks by group
  const tasksByGroup = new Map<string, typeof taskBlocks>();
  const headingParentMap = new Map<string, string | undefined>();
  groupHeadings.forEach((gh) => {
    tasksByGroup.set(gh.title, []);
    headingParentMap.set(gh.title.toLowerCase(), gh.parentTitle);
  });

  taskBlocks.forEach((tb) => {
    const grp = tb.groupTitle || 'General';
    if (!tasksByGroup.has(grp)) {
      tasksByGroup.set(grp, []);
    }
    tasksByGroup.get(grp)!.push(tb);
  });

  const CARD_WIDTH = 320;
  const CARD_HEIGHT = 110;
  const GROUP_PADDING_X = 24;
  const GROUP_PADDING_TOP = 64; // Space for header (## Section)
  const GROUP_PADDING_BOTTOM = 24;
  const GROUP_START_X = 80;
  const GROUP_START_Y = 80;
  const GROUP_GAP_X = 48;
  const GROUP_GAP_Y = 64;
  const MAX_COLS_PER_ROW = 5;

  interface GroupLayoutInfo {
    groupTitle: string;
    tasks: typeof taskBlocks;
    groupShape: any | undefined;
    width: number;
    height: number;
    minX: number;
    minY: number;
    parentTitle?: string;
    g?: dagre.graphlib.Graph;
  }

  const groupLayouts: GroupLayoutInfo[] = [];

  // Pass 1: Compute DAG layout and dimensions for each group independently
  for (const [groupTitle, tasks] of tasksByGroup.entries()) {
    const groupShape = groupTitleToShapeMap.get(groupTitle.toLowerCase());
    const parentTitle = headingParentMap.get(groupTitle.toLowerCase());

    if (tasks.length === 0) {
      groupLayouts.push({
        groupTitle,
        tasks,
        groupShape,
        width: 360,
        height: 200,
        minX: 0,
        minY: 0,
        parentTitle,
      });
      continue;
    }

    // Build Dagre graph for this group's tasks
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB', // Dependency flows from top to bottom
      nodesep: 24,   // Horizontal distance between parallel branches
      ranksep: 42,   // Vertical distance between dependent ranks
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    tasks.forEach((t) => {
      const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
      g.setNode(taskId, { width: CARD_WIDTH, height: CARD_HEIGHT });
    });

    // Add edges for "Blocked by" dependencies inside the same group
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
          // If the blocker is in the same group, add directed edge (blocker -> blocked)
          if (taskIdsInGroup.has(blockerId) && blockerId !== blockedTaskId) {
            g.setEdge(blockerId, blockedTaskId);
          }
        });
      }
    });

    // Run dagre layout
    dagre.layout(g);

    // Compute min/max coordinates within the group
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
    const groupHeight = Math.max(
      220,
      contentHeight + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM
    );

    groupLayouts.push({
      groupTitle,
      tasks,
      groupShape,
      width: groupWidth,
      height: groupHeight,
      minX,
      minY,
      parentTitle,
      g,
    });
  }

  // Pass 2: Distribute groups into layout
  const updates: any[] = [];

  if (parentHeadings && parentHeadings.length > 0) {
    // Hierarchical layout: Group ## sections under their # parent macro container
    let currentParentY = GROUP_START_Y;
    const parentStartX = GROUP_START_X;

    for (const parent of parentHeadings) {
      const childLayouts = groupLayouts.filter((gl) => {
        if (gl.parentTitle) {
          return gl.parentTitle.toLowerCase() === parent.title.toLowerCase();
        }
        return parentHeadings.length === 1;
      });

      if (childLayouts.length === 0) continue;

      const childRows: GroupLayoutInfo[][] = [];
      for (let i = 0; i < childLayouts.length; i += MAX_COLS_PER_ROW) {
        childRows.push(childLayouts.slice(i, i + MAX_COLS_PER_ROW));
      }

      let currentChildRowY = currentParentY + 64; // Header space for '# Parent'
      let maxParentRight = parentStartX + 360;
      let maxParentBottom = currentChildRowY;
      let totalTasksInParent = 0;
      let completedTasksInParent = 0;

      for (const row of childRows) {
        let currentGroupX = parentStartX + 32;
        let rowMaxHeight = 0;

        for (const info of row) {
          if (info.height > rowMaxHeight) {
            rowMaxHeight = info.height;
          }

          const groupX = currentGroupX;
          const groupY = currentChildRowY;

          if (groupX + info.width > maxParentRight) {
            maxParentRight = groupX + info.width;
          }
          if (groupY + info.height > maxParentBottom) {
            maxParentBottom = groupY + info.height;
          }

          totalTasksInParent += info.tasks.length;
          completedTasksInParent += info.tasks.filter((t) => t.rawTaskLine.includes('[x]') || t.rawTaskLine.includes('[X]')).length;

          // Position child '##' group shape
          if (info.groupShape) {
            updates.push({
              id: info.groupShape.id,
              type: 'task-group',
              x: groupX,
              y: groupY,
              props: {
                ...info.groupShape.props,
                w: info.width,
                h: info.height,
                count: info.tasks.length,
                level: 2,
                parentTitle: parent.title,
              },
            });
          }

          // Position task shapes inside this '##' group
          if (info.g && info.tasks.length > 0) {
            info.tasks.forEach((t) => {
              const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
              const node = info.g!.node(taskId);
              const shape = taskIdToShapeMap.get(taskId);

              if (shape && node) {
                const nodeLeft = node.x - node.width / 2;
                const nodeTop = node.y - node.height / 2;

                const taskX = groupX + GROUP_PADDING_X + (nodeLeft - info.minX);
                const taskY = groupY + GROUP_PADDING_TOP + (nodeTop - info.minY);

                updates.push({
                  id: shape.id,
                  type: 'task',
                  x: taskX,
                  y: taskY,
                  props: {
                    ...shape.props,
                    groupTitle: info.groupTitle,
                    w: CARD_WIDTH,
                    h: CARD_HEIGHT,
                  },
                });
              }
            });
          }

          currentGroupX += info.width + GROUP_GAP_X;
        }

        currentChildRowY += rowMaxHeight + GROUP_GAP_Y;
      }

      const parentW = (maxParentRight - parentStartX) + 32;
      const parentH = (maxParentBottom - currentParentY) + 32;

      // Update or create parent '#' macro-group shape
      const parentShape = groupTitleToShapeMap.get(parent.title.toLowerCase());
      if (parentShape) {
        updates.push({
          id: parentShape.id,
          type: 'task-group',
          x: parentStartX,
          y: currentParentY,
          props: {
            ...parentShape.props,
            w: parentW,
            h: parentH,
            level: 1,
            count: totalTasksInParent,
            completedCount: completedTasksInParent,
          },
        });
      } else {
        editor.createShape({
          id: createShapeId(),
          type: 'task-group' as const,
          x: parentStartX,
          y: currentParentY,
          props: {
            w: parentW,
            h: parentH,
            title: parent.title,
            count: totalTasksInParent,
            completedCount: completedTasksInParent,
            level: 1,
          },
        } as any);
      }

      currentParentY += parentH + 64;
    }
  } else {
    // Flat 5-column grid layout when no '#' parent headings exist
    const rows: GroupLayoutInfo[][] = [];
    for (let i = 0; i < groupLayouts.length; i += MAX_COLS_PER_ROW) {
      rows.push(groupLayouts.slice(i, i + MAX_COLS_PER_ROW));
    }

    let currentRowY = GROUP_START_Y;
    for (const row of rows) {
      let currentGroupX = GROUP_START_X;
      let rowMaxHeight = 0;

      for (const info of row) {
        if (info.height > rowMaxHeight) {
          rowMaxHeight = info.height;
        }

        const groupX = currentGroupX;
        const groupY = currentRowY;

        // Position group shape
        if (info.groupShape) {
          updates.push({
            id: info.groupShape.id,
            type: 'task-group',
            x: groupX,
            y: groupY,
            props: {
              ...info.groupShape.props,
              w: info.width,
              h: info.height,
              count: info.tasks.length,
              level: 2,
            },
          });
        }

        // Position task shapes inside the group
        if (info.g && info.tasks.length > 0) {
          info.tasks.forEach((t) => {
            const taskId = (t.detectedId || `task-${t.taskLineIndex}`).toLowerCase();
            const node = info.g!.node(taskId);
            const shape = taskIdToShapeMap.get(taskId);

            if (shape && node) {
              const nodeLeft = node.x - node.width / 2;
              const nodeTop = node.y - node.height / 2;

              const taskX = groupX + GROUP_PADDING_X + (nodeLeft - info.minX);
              const taskY = groupY + GROUP_PADDING_TOP + (nodeTop - info.minY);

              updates.push({
                id: shape.id,
                type: 'task',
                x: taskX,
                y: taskY,
                props: {
                  ...shape.props,
                  groupTitle: info.groupTitle,
                  w: CARD_WIDTH,
                  h: CARD_HEIGHT,
                },
              });
            }
          });
        }

        currentGroupX += info.width + GROUP_GAP_X;
      }

      currentRowY += rowMaxHeight + GROUP_GAP_Y;
    }
  }

  // Apply all shape position updates to editor in one atomic batch
  if (updates.length > 0) {
    editor.updateShapes(updates);
  }

  // Center and fit canvas content smoothly
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 300 } });
  }, 60);

  return {
    taskCount: taskShapes.length,
    groupCount: groupShapes.length,
  };
}
