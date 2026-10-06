import { createClient } from '@sanity/client';
import { Editor } from 'tldraw';

export interface TaskVisualState {
  taskId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupTitle?: string;
}

export interface GroupVisualState {
  groupTitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCollapsed?: boolean;
}

export interface CanvasVisualDocument {
  _id?: string;
  _type?: string;
  projectId?: string;
  tasks: TaskVisualState[];
  groups: GroupVisualState[];
  updatedAt: string;
}

export interface SanityConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  token?: string;
  useCdn: boolean;
}

export interface SanityConnectionTestResult {
  ok: boolean;
  message: string;
  details?: string;
  latencyMs?: number;
  mode: 'authenticated' | 'public_read' | 'failed';
  existingDocsCount?: number;
}

const LOCAL_STORAGE_KEY_VISUAL_STATE = 'antaskcanvas_visual_state_v1';
const LOCAL_STORAGE_KEY_SANITY_CONFIG = 'antaskcanvas_sanity_config';
// Sanitizes strings to valid Sanity document ID format (only a-z, A-Z, 0-9, _, ., -)
export function sanitizeSanityDocId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Identifiable Trace Logger for Sanity Integration
export const logSanityTrace = (action: string, details?: any) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`%c[AnTask Sanity Bridge ${timestamp}]%c ${action}`, 'color: #10b981; font-weight: bold;', 'color: inherit;', details || '');
};

export const logSanityWarn = (action: string, details?: any) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.warn(`[AnTask Sanity Bridge ${timestamp}] ⚠️ ${action}`, details || '');
};

const DEFAULT_SANITY_CONFIG: SanityConfig = {
  projectId: import.meta.env.VITE_SANITY_PROJECT_ID || '',
  dataset: import.meta.env.VITE_SANITY_DATASET || 'production',
  apiVersion: '2024-03-01',
  token: import.meta.env.VITE_SANITY_API_TOKEN || '',
  useCdn: false,
};

export function getSanityConfig(): SanityConfig {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY_SANITY_CONFIG);
    if (stored) {
      return { ...DEFAULT_SANITY_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('Could not read Sanity config from storage', e);
  }
  return DEFAULT_SANITY_CONFIG;
}

export function saveSanityConfig(config: Partial<SanityConfig>) {
  try {
    const current = getSanityConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_CONFIG, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antask_sanity_config_updated', { detail: updated }));
    }
    return updated;
  } catch (e) {
    console.warn('Could not save Sanity config', e);
    return DEFAULT_SANITY_CONFIG;
  }
}

export type SanityAuthType = 'user_token' | 'robot_token' | 'public_read' | 'local';

export interface SanityUserProfile {
  id: string;
  name?: string;
  email?: string;
  profileImage?: string;
  role?: string;
  isRobot?: boolean;
  authType: SanityAuthType;
}

const LOCAL_STORAGE_KEY_SANITY_USER = 'antask_sanity_user_profile';

export function getCachedSanityUser(): SanityUserProfile | null {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY_SANITY_USER);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return null;
}

export function determineSanityAuthType(config: SanityConfig, profile?: Partial<SanityUserProfile> | null): SanityAuthType {
  if (!config.projectId || !config.dataset) {
    return 'local';
  }
  if (!config.token?.trim()) {
    return 'public_read';
  }
  if (profile?.isRobot || profile?.authType === 'robot_token') {
    return 'robot_token';
  }
  return 'user_token';
}

