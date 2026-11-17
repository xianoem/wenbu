import { resolve } from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: {
          main: resolve('src/main/main.ts'),
          core: resolve('src/core/core.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { preload: resolve('src/preload/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      minify: true,
      rolldownOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          livecontrols: resolve('src/renderer/livecontrols.html'),
          subtitles: resolve('src/renderer/subtitles.html'),
        },
      },
    },
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  },
})
