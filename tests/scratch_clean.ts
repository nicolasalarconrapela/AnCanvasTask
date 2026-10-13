import { parseTasksMarkdown, ParsedGroup, ParsedMarkdownTask } from '../src/utils/taskMarkdown';
import { scanTaskBlocks } from '../src/utils/markdownSync';
import { orderTasksTopologically, getTaskCalculatedHeight, CARD_WIDTH, CARD_HEIGHT, CARD_GAP, GROUP_PADDING_X, GROUP_HEADER_HEIGHT, GROUP_PADDING_TOP, GROUP_PADDING_BOTTOM, GROUP_WIDTH, MACRO_PAD_X, MACRO_HEADER_PAD_Y, MACRO_BOTTOM_PAD_Y, START_X, START_Y, COL_GAP_X, ROW_GAP_Y } from '../src/utils/autoLayout';

export function computeCleanLayout(markdown: string) {
  const parsedGroups = parseTasksMarkdown(markdown);
  const { parentHeadings } = scanTaskBlocks(markdown);

  if (parsedGroups.length === 0) {
    return { tasks: [], groups: [] };
  }

  const computedTasks: any[] = [];
  const leafGroups: any[] = [];
  const macroGroups: any[] = [];

  // Partition leaf sections by branch/module (e.g. 'Fronted', 'Backend', or '' for root)
  const branchMap = new Map<string, ParsedGroup[]>();
  parsedGroups.forEach((g) => {
    const b = g.branchTitle || '';
    if (!branchMap.has(b)) {
      branchMap.set(b, []);
    }
    branchMap.get(b)!.push(g);
  });

  const MAX_ROW_WIDTH = 1500; // Comfortable viewport width threshold
  let currentRowX = START_X;
  let currentRowY = START_Y;
  let rowMaxHeight = 0;

  // Order: root/unbranched first, then named branches
  const branchEntries = Array.from(branchMap.entries()).sort(([a], [b]) => {
    if (a === '' && b !== '') return -1;
    if (a !== '' && b === '') return 1;
    return 0;
  });

  branchEntries.forEach(([branchName, branchGroups]) => {
    if (branchGroups.length === 0) return;

    // Calculate branch block width: columns placed side by side
    const numCols = branchGroups.length;
    const branchColsWidth = numCols * GROUP_WIDTH + Math.max(0, numCols - 1) * COL_GAP_X;
    const hasContainer = Boolean(branchName); // Only named ## branches get a macro container
    const branchBlockWidth = hasContainer ? branchColsWidth + MACRO_PAD_X * 2 : branchColsWidth;

    // If adding this branch exceeds row threshold, wrap to next row
    if (currentRowX > START_X && currentRowX + branchBlockWidth > MAX_ROW_WIDTH + START_X) {
      currentRowX = START_X;
      currentRowY += rowMaxHeight + ROW_GAP_Y;
      rowMaxHeight = 0;
    }

    const branchStartX = currentRowX;
    const branchStartY = currentRowY;
    let colX = hasContainer ? branchStartX + MACRO_PAD_X : branchStartX;
    const colY = hasContainer ? branchStartY + MACRO_HEADER_PAD_Y : branchStartY;
    let branchMaxBottom = colY;

    branchGroups.forEach((group) => {
      const taskCount = group.tasks.length;
      const completedCount = group.tasks.filter((t) => t.completed).length;

      let currentTaskY = colY + GROUP_HEADER_HEIGHT + GROUP_PADDING_TOP;
      const orderedTasks = orderTasksTopologically(group.tasks);

      orderedTasks.forEach((task, tIdx) => {
        const taskH = getTaskCalculatedHeight(task);
        const tId = task.taskId || task.temporaryId || `task-${group.id || group.title}-${tIdx + 1}`;

        computedTasks.push({
          taskId: tId,
          temporaryId: task.temporaryId,
          title: task.title,
          x: colX + GROUP_PADDING_X,
          y: currentTaskY,
          w: CARD_WIDTH,
          h: taskH,
          groupTitle: group.title,
          branchTitle: group.branchTitle,
          groupHeadingId: group.id,
        });

        currentTaskY += taskH + CARD_GAP;
      });

      const calculatedGroupH = Math.max(
        180,
        currentTaskY - colY - CARD_GAP + GROUP_PADDING_BOTTOM
      );

      const leafG = {
        id: group.id,
        title: group.title,
        x: colX,
        y: colY,
        w: GROUP_WIDTH,
        h: calculatedGroupH,
        count: taskCount,
        completedCount,
        level: group.level || 3,
        parentTitle: group.parentTitle,
        parentId: group.parentId,
        headingId: group.id,
        branchTitle: group.branchTitle,
        path: group.path,
        isContainer: false,
        color: group.color,
      };

      leafGroups.push(leafG);

      if (colY + calculatedGroupH > branchMaxBottom) {
        branchMaxBottom = colY + calculatedGroupH;
      }

      colX += GROUP_WIDTH + COL_GAP_X;
    });

    // If named branch, create macro container strictly enclosing its columns
    if (hasContainer) {
      const parentHeading = parentHeadings.find((p) => p.title.toLowerCase() === branchName.toLowerCase());
      const branchHeight = (branchMaxBottom - branchStartY) + MACRO_BOTTOM_PAD_Y;

      const totalTasks = branchGroups.reduce((sum, g) => sum + g.tasks.length, 0);
      const completedTasks = branchGroups.reduce((sum, g) => sum + g.tasks.filter((t) => t.completed).length, 0);

      macroGroups.push({
        id: parentHeading?.id || `branch-${branchName}`,
        title: branchName,
        x: branchStartX,
        y: branchStartY,
        w: branchBlockWidth,
        h: branchHeight,
        count: totalTasks,
        completedCount: completedTasks,
        level: parentHeading?.level || 2,
        parentTitle: parentHeading?.parentTitle,
        parentId: parentHeading?.parentId,
        headingId: parentHeading?.id,
        branchTitle: branchName,
        isContainer: true,
        color: parentHeading?.color,
      });

      if (branchHeight > rowMaxHeight) {
        rowMaxHeight = branchHeight;
      }
    } else {
      const blockH = branchMaxBottom - branchStartY;
      if (blockH > rowMaxHeight) {
        rowMaxHeight = blockH;
      }
    }

    currentRowX += branchBlockWidth + COL_GAP_X;
  });

  return {
    tasks: computedTasks,
    groups: [...macroGroups, ...leafGroups],
  };
}

