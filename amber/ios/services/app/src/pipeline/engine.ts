type NodeDef = { id: string; type: string; config: Record<string, unknown> };
type PipelineDef = { name: string; nodes: NodeDef[]; edges: [string, string][] };

export type PipelineContext = {
  log: (entry: string) => void;
  artifacts: Map<string, unknown>;
};

export type NodeRunner = (input: unknown, cfg: Record<string, unknown>, ctx: PipelineContext) => Promise<unknown>;

const runners = new Map<string, NodeRunner>();

export function registerNode(type: string, runner: NodeRunner) {
  runners.set(type, runner);
}

function sortTopologically(nodes: NodeDef[], edges: [string, string][]): NodeDef[] {
  const incoming = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const graph = new Map<string, string[]>();
  nodes.forEach((n) => {
    incoming.set(n.id, 0);
    graph.set(n.id, []);
  });
  edges.forEach(([a, b]) => {
    graph.get(a)?.push(b);
    incoming.set(b, (incoming.get(b) || 0) + 1);
  });
  const q: string[] = [];
  for (const [id, deg] of incoming) if (deg === 0) q.push(id);
  const order: NodeDef[] = [];
  while (q.length) {
    const id = q.shift()!;
    const node = byId.get(id);
    if (node) order.push(node);
    for (const nb of graph.get(id) || []) {
      const d = (incoming.get(nb) || 0) - 1;
      incoming.set(nb, d);
      if (d === 0) q.push(nb);
    }
  }
  if (order.length !== nodes.length) throw new Error('Pipeline graph has a cycle');
  return order;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function runWithRetry(fn: () => Promise<unknown>, attempts: number, delayMs: number, ctx: PipelineContext, nodeId: string) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      ctx.log(`node:retry:${nodeId}:${i + 1}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function runPipeline(def: PipelineDef, onLog: (entry: string) => void, initialInput?: unknown) {
  const ctx: PipelineContext = { log: onLog, artifacts: new Map() };
  const order = sortTopologically(def.nodes, def.edges);
  const valueByNode = new Map<string, unknown>();

  for (const node of order) {
    const inputs = def.edges.filter((e) => e[1] === node.id).map((e) => valueByNode.get(e[0]));
    let input: unknown;
    if (inputs.length > 0) {
      input = inputs.length === 1 ? inputs[0] : inputs;
    } else if (initialInput !== undefined && order.indexOf(node) === 0) {
      // If this is the first node and we have initial input, use it
      input = initialInput;
    } else {
      input = null;
    }
    
    const runner = runners.get(node.type);
    if (!runner) throw new Error(`No runner for node type ${node.type}`);
    ctx.log(`node:start:${node.id}`);
    const start = Date.now();
    const timeoutMs = Number((node.config as Record<string, unknown>)?.timeoutMs || 20000);
    const attempts = Number((node.config as Record<string, unknown>)?.retries || 1);
    const exec = () => runner(input, node.config || {}, ctx);
    const output = (await runWithRetry(() => withTimeout(exec(), timeoutMs, node.id), attempts, 300, ctx, node.id)) as unknown;
    ctx.log(`node:end:${node.id}:${Date.now() - start}ms`);
    valueByNode.set(node.id, output);
  }

  return valueByNode.get(order.at(-1)!.id);
}

