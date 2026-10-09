import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { DocumentSync, SyncConflict, mergeSyncValue, mergeMarkdown, buildTaskDocumentId, deletionMarkerId } from '../src/services/documentSyncService';
import { beginSyncSession, getSyncSession, invalidateSyncSession } from '../src/services/syncSessionService';
import { createEmptyWorkspace, createTaskDocument, loadWorkspaceStore, saveWorkspaceStore, flushWorkspaceStoreSaves, sanitizeWorkspace } from '../src/services/workspaceService';
import { compareMarkdownDocuments } from '../src/services/syncEngineService';
import { applyRemoteTask, clearSanityConfig, getSanityConfig, normalizeSanityWorkspaceDoc, workspacesFromSanityDocuments, subscribeToSanityLiveChanges } from '../src/services/sanityService';
import { scanTaskBlocks, updateTaskInMarkdown } from '../src/utils/markdownSync';

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

test('typing batches workspace persistence and flush keeps the latest edit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = loadWorkspaceStore(); saveWorkspaceStore(initial);
  saveWorkspaceStore({ ...initial, workspaces: [{ ...initial.workspaces[0], name: 'First edit' }] }, 350);
  t.mock.timers.tick(200);
  saveWorkspaceStore({ ...initial, workspaces: [{ ...initial.workspaces[0], name: 'Latest edit' }] }, 350);
  t.mock.timers.tick(200);
  assert.equal(loadWorkspaceStore().workspaces[0].name, initial.workspaces[0].name);
  flushWorkspaceStoreSaves();
  assert.equal(loadWorkspaceStore().workspaces[0].name, 'Latest edit');
  t.mock.timers.tick(1000);
  assert.equal(loadWorkspaceStore().workspaces[0].name, 'Latest edit');
});

test('an immediate workspace save supersedes an older buffered snapshot', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = loadWorkspaceStore();
  saveWorkspaceStore({ ...initial, workspaces: [{ ...initial.workspaces[0], name: 'Buffered' }] }, 350);
  saveWorkspaceStore({ ...initial, workspaces: [{ ...initial.workspaces[0], name: 'Merged remote' }] });
  t.mock.timers.tick(1000);
  assert.equal(loadWorkspaceStore().workspaces[0].name, 'Merged remote');
});

test('first login has an empty isolated workspace and does not publish examples', () => {
  const store = loadWorkspaceStore();
  assert.equal(store.scope, getSyncSession()!.scope);
  assert.equal(scanTaskBlocks(store.workspaces[0].branches[0].taskDocuments[0].content).taskBlocks.length, 0);
  assert.equal(server.commits, 0);
});

test('Markdown files with the same name retain separate IDs and sync entries without tasks', async () => {
  const first = createTaskDocument('README.md', '# First document\n');
  const second = createTaskDocument('README.md', '# Second document\n', 'docs');
  assert.notEqual(first.id, second.id);
  const raw = workspace(); raw.branches[0].taskDocuments = [first, second] as any;
  server.documents.set(raw._id, raw); sync.observe(raw);
  const result = await sync.write(raw, config);
  const cloud = workspacesFromSanityDocuments([result]);
  assert.deepEqual(cloud[0].branches[0].taskDocuments.map((doc: any) => doc.content), [first.content, second.content]);
  const store = { scope: getSyncSession()!.scope, workspaces: [cloud[0]], activeWorkspaceId: 'w', remoteBase: cloud };
  const entries = compareMarkdownDocuments(store, cloud);
  assert.equal(entries.length, 2); assert.equal(new Set(entries.map(entry => entry.id)).size, 2);
  assert.deepEqual(entries.map(entry => entry.documentPath), ['README.md', 'docs/README.md']);
  assert(entries.every(entry => entry.diffType === 'synced'));
});

test('Sanity array keys distinguish two documents named README.md without application IDs', () => {
  const raw = workspace(); raw.branches[0].taskDocuments = [
    { _key: 'first', name: 'README.md', path: 'README.md', content: '# First' },
    { _key: 'second', name: 'README.md', path: 'README.md', content: '# Second' },
  ] as any;
  const normalized = normalizeSanityWorkspaceDoc(raw);
  assert.deepEqual(normalized.branches[0].taskDocuments.map((doc: any) => doc.id), ['first', 'second']);
  assert.equal(mergeSyncValue([], normalized.branches[0].taskDocuments, normalized.branches[0].taskDocuments).length, 2);
});

