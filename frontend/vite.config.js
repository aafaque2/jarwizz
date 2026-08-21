import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/health': 'http://localhost:4000',
      '/command': 'http://localhost:4000',
      '/chats': 'http://localhost:4000',
      '/stop': 'http://localhost:4000',
      '/approve': 'http://localhost:4000',
      '/reject': 'http://localhost:4000',
      '/logs': 'http://localhost:4000',
      '/whitelist': 'http://localhost:4000',
      '/gmail': 'http://localhost:4000',
      '/preferences': 'http://localhost:4000',
      '/memory': 'http://localhost:4000',
      '/screenshots': 'http://localhost:4000',
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
})
