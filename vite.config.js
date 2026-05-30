import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 43412, // Vite port must be between 1 and 65535
    strictPort: true,
    hmr: false, // Disable Hot Module Replacement to prevent auto-refresh when editing files
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/projects/**',
        '**/proyects/**',
        '**/*.json',
        '**/*.db*',
        '**/vector_store/**',
        '**/rag_uploads/**',
        '**/scratch/**'
      ]
    }
  }
});
