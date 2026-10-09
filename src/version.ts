import packageJson from '../package.json';

/**
 * Versión de la aplicación sincronizada directamente con package.json
 */
export const APP_VERSION: string = packageJson.version;
export const APP_NAME: string = packageJson.name;

export interface AppEnvironmentInfo {
  mode: string;
  isDev: boolean;
  isProd: boolean;
  label: string;
}

/**
 * Información del entorno de ejecución actual (Vite / Node)
 */
export const getAppEnvironment = (): AppEnvironmentInfo => {
  const mode = import.meta.env.MODE || (import.meta.env.DEV ? 'development' : 'production');
  const isDev = import.meta.env.DEV || mode === 'development';
  const isProd = import.meta.env.PROD || mode === 'production';

  let label = mode;
  if (mode === 'development') {
    label = 'Dev';
  } else if (mode === 'production') {
    label = 'Prod';
  } else if (mode === 'test') {
    label = 'Test';
  }

  return {
    mode,
    isDev,
    isProd,
    label,
  };
};

export const APP_ENV = getAppEnvironment();