test('tasks with the same ID in separate Markdown files are saved and hydrated independently', async () => {
  const raw = workspace(); const other = { ...raw.branches[0].taskDocuments[0], id: 'other', name: 'README.md', path: 'docs/README.md', content: markdown.replace('[ ] A', '[ ] B') };
  raw.branches[0].taskDocuments.push(other);
  server.documents.set(raw._id, raw); sync.observe(raw);
  const result = await sync.write(raw, config);
  assert.equal(server.documents.get(buildTaskDocumentId('x', 'w', 'main::d')).title, 'A');
  assert.equal(server.documents.get(buildTaskDocumentId('x', 'w', 'main::other')).title, 'B');
  const hydrated = workspacesFromSanityDocuments([...server.documents.values()]);
  assert(hydrated[0].branches[0].taskDocuments[0].content.includes('[ ] A'));
  assert(hydrated[0].branches[0].taskDocuments[1].content.includes('[ ] B'));
  assert.equal(result.branches[0].taskDocuments.length, 2);
});

test('A -> logout -> B -> A isolates and restores browser state', async () => {
  const a = loadWorkspaceStore();
  a.workspaces[0].name = 'Datos de A';
  saveWorkspaceStore(a);
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'user-b' }));
  await beginSyncSession({ ...config, token: 'token-b' });
  const b = loadWorkspaceStore();
  assert.notEqual(b.scope, a.scope);
  assert(!b.workspaces.some(w => w.name === 'Datos de A'));
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'user-a' }));
  await beginSyncSession(config);
  assert.equal(loadWorkspaceStore().workspaces[0].name, 'Datos de A');
});

test('an old in-flight operation cannot commit after a rapid account change', async () => {
  const doc = task(); server.documents.set(doc._id, doc); sync.observe(doc);
  server.waitForId = doc._id;
  const pending = sync.write({ ...doc, title: 'B' }, config);
  while (!server.release) await new Promise(resolve => setTimeout(resolve, 0));
  const rejection = assert.rejects(pending, /sesión/);
  await beginSyncSession({ ...config, token: 'token-b' });
  server.release!();
  await rejection;
  assert.equal(server.commits, 0);
});

test('three-way merge preserves edits to different fields', async () => {
  const base = task(); server.documents.set(base._id, { ...base, status: 'done', completed: true, _rev: 'remote' }); sync.observe(base);
  const result = await sync.write({ ...base, title: 'B' }, config);
  assert.equal(result.title, 'B'); assert.equal(result.status, 'done'); assert.equal(result.completed, true);
});

test('concurrent edits to the same field are detected and retained pending', async () => {
  const base = task(); server.documents.set(base._id, { ...base, title: 'C', _rev: 'remote' }); sync.observe(base);
  await assert.rejects(sync.write({ ...base, title: 'B' }, config), SyncConflict);
  assert.equal(server.documents.get(base._id).title, 'C');
  assert(Object.keys(localStorage).some(k => k.startsWith('antask_sync_pending:')));
});

test('revision race retries against the new document without losing its fields', async () => {
  const base = task(); server.documents.set(base._id, base); sync.observe(base);
  server.beforeCommit = () => server.documents.set(base._id, { ...base, completed: true, status: 'done', _rev: 'r-race' });
  const result = await sync.write({ ...base, title: 'B' }, config);
  assert.equal(result.title, 'B'); assert.equal(result.status, 'done'); assert.equal(server.commits, 1);
});

test('saving uses the current document revision while GROQ remains stale', async () => {
  const base = task(); sync.observe(base);
  server.querySnapshot = new Map([[base._id, base]]);
  server.documents.set(base._id, { ...base, completed: true, status: 'done', _rev: 'new' });
  const result = await sync.write({ ...base, title: 'B' }, config);
  assert.equal(result.title, 'B'); assert.equal(result.completed, true);
  assert.equal(server.commits, 1);
});

