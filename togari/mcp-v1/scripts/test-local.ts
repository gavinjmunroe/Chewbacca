/**
 * Local test script to verify all components work
 */
import { config, logger } from '@natural-language-mcp/core';
import { CloudStorageClient } from '@natural-language-mcp/core';
import { StructifyClient } from '@natural-language-mcp/core';
import { ExaClient } from '@natural-language-mcp/core';
import { AnthropicClient } from '@natural-language-mcp/core';

async function testConfig() {
  console.log('\n=== Testing Configuration ===');
  console.log('Environment:', config.env);
  console.log('GCP Project:', config.gcp.projectId);
  console.log('GCP Bucket:', config.gcp.storageBucket);
  console.log('Anthropic API Key:', config.anthropic.apiKey ? '✓ Set' : '✗ Missing');
  console.log('Exa API Key:', config.exa.apiKey ? '✓ Set' : '✗ Missing');
  console.log('Structify API Key:', config.structify.apiKey ? '✓ Set' : '✗ Missing');
}

async function testCloudStorage() {
  console.log('\n=== Testing Cloud Storage ===');
  try {
    const client = new CloudStorageClient(config.gcp.projectId, config.gcp.storageBucket);
    // Just instantiation test - actual upload would need credentials
    console.log('CloudStorageClient instantiated: ✓');
  } catch (error) {
    console.log('CloudStorageClient error:', (error as Error).message);
  }
}

async function testAnthropic() {
  console.log('\n=== Testing Anthropic ===');
  if (!config.anthropic.apiKey) {
    console.log('Skipping - no API key');
    return;
  }
  try {
    const client = new AnthropicClient(config.anthropic.apiKey);
    const result = await client.complete({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Say "test successful" and nothing else.' }],
      maxTokens: 20,
    });
    console.log('Anthropic response:', result.content);
    console.log('Anthropic test: ✓');
  } catch (error) {
    console.log('Anthropic error:', (error as Error).message);
  }
}

async function testExa() {
  console.log('\n=== Testing Exa ===');
  if (!config.exa.apiKey) {
    console.log('Skipping - no API key');
    return;
  }
  try {
    const client = new ExaClient(config.exa.apiKey);
    const result = await client.search('Anthropic AI company', { numResults: 1 });
    console.log('Exa results:', result.results.length);
    console.log('Exa test: ✓');
  } catch (error) {
    console.log('Exa error:', (error as Error).message);
  }
}

async function main() {
  console.log('========================================');
  console.log('  Natural Language MCP - Local Tests   ');
  console.log('========================================');

  await testConfig();
  await testCloudStorage();
  await testAnthropic();
  await testExa();

  console.log('\n========================================');
  console.log('  Tests Complete                        ');
  console.log('========================================\n');
}

main().catch(console.error);
