import assert from 'node:assert';
import {
  parseTasksMarkdown,
} from '../src/utils/taskMarkdown';
import {
  scanTaskBlocks,
  updateTaskInMarkdown,
  toggleSubtaskInMarkdown,
  addTaskToMarkdown,
  deleteSectionFromMarkdown,
  deleteTaskFromMarkdown,
  autoAssignAllMissingTaskIds,
  validateMarkdownDocument,
} from '../src/utils/markdownSync';
import {
  getInitialDefaultWorkspaces,
} from '../src/services/workspaceService';
import {
  buildSanityTaskDocId,
  normalizeSanityWorkspaceDoc,
} from '../src/services/sanityService';

console.log('--- Iniciando suite de pruebas de AnTaskCanvas (Core sin GitHub) ---');

// 1. Parsing & Normalization of TASKS.md
console.log('1. Verificando parsing de TASKS.md...');
const sampleMd = `# Proyecto Demo
## Backend
- [ ] Implementar base de datos
  id: be_db
  priority: P0
- [x] Diseñar esquemas
  id: be_schema
  priority: P1
  blockedBy: be_db

## Frontend
- [ ] Conectar interfaz
  id: fe_ui
  priority: P2
`;

const parsedGroups = parseTasksMarkdown(sampleMd);
const allTasks = parsedGroups.flatMap((g) => g.tasks);
assert.strictEqual(parsedGroups.length, 2, 'Debe parsear 2 grupos');
assert.strictEqual(allTasks.length, 3, 'Debe parsear 3 tareas');

const beDbTask = allTasks.find((t) => t.title === 'Implementar base de datos');
assert(beDbTask, 'Debe encontrar la tarea Implementar base de datos');
assert.strictEqual(beDbTask.completed, false, 'be_db no debe estar completada');
assert.strictEqual(beDbTask.priority, 'P0', 'be_db debe tener prioridad P0');

const beSchemaTask = allTasks.find((t) => t.title === 'Diseñar esquemas');
assert(beSchemaTask, 'Debe encontrar Diseñar esquemas');
assert.strictEqual(beSchemaTask.completed, true, 'be_schema debe estar completada');
const subtaskSampleMd = `# Tareas con subtareas
## General
- [ ] Tarea con subitems
  id: task_with_subs
  priority: P1
  - [ ] Subtarea 1
  - [x] Subtarea 2
`;
const subtaskParsed = parseTasksMarkdown(subtaskSampleMd);
const subtaskTask = subtaskParsed[0].tasks[0];
assert(subtaskTask.subtasks, 'Debe detectar subtareas');
assert.strictEqual(subtaskTask.subtasks.total, 2, 'Total de subtareas debe ser 2');
assert.strictEqual(subtaskTask.subtasks.completed, 1, 'Subtareas completadas debe ser 1');
assert.strictEqual(subtaskTask.subtasks.items?.length, 2, 'Debe haber 2 items de subtareas');
assert.strictEqual(subtaskTask.subtasks.items?.[0].title, 'Subtarea 1');
assert.strictEqual(subtaskTask.subtasks.items?.[0].completed, false);
assert.strictEqual(subtaskTask.subtasks.items?.[1].title, 'Subtarea 2');
assert.strictEqual(subtaskTask.subtasks.items?.[1].completed, true);

// Toggle subtarea 0 -> true
const toggledMd1 = toggleSubtaskInMarkdown(subtaskSampleMd, 'task_with_subs', 0);
assert(toggledMd1.includes('- [x] Subtarea 1'), 'Subtarea 1 debe estar marcada como [x]');
const recheck1 = parseTasksMarkdown(toggledMd1)[0].tasks[0];
assert.strictEqual(recheck1.subtasks?.completed, 2, 'Ambas subtareas deben estar completadas');

