import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/auth':       { target: 'http://localhost:8000', changeOrigin: true },
      '/plan':       { target: 'http://localhost:8000', changeOrigin: true },
      '/jobs':       { target: 'http://localhost:8000', changeOrigin: true },
      '/upload':     { target: 'http://localhost:8000', changeOrigin: true },
      '/transcribe': { target: 'http://localhost:8000', changeOrigin: true },
      '/process':    { target: 'http://localhost:8000', changeOrigin: true },
      '/publish':    { target: 'http://localhost:8000', changeOrigin: true },
      '/canva':      { target: 'http://localhost:8000', changeOrigin: true },
      '/scrape':     { target: 'http://localhost:8000', changeOrigin: true },
      '/pixabay':    { target: 'http://localhost:8000', changeOrigin: true },
      '/brands':     { target: 'http://localhost:8000', changeOrigin: true },
      '/generate':   { target: 'http://localhost:8000', changeOrigin: true },
      '/health':     { target: 'http://localhost:8000', changeOrigin: true },
      '/assets':     { target: 'http://localhost:8000', changeOrigin: true },
      '/templates':  { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
