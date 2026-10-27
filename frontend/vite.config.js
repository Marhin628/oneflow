import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// ONEFLOW_API_URL lets the e2e tests point the proxy at a separate test backend.
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': process.env.ONEFLOW_API_URL || 'http://127.0.0.1:5000' } } });