// Toggle subtarea 1 -> false
const toggledMd2 = toggleSubtaskInMarkdown(toggledMd1, 'task_with_subs', 1);
assert(toggledMd2.includes('- [ ] Subtarea 2'), 'Subtarea 2 debe estar desmarcada como [ ]');
const recheck2 = parseTasksMarkdown(toggledMd2)[0].tasks[0];
assert.strictEqual(recheck2.subtasks?.completed, 1, 'Solo una subtarea debe estar completada');
console.log('   ✓ Parsing, visualización y alternancia (toggle) de subtareas verificado.');

// 2. Safe round-trip & metadata preservation
console.log('2. Verificando actualización y preservación de contenido...');
const updatedMd = updateTaskInMarkdown(sampleMd, 'be_db', {
  completed: true,
  title: 'Implementar base de datos relacional',
  priority: 'P1',
});

const reParsedGroups = parseTasksMarkdown(updatedMd);
const reParsedTasks = reParsedGroups.flatMap((g) => g.tasks);
const updatedTask = reParsedTasks.find((t) => t.taskId === 'be_db');
assert(updatedTask, 'La tarea modificada debe existir');
assert.strictEqual(updatedTask.completed, true, 'El checkbox debe haber cambiado a [x]');
assert.strictEqual(updatedTask.title, 'Implementar base de datos relacional');
assert.strictEqual(updatedTask.priority, 'P1');

// Verify that other tasks were completely unharmed
const untouchedTask = reParsedTasks.find((t) => t.taskId === 'be_schema');
assert(untouchedTask, 'be_schema debe seguir intacta');
assert.strictEqual(untouchedTask.blockedBy, 'be_db');
console.log('   ✓ Round-trip seguro y preservación de atributos verificado.');

// 3. Adding and Deleting tasks
console.log('3. Verificando adición y borrado de tareas en Markdown...');
const { updatedMarkdown: addedMd } = addTaskToMarkdown(updatedMd, {
  title: 'Integrar tests e2e',
  groupTitle: 'Frontend',
  customId: 'fe_test',
  priority: 'P2',
});
const withAddedTasks = parseTasksMarkdown(addedMd).flatMap((g) => g.tasks);
assert.strictEqual(withAddedTasks.length, 4, 'Debe haber 4 tareas tras añadir una');
assert(withAddedTasks.some((t) => t.taskId === 'fe_test'), 'fe_test debe estar en el markdown');

const deletedMd = deleteTaskFromMarkdown(addedMd, 'fe_test');
const withDeletedTasks = parseTasksMarkdown(deletedMd).flatMap((g) => g.tasks);
assert.strictEqual(withDeletedTasks.length, 3, 'Debe haber 3 tareas tras eliminar fe_test');
assert(!withDeletedTasks.some((t) => t.taskId === 'fe_test'), 'fe_test no debe existir');

// Test deleteSectionFromMarkdown
const deletedSectionMd = deleteSectionFromMarkdown(deletedMd, 'Frontend');
const reParsedAfterSectionDelete = parseTasksMarkdown(deletedSectionMd);
assert.strictEqual(reParsedAfterSectionDelete.length, 1, 'Debe quedar 1 solo grupo (Backend)');
assert.strictEqual(reParsedAfterSectionDelete[0].title, 'Backend', 'El grupo restante debe ser Backend');
console.log('   ✓ Adición y borrado no destructivo de tareas y secciones verificado.');

// 4. Sanitization and Missing IDs assignment
console.log('4. Verificando saneado y asignación automática de IDs...');
const unnormalizedMd = `# Sin IDs
## Sección
- [ ] Tarea sin id 1
- [ ] Tarea sin id 2
`;
const validation = validateMarkdownDocument(unnormalizedMd);
assert.strictEqual(validation.issues.filter((i) => i.type === 'missing_id').length, 2, 'Debe detectar 2 tareas sin ID');

const { updatedMarkdown: normalizedMd, assignedCount } = autoAssignAllMissingTaskIds(unnormalizedMd);
assert.strictEqual(assignedCount, 2, 'Debe haber asignado 2 IDs automáticos');
const postValidation = validateMarkdownDocument(normalizedMd);
assert.strictEqual(postValidation.issues.filter((i) => i.type === 'missing_id').length, 0, 'No deben quedar tareas sin ID');
console.log('   ✓ Saneado y normalización conservadora verificada.');

