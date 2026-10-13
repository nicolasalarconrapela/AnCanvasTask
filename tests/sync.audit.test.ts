import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { beforeEach, afterEach, test } from 'node:test';
import { DocumentSync, documentSync, SyncConflict, taskFields } from '../src/services/documentSyncService';
import { beginSyncSession, getSyncSession, invalidateSyncSession } from '../src/services/syncSessionService';
import { flushWorkspaceStoreSaves, loadWorkspaceStore, applyLocalDeletions, isEmptyWorkspacePlaceholder, createEmptyWorkspace } from '../src/services/workspaceService';
import { analyzeSyncDifferences, compareMarkdownDocuments, resolveSyncItem, executeBatchSync, deleteSyncItem, undoLocalSyncDeletion, classifySyncDifference } from '../src/services/syncEngineService';
import { saveWorkspaceToSanity, deleteWorkspaceFromSanity, normalizeSanityWorkspaceDoc, workspacesFromSanityDocuments, fetchSanityDocumentsList } from '../src/services/sanityService';

class MemoryStorage implements Storage {
  [key: string]: any;
  get length() { return Object.keys(this).length; }
  key(index: number) { return Object.keys(this)[index] || null; }
  getItem(key: string) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key: string, value: string) { this[key] = String(value); }
  removeItem(key: string) { delete this[key]; }
  clear() { for (const key of Object.keys(this)) delete this[key]; }
}

class FakeSanity {
  documents = new Map<string, any>();
  querySnapshot?: Map<string, any>;
  commits = 0;
  offline = false;
  failAfterCommit = false;
  beforeCommit?: () => void;
  waitForId?: string;
  release?: () => void;
  revision = 0;
  client = () => ({
    getDocument: async (id: string) => this.client().fetch('*[_id == $id][0]', { id, direct: true }),
    getDocuments: async (ids: string[]) => Promise.all(ids.map(id => this.client().getDocument(id))),
    fetch: async (query: string, params: any) => {
      if (this.offline) throw new Error('offline');
      if (params.id === this.waitForId) {
        this.waitForId = undefined;
        await new Promise<void>(resolve => { this.release = resolve; });
      }
      const documents = params.direct ? this.documents : this.querySnapshot || this.documents;
      if (query.includes('_id == $id')) return structuredClone(documents.get(params.id) || null);
      if (query.includes('_type == "workspace"')) return structuredClone([...documents.values()].find(d =>
        d._type === 'workspace' && d.workspaceId === params.id && d.syncOwner === params.owner) || null);
      return structuredClone([...documents.values()].filter(d => d._type === 'task' &&
        d.workspaceId === params.id && (!d.syncOwner || d.syncOwner === params.owner)));
    },
    transaction: () => {
      const changes: any[] = [];
      const transaction = {
        create: (doc: any) => { changes.push({ doc }); return transaction; },
        patch: (id: string, callback: any) => {
          let revision: string;
          const patch = { ifRevisionId: (rev: string) => { revision = rev; return patch; },
            set: (fields: any) => { changes.push({ id, revision, fields }); return patch; },
            unset: (keys: string[]) => { changes[changes.length - 1].removed = keys; return patch; } };
          callback(patch);
          return transaction;
        },
        commit: async () => {
          if (this.offline) throw new Error('offline');
          this.beforeCommit?.();
          this.beforeCommit = undefined;
          for (const change of changes) {
            const current = this.documents.get(change.id || change.doc._id);
            if (change.doc ? current : current?._rev !== change.revision) {
              throw Object.assign(new Error('revision conflict'), { statusCode: 409 });
            }
          }
          this.commits++;
          const results = changes.map(change => {
            const doc = change.doc || { ...this.documents.get(change.id), ...change.fields };
            for (const key of change.removed || []) delete doc[key];
            const next = { ...doc, _rev: `r${++this.revision}` };
            this.documents.set(next._id, structuredClone(next));
            return next;
          });
          if (this.failAfterCommit) { this.failAfterCommit = false; throw new Error('response lost'); }
          return structuredClone(results);
        },
      };
      return transaction;
    },
  });
}

