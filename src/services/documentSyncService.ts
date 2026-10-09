import { createClient } from '@sanity/client';
import { diffLines, diffWordsWithSpace } from 'diff';
import { scanTaskBlocks, addTaskToMarkdown, updateTaskInMarkdown, deleteTaskFromMarkdown, moveTaskToGroupInMarkdown } from '../utils/markdownSync';
import type { SanityConfig } from './sanityService';
import { assertSyncSession, getSyncSession, type SyncSession } from './syncSessionService';

export class SyncConflict extends Error {}
type Document = Record<string, any> & { _id: string; _type: string; _rev?: string };
interface Pending { id: string; writer: string; base: Document | null; document: Document; createdAt: number }
let browserWriter: string | undefined;
function writerIdentity(): string {
  if (browserWriter) return browserWriter;
  const key = 'antask_sync_writer';
  browserWriter = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) || crypto.randomUUID() : crypto.randomUUID();
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, browserWriter);
  return browserWriter;
}
const ignored = new Set(['_key', '_rev', '_createdAt', '_updatedAt', 'updatedAt', 'lastSavedContent']);
export function syncComparable(value: any): any {
  if (Array.isArray(value)) return value.map(syncComparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !ignored.has(key) && value[key] !== undefined).map(key => [key, syncComparable(value[key])]));
  return value;
}
const equal = (a: any, b: any): boolean => JSON.stringify(syncComparable(a)) === JSON.stringify(syncComparable(b));

export function buildTaskDocumentId(taskId: string, workspaceId?: string, documentKey?: string): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (documentKey) return `task-${identityHash(JSON.stringify([workspaceId || '', documentKey, taskId]))}`;
  return workspaceId ? `task-${safe(workspaceId.replace(/^workspace-/, ''))}-${safe(taskId)}` : `task-${safe(taskId)}`;
}

export function deletionMarkerId(id: string): string {
  return `syncDeletion-${identityHash(id)}`;
}

// Stable 128-bit identifiers keep arbitrary document paths inside Sanity's ID limit.
function identityHash(value: string): string {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const byte of new TextEncoder().encode(value)) for (let i = 0; i < words.length; i++) {
    words[i] = Math.imul(words[i] ^ byte, 0x01000193 + i * 2);
  }
  return words.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

export function taskFields(markdown: string): any[] {
  const ids = new Set<string>();
  return scanTaskBlocks(markdown).taskBlocks.map(b => {
    if (!b.detectedId) throw new SyncConflict('Asigna un ID estable a cada tarea antes de sincronizar');
    if (ids.has(b.detectedId)) throw new SyncConflict(`ID de tarea duplicado: ${b.detectedId}`);
    ids.add(b.detectedId);
    return { taskId: b.detectedId, title: b.detectedTitle, completed: /\[[xX]\]/.test(b.rawTaskLine),
      status: b.detectedStatus || (/\[[xX]\]/.test(b.rawTaskLine) ? 'done' : 'todo'),
      priority: b.detectedPriority || 'P1', groupTitle: b.groupTitle,
      tags: b.detectedTags || [], blockedBy: b.detectedBlockedBy || '' };
  });
}

export function applyTaskToMarkdown(markdown: string, task: any): string {
  if (task.syncDeleted) return deleteTaskFromMarkdown(markdown, task.taskId);
  if (!scanTaskBlocks(markdown).taskBlocks.some(b => b.detectedId === task.taskId)) {
    markdown = addTaskToMarkdown(markdown, { title: task.title, customId: task.taskId,
      priority: task.priority, groupTitle: task.groupTitle || 'General' }).updatedMarkdown;
  }
  if (task.groupTitle) markdown = moveTaskToGroupInMarkdown(markdown, task.taskId, task.groupTitle);
  return updateTaskInMarkdown(markdown, task.taskId, { title: task.title, completed: task.completed,
    status: task.status, priority: task.priority, tags: task.tags || [], blockedBy: task.blockedBy || '' });
}

