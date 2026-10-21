/** Manual, synthetic CPU benchmark. Run: node scripts/benchmark-network.mjs */
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

if (!process.execArgv.includes('--experimental-strip-types')) {
  const run = spawnSync(process.execPath, [
    '--experimental-strip-types', '--no-warnings=ExperimentalWarning',
    '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON', fileURLToPath(import.meta.url),
  ], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
await import('./test-loader.mjs');
const { arrangeCircle, visibleCircleNodes, warmCircleSearchIndex } =
  await import('../lib/networkLayout.ts');
const fixture = () => Array.from({ length: 2267 }, (_, i) => ({
  id: String(i), name: `Person ${i}`, subtitle: 'Designer hiking friend',
  context: 'Family work school hiking memories '.repeat(20),
}));
const people = fixture();
const timed = (fn) => {
  const start = performance.now();
  fn();
  return +(performance.now() - start).toFixed(3);
};
function sample(name, fn, iterations = 60) {
  for (let i = 0; i < 10; i++) fn();
  const values = Array.from({ length: iterations }, () => timed(fn)).sort((a, b) => a - b);
  return { name, iterations, medianMs: values[Math.floor(iterations / 2)],
    p95Ms: values[Math.floor(iterations * 0.95)] };
}
const coldSearchMs = timed(() => arrangeCircle(people, 'hiking family', 390, 520));
const nodes = arrangeCircle(people, '', 390, 520);
const size = { width: 390, height: 520 }, camera = { x: 0, y: 0, zoom: 1 };
const results = [
  sample('empty layout', () => arrangeCircle(people, '', 390, 520)),
  sample('warmed search layout', () => arrangeCircle(people, 'hiking family', 390, 520)),
  sample('viewport filter', () => visibleCircleNodes(nodes, size, camera)),
];
// A deterministic scheduler measures slice CPU independently of timer delays.
const pending = new Set();
const slices = [];
warmCircleSearchIndex(fixture(), (work) => {
  pending.add(work);
  return () => pending.delete(work);
});
while (pending.size) {
  const work = pending.values().next().value;
  pending.delete(work);
  slices.push(timed(() => work({ timeRemaining: () => 10 })));
}
slices.sort((a, b) => a - b);
console.log(JSON.stringify({
  runtime: process.version, contacts: people.length,
  limit: 'Mac Node/V8 CPU only. Not Hermes, native rendering, network or tap latency.',
  coldSearchMs, results, initialVisibleNodes: visibleCircleNodes(nodes, size, camera).length,
  idleIndexSlices: { count: slices.length, p95CpuMs: slices[Math.floor(slices.length * 0.95)],
    maxCpuMs: slices.at(-1) },
}, null, 2));
