import { computeAutoLayout } from '../src/utils/autoLayout';

const userMarkdown = `# Paco

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

const res = computeAutoLayout(userMarkdown);
console.log('=== COMPUTED GROUPS ===');
res.groups.forEach((g) => {
  console.log(`[${g.isContainer ? 'CONTAINER' : 'LEAF'}] "${g.title}" (id=${g.id}, level=${g.level}, branch="${g.branchTitle}"): x=${g.x}, y=${g.y}, w=${g.w}, h=${g.h}`);
});
console.log('=== COMPUTED TASKS ===');
res.tasks.forEach((t) => {
  console.log(`TASK "${t.title}" in "${t.groupTitle}" (branch="${t.branchTitle}"): x=${t.x}, y=${t.y}`);
});