export async function fetchSanityCurrentUser(configOverride?: SanityConfig): Promise<SanityUserProfile | null> {
  const config = configOverride || getSanityConfig();
  const token = config.token?.trim();

  if (!config.projectId || !config.dataset) {
    return {
      id: 'local',
      name: 'Modo Local',
      authType: 'local',
    };
  }

  if (!token) {
    return {
      id: config.projectId,
      name: `Proyecto ${config.projectId}`,
      role: 'Público / Solo lectura',
      authType: 'public_read',
    };
  }

  try {
    const res = await fetch('https://api.sanity.io/v2021-06-07/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const isRobot = Boolean(data.isRobot || data.type === 'robot' || (!data.email && !data.profileImage));
      const authType: SanityAuthType = isRobot ? 'robot_token' : 'user_token';
      const user: SanityUserProfile = {
        id: data.id || 'user',
        name: data.name || data.displayName || data.label || (isRobot ? `Token Robot (${config.projectId})` : 'Usuario Sanity'),
        email: data.email || '',
        profileImage: data.profileImage || data.imageUrl || '',
        role: data.role || (isRobot ? 'Robot / Service' : 'Editor / Admin'),
        isRobot,
        authType,
      };
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_USER, JSON.stringify(user));
      } catch {
        // ignore
      }
      return user;
    } else if (res.status === 401 || res.status === 403) {
      // Token exists and works for dataset operations, but has restricted user/project scope (e.g. specialized deploy token)
      const robotUser: SanityUserProfile = {
        id: 'service-token',
        name: `Token de Servicio (${config.projectId})`,
        role: 'Robot / Service Token',
        isRobot: true,
        authType: 'robot_token',
      };
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_USER, JSON.stringify(robotUser));
      } catch {
        // ignore
      }
      return robotUser;
    }
  } catch (err) {
    console.warn('Could not fetch current Sanity user:', err);
  }

  const cached = getCachedSanityUser();
  if (cached) return cached;

  return {
    id: config.projectId,
    name: `Sanity (${config.projectId})`,
    role: 'API Token',
    authType: 'user_token',
  };
}

export function clearSanityConfig() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_SANITY_CONFIG);
    localStorage.removeItem(LOCAL_STORAGE_KEY_SANITY_USER);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antask_sanity_config_updated', { detail: DEFAULT_SANITY_CONFIG }));
    }
  } catch (e) {
    console.warn('Could not clear Sanity config', e);
  }
  return DEFAULT_SANITY_CONFIG;
}

/**
 * Tests connection with Sanity using provided credentials.
 */
export async function testSanityConnection(config: {
  projectId: string;
  dataset: string;
  apiVersion?: string;
  token?: string;
}): Promise<SanityConnectionTestResult> {
  const pId = config.projectId?.trim();
  const ds = config.dataset?.trim();
  const token = config.token?.trim();
  const apiVersion = config.apiVersion || '2024-03-01';

  if (!pId) {
    return {
      ok: false,
      mode: 'failed',
      message: 'Falta el Project ID de Sanity',
      details: 'Introduce el identificador del proyecto (disponible en manage.sanity.io).',
    };
  }

  if (!ds) {
    return {
      ok: false,
      mode: 'failed',
      message: 'Falta el Dataset de Sanity',
      details: 'Introduce el nombre del dataset (normalmente "production").',
    };
  }

  const startTime = Date.now();
  try {
    const client = createClient({
      projectId: pId,
      dataset: ds,
      apiVersion,
      token: token || undefined,
      useCdn: false,
    });

    const query = `count(*[_type == "canvasVisualState"])`;
    const count = await client.fetch<number>(query);
    const latencyMs = Date.now() - startTime;

    if (token) {
      return {
        ok: true,
        mode: 'authenticated',
        message: 'Conexión exitosa con Sanity (Lectura y Escritura)',
        details: `Dataset "${ds}" alcanzado correctamente en ${latencyMs}ms. Documentos de canvas encontrados: ${count}.`,
        latencyMs,
        existingDocsCount: count,
      };
    } else {
      return {
        ok: true,
        mode: 'public_read',
        message: 'Conexión exitosa (Modo solo lectura pública)',
        details: `Dataset "${ds}" alcanzado en ${latencyMs}ms. Para sincronizar y guardar posiciones en la nube, añade un API Token con permisos de Editor.`,
        latencyMs,
        existingDocsCount: count,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err?.message || String(err);
    const statusCode = err?.statusCode || err?.response?.statusCode;

    let userFriendlyMessage = 'No se pudo conectar con Sanity';
    let details = errorMsg;

    if (statusCode === 401 || statusCode === 403 || errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden')) {
      userFriendlyMessage = 'Error de autenticación o permisos (401/403)';
      details = 'El API Token no es válido o no tiene los permisos necesarios sobre este dataset. Verifica el token en manage.sanity.io.';
    } else if (statusCode === 404 || errorMsg.includes('not found') || errorMsg.includes('Dataset not found')) {
      userFriendlyMessage = 'Proyecto o Dataset no encontrado (404)';
      details = `Verifica que el Project ID "${pId}" y el Dataset "${ds}" existan y estén bien escritos.`;
    } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('CORS')) {
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'esta URL';
      userFriendlyMessage = 'Error de red o política CORS';
      details = `Asegúrate de agregar ${currentOrigin} en la configuración de CORS en manage.sanity.io (Project -> API -> CORS Origins -> Add CORS origin).`;
    }

    return {
      ok: false,
      mode: 'failed',
      message: userFriendlyMessage,
      details,
      latencyMs,
    };
  }
}

function getSanityClient() {
  const config = getSanityConfig();
  if (!config.projectId || !config.dataset) {
    return null;
  }

  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token || undefined,
    useCdn: config.useCdn ?? false,
  });
}

