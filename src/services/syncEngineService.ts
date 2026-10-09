import {
  Workspace,
  WorkspaceStoreState,
  saveWorkspaceStore,
  createEmptyWorkspace,
} from './workspaceService';
import {
  getSanityConfig,
  fetchSanityDocumentsList,
  deleteDocumentFromSanity,
  deleteWorkspaceFromSanity,
  sanitizeSanityDocId,
  workspacesFromSanityDocuments,
  normalizeSanityWorkspaceDoc,
  SanityConfig,
} from './sanityService';
import { parseTasksMarkdown, type ParsedGroup } from '../utils/taskMarkdown';
import { documentSync, mergeSyncValue, buildTaskDocumentId, syncComparable, applyTaskToMarkdown, taskFields } from './documentSyncService';
import { getSyncSession, assertSyncSession } from './syncSessionService';
import {
  deleteTaskFromMarkdown,
} from '../utils/markdownSync';

export type SyncDifferenceType =
  | 'synced'
  | 'local_override'
  | 'remote_override'
  | 'conflict'
  | 'only_local'
  | 'only_remote';

export type SyncEntityType = 'workspace' | 'task_document' | 'task' | 'canvas_state';

export interface SyncItemDiff {
  id: string;
  entityType: SyncEntityType;
  title: string;
  subtitle?: string;
  diffType: SyncDifferenceType;
  workspaceId?: string;
  workspaceName?: string;
  documentPath?: string;
  branchName?: string;
  localTimestamp?: string;
  remoteTimestamp?: string;
  localData?: any;
  remoteData?: any;
  summaryChanges: string[];
  resolutionStrategy: 'keep_local' | 'keep_remote' | 'merge';
}

export interface SyncComparisonResult {
  analyzedAt: string;
  items: SyncItemDiff[];
  counts: {
    total: number;
    synced: number;
    localOverrides: number;
    remoteOverrides: number;
    conflicts: number;
    onlyLocal: number;
    onlyRemote: number;
  };
  hasPendingChanges: boolean;
}

// Markdown files retain their own identity even when names or task IDs repeat.
export function compareMarkdownDocuments(store: WorkspaceStoreState, remote: Workspace[]): SyncItemDiff[] {
  const items: SyncItemDiff[] = [];
  const comparable = (doc: any) => doc && JSON.stringify([doc.id, doc.name, doc.folder || '', doc.path, doc.content]);
  for (const workspaceId of new Set([...store.workspaces, ...remote].map(ws => ws.id))) {
    const localWs = store.workspaces.find(ws => ws.id === workspaceId);
    const remoteWs = remote.find(ws => ws.id === workspaceId);
    for (const branchName of new Set([...(localWs?.branches || []), ...(remoteWs?.branches || [])].map(branch => branch.name))) {
      const localDocs = localWs?.branches.find(branch => branch.name === branchName)?.taskDocuments || [];
      const remoteDocs = remoteWs?.branches.find(branch => branch.name === branchName)?.taskDocuments || [];
      const baseDocs = store.remoteBase?.find(ws => ws.id === workspaceId)?.branches.find(branch => branch.name === branchName)?.taskDocuments || [];
      for (const id of new Set([...localDocs, ...remoteDocs].map(doc => doc.id))) {
        const local = localDocs.find(doc => doc.id === id), cloud = remoteDocs.find(doc => doc.id === id);
        const base = baseDocs.find(doc => doc.id === id);
        let diffType: SyncDifferenceType = !local ? 'only_remote' : !cloud ? 'only_local' : 'synced';
        if (local && cloud && comparable(local) !== comparable(cloud)) {
          diffType = !base ? 'conflict' : comparable(local) === comparable(base) ? 'remote_override'
            : comparable(cloud) === comparable(base) ? 'local_override' : 'conflict';
        }
        const doc = local || cloud!;
        items.push({ id: `md_${JSON.stringify([workspaceId, branchName, id])}`, entityType: 'task_document',
          title: doc.path, subtitle: branchName, workspaceId, workspaceName: localWs?.name || remoteWs?.name,
          branchName, documentPath: doc.path, diffType, localData: local, remoteData: cloud,
          localTimestamp: local?.updatedAt, remoteTimestamp: cloud?.updatedAt,
          summaryChanges: [], resolutionStrategy: diffType === 'only_remote' || diffType === 'remote_override' ? 'keep_remote' : 'keep_local' });
      }
    }
  }
  return items;
}

