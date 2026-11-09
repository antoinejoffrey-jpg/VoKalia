import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY doit contenir une clé publique sb_publishable_.');
  }
  return { base: './', plugins: [react()] };
});