/**
 * Loads visual layout from Sanity (or fallback local cache if Sanity is not connected).
 */
export async function loadCanvasVisualState(
  projectId: string = 'default'
): Promise<CanvasVisualDocument | null> {
  const docId = `canvasVisualState-${projectId}`;

  // 1. Try Sanity remote with timeout to prevent blocking when offline or without studio connection
  const client = getSanityClient();
  if (client) {
    try {
      const query = `*[_type == "canvasVisualState" && (_id == $id || projectId == $projectId)][0]`;
      const fetchPromise = client.fetch<CanvasVisualDocument>(query, {
        id: docId,
        projectId,
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800));
      const result = await Promise.race([fetchPromise, timeoutPromise]);

      if (result && Array.isArray(result.tasks)) {
        // Cache locally for fast fallback
        try {
          localStorage.setItem(
            `${LOCAL_STORAGE_KEY_VISUAL_STATE}_${projectId}`,
            JSON.stringify(result)
          );
        } catch {}
        return result;
      }
    } catch (err) {
      console.warn('Error reading visual state from Sanity, using fallback cache:', err);
    }
  }

  // 2. Fallback to local storage cache (checking specific doc id, default, or root)
  try {
    const local =
      localStorage.getItem(`${LOCAL_STORAGE_KEY_VISUAL_STATE}_${projectId}`) ||
      localStorage.getItem(`${LOCAL_STORAGE_KEY_VISUAL_STATE}_default`) ||
      localStorage.getItem(LOCAL_STORAGE_KEY_VISUAL_STATE);
    if (local) {
      return JSON.parse(local);
    }
  } catch (e) {
    console.warn('Error reading local visual cache:', e);
  }

  return null;
}

/**
 * Saves visual layout (tasks & groups spatial coordinates) to Sanity.
 * Never saves task content, markdown or priorities - only taskId & geometry.
 */
