import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Two build targets:
//  - default: multi-chunk build with lazy-loaded feature routes (for hosting / local use)
//  - "embed": a single self-contained HTML file (fonts + code inlined) for sandboxed previews
export default defineConfig(({ mode }) => {
  const embed = mode === 'embed';
  return {
    base: './',
    plugins: [react(), ...(embed ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@fonts': fileURLToPath(new URL('./node_modules/@fontsource', import.meta.url)),
      },
    },
    define: {
      __EMBED__: JSON.stringify(embed),
    },
    build: {
      outDir: embed ? 'dist-embed' : 'dist',
      chunkSizeWarningLimit: embed ? 8000 : 900,
      assetsInlineLimit: embed ? 100_000_000 : 4096,
      cssCodeSplit: !embed,
      rollupOptions: embed ? { output: { inlineDynamicImports: true } } : undefined,
    },
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
  };
});
