import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: '/copypilot/',
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 5173
  }
});