// Test with full user markdown
const md = `# Paco

## Fronted

### NPM

- [ ] Nueva tarea
  - ID: nueva-tarea
  - Priority: P1

#### Github

- [ ] Nueva tarea 22
  - ID: nueva-tarea-22
  - Priority: P1

---

## Backend

### NPM

- [ ] Nueva tarea
  - ID: nueva-tarea-2
  - Priority: P1

#### NPM

- [ ] Nueva tarea
  - ID: nueva-tarea1
  - Priority: P1

#### Github

- [ ] Nueva tarea 22
  - ID: nueva-tarea-221
  - Priority: P1
- [ ] Tarea en nivel 4
  - ID: tarea-en-nivel-4
`;

const res = computeCleanLayout(md);
console.log('=== CLEAN LAYOUT GROUPS ===');
res.groups.forEach((g) => {
  console.log(`[${g.isContainer ? 'CONTAINER' : 'LEAF'}] "${g.title}" (branch="${g.branchTitle || ''}"): x=${g.x}, y=${g.y}, w=${g.w}, h=${g.h}`);
});
console.log('=== CLEAN LAYOUT TASKS ===');
res.tasks.forEach((t) => {
  console.log(`TASK "${t.title}" in "${t.groupTitle}" (branch="${t.branchTitle || ''}"): x=${t.x}, y=${t.y}`);
});