test('workspace saves find newly created task projections before GROQ indexes them', async () => {
  const base = workspace(); server.documents.set(base._id, base); sync.observe(base);
  server.querySnapshot = structuredClone(server.documents);
  const next = structuredClone(base); next.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] B');
  const saved = await sync.write(next, config);
  const again = structuredClone(saved); again.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] C');
  await sync.write(again, config);
  assert.equal(server.documents.get(buildTaskDocumentId('x', 'w', 'main::d')).title, 'C');
  assert.equal(server.commits, 2);
});

test('task projection reads the current parent workspace despite stale GROQ', async () => {
  const parent = workspace(); server.querySnapshot = new Map([[parent._id, parent]]);
  server.documents.set(parent._id, { ...parent, name: 'Remote name', _rev: 'new' });
  const doc = { ...task(), workspaceId: 'w', documentKey: 'main::d' };
  server.documents.set(doc._id, doc); sync.observe(doc);
  await sync.write({ ...doc, title: 'B' }, config);
  assert.equal(server.documents.get(parent._id).name, 'Remote name');
  assert(server.documents.get(parent._id).branches[0].taskDocuments[0].content.includes('[ ] B'));
});

test('a remotely deleted document cannot be recreated by an old snapshot', async () => {
  const base = task(); sync.observe(base);
  await assert.rejects(sync.write({ ...base, title: 'B' }, config), /eliminado/);
  assert.equal(server.commits, 0);
});

test('confirmed delete survives reload and even an old createOrReplace', async () => {
  const base = task(); server.documents.set(base._id, base); sync.observe(base);
  await sync.remove(base._id, base._type, config);
  assert(server.documents.get(base._id).syncDeleted);
  assert(server.documents.has(deletionMarkerId(base._id)));
  server.documents.set(base._id, base); // simulate a historical client replacing the tombstone
  const reloaded = new DocumentSync(server.client); reloaded.observe(base);
  await assert.rejects(reloaded.write({ ...base, title: 'Old offline edit' }, config), /eliminado/);
});

test('offline edits retain their original base and recover after reload', async () => {
  const base = task(); server.documents.set(base._id, base); sync.observe(base);
  server.offline = true;
  await assert.rejects(sync.write({ ...base, title: 'B' }, config), /offline/);
  server.offline = false;
  server.documents.set(base._id, { ...base, completed: true, status: 'done', _rev: 'remote' });
  await new DocumentSync(server.client).flush(getSyncSession()!);
  assert.equal(server.documents.get(base._id).title, 'B');
  assert.equal(server.documents.get(base._id).status, 'done');
});

test('server success plus lost response plus retry creates exactly one document', async () => {
  const doc = { _id: 'new-stable-id', _type: 'task', taskId: 'x', title: 'A' };
  server.failAfterCommit = true;
  await assert.rejects(sync.write(doc, config), /response lost/);
  await new DocumentSync(server.client).flush(getSyncSession()!);
  assert.equal([...server.documents.values()].filter(d => d.taskId === 'x').length, 1);
});

test('two clients keep different fields and detect competing edits', async () => {
  const base = task(); server.documents.set(base._id, base); sync.observe(base);
  const second = new DocumentSync(server.client); second.observe(base);
  await sync.write({ ...base, title: 'B' }, config);
  await second.write({ ...base, status: 'done', completed: true }, config);
  assert.equal(server.documents.get(base._id).title, 'B');
  assert.equal(server.documents.get(base._id).status, 'done');
  const third = new DocumentSync(server.client); third.observe(base);
  await assert.rejects(third.write({ ...base, title: 'C' }, config), /Conflicto/);
});

test('unknown remote snapshots and documents owned by another account cannot be overwritten', async () => {
  const remote = task(); server.documents.set(remote._id, remote);
  await assert.rejects(sync.write({ _id: remote._id, _type: 'task', title: 'B' }, config), /base local/);
  server.documents.set(remote._id, { ...remote, syncOwner: 'user-b' }); sync.observe(remote);
  await assert.rejects(sync.write({ ...remote, title: 'B' }, config), /otra cuenta/);
});

test('Markdown merge preserves title versus checkbox and other independent metadata', () => {
  const remote = markdown.replace('[ ]', '[x]');
  const local = markdown.replace('[ ] A', '[ ] B');
  const merged = mergeMarkdown(markdown, local, remote);
  assert(merged.includes('[x] B'));
  assert.throws(() => mergeMarkdown(markdown, local, markdown.replace('[ ] A', '[ ] C')), SyncConflict);
  const tags = markdown + '  tags: backend\n';
  assert(mergeMarkdown(markdown, local, tags).includes('tags: backend'));
});

