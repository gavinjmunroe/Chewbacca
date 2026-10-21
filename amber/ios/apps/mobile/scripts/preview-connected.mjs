import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const app = fileURLToPath(new URL('..', import.meta.url));
const cli = require.resolve('expo/bin/cli');
const child = spawn(process.execPath, [cli, 'start', '--localhost', '--port', '8082', '--clear'], {
  cwd: app,
  env: { ...process.env, EXPO_PUBLIC_DESIGN_PREVIEW: '0', EXPO_PUBLIC_CONNECTED_ROLODEX: '1' },
  stdio: 'inherit',
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
