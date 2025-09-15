import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          if (options.startup) {
            options.startup(['dist/main/main.js'])
          }
        },
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'node:worker_threads', 'crypto', 'stream', 'util', 'events', 'child_process'],
              output: {
                format: 'cjs'
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist/preload',
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'node:worker_threads', 'crypto', 'stream', 'util', 'events', 'child_process'],
              output: {
                format: 'cjs'
              }
            }
          }
        }
      },
      // Build worker separately to keep heavy work off the main thread
      {
        entry: 'electron/workers/usageWorker.ts',
        vite: {
          build: {
            outDir: 'dist/main/workers',
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'node:worker_threads', 'crypto', 'stream', 'util', 'events', 'child_process'],
              output: {
                format: 'cjs'
              }
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist/renderer'
  }
})
