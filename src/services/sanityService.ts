import { documentSync, buildTaskDocumentId, applyTaskToMarkdown, deletionMarkerId } from './documentSyncService';
import { getSyncSession, assertSyncSession, getStorageScope, invalidateSyncSession } from './syncSessionService';
import { createClient } from '@sanity/client';
import type { Editor } from 'tldraw';
import { scanTaskBlocks } from '../utils/markdownSync';

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
export function buildSanityTaskDocId(taskId: string, workspaceId?: string, documentKey?: string): string {
  return buildTaskDocumentId(taskId, workspaceId, documentKey);
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
      if (stored === 'null') return { ...DEFAULT_SANITY_CONFIG, projectId: '', token: '' };
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
    invalidateSyncSession();
    documentSync.forget();
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

export function saveSanityProfile(
  profile: {
    id?: string;
    alias: string;
    projectId: string;
    dataset: string;
    token?: string;
    apiVersion?: string;
    useCdn?: boolean;
  },
  makeActive?: boolean
): SanityLocalProfile {
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

  const currentActiveId = getActiveSanityProfileId();
  const shouldBeActive = makeActive === true || (makeActive === undefined && (currentActiveId === profileId || !currentActiveId));

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_PROFILES, JSON.stringify(updatedProfiles));
    if (shouldBeActive) {
      localStorage.setItem(LOCAL_STORAGE_KEY_ACTIVE_PROFILE_ID, profileId);
      saveSanityConfig({
        projectId: cleanProfile.projectId,
        dataset: cleanProfile.dataset,
        token: cleanProfile.token || '',
        apiVersion: cleanProfile.apiVersion || '2024-03-01',
        useCdn: cleanProfile.useCdn ?? false,
      });
    }
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
      if (updatedProfiles.length > 0) {
        activateSanityProfile(updatedProfiles[0].id);
      } else {
        clearSanityConfig();
      }
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

  return saveSanityProfile(
    {
      alias: `${source.alias} (Copia)`,
      projectId: source.projectId,
      dataset: source.dataset,
      token: source.token,
      apiVersion: source.apiVersion,
      useCdn: source.useCdn,
    },
    false
  );
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
        saveSanityProfile(
          {
            alias: item.alias || `Proyecto (${item.projectId})`,
            projectId: item.projectId,
            dataset: item.dataset || 'production',
            token: item.token || '',
            apiVersion: item.apiVersion || '2024-03-01',
            useCdn: item.useCdn,
          },
          false
        );
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
    const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY_SANITY_USER}:${getStorageScope()}`);
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
    const res = await fetch(`https://${config.projectId}.api.sanity.io/v2021-06-07/users/me`, {
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
        if (getSanityConfig().token === config.token) localStorage.setItem(`${LOCAL_STORAGE_KEY_SANITY_USER}:${getStorageScope()}`, JSON.stringify(user));
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
        if (getSanityConfig().token === config.token) localStorage.setItem(`${LOCAL_STORAGE_KEY_SANITY_USER}:${getStorageScope()}`, JSON.stringify(robotUser));
      } catch {
        // ignore
      }
      return robotUser;
    }
  } catch (err) {
    console.warn('Could not fetch current Sanity user:', err);
  }


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
    invalidateSyncSession();
    documentSync.forget();
    localStorage.setItem(LOCAL_STORAGE_KEY_SANITY_CONFIG, 'null');
    localStorage.removeItem(LOCAL_STORAGE_KEY_SANITY_USER);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antask_sanity_config_updated', { detail: getSanityConfig() }));
    }
  } catch (e) {
    console.warn('Could not clear Sanity config', e);
  }
  return getSanityConfig();
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
export async function loadCanvasVisualState(projectId: string = 'default'): Promise<CanvasVisualDocument | null> {
  const config = getSanityConfig();
  const session = getSyncSession(config);
  const id = `canvasVisualState-${sanitizeSanityDocId(projectId)}`;
  const key = `${LOCAL_STORAGE_KEY_VISUAL_STATE}:${getStorageScope()}:${projectId}`;
  if (session) {
    try {
      const doc = await fetchSanityDocumentById(id, config);
      if (doc && !doc.syncDeleted) {
        assertSyncSession(session);
        localStorage.setItem(key, JSON.stringify(doc));
        return doc;
      }
      return null;
    } catch (error) {
      assertSyncSession(session);
      console.warn('Estado visual remoto no disponible; utilizando caché de esta sesión', error);
    }
  }
  const cached = localStorage.getItem(key);
  return cached ? JSON.parse(cached) : null;
}

