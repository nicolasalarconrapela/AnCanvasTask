import { createClient } from '@sanity/client';
import { scanTaskBlocks, addTaskToMarkdown } from '../utils/markdownSync';
import { extractVisualStateFromExcalidrawElements } from '../excalidraw/excalidrawManager';

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

// Builds collision-free, workspace-scoped Sanity document ID for tasks (INV-01, INV-06)
export function buildSanityTaskDocId(taskId: string, workspaceId?: string): string {
  const safeId = sanitizeSanityDocId(taskId);
  if (!workspaceId) return `task-${safeId}`;
  const cleanWs = sanitizeSanityDocId(String(workspaceId).replace(/^workspace-/, ''));
  return `task-${cleanWs}-${safeId}`;
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

const envObj = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};

const DEFAULT_SANITY_CONFIG: SanityConfig = {
  projectId: envObj.VITE_SANITY_PROJECT_ID || '',
  dataset: envObj.VITE_SANITY_DATASET || 'production',
  apiVersion: '2024-03-01',
  token: envObj.VITE_SANITY_API_TOKEN || '',
  useCdn: false,
};

export function getSanityConfig(): SanityConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY_SANITY_CONFIG);
      if (stored) {
        return { ...DEFAULT_SANITY_CONFIG, ...JSON.parse(stored) };
      }
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

// -------------------------------------------------------------
// LOCAL MULTI-PROFILE STORAGE (Alias, Project ID, Dataset, Token)
// Strictly client-side local storage with security isolation
// -------------------------------------------------------------

export interface SanityLocalProfile {
  id: string;
  alias: string;
  projectId: string;
  dataset: string;
  token?: string;
  apiVersion?: string;
  useCdn?: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

const LOCAL_STORAGE_KEY_SANITY_PROFILES = 'antask_sanity_saved_profiles_v1';
const LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID = 'antask_sanity_active_profile_id';

export function getSavedSanityProfiles(): SanityLocalProfile[] {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY_SANITY_PROFILES);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Could not read saved Sanity profiles', e);
  }
  return [];
}

