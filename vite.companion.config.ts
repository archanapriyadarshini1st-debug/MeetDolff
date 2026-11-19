import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Single-file Node build of the MCP companion -> dist-companion/meetdolff-mcp.mjs
export default defineConfig({
  publicDir: false,
  build: {
    ssr: resolve(root, 'companion/src/main.ts'),
    outDir: 'dist-companion',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'meetdolff-mcp.mjs', format: 'es' } },
  },
  ssr: { noExternal: true },
});
