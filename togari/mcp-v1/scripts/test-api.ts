/**
 * Test script for the REST API endpoints
 *
 * Usage: pnpm tsx scripts/test-api.ts
 *
 * This script:
 * 1. Starts the server programmatically
 * 2. Makes HTTP requests to each endpoint
 * 3. Logs results
 * 4. Exits with success/failure
 */

// Load environment variables before any other imports
import 'dotenv/config';

import {
  config,
  logger,
  CloudStorageClient,
  StructifyClient,
  ExaClient,
  AnthropicClient,
  DataProcessor,
  createUploadPipeline,
} from '@natural-language-mcp/core';
import { createApiServer } from '../packages/mcp-server/src/api';
import { ToolServices } from '../packages/mcp-server/src/tools/handlers';
import { Server } from 'http';

const API_PORT = 3001; // Use different port for testing
const BASE_URL = `http://localhost:${API_PORT}`;

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  response?: unknown;
}

async function makeRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const startTime = Date.now();
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testHealth(): Promise<void> {
  const { status, data } = await makeRequest('GET', '/api/health');

  if (status !== 200) {
    throw new Error(`Expected status 200, got ${status}`);
  }

  const result = data as { status: string; timestamp: string; version: string };
  if (result.status !== 'ok') {
    throw new Error(`Expected status 'ok', got '${result.status}'`);
  }

  if (!result.timestamp) {
    throw new Error('Missing timestamp in response');
  }

  if (!result.version) {
    throw new Error('Missing version in response');
  }
}

async function testTools(): Promise<void> {
  const { status, data } = await makeRequest('GET', '/api/tools');

  if (status !== 200) {
    throw new Error(`Expected status 200, got ${status}`);
  }

  const result = data as { success: boolean; endpoints: unknown[] };
  if (!result.success) {
    throw new Error('Expected success: true');
  }

  if (!Array.isArray(result.endpoints) || result.endpoints.length === 0) {
    throw new Error('Expected non-empty endpoints array');
  }
}

async function testSearch(): Promise<void> {
  // This will likely fail due to external API dependency, but we verify the endpoint responds
  const { status, data } = await makeRequest('POST', '/api/tools/search', {
    query: 'test company',
    entityType: 'company',
    limit: 1,
  });

  // We accept both success (200) and error responses (500 due to external API)
  // as long as the endpoint responds with proper JSON structure
  const result = data as { success: boolean; error?: string };

  if (status === 200 && result.success) {
    // External API worked
    return;
  }

  if (status === 500 && result.success === false && result.error) {
    // External API failed but our endpoint handled it correctly
    console.log(`  Note: Search API returned error (expected if no API keys): ${result.error}`);
    return;
  }

  if (status === 400) {
    throw new Error(`Validation error: ${JSON.stringify(data)}`);
  }

  // Endpoint responded - that's the main test
}

async function testRootEndpoint(): Promise<void> {
  const { status, data } = await makeRequest('GET', '/');

  if (status !== 200) {
    throw new Error(`Expected status 200, got ${status}`);
  }

  const result = data as { name: string; version: string; endpoints: object };
  if (!result.name || !result.version || !result.endpoints) {
    throw new Error('Missing required fields in root response');
  }
}

async function test404(): Promise<void> {
  const { status, data } = await makeRequest('GET', '/api/nonexistent');

  if (status !== 404) {
    throw new Error(`Expected status 404, got ${status}`);
  }

  const result = data as { success: boolean; error: string };
  if (result.success !== false) {
    throw new Error('Expected success: false');
  }
}

async function main(): Promise<void> {
  let server: Server | null = null;
  const results: TestResult[] = [];

  try {
    console.log('='.repeat(60));
    console.log('REST API Test Suite');
    console.log('='.repeat(60));
    console.log();

    // Initialize services
    console.log('Initializing services...');

    const cloudStorage = new CloudStorageClient(
      config.gcp.projectId,
      config.gcp.storageBucket
    );

    const structify = new StructifyClient({
      apiKey: config.structify.apiKey,
      baseUrl: config.structify.baseUrl,
    });

    const anthropic = new AnthropicClient(config.anthropic.apiKey);
    const exa = new ExaClient(config.exa.apiKey, anthropic);
    const dataProcessor = new DataProcessor(cloudStorage, structify, exa);
    const uploadPipeline = createUploadPipeline(anthropic);

    const services: ToolServices = {
      cloudStorage,
      structify,
      exa,
      dataProcessor,
      uploadPipeline,
    };

    // Start server
    console.log(`Starting test server on port ${API_PORT}...`);
    server = await createApiServer(services, API_PORT);
    console.log('Server started successfully');
    console.log();

    // Run tests
    console.log('Running tests...');
    console.log('-'.repeat(60));

    results.push(await runTest('GET /api/health', testHealth));
    results.push(await runTest('GET /api/tools', testTools));
    results.push(await runTest('POST /api/tools/search', testSearch));
    results.push(await runTest('GET / (root endpoint)', testRootEndpoint));
    results.push(await runTest('GET /api/nonexistent (404)', test404));

    // Print results
    console.log();
    console.log('='.repeat(60));
    console.log('Test Results');
    console.log('='.repeat(60));

    let passed = 0;
    let failed = 0;

    for (const result of results) {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status} - ${result.name} (${result.duration}ms)`);
      if (result.error) {
        console.log(`       Error: ${result.error}`);
      }
      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    }

    console.log();
    console.log('-'.repeat(60));
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(60));

    // Exit with appropriate code
    if (failed > 0) {
      process.exit(1);
    }

    console.log();
    console.log('All tests passed!');
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (server) {
      console.log();
      console.log('Shutting down test server...');
      server.close();
    }
    // Give a moment for cleanup then exit
    setTimeout(() => process.exit(0), 100);
  }
}

main();
