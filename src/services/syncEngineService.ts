import {
  Workspace,
  WorkspaceStoreState,
  TaskDocument,
  saveWorkspaceStore,
  getInitialDefaultWorkspaces,
} from './workspaceService';
import {
  getSanityConfig,
  saveWorkspaceToSanity,
  loadWorkspacesFromSanity,
  saveSanityDocument,
  loadCanvasVisualState,
  saveCanvasVisualState,
  fetchSanityDocumentsList,
  fetchSanityDocumentById,
  deleteDocumentFromSanity,
  deleteWorkspaceFromSanity,
  sanitizeSanityDocId,
  SanityConfig,
} from './sanityService';
import { parseTasksMarkdown, ParsedGroup } from '../shapes/TaskShapeUtil';
import {
  deleteTaskFromMarkdown,
  updateTaskInMarkdown,
  addTaskToMarkdown,
  scanTaskBlocks,
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
      const [wsList, docsList] = await Promise.all([
        loadWorkspacesFromSanity(config),
        fetchSanityDocumentsList(config),
      ]);
      remoteWorkspaces = wsList || [];
      remoteSanityDocs = docsList || [];
    } catch (err) {
      console.warn('Error fetching remote data for sync analysis:', err);
    }
  }

  // Map of remote workspaces by exact ID, normalized ID, and normalized name
  const remoteWsMap = new Map<string, any>();
  for (const rw of remoteWorkspaces) {
    if (rw.id) {
      remoteWsMap.set(rw.id, rw);
      remoteWsMap.set(rw.id.replace(/^workspace-/, ''), rw);
    }
    if (rw.workspaceId) {
      remoteWsMap.set(rw.workspaceId, rw);
    }
    if (rw.name) {
      remoteWsMap.set(rw.name.trim().toLowerCase(), rw);
    }
  }

  // 2. Compare Workspaces & Task Documents
  const processedRemoteWsIds = new Set<string>();

  for (const localWs of workspaceStore.workspaces) {
    const cleanLocalId = localWs.id.replace(/^workspace-/, '');
    const cleanLocalName = (localWs.name || '').trim().toLowerCase();

    const remoteWs =
      remoteWsMap.get(localWs.id) ||
      remoteWsMap.get(cleanLocalId) ||
      remoteWsMap.get(cleanLocalName) ||
      remoteWorkspaces.find(
        (rw) =>
          rw.id === localWs.id ||
          rw.id === cleanLocalId ||
          (rw.name && rw.name.trim().toLowerCase() === cleanLocalName) ||
          (rw.githubRepo?.fullName &&
            localWs.githubRepo?.fullName &&
            rw.githubRepo.fullName.toLowerCase() === localWs.githubRepo.fullName.toLowerCase())
      );

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
      const localTime = new Date(localWs.updatedAt || 0).getTime();
      const remoteTime = new Date(remoteWs.updatedAt || 0).getTime();
      const timeDiff = Math.abs(localTime - remoteTime);

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
          const rDoc = rb.taskDocuments?.find((d: any) => d.id === lDoc.id || d.path === lDoc.path);
          if (!rDoc) {
            changes.push(`Documento local "${lDoc.path}" (${lb.name}) pendiente de subir`);
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
        if (localTime > remoteTime + 2000) {
          diffType = 'local_override';
        } else if (remoteTime > localTime + 2000) {
          diffType = 'remote_override';
        } else {
          diffType = 'conflict';
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

  // 3. Compare Individual Tasks grouped by Workspace & Document vs Sanity Task Documents
  const remoteTasks = remoteSanityDocs.filter((d) => d._type === 'task');
  const remoteTasksMap = new Map<string, any>();
  for (const rt of remoteTasks) {
    if (rt.taskId) remoteTasksMap.set(rt.taskId.toLowerCase(), rt);
    if (rt._id) remoteTasksMap.set(rt._id.replace(/^task-/, '').toLowerCase(), rt);
  }
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
          const matchedRemote =
            remoteTasksMap.get(resTaskId.toLowerCase()) ||
            (lt.title
              ? remoteTasks.find(
                  (rt) => (rt.title || '').trim().toLowerCase() === (lt.title || '').trim().toLowerCase()
                )
              : undefined);

          if (!matchedRemote) {
            items.push({
              id: `task_${ws.id}_${resTaskId}`,
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
            const remoteKey = (matchedRemote.taskId || matchedRemote._id?.replace(/^task-/, '') || '').toLowerCase();
            processedRemoteTaskIds.add(remoteKey);

            const titleDiff = lt.title !== matchedRemote.title;
            const completedDiff = Boolean(lt.completed) !== Boolean(matchedRemote.completed);
            const priorityDiff = (lt.priority || 'P1') !== (matchedRemote.priority || 'P1');

            if (!titleDiff && !completedDiff && !priorityDiff) {
              items.push({
                id: `task_${ws.id}_${resTaskId}`,
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
              const localTime = new Date(doc.updatedAt || 0).getTime();
              const remoteTime = new Date(matchedRemote.updatedAt || matchedRemote._updatedAt || 0).getTime();
              let diffType: SyncDifferenceType = 'conflict';
              if (localTime > remoteTime + 2000) {
                diffType = 'local_override';
              } else if (remoteTime > localTime + 2000) {
                diffType = 'remote_override';
              }

              const changes: string[] = [];
              if (titleDiff) changes.push(`Título: "${matchedRemote.title}" vs "${lt.title}"`);
              if (completedDiff) changes.push(`Estado completado: Remoto (${Boolean(matchedRemote.completed)}) vs Local (${Boolean(lt.completed)})`);
              if (priorityDiff) changes.push(`Prioridad: Remoto (${matchedRemote.priority || 'P1'}) vs Local (${lt.priority || 'P1'})`);

              items.push({
                id: `task_${ws.id}_${resTaskId}`,
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
  const defaultWs = workspaceStore.workspaces?.find((w) => w.id === workspaceStore.activeWorkspaceId) || workspaceStore.workspaces?.[0];
  for (const rt of remoteTasks) {
    const remoteKey = (rt.taskId || rt._id?.replace(/^task-/, '') || '').toLowerCase();
    if (!processedRemoteTaskIds.has(remoteKey)) {
      items.push({
        id: `task_${rt.taskId || rt._id}`,
        entityType: 'task',
        workspaceId: rt.workspaceId || defaultWs?.id,
        workspaceName: rt.workspaceName || defaultWs?.name,
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
  item: SyncItemDiff,
  strategy: 'keep_local' | 'keep_remote' | 'merge',
  workspaceStore: WorkspaceStoreState,
  configOverride?: Partial<SanityConfig>
): Promise<{ success: boolean; message: string; updatedStore?: WorkspaceStoreState }> {
  const config = { ...getSanityConfig(), ...configOverride };

  if (item.entityType === 'workspace') {
    if (strategy === 'keep_local' || (strategy === 'merge' && item.localData)) {
      // Push local workspace to Sanity
      if (!item.localData) {
        return { success: false, message: 'No hay datos locales para enviar a Sanity' };
      }
      const saveRes = await saveWorkspaceToSanity(item.localData, config);
      return {
        success: saveRes.ok,
        message: saveRes.message,
      };
    } else if (strategy === 'keep_remote') {
      // Pull remote workspace into local store
      if (!item.remoteData) {
        return { success: false, message: 'No hay datos remotos para importar' };
      }

      const remoteWs = item.remoteData;
      const nextWorkspaces = [...workspaceStore.workspaces];
      const existingIdx = nextWorkspaces.findIndex(
        (w) =>
          w.id === remoteWs.id ||
          w.id === remoteWs.workspaceId ||
          (w.name && remoteWs.name && w.name.trim().toLowerCase() === remoteWs.name.trim().toLowerCase())
      );

      if (existingIdx >= 0) {
        nextWorkspaces[existingIdx] = remoteWs;
      } else {
        nextWorkspaces.push(remoteWs);
      }

      const updatedStore: WorkspaceStoreState = {
        ...workspaceStore,
        workspaces: nextWorkspaces,
      };
      saveWorkspaceStore(updatedStore);

      return {
        success: true,
        message: `Workspace "${remoteWs.name}" actualizado desde Sanity`,
        updatedStore,
      };
    }
  }

  if (item.entityType === 'task') {
    if (strategy === 'keep_local' || (strategy === 'merge' && item.localData)) {
      // Push individual task to Sanity
      const taskId = item.localData.taskId || item.localData.temporaryId || item.id.replace(/^task_([^_]+_)?/, '');
      const taskDoc = {
        _id: `task-${taskId}`,
        _type: 'task',
        taskId,
        workspaceId: item.workspaceId,
        workspaceName: item.workspaceName,
        title: item.localData.title || item.title,
        completed: Boolean(item.localData.completed),
        status: item.localData.status || (item.localData.completed ? 'done' : 'todo'),
        priority: item.localData.priority || 'P1',
        groupTitle: item.localData.groupTitle || 'General',
        tags: item.localData.tags || [],
        blockedBy: item.localData.blockedBy || '',
        updatedAt: new Date().toISOString(),
      };
      const res = await saveSanityDocument(taskDoc, config);
      return {
        success: res.ok,
        message: res.ok ? `Tarea "${taskDoc.title}" sincronizada con Sanity` : res.message,
      };
    } else if (strategy === 'keep_remote') {
      if (!item.remoteData) {
        return { success: false, message: 'No hay datos remotos de la tarea para importar' };
      }
      const remoteTask = item.remoteData;
      const taskId = remoteTask.taskId || remoteTask._id?.replace(/^task-/, '') || item.id.replace(/^task_([^_]+_)?/, '');

      const targetWs =
        (item.workspaceId ? workspaceStore.workspaces.find((w) => w.id === item.workspaceId) : null) ||
        workspaceStore.workspaces.find((w) => w.id === workspaceStore.activeWorkspaceId) ||
        workspaceStore.workspaces[0];
      if (!targetWs) {
        return { success: false, message: 'No hay workspace para importar la tarea' };
      }
      const targetBranch =
        (item.branchName ? targetWs.branches.find((b) => b.name === item.branchName) : null) ||
        targetWs.branches.find((b) => b.name === targetWs.activeBranchName) ||
        targetWs.branches[0];
      if (!targetBranch) {
        return { success: false, message: 'No hay rama activa para importar la tarea' };
      }
      const targetDoc =
        (item.documentPath ? targetBranch.taskDocuments.find((d) => d.path === item.documentPath) : null) ||
        targetBranch.taskDocuments.find((d) => d.id === targetBranch.activeDocumentId) ||
        targetBranch.taskDocuments[0];
      if (!targetDoc) {
        return { success: false, message: 'No hay documento de tareas para importar' };
      }

      let updatedMd = targetDoc.content;
      const { taskBlocks } = scanTaskBlocks(targetDoc.content);
      const exists = taskBlocks.some(
        (b) =>
          (b.detectedId && b.detectedId.toLowerCase() === taskId.toLowerCase()) ||
          (b.detectedTitle && remoteTask.title && b.detectedTitle.trim().toLowerCase() === remoteTask.title.trim().toLowerCase())
      );

      if (exists) {
        updatedMd = updateTaskInMarkdown(
          targetDoc.content,
          taskId,
          {
            title: remoteTask.title,
            completed: Boolean(remoteTask.completed),
            priority: remoteTask.priority,
            status: remoteTask.status,
          },
          remoteTask.title
        );
      } else {
        const addRes = addTaskToMarkdown(targetDoc.content, {
          title: remoteTask.title || 'Nueva tarea',
          priority: remoteTask.priority || 'P1',
          groupTitle: remoteTask.groupTitle || 'General',
          customId: taskId,
          blockedBy: remoteTask.blockedBy,
          tags: remoteTask.tags,
        });
        updatedMd = addRes.updatedMarkdown;
      }

      const updatedDocs = targetBranch.taskDocuments.map((d) =>
        d.id === targetDoc.id
          ? {
              ...d,
              content: updatedMd,
              lastSavedContent: updatedMd,
              updatedAt: new Date().toISOString(),
            }
          : d
      );
      const updatedBranches = targetWs.branches.map((b) =>
        b.name === targetBranch.name ? { ...b, taskDocuments: updatedDocs } : b
      );
      const updatedWorkspaces = workspaceStore.workspaces.map((w) =>
        w.id === targetWs.id ? { ...w, branches: updatedBranches } : w
      );
      const updatedStore: WorkspaceStoreState = {
        ...workspaceStore,
        workspaces: updatedWorkspaces,
      };
      saveWorkspaceStore(updatedStore);

      return {
        success: true,
        message: `Tarea "${remoteTask.title || taskId}" actualizada desde Sanity`,
        updatedStore,
      };
    }
  }

  return {
    success: true,
    message: 'Resolución completada',
  };
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
      if (item.diffType === 'synced') continue;

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
      }
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
        const freshDefaults = getInitialDefaultWorkspaces();
        const cleanWs: Workspace = {
          ...freshDefaults[0],
          id: 'ws_' + Date.now(),
          name: 'Mi Workspace',
          githubRepo: {
            owner: 'usuario',
            repo: 'mi-repositorio',
            fullName: 'usuario/mi-repositorio',
            url: 'https://github.com/usuario/mi-repositorio',
            defaultBranch: 'main',
          },
        };
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
        const explicitId = item.remoteData?._id;
        let delRes = { ok: false, message: '' };
        if (explicitId) {
          delRes = await deleteDocumentFromSanity(explicitId, config);
        }
        if (!delRes.ok || !explicitId) {
          delRes = await deleteWorkspaceFromSanity(cleanId, config);
        }
        if (!delRes.ok && scope === 'remote') {
          return { success: false, message: delRes.message };
        }
      } else if (scope === 'remote') {
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
      const updatedWorkspaces = workspaceStore.workspaces.map((w) => ({
        ...w,
        branches: w.branches.map((b) => ({
          ...b,
          taskDocuments: b.taskDocuments.map((d) => {
            const newContent = deleteTaskFromMarkdown(
              d.content,
              taskId,
              item.localData?.title
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
          delRes = await deleteDocumentFromSanity(`task-${taskId}`, config);
        }
        if (!delRes.ok && scope === 'remote') {
          return { success: false, message: delRes.message };
        }
      } else if (scope === 'remote') {
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
