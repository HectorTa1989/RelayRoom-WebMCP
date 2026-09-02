import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => { const env = { ...loadEnv(mode, '../..', ''), ...process.env }; const room = env.VITE_ROOM_ORIGIN || 'http://localhost:4173'; return { envDir: '../..', plugins: [react()], server: { strictPort: true, port: Number(new URL(env.VITE_BUYER_ORIGIN || 'http://localhost:4174').port), proxy: { '/api': `http://localhost:${env.BUYER_API_PORT || 8784}` }, headers: { 'Permissions-Policy': `tools=(self "${room}")` } } }; });