// 5. Workspaces and Local Recovery without GitHub dependency
console.log('5. Verificando estructura de Workspaces local y desacoplamiento de GitHub...');
const initialWorkspaces = getInitialDefaultWorkspaces();
assert(initialWorkspaces.length > 0, 'Debe proveer al menos 1 workspace inicial');
assert(initialWorkspaces[0].branches.length > 0, 'Debe tener al menos 1 rama');
assert(initialWorkspaces[0].branches[0].taskDocuments.length > 0, 'Debe tener documentos Task MD');
assert(initialWorkspaces[0].branches[0].taskDocuments[0].content.length > 0, 'Debe contener Markdown');
console.log('   ✓ Estructura de Workspace y documentos locales verificada.');

// 6. Filtering in consonance with selected TASK.md
console.log('6. Verificando filtrado en consonancia con el documento TASK.md...');
const docAMd = `# Doc A
## Frontend
- [ ] UI Card
  id: ui_card
  priority: P0
  status: todo
`;
const docBMd = `# Doc B
## Backend
- [x] API Route
  id: api_route
  priority: P1
  status: done
`;

const groupsA = parseTasksMarkdown(docAMd);
const tasksA = groupsA.flatMap((g) => g.tasks.map((t) => ({ ...t, groupTitle: g.title })));
const groupsB = parseTasksMarkdown(docBMd);
const tasksB = groupsB.flatMap((g) => g.tasks.map((t) => ({ ...t, groupTitle: g.title })));

assert.strictEqual(tasksA[0].groupTitle, 'Frontend');
assert.strictEqual(tasksB[0].groupTitle, 'Backend');
assert.strictEqual(tasksA.length, 1);
assert.strictEqual(tasksB.length, 1);
console.log('   ✓ Consonancia de tareas y secciones por documento seleccionada verificada.');

// 7. Sanity Synchronization Identity & Non-collision (INV-01, INV-06)
console.log('7. Verificando aislamiento de IDs de Sanity por Workspace (INV-01, INV-06)...');
const task1WsA = buildSanityTaskDocId('setup', 'workspace-project-a');
const task1WsB = buildSanityTaskDocId('setup', 'workspace-project-b');
assert.notStrictEqual(task1WsA, task1WsB, 'Tareas con mismo taskId en diferentes workspaces deben tener _id distintos en Sanity');
assert.strictEqual(task1WsA, 'task-project-a-setup');
assert.strictEqual(task1WsB, 'task-project-b-setup');

const taskLegacy = buildSanityTaskDocId('setup');
assert.strictEqual(taskLegacy, 'task-setup', 'Tareas sin workspace deben mantener formato legacy');
// 8. Sanity Workspace Normalization & Real-time CRUD Model (Zero Data Loss)
console.log('8. Verificando normalización y reconciliación de Workspaces de Sanity...');
const rawRemoteSanityDoc = {
  _id: 'workspace-project-remote',
  _type: 'workspace',
  workspaceId: 'project-remote',
  name: 'Proyecto Remoto',
  githubRepo: {
    owner: 'remoteteam',
    repo: 'remoterepo',
    fullName: 'remoteteam/remoterepo',
    url: 'https://github.com/remoteteam/remoterepo',
    defaultBranch: 'main',
    description: 'Repo remoto sincronizado',
  },
  branches: [
    {
      name: 'main',
      taskDocuments: [
        {
          id: 'doc_1',
          name: 'TASKS.md',
          content: '# Tareas Remotas\n- [ ] Tarea 1\n  id: rem_1\n',
        },
      ],
    },
  ],
};