test('workspace and task projection commit atomically and preserve an empty document', async () => {
  const base = workspace(); server.documents.set(base._id, base); sync.observe(base);
  const next = structuredClone(base); next.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] B');
  await sync.write(next, config);
  const id = buildTaskDocumentId('x', 'w', 'main::d');
  assert.equal(server.documents.get(id).title, 'B');
  assert.equal(server.commits, 1);
  const current = server.documents.get(base._id);
  const empty = structuredClone(current); empty.branches[0].taskDocuments[0].content = '# Tareas\n';
  await sync.write(empty, config);
  assert(server.documents.get(id).syncDeleted);
  assert(server.documents.has(deletionMarkerId(id)));
  assert.equal(server.documents.get(base._id).branches[0].taskDocuments[0].content, '# Tareas\n');
});

test('editing a task updates the corresponding workspace Markdown atomically', async () => {
  const parent = workspace(); server.documents.set(parent._id, parent);
  const doc = { ...task(), workspaceId: 'w', documentKey: 'main::d' };
  server.documents.set(doc._id, doc); sync.observe(doc);
  await sync.write({ ...doc, title: 'B', completed: true, status: 'done' }, config);
  assert(server.documents.get(parent._id).branches[0].taskDocuments[0].content.includes('[x] B'));
  assert.equal(server.commits, 1);
});

test('failed deletion reports failure and leaves a durable pending operation', async () => {
  const doc = task(); server.documents.set(doc._id, doc); sync.observe(doc); server.offline = true;
  await assert.rejects(sync.remove(doc._id, doc._type, config), /offline/);
  assert(!server.documents.get(doc._id).syncDeleted);
  assert(Object.keys(localStorage).some(k => k.startsWith('antask_sync_pending:')));
});

test('IDs are isolated across workspace, branch, document and punctuation', () => {
  const id = buildTaskDocumentId('x', 'w', 'main::d');
  assert.notEqual(id, buildTaskDocumentId('x', 'other', 'main::d'));
  assert.notEqual(id, buildTaskDocumentId('x', 'w', 'dev::d'));
  assert.notEqual(id, buildTaskDocumentId('x', 'w', 'main::other'));
  assert.notEqual(buildTaskDocumentId('a/b', 'w', 'main::d'), buildTaskDocumentId('a_b', 'w', 'main::d'));
});

test('normalization and local persistence preserve revision and layout', () => {
  const raw = workspace();
  const normalized = normalizeSanityWorkspaceDoc(raw);
  assert.equal(sanitizeWorkspace(normalized)._rev, raw._rev);
  const local = loadWorkspaceStore(); local.workspaces = [normalized]; local.activeWorkspaceId = 'w';
  saveWorkspaceStore(local);
  assert.equal(loadWorkspaceStore().workspaces[0]._rev, raw._rev);
});

test('remote completed tasks and tombstones hydrate correctly without publishing', () => {
  const parent = workspace();
  const remote = { ...task(), workspaceId: 'w', documentKey: 'main::d', completed: true, status: 'done' };
  let pulled = workspacesFromSanityDocuments([parent, remote]);
  assert(pulled[0].branches[0].taskDocuments[0].content.includes('[x] A'));
  pulled = workspacesFromSanityDocuments([parent, { ...remote, syncDeleted: true }]);
  assert.equal(scanTaskBlocks(pulled[0].branches[0].taskDocuments[0].content).taskBlocks.length, 0);
  assert.equal(server.commits, 0);
});

test('disconnect overrides environment defaults and invalidates the current session', () => {
  clearSanityConfig();
  assert.equal(getSanityConfig().projectId, '');
  assert.equal(getSanityConfig().token, '');
  assert.equal(getSyncSession(), null);
});

test('same credential can recover the known account identity while offline', async () => {
  const scope = getSyncSession()!.scope;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await beginSyncSession(config);
  assert.equal(getSyncSession()!.scope, scope);
  await assert.rejects(beginSyncSession({ ...config, token: 'unknown-token' }), /offline/);
});