/**
 * Calculates human readable relative time (Spanish)
 */
export function formatRelativeTime(isoString?: string): string {
  if (!isoString) return 'Desconocido';
  try {
    const time = new Date(isoString).getTime();
    if (isNaN(time)) return 'Desconocido';
    const now = Date.now();
    const diffSec = Math.floor((now - time) / 1000);

    if (diffSec < 10) return 'Hace unos segundos';
    if (diffSec < 60) return `Hace ${diffSec} seg`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `Hace ${diffDays} d`;
    return new Date(isoString).toLocaleDateString();
  } catch {
    return 'Desconocido';
  }
}

/**
 * Compares local workspaces, task documents, and sanity remote documents
 * to generate a comprehensive diff analysis.
 */
export async function analyzeSyncDifferences(
  workspaceStore: WorkspaceStoreState,
  configOverride?: Partial<SanityConfig>
): Promise<SyncComparisonResult> {
  const config = { ...getSanityConfig(), ...configOverride };
  const items: SyncItemDiff[] = [];

  // 1. Fetch remote workspaces & documents from Sanity
  let remoteWorkspaces: any[] = [];
  let remoteSanityDocs: any[] = [];

  if (config.projectId && config.dataset) {
    try {
      remoteSanityDocs = await fetchSanityDocumentsList(config);
      remoteWorkspaces = workspacesFromSanityDocuments(remoteSanityDocs);
    } catch (err) {
      throw err;
    }
  }

  // 2. Compare Workspaces & Task Documents
  const processedRemoteWsIds = new Set<string>();

  for (const localWs of workspaceStore.workspaces) {
    const cleanLocalId = localWs.id.replace(/^workspace-/, '');

    const remoteWs = remoteWorkspaces.find(rw => rw.id === localWs.id || rw.id === cleanLocalId);


    if (!remoteWs) {
      // Exists only locally
      const localBranches = localWs.branches || [];
      const totalDocs = localBranches.reduce((acc, b) => acc + (b.taskDocuments?.length || 0), 0);
      items.push({
        id: `ws_${localWs.id}`,
        entityType: 'workspace',
        workspaceId: localWs.id,
        workspaceName: localWs.name,
        title: `Workspace: ${localWs.name}`,
        subtitle: `${localWs.githubRepo?.fullName || 'GitHub'} (${localBranches.length} ramas, ${totalDocs} archivos)`,
        diffType: 'only_local',
        localTimestamp: localWs.updatedAt,
        localData: localWs,
        summaryChanges: [
          'Workspace no existe en Sanity Cloud',
          `Contiene ${localBranches.length} rama(s) y ${totalDocs} documento(s) Markdown`,
        ],
        resolutionStrategy: 'keep_local',
      });
    } else {
      processedRemoteWsIds.add(remoteWs.id);
      if (remoteWs.workspaceId) processedRemoteWsIds.add(remoteWs.workspaceId);
      if (remoteWs.name) processedRemoteWsIds.add(remoteWs.name.trim().toLowerCase());

      // Compare local vs remote workspace
      const changes: string[] = [];

      if (localWs.name !== remoteWs.name) {
        changes.push(`Nombre modificado: "${remoteWs.name}" → "${localWs.name}"`);
      }
      if (localWs.activeBranchName !== remoteWs.activeBranchName) {
        changes.push(`Rama activa diferente: Remoto="${remoteWs.activeBranchName}", Local="${localWs.activeBranchName}"`);
      }
      if (localWs.githubRepo?.fullName !== remoteWs.githubRepo?.fullName) {
        changes.push(`Repositorio modificado: "${remoteWs.githubRepo?.fullName}" vs "${localWs.githubRepo?.fullName}"`);
      }

      // Check branches & documents differences
      const localBranches = localWs.branches || [];
      const remoteBranches = remoteWs.branches || [];

      if (localBranches.length !== remoteBranches.length) {
        changes.push(`Cantidad de ramas diferente: Local (${localBranches.length}) vs Remoto (${remoteBranches.length})`);
      }

      const totalLocalDocs = localBranches.reduce((acc, b) => acc + (b.taskDocuments?.length || 0), 0);
      const totalRemoteDocs = remoteBranches.reduce((acc: number, b: any) => acc + (b.taskDocuments?.length || 0), 0);
      if (totalLocalDocs !== totalRemoteDocs) {
        changes.push(`Total de archivos MD: Local (${totalLocalDocs}) vs Remoto (${totalRemoteDocs})`);
      }

      // Content changes inside documents
      let contentDiffers = false;
      for (const lb of localBranches) {
        const rb = remoteBranches.find((b: any) => b.name === lb.name);
        if (!rb) {
          changes.push(`Rama local "${lb.name}" no existe en remoto`);
          contentDiffers = true;
          continue;
        }

        for (const lDoc of (lb.taskDocuments || [])) {
          const rDoc = rb.taskDocuments?.find((d: any) => d.id === lDoc.id);
          if (!rDoc) {
            changes.push(`Documento local "${lDoc.path}" (${lb.name}) pendiente de subir`);
            contentDiffers = true;
          } else if (lDoc.path !== rDoc.path || lDoc.name !== rDoc.name || lDoc.folder !== rDoc.folder) {
            changes.push(`Documento "${lDoc.id}": ${rDoc.path} → ${lDoc.path}`);
            contentDiffers = true;
          } else if ((lDoc.content || '').trim() !== (rDoc.content || '').trim()) {
            contentDiffers = true;
            const lGroups = parseTasksMarkdown(lDoc.content || '');
            const rGroups = parseTasksMarkdown(rDoc.content || '');
            const lTasks = lGroups.reduce((acc: number, g: ParsedGroup) => acc + g.tasks.length, 0);
            const rTasks = rGroups.reduce((acc: number, g: ParsedGroup) => acc + g.tasks.length, 0);
            changes.push(`Contenido "${lDoc.path}": Local (${lTasks} tareas) vs Remoto (${rTasks} tareas)`);
          }
        }
      }

      let diffType: SyncDifferenceType = 'synced';

      if (changes.length > 0 || contentDiffers) {
        const base = workspaceStore.remoteBase?.find(w => w.id === localWs.id);
        if (!base) diffType = 'conflict';
        else {
          const changedLocal = JSON.stringify(syncComparable(base)) !== JSON.stringify(syncComparable(localWs));
          const changedRemote = JSON.stringify(syncComparable(base)) !== JSON.stringify(syncComparable(remoteWs));
          diffType = changedLocal && changedRemote ? 'conflict' : changedLocal ? 'local_override' : 'remote_override';
        }
      }

      items.push({
        id: `ws_${localWs.id}`,
        entityType: 'workspace',
        workspaceId: localWs.id,
        workspaceName: localWs.name,
        title: `Workspace: ${localWs.name}`,
        subtitle: `${localWs.githubRepo?.fullName || 'GitHub'} (${localBranches.length} ramas)`,
        diffType,
        localTimestamp: localWs.updatedAt,
        remoteTimestamp: remoteWs.updatedAt,
        localData: localWs,
        remoteData: remoteWs,
        summaryChanges: changes.length > 0 ? changes : ['Totalmente sincronizado e idéntico'],
        resolutionStrategy:
          diffType === 'remote_override'
            ? 'keep_remote'
            : diffType === 'local_override'
            ? 'keep_local'
            : 'merge',
      });
    }
  }

  // Check remote workspaces that do not exist locally
  for (const remoteWs of remoteWorkspaces) {
    if (!processedRemoteWsIds.has(remoteWs.id)) {
      const totalDocs = (remoteWs.branches || []).reduce(
        (acc: number, b: any) => acc + (b.taskDocuments?.length || 0),
        0
      );
      items.push({
        id: `ws_${remoteWs.id}`,
        entityType: 'workspace',
        workspaceId: remoteWs.id || remoteWs.workspaceId,
        workspaceName: remoteWs.name,
        title: `Workspace: ${remoteWs.name}`,
        subtitle: `${remoteWs.githubRepo?.fullName || 'Repo'} (${(remoteWs.branches || []).length} ramas)`,
        diffType: 'only_remote',
        remoteTimestamp: remoteWs.updatedAt,
        remoteData: remoteWs,
        summaryChanges: [
          'Workspace disponible en Sanity Cloud, no descargado localmente',
          `Contiene ${(remoteWs.branches || []).length} rama(s) y ${totalDocs} archivo(s)`,
        ],
        resolutionStrategy: 'keep_remote',
      });
    }
  }

  items.push(...compareMarkdownDocuments(workspaceStore, remoteWorkspaces));

  // 3. Compare Individual Tasks grouped by Workspace & Document vs Sanity Task Documents
  const remoteTasks = remoteSanityDocs.filter((d) => d._type === 'task');
  const processedRemoteTaskIds = new Set<string>();

  for (const ws of workspaceStore.workspaces) {
    for (const b of (ws.branches || [])) {
      for (const doc of (b.taskDocuments || [])) {
        const parsedGroups = parseTasksMarkdown(doc.content || '');
        const docTasks = parsedGroups.flatMap((g: ParsedGroup) =>
          g.tasks.map((t) => ({ ...t, groupTitle: g.title }))
        );

        for (const lt of docTasks) {
          const resTaskId = lt.taskId || lt.temporaryId || 'task';
          const matchedRemote = remoteTasks.find(rt => rt.taskId === resTaskId && rt.workspaceId === ws.id &&
            (rt.documentKey === `${b.name}::${doc.id}` || (!rt.documentKey && rt.branchName === b.name && rt.documentPath === doc.path)));

          if (!matchedRemote) {
            items.push({
              id: `task_${ws.id}_${b.name}_${doc.id}_${resTaskId}`,
              entityType: 'task',
              workspaceId: ws.id,
              workspaceName: ws.name,
              branchName: b.name,
              documentPath: doc.path,
              title: `Tarea: [${resTaskId}] ${lt.title}`,
              subtitle: `Doc: "${doc.path}" (${b.name}) • Sección "${lt.groupTitle}" • Prioridad ${lt.priority || 'P1'}`,
              diffType: 'only_local',
              localTimestamp: doc.updatedAt,
              localData: lt,
              summaryChanges: ['Tarea creada localmente, no publicada en Sanity Cloud'],
              resolutionStrategy: 'keep_local',
            });
          } else {
            const remoteKey = matchedRemote._id;
            processedRemoteTaskIds.add(remoteKey);

            const titleDiff = lt.title !== matchedRemote.title;
            const fields: Record<string, any> = { title: lt.title, completed: lt.completed, priority: lt.priority || 'P1', status: lt.status, groupTitle: lt.groupTitle, tags: lt.tags || [], blockedBy: lt.blockedBy || '' };
            const select = (value: any) => Object.fromEntries(Object.keys(fields).map(k => [k, value[k] ?? (k === 'tags' ? [] : k === 'blockedBy' ? '' : k === 'status' ? (value.completed ? 'done' : 'todo') : fields[k])]));
            const completedDiff = Boolean(lt.completed) !== Boolean(matchedRemote.completed);
            const priorityDiff = (lt.priority || 'P1') !== (matchedRemote.priority || 'P1');

            if (JSON.stringify(syncComparable(fields)) === JSON.stringify(syncComparable(select(matchedRemote)))) {
              items.push({
                id: `task_${ws.id}_${b.name}_${doc.id}_${resTaskId}`,
                entityType: 'task',
                workspaceId: ws.id,
                workspaceName: ws.name,
                branchName: b.name,
                documentPath: doc.path,
                title: `Tarea: [${resTaskId}] ${lt.title}`,
                subtitle: `Doc: "${doc.path}" (${b.name}) • Sección "${lt.groupTitle}" • Sincronizada`,
                diffType: 'synced',
                localTimestamp: doc.updatedAt,
                remoteTimestamp: matchedRemote.updatedAt || matchedRemote._updatedAt,
                localData: lt,
                remoteData: matchedRemote,
                summaryChanges: ['Tarea idéntica en local y Sanity Cloud'],
                resolutionStrategy: 'keep_local',
              });
            } else {
              const base = workspaceStore.remoteDocuments?.find(d => d._id === matchedRemote._id);
              let diffType: SyncDifferenceType = 'conflict';
              if (base) {
                const changedLocal = JSON.stringify(syncComparable(fields)) !== JSON.stringify(syncComparable(select(base)));
                const changedRemote = JSON.stringify(syncComparable(select(matchedRemote))) !== JSON.stringify(syncComparable(select(base)));
                diffType = changedLocal && changedRemote ? 'conflict' : changedLocal ? 'local_override' : 'remote_override';
              }

              const changes: string[] = [];
              if (titleDiff) changes.push(`Título: "${matchedRemote.title}" vs "${lt.title}"`);
              if (completedDiff) changes.push(`Estado completado: Remoto (${Boolean(matchedRemote.completed)}) vs Local (${Boolean(lt.completed)})`);
              if (priorityDiff) changes.push(`Prioridad: Remoto (${matchedRemote.priority || 'P1'}) vs Local (${lt.priority || 'P1'})`);

              items.push({
                id: `task_${ws.id}_${b.name}_${doc.id}_${resTaskId}`,
                entityType: 'task',
                workspaceId: ws.id,
                workspaceName: ws.name,
                branchName: b.name,
                documentPath: doc.path,
                title: `Tarea: [${resTaskId}] ${lt.title}`,
                subtitle: `Doc: "${doc.path}" (${b.name}) • Sección "${lt.groupTitle}" • Discrepancia detectada`,
                diffType,
                localTimestamp: doc.updatedAt,
                remoteTimestamp: matchedRemote.updatedAt || matchedRemote._updatedAt,
                localData: lt,
                remoteData: matchedRemote,
                summaryChanges: changes,
                resolutionStrategy: diffType === 'remote_override' ? 'keep_remote' : 'keep_local',
              });
            }
          }
        }
      }
    }
  }

  // Remote tasks not present locally in any workspace
  for (const rt of remoteTasks) {
    const remoteKey = rt._id;
    if (!processedRemoteTaskIds.has(remoteKey)) {
      const matchingWs = workspaceStore.workspaces.find(w => w.id === rt.workspaceId);
      items.push({
        id: `task_${rt._id}`,
        entityType: 'task',
        workspaceId: matchingWs?.id || rt.workspaceId,
        branchName: rt.branchName,
        documentPath: rt.documentPath,
        workspaceName: matchingWs?.name || rt.workspaceName,
        title: `Tarea: [${rt.taskId || 'Cloud'}] ${rt.title || 'Sin título'}`,
        subtitle: `Sanity Cloud • Sección "${rt.groupTitle || 'General'}"`,
        diffType: 'only_remote',
        remoteTimestamp: rt.updatedAt || rt._updatedAt,
        remoteData: rt,
        summaryChanges: ['Tarea existente en Sanity Cloud, no descargada localmente'],
        resolutionStrategy: 'keep_remote',
      });
    }
  }

  // Count stats
  const counts = {
    total: items.length,
    synced: items.filter((i) => i.diffType === 'synced').length,
    localOverrides: items.filter((i) => i.diffType === 'local_override').length,
    remoteOverrides: items.filter((i) => i.diffType === 'remote_override').length,
    conflicts: items.filter((i) => i.diffType === 'conflict').length,
    onlyLocal: items.filter((i) => i.diffType === 'only_local').length,
    onlyRemote: items.filter((i) => i.diffType === 'only_remote').length,
  };

  const hasPendingChanges =
    counts.localOverrides > 0 ||
    counts.remoteOverrides > 0 ||
    counts.conflicts > 0 ||
    counts.onlyLocal > 0 ||
    counts.onlyRemote > 0;

  return {
    analyzedAt: new Date().toISOString(),
    items,
    counts,
    hasPendingChanges,
  };
}