// Rebase insertions/deletions onto the common base. Independent
// edits to Markdown lines can coexist without freezing the main thread.
export function mergeText(base: string, local: string, remote: string): string {
  if (local === base || local === remote) return remote;
  if (remote === base) return local;

  const isMultiLine = base.includes('\n') || local.includes('\n') || remote.includes('\n');
  const diffFn = isMultiLine ? diffLines : diffWordsWithSpace;

  type Edit = { start: number; end: number; pieces: string[] };
  const getEdits = (value: string): Edit[] => {
    const result: Edit[] = [];
    let position = 0;
    for (const part of diffFn(base, value)) {
      const partLen = part.value.length;
      if (!part.added && !part.removed) {
        position += partLen;
        continue;
      }
      const previous = result[result.length - 1];
      if (part.added && previous && previous.end === position) {
        previous.pieces.push(part.value);
      } else {
        result.push({
          start: position,
          end: position + (part.removed ? partLen : 0),
          pieces: part.added ? [part.value] : [],
        });
      }
      if (part.removed) position += partLen;
    }
    return result;
  };

  const localEdits = getEdits(local);
  const remoteEdits = getEdits(remote);
  const combined = [...localEdits];

  for (const incoming of remoteEdits) {
    let duplicate = false;
    for (const existing of combined) {
      if (existing.start === incoming.start && existing.end === incoming.end && existing.pieces.join('') === incoming.pieces.join('')) {
        duplicate = true;
        break;
      }
      if (existing.start === existing.end && incoming.start === incoming.end && existing.start === incoming.start) {
        existing.pieces.push(...incoming.pieces);
        duplicate = true;
        break;
      }
      if (
        Math.max(existing.start, incoming.start) < Math.min(existing.end, incoming.end) ||
        (existing.start === existing.end && existing.start > incoming.start && existing.start < incoming.end) ||
        (incoming.start === incoming.end && incoming.start > existing.start && incoming.start < existing.end)
      ) {
        throw new SyncConflict('Conflicto en el mismo fragmento de texto');
      }
    }
    if (!duplicate) combined.push(incoming);
  }

  let result = base;
  for (const edit of combined.sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.pieces.join('') + result.slice(edit.end);
  }
  return result;
}

export const mergeMarkdown = mergeText;

function withRemoteRevisions(local: any, remote: any): any {
  const identity = (value: any) => value?.id || value?._id || value?._key || value?.name || value?.taskId || value?.groupTitle;
  if (Array.isArray(local) && Array.isArray(remote)) return local.map(value =>
    withRemoteRevisions(value, identity(value) ? remote.find(item => identity(item) === identity(value)) : undefined));
  if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local)) {
    return Object.fromEntries(Object.entries(local).map(([key, value]) => [key,
      ['_rev', '_createdAt', '_updatedAt'].includes(key) ? remote[key] : withRemoteRevisions(value, remote[key])])
      .concat(Object.entries(remote).filter(([key]) => ['_rev', '_createdAt', '_updatedAt'].includes(key) && !(key in local))));
  }
  return local;
}