export function saveSanityProfile(profile: {
  id?: string;
  alias: string;
  projectId: string;
  dataset: string;
  token?: string;
  apiVersion?: string;
  useCdn?: boolean;
}): SanityLocalProfile {
  const profiles = getSavedSanityProfiles();
  const now = new Date().toISOString();
  const profileId = profile.id || `prof_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const cleanProfile: SanityLocalProfile = {
    id: profileId,
    alias: profile.alias.trim() || `Proyecto (${profile.projectId})`,
    projectId: profile.projectId.trim(),
    dataset: profile.dataset.trim() || 'production',
    token: profile.token?.trim() || '',
    apiVersion: profile.apiVersion || '2024-03-01',
    useCdn: profile.useCdn ?? false,
    createdAt: profiles.find((p) => p.id === profileId)?.createdAt || now,
    lastUsedAt: now,
  };

  const existingIndex = profiles.findIndex((p) => p.id === profileId);
  let updatedProfiles: SanityLocalProfile[];

  if (existingIndex >= 0) {
    updatedProfiles = [...profiles];
    updatedProfiles[existingIndex] = cleanProfile;
  } else {
    updatedProfiles = [...profiles, cleanProfile];
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_PROFILES, JSON.stringify(updatedProfiles));
    localStorage.setItem(LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID, profileId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antask_sanity_profiles_updated', { detail: updatedProfiles }));
    }
  } catch (e) {
    console.warn('Could not save Sanity profile', e);
  }

  return cleanProfile;
}

export function deleteSanityProfile(profileId: string): void {
  try {
    const profiles = getSavedSanityProfiles();
    const updatedProfiles = profiles.filter((p) => p.id !== profileId);
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_PROFILES, JSON.stringify(updatedProfiles));

    if (getActiveSanityProfileId() === profileId) {
      localStorage.removeItem(LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antask_sanity_profiles_updated', { detail: updatedProfiles }));
    }
  } catch (e) {
    console.warn('Could not delete Sanity profile', e);
  }
}

export function getActiveSanityProfileId(): string | null {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID);
  } catch {
    return null;
  }
}

export function activateSanityProfile(profileId: string): SanityConfig | null {
  const profiles = getSavedSanityProfiles();
  const target = profiles.find((p) => p.id === profileId);
  if (!target) return null;

  target.lastUsedAt = new Date().toISOString();
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_PROFILES, JSON.stringify(profiles));
    localStorage.setItem(LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID, profileId);
  } catch {}

  const applied = saveSanityConfig({
    projectId: target.projectId,
    dataset: target.dataset,
    token: target.token || '',
    apiVersion: target.apiVersion || '2024-03-01',
    useCdn: target.useCdn ?? false,
  });

  return applied;
}

export function duplicateSanityProfile(profileId: string): SanityLocalProfile | null {
  const profiles = getSavedSanityProfiles();
  const source = profiles.find((p) => p.id === profileId);
  if (!source) return null;

  return saveSanityProfile({
    alias: `${source.alias} (Copia)`,
    projectId: source.projectId,
    dataset: source.dataset,
    token: source.token,
    apiVersion: source.apiVersion,
    useCdn: source.useCdn,
  });
}

export function exportSanityProfilesJson(includeTokens = true): string {
  const profiles = getSavedSanityProfiles();
  const clean = profiles.map((p) => ({
    ...p,
    token: includeTokens ? p.token : '',
  }));
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), profiles: clean }, null, 2);
}

export function importSanityProfilesJson(jsonStr: string): { importedCount: number; message: string } {
  try {
    const data = JSON.parse(jsonStr);
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [];
    if (list.length === 0) {
      return { importedCount: 0, message: 'No se encontraron perfiles válidos en el archivo JSON.' };
    }

    let count = 0;
    list.forEach((item) => {
      if (item && typeof item.projectId === 'string' && item.projectId.trim()) {
        saveSanityProfile({
          alias: item.alias || `Proyecto (${item.projectId})`,
          projectId: item.projectId,
          dataset: item.dataset || 'production',
          token: item.token || '',
          apiVersion: item.apiVersion || '2024-03-01',
          useCdn: item.useCdn,
        });
        count++;
      }
    });

    return { importedCount: count, message: `Se importaron ${count} perfiles correctamente.` };
  } catch (e: any) {
    return { importedCount: 0, message: `Error al parsear el JSON: ${e?.message || String(e)}` };
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

export interface SanityUserProjectInfo {
  id: string;
  displayName: string;
  organizationId?: string;
}

export interface SanityAccountStatus {
  user: SanityUserProfile | null;
  authType: SanityAuthType;
  configuredProjectId: string;
  configuredDataset: string;
  isConfigured: boolean;
  isProjectMismatch: boolean;
  projectDisplayName?: string;
  userProjects: SanityUserProjectInfo[];
  mismatchReason?: string;
}

export async function fetchSanityUserProjects(token?: string): Promise<SanityUserProjectInfo[]> {
  const t = token?.trim() || getSanityConfig().token?.trim();
  
  // 1. If token is provided, fetch with Bearer token
  if (t) {
    try {
      const res = await fetch('https://api.sanity.io/v2021-06-07/projects', {
        headers: {
          Authorization: `Bearer ${t}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : [];
        if (list.length > 0) {
          return list.map((p: any) => ({
            id: p.id || p._id,
            displayName: p.displayName || p.name || p.title || p.id,
            organizationId: p.organizationId,
          }));
        }
      }
    } catch (err) {
      console.warn('Could not fetch user projects with token:', err);
    }
  }

  // 2. Try fetching with browser cookies / studio session
  try {
    const res = await fetch('https://api.sanity.io/v2021-06-07/projects', {
      credentials: 'include',
    });

    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : [];
      if (list.length > 0) {
        return list.map((p: any) => ({
          id: p.id || p._id,
          displayName: p.displayName || p.name || p.title || p.id,
          organizationId: p.organizationId,
        }));
      }
    }
  } catch {}

  return [];
}

