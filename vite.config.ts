import { appendFileSync, mkdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// ONNX Runtime asks for its .wasm next to its own JS; we serve one copy from public/stt/ort instead (wasmPaths in
// sttWorker.ts), so drop the duplicate Vite would otherwise emit into assets/.
const dropOrtWasm = (): Plugin => ({
  name: 'drop-ort-wasm',
  generateBundle(_o, bundle) { for (const k of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(k)) delete bundle[k]; },
});

// dev server only: the game posts what the recogniser made of each read-aloud try (text + scores, never audio)
// → .qa/heard.jsonl, so real tries on this Mac can be checked afterwards
const heardLog = (): Plugin => ({
  name: 'heard-log',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__pjlog', (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4000) req.destroy(); });
      req.on('end', () => {
        try { mkdirSync('.qa', { recursive: true }); appendFileSync('.qa/heard.jsonl', `${JSON.stringify(JSON.parse(body))}\n`); } catch { /* bad line */ }
        res.statusCode = 204; res.end();
      });
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [dropOrtWasm(), heardLog()],
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
  server: { host: true, port: 5195, strictPort: true, headers: { 'Cache-Control': 'no-store' },
    // media files are rebuilt by tools while the game runs: don't reload the page for them
    watch: { ignored: ['**/public/fox/**', '**/public/intro.mp4', '**/public/bgm.mp3', '**/public/voice/**'] } },
  preview: { port: 5196, strictPort: true },
  // pre-bundle up front: otherwise the first START (which loads the speech worker) makes the dev server reload the page
  optimizeDeps: { include: ['three', 'cannon-es', '@huggingface/transformers'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000, assetsInlineLimit: 0 },
});