test('successive offline edits replay in order after a browser reload', async () => {
  const base = task(); server.documents.set(base._id, base); sync.observe(base);
  server.offline = true;
  await assert.rejects(sync.write({ ...base, title: 'B' }, config), /offline/);
  await assert.rejects(sync.write({ ...base, title: 'C' }, config), /offline/);
  server.offline = false;
  await new DocumentSync(server.client).flush(getSyncSession()!);
  assert.equal(server.documents.get(base._id).title, 'C');
  assert.equal(Object.keys(localStorage).filter(k => k.startsWith('antask_sync_pending:')).length, 0);
});

test('explicit conflict resolution removes rejected operations without replaying them', async () => {
  const base = task(); sync.observe(base);
  server.documents.set(base._id, { ...base, title: 'Remote', _rev: 'remote' });
  await assert.rejects(sync.write({ ...base, title: 'Local' }, config), SyncConflict);
  const resolved = await sync.resolve({ ...base, title: 'Chosen' }, config);
  assert.equal(resolved.title, 'Chosen');
  await sync.flush(getSyncSession()!);
  assert.equal(server.documents.get(base._id).title, 'Chosen');
});

test('workspace projection reuses an unambiguous legacy task ID', async () => {
  const parent = workspace(); server.documents.set(parent._id, parent); sync.observe(parent);
  const legacy = { ...task(), workspaceId: 'w', priority: 'P1', groupTitle: 'General', tags: [], blockedBy: '' };
  server.documents.set(legacy._id, legacy);
  const next = structuredClone(parent); next.name = 'Updated';
  await sync.write(next, config);
  const tasks = [...server.documents.values()].filter(d => d._type === 'task');
  assert.equal(tasks.length, 1); assert.equal(tasks[0]._id, legacy._id);
  assert.equal(tasks[0].documentKey, 'main::d');
});

test('ambiguous legacy task IDs are reported instead of copied into multiple documents', async () => {
  const parent = workspace(); parent.branches[0].taskDocuments.push({ ...parent.branches[0].taskDocuments[0], id: 'second', path: 'other.md' });
  server.documents.set(parent._id, parent); sync.observe(parent);
  server.documents.set('legacy', { ...task(), _id: 'legacy', workspaceId: 'w' });
  await assert.rejects(sync.write({ ...parent, name: 'Updated' }, config), /no identifica/);
  assert.equal(server.commits, 0);
});

test('task writes detect an independently edited Markdown title', async () => {
  const parent = workspace(); parent.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] Remote');
  server.documents.set(parent._id, parent);
  const base = { ...task(), workspaceId: 'w', documentKey: 'main::d' };
  server.documents.set(base._id, base); sync.observe(base);
  await assert.rejects(sync.write({ ...base, title: 'Local' }, config), SyncConflict);
  assert.equal(server.commits, 0);
});

test('deletion conflicts with an edit made after its downloaded revision', async () => {
  const base = workspace(); sync.observe(base);
  server.documents.set(base._id, { ...base, name: 'Remote edit', _rev: 'remote' });
  await assert.rejects(sync.remove(base._id, base._type, config), /editado/);
  assert.equal(server.commits, 0);
});

test('new Studio tasks with a selected workspace are attached to its active document', async () => {
  const parent = workspace(); server.documents.set(parent._id, parent);
  const result = await sync.write({ _id: 'new-task', _type: 'task', taskId: 'new', workspaceId: 'w', title: 'New', completed: true, status: 'done' }, config);
  assert.equal(result.documentKey, 'main::d');
  assert(server.documents.get(parent._id).branches[0].taskDocuments[0].content.includes('[x] New'));
});

test('durable task deletion prevents an older workspace from recreating it', async () => {
  const parent = workspace(); server.documents.set(parent._id, parent); sync.observe(parent);
  const id = buildTaskDocumentId('x', 'w', 'main::d');
  server.documents.set(deletionMarkerId(id), { _id: deletionMarkerId(id), _type: 'syncDeletion', syncOwner: 'user-a' });
  await assert.rejects(sync.write({ ...parent, name: 'Updated' }, config), /eliminada/);
  assert.equal(server.commits, 0);
});