const config = { projectId: 'project', dataset: 'production', token: 'token-a', apiVersion: '2024-03-01', useCdn: false };
const markdown = '# Tareas\n\n## General\n- [ ] A\n  id: x\n  priority: P1\n';
const task = () => ({ _id: 'task-test', _type: 'task', _rev: 'r0', syncOwner: 'user-a', taskId: 'x', title: 'A', status: 'todo', completed: false });
const workspace = () => ({ _id: 'workspace-w', _type: 'workspace', _rev: 'r0', syncOwner: 'user-a', workspaceId: 'w',
  createdAt: '2026-10-09T09:00:00.000Z',
  name: 'W', activeBranchName: 'main', branches: [{ name: 'main', activeDocumentId: 'd',
    taskDocuments: [{ id: 'd', path: 'TASKS.md', name: 'TASKS.md', content: markdown }] }] });
let server: FakeSanity;
let sync: DocumentSync;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'user-a' }), { status: 200 });
  server = new FakeSanity();
  sync = new DocumentSync(server.client);
  await beginSyncSession(config);
});
afterEach(() => { flushWorkspaceStoreSaves(); invalidateSyncSession(); globalThis.fetch = originalFetch; });

// Regression tests for the confirmed data-safety defects.
function storeFor(raw: any) {
  const ws = normalizeSanityWorkspaceDoc(raw);
  return { scope: getSyncSession()!.scope, workspaces: [structuredClone(ws)], remoteBase: [structuredClone(ws)],
    remoteDocuments: [structuredClone(raw)], activeWorkspaceId: ws.id };
}
function useSingleton(context: any, raw: any) {
  documentSync.forget(); context.mock.method(documentSync as any, 'clientFactory', server.client);
  server.documents.set(raw._id, structuredClone(raw)); documentSync.observe(raw);
}
async function mockApiConfig(context: any, docs: any[], direct = docs) {
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(_request.url?.includes('/data/doc/') ? { documents: direct.filter(d => decodeURIComponent(_request.url!.split('/').pop()!).split(',').includes(d._id)) } : { result: docs }));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  context.after(() => { api.closeAllConnections(); api.close(); });
  const address = api.address() as { port: number };
  return { ...config, apiHost: `http://127.0.0.1:${address.port}`, useProjectHostname: false };
}
async function analyzeMock(context: any, store: any, docs: any[]) {
  return analyzeSyncDifferences(store, await mockApiConfig(context, docs));
}
const pendingKeys = () => Object.keys(localStorage).filter(k => k.startsWith('antask_sync_pending:'));

test('AUDIT P0: smart push must preserve an edit made after analysis', async context => {
  const raw = workspace(); useSingleton(context, raw);
  const saved = await documentSync.write(raw, config); const store = storeFor(saved);
  store.workspaces[0].name = 'Local rename';
  const result = await analyzeMock(context, store, [...server.documents.values()]);
  const item = result.items.find(i => i.entityType === 'workspace')!;
  assert.equal(item.diffType, 'local_override');
  server.documents.set(raw._id, { ...saved, name: 'Remote rename after analysis', _rev: 'remote-new' });
  const batch = await executeBatchSync([item], 'smart', store, config);
  assert.equal(server.documents.get(raw._id).name, 'Remote rename after analysis', batch.message);
});

test('AUDIT P0: uploading one Markdown file must preserve other remote workspace fields', async context => {
  const raw = workspace(); useSingleton(context, raw); const store = storeFor(raw);
  store.workspaces[0].branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Local');
  const item = compareMarkdownDocuments(store, [normalizeSanityWorkspaceDoc(raw)])[0];
  server.documents.set(raw._id, { ...raw, name: 'Remote rename', _rev: 'remote-new' });
  await resolveSyncItem(item, 'keep_local', store, config, true);
  assert.equal(server.documents.get(raw._id).name, 'Remote rename');
});

test('AUDIT P0: raw workspace revision and hydrated content must describe the same task state', async context => {
  const raw = workspace(); useSingleton(context, raw); const initial = await documentSync.write(raw, config);
  const previousTask = structuredClone([...server.documents.values()].find(d => d._type === 'task'));
  const edit = structuredClone(initial); edit.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Remote new title');
  const current = await documentSync.write(edit, config);
  // A mixed query result contains the current workspace with the older task projection.
  const hydrated = workspacesFromSanityDocuments([current, previousTask])[0];
  documentSync.observe(current); documentSync.observe(previousTask);
  hydrated.name = 'Unrelated local rename';
  const result = await saveWorkspaceToSanity(hydrated, config); assert(result.ok, result.message);
  assert(server.documents.get(raw._id).branches[0].taskDocuments[0].content.includes('Remote new title'));
});