export async function saveCanvasVisualState(
  state: { tasks: TaskVisualState[]; groups: GroupVisualState[] },
  projectId: string = 'default'
): Promise<{ success: boolean; remote: boolean }> {
  const docId = `canvasVisualState-${projectId}`;
  const docData: CanvasVisualDocument = {
    _id: docId,
    _type: 'canvasVisualState',
    projectId,
    tasks: state.tasks.map((t) => ({
      taskId: t.taskId,
      x: Math.round(t.x),
      y: Math.round(t.y),
      width: Math.round(t.width),
      height: Math.round(t.height),
    })),
    groups: state.groups.map((g) => ({
      groupTitle: g.groupTitle,
      x: Math.round(g.x),
      y: Math.round(g.y),
      width: Math.round(g.width),
      height: Math.round(g.height),
      isCollapsed: g.isCollapsed,
    })),
    updatedAt: new Date().toISOString(),
  };

  // 1. Always save to local visual cache (both under projectId and default)
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_KEY_VISUAL_STATE}_${projectId}`,
      JSON.stringify(docData)
    );
    localStorage.setItem(
      `${LOCAL_STORAGE_KEY_VISUAL_STATE}_default`,
      JSON.stringify(docData)
    );
  } catch (e) {
    console.warn('Local visual cache save failed:', e);
  }

  // 2. Save to Sanity if client configured with token
  const client = getSanityClient();
  const config = getSanityConfig();

  if (client && config.token) {
    try {
      await client.createOrReplace(docData as any);
      return { success: true, remote: true };
    } catch (err) {
      console.warn('Could not persist visual state to Sanity:', err);
      return { success: true, remote: false };
    }
  }

  return { success: true, remote: false };
}

export interface SanityTestingTaskDocument {
  _id: string;
  _type: 'task';
  taskId: string;
  title: string;
  completed: boolean;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  groupTitle: string;
  workspaceId?: string;
  workspace?: { _type: 'reference'; _ref: string };
  blockedBy?: string;
  tags?: string[];
  subtasks?: Array<{ title: string; completed: boolean }>;
  description?: string;
  updatedAt: string;
}

/**
 * Automatically syncs a list of tasks from TASKS.md to Sanity.
 * Creates or updates a _type: 'task' document for each task in the active dataset.
 */
export async function syncAllTasksToSanity(
  tasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    priority?: string;
    status?: string;
    groupTitle?: string;
    blockedBy?: string;
    tags?: string[];
    subtasks?: Array<{ title: string; completed?: boolean }>;
    description?: string;
  }>,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; syncedCount: number; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return { ok: false, syncedCount: 0, message: 'Falta configuración de Sanity (Project ID y Dataset)' };
  }

  if (!config.token) {
    return {
      ok: false,
      syncedCount: 0,
      message: 'Se requiere API Token con rol Editor para guardar automáticamente en Sanity',
    };
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token,
    useCdn: false,
  });

  try {
    const now = new Date().toISOString();
    const BATCH_SIZE = 50;

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const chunk = tasks.slice(i, i + BATCH_SIZE);
      let tx = client.transaction();

      for (const t of chunk) {
        const safeId = sanitizeSanityDocId(t.id);
        const docId = `task-${safeId}`;
        const doc: SanityTestingTaskDocument = {
          _id: docId,
          _type: 'task',
          taskId: t.id,
          title: t.title,
          completed: Boolean(t.completed),
          status: (t.status as any) || (t.completed ? 'done' : 'todo'),
          priority: (t.priority as any) || 'P1',
          groupTitle: t.groupTitle || 'General',
          blockedBy: t.blockedBy || '',
          tags: t.tags || [],
          subtasks: (t.subtasks || []).map((s) => ({
            title: s.title,
            completed: Boolean(s.completed),
          })),
          description: t.description || '',
          updatedAt: now,
        };

        tx = tx.createOrReplace(doc as any);
      }

      await tx.commit();
    }

    return {
      ok: true,
      syncedCount: tasks.length,
      message: `${tasks.length} tareas sincronizadas con éxito en Sanity (${config.dataset})`,
    };
  } catch (err: any) {
    console.warn('Error syncing tasks to Sanity:', err);
    return {
      ok: false,
      syncedCount: 0,
      message: err?.message || 'Error al sincronizar tareas con Sanity',
    };
  }
}

export interface SanityWriteTestResult {
  ok: boolean;
  message: string;
  details?: string;
  latencyMs?: number;
  dataset?: string;
  document?: any;
  action: 'created' | 'verified' | 'failed';
}

/**
 * Executes a real live write mutation to Sanity (dataset `production` or active dataset)
 * and immediately verifies that the document exists and can be retrieved.
 */
export async function writeTestingTaskToSanity(
  configOverride?: Partial<SanityConfig>,
  customTask?: Partial<SanityTestingTaskDocument>
): Promise<SanityWriteTestResult> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return {
      ok: false,
      action: 'failed',
      message: 'Falta configuración de Sanity',
      details: 'Introduce un Project ID y Dataset válidos.',
    };
  }

  if (!config.token) {
    return {
      ok: false,
      action: 'failed',
      message: 'Se requiere API Token con permisos de escritura',
      details: 'Para escribir datos en el dataset de Sanity necesitas un token de tipo "Editor".',
    };
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token,
    useCdn: false,
  });

  const now = new Date();
  const testDocId = customTask?._id || `task-test-schema-${Date.now().toString(36)}`;
  const testTaskId = customTask?.taskId || `test-${Math.floor(1000 + Math.random() * 9000)}`;

  const testDocument: SanityTestingTaskDocument = {
    _id: testDocId,
    _type: 'task',
    taskId: testTaskId,
    title: customTask?.title || 'Tarea de Prueba - Verificación de Escritura Sanity',
    completed: customTask?.completed ?? false,
    status: customTask?.status || 'in_progress',
    priority: customTask?.priority || 'P0',
    groupTitle: customTask?.groupTitle || 'Autenticación & Nube',
    workspaceId: customTask?.workspaceId,
    workspace: customTask?.workspace,
    tags: customTask?.tags || ['sanity-test', 'production-write', 'schema-v1'],
    subtasks: customTask?.subtasks || [
      { title: 'Validar schema task en Sanity', completed: true },
      { title: 'Comprobar persistencia en dataset ' + config.dataset, completed: true },
      { title: 'Sincronizar con el lienzo infinito', completed: false },
    ],
    description:
      customTask?.description ||
      `Documento de prueba generado por AnTaskCanvas a las ${now.toLocaleTimeString()} para comprobar mutaciones en el dataset "${config.dataset}".`,
    updatedAt: now.toISOString(),
  };

  const startTime = Date.now();
  try {
    // 1. Write document to Sanity
    const createResult = await client.createOrReplace(testDocument as any);

    // 2. Immediate read verification (Read-After-Write)
    const verifiedDoc = await client.fetch(`*[_id == $id][0]`, { id: testDocId });
    const latencyMs = Date.now() - startTime;

    if (!verifiedDoc) {
      return {
        ok: false,
        action: 'failed',
        message: 'Escritura completada pero el documento no se pudo leer',
        details: `El documento ${testDocId} fue enviado pero no se encontró en la consulta inmediata.`,
        latencyMs,
        dataset: config.dataset,
      };
    }

    return {
      ok: true,
      action: 'created',
      message: `Documento "${testDocument.title}" escrito con éxito en "${config.dataset}"`,
      details: `ID: ${verifiedDoc._id} | Tipo: ${verifiedDoc._type} | Verificado en ${latencyMs}ms.`,
      latencyMs,
      dataset: config.dataset,
      document: verifiedDoc,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      ok: false,
      action: 'failed',
      message: 'Error al escribir documento en Sanity',
      details: err?.message || String(err),
      latencyMs,
      dataset: config.dataset,
    };
  }
}

/**
 * Deletes a test document from Sanity.
 */
export async function deleteDocumentFromSanity(
  docId: string,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset || !config.token) {
    return { ok: false, message: 'Falta token de autenticación para eliminar' };
  }

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token,
      useCdn: false,
    });

    await client.delete(docId);
    return { ok: true, message: `Documento ${docId} eliminado con éxito` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Error al eliminar documento' };
  }
}

/**
 * Fetches recent documents stored in Sanity dataset (task, canvasVisualState, and workspace).
 */
export async function fetchSanityDocumentsList(
  configOverride?: Partial<SanityConfig>
): Promise<Array<{ _id: string; _type: string; title?: string; name?: string; workspaceId?: string; taskId?: string; projectId?: string; _updatedAt?: string; updatedAt?: string; githubRepo?: any }>> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) return [];

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token || undefined,
      useCdn: false,
    });

    const query = `*[_type in ["task", "canvasVisualState", "workspace"] || _id match "*workspace*"] | order(_updatedAt desc)[0...100] {
      _id,
      _type,
      title,
      name,
      workspaceId,
      taskId,
      projectId,
      _updatedAt,
      updatedAt,
      githubRepo
    }`;
    const results = await client.fetch(query);
    return Array.isArray(results) ? results : [];
  } catch (err) {
    console.warn('Error fetching Sanity documents list:', err);
    return [];
  }
}

/**
 * Updates or creates any document in Sanity.
 */
export async function saveSanityDocument(
  doc: any,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; document?: any; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset || !config.token) {
    return { ok: false, message: 'Se requiere API Token con permisos de Editor para guardar en Sanity' };
  }

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token,
      useCdn: false,
    });

    const docToSave = {
      ...doc,
      updatedAt: new Date().toISOString(),
    };
    const result = await client.createOrReplace(docToSave);
    return { ok: true, document: result, message: 'Documento publicado con éxito en Sanity' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Error al guardar documento en Sanity' };
  }
}

/**
 * Fetches single document by ID from Sanity.
 */
export async function fetchSanityDocumentById(
  id: string,
  configOverride?: Partial<SanityConfig>
): Promise<any | null> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) return null;

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token || undefined,
      useCdn: false,
    });

    const doc = await client.fetch(`*[_id == $id][0]`, { id });
    return doc || null;
  } catch (err) {
    console.warn('Error fetching document by ID:', err);
    return null;
  }
}

export interface SanityLiveChangeEvent {
  type: 'task' | 'workspace' | 'canvasVisualState' | 'other';
  transition: 'appear' | 'update' | 'disappear';
  documentId: string;
  document?: any;
}

/**
 * Subscribes to real-time document mutations from Sanity Content Lake.
 * Automatically receives live updates created in Sanity Studio Embed, Sanity Cloud,
 * or other clients, enabling true bidirectional live synchronization.
 */
export function subscribeToSanityLiveChanges(
  onMutation: (event: SanityLiveChangeEvent) => void,
  configOverride?: Partial<SanityConfig>
): () => void {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return () => {};
  }

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token || undefined,
      useCdn: false,
    });

    const subscription = client
      .listen(
        `*[_type in ["task", "workspace", "canvasVisualState"]]`,
        {},
        { includeResult: true, visibility: 'query' }
      )
      .subscribe({
        next: (update: any) => {
          if (!update) return;
          const doc = update.result;
          let docType: 'task' | 'workspace' | 'canvasVisualState' | 'other' = 'other';
          if (doc?._type) {
            docType = doc._type as any;
          } else if (update.documentId?.startsWith('task-')) {
            docType = 'task';
          } else if (update.documentId?.startsWith('workspace-')) {
            docType = 'workspace';
          } else if (update.documentId === 'canvas-visual-state' || update.documentId?.includes('canvasVisualState')) {
            docType = 'canvasVisualState';
          }

          onMutation({
            type: docType,
            transition: update.transition,
            documentId: update.documentId,
            document: doc,
          });
        },
        error: (err: any) => {
          console.warn('Sanity live subscription warning:', err);
        },
      });

    return () => {
      try {
        subscription.unsubscribe();
      } catch {
        // ignore cleanup errors
      }
    };
  } catch (err) {
    console.warn('Could not initialize Sanity live listener:', err);
    return () => {};
  }
}

/**
 * Extracts current visual positions and dimensions of all task cards and groups from tldraw editor.
 */
export function extractVisualStateFromEditor(editor: Editor): {
  tasks: TaskVisualState[];
  groups: GroupVisualState[];
} {
  const shapes = editor.getCurrentPageShapes();
  const tasks: TaskVisualState[] = [];
  const groups: GroupVisualState[] = [];

  for (const rawShape of shapes) {
    const s = rawShape as any;
    if (s.type === 'task') {
      const taskId = s.props?.taskId;
      if (taskId) {
        tasks.push({
          taskId,
          x: s.x,
          y: s.y,
          width: s.props?.w || 320,
          height: s.props?.h || 110,
          groupTitle: s.props?.groupTitle,
        });
      }
    } else if (s.type === 'task-group') {
      const groupTitle = s.props?.title;
      if (groupTitle) {
        groups.push({
          groupTitle,
          x: s.x,
          y: s.y,
          width: s.props?.w || 360,
          height: s.props?.h || 200,
        });
      }
    }
  }

  return { tasks, groups };
}

export interface SanityWorkspaceDocument {
  _id: string;
  _type: 'workspace';
  workspaceId: string;
  name: string;
  githubRepo: {
    owner: string;
    repo: string;
    fullName: string;
    url: string;
    defaultBranch: string;
    isPrivate?: boolean;
    description?: string;
  };
  activeBranchName: string;
  branches: Array<{
    name: string;
    isProtected?: boolean;
    activeDocumentId?: string;
    lastCommit?: {
      hash: string;
      message: string;
      author: string;
      timestamp: string;
    };
    taskDocuments: Array<{
      id: string;
      name: string;
      folder: string;
      path: string;
      content: string;
      lastSavedContent?: string;
      updatedAt?: string;
    }>;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Saves a single workspace document to Sanity with local fallback cache.
 */
export async function saveWorkspaceToSanity(
  workspace: any,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; message: string; document?: any }> {
  const config = { ...getSanityConfig(), ...configOverride };
  const rawId = workspace.workspaceId || workspace.id || 'ws_' + Date.now();
  const cleanId = String(rawId).replace(/^workspace-/, '');
  const docId = `workspace-${cleanId}`;
  const now = new Date().toISOString();

  const docData: SanityWorkspaceDocument = {
    _id: docId,
    _type: 'workspace',
    workspaceId: cleanId,
    name: workspace.name || 'Workspace',
    githubRepo: {
      owner: workspace.githubRepo?.owner || 'owner',
      repo: workspace.githubRepo?.repo || 'repo',
      fullName: workspace.githubRepo?.fullName || `${workspace.githubRepo?.owner || 'owner'}/${workspace.githubRepo?.repo || 'repo'}`,
      url: workspace.githubRepo?.url || `https://github.com/${workspace.githubRepo?.fullName || 'repo'}`,
      defaultBranch: workspace.githubRepo?.defaultBranch || 'main',
      isPrivate: Boolean(workspace.githubRepo?.isPrivate),
      description: workspace.githubRepo?.description || '',
    },
    activeBranchName: workspace.activeBranchName || 'main',
    branches: (workspace.branches || []).map((b: any) => ({
      name: b.name || 'main',
      isProtected: Boolean(b.isProtected),
      activeDocumentId: b.activeDocumentId,
      lastCommit: b.lastCommit
        ? {
            hash: b.lastCommit.hash,
            message: b.lastCommit.message,
            author: b.lastCommit.author,
            timestamp: b.lastCommit.timestamp,
          }
        : undefined,
      taskDocuments: (b.taskDocuments || []).map((doc: any) => ({
        id: doc.id || `doc_${Date.now()}`,
        name: doc.name || 'TASKS.md',
        folder: doc.folder || '',
        path: doc.path || (doc.folder ? `${doc.folder}/${doc.name}` : doc.name || 'TASKS.md'),
        content: doc.content || '',
        lastSavedContent: doc.lastSavedContent || doc.content || '',
        updatedAt: doc.updatedAt || now,
      })),
    })),
    createdAt: workspace.createdAt || now,
    updatedAt: now,
  };

  // Cache locally
  try {
    localStorage.setItem(`antask_sanity_workspace_${cleanId}`, JSON.stringify(docData));
    localStorage.setItem(`antask_sanity_workspace_${workspace.id}`, JSON.stringify(docData));
  } catch (e) {
    // ignore
  }

  if (!config.projectId || !config.dataset || !config.token) {
    return {
      ok: true,
      message: 'Workspace guardado en caché local (agrega API Token para persistir en Sanity)',
      document: docData,
    };
  }

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token,
      useCdn: false,
    });

    const result = await client.createOrReplace(docData as any);
    return {
      ok: true,
      message: `Workspace "${workspace.name}" sincronizado con éxito en Sanity (${config.dataset})`,
      document: result,
    };
  } catch (err: any) {
    console.warn('Error saving workspace to Sanity:', err);
    return {
      ok: false,
      message: err?.message || 'Error al persistir workspace en Sanity',
    };
  }
}