/**
 * Resolves a single sync item based on the selected resolution strategy.
 */
export async function resolveSyncItem(
  item: SyncItemDiff, strategy: 'keep_local' | 'keep_remote' | 'merge',
  workspaceStore: WorkspaceStoreState, configOverride?: Partial<SanityConfig>
): Promise<{ success: boolean; message: string; updatedStore?: WorkspaceStoreState }> {
  const config = { ...getSanityConfig(), ...configOverride };
  const session = getSyncSession(config);
  if (!session || workspaceStore.scope !== session.scope) throw new Error('La cuenta de sincronizacion ha cambiado');
  assertSyncSession(session);
  let resolved: any;
  let baseline: any;
  if (item.entityType === 'workspace') {
    if (strategy === 'keep_remote') {
      if (!item.remoteData) return { success: false, message: 'No hay datos remotos para importar' };
      resolved = item.remoteData;
      documentSync.discardPending(resolved._id || `workspace-${resolved.id}`, session);
    } else {
      if (!item.localData) return { success: false, message: 'No hay datos locales para enviar' };
      const base = workspaceStore.remoteBase?.find(w => w.id === item.workspaceId);
      if (strategy === 'merge' && !base) throw new Error('No hay base compartida. Selecciona conservar local o remoto');
      const local = strategy === 'merge' ? mergeSyncValue(base, item.localData, item.remoteData, '/workspace') : item.localData;
      const id = local._id || `workspace-${local.id}`;
      const document = await documentSync.resolve({ ...documentSync.base(id, session), _id: id, _type: 'workspace',
        workspaceId: local.id, name: local.name, githubRepo: local.githubRepo, branches: local.branches,
        activeBranchName: local.activeBranchName, createdAt: local.createdAt }, config);
      resolved = normalizeSanityWorkspaceDoc(document);
    }
  } else if (item.entityType === 'task') {
    const ws = workspaceStore.workspaces.find(w => w.id === item.workspaceId);
    const branch = ws?.branches.find(b => b.name === item.branchName);
    const doc = branch?.taskDocuments.find(d => item.remoteData?.documentKey
      ? `${branch.name}::${d.id}` === item.remoteData.documentKey : d.path === item.documentPath);
    if (!ws || !branch || !doc) return { success: false, message: 'La tarea no identifica un workspace, rama y documento locales' };
    const fields = taskFields(doc.content).find(t => t.taskId === item.localData?.taskId);
    const documentKey = `${branch.name}::${doc.id}`;
    let task: any;
    if (strategy === 'keep_remote') {
      if (!item.remoteData) return { success: false, message: 'No hay tarea remota para importar' };
      task = item.remoteData;
      documentSync.discardPending(task._id, session);
      // Rejecting an offline workspace snapshot must not replay it later.
      documentSync.discardPending(ws._id || `workspace-${ws.id}`, session);
    } else {
      if (!fields) return { success: false, message: 'No hay tarea local para enviar' };
      const base = workspaceStore.remoteDocuments?.find(d => d._id === item.remoteData?._id);
      if (strategy === 'merge' && !base) throw new Error('No hay base compartida para fusionar la tarea');
      const intention = { ...(item.remoteData || {}), ...fields, _type: 'task',
        _id: item.remoteData?._id || buildTaskDocumentId(fields.taskId, ws.id, documentKey),
        workspaceId: ws.id, documentKey, branchName: branch.name, documentPath: doc.path };
      task = await documentSync.resolve(strategy === 'merge' ? mergeSyncValue(base, intention, item.remoteData) : intention, config);
    }
    resolved = { ...ws, branches: ws.branches.map(b => b.name === branch.name ? { ...b,
      taskDocuments: b.taskDocuments.map(d => d.id === doc.id ? { ...d, content: applyTaskToMarkdown(d.content, task) } : d) } : b) };
    const parent = documentSync.base(ws._id || `workspace-${ws.id}`, session);
    if (parent?._rev) { resolved._rev = parent._rev; baseline = normalizeSanityWorkspaceDoc(parent); }
  } else return { success: false, message: 'Tipo de elemento no compatible' };
  assertSyncSession(session);
  const replace = (list: Workspace[], value = resolved) => [...list.filter(w => w.id !== resolved.id), value];
  const updatedStore = { ...workspaceStore, workspaces: replace(workspaceStore.workspaces),
    remoteBase: replace(workspaceStore.remoteBase || [], baseline || resolved),
    remoteDocuments: (workspaceStore.remoteDocuments || []).map(d => documentSync.base(d._id, session) || d) };
  saveWorkspaceStore(updatedStore);
  return { success: true, message: 'Sincronizacion resuelta', updatedStore };
}