test('AUDIT P0: a failed partial resolution must retain its durable pending workspace', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config);
  const store = storeFor(saved); const baseTask = structuredClone([...server.documents.values()].find(d => d._type === 'task'));
  store.remoteDocuments.push(baseTask); store.workspaces[0].name = 'Local rename';
  server.offline = true;
  await assert.rejects(documentSync.write({ ...saved, name: 'Local rename' }, config), /offline/);
  server.offline = false;
  const remoteWs = { ...saved, name: 'Remote rename', _rev: 'remote-new' };
  const remoteTask = { ...baseTask, title: 'Remote task title', _rev: 'remote-task' };
  const remoteWorkspace = workspacesFromSanityDocuments([remoteWs, remoteTask])[0];
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: remoteTask, remoteWorkspace, remoteWorkspaceDocument: remoteWs };
  await assert.rejects(resolveSyncItem(item, 'keep_remote', store, config, true), SyncConflict);
  assert(pendingKeys().length > 0, 'The resolution failed but removed the pending workspace');
});

test('AUDIT P1: one offline conflict must not prevent an independent document from syncing', async () => {
  const a = task(), b = { ...task(), _id: 'task-independent' };
  for (const d of [a, b]) { server.documents.set(d._id, d); sync.observe(d); }
  server.offline = true;
  await assert.rejects(sync.write({ ...a, title: 'B' }, config), /offline/);
  await assert.rejects(sync.write({ ...b, title: 'D' }, config), /offline/);
  server.offline = false; server.documents.set(a._id, { ...a, title: 'C', _rev: 'new-a' });
  await sync.flush(getSyncSession()!).catch(() => {});
  assert.equal(server.documents.get(b._id).title, 'D');
});

test('AUDIT P1: abandoning a rejected title edit must use the last confirmed base', async () => {
  const raw = task(); server.documents.set(raw._id, raw); sync.observe(raw);
  server.documents.set(raw._id, { ...raw, title: 'Remote title', _rev: 'new-remote' });
  await assert.rejects(sync.write({ ...raw, title: 'Rejected local title' }, config), SyncConflict);
  const saved = await sync.write({ ...raw, completed: true, status: 'done' }, config);
  assert.equal(saved.title, 'Remote title'); assert.equal(saved.completed, true);
});

test('AUDIT P0: absence of a shared base must not choose a winner using device timestamps', async context => {
  const raw = workspace(), remote = structuredClone(raw); remote._rev = 'remote-new';
  useSingleton(context, raw);
  remote.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Remote title');
  server.documents.set(raw._id, structuredClone(remote));
  const store = storeFor(raw); store.remoteBase = []; store.remoteDocuments = [];
  store.workspaces[0].updatedAt = '2099-01-01T00:00:00.000Z';
  const result = await analyzeMock(context, store, [remote]);
  const item = result.items.find(i => i.entityType === 'workspace')!;
  await executeBatchSync([item], 'smart', store, config);
  assert(server.documents.get(raw._id).branches[0].taskDocuments[0].content.includes('Remote title'));
});

test('AUDIT P1: changing only workspace metadata must not be reported as synced', async context => {
  const raw = workspace(), remote = structuredClone(raw);
  (remote as any).githubRepo = { ...normalizeSanityWorkspaceDoc(raw).githubRepo, description: 'Remote description' };
  const store = storeFor(raw), result = await analyzeMock(context, store, [remote]);
  assert.equal(result.items.find(i => i.entityType === 'workspace')!.diffType, 'remote_override');
});

test('AUDIT P1: remote-only Markdown deletion must actually remove the remote document', async context => {
  const raw = workspace(); raw.branches[0].taskDocuments.push({ id: 'note', path: 'NOTE.md', name: 'NOTE.md', content: '# Note\n' });
  useSingleton(context, raw); const store = storeFor(raw);
  const item = compareMarkdownDocuments(store, [normalizeSanityWorkspaceDoc(raw)]).find(i => i.documentPath === 'NOTE.md')!;
  const result = await deleteSyncItem(item, 'remote', store, config); assert(result.success, result.message);
  assert(!server.documents.get(raw._id).branches[0].taskDocuments.some((d: any) => d.id === 'note'));
});