const normalizedWs = normalizeSanityWorkspaceDoc(rawRemoteSanityDoc);
assert(normalizedWs, 'El workspace normalizado debe existir');
assert.strictEqual(normalizedWs.id, 'project-remote', 'El ID debe ser saneado y sin prefijo workspace-');
assert.strictEqual(normalizedWs.name, 'Proyecto Remoto');
assert.strictEqual(normalizedWs.branches.length, 1);
assert.strictEqual(normalizedWs.branches[0].taskDocuments.length, 1);
assert.strictEqual(normalizedWs.branches[0].taskDocuments[0].id, 'doc_1');

// Test fallback handling for empty or malformed remote workspace documents
const fallbackWs = normalizeSanityWorkspaceDoc({ _id: 'workspace-empty-ws' });
assert(fallbackWs, 'Debe crear fallback para documentos mínimos');
assert.strictEqual(fallbackWs.id, 'empty-ws');
assert.strictEqual(fallbackWs.branches.length, 1, 'Debe autogenerar rama default');
assert.strictEqual(fallbackWs.branches[0].name, 'main');
assert(fallbackWs.branches[0].taskDocuments.length > 0, 'Debe autogenerar documento inicial');
// 9. Agrupación de hasta 10 secciones (10 task-groups)
console.log('9. Verificando agrupación de hasta 10 secciones en Canvas y Markdown...');
const tenSectionsMd = [
  '# Tablero de Proyecto Complejo',
  ...Array.from({ length: 10 }, (_, i) => {
    const secNum = i + 1;
    return [
      `## Sección ${secNum}`,
      `- [ ] Tarea inicial del bloque ${secNum}`,
      `  id: t_${secNum}_a`,
      `  priority: P1`,
      `- [ ] Tarea dependiente del bloque ${secNum}`,
      `  id: t_${secNum}_b`,
      `  priority: P2`,
      `  blockedBy: t_${secNum}_a`,
    ].join('\n');
  }),
].join('\n\n');

const parsedTenGroups = parseTasksMarkdown(tenSectionsMd);
assert.strictEqual(parsedTenGroups.length, 10, 'Debe parsear exactamente 10 grupos/secciones');

const { groupHeadings: scannedHeadings, taskBlocks: scannedBlocks, parentHeadings } = scanTaskBlocks(tenSectionsMd);
assert.strictEqual(parentHeadings.length, 1, 'Debe detectar 1 encabezado macro #');
assert.strictEqual(parentHeadings[0].title, 'Tablero de Proyecto Complejo');
assert.strictEqual(scannedHeadings.length, 10, 'scanTaskBlocks debe detectar exactamente 10 encabezados');
assert.strictEqual(scannedBlocks.length, 20, 'Debe detectar 20 tareas en total a lo largo de las 10 secciones');

for (let i = 1; i <= 10; i++) {
  const grp = parsedTenGroups.find((g) => g.title === `Sección ${i}`);
  assert(grp, `Debe existir la sección ${i}`);
  assert.strictEqual(grp.parentTitle, 'Tablero de Proyecto Complejo', `La sección ${i} debe tener el padre # correcto`);
  assert.strictEqual(grp.tasks.length, 2, `La sección ${i} debe contener 2 tareas`);
  const depTask = grp.tasks.find((t) => t.taskId === `t_${i}_b`);
  assert(depTask, `Debe existir la tarea dependiente en sección ${i}`);
  assert.strictEqual(depTask.blockedBy, `t_${i}_a`);
}

// Agregar tarea a la décima sección
const { updatedMarkdown: withNewTaskInSec10 } = addTaskToMarkdown(tenSectionsMd, {
  title: 'Tercera tarea en sección diez',
  groupTitle: 'Sección 10',
  priority: 'P0',
});
const reParsedTen = parseTasksMarkdown(withNewTaskInSec10);
const sec10 = reParsedTen.find((g) => g.title === 'Sección 10');
assert(sec10, 'Debe existir la Sección 10 tras adición');
assert.strictEqual(sec10.tasks.length, 3, 'La Sección 10 debe tener 3 tareas tras añadir una nueva');
console.log('   ✓ Agrupación, parsing y sincronización de hasta 10 secciones verificado.');

