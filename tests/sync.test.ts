import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { DocumentSync, SyncConflict, mergeSyncValue, mergeMarkdown, buildTaskDocumentId, deletionMarkerId } from '../src/services/documentSyncService';
import { beginSyncSession, getSyncSession, invalidateSyncSession } from '../src/services/syncSessionService';
import { createEmptyWorkspace, loadWorkspaceStore, saveWorkspaceStore, sanitizeWorkspace } from '../src/services/workspaceService';
import { applyRemoteTask, clearSanityConfig, getSanityConfig, normalizeSanityWorkspaceDoc, workspacesFromSanityDocuments } from '../src/services/sanityService';
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
  commits = 0;
  offline = false;
  failAfterCommit = false;
  beforeCommit?: () => void;
  waitForId?: string;
  release?: () => void;
  revision = 0;
  client = () => ({
    fetch: async (query: string, params: any) => {
      if (this.offline) throw new Error('offline');
      if (params.id === this.waitForId) {
        this.waitForId = undefined;
        await new Promise<void>(resolve => { this.release = resolve; });
      }
      if (query.includes('_id == $id')) return structuredClone(this.documents.get(params.id) || null);
      if (query.includes('_type == "workspace"')) return structuredClone([...this.documents.values()].find(d =>
        d._type === 'workspace' && d.workspaceId === params.id && d.syncOwner === params.owner) || null);
      return structuredClone([...this.documents.values()].filter(d => d._type === 'task' &&
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
afterEach(() => { invalidateSyncSession(); globalThis.fetch = originalFetch; });

test('first login has an empty isolated workspace and does not publish examples', () => {
  const store = loadWorkspaceStore();
  assert.equal(store.scope, getSyncSession()!.scope);
  assert.equal(scanTaskBlocks(store.workspaces[0].branches[0].taskDocuments[0].content).taskBlocks.length, 0);
  assert.equal(server.commits, 0);
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
  await assert.rejects(a.write({ ...base, title: 'Tab A' }, config), /offline/);
  await assert.rejects(b.write({ ...base, title: 'Tab B' }, config), /offline/);
  server.offline = false;
  await assert.rejects(a.flush(getSyncSession()!), SyncConflict);
  assert.equal(server.documents.get(base._id).title, 'Tab A');
});

test('removing an optional field persists the deletion without dropping unrelated fields', async () => {
  const base = { ...task(), description: 'Remove this', custom: 'Keep this' };
  server.documents.set(base._id, base); sync.observe(base);
  const { description, ...next } = base;
  const saved = await sync.write(next, config);
  assert.equal(saved.description, undefined); assert.equal(saved.custom, 'Keep this');
});