/**
 * Detects if the user has authenticated in Sanity Studio or sanity.io via session cookies or localStorage.
 */
export async function detectSanityStudioSession(): Promise<{
  loggedIn: boolean;
  user?: SanityUserProfile;
  projects?: SanityUserProjectInfo[];
  token?: string;
}> {
  // 1. Try with session credentials from Sanity Studio / sanity.io
  try {
    const res = await fetch('https://api.sanity.io/v2021-06-07/users/me', {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.id || data.email || data.name)) {
        const user: SanityUserProfile = {
          id: data.id || 'user',
          name: data.name || data.displayName || 'Usuario Sanity',
          email: data.email || '',
          profileImage: data.profileImage || data.imageUrl || '',
          role: data.role || 'Editor',
          authType: 'user_token',
        };
        const projects = await fetchSanityUserProjects();
        return { loggedIn: true, user, projects };
      }
    }
  } catch {}

  // 2. Scan localStorage for Sanity Studio auth tokens
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('__sanity_auth') || key.includes('sanitySession') || key.startsWith('sanity.auth.'))) {
          const val = localStorage.getItem(key);
          if (val) {
            try {
              const parsed = JSON.parse(val);
              const extractedToken =
                parsed.token || parsed.sessionToken || parsed.accessToken || (typeof parsed === 'string' ? parsed : null);
              if (extractedToken && typeof extractedToken === 'string' && extractedToken.length > 20) {
                const profile = await fetchSanityCurrentUser({
                  projectId: 'temp',
                  dataset: 'production',
                  apiVersion: '2024-03-01',
                  token: extractedToken,
                  useCdn: false,
                });
                const projects = await fetchSanityUserProjects(extractedToken);
                if (profile && profile.name) {
                  return { loggedIn: true, user: profile, projects, token: extractedToken };
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch {}

  return { loggedIn: false };
}

export async function checkSanityAccountStatus(configOverride?: SanityConfig): Promise<SanityAccountStatus> {
  const config = configOverride || getSanityConfig();
  const user = await fetchSanityCurrentUser(config);
  const authType = determineSanityAuthType(config, user);
  const configuredProjectId = config.projectId?.trim() || '';
  const configuredDataset = config.dataset?.trim() || '';
  const isConfigured = Boolean(configuredProjectId && configuredDataset);

  let userProjects: SanityUserProjectInfo[] = [];
  let isProjectMismatch = false;
  let projectDisplayName: string | undefined = undefined;
  let mismatchReason: string | undefined = undefined;

  if (config.token && isConfigured) {
    userProjects = await fetchSanityUserProjects(config.token);

    if (userProjects.length > 0) {
      const matchedProject = userProjects.find((p) => p.id === configuredProjectId);
      if (matchedProject) {
        projectDisplayName = matchedProject.displayName;
      } else {
        isProjectMismatch = true;
        mismatchReason = `Has iniciado sesión como "${user?.name || user?.email || 'Usuario'}", pero el Project ID configurado ("${configuredProjectId}") pertenece a otro usuario o no figura entre tus proyectos.`;
      }
    }
  }

  return {
    user,
    authType,
    configuredProjectId,
    configuredDataset,
    isConfigured,
    isProjectMismatch,
    projectDisplayName,
    userProjects,
    mismatchReason,
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
  const cleanId = sanitizeSanityDocId(projectId.replace(/^canvasVisualState-/, ''));
  const docId = `canvasVisualState-${cleanId}`;
  const docData: CanvasVisualDocument = {
    _id: docId,
    _type: 'canvasVisualState',
    projectId: cleanId,
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

  // 1. Always save to local visual cache (both under cleanId and default)
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_KEY_VISUAL_STATE}_${cleanId}`,
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
      await client.createIfNotExists(docData as any);
      await client
        .patch(docId)
        .set({
          tasks: docData.tasks,
          groups: docData.groups,
          updatedAt: docData.updatedAt,
          projectId: cleanId,
        })
        .commit();
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
  configOverride?: Partial<SanityConfig>,
  workspaceId?: string
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
    const cleanWs = workspaceId ? sanitizeSanityDocId(String(workspaceId).replace(/^workspace-/, '')) : '';
    const BATCH_SIZE = 50;

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const chunk = tasks.slice(i, i + BATCH_SIZE);
      let tx = client.transaction();

      for (const t of chunk) {
        const docId = buildSanityTaskDocId(t.id, cleanWs);
        const initialDoc: SanityTestingTaskDocument = {
          _id: docId,
          _type: 'task',
          taskId: t.id,
          workspaceId: cleanWs || undefined,
          workspace: cleanWs ? ({ _type: 'reference', _ref: `workspace-${cleanWs}` } as any) : undefined,
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

        // Surgical, non-destructive mutation: createIfNotExists then set fields
        tx = tx.createIfNotExists(initialDoc as any).patch(docId, (patch) =>
          patch.set({
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
            ...(t.description !== undefined ? { description: t.description } : {}),
            updatedAt: now,
            ...(cleanWs
              ? {
                  workspaceId: cleanWs,
                  workspace: { _type: 'reference', _ref: `workspace-${cleanWs}` },
                }
              : {}),
          })
        );
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

    const docId = doc._id;
    const docToSave = {
      ...doc,
      updatedAt: new Date().toISOString(),
    };
    if (docId) {
      await client.createIfNotExists(docToSave as any);
      const patch = client.patch(docId);
      if (doc._rev) {
        patch.ifRevisionId(doc._rev);
      }
      const { _id, _type, _rev, _createdAt, _updatedAt, ...fieldsToSet } = docToSave;
      const result = await patch.set(fieldsToSet).commit();
      return { ok: true, document: result, message: 'Documento publicado con éxito en Sanity' };
    } else {
      const result = await client.create(docToSave);
      return { ok: true, document: result, message: 'Documento creado con éxito en Sanity' };
    }
  } catch (err: any) {
    const isConflict =
      err?.statusCode === 409 ||
      err?.response?.statusCode === 409 ||
      err?.message?.includes('409') ||
      err?.message?.includes('revision');
    return {
      ok: false,
      message: isConflict
        ? 'Conflicto de concurrencia (409): El documento fue modificado en Sanity por otro usuario. Recarga la revisión más reciente.'
        : err?.message || 'Error al guardar documento en Sanity',
    };
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
 * Extracts current visual positions and dimensions of all task cards and groups from Excalidraw canvas or elements.
 */
export function extractVisualStateFromEditor(canvasOrElements: any): {
  tasks: TaskVisualState[];
  groups: GroupVisualState[];
} {
  if (!canvasOrElements) {
    return { tasks: [], groups: [] };
  }

  // Array of Excalidraw elements
  if (Array.isArray(canvasOrElements)) {
    return extractVisualStateFromExcalidrawElements(canvasOrElements);
  }

  // Excalidraw Imperative API
  if (typeof canvasOrElements.getSceneElements === 'function') {
    return extractVisualStateFromExcalidrawElements(canvasOrElements.getSceneElements());
  }

  // Fallback for legacy shape API
  if (typeof canvasOrElements.getCurrentPageShapes === 'function') {
    const shapes = canvasOrElements.getCurrentPageShapes();
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

  return { tasks: [], groups: [] };
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
  const cleanId = sanitizeSanityDocId(String(rawId).replace(/^workspace-/, ''));
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

    await client.createIfNotExists(docData as any);
    const patch = client.patch(docId);
    if (workspace._rev) {
      patch.ifRevisionId(workspace._rev);
    }
    const result = await patch
      .set({
        name: docData.name,
        githubRepo: docData.githubRepo,
        activeBranchName: docData.activeBranchName,
        branches: docData.branches,
        updatedAt: docData.updatedAt,
      })
      .commit();

    // Also synchronize all child task documents to Sanity to keep both representations unified
    try {
      const allTasks: any[] = [];
      for (const branch of docData.branches || []) {
        for (const doc of branch.taskDocuments || []) {
          const { taskBlocks } = scanTaskBlocks(doc.content || '');
          for (const b of taskBlocks) {
            const rawId = b.detectedId || b.temporaryId || `task_${Date.now()}`;
            const cleanTaskId = sanitizeSanityDocId(rawId);
            const isCompleted = b.rawTaskLine.includes('[x]') || b.rawTaskLine.includes('[X]') || b.detectedStatus === 'done';
            allTasks.push({
              _id: `task-${cleanTaskId}`,
              _type: 'task',
              taskId: rawId,
              workspaceId: cleanId,
              workspaceName: docData.name,
              branchName: branch.name,
              documentPath: doc.path,
              title: b.detectedTitle || 'Tarea',
              completed: isCompleted,
              status: b.detectedStatus || (isCompleted ? 'done' : 'todo'),
              priority: b.detectedPriority || 'P1',
              groupTitle: b.groupTitle || 'General',
              tags: b.detectedTags || [],
              blockedBy: b.detectedBlockedBy || '',
              updatedAt: now,
            });
          }
        }
      }

      if (allTasks.length > 0) {
        const BATCH = 25;
        for (let i = 0; i < allTasks.length; i += BATCH) {
          let taskTx = client.transaction();
          for (const t of allTasks.slice(i, i + BATCH)) {
            taskTx = taskTx.createOrReplace(t);
          }
          await taskTx.commit();
        }
      }
    } catch (taskSyncErr) {
      console.warn('Error synchronizing child task documents to Sanity:', taskSyncErr);
    }

    return {
      ok: true,
      message: `Workspace "${workspace.name}" sincronizado con éxito en Sanity (${config.dataset})`,
      document: result,
    };
  } catch (err: any) {
    const isConflict =
      err?.statusCode === 409 ||
      err?.response?.statusCode === 409 ||
      err?.message?.includes('409') ||
      err?.message?.includes('revision');
    console.warn('Error saving workspace to Sanity:', err);
    return {
      ok: false,
      message: isConflict
        ? `Conflicto de concurrencia (409): El workspace "${workspace.name}" fue modificado simultáneamente por otro usuario.`
        : err?.message || 'Error al persistir workspace en Sanity',
    };
  }
}

/**
 * Normalizes a Sanity workspace document into application Workspace model.
 */
export function normalizeSanityWorkspaceDoc(doc: any): any {
  if (!doc) return null;
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
      activeDocumentId: b.activeDocumentId || taskDocuments[0]?.id || `doc_${Date.now()}`,
      lastCommit: b.lastCommit,
      taskDocuments,
    };
  });

  const rawId = doc.workspaceId || doc._id?.replace(/^workspace-/, '') || doc._id || `ws_${Date.now()}`;
  const cleanId = sanitizeSanityDocId(String(rawId).replace(/^workspace-/, ''));

  return {
    _id: doc._id,
    id: cleanId,
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
}

/**
 * Loads all workspaces from Sanity dataset and hydrates them with any orphan or updated tasks.
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

    const [results, rawTasks] = await Promise.all([
      client.fetch<SanityWorkspaceDocument[]>(
        `*[_type == "workspace" || _id match "workspace*"] | order(_updatedAt desc)`
      ),
      client.fetch<any[]>(
        `*[_type == "task"] | order(_updatedAt desc)`
      ).catch(() => []),
    ]);

    if (!Array.isArray(results)) {
      logSanityTrace('Consulta de workspaces ejecutada, 0 documentos encontrados');
      return [];
    }

    const normalizedWorkspaces = results
      .map((doc: any) => normalizeSanityWorkspaceDoc(doc))
      .filter((w): w is NonNullable<typeof w> => Boolean(w));

    // Reconcile and hydrate tasks from remote task documents into workspace markdown
    if (Array.isArray(rawTasks) && rawTasks.length > 0) {
      for (const ws of normalizedWorkspaces) {
        const cleanWsId = sanitizeSanityDocId(String(ws.id).replace(/^workspace-/, ''));
        const wsTasks = rawTasks.filter((t: any) => {
          const tWsId = t.workspaceId ? sanitizeSanityDocId(String(t.workspaceId).replace(/^workspace-/, '')) : '';
          return (
            tWsId === cleanWsId ||
            tWsId === ws.id ||
            `ws_${tWsId}` === ws.id ||
            tWsId === `ws_${cleanWsId}` ||
            (t.workspaceName && ws.name && t.workspaceName.trim().toLowerCase() === ws.name.trim().toLowerCase())
          );
        });

        if (wsTasks.length > 0 && ws.branches && ws.branches.length > 0) {
          const activeBranch = ws.branches.find((b: any) => b.name === ws.activeBranchName) || ws.branches[0];
          const activeDoc = activeBranch.taskDocuments?.[0];
          if (activeDoc) {
            let currentMd = activeDoc.content || '';
            const { taskBlocks } = scanTaskBlocks(currentMd);
            const existingIds = new Set(
              taskBlocks
                .map((b) => (b.detectedId || b.temporaryId || '').toLowerCase())
                .filter(Boolean)
            );
            const existingTitles = new Set(
              taskBlocks
                .map((b) => (b.detectedTitle || '').trim().toLowerCase())
                .filter(Boolean)
            );

            let modified = false;
            for (const rt of wsTasks) {
              const rTaskId = (rt.taskId || rt._id?.replace(/^task-/, '') || '').toLowerCase();
              const rTitle = (rt.title || '').trim().toLowerCase();
              if (!existingIds.has(rTaskId) && (!rTitle || !existingTitles.has(rTitle))) {
                const addRes = addTaskToMarkdown(currentMd, {
                  title: rt.title || 'Nueva tarea',
                  priority: rt.priority || 'P1',
                  groupTitle: rt.groupTitle || 'General',
                  customId: rt.taskId || rt._id?.replace(/^task-/, ''),
                  blockedBy: rt.blockedBy,
                  tags: rt.tags,
                });
                currentMd = addRes.updatedMarkdown;
                existingIds.add(rTaskId);
                if (rTitle) existingTitles.add(rTitle);
                modified = true;
              }
            }

            if (modified) {
              activeDoc.content = currentMd;
              activeDoc.lastSavedContent = currentMd;
            }
          }
        }
      }
    }

    logSanityTrace(`Cargados ${normalizedWorkspaces.length} workspace(s) desde Sanity (${config.dataset})`);
    return normalizedWorkspaces;
  } catch (err) {
    logSanityWarn('Error al cargar workspaces desde Sanity:', err);
    return [];
  }
}

/**
 * Synchronizes a list of workspaces in batch to Sanity and all child tasks.
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
    const allTasksToSync: any[] = [];

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
            taskDocuments: (b.taskDocuments || []).map((d: any) => {
              // Extract tasks for syncing
              const { taskBlocks } = scanTaskBlocks(d.content || '');
              for (const taskBlock of taskBlocks) {
                const rawId = taskBlock.detectedId || taskBlock.temporaryId || `task_${Date.now()}`;
                const cleanTaskId = sanitizeSanityDocId(rawId);
                const isCompleted = taskBlock.rawTaskLine.includes('[x]') || taskBlock.rawTaskLine.includes('[X]') || taskBlock.detectedStatus === 'done';
                allTasksToSync.push({
                  _id: `task-${cleanTaskId}`,
                  _type: 'task',
                  taskId: rawId,
                  workspaceId: cleanId,
                  workspaceName: ws.name,
                  branchName: b.name,
                  documentPath: d.path,
                  title: taskBlock.detectedTitle || 'Tarea',
                  completed: isCompleted,
                  status: taskBlock.detectedStatus || (isCompleted ? 'done' : 'todo'),
                  priority: taskBlock.detectedPriority || 'P1',
                  groupTitle: taskBlock.groupTitle || 'General',
                  tags: taskBlock.detectedTags || [],
                  blockedBy: taskBlock.detectedBlockedBy || '',
                  updatedAt: now,
                });
              }

              return {
                id: d.id,
                name: d.name,
                folder: d.folder || '',
                path: d.path,
                content: d.content || '',
                lastSavedContent: d.lastSavedContent || d.content || '',
                updatedAt: d.updatedAt || now,
              };
            }),
          })),
          createdAt: ws.createdAt || now,
          updatedAt: now,
        };

        tx = tx.createOrReplace(docData as any);
      }

      await tx.commit();
    }

    // Sync all extracted tasks in batches
    if (allTasksToSync.length > 0) {
      for (let i = 0; i < allTasksToSync.length; i += BATCH_SIZE) {
        let taskTx = client.transaction();
        for (const t of allTasksToSync.slice(i, i + BATCH_SIZE)) {
          taskTx = taskTx.createOrReplace(t);
        }
        await taskTx.commit();
      }
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
 * Deletes any single document from Sanity Content Lake by its exact or partial _id.
 */
export async function deleteDocumentFromSanity(
  docId: string,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return { ok: false, message: 'Falta configuración de Sanity (Project ID y Dataset)' };
  }
  if (!config.token) {
    return { ok: false, message: 'Se requiere API Token con rol Editor para eliminar en Sanity' };
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token,
    useCdn: false,
  });

  try {
    await client.delete(docId);
    logSanityTrace(`Documento "${docId}" eliminado con éxito de Sanity`);
    return { ok: true, message: `Documento "${docId}" eliminado de Sanity Cloud` };
  } catch (err: any) {
    logSanityWarn(`Error al eliminar documento "${docId}" de Sanity:`, err);
    return { ok: false, message: err?.message || `Error al eliminar documento "${docId}" de Sanity` };
  }
}

/**
 * Deletes a workspace document and its associated tasks from Sanity.
 */
export async function deleteWorkspaceFromSanity(
  workspaceId: string,
  configOverride?: Partial<SanityConfig>
): Promise<{ ok: boolean; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset || !config.token) {
    return { ok: false, message: 'Se requiere API Token para eliminar en Sanity' };
  }

  const cleanId = sanitizeSanityDocId(String(workspaceId).replace(/^workspace-/, ''));
  const docId = `workspace-${cleanId}`;

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion || '2024-03-01',
    token: config.token,
    useCdn: false,
  });

  try {
    // 1. Delete workspace document using all identifier variants
    const targets = Array.from(new Set([docId, workspaceId, `ws_${cleanId}`, cleanId].filter(Boolean)));
    await Promise.allSettled(targets.map((t) => client.delete(t)));

    // 2. Also delete any orphan child tasks linked to this workspace
    try {
      const taskQuery = `*[_type == "task" && (workspaceId == $cleanId || workspaceId == $wsId || workspaceId == $docId)]._id`;
      const taskIds = await client.fetch<string[]>(taskQuery, { cleanId, wsId: workspaceId, docId });
      if (Array.isArray(taskIds) && taskIds.length > 0) {
        let tx = client.transaction();
        for (const tId of taskIds) {
          tx = tx.delete(tId);
        }
        await tx.commit();
      }
    } catch (e) {
      console.warn('Could not batch delete workspace child tasks:', e);
    }

    logSanityTrace(`Workspace "${workspaceId}" eliminado con éxito de Sanity`);
    return { ok: true, message: `Workspace eliminado con éxito de Sanity Cloud` };
  } catch (err: any) {
    logSanityWarn(`Error al eliminar workspace "${workspaceId}" de Sanity:`, err);
    return { ok: false, message: err?.message || 'Error al eliminar workspace de Sanity' };
  }
}

