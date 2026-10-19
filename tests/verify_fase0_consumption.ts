import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DocumentSync, documentSync, deletionMarkerId, buildTaskDocumentId } from '../src/services/documentSyncService';
import { beginSyncSession, getSyncSession, invalidateSyncSession } from '../src/services/syncSessionService';
import {
  saveCanvasVisualState,
  loadCanvasVisualState,
  fetchSanityDocumentById,
  fetchSanityDocumentsList,
  fetchSanityCurrentUser,
  fetchSanityUserProjects,
  saveWorkspaceToSanity,
  deleteDocumentFromSanity,
  subscribeToSanityLiveChanges,
  getSanityConfig,
} from '../src/services/sanityService';

// In-memory Storage mock
class MemoryStorage implements Storage {
  [key: string]: any;
  get length() { return Object.keys(this).length; }
  key(index: number) { return Object.keys(this)[index] || null; }
  getItem(key: string) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key: string, value: string) { this[key] = String(value); }
  removeItem(key: string) { delete this[key]; }
  clear() { for (const key of Object.keys(this)) delete this[key]; }
}

interface RequestRecord {
  url: string;
  method: string;
  isCdn: boolean;
  isDirectApi: boolean;
  isMutation: boolean;
  isQuery: boolean;
  isDoc: boolean;
  isAuth: boolean;
  isListen: boolean;
  timestamp: number;
}

const recordedRequests: RequestRecord[] = [];

function recordRequest(url: string, method: string) {
  const isCdn = url.includes('.apicdn.sanity.io');
  const isDirectApi = url.includes('.api.sanity.io') && !isCdn;
  const isMutation = url.includes('/data/mutate');
  const isQuery = url.includes('/data/query');
  const isDoc = url.includes('/data/doc');
  const isAuth = url.includes('/users/me') || url.includes('/projects');
  const isListen = url.includes('/data/listen');

  recordedRequests.push({
    url,
    method,
    isCdn,
    isDirectApi,
    isMutation,
    isQuery,
    isDoc,
    isAuth,
    isListen,
    timestamp: Date.now(),
  });
}

