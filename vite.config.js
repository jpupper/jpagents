import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 43412,
    strictPort: true,
    host: '0.0.0.0',  // Accesible desde cualquier dispositivo en la red local
    hmr: false,
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
