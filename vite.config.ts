import fs from 'fs';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, Plugin } from 'vite';
import { lingui } from '@lingui/vite-plugin';
import { transformSync } from '@babel/core';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
);

function linguiMacro(): Plugin {
  return {
    name: 'vite-plugin-lingui-macro',
    enforce: 'pre',
    transform(code, id) {
      if ((id.includes('/src/') || id.includes('\\src\\')) && /\.[jt]sx?$/.test(id)) {
        if (code.includes('@lingui/core/macro') || code.includes('@lingui/react/macro')) {
          const result = transformSync(code, {
            filename: id,
            plugins: ['@lingui/babel-plugin-lingui-macro'],
            presets: [
              '@babel/preset-typescript',
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
            babelrc: false,
            configFile: false,
            sourceMaps: true,
          });
          if (result && result.code) {
            return { code: result.code, map: result.map };
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tldrawLicenseKey = env.VITE_TLDRAW_LICENSE_KEY || env.TLDRAW_LICENSE_KEY || '';

  return {
    plugins: [
      {
        name: 'handle-stale-pwa-entry',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.includes('@vite-plugin-pwa/pwa-entry-point-loaded')) {
              res.setHeader('Content-Type', 'application/javascript');
              res.end('export default {};');
              return;
            }
            next();
          });
        },
      },
      linguiMacro(),
      react(),
      lingui(),
      tailwindcss(),
    ],
    define: {
      'process.env': {},
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __TLDRAW_LICENSE_KEY__: JSON.stringify(tldrawLicenseKey),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