/**
 * Loads all workspaces from Sanity dataset.
 */
export async function loadWorkspacesFromSanity(
  configOverride?: Partial<SanityConfig>
): Promise<any[]> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return [];
  }

  try {
    const client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token || undefined,
      useCdn: false,
    });

    const query = `*[_type == "workspace" || _id match "workspace*"] | order(_updatedAt desc)`;
    const results = await client.fetch<SanityWorkspaceDocument[]>(query);
    if (!Array.isArray(results)) {
      logSanityTrace('Consulta de workspaces ejecutada, 0 documentos encontrados');
      return [];
    }

    logSanityTrace(`Cargados ${results.length} workspace(s) desde Sanity (${config.dataset})`);

    return results.map((doc: any) => {
      const rawBranches = Array.isArray(doc.branches) && doc.branches.length > 0
        ? doc.branches
        : [{ name: 'main', isProtected: true, taskDocuments: [] }];

      const branches = rawBranches.map((b: any) => {
        const rawDocs = Array.isArray(b.taskDocuments) ? b.taskDocuments : [];
        const taskDocuments = rawDocs.length > 0
          ? rawDocs.map((d: any) => ({
              id: d.id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: d.name || 'TASKS.md',
              folder: d.folder || '',
              path: d.path || (d.folder ? `${d.folder}/${d.name || 'TASKS.md'}` : d.name || 'TASKS.md'),
              content: typeof d.content === 'string' ? d.content : '',
              lastSavedContent: typeof d.lastSavedContent === 'string' ? d.lastSavedContent : (d.content || ''),
              updatedAt: d.updatedAt || doc._updatedAt || new Date().toISOString(),
            }))
          : [
              {
                id: `doc_${b.name || 'main'}_root`,
                name: 'TASKS.md',
                folder: '',
                path: 'TASKS.md',
                content: '# Tareas\n\n## General\n- [ ] Tarea inicial\n  id: task_init\n  priority: P1\n',
                lastSavedContent: '# Tareas\n\n## General\n- [ ] Tarea inicial\n  id: task_init\n  priority: P1\n',
                updatedAt: new Date().toISOString(),
              },
            ];

        return {
          name: b.name || 'main',
          isProtected: Boolean(b.isProtected),
          activeDocumentId: b.activeDocumentId || taskDocuments[0].id,
          lastCommit: b.lastCommit,
          taskDocuments,
        };
      });

      return {
        id: doc.workspaceId || doc._id?.replace(/^workspace-/, '') || doc._id,
        name: doc.name || doc.title || 'Workspace',
        githubRepo: {
          owner: doc.githubRepo?.owner || 'usuario',
          repo: doc.githubRepo?.repo || 'proyecto',
          fullName: doc.githubRepo?.fullName || `${doc.githubRepo?.owner || 'usuario'}/${doc.githubRepo?.repo || 'proyecto'}`,
          url: doc.githubRepo?.url || `https://github.com/${doc.githubRepo?.fullName || 'proyecto'}`,
          defaultBranch: doc.githubRepo?.defaultBranch || 'main',
          isPrivate: Boolean(doc.githubRepo?.isPrivate),
          description: doc.githubRepo?.description || '',
        },
        activeBranchName: doc.activeBranchName || branches[0]?.name || 'main',
        branches,
        createdAt: doc.createdAt || doc._createdAt || new Date().toISOString(),
        updatedAt: doc.updatedAt || doc._updatedAt || new Date().toISOString(),
      };
    });
  } catch (err) {
    logSanityWarn('Error al cargar workspaces desde Sanity:', err);
    return [];
  }
}

