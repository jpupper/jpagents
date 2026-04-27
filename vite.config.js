import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    hmr: false, // Disable Hot Module Replacement to prevent auto-refresh when editing files
    watch: {
      // You can also ignore specific files/folders here if needed
      // ignored: ['**/node_modules/**', '**/proyects/**'],
    }
  }
});
