import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.KULAWA_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
});
