import type { SanityConfig } from './sanityService';

export interface SyncSession {
  generation: number;
  scope: string;
  owner: string;
  config: SanityConfig;
  controller: AbortController;
}

let generation = 0;
let current: SyncSession | null = null;
let initializing: AbortController | null = null;
export const localScope = 'local';

export function sameConnection(a: SanityConfig, b: SanityConfig): boolean {
  return a.projectId === b.projectId && a.dataset === b.dataset && (a.token || '') === (b.token || '');
}

export function invalidateSyncSession(): void {
  generation++;
  current?.controller.abort();
  initializing?.abort();
  initializing = null;
  current = null;
}

export function getSyncSession(config?: SanityConfig): SyncSession | null {
  return current && (!config || sameConnection(current.config, config)) ? current : null;
}

export function assertSyncSession(session: SyncSession): void {
  if (current !== session || session.controller.signal.aborted) {
    throw new Error('La sesión de sincronización ha cambiado');
  }
}

export function getStorageScope(): string {
  return current?.scope || localScope;
}

export async function beginSyncSession(config: SanityConfig): Promise<SyncSession | null> {
  invalidateSyncSession();
  if (!config.projectId || !config.dataset) return null;
  const startedGeneration = generation;
  const controller = new AbortController();
  initializing = controller;
  let owner = 'public';
  if (config.token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.token));
    const credential = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const cacheKey = `antask_sync_identity:${credential}`;
    let response: Response | undefined;
    try {
      response = await fetch(`https://${config.projectId}.api.sanity.io/v2021-06-07/users/me`, {
        headers: { Authorization: `Bearer ${config.token}` }, signal: controller.signal,
      });
    } catch (error) {
      const cachedOwner = localStorage.getItem(cacheKey);
      if (!cachedOwner || controller.signal.aborted) throw error;
      owner = cachedOwner;
    }
    if (response?.ok) {
      const user = await response.json();
      if (!user.id) throw new Error('Sanity no devolvió una identidad de usuario');
      owner = user.id;
    } else if (response?.status === 401 || response?.status === 403) {
      // Restricted service tokens cannot use /users/me. Isolate them by credential,
      // rather than the ambiguous global "service-token" identity.
      owner = `service-${credential}`;
    } else if (response) {
      throw new Error(`No se pudo comprobar la identidad de Sanity (${response.status})`);
    }
    if (!controller.signal.aborted) localStorage.setItem(cacheKey, owner);
  }
  if (startedGeneration !== generation) {
    controller.abort();
    throw new Error('La sesión de sincronización ha cambiado');
  }
  current = {
    generation, owner, config: { ...config, useCdn: false }, controller,
    scope: encodeURIComponent(JSON.stringify([config.projectId, config.dataset, owner])),
  };
  initializing = null;
  return current;
}
