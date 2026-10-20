import esbuild from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(__dirname, "src/server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(__dirname, "dist/server.cjs"),
  external: [
    "express",
    "raw-body",
    "content-type",
    "@google-cloud/bigquery",
    "@google-cloud/storage",
    "@google-cloud/pubsub",
    "@google-cloud/secret-manager",
    "@anthropic-ai/sdk",
    "jsonwebtoken",
    "jwks-rsa",
    "helmet",
    "cors",
    "express-oauth2-jwt-bearer",
    "ioredis",
    "rate-limiter-flexible",
    "cockatiel",
    "@sentry/node",
    "uuid",
    "exceljs",
    "openai",
  ],
});

console.log("Build complete → dist/server.cjs");