/**
 * Synchronizes a list of workspaces in batch to Sanity.
 */
export async function syncAllWorkspacesToSanity(
  workspaces: any[],
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; syncedCount: number; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return { ok: false, syncedCount: 0, message: 'Falta configuración de Sanity (Project ID y Dataset)' };
  }

  if (!config.token) {
    return {
      ok: false,
      syncedCount: 0,
      message: 'Se requiere API Token con rol Editor para sincronizar workspaces en Sanity',
    };
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token,
    useCdn: false,
  });

  try {
    const now = new Date().toISOString();
    const BATCH_SIZE = 25;

    for (let i = 0; i < workspaces.length; i += BATCH_SIZE) {
      const chunk = workspaces.slice(i, i + BATCH_SIZE);
      let tx = client.transaction();

      for (const ws of chunk) {
        const cleanId = sanitizeSanityDocId(String(ws.id).replace(/^workspace-/, ''));
        const docId = `workspace-${cleanId}`;
        const docData: SanityWorkspaceDocument = {
          _id: docId,
          _type: 'workspace',
          workspaceId: cleanId,
          name: ws.name,
          githubRepo: {
            owner: ws.githubRepo?.owner || 'owner',
            repo: ws.githubRepo?.repo || 'repo',
            fullName: ws.githubRepo?.fullName || `${ws.githubRepo?.owner || 'owner'}/${ws.githubRepo?.repo || 'repo'}`,
            url: ws.githubRepo?.url || `https://github.com/${ws.githubRepo?.fullName || 'repo'}`,
            defaultBranch: ws.githubRepo?.defaultBranch || 'main',
            isPrivate: Boolean(ws.githubRepo?.isPrivate),
            description: ws.githubRepo?.description || '',
          },
          activeBranchName: ws.activeBranchName || 'main',
          branches: (ws.branches || []).map((b: any) => ({
            name: b.name,
            isProtected: Boolean(b.isProtected),
            activeDocumentId: b.activeDocumentId,
            lastCommit: b.lastCommit,
            taskDocuments: (b.taskDocuments || []).map((d: any) => ({
              id: d.id,
              name: d.name,
              folder: d.folder || '',
              path: d.path,
              content: d.content || '',
              lastSavedContent: d.lastSavedContent || d.content || '',
              updatedAt: d.updatedAt || now,
            })),
          })),
          createdAt: ws.createdAt || now,
          updatedAt: now,
        };

        tx = tx.createOrReplace(docData as any);
      }

      await tx.commit();
    }

    return {
      ok: true,
      syncedCount: workspaces.length,
      message: `${workspaces.length} workspace(s) sincronizado(s) con éxito en Sanity (${config.dataset})`,
    };
  } catch (err: any) {
    console.warn('Error syncing workspaces to Sanity:', err);
    return {
      ok: false,
      syncedCount: 0,
      message: err?.message || 'Error al sincronizar workspaces con Sanity',
    };
  }
}

/**
 * Deletes a workspace document from Sanity.
 */
export async function deleteWorkspaceFromSanity(
  workspaceId: string,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; message: string }> {
  const cleanId = sanitizeSanityDocId(String(workspaceId).replace(/^workspace-/, ''));
  const docId = `workspace-${cleanId}`;
  return deleteDocumentFromSanity(docId, configOverride);
}