test('AUDIT P0: deletion of one Markdown file must not overwrite a concurrent remote edit', async context => {
  const raw = workspace(); raw.branches[0].taskDocuments.push({ id: 'note', path: 'NOTE.md', name: 'NOTE.md', content: '# Note\n' });
  useSingleton(context, raw); const store = storeFor(raw);
  const item = compareMarkdownDocuments(store, [normalizeSanityWorkspaceDoc(raw)]).find(i => i.documentPath === 'NOTE.md')!;
  server.documents.set(raw._id, { ...raw, name: 'Remote concurrent rename', _rev: 'remote-new' });
  await deleteSyncItem(item, 'both', store, config);
  assert.equal(server.documents.get(raw._id).name, 'Remote concurrent rename');
});

test('AUDIT P1: a stale present snapshot must not replace an already acknowledged revision', async () => {
  const raw = workspace(); server.documents.set(raw._id, raw); sync.observe(raw);
  const current = await sync.write({ ...raw, name: 'Latest name' }, config);
  const reconciled = await sync.reconcileDeletions([current], [raw], config);
  assert.equal(reconciled[0]._rev, current._rev); assert.equal(reconciled[0].name, current.name);
});

test('AUDIT P0: an old account task deletion must not delete the new account document', async context => {
  const original = task(); useSingleton(context, original); const oldStore = storeFor(workspace());
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: original, title: 'Old account task', id: 'task_test' };
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'user-b' }), { status: 200 });
  const nextConfig = { ...config, token: 'token-b' }; await beginSyncSession(nextConfig);
  const otherAccount = { ...original, syncOwner: 'user-b', title: 'Other account task', _rev: 'account-b' };
  server.documents.set(original._id, otherAccount); documentSync.observe(otherAccount);
  await deleteSyncItem(item, 'remote', oldStore, nextConfig).catch(() => {});
  assert.notEqual(server.documents.get(original._id).syncDeleted, true);
});

test('AUDIT P0: workspace deletion must retain the revision that the user selected', async context => {
  const original = workspace(); useSingleton(context, original);
  const edited = { ...original, name: 'Remote edit during the deletion grace period', _rev: 'remote-new' };
  server.documents.set(original._id, structuredClone(edited));
  const result = await deleteWorkspaceFromSanity('w', await mockApiConfig(context, [edited]));
  assert.equal(result.ok, false, 'The helper replaced the old expected revision with the latest query result');
  assert.notEqual(server.documents.get(original._id).syncDeleted, true);
});

test('AUDIT P0: deleting only locally must not become a remote deletion through autosave', async context => {
  const original = workspace(); useSingleton(context, original); const saved = await documentSync.write(original, config);
  const store = storeFor(saved); const remoteTask = [...server.documents.values()].find(d => d._type === 'task');
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: remoteTask, title: 'Task x', id: 'task_test' };
  const deletion = await deleteSyncItem(item, 'local', store, config); assert(deletion.success);
  const autosave = await saveWorkspaceToSanity(deletion.updatedStore!.workspaces[0], config); assert(autosave.ok, autosave.message);
  assert.notEqual(server.documents.get(remoteTask._id).syncDeleted, true);
});


test('AUDIT: scoped local deletion and undo preserve another document with the same task ID', async context => {
  const raw = workspace(); raw.branches[0].taskDocuments.push({ id: 'other', name: 'OTHER.md', path: 'OTHER.md', content: markdown });
  useSingleton(context, raw); const store = storeFor(raw);
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, id: 'task_x', title: 'Task x' };
  const deleted = (await deleteSyncItem(item, 'local', store, config)).updatedStore!;
  assert.equal(deleted.workspaces[0].branches[0].taskDocuments[1].content, markdown);
  deleted.workspaces[0].name = 'New unrelated rename';
  deleted.workspaces[0].branches[0].taskDocuments[1].content += '\nNew notes\n';
  const restored = undoLocalSyncDeletion(deleted, store, item);
  assert.equal(restored.workspaces[0].name, 'New unrelated rename');
  assert(taskFields(restored.workspaces[0].branches[0].taskDocuments[0].content).some(t => t.taskId === 'x'));
  assert(restored.workspaces[0].branches[0].taskDocuments[1].content.includes('New notes'));
});

test('AUDIT: local hiding survives reload and a remote task edit without resurrection', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config);
  const store = storeFor(saved); const task = [...server.documents.values()].find(d => d._type === 'task');
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: task, title: 'Task x', id: 'task_x' };
  await deleteSyncItem(item, 'local', store, config);
  const loaded = loadWorkspaceStore(store.scope);
  const remote = normalizeSanityWorkspaceDoc(saved);
  remote.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Remote newer title');
  assert(!applyLocalDeletions(remote, loaded.workspaces[0].localOnlyDeletions).branches[0].taskDocuments[0].content.includes('id: x'));
});