test('simultaneous metadata edits preserve unknown lines and do not duplicate keys', () => {
  const original = '# Tareas\n\n## General\n- [ ] A\n  id: x\n  tags: old\n  custom: preserve\n  blockedBy: old\n';
  const result = updateTaskInMarkdown(original, 'x', { priority: 'P0', status: 'blocked', tags: ['new'], blockedBy: 'other' });
  const block = scanTaskBlocks(result).taskBlocks[0];
  assert.equal(block.detectedPriority, 'P0'); assert.equal(block.detectedStatus, 'blocked');
  assert.deepEqual(block.detectedTags, ['new']); assert.equal(block.detectedBlockedBy, 'other');
  assert(result.includes('custom: preserve')); assert.equal(result.match(/tags:/gi)?.length, 1);
});

test('Sanity IDs remain bounded for long paths and UUID workspace IDs', () => {
  assert(buildTaskDocumentId('x'.repeat(200), crypto.randomUUID(), 'main::' + 'a'.repeat(200)).length <= 128);
  assert(deletionMarkerId('a'.repeat(128)).length <= 128);
});

test('a physical Studio task deletion removes its Markdown and leaves a durable marker', async () => {
  const parent = workspace(); server.documents.set(parent._id, parent); sync.observe(parent);
  const old = { ...task(), workspaceId: 'w', documentKey: 'main::d' }; sync.observe(old);
  const result = await sync.reconcileDeletions([parent, old], [parent], config);
  assert(result.find(d => d._id === old._id)?.syncDeleted);
  assert.equal(scanTaskBlocks(server.documents.get(parent._id).branches[0].taskDocuments[0].content).taskBlocks.length, 0);
  assert(server.documents.has(deletionMarkerId(old._id)));
});

test('a physical workspace deletion and its vanished children reconcile together', async () => {
  const parent = workspace(); sync.observe(parent);
  const old = { ...task(), workspaceId: 'w', documentKey: 'main::d' }; sync.observe(old);
  const result = await sync.reconcileDeletions([parent, old], [], config);
  assert(result.every(d => d.syncDeleted));
  assert(server.documents.has(deletionMarkerId(parent._id)));
  assert(server.documents.has(deletionMarkerId(old._id)));
});

test('task hydration preserves a remote group move and a new contextual Studio task', () => {
  const parent = workspace();
  const moved = { ...task(), workspaceId: 'w', documentKey: 'main::d', groupTitle: 'Other' };
  const newTask = { ...task(), _id: 'native', taskId: 'native', title: 'Native', workspaceId: 'w' };
  const content = workspacesFromSanityDocuments([parent, moved, newTask])[0].branches[0].taskDocuments[0].content;
  const blocks = scanTaskBlocks(content).taskBlocks;
  assert.equal(blocks.find(b => b.detectedId === 'x')?.groupTitle, 'Other');
  assert.equal(blocks.find(b => b.detectedId === 'native')?.detectedTitle, 'Native');
});

test('remote canvas revisions hydrate the exact workspace, branch and document', () => {
  const parent = workspace();
  const visual = { _id: 'canvasVisualState-w__main__d', _type: 'canvasVisualState', _rev: 'layout', tasks: [], groups: [] };
  const pulled = workspacesFromSanityDocuments([parent, visual]);
  assert.equal(pulled[0].branches[0].taskDocuments[0].visualState?._rev, 'layout');
});

test('two offline tabs retain independent bases and report competing edits on reconnect', async () => {
  const base = task(); server.documents.set(base._id, base);
  const a = new DocumentSync(server.client, 'tab-a'), b = new DocumentSync(server.client, 'tab-b');
  a.observe(base); b.observe(base); server.offline = true;
  await assert.rejects(a.write({ ...base, title: 'B' }, config), /offline/);
  await assert.rejects(b.write({ ...base, title: 'C' }, config), /offline/);
  server.offline = false;
  await assert.rejects(a.flush(getSyncSession()!), SyncConflict);
  assert.equal(server.documents.get(base._id).title, 'B');
});

test('removing an optional field persists the deletion without dropping unrelated fields', async () => {
  const base = { ...task(), description: 'Remove this', custom: 'Keep this' };
  server.documents.set(base._id, base); sync.observe(base);
  const { description, ...next } = base;
  const saved = await sync.write(next, config);
  assert.equal(saved.description, undefined); assert.equal(saved.custom, 'Keep this');
});

