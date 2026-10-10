/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __TLDRAW_LICENSE_KEY__: string | undefined;

interface ImportMetaEnv {
  readonly VITE_TLDRAW_LICENSE_KEY?: string;
  readonly VITE_TLDRAW_LICENSE_KEY_PRO?: string;
  readonly VITE_TLDRAW_LICENSE_KEY_CLIENTE?: string;
  readonly VITE_TLDRAW_LICENSE_KEY_TEST?: string;
  readonly VITE_TLDRAW_LICENSE_KEY_LOCAL?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_SANITY_PROJECT_ID?: string;
  readonly VITE_SANITY_DATASET?: string;
  readonly VITE_SANITY_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
