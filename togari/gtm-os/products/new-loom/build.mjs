import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['backend/src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'backend/dist/server.js',
  format: 'cjs',
  sourcemap: true,
  external: [
    'express',
    'multer',
    'openai',
    'uuid',
    'cors',
  ],
});

console.log('Build complete: backend/dist/server.js');
