import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
    const env = { ...loadEnv(mode, '../..', ''), ...process.env };
    const partners = [env.VITE_BUYER_ORIGIN || 'http://localhost:4174', env.VITE_SUPPLIER_ORIGIN || 'http://localhost:4175', env.VITE_CARRIER_ORIGIN || 'http://localhost:4176'];
    return { envDir: '../..', plugins: [react()], server: { strictPort: true, port: Number(new URL(env.VITE_ROOM_ORIGIN || 'http://localhost:4173').port), headers: { 'Permissions-Policy': `tools=(self ${partners.map((origin) => `"${origin}"`).join(' ')})` } } };
});
