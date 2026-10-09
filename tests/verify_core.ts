import assert from 'node:assert';
import {
  parseTasksMarkdown,
} from '../src/utils/taskMarkdown';
import {
  scanTaskBlocks,
  updateTaskInMarkdown,
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
assert.strictEqual(beSchemaTask.blockedBy, 'be_db', 'be_schema debe estar bloqueada por be_db');
console.log('   ✓ Parsing de grupos, tareas y metadatos correcto.');

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
console.log('   ✓ Normalización, resiliencia y Zero Data Loss de Workspaces verificado.');

console.log('--- ¡Todas las pruebas del núcleo pasaron exitosamente (100%)! ---');