test('AUDIT: choosing one local file neither uploads nor discards unrelated local edits', async context => {
  const raw = workspace(); useSingleton(context, raw); const store = storeFor(raw);
  store.workspaces[0].name = 'Unsent local rename';
  store.workspaces[0].branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Chosen local title');
  const item = compareMarkdownDocuments(store, [normalizeSanityWorkspaceDoc(raw)])[0];
  const result = await resolveSyncItem(item, 'keep_local', store, config, true);
  assert.equal(server.documents.get(raw._id).name, raw.name);
  assert.equal(result.updatedStore!.workspaces[0].name, 'Unsent local rename');
  assert.equal(result.updatedStore!.remoteBase![0].name, normalizeSanityWorkspaceDoc(raw).name);
});

test('AUDIT: an explicit workspace choice rejects changes after its preview', async context => {
  const raw = workspace(); useSingleton(context, raw); const store = storeFor(raw);
  store.workspaces[0].name = 'Chosen local rename';
  const item: any = { entityType: 'workspace', workspaceId: 'w', localData: store.workspaces[0], remoteWorkspaceDocument: raw };
  server.documents.set(raw._id, { ...raw, name: 'New remote rename', _rev: 'new-remote' });
  await assert.rejects(resolveSyncItem(item, 'keep_local', store, config, true), SyncConflict);
  assert.equal(server.documents.get(raw._id).name, 'New remote rename');
});

test('AUDIT: a new independent task projection is not replaced by an older acknowledged version', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config);
  const task = [...server.documents.values()].find(d => d._type === 'task');
  const fresh = { ...task, title: 'Studio edit', _rev: 'not-seen-before' };
  assert(workspacesFromSanityDocuments([saved, fresh])[0].branches[0].taskDocuments[0].content.includes('Studio edit'));
});

test('AUDIT: hidden tasks retain unknown metadata and subtasks in cloud autosave', async context => {
  const raw = workspace(); raw.branches[0].taskDocuments[0].content += '  custom: preserve\n  Subtasks: 0/1\n';
  useSingleton(context, raw); const saved = await documentSync.write(raw, config); const store = storeFor(saved);
  const remoteTask = [...server.documents.values()].find(d => d._type === 'task');
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: remoteTask, title: 'Task x', id: 'task_x' };
  const deleted = (await deleteSyncItem(item, 'local', store, config)).updatedStore!;
  const result = await saveWorkspaceToSanity(deleted.workspaces[0], config); assert(result.ok, result.message);
  const content = server.documents.get(raw._id).branches[0].taskDocuments[0].content;
  assert(content.includes('custom: preserve')); assert(content.includes('Subtasks: 0/1'));
  const restored = undoLocalSyncDeletion(deleted, store, item);
  assert(restored.workspaces[0].branches[0].taskDocuments[0].content.includes('Subtasks: 0/1'));
});

test('AUDIT: a failed batch workspace does not block an independent workspace', async context => {
  const raw = workspace(), other = { ...workspace(), _id: 'workspace-q', workspaceId: 'q', name: 'Q' };
  useSingleton(context, raw); server.documents.set(other._id, other); documentSync.observe(other);
  const store = storeFor(raw), second = storeFor(other);
  store.workspaces.push(second.workspaces[0]); store.remoteBase!.push(second.remoteBase![0]); store.remoteDocuments!.push(other);
  store.workspaces[0].name = 'Local first'; store.workspaces[1].name = 'Local second';
  server.documents.set(raw._id, { ...raw, name: 'Remote first', _rev: 'new-first' });
  const items: any[] = store.workspaces.map(w => ({ id: w.id, entityType: 'workspace', workspaceId: w.id,
    localData: w, diffType: 'local_override', resolutionStrategy: 'keep_local' }));
  const result = await executeBatchSync(items, 'smart', store, config);
  assert.equal(result.success, false); assert.equal(result.resolvedCount, 1);
  assert.equal(server.documents.get(raw._id).name, 'Remote first'); assert.equal(server.documents.get(other._id).name, 'Local second');
});

