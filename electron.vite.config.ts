import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'electron/main.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'electron/preload.ts') } }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: { rollupOptions: { input: resolve(__dirname, 'index.html') } }
  }
})
