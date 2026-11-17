import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' để chạy được cả ở GitHub Pages (/web-translate/) lẫn khi mở local
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
});