test('AUDIT: task deletion rejects the revision selected before a remote edit', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config); const store = storeFor(saved);
  const task = [...server.documents.values()].find(d => d._type === 'task');
  const current = { ...task, title: 'New remote title', _rev: 'new-task' };
  server.documents.set(task._id, current); documentSync.observe(current);
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: task, title: 'Task x', id: 'task_x' };
  const result = await deleteSyncItem(item, 'both', store, config);
  assert.equal(result.success, false); assert.equal(result.updatedStore, store);
  assert.equal(server.documents.get(task._id).title, 'New remote title'); assert(!server.documents.get(task._id).syncDeleted);
});

test('AUDIT: authoritative batch reads prevent mixed hydration on a fresh device', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config);
  const oldTask = structuredClone([...server.documents.values()].find(d => d._type === 'task'));
  const updated = structuredClone(saved); updated.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Newest title');
  const current = await documentSync.write(updated, config);
  const docs = [...server.documents.values()]; documentSync.forget();
  const read = await fetchSanityDocumentsList(await mockApiConfig(context, [current, oldTask], docs), true, false, false);
  assert(workspacesFromSanityDocuments(read)[0].branches[0].taskDocuments[0].content.includes('Newest title'));
});

test('AUDIT: device navigation is not a synchronized content change', () => {
  const base = normalizeSanityWorkspaceDoc(workspace());
  const local = { ...base, activeBranchName: 'local-tab', branches: base.branches.map((b: any) => ({ ...b, activeDocumentId: 'local-doc' })) };
  assert.equal(classifySyncDifference(base, local, base), 'synced');
});

test('AUDIT: a foreign account baseline cannot authorize a cloud write', async () => {
  const raw = task(); server.documents.set(raw._id, raw); sync.observe(raw);
  await assert.rejects(sync.write({ ...raw, completed: true }, config, { ...raw, syncOwner: 'other-account' }), SyncConflict);
  assert.equal(server.commits, 0);
});

test('AUDIT: intelligent workspace upload preserves a local-only task deletion scope', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config); const store = storeFor(saved);
  const remoteTask = [...server.documents.values()].find(d => d._type === 'task');
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: remoteTask, title: 'Task x', id: 'task_x' };
  const hidden = (await deleteSyncItem(item, 'local', store, config)).updatedStore!;
  hidden.workspaces[0].name = 'Local metadata edit';
  const wsItem: any = { entityType: 'workspace', workspaceId: 'w', localData: hidden.workspaces[0],
    diffType: 'local_override', resolutionStrategy: 'keep_local' };
  const result = await executeBatchSync([wsItem], 'smart', hidden, config); assert(result.success, result.message);
  assert.equal(server.documents.get(remoteTask._id).syncDeleted, undefined);
  assert.equal(server.documents.get(raw._id).name, 'Local metadata edit');
});

test('AUDIT: partial remote resolution retains and replays unrelated queued workspace edits', async context => {
  const raw = workspace(); useSingleton(context, raw); const saved = await documentSync.write(raw, config); const store = storeFor(saved);
  const baseTask = [...server.documents.values()].find(d => d._type === 'task');
  store.workspaces[0].name = 'Queued unrelated rename';
  server.offline = true; await assert.rejects(documentSync.write({ ...saved, name: store.workspaces[0].name }, config), /offline/);
  server.offline = false;
  const remoteTask = { ...baseTask, title: 'Chosen remote title', _rev: 'new-task' }; server.documents.set(baseTask._id, remoteTask);
  const remoteWorkspace = workspacesFromSanityDocuments([saved, remoteTask])[0];
  const item: any = { entityType: 'task', workspaceId: 'w', branchName: 'main', documentPath: 'TASKS.md',
    localData: { taskId: 'x' }, remoteData: remoteTask, remoteWorkspace, remoteWorkspaceDocument: saved };
  await resolveSyncItem(item, 'keep_remote', store, config, true);
  assert(pendingKeys().length > 0);
  await documentSync.flush(getSyncSession()!);
  assert.equal(server.documents.get(raw._id).name, 'Queued unrelated rename');
  assert(server.documents.get(raw._id).branches[0].taskDocuments[0].content.includes('Chosen remote title'));
});

test('AUDIT: canvas normalization of an empty placeholder does not create cloud content', () => {
  const placeholder = createEmptyWorkspace();
  assert(isEmptyWorkspacePlaceholder(placeholder));
  placeholder.branches[0].taskDocuments[0].content = '# Tareas\n\n';
  assert(isEmptyWorkspacePlaceholder(placeholder));
  placeholder.branches[0].taskDocuments[0].content += 'Actual local note\n';
  assert(!isEmptyWorkspacePlaceholder(placeholder));
});
