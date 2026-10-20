import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the MCP SDK CJS directory (handles npm/pnpm hoisting)
function findMcpSdkCjs() {
  const possiblePaths = [
    resolve(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs/server'),
  ];
  for (const p of possiblePaths) {
    try { readFileSync(resolve(p, 'mcp.js')); return p; } catch {}
  }
  // Fallback: resolve via Node
  const realPath = execSync(`node -e "console.log(require.resolve('@modelcontextprotocol/sdk/package.json'))"`, { cwd: __dirname, encoding: 'utf8' }).trim();
  return resolve(dirname(realPath), 'dist/cjs/server');
}

const mcpCjs = findMcpSdkCjs();
console.log(`MCP SDK CJS: ${mcpCjs}`);

const mcpResolverPlugin = {
  name: 'mcp-resolver',
  setup(build) {
    build.onResolve({ filter: /^@modelcontextprotocol\/sdk\/server\/(.+)$/ }, (args) => {
      const sub = args.path.replace('@modelcontextprotocol/sdk/server/', '');
      return { path: resolve(mcpCjs, sub + '.js') };
    });
  }
};

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(__dirname, 'dist/index.cjs'),
  plugins: [mcpResolverPlugin],
  external: [
    'express',
    'raw-body',
    'content-type',
    'cors',
    '@google-cloud/bigquery',
    '@anthropic-ai/sdk',
    'googleapis',
  ],
});

console.log('Build complete → dist/index.cjs');
