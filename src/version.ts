import packageJson from '../package.json';

/**
 * Versión y nombre de la aplicación sincronizados directamente con package.json
 */
export const APP_VERSION: string = packageJson.version;
export const APP_NAME: string = packageJson.name;

/**
 * Tipos de entorno soportados:
 * - 'local': Desarrollo local en máquina (localhost / vite dev)
 * - 'cliente': Entorno de pruebas de cliente / staging / demo
 * - 'pro': Producción final
 * - 'test': Suite de pruebas automatizadas / QA
 */
export type AppEnvironmentType = 'local' | 'cliente' | 'pro' | 'test';

export interface AppEnvironmentInfo {
  type: AppEnvironmentType;
  mode: string;
  label: string;
  badgeClass: string;
  dotClass: string;
  isLocal: boolean;
  isCliente: boolean;
  isPro: boolean;
  isTest: boolean;
  isDev: boolean;
}

/**
 * Resuelve el entorno actual evaluando variables de entorno, Vite mode y hostname
 */
export const resolveEnvironmentType = (): AppEnvironmentType => {
  // 1. Variable de entorno explícita (VITE_APP_ENV o MODE)
  const envVar = (
    (import.meta.env.VITE_APP_ENV as string | undefined) ||
    import.meta.env.MODE ||
    ''
  ).toLowerCase();

  if (
    envVar === 'cliente' ||
    envVar === 'client' ||
    envVar === 'staging' ||
    envVar === 'preview' ||
    envVar === 'demo'
  ) {
    return 'cliente';
  }
  if (envVar === 'pro' || envVar === 'production' || envVar === 'prod') {
    return 'pro';
  }
  if (envVar === 'test' || envVar === 'testing') {
    return 'test';
  }
  if (envVar === 'local' || envVar === 'development' || envVar === 'dev') {
    return 'local';
  }

  // 2. Detección en tiempo de ejecución en navegador
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname.toLowerCase();
    const searchParams = new URLSearchParams(window.location.search);

    // Override opcional por query string (?env=cliente | test | pro | local)
    const urlEnv = searchParams.get('env')?.toLowerCase();
    if (urlEnv === 'cliente' || urlEnv === 'client') return 'cliente';
    if (urlEnv === 'pro' || urlEnv === 'production') return 'pro';
    if (urlEnv === 'test') return 'test';
    if (urlEnv === 'local' || urlEnv === 'dev') return 'local';

    if (
      hostname.includes('test') ||
      hostname.includes('cypress') ||
      hostname.includes('playwright')
    ) {
      return 'test';
    }
    if (
      hostname.includes('client') ||
      hostname.includes('cliente') ||
      hostname.includes('demo') ||
      hostname.includes('staging') ||
      hostname.includes('preview')
    ) {
      return 'cliente';
    }
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    ) {
      return 'local';
    }
  }

  // 3. Fallback de Vite
  if (import.meta.env.DEV) {
    return 'local';
  }

  return 'pro';
};

/**
 * Obtiene la configuración completa e información visual del entorno activo
 */
export const getAppEnvironment = (): AppEnvironmentInfo => {
  const type = resolveEnvironmentType();
  const mode = import.meta.env.MODE || (import.meta.env.DEV ? 'development' : 'production');

  const configs: Record<
    AppEnvironmentType,
    { label: string; badgeClass: string; dotClass: string }
  > = {
    local: {
      label: 'Local',
      badgeClass: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
      dotClass: 'bg-purple-500',
    },
    cliente: {
      label: 'Cliente',
      badgeClass: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
      dotClass: 'bg-red-500',
    },
    pro: {
      label: 'Pro',
      badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      dotClass: 'bg-emerald-500',
    },
    test: {
      label: 'Test',
      badgeClass: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
      dotClass: 'bg-yellow-500',
    },
  };

  const config = configs[type];

  return {
    type,
    mode,
    label: config.label,
    badgeClass: config.badgeClass,
    dotClass: config.dotClass,
    isLocal: type === 'local',
    isCliente: type === 'cliente',
    isPro: type === 'pro',
    isTest: type === 'test',
    isDev: type === 'local',
  };
};

export const APP_ENV = getAppEnvironment();
