
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(projectRoot, 'index.html'),
        admin: path.resolve(projectRoot, 'admin.html'),
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'copy-embedded-site',
      async closeBundle() {
        await copyFile(
          path.join(projectRoot, 'static-build.html'),
          path.join(projectRoot, 'dist', 'static-build.html'),
        )
      },
    },
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
