import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The 3D chunk (three.js, drei, post-processing) is about 1.4 MB, 450 kB
    // gzipped. It loads only when a 3D view is shown, never with the first page.
    chunkSizeWarningLimit: 1500,
  },
})