/**
 * Executes a batch synchronization resolving all items with chosen global strategy.
 */
export async function executeBatchSync(
  items: SyncItemDiff[],
  mode: 'smart' | 'push_all' | 'pull_all',
  workspaceStore: WorkspaceStoreState,
  configOverride?: Partial<SanityConfig>
): Promise<{
  success: boolean;
  resolvedCount: number;
  message: string;
  updatedStore: WorkspaceStoreState;
}> {
  const config = { ...getSanityConfig(), ...configOverride };
  let currentStore = { ...workspaceStore };
  let resolvedCount = 0;

  try {
    for (const item of items) {
      // Files are displayed individually but persisted with their workspace.
      if (item.entityType === 'task_document') continue;
      if (item.diffType === 'synced' && mode === 'smart') continue;

      let strategy: 'keep_local' | 'keep_remote' | 'merge' = item.resolutionStrategy;

      if (mode === 'push_all') {
        strategy = 'keep_local';
      } else if (mode === 'pull_all') {
        strategy = 'keep_remote';
      } else if (mode === 'smart') {
        if (item.diffType === 'local_override' || item.diffType === 'only_local') {
          strategy = 'keep_local';
        } else if (item.diffType === 'remote_override' || item.diffType === 'only_remote') {
          strategy = 'keep_remote';
        } else {
          strategy = 'merge';
        }
      }

      const res = await resolveSyncItem(item, strategy, currentStore, config);
      if (res.success) {
        resolvedCount++;
        if (res.updatedStore) {
          currentStore = res.updatedStore;
        }
      } else { throw new Error(res.message); }
    }

    return {
      success: true,
      resolvedCount,
      message: `Sincronización completada (${resolvedCount} elemento(s) procesados)`,
      updatedStore: currentStore,
    };
  } catch (err: any) {
    return {
      success: false,
      resolvedCount,
      message: err?.message || 'Error durante la sincronización',
      updatedStore: currentStore,
    };
  }
}

