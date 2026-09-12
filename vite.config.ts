import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import musicApiPlugin from './vite-plugin-music-api';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  let basePath: string;

  switch (mode) {
    case 'production':
      basePath = env.VITE_BASE_PATH || './';
      break;
    case 'staging':
      basePath = env.VITE_BASE_PATH || './';
      break;
    case 'development':
    default:
      basePath = '/';
      break;
  }

  return {
    base: basePath,
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), musicApiPlugin()],
    define: {
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});