// 10. Jerarquía multi-módulo (# contiene a sus respectivas ##)
console.log('10. Verificando jerarquía multi-módulo (# Padre conteniendo ## Subsecciones)...');
const multiMacroMd = `# Módulo Alfa
## Backend
- [ ] Tarea Backend
## Frontend
- [ ] Tarea Frontend

# Módulo Beta
## DevOps
- [ ] Tarea CI/CD
`;

const multiScan = scanTaskBlocks(multiMacroMd);
assert.strictEqual(multiScan.parentHeadings.length, 2, 'Debe haber 2 encabezados macro #');
assert.strictEqual(multiScan.parentHeadings[0].title, 'Módulo Alfa');
assert.strictEqual(multiScan.parentHeadings[1].title, 'Módulo Beta');

const multiParsed = parseTasksMarkdown(multiMacroMd);
const backendGrp = multiParsed.find((g) => g.title === 'Backend');
const frontendGrp = multiParsed.find((g) => g.title === 'Frontend');
const devopsGrp = multiParsed.find((g) => g.title === 'DevOps');

assert(backendGrp && backendGrp.parentTitle === 'Módulo Alfa', 'Backend debe pertenecer a Módulo Alfa');
assert(frontendGrp && frontendGrp.parentTitle === 'Módulo Alfa', 'Frontend debe pertenecer a Módulo Alfa');
assert(devopsGrp && devopsGrp.parentTitle === 'Módulo Beta', 'DevOps debe pertenecer a Módulo Beta');
console.log('   ✓ Anidamiento y asignación jerárquica de subsecciones ## dentro de # verificado.');

// 11. Jerarquía de niveles arbitrarios (### Nivel 3 conteniendo #### Nivel 4)
console.log('11. Verificando anidamiento de sección Nivel 4 dentro de sección Nivel 3 (### y ####)...');
const level3And4Md = `### Módulo Nivel 3
#### Subsección Nivel 4
- [ ] Tarea en Nivel 4
  id: task_l4
  priority: P1
`;

const scanL3L4 = scanTaskBlocks(level3And4Md);
assert.strictEqual(scanL3L4.parentHeadings.length, 1, 'Debe haber 1 encabezado contenedor');
assert.strictEqual(scanL3L4.parentHeadings[0].title, 'Módulo Nivel 3');
assert.strictEqual(scanL3L4.parentHeadings[0].level, 3, 'El contenedor debe ser nivel 3');

assert.strictEqual(scanL3L4.groupHeadings.length, 1, 'Debe haber 1 subsección');
assert.strictEqual(scanL3L4.groupHeadings[0].title, 'Subsección Nivel 4');
assert.strictEqual(scanL3L4.groupHeadings[0].level, 4, 'La subsección debe ser nivel 4');
assert.strictEqual(scanL3L4.groupHeadings[0].parentTitle, 'Módulo Nivel 3', 'Debe estar anidada bajo Módulo Nivel 3');

const parsedL3L4 = parseTasksMarkdown(level3And4Md);
assert.strictEqual(parsedL3L4.length, 1);
assert.strictEqual(parsedL3L4[0].title, 'Subsección Nivel 4');
assert.strictEqual(parsedL3L4[0].level, 4);
assert.strictEqual(parsedL3L4[0].parentTitle, 'Módulo Nivel 3');
assert.strictEqual(parsedL3L4[0].tasks.length, 1);
assert.strictEqual(parsedL3L4[0].tasks[0].taskId, 'task_l4');
console.log('   ✓ Sección nivel 4 dentro de nivel 3 correctamente anidada y parseada.');