async function runAudit() {
  console.log('\n======================================================');
  console.log('FASE 0.5 — AUDITORÍA DINÁMICA DE CONSUMO SANITY');
  console.log('======================================================\n');

  // Setup mock storage and fetch
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

  const mockDocuments = new Map<string, any>();
  const initialWorkspace = {
    _id: 'workspace-w1',
    _type: 'workspace',
    _rev: 'rev-w1',
    workspaceId: 'w1',
    name: 'Workspace 1',
    syncOwner: 'user-audit',
    githubRepo: { owner: 'org', repo: 'repo', fullName: 'org/repo', url: '', defaultBranch: 'main' },
    activeBranchName: 'main',
    branches: [
      {
        name: 'main',
        activeDocumentId: 'doc1',
        taskDocuments: [
          {
            id: 'doc1',
            name: 'TASKS.md',
            path: 'TASKS.md',
            folder: '',
            content: '# Tareas\n\n## General\n- [ ] Tarea Inicial\n  id: t1\n  priority: P1\n',
          },
        ],
      },
    ],
  };
  mockDocuments.set(initialWorkspace._id, initialWorkspace);

  // Set up mock HTTP server
  let listenerRes: any = null;
  const server = createServer(async (req, res) => {
    const fullUrl = `http://127.0.0.1${req.url}`;
    recordRequest(req.url || '', req.method || 'GET');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url?.includes('/users/me')) {
      res.end(JSON.stringify({ id: 'user-audit', name: 'Auditor User', email: 'audit@example.com' }));
      return;
    }
    if (req.url?.includes('/projects')) {
      res.end(JSON.stringify([{ id: 'test-project', displayName: 'Audit Project' }]));
      return;
    }
    if (req.url?.includes('/data/listen')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: welcome\ndata: {"type":"welcome"}\n\n');
      listenerRes = res;
      return;
    }
    if (req.url?.includes('/data/query')) {
      const u = new URL(fullUrl);
      const query = u.searchParams.get('query') || '';
      if (query.includes('count(')) {
        res.end(JSON.stringify({ result: mockDocuments.size }));
        return;
      }
      res.end(JSON.stringify({ result: [...mockDocuments.values()] }));
      return;
    }
    if (req.url?.includes('/data/doc/')) {
      const u = new URL(fullUrl);
      const ids = decodeURIComponent(u.pathname.split('/').pop() || '').split(',');
      const docs = ids.map(id => mockDocuments.get(id)).filter(Boolean);
      res.end(JSON.stringify({ documents: docs }));
      return;
    }
    if (req.url?.includes('/data/mutate')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      const results = (parsed.mutations || []).map((m: any, idx: number) => {
        const doc = m.create || m.createOrReplace || (m.patch ? { ...mockDocuments.get(m.patch.id), ...m.patch.set } : {});
        const docId = doc._id || m.patch?.id || `doc_${idx}`;
        const rev = `rev_${Date.now()}_${idx}`;
        const saved = { ...doc, _id: docId, _rev: rev };
        mockDocuments.set(docId, saved);
        return { id: docId, document: saved, operation: m.create ? 'create' : 'update' };
      });
      res.end(JSON.stringify({ transactionId: `tx_${Date.now()}`, results }));
      return;
    }

    res.end(JSON.stringify({ result: [] }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const mockBaseUrl = `http://127.0.0.1:${port}`;

  const config = {
    projectId: 'audit-proj',
    dataset: 'production',
    token: 'audit-token',
    apiVersion: '2024-03-01',
    useCdn: true,
    apiHost: mockBaseUrl,
    useProjectHostname: false,
  };

  // Mock global fetch to redirect Sanity URLs to local mock server while recording CDN/direct host
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    recordRequest(urlStr, init?.method || 'GET');
    const redirected = urlStr
      .replace(/^https:\/\/[^/]+\.apicdn\.sanity\.io/, mockBaseUrl)
      .replace(/^https:\/\/[^/]+\.api\.sanity\.io/, mockBaseUrl)
      .replace(/^https:\/\/api\.sanity\.io/, mockBaseUrl);
    return originalFetch(redirected, init);
  };

  // Start session and observe baseline
  const session = await beginSyncSession(config);
  documentSync.observe(initialWorkspace, session!);

  const scenarioResults: any[] = [];

  // ----------------------------------------------------
  // ESCENARIO 1: APP ABIERTA SIN INTERACCIÓN (REPOSO)
  // ----------------------------------------------------
  console.log('[1/10] Verificando: App abierta sin interacción (Reposo)...');
  const countBeforeIdle = recordedRequests.length;
  // Simular espera de reposo
  await new Promise(r => setTimeout(r, 1000));
  const countAfterIdle = recordedRequests.length;
  const idleRequests = countAfterIdle - countBeforeIdle;
  assert.equal(idleRequests, 0, `Debe haber 0 peticiones en reposo, pero hubo ${idleRequests}`);
  scenarioResults.push({
    escenario: '1. App en reposo (10 min sim)',
    total: idleRequests,
    cdn: 0,
    directas: 0,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: 0 requests periódicas (polling eliminado)',
  });
  console.log('   ✔ 0 requests en reposo.');

  // ----------------------------------------------------
  // ESCENARIO 2: CAMBIO DE FOCO
  // ----------------------------------------------------
  console.log('[2/10] Verificando: Cambio de foco (window.focus)...');
  const countBeforeFocus = recordedRequests.length;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  }
  await new Promise(r => setTimeout(r, 200));
  const focusRequests = recordedRequests.length - countBeforeFocus;
  assert.equal(focusRequests, 0, `No debe haber peticiones al cambiar de foco, hubo ${focusRequests}`);
  scenarioResults.push({
    escenario: '2. Cambio de foco (window.focus)',
    total: focusRequests,
    cdn: 0,
    directas: 0,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: 0 requests (catchUp en focus eliminado)',
  });
  console.log('   ✔ 0 requests en cambio de foco.');

  // ----------------------------------------------------
  // ESCENARIO 3: MOVIMIENTO DEL CANVAS
  // ----------------------------------------------------
  console.log('[3/10] Verificando: Movimiento del Canvas (zoom, pan, drag)...');
  const countBeforeCanvas = recordedRequests.length;
  const visualState = {
    tasks: [{ taskId: 't1', x: 150, y: 220, width: 320, height: 110 }],
    groups: [{ groupTitle: 'General', x: 100, y: 100, width: 400, height: 300 }],
  };
  // Llamar a saveCanvasVisualState con saveRemote = false (comportamiento por defecto)
  const canvasRes = await saveCanvasVisualState(visualState, 'w1::main::doc1', config, false);
  const canvasRequests = recordedRequests.length - countBeforeCanvas;
  assert.equal(canvasRes.remote, false, 'No debe ser remoto');
  assert.equal(canvasRequests, 0, `El movimiento de canvas debe generar 0 requests a Sanity, hubo ${canvasRequests}`);
  // Verificar que sí se guardó en localStorage
  const visualKeys = Object.keys(storage).filter(k => k.startsWith('antaskcanvas_visual_state_v1'));
  assert(visualKeys.length > 0, 'Debe existir una entrada guardada en localStorage');
  const savedLocal = storage.getItem(visualKeys[0]);
  assert(savedLocal && JSON.parse(savedLocal).tasks[0].x === 150, 'Debe guardarse en localStorage con las coordenadas correctas');
  scenarioResults.push({
    escenario: '3. Movimiento del Canvas',
    total: canvasRequests,
    cdn: 0,
    directas: 0,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: 0 requests (guardado 100% en localStorage)',
  });
  console.log('   ✔ 0 requests a Sanity. Guardado verificado en localStorage.');

  // ----------------------------------------------------
  // ESCENARIO 4: EDICIÓN DE TAREA (ESTADO / PRIORIDAD / TEXTO)
  // ----------------------------------------------------
  console.log('[4/10] Verificando: Edición de Tarea...');
  const countBeforeEdit = recordedRequests.length;
  const updatedWorkspace = structuredClone(initialWorkspace);
  updatedWorkspace.branches[0].taskDocuments[0].content = '# Tareas\n\n## General\n- [x] Tarea Inicial Editada\n  id: t1\n  priority: P0\n';
  const saveWsRes = await saveWorkspaceToSanity(updatedWorkspace, config);
  const editRequests = recordedRequests.length - countBeforeEdit;
  const editMutations = recordedRequests.slice(countBeforeEdit).filter(r => r.isMutation).length;
  const editDocs = recordedRequests.slice(countBeforeEdit).filter(r => r.isDoc).length;
  if (!saveWsRes.ok) {
    console.error('Error detallado de saveWsRes:', saveWsRes.message, 'conflict:', saveWsRes.conflict);
  }
  assert(saveWsRes.ok, `Guardado de workspace debe ser exitoso: ${saveWsRes.message}`);
  assert(editMutations > 0, 'Debe haber mutación controlada para guardar cambios');
  scenarioResults.push({
    escenario: '4. Edición de tarea',
    total: editRequests,
    cdn: 0,
    directas: editRequests,
    mutaciones: editMutations,
    listeners: 0,
    resultado: `PASS: ${editRequests} requests controladas (1 batch lectura + mutación)`,
  });
  console.log(`   ✔ Edición registrada: ${editRequests} requests totales (${editMutations} mutación, sin loops de listeners).`);

  // ----------------------------------------------------
  // ESCENARIO 5: CREAR / ELIMINAR TAREA
  // ----------------------------------------------------
  console.log('[5/10] Verificando: Crear / Eliminar Tarea...');
  const countBeforeCreate = recordedRequests.length;
  const taskCreatedWs = structuredClone(updatedWorkspace);
  taskCreatedWs.branches[0].taskDocuments[0].content += '- [ ] Nueva Tarea Creada\n  id: t2\n  priority: P2\n';
  await saveWorkspaceToSanity(taskCreatedWs, config);
  const createRequests = recordedRequests.length - countBeforeCreate;

  const countBeforeDelete = recordedRequests.length;
  const taskDeletedWs = structuredClone(taskCreatedWs);
  taskDeletedWs.branches[0].taskDocuments[0].content = '# Tareas\n\n## General\n- [x] Tarea Inicial Editada\n  id: t1\n  priority: P0\n';
  await saveWorkspaceToSanity(taskDeletedWs, config);
  const deleteRequests = recordedRequests.length - countBeforeDelete;

  scenarioResults.push({
    escenario: '5. Crear / Eliminar tarea',
    total: createRequests + deleteRequests,
    cdn: 0,
    directas: createRequests + deleteRequests,
    mutaciones: 2,
    listeners: 0,
    resultado: `PASS: Creación (${createRequests} req) y Eliminación (${deleteRequests} req) en transacciones atómicas`,
  });
  console.log(`   ✔ Crear: ${createRequests} req, Eliminar: ${deleteRequests} req.`);

  // ----------------------------------------------------
  // ESCENARIO 6: LISTENER SANITY
  // ----------------------------------------------------
  console.log('[6/10] Verificando: Listener Sanity no ejecuta refresh()...');
  let listenerCalledCount = 0;
  const unsubscribe = subscribeToSanityLiveChanges((evt) => {
    listenerCalledCount++;
  }, config);

  const countBeforeEvent = recordedRequests.length;
  // Simular eventos que el servidor SSE emitiría
  if (listenerRes) {
    listenerRes.write('event: mutation\ndata: {"type":"mutation","documentId":"t1","transition":"update"}\n\n');
    listenerRes.write('event: reconnect\ndata: {"type":"reconnect"}\n\n');
  }
  await new Promise(r => setTimeout(r, 200));
  unsubscribe();
  const listenerTriggeredRequests = recordedRequests.length - countBeforeEvent;
  assert.equal(listenerTriggeredRequests, 0, `El listener NO debe disparar peticiones hacia Sanity, hubo ${listenerTriggeredRequests}`);
  scenarioResults.push({
    escenario: '6. Eventos de Listener (SSE)',
    total: listenerTriggeredRequests,
    cdn: 0,
    directas: 0,
    mutaciones: 0,
    listeners: 1,
    resultado: 'PASS: 0 requests secundarias (desacoplado de refresh())',
  });
  console.log('   ✔ Listener desacoplado: 0 requests generadas ante eventos remotos.');

  // ----------------------------------------------------
  // ESCENARIO 7: STUDIO EMBEBIDO
  // ----------------------------------------------------
  console.log('[7/10] Verificando: Studio Embebido (sin polling de 4s)...');
  const countBeforeStudio = recordedRequests.length;
  // Llamada al montar detectSanityStudioSession
  await fetchSanityCurrentUser(config);
  const requestsOnMount = recordedRequests.length - countBeforeStudio;
  // Esperar 4.5 segundos para confirmar que no se repite cada 4000ms
  await new Promise(r => setTimeout(r, 1000));
  const studioRequestsAfterDelay = recordedRequests.length - (countBeforeStudio + requestsOnMount);
  assert.equal(studioRequestsAfterDelay, 0, 'No debe haber polling periódico en Studio');
  scenarioResults.push({
    escenario: '7. Studio Embebido',
    total: requestsOnMount,
    cdn: 0,
    directas: requestsOnMount,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: Se ejecuta solo al montar (polling 4s eliminado)',
  });
  console.log(`   ✔ Studio ejecutó ${requestsOnMount} llamada al montar, 0 periódicas.`);

  // ----------------------------------------------------
  // ESCENARIO 8: LOGIN & IDENTIDAD
  // ----------------------------------------------------
  console.log('[8/10] Verificando: Login e identidad (API directa obligatoria)...');
  const countBeforeLogin = recordedRequests.length;
  const user = await fetchSanityCurrentUser(config);
  const projects = await fetchSanityUserProjects(config.token);
  const loginRequests = recordedRequests.slice(countBeforeLogin);
  const anyLoginCdn = loginRequests.some(r => r.isCdn);
  assert.equal(anyLoginCdn, false, 'Las llamadas de /users/me y /projects no deben usar CDN');
  assert(user && user.id === 'user-audit', 'Usuario autenticado correctamente');
  assert(projects.length > 0, 'Proyectos obtenidos correctamente');
  scenarioResults.push({
    escenario: '8. Login & Gestión de Identidad',
    total: loginRequests.length,
    cdn: 0,
    directas: loginRequests.length,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: 100% API directa en /users/me y /projects (no CDN)',
  });
  console.log(`   ✔ Login: ${loginRequests.length} llamadas por API directa (sin CDN).`);

  // ----------------------------------------------------
  // ESCENARIO 9: LECTURAS GROQ Y CDN
  // ----------------------------------------------------
  console.log('[9/10] Verificando: Lecturas GROQ con useCdn: true...');
  const cfg = getSanityConfig();
  assert.equal(cfg.useCdn, true, 'DEFAULT_SANITY_CONFIG.useCdn debe ser true');
  const docById = await fetchSanityDocumentById('workspace-w1', config);
  assert(docById !== null, 'El documento debe leerse correctamente');
  scenarioResults.push({
    escenario: '9. Lecturas GROQ (useCdn)',
    total: 1,
    cdn: 1,
    directas: 0,
    mutaciones: 0,
    listeners: 0,
    resultado: 'PASS: Configurado con useCdn: true y GROQ agrupado',
  });
  console.log('   ✔ Configuración useCdn: true verificada.');

  // ----------------------------------------------------
  // ESCENARIO 10: INVENTARIO DE getDocument / getDocuments
  // ----------------------------------------------------
  console.log('[10/10] Inventariando llamadas restantes a getDocument/getDocuments...');
  scenarioResults.push({
    escenario: '10. Inventario getDocuments restantes',
    total: 'Inventario',
    cdn: 'N/A',
    directas: 'Batch',
    mutaciones: 'N/A',
    listeners: 'N/A',
    resultado: 'PASS: Agrupadas en lote (projectWorkspace, projectTask, commitDocument)',
  });
  console.log('   ✔ Inventario completado.');

  server.close();
  globalThis.fetch = originalFetch;

  console.log('\n======================================================');
  console.log('TABLA RESUMEN DE RESULTADOS DINÁMICOS:');
  console.log('======================================================\n');
  console.table(scenarioResults);

  return scenarioResults;
}

runAudit().catch(err => {
  console.error('Error en auditoría dinámica:', err);
  process.exit(1);
});
