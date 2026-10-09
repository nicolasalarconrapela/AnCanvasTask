import { getStorageScope, localScope } from './syncSessionService';
import { CanvasVisualDocument } from './sanityService';

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  isPrivate?: boolean;
  description?: string;
}

export interface TaskDocument {
  id: string;
  name: string;
  folder: string; // '' or 'root' for root level, 'frontend', 'backend', 'packages/core', etc.
  path: string; // e.g. 'TASKS.md', 'frontend/TASKS.md', 'backend/TASKS.md'
  content: string;
  lastSavedContent: string;
  updatedAt: string;
  visualState?: CanvasVisualDocument | null;
}

export interface BranchCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface BranchConfig {
  name: string;
  isProtected?: boolean;
  lastCommit?: BranchCommit;
  taskDocuments: TaskDocument[];
  activeDocumentId: string;
}

export interface Workspace {
  _id?: string;
  _rev?: string;
  syncOwner?: string;
  isPlaceholder?: boolean;
  id: string;
  name: string;
  githubRepo: GitHubRepoInfo;
  branches: BranchConfig[];
  activeBranchName: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStoreState {
  scope?: string;
  remoteBase?: Workspace[];
  remoteDocuments?: any[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  githubToken?: string;
}

const STORAGE_KEY = 'antask_workspaces_v2';
const GITHUB_TOKEN_KEY = 'antask_github_token';

// Default Monorepo sample markdown tasks
const SAMPLE_ROOT_MARKDOWN = `# Proyecto Monorepo - Roadmap Global

## Arquitectura & Infraestructura
- [ ] Configurar CI/CD Pipelines en GitHub Actions
  id: root_cicd
  priority: P0
- [ ] Definir variables de entorno y secrets en repositorio
  id: root_env
  priority: P1
- [x] Configurar estructura de paquetes y workspaces
  id: root_monorepo
  priority: P0

## Seguridad & Gobernanza
- [ ] Auditoría de dependencias y escaneo de vulnerabilidades
  id: root_audit
  priority: P2
  blockedBy: root_cicd
- [x] Políticas de ramas y protección de main
  id: root_branch_rules
  priority: P1
`;

const SAMPLE_FRONTEND_MARKDOWN = `# Frontend Tasks - Aplicación Web React / Next.js

## Interfaz & Diseño
- [ ] Implementar sistema de diseño sobrio según UNIVERSAL_WEB_DESIGN_GUIDELINES
  id: fe_design_system
  priority: P0
- [ ] Configurar tema claro y oscuro con soporte de alto contraste
  id: fe_theme
  priority: P1
- [x] Crear barra de navegación y panel lateral colapsable
  id: fe_shell
  priority: P1

## Vistas & Componentes
- [ ] Integrar vista espacial con Canvas interactivo
  id: fe_canvas
  priority: P0
  blockedBy: fe_design_system
- [ ] Desarrollar tablero Kanban drag-and-drop con filtros
  id: fe_kanban
  priority: P1
  blockedBy: fe_canvas
- [ ] Implementar Command Palette accesible (Cmd+K)
  id: fe_command_palette
  priority: P2
`;

const SAMPLE_BACKEND_MARKDOWN = `# Backend Tasks - APIs & Base de Datos

## Autenticación & Usuarios
- [ ] Implementar autenticación OAuth 2.0 y JWT seguros
  id: be_auth_jwt
  priority: P0
- [ ] Endpoints de gestión de perfil y roles (RBAC)
  id: be_user_profile
  priority: P1
  blockedBy: be_auth_jwt
- [x] Inicializar esquemas de datos y validaciones Zod
  id: be_schemas
  priority: P0

## Sincronización & APIs
- [ ] API REST para sincronizar documentos Markdown y tareas
  id: be_sync_api
  priority: P0
  blockedBy: be_schemas
- [ ] Webhook de GitHub para recibir eventos push y pull_request
  id: be_github_webhooks
  priority: P1
  blockedBy: be_sync_api
- [ ] Conectar persistencia en Sanity / Firestore
  id: be_db_persist
  priority: P2
`;

export function getInitialDefaultWorkspaces(): Workspace[] {
  const defaultWs: Workspace = {
    id: 'ws_antask_monorepo',
    name: 'AnTask Monorepo',
    githubRepo: {
      owner: 'antask-org',
      repo: 'antask-platform',
      fullName: 'antask-org/antask-platform',
      url: 'https://github.com/antask-org/antask-platform',
      defaultBranch: 'main',
      isPrivate: false,
      description: 'Plataforma monorepo con tareas distribuidas en raíz, frontend y backend.',
    },
    activeBranchName: 'main',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    branches: [
      {
        name: 'main',
        isProtected: true,
        lastCommit: {
          hash: '7a9c1f2',
          message: 'feat: inicializar estructura de tareas monorepo',
          author: 'AnTask Lead',
          timestamp: new Date().toISOString(),
        },
        activeDocumentId: 'doc_root_tasks',
        taskDocuments: [
          {
            id: 'doc_root_tasks',
            name: 'TASKS.md',
            folder: 'root',
            path: 'TASKS.md',
            content: SAMPLE_ROOT_MARKDOWN,
            lastSavedContent: SAMPLE_ROOT_MARKDOWN,
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'doc_frontend_tasks',
            name: 'TASKS.md',
            folder: 'frontend',
            path: 'frontend/TASKS.md',
            content: SAMPLE_FRONTEND_MARKDOWN,
            lastSavedContent: SAMPLE_FRONTEND_MARKDOWN,
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'doc_backend_tasks',
            name: 'TASKS.md',
            folder: 'backend',
            path: 'backend/TASKS.md',
            content: SAMPLE_BACKEND_MARKDOWN,
            lastSavedContent: SAMPLE_BACKEND_MARKDOWN,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      {
        name: 'feature/auth-v2',
        isProtected: false,
        lastCommit: {
          hash: 'e4d8b3a',
          message: 'chore(auth): refactorizar flujo de autenticación y tokens',
          author: 'Dev Sec',
          timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        },
        activeDocumentId: 'doc_auth_frontend',
        taskDocuments: [
          {
            id: 'doc_auth_frontend',
            name: 'TASKS.md',
            folder: 'frontend',
            path: 'frontend/TASKS.md',
            content: `# Feature Auth v2 - Frontend Tasks

## Autenticación Refactor
- [ ] Diseñar pantalla de Login con passkeys y 2FA
  id: auth_fe_passkey
  priority: P0
- [ ] Manejar estado de expiración de sesión con modal discreto
  id: auth_fe_session_expiry
  priority: P1
- [x] Sanitizar inputs de credenciales
  id: auth_fe_sanitize
  priority: P0
`,
            lastSavedContent: `# Feature Auth v2 - Frontend Tasks

## Autenticación Refactor
- [ ] Diseñar pantalla de Login con passkeys y 2FA
  id: auth_fe_passkey
  priority: P0
- [ ] Manejar estado de expiración de sesión con modal discreto
  id: auth_fe_session_expiry
  priority: P1
- [x] Sanitizar inputs de credenciales
  id: auth_fe_sanitize
  priority: P0
`,
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'doc_auth_backend',
            name: 'TASKS.md',
            folder: 'backend',
            path: 'backend/TASKS.md',
            content: `# Feature Auth v2 - Backend Tasks

## Endpoints Seguros
- [ ] Endpoints de rotación de Refresh Tokens
  id: auth_be_refresh
  priority: P0
- [ ] Rate limiting en ruta /api/auth/login
  id: auth_be_rate_limit
  priority: P0
- [x] Almacenar hashing argon2id
  id: auth_be_argon2
  priority: P0
`,
            lastSavedContent: `# Feature Auth v2 - Backend Tasks

## Endpoints Seguros
- [ ] Endpoints de rotación de Refresh Tokens
  id: auth_be_refresh
  priority: P0
- [ ] Rate limiting en ruta /api/auth/login
  id: auth_be_rate_limit
  priority: P0
- [x] Almacenar hashing argon2id
  id: auth_be_argon2
  priority: P0
`,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };

  return [defaultWs];
}

// Strict Trace Logger for identifiable debugging
export const logWorkspaceTrace = (action: string, details?: any) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`%c[AnTask Workspace Engine ${timestamp}]%c ${action}`, 'color: #38bdf8; font-weight: bold;', 'color: inherit;', details || '');
};

export const logWorkspaceWarn = (action: string, details?: any) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.warn(`[AnTask Workspace Engine ${timestamp}] ⚠️ ${action}`, details || '');
};

// Sanitization & Safe Defaults
export function sanitizeTaskDocument(rawDoc: any, fallbackId?: string): TaskDocument {
  const id = rawDoc?.id || fallbackId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const name = rawDoc?.name || 'TASKS.md';
  const folder = rawDoc?.folder || '';
  const path = rawDoc?.path || formatDocumentPath(folder, name);
  const content = typeof rawDoc?.content === 'string' ? rawDoc.content : '';
  const lastSavedContent = typeof rawDoc?.lastSavedContent === 'string' ? rawDoc.lastSavedContent : content;
  const updatedAt = rawDoc?.updatedAt || new Date().toISOString();

  return {
    ...rawDoc,
    id,
    name,
    folder,
    path,
    content,
    lastSavedContent,
    updatedAt,
    visualState: rawDoc?.visualState || null,
  };
}

export function sanitizeBranch(rawBranch: any, fallbackName: string = 'main'): BranchConfig {
  const name = rawBranch?.name || fallbackName;
  const isProtected = Boolean(rawBranch?.isProtected);
  const lastCommit = rawBranch?.lastCommit;

  const rawDocs = Array.isArray(rawBranch?.taskDocuments) ? rawBranch.taskDocuments : [];
  const taskDocuments: TaskDocument[] = rawDocs.length > 0
    ? rawDocs.map((d: any, idx: number) => sanitizeTaskDocument(d, `doc_${name}_${idx}`))
    : [
        {
          id: `doc_${name}_root`,
          name: 'TASKS.md',
          folder: '',
          path: 'TASKS.md',
          content: '',
          lastSavedContent: '',
          updatedAt: new Date().toISOString(),
        },
      ];

  const activeDocumentId =
    rawBranch?.activeDocumentId && taskDocuments.some((d) => d.id === rawBranch.activeDocumentId)
      ? rawBranch.activeDocumentId
      : taskDocuments[0].id;

  return {
    ...rawBranch,
    name,
    isProtected,
    lastCommit,
    taskDocuments,
    activeDocumentId,
  };
}

export function sanitizeWorkspace(rawWs: any, fallbackId?: string): Workspace {
  const id = rawWs?.id || fallbackId || `ws_${Date.now()}`;
  const name = rawWs?.name || 'Workspace Principal';
  const githubRepo: GitHubRepoInfo = {
    owner: rawWs?.githubRepo?.owner || 'usuario',
    repo: rawWs?.githubRepo?.repo || 'mi-repositorio',
    fullName: rawWs?.githubRepo?.fullName || `${rawWs?.githubRepo?.owner || 'usuario'}/${rawWs?.githubRepo?.repo || 'mi-repositorio'}`,
    url: rawWs?.githubRepo?.url || `https://github.com/${rawWs?.githubRepo?.fullName || 'usuario/mi-repositorio'}`,
    defaultBranch: rawWs?.githubRepo?.defaultBranch || 'main',
    isPrivate: Boolean(rawWs?.githubRepo?.isPrivate),
    description: rawWs?.githubRepo?.description || '',
  };

  const rawBranches = Array.isArray(rawWs?.branches) ? rawWs.branches : [];
  const branches: BranchConfig[] = rawBranches.length > 0
    ? rawBranches.map((b: any, idx: number) => sanitizeBranch(b, idx === 0 ? 'main' : `branch-${idx}`))
    : [sanitizeBranch({ name: 'main' }, 'main')];

  const activeBranchName =
    rawWs?.activeBranchName && branches.some((b) => b.name === rawWs.activeBranchName)
      ? rawWs.activeBranchName
      : branches[0].name;

  return {
    ...rawWs,
    _id: rawWs?._id,
    _rev: rawWs?._rev,
    syncOwner: rawWs?.syncOwner,
    isPlaceholder: rawWs?.isPlaceholder,
    id,
    name,
    githubRepo,
    branches,
    activeBranchName,
    createdAt: rawWs?.createdAt || new Date().toISOString(),
    updatedAt: rawWs?.updatedAt || new Date().toISOString(),
  };
}

export function loadWorkspaceStore(scope = getStorageScope()): WorkspaceStoreState {
  const key = scope === localScope ? STORAGE_KEY : `${STORAGE_KEY}:${scope}`;
  try {
    const raw = localStorage.getItem(key);
    const token = localStorage.getItem(`${GITHUB_TOKEN_KEY}:${scope}`) || undefined;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.workspaces && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
        const sanitizedWorkspaces = parsed.workspaces.map((ws: any, idx: number) =>
          sanitizeWorkspace(ws, `ws_${idx}`)
        );
        const activeWorkspaceId =
          parsed.activeWorkspaceId && sanitizedWorkspaces.some((w: Workspace) => w.id === parsed.activeWorkspaceId)
            ? parsed.activeWorkspaceId
            : sanitizedWorkspaces[0].id;

        logWorkspaceTrace('Store cargado desde localStorage', {
          workspacesCount: sanitizedWorkspaces.length,
          activeWorkspaceId,
          hasGitHubToken: Boolean(token),
        });

        return {
          scope,
          remoteBase: parsed.remoteBase,
          remoteDocuments: parsed.remoteDocuments,
          workspaces: sanitizedWorkspaces,
          activeWorkspaceId,
          githubToken: token,
        };
      }
    }
  } catch (err) {
    logWorkspaceWarn('Error al leer workspace store de localStorage, reinicializando por defecto', err);
  }

  logWorkspaceTrace('Inicializando workspace store', { scope });
  const defaultWorkspaces = scope === localScope
    ? getInitialDefaultWorkspaces().map((ws) => sanitizeWorkspace(ws))
    : [createEmptyWorkspace()];
  const initialState: WorkspaceStoreState = {
    scope, remoteBase: [],
    workspaces: defaultWorkspaces,
    activeWorkspaceId: defaultWorkspaces[0].id,
  };
  saveWorkspaceStore(initialState);
  return initialState;
}

const pendingStoreSaves = new Map<string, { state: WorkspaceStoreState; timer: ReturnType<typeof setTimeout> }>();

export function flushWorkspaceStoreSaves(): void {
  for (const { state } of [...pendingStoreSaves.values()]) saveWorkspaceStore(state);
}

export function saveWorkspaceStore(state: WorkspaceStoreState, delay = 0): void {
  const scope = state.scope || getStorageScope();
  const pending = pendingStoreSaves.get(scope);
  if (pending) clearTimeout(pending.timer);
  pendingStoreSaves.delete(scope);
  if (delay) {
    const snapshot = { ...state, scope };
    pendingStoreSaves.set(scope, { state: snapshot, timer: setTimeout(() => saveWorkspaceStore(snapshot), delay) });
    return;
  }
  const key = scope === localScope ? STORAGE_KEY : `${STORAGE_KEY}:${scope}`;
  try {
    const sanitizedWorkspaces = (state.workspaces || []).map((ws, idx) =>
      sanitizeWorkspace(ws, `ws_${idx}`)
    );
    const safeActiveId =
      state.activeWorkspaceId && sanitizedWorkspaces.some((w) => w.id === state.activeWorkspaceId)
        ? state.activeWorkspaceId
        : sanitizedWorkspaces[0]?.id || 'ws_default';

    localStorage.setItem(
      key,
      JSON.stringify({
        remoteBase: state.remoteBase,
        remoteDocuments: state.remoteDocuments,
        workspaces: sanitizedWorkspaces,
        activeWorkspaceId: safeActiveId,
      })
    );
    if (state.githubToken) {
      localStorage.setItem(`${GITHUB_TOKEN_KEY}:${scope}`, state.githubToken);
    } else {
      localStorage.removeItem(`${GITHUB_TOKEN_KEY}:${scope}`);
    }
  } catch (err) {
    logWorkspaceWarn('Error al guardar workspace store en localStorage', err);
  }
}

export function createEmptyWorkspace(): Workspace {
  const id = `ws_${crypto.randomUUID()}`;
  const docId = `doc_${crypto.randomUUID()}`;
  return sanitizeWorkspace({ id, isPlaceholder: true, name: 'Mi Workspace', branches: [{ name: 'main', activeDocumentId: docId,
    taskDocuments: [{ id: docId, name: 'TASKS.md', content: '# Tareas\n\n## General\n', lastSavedContent: '# Tareas\n\n## General\n' }] }] });
}

// Helpers for Workspace resolution (Crash-Proof)
export function getActiveWorkspace(store: WorkspaceStoreState): Workspace {
  if (!store || !Array.isArray(store.workspaces) || store.workspaces.length === 0) {
    return createEmptyWorkspace();
  }
  const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
  return sanitizeWorkspace(ws || store.workspaces[0]);
}

export function getActiveBranch(workspace: Workspace): BranchConfig {
  if (!workspace || !Array.isArray(workspace.branches) || workspace.branches.length === 0) {
    return sanitizeBranch({ name: 'main' });
  }
  const branch = workspace.branches.find((b) => b.name === workspace.activeBranchName);
  return sanitizeBranch(branch || workspace.branches[0]);
}

export function getActiveDocument(branch: BranchConfig): TaskDocument {
  if (!branch || !Array.isArray(branch.taskDocuments) || branch.taskDocuments.length === 0) {
    return sanitizeTaskDocument({ id: 'doc_fallback', name: 'TASKS.md', content: SAMPLE_ROOT_MARKDOWN });
  }
  const doc = branch.taskDocuments.find((d) => d.id === branch.activeDocumentId);
  return sanitizeTaskDocument(doc || branch.taskDocuments[0]);
}

// Helper to normalize path e.g. folder="frontend", name="TASKS.md" -> "frontend/TASKS.md"
export function formatDocumentPath(folder: string, name: string): string {
  const cleanFolder = (folder || '').trim().replace(/^\/+|\/+$/g, '');
  const cleanName = (name || '').trim().replace(/^\/+/g, '') || 'TASKS.md';
  if (!cleanFolder || cleanFolder === 'root' || cleanFolder === '.') {
    return cleanName;
  }
  return `${cleanFolder}/${cleanName}`;
}

// Parse repository identifier e.g. "https://github.com/owner/repo" or "owner/repo"
export function parseGitHubRepoInput(input: string): { owner: string; repo: string; url: string; fullName: string } {
  let cleaned = (input || '').trim();
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?github\.com\//, '');
  cleaned = cleaned.replace(/\.git$/, '');
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');

  const parts = cleaned.split('/');
  const owner = parts[0] || 'usuario';
  const repo = parts[1] || 'mi-repositorio';
  const fullName = `${owner}/${repo}`;
  const url = `https://github.com/${fullName}`;

  return { owner, repo, fullName, url };
}