/**
 * Deletes a sync item with a selected scope (local, remote, or both).
 */
export async function deleteSyncItem(
  item: SyncItemDiff,
  scope: 'local' | 'remote' | 'both',
  workspaceStore: WorkspaceStoreState,
  configOverride?: Partial<SanityConfig>
): Promise<{ success: boolean; message: string; updatedStore?: WorkspaceStoreState }> {
  const config = { ...getSanityConfig(), ...configOverride };

  if (item.entityType === 'workspace') {
    const wsId =
      item.localData?.id ||
      item.remoteData?.workspaceId ||
      item.remoteData?.id ||
      item.id.replace(/^ws_/, '');
    const session = getSyncSession(config);
    if ((scope === 'remote' || scope === 'both') && !session) return { success: false, message: 'La sesion de sincronizacion no esta preparada' };
    const cleanId = sanitizeSanityDocId(String(wsId).replace(/^workspace-/, ''));
    let updatedStore: WorkspaceStoreState | undefined;

    // 1. Delete locally if scope is 'local' or 'both'
    if (scope === 'local' || scope === 'both') {
      const filtered = workspaceStore.workspaces.filter(
        (w) =>
          w.id !== wsId &&
          w.id !== cleanId &&
          w.id.replace(/^workspace-/, '') !== cleanId &&
          `ws_${w.id}` !== item.id &&
          w.id !== item.id.replace(/^ws_/, '')
      );

      let nextWorkspaces = filtered;
      let nextActiveId = workspaceStore.activeWorkspaceId;

      if (nextWorkspaces.length === 0) {
        const cleanWs = createEmptyWorkspace();
        nextWorkspaces = [cleanWs];
        nextActiveId = cleanWs.id;
      } else if (
        workspaceStore.activeWorkspaceId === wsId ||
        workspaceStore.activeWorkspaceId === cleanId ||
        workspaceStore.activeWorkspaceId.replace(/^workspace-/, '') === cleanId ||
        `ws_${workspaceStore.activeWorkspaceId}` === item.id
      ) {
        nextActiveId = nextWorkspaces[0].id;
      }

      updatedStore = {
        ...workspaceStore,
        workspaces: nextWorkspaces,
        activeWorkspaceId: nextActiveId,
      };
      saveWorkspaceStore(updatedStore);
    }

    // 2. Delete remotely if scope is 'remote' or 'both'
    if (scope === 'remote' || scope === 'both') {
      if (config.projectId && config.dataset && config.token) {
        const delRes = await deleteWorkspaceFromSanity(cleanId, config);
        if (!delRes.ok) {
          return { success: false, message: delRes.message, updatedStore };
        }
      } else {
        return {
          success: false,
          message: 'Configura el API Token de Sanity para eliminar en remoto',
        };
      }
    }

    const scopeLabel =
      scope === 'both'
        ? 'localmente y en Sanity Cloud'
        : scope === 'remote'
        ? 'en Sanity Cloud'
        : 'en local';

    return {
      success: true,
      message: `Workspace "${item.title.replace(/^Workspace:\s*/, '')}" eliminado ${scopeLabel}`,
      updatedStore,
    };
  }

  if (item.entityType === 'task') {
    const taskId =
      item.localData?.taskId ||
      item.localData?.temporaryId ||
      item.remoteData?.taskId ||
      item.remoteData?._id?.replace(/^task-/, '') ||
      item.id.replace(/^task_/, '');
    let updatedStore: WorkspaceStoreState | undefined;

    // 1. Delete locally if scope is 'local' or 'both'
    if (scope === 'local' || scope === 'both') {
      let taskFoundAndRemoved = false;
      const updatedWorkspaces = workspaceStore.workspaces.map((w) => w.id !== item.workspaceId ? w : ({
        ...w,
        branches: w.branches.map((b) => b.name !== item.branchName ? b : ({
          ...b,
          taskDocuments: b.taskDocuments.map((d) => {
            if (item.remoteData?.documentKey ? `${b.name}::${d.id}` !== item.remoteData.documentKey : d.path !== item.documentPath) return d;
            const newContent = deleteTaskFromMarkdown(
              d.content,
              taskId,
              undefined
            );
            if (newContent !== d.content) {
              taskFoundAndRemoved = true;
              return {
                ...d,
                content: newContent,
                lastSavedContent: newContent,
                updatedAt: new Date().toISOString(),
              };
            }
            return d;
          }),
        })),
      }));

      if (taskFoundAndRemoved) {
        updatedStore = {
          ...workspaceStore,
          workspaces: updatedWorkspaces,
        };
        saveWorkspaceStore(updatedStore);
      }
    }

    // 2. Delete remotely if scope is 'remote' or 'both'
    if (scope === 'remote' || scope === 'both') {
      if (config.projectId && config.dataset && config.token) {
        const explicitId = item.remoteData?._id;
        let delRes = { ok: false, message: '' };
        if (explicitId) {
          delRes = await deleteDocumentFromSanity(explicitId, config);
        }
        if (!delRes.ok || !explicitId) {
          delRes = await deleteDocumentFromSanity(buildTaskDocumentId(taskId, item.workspaceId, item.remoteData?.documentKey), config);
        }
        if (!delRes.ok) {
          return { success: false, message: delRes.message, updatedStore };
        }
      } else {
        return {
          success: false,
          message: 'Configura el API Token de Sanity para eliminar en remoto',
        };
      }
    }

    const scopeLabel =
      scope === 'both'
        ? 'localmente y en Sanity Cloud'
        : scope === 'remote'
        ? 'en Sanity Cloud'
        : 'en local';

    return {
      success: true,
      message: `Tarea "${item.title.replace(/^Tarea:\s*(\[[^\]]+\]\s*)?/, '')}" eliminada ${scopeLabel}`,
      updatedStore,
    };
  }

  return {
    success: false,
    message: 'Tipo de elemento no compatible para eliminación',
  };
}
