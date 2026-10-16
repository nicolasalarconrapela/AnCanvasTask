import { parseTasksMarkdown, ParsedGroup, ParsedMarkdownTask } from '../src/utils/taskMarkdown';
import { scanTaskBlocks } from '../src/utils/markdownSync';
import { orderTasksTopologically, getTaskCalculatedHeight, CARD_WIDTH, CARD_HEIGHT, CARD_GAP, GROUP_PADDING_X, GROUP_HEADER_HEIGHT, GROUP_PADDING_TOP, GROUP_PADDING_BOTTOM, GROUP_WIDTH, MACRO_PAD_X, MACRO_HEADER_PAD_Y, MACRO_BOTTOM_PAD_Y, START_X, START_Y, COL_GAP_X, ROW_GAP_Y } from '../src/utils/autoLayout';

export function computeAutoLayoutTest2(markdown: string) {
  const parsedGroups = parseTasksMarkdown(markdown);
  const { parentHeadings } = scanTaskBlocks(markdown);

  if (parsedGroups.length === 0) {
    return { tasks: [], groups: [] };
  }

  const computedTasks: any[] = [];
  const leafGroups: any[] = [];
  const macroGroups: any[] = [];

  const branchMap = new Map<string, ParsedGroup[]>();
  parsedGroups.forEach((g) => {
    const b = g.branchTitle || '';
    if (!branchMap.has(b)) {
      branchMap.set(b, []);
    }
    branchMap.get(b)!.push(g);
  });

  const MAX_ROW_WIDTH = 1400;
  let currentBranchX = START_X;
  let currentBranchY = START_Y;
  let rowMaxBottom = currentBranchY;

  const branchEntries = Array.from(branchMap.entries()).sort(([a], [b]) => {
    if (a === '' && b !== '') return -1;
    if (a !== '' && b === '') return 1;
    return 0;
  });

  branchEntries.forEach(([branchName, branchGroups]) => {
    if (branchGroups.length === 0) return;

    const numCols = branchGroups.length;
    const branchColsWidth = numCols * GROUP_WIDTH + Math.max(0, numCols - 1) * COL_GAP_X;
    const isNamedBranch = Boolean(branchName);
    const branchBlockWidth = isNamedBranch ? branchColsWidth + MACRO_PAD_X * 2 : branchColsWidth;

    if (currentBranchX > START_X && currentBranchX + branchBlockWidth > MAX_ROW_WIDTH + START_X) {
      currentBranchX = START_X;
      currentBranchY = rowMaxBottom + ROW_GAP_Y;
      rowMaxBottom = currentBranchY;
    }

    const branchStartX = currentBranchX;
    const branchStartY = currentBranchY;
    let colX = isNamedBranch ? branchStartX + MACRO_PAD_X : branchStartX;
    const colY = isNamedBranch ? branchStartY + MACRO_HEADER_PAD_Y : branchStartY;
    let branchMaxColBottom = colY;

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
        level: group.level || 2,
        parentTitle: group.parentTitle,
        parentId: group.parentId,
        headingId: group.id,
        branchTitle: group.branchTitle,
        path: group.path,
        isContainer: false,
        color: group.color,
      };

      leafGroups.push(leafG);

      if (colY + calculatedGroupH > branchMaxColBottom) {
        branchMaxColBottom = colY + calculatedGroupH;
      }

      colX += GROUP_WIDTH + COL_GAP_X;
    });

    const branchHeight = (branchMaxColBottom - currentBranchY) + MACRO_BOTTOM_PAD_Y;
    if (currentBranchY + branchHeight > rowMaxBottom) {
      rowMaxBottom = currentBranchY + branchHeight;
    }

    currentBranchX += branchBlockWidth + COL_GAP_X;
  });

  // Pure macro parent headings
  if (parentHeadings && parentHeadings.length > 0) {
    const pureParents = parentHeadings.filter(
      (ph) => !parsedGroups.some((g) => g.id === ph.id)
    );

    const sortedParents = [...pureParents].sort((a, b) => (b.level || 1) - (a.level || 1));

    sortedParents.forEach((ph) => {
      const directChildren = [...leafGroups, ...macroGroups].filter((s) => {
        if (ph.level === 2 && s.branchTitle && s.branchTitle.toLowerCase() === ph.title.toLowerCase()) {
          return true;
        }
        if (s.parentId && ph.id && s.parentId === ph.id) {
          return true;
        }
        const ptMatches = (s.parentTitle || '').trim().toLowerCase() === ph.title.trim().toLowerCase();
        if (ptMatches) return true;
        return false;
      });

      if (directChildren.length === 0) return;

      const minX = Math.min(...directChildren.map((s) => s.x));
      const minY = Math.min(...directChildren.map((s) => s.y));
      const maxRight = Math.max(...directChildren.map((s) => s.x + s.w));
      const maxBottom = Math.max(...directChildren.map((s) => s.y + s.h));

      const totalTasks = directChildren.reduce((sum, s) => sum + (s.count || 0), 0);
      const completedTasks = directChildren.reduce((sum, s) => sum + (s.completedCount || 0), 0);

      const calcX = minX - MACRO_PAD_X;
      const calcY = minY - MACRO_HEADER_PAD_Y;
      const calcW = (maxRight - minX) + MACRO_PAD_X * 2;
      const calcH = (maxBottom - minY) + MACRO_HEADER_PAD_Y + MACRO_BOTTOM_PAD_Y;

      macroGroups.push({
        id: ph.id,
        title: ph.title,
        x: calcX,
        y: calcY,
        w: calcW,
        h: calcH,
        count: totalTasks,
        completedCount: completedTasks,
        level: ph.level || 1,
        parentTitle: ph.parentTitle,
        parentId: ph.parentId,
        headingId: ph.id,
        branchTitle: ph.branchTitle,
        path: ph.path,
        isContainer: true,
        color: ph.color,
      });
    });
  }

  macroGroups.sort((a, b) => (a.level || 1) - (b.level || 1));

  return {
    tasks: computedTasks,
    groups: [...macroGroups, ...leafGroups],
  };
}

const testMd = `# Paco

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

const res = computeAutoLayoutTest2(testMd);
console.log('=== TEST RESULT GROUPS ===');
res.groups.forEach((g) => {
  console.log(`[${g.isContainer ? 'CONTAINER' : 'LEAF'}] "${g.title}" (level=${g.level}, branch="${g.branchTitle || ''}"): x=${g.x}, y=${g.y}, w=${g.w}, h=${g.h}`);
});