// 12. Ramas independientes (##) con nombres de sección duplicados (### y ####)
console.log('12. Verificando ramas independientes (##) con subsecciones duplicadas (Fronted vs Backend)...');
const userBranchMd = `# Paco

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

const scanBranches = scanTaskBlocks(userBranchMd);
assert.strictEqual(scanBranches.taskBlocks.length, 6, 'Debe haber exactamente 6 tareas en total');

// Validar que se reconocen las ramas independientes
const frontedTasks = scanBranches.taskBlocks.filter((b) => b.branchTitle === 'Fronted');
const backendTasks = scanBranches.taskBlocks.filter((b) => b.branchTitle === 'Backend');
assert.strictEqual(frontedTasks.length, 2, 'Fronted debe tener 2 tareas');
assert.strictEqual(backendTasks.length, 4, 'Backend debe tener 4 tareas');

// Validar que parseTasksMarkdown no colapsa grupos con el mismo nombre
const parsedBranches = parseTasksMarkdown(userBranchMd);
assert.strictEqual(parsedBranches.length, 5, 'Debe haber 5 grupos parseados independientes (no colapsados)');

const frontedNPM = parsedBranches.find((g) => g.title === 'NPM' && g.branchTitle === 'Fronted');
const backendNPM = parsedBranches.find((g) => g.title === 'NPM' && g.branchTitle === 'Backend' && g.level === 3);
const backendNPM4 = parsedBranches.find((g) => g.title === 'NPM' && g.branchTitle === 'Backend' && g.level === 4);
const frontedGithub = parsedBranches.find((g) => g.title === 'Github' && g.branchTitle === 'Fronted');
const backendGithub = parsedBranches.find((g) => g.title === 'Github' && g.branchTitle === 'Backend');

assert(frontedNPM && frontedNPM.tasks.length === 1 && frontedNPM.tasks[0].taskId === 'nueva-tarea', 'Fronted NPM debe tener nueva-tarea');
assert(frontedGithub && frontedGithub.tasks.length === 1 && frontedGithub.tasks[0].taskId === 'nueva-tarea-22', 'Fronted Github debe tener nueva-tarea-22');
assert(backendNPM && backendNPM.tasks.length === 1 && backendNPM.tasks[0].taskId === 'nueva-tarea-2', 'Backend NPM L3 debe tener nueva-tarea-2');
assert(backendNPM4 && backendNPM4.tasks.length === 1 && backendNPM4.tasks[0].taskId === 'nueva-tarea1', 'Backend NPM L4 debe tener nueva-tarea1');
assert(backendGithub && backendGithub.tasks.length === 2, 'Backend Github debe tener 2 tareas');

// Verificar adición discriminando por branchTitle
const { updatedMarkdown: withTaskInBackend } = addTaskToMarkdown(userBranchMd, {
  title: 'Nueva tarea backend específica',
  groupTitle: 'NPM',
  branchTitle: 'Backend',
});
const parsedAfterAdd = parseTasksMarkdown(withTaskInBackend);
const frontedNpmAfter = parsedAfterAdd.find((g) => g.title === 'NPM' && g.branchTitle === 'Fronted');
const backendNpmAfter = parsedAfterAdd.find((g) => g.title === 'NPM' && g.branchTitle === 'Backend' && g.level === 3);
assert.strictEqual(frontedNpmAfter?.tasks.length, 1, 'Fronted NPM no debe haber sido modificado');
assert.strictEqual(backendNpmAfter?.tasks.length, 2, 'Backend NPM debe tener ahora 2 tareas');

// Verificar borrado discriminando por branchTitle
const withFrontedGithubDeleted = deleteSectionFromMarkdown(userBranchMd, 'Github', undefined, 'Fronted');
const parsedAfterDelete = parseTasksMarkdown(withFrontedGithubDeleted);
assert(!parsedAfterDelete.some((g) => g.title === 'Github' && g.branchTitle === 'Fronted'), 'Github de Fronted debe estar borrado');
assert(parsedAfterDelete.some((g) => g.title === 'Github' && g.branchTitle === 'Backend'), 'Github de Backend debe seguir existiendo intacto');

console.log('   ✓ Ramas independientes ## con subsecciones duplicadas completamente aisladas y verificadas.');

console.log('--- ¡Todas las pruebas del núcleo pasaron exitosamente (100%)! ---');



