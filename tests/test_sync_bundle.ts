import assert from 'node:assert';
import {
  exportSyncBundle,
  parseAndValidateSyncBundle,
  applySyncBundle,
  calculateStoreSummary,
  SyncBundle,
} from '../src/services/syncEngineService';
import {
  WorkspaceStoreState,
  getInitialDefaultWorkspaces,
} from '../src/services/workspaceService';

console.log('--- Probando Exportación/Importación y Soporte de Sync Bundle ---');

const dummyStore: WorkspaceStoreState = {
  workspaces: getInitialDefaultWorkspaces(),
  activeWorkspaceId: 'ws_default',
  githubToken: null,
  remoteBase: null,
  remoteDocuments: null,
};

// 1. Summary Calculation
console.log('1. Verificando cálculo de resumen del almacén...');
const summary = calculateStoreSummary(dummyStore);
assert(summary.totalWorkspaces > 0, 'Debe haber al menos 1 workspace');
assert(summary.totalBranches > 0, 'Debe haber al menos 1 rama');
assert(summary.totalDocuments > 0, 'Debe haber al menos 1 documento');
assert(typeof summary.totalTasks === 'number', 'Total de tareas debe ser numérico');
console.log(`   ✓ Workspaces: ${summary.totalWorkspaces}, Ramas: ${summary.totalBranches}, Documentos: ${summary.totalDocuments}, Tareas: ${summary.totalTasks}`);

// 2. Export Bundle
console.log('2. Verificando exportSyncBundle...');
const bundle = exportSyncBundle(dummyStore, null, { projectId: 'test_project', dataset: 'test_dataset' });
assert.strictEqual(bundle.metadata.format, 'antask_sync_bundle', 'El formato debe ser antask_sync_bundle');
assert.strictEqual(bundle.metadata.version, 1, 'La versión debe ser 1');
assert.strictEqual(bundle.metadata.environment?.projectId, 'test_project', 'Debe incluir projectId');
assert.strictEqual(bundle.metadata.environment?.dataset, 'test_dataset', 'Debe incluir dataset');
assert.strictEqual(bundle.workspaceStore.workspaces.length, dummyStore.workspaces.length, 'Debe incluir todos los workspaces');
console.log('   ✓ Bundle exportado con estructura válida.');

// 3. Serialization and Deserialization Round-trip
console.log('3. Verificando serialización y parseAndValidateSyncBundle...');
const jsonStr = JSON.stringify(bundle);
const parsed = parseAndValidateSyncBundle(jsonStr);
assert(parsed.valid, 'El parseo debe ser válido');
assert(parsed.bundle, 'Debe retornar el bundle');
assert.strictEqual(parsed.bundle.metadata.format, 'antask_sync_bundle', 'Debe mantener el formato');
assert.strictEqual(parsed.bundle.workspaceStore.workspaces.length, dummyStore.workspaces.length, 'Debe restaurar los workspaces');
console.log('   ✓ Round-trip JSON -> parseAndValidateSyncBundle exitoso.');

// 4. Backward Compatibility: Direct WorkspaceStore or Raw Array
console.log('4. Verificando compatibilidad con formato directo de workspaces...');
const directRaw = {
  workspaces: dummyStore.workspaces,
  activeWorkspaceId: dummyStore.activeWorkspaceId,
};
const parsedDirect = parseAndValidateSyncBundle(JSON.stringify(directRaw));
assert(parsedDirect.valid, 'Debe aceptar un store directo');
assert(parsedDirect.bundle, 'Debe normalizar a SyncBundle');
assert.strictEqual(parsedDirect.bundle.workspaceStore.workspaces.length, dummyStore.workspaces.length);
console.log('   ✓ Compatibilidad con JSON directo confirmada.');

// 5. Invalid JSON Handling
console.log('5. Verificando manejo de JSON inválido o estructura vacía...');
const invalidParse = parseAndValidateSyncBundle('not valid json {');
assert.strictEqual(invalidParse.valid, false, 'Debe fallar con texto inválido');
assert(invalidParse.error?.includes('JSON'), 'El error debe indicar JSON inválido');

const emptyParse = parseAndValidateSyncBundle({ empty: true });
assert.strictEqual(emptyParse.valid, false, 'Debe fallar si no hay workspaces');
console.log('   ✓ Errores de validación interceptados correctamente.');

// 6. Apply Sync Bundle (Local mode)
console.log('6. Verificando applySyncBundle en modo local...');
// Mock localStorage in node environment for test
(globalThis as any).localStorage = {
  data: {} as Record<string, string>,
  getItem(key: string) { return this.data[key] || null; },
  setItem(key: string, val: string) { this.data[key] = String(val); },
  removeItem(key: string) { delete this.data[key]; },
  clear() { this.data = {}; },
};

applySyncBundle(bundle, 'local', dummyStore).then((res) => {
  assert(res.success, 'La aplicación local debe ser exitosa');
  assert.strictEqual(res.updatedStore.workspaces.length, dummyStore.workspaces.length);
  console.log('   ✓ applySyncBundle en local completado exitosamente.');
  console.log('--- Todas las pruebas de Sync Bundle pasaron exitosamente. ---');
}).catch((err) => {
  console.error('Error en applySyncBundle:', err);
  process.exit(1);
});