/**
 * Saves visual layout (tasks & groups spatial coordinates) to Sanity.
 * Never saves task content, markdown or priorities - only taskId & geometry.
 */
export async function saveCanvasVisualState(
  state: { tasks: TaskVisualState[]; groups: GroupVisualState[] },
  projectId: string = 'default', configOverride?: SanityConfig
): Promise<{ success: boolean; remote: boolean }> {
  const config = configOverride || getSanityConfig();
  const session = getSyncSession(config);
  if (config.projectId && !session) return { success: false, remote: false };
  const cleanId = sanitizeSanityDocId(projectId.replace(/^canvasVisualState-/, ''));
  const cacheKey = `${LOCAL_STORAGE_KEY_VISUAL_STATE}:${getStorageScope()}:${projectId}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (cached?._rev && session) documentSync.observe(cached, session);
  const doc = { _id: `canvasVisualState-${cleanId}`, _type: 'canvasVisualState', projectId: cleanId,
    tasks: state.tasks, groups: state.groups, ...(cached?._rev ? { _rev: cached._rev } : {}), updatedAt: new Date().toISOString() };
  localStorage.setItem(cacheKey, JSON.stringify(doc));
  if (!config.token) return { success: true, remote: false };
  const result = await saveSanityDocument(doc, config);
  if (result.ok && session) { assertSyncSession(session); localStorage.setItem(cacheKey, JSON.stringify(result.document)); }
  return { success: result.ok, remote: result.ok };
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
  documentKey?: string;
  branchName?: string;
  documentPath?: string;
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
  tasks: Array<{ id: string; title: string; completed: boolean; priority?: string; status?: string;
    groupTitle?: string; blockedBy?: string; tags?: string[]; subtasks?: Array<{ title: string; completed?: boolean }>; description?: string }>,
  configOverride?: Partial<SanityConfig>, workspaceId?: string, documentKey?: string
): Promise<{ ok: boolean; syncedCount: number; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  try {
    const cleanWs = sanitizeSanityDocId(String(workspaceId || '').replace(/^workspace-/, ''));
    for (const t of tasks) {
      const result = await saveSanityDocument({ _id: buildSanityTaskDocId(t.id, cleanWs, documentKey), _type: 'task',
        taskId: t.id, workspaceId: cleanWs, documentKey, title: t.title, completed: t.completed,
        status: t.status || (t.completed ? 'done' : 'todo'), priority: t.priority || 'P1',
        groupTitle: t.groupTitle || 'General', blockedBy: t.blockedBy || '', tags: t.tags || [],
        ...(t.subtasks !== undefined ? { subtasks: t.subtasks } : {}),
        ...(t.description !== undefined ? { description: t.description } : {}) }, config);
      if (!result.ok) throw new Error(result.message);
    }
    return { ok: true, syncedCount: tasks.length, message: `${tasks.length} tareas sincronizadas` };
  } catch (error: any) {
    return { ok: false, syncedCount: 0, message: error.message };
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
    _id: customTask?._id || (customTask?.documentKey ? buildTaskDocumentId(testTaskId, customTask.workspaceId, customTask.documentKey) : testDocId),
    _type: 'task',
    taskId: testTaskId,
    title: customTask?.title || 'Tarea de Prueba - Verificación de Escritura Sanity',
    completed: customTask?.completed ?? false,
    status: customTask?.status || 'in_progress',
    priority: customTask?.priority || 'P0',
    groupTitle: customTask?.groupTitle || 'Autenticación & Nube',
    workspaceId: customTask?.workspaceId,
    documentKey: customTask?.documentKey,
    branchName: customTask?.branchName,
    documentPath: customTask?.documentPath,
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
    const saved = await saveSanityDocument(testDocument, config);
    if (!saved.ok) throw new Error(saved.message);
    const createResult = saved.document;

    // 2. Immediate read verification (Read-After-Write)
    const verifiedDoc = await client.fetch(`*[_id == $id][0]`, { id: testDocument._id });
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
export async function fetchSanityDocumentsList(configOverride?: Partial<SanityConfig>, includeDeleted = false, includeLegacy = false): Promise<any[]> {
  const config = { ...getSanityConfig(), ...configOverride };
  const session = getSyncSession(config);
  if (!session) throw new Error('La sesión de Sanity todavía no está preparada');
  const client = createClient({ ...config, useCdn: false, perspective: 'raw' });
  const docs = await client.fetch<any[]>(`*[(syncOwner == $owner || ($legacy && !defined(syncOwner))) && _type in ["task", "canvasVisualState", "workspace", "syncDeletion"] && !(_id in path("drafts.**"))] | order(_id)`,
    { owner: session.owner, legacy: includeLegacy }, { signal: session.controller.signal });
  assertSyncSession(session);
  const deleted = new Map(docs.filter(d => d._type === 'syncDeletion').map(d => [d.targetId, d.deletedDocument]));
  const visible = docs.filter(d => d._type !== 'syncDeletion').map(d => deleted.has(d._id) ? { ...d, syncDeleted: true } : d);
  for (const [id, tombstone] of deleted) if (!visible.some(d => d._id === id)) visible.push(tombstone);
  visible.forEach(doc => documentSync.observe(doc, session));
  return includeDeleted ? visible : visible.filter(doc => !doc.syncDeleted);
}

/**
 * Updates or creates any document in Sanity.
 */
export async function saveSanityDocument(doc: any, configOverride?: Partial<SanityConfig>): Promise<{ ok: boolean; document?: any; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  try {
    const document = await documentSync.write(doc, config);
    return { ok: true, document, message: 'Documento sincronizado con Sanity' };
  } catch (error: any) {
    return { ok: false, message: error.message };
  }
}

/**
 * Fetches single document by ID from Sanity.
 */
export async function fetchSanityDocumentById(id: string, configOverride?: Partial<SanityConfig>): Promise<any | null> {
  const config = { ...getSanityConfig(), ...configOverride };
  const session = getSyncSession(config);
  if (!session) throw new Error('La sesión de Sanity todavía no está preparada');
  const client = createClient({ ...config, useCdn: false, perspective: 'raw' });
  const marker = await client.fetch('*[_id == $id][0]', { id: deletionMarkerId(id) }, { signal: session.controller.signal });
  assertSyncSession(session);
  if (marker) return null;
  const doc = await client.fetch(`*[_id == $id && syncOwner == $owner][0]`, { id, owner: session.owner }, { signal: session.controller.signal });
  assertSyncSession(session);
  if (doc) documentSync.observe(doc, session);
  return doc?.syncDeleted ? null : doc;
}

export interface SanityLiveChangeEvent {
  type: 'task' | 'workspace' | 'canvasVisualState' | 'other' | 'reconnect' | 'connection_error';
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
  configOverride?: Partial<SanityConfig>,
  clientFactory: (config: SanityConfig) => any = createClient
): () => void {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset) {
    return () => {};
  }

  try {
    const client = clientFactory({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion || '2024-03-01',
      token: config.token || undefined,
      useCdn: false,
    });

    const session = getSyncSession(config);
    if (!session) return () => {};
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { unsubscribe(): void } | undefined;
    const connect = () => {
      if (stopped || getSyncSession(config) !== session) return;
      subscription = client
      .listen(
        `*[syncOwner == $owner && _type in ["task", "workspace", "canvasVisualState", "syncDeletion"]]`,
        { owner: session.owner },
        { includeResult: true, includePreviousRevision: true, visibility: 'query', events: ['welcome', 'mutation', 'reconnect'] }
      )
      .subscribe({
        next: (update: any) => {
          if (!update || getSyncSession(config) !== session) return;
          if (update.type === 'welcome' || update.type === 'reconnect') {
            attempt = 0;
            onMutation({ type: 'reconnect', transition: 'update', documentId: '' });
            return;
          }
          const doc = update.result || update.previous;
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
            transition: doc?.syncDeleted ? 'disappear' : update.transition,
            documentId: update.documentId,
            document: doc,
          });
        },
        error: (err: any) => {
          console.warn('Sanity live subscription warning:', err);
          if (!stopped && getSyncSession(config) === session) {
            onMutation({ type: 'connection_error', transition: 'update', documentId: '' });
            timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 30000));
          }
        },
      });
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      try {
        subscription?.unsubscribe();
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
export async function saveWorkspaceToSanity(workspace: any, configOverride?: Partial<SanityConfig>): Promise<{ ok: boolean; message: string; document?: any }> {
  const config = { ...getSanityConfig(), ...configOverride };
  const id = sanitizeSanityDocId(String(workspace.workspaceId || workspace.id).replace(/^workspace-/, ''));
  const doc = { ...documentSync.base(workspace._id || `workspace-${id}`), _id: workspace._id || `workspace-${id}`, _type: 'workspace', workspaceId: id,
    name: workspace.name, githubRepo: workspace.githubRepo, activeBranchName: workspace.activeBranchName,
    branches: workspace.branches.map((b: any) => ({ ...b, _key: b._key || b.name, taskDocuments: b.taskDocuments.map((d: any) => ({ ...d, _key: d._key || d.id })) })), createdAt: workspace.createdAt, ...(workspace._rev ? { _rev: workspace._rev } : {}) };
  if (!config.projectId || !config.token) return { ok: true, document: doc, message: 'Workspace guardado localmente' };
  return saveSanityDocument(doc, config);
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
          ...d,
          id: d.id || d._key || `doc_${sanitizeSanityDocId(d.path || d.name || 'TASKS.md')}`,
          name: d.name || 'TASKS.md',
          folder: d.folder || '',
          path: d.path || (d.folder ? `${d.folder}/${d.name || 'TASKS.md'}` : d.name || 'TASKS.md'),
          content: typeof d.content === 'string' ? d.content : '',
          lastSavedContent: typeof d.lastSavedContent === 'string' ? d.lastSavedContent : (d.content || ''),
          updatedAt: d.updatedAt || doc._updatedAt || new Date().toISOString(),
          visualState: d.visualState || null,
        }))
      : [
          {
            id: `doc_${b.name || 'main'}_root`,
            name: 'TASKS.md',
            folder: '',
            path: 'TASKS.md',
            content: '# Tareas\n\n## General\n',
            lastSavedContent: '# Tareas\n\n## General\n',
            updatedAt: new Date().toISOString(),
          },
        ];

    return {
      ...b,
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
    _rev: doc._rev,
    syncOwner: doc.syncOwner,
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
export async function loadWorkspacesFromSanity(configOverride?: Partial<SanityConfig>, includeLegacy = false): Promise<any[]> {
  const docs = await fetchSanityDocumentsList(configOverride, true, includeLegacy);
  return workspacesFromSanityDocuments(docs);
}

export function workspacesFromSanityDocuments(docs: any[]): any[] {
  const workspaces = docs.filter(d => d._type === 'workspace' && !d.syncDeleted).map(normalizeSanityWorkspaceDoc);
  for (const ws of workspaces) {
    for (const task of docs.filter(t => t._type === 'task' && (t.workspaceId === ws.id || t.workspace?._ref === ws._id))) {
      const locations = ws.branches.flatMap((branch: any) => branch.taskDocuments.map((doc: any) => ({ branch, doc })));
      let target = locations.find(({ branch, doc }: any) => task.documentKey
        ? `${branch.name}::${doc.id}` === task.documentKey
        : task.branchName && task.documentPath && branch.name === task.branchName && doc.path === task.documentPath);
      if (!task.documentKey && !task.branchName && !task.documentPath) {
        const matches = locations.filter(({ doc }: any) => scanTaskBlocks(doc.content).taskBlocks.some(b => b.detectedId === task.taskId));
        if (matches.length > 1) throw new Error(`La tarea antigua ${task.taskId} no identifica su documento`);
        target = matches[0] || locations.find(({ branch, doc }: any) => branch.name === ws.activeBranchName && doc.id === branch.activeDocumentId);
      }
      if (target) target.doc.content = applyRemoteTask(target.doc.content, task);
    }
    for (const branch of ws.branches) for (const doc of branch.taskDocuments) {
      const id = `canvasVisualState-${sanitizeSanityDocId(`${ws.id}::${branch.name}::${doc.id}`)}`;
      const visual = docs.find(d => d._id === id && d._type === 'canvasVisualState' && !d.syncDeleted);
      if (visual) doc.visualState = visual;
    }
  }
  return workspaces;
}

export function applyRemoteTask(markdown: string, task: any): string {
  return task.taskId ? applyTaskToMarkdown(markdown, task) : markdown;
}

/**
 * Synchronizes a list of workspaces in batch to Sanity and all child tasks.
 */
export async function syncAllWorkspacesToSanity(workspaces: any[], configOverride?: Partial<SanityConfig>): Promise<{ ok: boolean; syncedCount: number; message: string }> {
  let count = 0;
  for (const ws of workspaces) {
    const res = await saveWorkspaceToSanity(ws, configOverride);
    if (!res.ok) return { ok: false, syncedCount: count, message: res.message };
    count++;
  }
  return { ok: true, syncedCount: count, message: `${count} workspaces sincronizados` };
}

/**
 * Deletes any single document from Sanity Content Lake by its exact or partial _id.
 */
export async function deleteDocumentFromSanity(docId: string, configOverride?: Partial<SanityConfig>): Promise<{ ok: boolean; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  if (!config.projectId || !config.dataset || !config.token) {
    return { ok: false, message: 'Configura el API Token de Sanity para eliminar en remoto' };
  }

  const client = getSanityClient(config);
  try {
    let doc = documentSync.base(docId);
    if (!doc) {
      doc = await fetchSanityDocumentById(docId, config);
    }

    if (doc) {
      try {
        await documentSync.remove(docId, doc._type, config, doc);
      } catch (syncErr) {
        console.warn('documentSync.remove note, proceeding to Lake deletion:', syncErr);
      }
    }

    // Direct deletion on Sanity Lake (both published and draft)
    await client.delete(docId);
    if (!docId.startsWith('drafts.')) {
      try {
        await client.delete(`drafts.${docId}`);
      } catch {}
    }

    return { ok: true, message: 'Documento eliminado de Sanity' };
  } catch (error: any) {
    return { ok: false, message: error?.message || 'Error al eliminar de Sanity' };
  }
}

/**
 * Deletes a workspace document and its associated tasks from Sanity.
 */
export async function deleteWorkspaceFromSanity(workspaceId: string, configOverride?: Partial<SanityConfig>): Promise<{ ok: boolean; message: string }> {
  const config = { ...getSanityConfig(), ...configOverride };
  try {
    const id = sanitizeSanityDocId(workspaceId.replace(/^workspace-/, ''));
    const docs = await fetchSanityDocumentsList(config);
    const workspace = docs.find(d => d._type === 'workspace' && d.workspaceId === id);
    return deleteDocumentFromSanity(workspace?._id || `workspace-${id}`, config);
  } catch (error: any) { return { ok: false, message: error.message }; }
}