// Three-way merge. Entity arrays merge by identity and text by character edits;
// incompatible changes require an explicit decision.
export function mergeSyncValue(base: any, local: any, remote: any, path = ''): any {
  if (equal(local, base) || equal(local, remote)) return remote;
  if (equal(remote, base)) return withRemoteRevisions(local, remote);
  // Navigation can change independently while both clients create content.
  // Keep the caller's selection instead of blocking compatible branch saves.
  if (path.endsWith('/activeBranchName') || path.endsWith('/activeDocumentId') || path.endsWith('/activeWorkspaceId')) return local;
  if (['/content', '/title', '/description'].some(field => path.endsWith(field)) && [base, local, remote].every(v => typeof v === 'string')) {
    return mergeText(base, local, remote);
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const key = (v: any) => v?.id || v?._key || v?.name || v?.taskId || v?.groupTitle;
    const baseList = Array.isArray(base) ? base : [];
    if ([...baseList, ...local, ...remote].every(v => key(v))) {
      const index = (items: any[]) => new Map(items.map(v => [key(v), v]));
      const b = index(baseList), l = index(local), r = index(remote);
      return [...new Set([...b.keys(), ...r.keys(), ...l.keys()])].map(k =>
        mergeSyncValue(b.get(k), l.get(k), r.get(k), `${path}/${k}`)
      ).filter(v => v !== undefined);
    }
  }
  if (local && remote && typeof local === 'object' && typeof remote === 'object' &&
      !Array.isArray(local) && !Array.isArray(remote)) {
    const result: Record<string, any> = {};
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = ignored.has(key) ? remote[key] :
        mergeSyncValue(base?.[key], local[key], remote[key], `${path}/${key}`);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  throw new SyncConflict(`Conflicto de sincronización en ${path || 'documento'}`);
}

export class DocumentSync {
  private observed = new Map<string, Document | null>();
  private revisions = new Map<string, Document>();
  private queued = new Map<string, Pending>();
  private tails = new Map<string, Promise<unknown>>();
  constructor(private clientFactory: (config: SanityConfig) => any = createClient, private writer = writerIdentity()) {}

  private key(session: SyncSession, id: string) { return `${session.scope}:${id}`; }
  private pendingPrefix(session: SyncSession) { return `antask_sync_pending:${session.scope}:`; }
  observe(document: Document, session = getSyncSession()): void {
    if (!session) return;
    assertSyncSession(session);
    this.observed.set(this.key(session, document._id), structuredClone(document));
    if (document._rev) {
      const key = `${this.key(session, document._id)}:${document._rev}`;
      if (!this.revisions.has(key)) this.revisions.set(key, structuredClone(document));
    }
  }
  base(id: string, session = getSyncSession()): Document | null | undefined {
    return session ? this.observed.get(this.key(session, id)) : undefined;
  }
  forget(): void { this.observed.clear(); this.revisions.clear(); this.queued.clear(); }

  discardPending(id: string, session: SyncSession): void {
    assertSyncSession(session);
    for (const key of Object.keys(localStorage).filter(k => k.startsWith(this.pendingPrefix(session)))) {
      if (JSON.parse(localStorage.getItem(key)!).document._id === id) localStorage.removeItem(key);
    }
  }

  async reconcileDeletions(previous: Document[], snapshot: Document[], config: SanityConfig): Promise<Document[]> {
    const session = getSyncSession(config);
    if (!session) throw new Error('La sesión de sincronización ha cambiado');
    const documents = [...snapshot];
    const missing = previous.filter(d => ['workspace', 'task'].includes(d._type) && !d.syncDeleted &&
      !snapshot.some(current => current._id === d._id)).sort((a, b) => Number(b._type === 'workspace') - Number(a._type === 'workspace'));
    for (const old of missing) {
      assertSyncSession(session);
      const deleted = config.token ? await this.write({ ...old, syncDeleted: true }, config) : { ...old, syncDeleted: true };
      if (!config.token) this.observe(deleted, session);
      documents.push(deleted);
    }
    return documents.map(d => this.base(d._id, session) || d);
  }

  async resolve(document: Document, config: SanityConfig): Promise<Document> {
    const session = getSyncSession(config);
    if (!session) throw new Error('La sesión de Sanity todavía no está preparada');
    const client = this.clientFactory(session.config);
    const remote = await client.getDocument(document._id, { signal: session.controller.signal });
    assertSyncSession(session);
    if (remote?.syncOwner && remote.syncOwner !== session.owner) throw new SyncConflict('El documento pertenece a otra cuenta');
    if (remote?.syncDeleted) throw new SyncConflict('El documento fue eliminado remotamente');
    if (remote) this.observe(remote, session);
    const prefix = this.pendingPrefix(session);
    const replaced = Object.keys(localStorage).filter(k => k.startsWith(prefix));
    const result = await this.write({ ...document, _rev: remote?._rev }, config, remote || null);
    for (const key of replaced) {
      if (!localStorage.getItem(key)) continue;
      const pending = JSON.parse(localStorage.getItem(key)!);
      if (pending.document._id === document._id) localStorage.removeItem(key);
    }
    return result;
  }

  async write(document: Document, config: SanityConfig, baseOverride?: Document | null): Promise<Document> {
    const session = getSyncSession(config);
    if (!session || !config.token) throw new Error('La sesión de Sanity todavía no está preparada');
    assertSyncSession(session);
    if (!document._id) throw new Error('Se requiere un ID estable para sincronizar');
    const key = this.key(session, document._id);
    const observed = document._rev ? this.revisions.get(`${key}:${document._rev}`) : this.base(document._id, session);
    if (document._rev && !observed) {
      throw new SyncConflict('La revisión local ya no es la revisión descargada. Recarga o resuelve el conflicto.');
    }
    // Explicit revision-bearing saves use the fetched revision as their base.
    // For UI forms, the observed snapshot contains the original field values.
    const persisted: Pending[] = Object.keys(localStorage).filter(k => k.startsWith(this.pendingPrefix(session)))
      .map(k => JSON.parse(localStorage.getItem(k)!)).filter(p => p.document._id === document._id);
    const latest = persisted.filter(p => p.writer === this.writer).sort((a, b) => b.createdAt - a.createdAt)[0];
    const pending: Pending = {
      id: crypto.randomUUID(), writer: this.writer,
      base: baseOverride !== undefined ? baseOverride : this.queued.get(key)?.document || latest?.document || observed || null,
      createdAt: Math.max(Date.now(), (latest?.createdAt || 0) + 1),
      document: { ...document, syncOwner: session.owner },
    };
    const storageKey = this.pendingPrefix(session) + pending.id;
    localStorage.setItem(storageKey, JSON.stringify(pending));
    this.queued.set(key, pending);
    const previous = this.tails.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(() => this.commit(pending, storageKey, session));
    this.tails.set(key, work);
    try { return await work; }
    finally {
      if (this.tails.get(key) === work) this.tails.delete(key);
      if (this.queued.get(key) === pending) this.queued.delete(key);
    }
  }

  private async commit(pending: Pending, storageKey: string, session: SyncSession): Promise<Document> {
    const client = this.clientFactory(session.config);
    for (let attempt = 0; attempt < 3; attempt++) {
      assertSyncSession(session);
      const deletion = await client.getDocument(deletionMarkerId(pending.document._id), {
        signal: session.controller.signal,
      });
      assertSyncSession(session);
      if (deletion && !pending.document.syncDeleted) throw new SyncConflict('El documento fue eliminado remotamente');
      // GROQ can lag behind committed writes, including our previous save.
      const remote = await client.getDocument(pending.document._id, {
        signal: session.controller.signal,
      });
      assertSyncSession(session);
      if (remote?.syncOwner && remote.syncOwner !== session.owner) throw new SyncConflict('El documento pertenece a otra cuenta');
      if (remote?.syncDeleted && !pending.document.syncDeleted) throw new SyncConflict('El documento fue eliminado remotamente');
      if (remote && !pending.base && !equal(stripDocument(remote), stripDocument(pending.document))) {
        throw new SyncConflict('El documento remoto no tiene una base local conocida. Descarga antes de guardar.');
      }
      if (!remote && pending.base && !pending.document.syncDeleted) {
        throw new SyncConflict('El documento fue eliminado remotamente');
      }
      if (pending.document.syncDeleted && remote && !remote.syncDeleted && pending.base && !equal(remote, pending.base)) {
        throw new SyncConflict('El documento fue editado mientras se eliminaba');
      }
      const merged = remote && pending.base ? mergeSyncValue(pending.base, pending.document, remote) : structuredClone(pending.document);
      assertSyncSession(session);
      try {
        const writes: Array<{ document: Document; remote: Document | null }> = [{ document: merged, remote }];
        if (merged._type === 'workspace') await this.projectWorkspace(merged, remote, client, session, writes);
        if (merged._type === 'task') await this.projectTask(merged, pending.base, client, session, writes);
        for (const write of [...writes]) if (write.document.syncDeleted) {
          const id = deletionMarkerId(write.document._id);
          const marker = await client.getDocument(id, { signal: session.controller.signal });
          writes.push({ document: { _id: id, _type: 'syncDeletion', syncOwner: session.owner,
            targetId: write.document._id, deletedDocument: { ...write.document, syncDeleted: true } }, remote: marker });
        }
        assertSyncSession(session);
        let transaction = client.transaction();
        for (const write of writes) {
          if (write.remote?.syncOwner && write.remote.syncOwner !== session.owner) throw new SyncConflict('El documento pertenece a otra cuenta');
          const fields = { ...stripDocument(write.document), updatedAt: new Date().toISOString() };
          const removed = write.remote ? Object.keys(stripDocument(write.remote)).filter(key => !(key in fields)) : [];
          transaction = write.remote ? transaction.patch(write.document._id, (patch: any) =>
            patch.ifRevisionId(write.remote!._rev).set(fields).unset(removed)) : transaction.create({ ...write.document, ...fields });
        }
        const results = await transaction.commit({ signal: session.controller.signal, returnDocuments: true });
        assertSyncSession(session);
        results.forEach((doc: Document) => this.observe(doc, session));
        const result = results.find((doc: Document) => doc._id === merged._id);
        if (!result) throw new Error('Sanity no confirmó el documento');
        localStorage.removeItem(storageKey);
        return result;
      } catch (error: any) {
        if (error?.statusCode !== 409 && error?.response?.statusCode !== 409) throw error;
      }
    }
    throw new SyncConflict('Conflicto concurrente: recarga antes de volver a guardar');
  }

  private async projectWorkspace(workspace: Document, remote: Document | null, client: any, session: SyncSession,
    writes: Array<{ document: Document; remote: Document | null }>): Promise<void> {
    const indexedTasks: Document[] = await client.fetch('*[_type == "task" && workspaceId == $id && (syncOwner == $owner || !defined(syncOwner))]',
      { id: workspace.workspaceId, owner: session.owner }, { signal: session.controller.signal });
    assertSyncSession(session);
    // Discover legacy IDs with GROQ, but read revisions directly. Include the
    // deterministic IDs of projections whose creation is not indexed yet.
    const ids = new Set(indexedTasks.map(task => task._id));
    for (const branch of [...(remote?.branches || []), ...(workspace.branches || [])]) {
      for (const doc of branch.taskDocuments || []) for (const task of taskFields(doc.content)) {
        ids.add(buildTaskDocumentId(task.taskId, workspace.workspaceId, `${branch.name}::${doc.id}`));
      }
    }
    const tasks: Document[] = ids.size ? (await client.getDocuments([...ids], { signal: session.controller.signal }))
      .filter((task: Document | null) => task && task.workspaceId === workspace.workspaceId && (!task.syncOwner || task.syncOwner === session.owner)) : [];
    assertSyncSession(session);
    const retained = new Set<string>();
    for (const branch of workspace.syncDeleted ? [] : workspace.branches || []) for (const doc of branch.taskDocuments || []) {
      const documentKey = `${branch.name}::${doc.id}`;
      const baseContent = remote?.branches?.find((b: any) => b.name === branch.name)?.taskDocuments?.find((d: any) => d.id === doc.id)?.content || '';
      const baseline = taskFields(baseContent);
      for (const fields of taskFields(doc.content)) {
        let contexts = (remote?.branches || []).flatMap((b: any) =>
          (b.taskDocuments || []).filter((d: any) => scanTaskBlocks(d.content).taskBlocks.some(t => t.detectedId === fields.taskId)));
        if (!contexts.length) contexts = (workspace.branches || []).flatMap((b: any) =>
          (b.taskDocuments || []).filter((d: any) => scanTaskBlocks(d.content).taskBlocks.some(t => t.detectedId === fields.taskId)));
        const matches = tasks.filter(t => t.taskId === fields.taskId && (t.documentKey === documentKey ||
          (!t.documentKey && t.branchName === branch.name && t.documentPath === doc.path) ||
          (!t.documentKey && !t.branchName && !t.documentPath && contexts.length === 1)));
        if (contexts.length > 1 && tasks.some(t => t.taskId === fields.taskId && !t.documentKey && !t.branchName)) {
          throw new SyncConflict(`La tarea antigua ${fields.taskId} no identifica su documento`);
        }
        if (matches.length > 1) throw new SyncConflict(`Hay documentos duplicados para la tarea ${fields.taskId}`);
        const existing = matches[0] || null;
        const baseFields = baseline.find(t => t.taskId === fields.taskId);
        if (existing?.syncDeleted) {
          if (baseFields && equal(fields, baseFields)) { doc.content = deleteTaskFromMarkdown(doc.content, fields.taskId); retained.add(existing._id); continue; }
          throw new SyncConflict(`La tarea ${fields.taskId} fue eliminada remotamente`);
        }
        const marker = await client.getDocument(deletionMarkerId(existing?._id || buildTaskDocumentId(fields.taskId, workspace.workspaceId, documentKey)), { signal: session.controller.signal });
        assertSyncSession(session);
        if (marker) throw new SyncConflict(`La tarea ${fields.taskId} fue eliminada remotamente`);
        const currentFields = existing ? Object.fromEntries(Object.keys(fields).map(k => [k, existing[k] ?? (k === 'status' ? (existing.completed ? 'done' : 'todo') : fields[k])])) : null;
        const mergedFields = existing && baseFields ? mergeSyncValue(baseFields, fields, currentFields) : fields;
        doc.content = applyTaskToMarkdown(doc.content, mergedFields);
        const task: Document = { ...(existing || {}), ...mergedFields,
          _id: existing?._id || buildTaskDocumentId(fields.taskId, workspace.workspaceId, documentKey), _type: 'task',
          syncOwner: session.owner, workspaceId: workspace.workspaceId, documentKey,
          branchName: branch.name, documentPath: doc.path };
        retained.add(task._id);
        writes.push({ document: task, remote: existing });
      }
    }
    for (const task of tasks.filter(t => !t.syncDeleted && !retained.has(t._id))) {
      // A deletion conflicts with an independently edited task. Compare the
      // original workspace fields before retaining a durable tombstone.
      const baseDoc = remote?.branches?.find((b: any) => b.name === task.branchName)?.taskDocuments?.find((d: any) => d.path === task.documentPath);
      const before = baseDoc && taskFields(baseDoc.content).find(t => t.taskId === task.taskId);
      if (!before && !workspace.syncDeleted) continue;
      if (before && !equal(before, Object.fromEntries(Object.keys(before).map(k => [k, task[k]])))) {
        throw new SyncConflict(`La tarea ${task.taskId} fue editada mientras se eliminaba`);
      }
      writes.push({ document: { ...task, syncDeleted: true }, remote: task });
    }
  }

  private async projectTask(task: Document, base: Document | null, client: any, session: SyncSession,
    writes: Array<{ document: Document; remote: Document | null }>): Promise<void> {
    if (!task.workspaceId) return;
    const indexedWorkspace = await client.fetch('*[_type == "workspace" && workspaceId == $id && syncOwner == $owner][0]',
      { id: task.workspaceId, owner: session.owner }, { signal: session.controller.signal });
    assertSyncSession(session);
    const workspace = await client.getDocument(indexedWorkspace?._id || `workspace-${task.workspaceId}`, { signal: session.controller.signal });
    assertSyncSession(session);
    if (workspace?.syncOwner && workspace.syncOwner !== session.owner) throw new SyncConflict('El documento pertenece a otra cuenta');
    if (!workspace || workspace.syncDeleted) {
      if (task.syncDeleted) return;
      throw new SyncConflict('El workspace de la tarea fue eliminado');
    }
    const deletion = await client.getDocument(deletionMarkerId(workspace._id), { signal: session.controller.signal });
    assertSyncSession(session);
    if (deletion) throw new SyncConflict('El workspace de la tarea fue eliminado');
    const next = structuredClone(workspace);
    if (!task.documentKey) {
      const branch = next.branches?.find((b: any) => b.name === (task.branchName || next.activeBranchName));
      const doc = branch?.taskDocuments?.find((d: any) => task.documentPath ? d.path === task.documentPath : d.id === branch.activeDocumentId) || branch?.taskDocuments?.[0];
      if (branch && doc) { task.documentKey = `${branch.name}::${doc.id}`; task.branchName = branch.name; task.documentPath = doc.path; }
    }
    let matched = false;
    for (const branch of next.branches || []) for (const doc of branch.taskDocuments || []) {
      if (`${branch.name}::${doc.id}` === task.documentKey) {
        matched = true;
        const current = taskFields(doc.content).find(t => t.taskId === task.taskId);
        if (base && current) {
          const select = (value: any) => Object.fromEntries(Object.keys(current).map(k => [k, value[k] ?? current[k]]));
          if (task.syncDeleted && !equal(select(base), current)) throw new SyncConflict('La tarea fue editada en Markdown mientras se eliminaba');
          Object.assign(task, mergeSyncValue(select(base), select(task), current));
        } else if (!base && current && !equal(current, Object.fromEntries(Object.keys(current).map(k => [k, task[k] ?? current[k]])))) {
          throw new SyncConflict('El Markdown ya contiene otra version de la tarea');
        }
        doc.content = applyTaskToMarkdown(doc.content, task);
      }
    }
    if (!matched) throw new SyncConflict('No se encuentra el documento de la tarea');
    writes.push({ document: next, remote: workspace });
  }

  async flush(session: SyncSession): Promise<void> {
    const prefix = this.pendingPrefix(session);
    const entries = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort((a, b) =>
      JSON.parse(localStorage.getItem(a)!).createdAt - JSON.parse(localStorage.getItem(b)!).createdAt);
    for (const key of entries) {
      assertSyncSession(session);
      const raw = localStorage.getItem(key);
      if (raw) {
        const pending = JSON.parse(raw);
        const documentKey = this.key(session, pending.document._id);
        const previous = this.tails.get(documentKey) || Promise.resolve();
        const work = previous.catch(() => {}).then(() => localStorage.getItem(key) ? this.commit(pending, key, session) : undefined);
        this.tails.set(documentKey, work);
        try { await work; } finally { if (this.tails.get(documentKey) === work) this.tails.delete(documentKey); }
      }
    }
  }

  async remove(id: string, type: string, config: SanityConfig): Promise<Document> {
    const session = getSyncSession(config);
    if (!session) throw new Error('La sesión de Sanity todavía no está preparada');
    const base = this.base(id, session);
    if (!base) throw new SyncConflict('Descarga el documento antes de eliminarlo');
    // Retain the original ID and revision. Old clients cannot recreate this ID
    // with createIfNotExists, and new clients reject writes to the tombstone.
    return this.write({ ...base, _id: id, _type: type, syncDeleted: true }, config);
  }
}

function stripDocument(doc: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(doc).filter(([key, value]) =>
    !['_id', '_type', '_rev', '_createdAt', '_updatedAt', 'updatedAt'].includes(key) && value !== undefined));
}

export const documentSync = new DocumentSync();