test('acknowledging a workspace save adopts its revision before editing the same task again', async () => {
  const original = { ...workspace(), _createdAt: '2026-10-09T09:00:00Z' }; server.documents.set(original._id, original); sync.observe(original);
  const base = normalizeSanityWorkspaceDoc(original);
  const local = structuredClone(base); local.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] B');
  const intention = { ...original, branches: local.branches };
  const saved = await sync.write(intention, config);
  const remote = normalizeSanityWorkspaceDoc(saved);
  const acknowledged = mergeSyncValue(base, local, remote, '/workspace');
  assert.equal(acknowledged._rev, saved._rev);
  acknowledged.branches[0].taskDocuments[0].content = acknowledged.branches[0].taskDocuments[0].content.replace('[ ] B', '[ ] C');
  await sync.write({ ...saved, _rev: acknowledged._rev, branches: acknowledged.branches }, config);
  assert(server.documents.get(original._id).branches[0].taskDocuments[0].content.includes('[ ] C'));
});

test('receiving a remote revision preserves an unsaved compatible edit and rebases its next save', async () => {
  const original = workspace(); server.documents.set(original._id, original); sync.observe(original);
  const base = normalizeSanityWorkspaceDoc(original);
  const local = structuredClone(base); local.branches[0].taskDocuments[0].content = markdown.replace('P1', 'P0');
  const other = structuredClone(original); other.branches[0].taskDocuments[0].content = markdown.replace('[ ] A', '[ ] B');
  const saved = await sync.write(other, config);
  const remote = normalizeSanityWorkspaceDoc(saved);
  const merged = mergeSyncValue(base, local, remote, '/workspace');
  assert.equal(merged._rev, saved._rev);
  assert(merged.branches[0].taskDocuments[0].content.includes('P0'));
  await sync.write({ ...saved, branches: merged.branches }, config);
  assert.equal(server.documents.get(buildTaskDocumentId('x', 'w', 'main::d')).priority, 'P0');
});

test('two clients combine edits to different parts of the same task title', async () => {
  const base = { ...task(), title: 'Write report' }; server.documents.set(base._id, base); sync.observe(base);
  const other = new DocumentSync(server.client, 'other-browser'); other.observe(base);
  await sync.write({ ...base, title: 'Write final report' }, config);
  const merged = await other.write({ ...base, title: 'Write report today' }, config);
  assert.equal(merged.title, 'Write final report today');
});

test('equal remote content still advances the revision of a locally edited workspace', () => {
  const base = { _id: 'workspace-w', _rev: 'old', name: 'W' };
  const merged = mergeSyncValue([base], [{ ...base, name: 'Local edit' }], [{ ...base, _rev: 'new' }], '/workspaces');
  assert.equal(merged[0].name, 'Local edit'); assert.equal(merged[0]._rev, 'new');
});

test('compatible edits inside the same Markdown task line combine without blocking sync', () => {
  const base = markdown.replace('[ ] A', '[ ] Write report');
  const a = base.replace('Write report', 'Write final report');
  const b = base.replace('Write report', 'Write report today');
  assert(mergeMarkdown(base, a, b).includes('Write final report today'));
  assert.equal(mergeMarkdown(base, a, b), mergeMarkdown(base, b, a));
});

test('insertions at the same text position converge in both arrival orders', () => {
  const base = markdown.replace('[ ] A', '[ ] Report');
  const a = base.replace('Report', 'Final Report'), b = base.replace('Report', 'Annual Report');
  const result = mergeMarkdown(base, a, b);
  assert(result.includes('Annual ')); assert(result.includes('Final '));
  assert.equal(result, mergeMarkdown(base, b, a));
});

test('live listener reconnects after an error and stops retrying when its session closes', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const observers: any[] = [], events: string[] = [];
  const close = subscribeToSanityLiveChanges(event => events.push(event.type), config, () => ({
    listen: () => ({ subscribe: (observer: any) => { observers.push(observer); return { unsubscribe() {} }; } }),
  }));
  observers[0].error(new Error('connection lost'));
  assert.deepEqual(events, ['connection_error']);
  context.mock.timers.tick(1000); assert.equal(observers.length, 2);
  observers[1].next({ type: 'welcome' }); assert.equal(events.at(-1), 'reconnect');
  observers[1].error(new Error('connection lost')); close();
  context.mock.timers.tick(30000); assert.equal(observers.length, 2);
});
