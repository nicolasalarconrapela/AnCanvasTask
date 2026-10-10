import assert from 'node:assert';
import { getTldrawLicenseKey, resolveEnvironmentType } from '../src/version';

console.log('--- Probando resolución de Licencia de tldraw SDK con Entornos ---');

// 1. Verificación básica inicial
const initialKey = getTldrawLicenseKey();
console.log('1. Clave inicial resuelta:', initialKey ?? '(ninguna / modo desarrollo)');

// 2. Mock de localStorage para simular almacenamiento
(globalThis as any).localStorage = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] || null; },
  setItem(k: string, v: string) { this.store[k] = String(v); },
  removeItem(k: string) { delete this.store[k]; },
  clear() { this.store = {}; },
};

// 3. Probar fallback a localStorage
console.log('2. Probando override de clave en localStorage...');
(globalThis as any).localStorage.setItem('antask_tldraw_license_key', 'test_license_key_123');
const localKey = getTldrawLicenseKey();
assert.strictEqual(localKey, 'test_license_key_123', 'Debe resolver la clave guardada en localStorage');
console.log('   ✓ Clave resuelta desde localStorage correctamente.');

// Limpiar localStorage
(globalThis as any).localStorage.clear();

// 4. Probar definición global __TLDRAW_LICENSE_KEY__
console.log('3. Probando define global __TLDRAW_LICENSE_KEY__...');
(globalThis as any).__TLDRAW_LICENSE_KEY__ = 'global_tldraw_key_456';
const globalKey = getTldrawLicenseKey();
assert.strictEqual(globalKey, 'global_tldraw_key_456', 'Debe resolver la clave global __TLDRAW_LICENSE_KEY__');
console.log('   ✓ Clave resuelta desde __TLDRAW_LICENSE_KEY__ correctamente.');

delete (globalThis as any).__TLDRAW_LICENSE_KEY__;

// 5. Probar con claves vacías
console.log('4. Probando que cadenas vacías o con solo espacios retornan undefined...');
(globalThis as any).localStorage.setItem('antask_tldraw_license_key', '   ');
assert.strictEqual(getTldrawLicenseKey(), undefined, 'Espacios en blanco deben normalizarse a undefined');
console.log('   ✓ Manejo de cadenas vacías correcto.');

console.log('--- Todas las pruebas de licencia de tldraw pasaron exitosamente. ---');
