import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root:import.meta.dirname,plugins:[react()],
  publicDir:path.resolve(import.meta.dirname,'../../../data/knowledge-processing-prototype/ui'),
  server:{host:'127.0.0.1',port:6184,strictPort:true},
  build:{outDir:path.resolve(import.meta.dirname,'../../../data/knowledge-processing-prototype/web-build'),emptyOutDir:true},
});
