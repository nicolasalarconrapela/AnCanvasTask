/**
 * Application metadata: version, environment, and runtime flags.
 */

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : (import.meta.env.VITE_APP_VERSION as string) || '1.5.0-beta';

export interface AppEnvironmentInfo {
  mode: string;
  isDev: boolean;
  isProd: boolean;
  label: string;
}

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
