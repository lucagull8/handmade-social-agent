import { defineConfig } from 'vite';

// Configurazione minima: server locale su 127.0.0.1:5173.
// Nota: Web Bluetooth funziona sui contesti sicuri; su Chrome desktop
// http://localhost e http://127.0.0.1 sono considerati sicuri, quindi
// non serve HTTPS in sviluppo.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    open: false
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  }
});
