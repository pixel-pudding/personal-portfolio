import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  // For GitHub Pages project sites (username.github.io/repo-name), set this
  // to '/repo-name/'. For a custom domain, user/org page, Netlify, or Vercel,
  // leave it as '/'.
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
