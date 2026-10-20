'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function AIPromptRunnerPage() {
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [model, setModel] = useState<'claude-3-5-sonnet' | 'claude-3-haiku' | 'gpt-4' | 'gpt-3.5-turbo'>('claude-3-5-sonnet');
  const [outputFormat, setOutputFormat] = useState<'text' | 'json'>('text');
  const [jsonSchema, setJsonSchema] = useState('');
  const [variables, setVariables] = useState('{}');
  const [result, setResult] = useState<{ output: { output: string; tokensUsed: number }; tokensUsed: number; model: string } | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runPromptMutation = trpc.ai.runPrompt.useMutation();

  const handleRun = async () => {
    try {
      setIsRunning(true);
      setResult(null);

      let parsedVariables;
      try {
        parsedVariables = JSON.parse(variables || '{}');
      } catch (e) {
        throw new Error(`Invalid JSON in Variables field: ${e instanceof Error ? e.message : 'Syntax error'}`);
      }

      let parsedSchema;
      if (jsonSchema) {
        try {
          parsedSchema = JSON.parse(jsonSchema);
        } catch (e) {
          throw new Error(`Invalid JSON in Schema field: ${e instanceof Error ? e.message : 'Syntax error'}`);
        }
      }

      const response = await runPromptMutation.mutateAsync({
        prompt,
        variables: parsedVariables,
        context: context || undefined,
        model,
        outputFormat,
        jsonSchema: parsedSchema,
        maxTokens: 1000,
      });

      setResult(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Error running prompt: ${errorMessage}`);
    } finally {
      setIsRunning(false);
    }
  };

  const examples: Array<{
    name: string;
    prompt: string;
    variables: string;
    model: 'claude-3-5-sonnet' | 'claude-3-haiku' | 'gpt-4' | 'gpt-3.5-turbo';
    format: 'text' | 'json';
    schema?: string;
  }> = [
    {
      name: 'Generate Email Subject',
      prompt: 'Write a personalized cold email subject line for {{fullName}} who works at {{currentCompany}} as {{currentTitle}}',
      variables: '{"fullName": "John Doe", "currentCompany": "Acme Health", "currentTitle": "Chief Medical Officer"}',
      model: 'claude-3-5-sonnet' as const,
      format: 'text' as const,
    },
    {
      name: 'Extract Data',
      prompt: 'Extract industry, seniority, and function from this LinkedIn headline: {{headline}}',
      variables: '{"headline": "Chief Medical Officer at Acme Health | Digital Health Innovator"}',
      model: 'claude-3-haiku' as const,
      format: 'json' as const,
      schema: '{"industry": "string", "seniority": "string", "function": "string"}',
    },
    {
      name: 'Classify Vertical',
      prompt: 'Based on this company description, classify the vertical (healthcare, mental_health, wellness, fitness, digital_health, or medical_supply): {{description}}',
      variables: '{"description": "We provide telemedicine solutions for remote patient monitoring"}',
      model: 'claude-3-haiku' as const,
      format: 'text' as const,
    },
  ];

  const loadExample = (example: typeof examples[0]) => {
    setPrompt(example.prompt);
    setVariables(example.variables);
    setModel(example.model);
    setOutputFormat(example.format);
    setJsonSchema(example.schema || '');
    setContext('');
    setResult(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AI Prompt Runner</h1>
        <p className="mt-2 text-gray-600">
          Run AI prompts on your data with variable substitution (Claygent-style)
        </p>
      </div>

      {/* Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Examples</CardTitle>
          <CardDescription>Click an example to load it</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <Button
                key={example.name}
                variant="outline"
                size="sm"
                onClick={() => loadExample(example)}
              >
                {example.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Prompt Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Prompt
                  <span className="text-gray-400 ml-2 text-xs">
                    Use {`{{variableName}}`} for substitution
                  </span>
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Enter your prompt here..."
                />
              </div>

              {/* Variables */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Variables (JSON)
                </label>
                <textarea
                  value={variables}
                  onChange={(e) => setVariables(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                  placeholder='{"name": "value"}'
                />
              </div>

              {/* Context (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Context (Optional)
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Add extra context or instructions..."
                />
              </div>

              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as 'claude-3-5-sonnet' | 'claude-3-haiku' | 'gpt-4' | 'gpt-3.5-turbo')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Best)</option>
                  <option value="claude-3-haiku">Claude 3 Haiku (Fast)</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>

              {/* Output Format */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Output Format
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="text"
                      checked={outputFormat === 'text'}
                      onChange={(e) => setOutputFormat(e.target.value as 'text' | 'json')}
                      className="mr-2"
                    />
                    Text
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="json"
                      checked={outputFormat === 'json'}
                      onChange={(e) => setOutputFormat(e.target.value as 'text' | 'json')}
                      className="mr-2"
                    />
                    JSON
                  </label>
                </div>
              </div>

              {/* JSON Schema (if JSON output) */}
              {outputFormat === 'json' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    JSON Schema (Optional)
                  </label>
                  <textarea
                    value={jsonSchema}
                    onChange={(e) => setJsonSchema(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                    placeholder='{"field": "type"}'
                  />
                </div>
              )}

              {/* Run Button */}
              <Button
                onClick={handleRun}
                disabled={!prompt || isRunning}
                className="w-full"
                size="lg"
              >
                {isRunning ? 'Running...' : 'Run Prompt'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Output */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Output</CardTitle>
              {result && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Badge variant="secondary">{result.model}</Badge>
                  <span>{result.tokensUsed} tokens</span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!result && (
                <div className="text-center py-12 text-gray-400">
                  <p>Output will appear here after running the prompt</p>
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                      {result.output.output}
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Documentation */}
      <Card>
        <CardHeader>
          <CardTitle>How to Use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-gray-600">
          <div>
            <h4 className="font-semibold text-gray-900 mb-1">Variable Substitution</h4>
            <p>
              Use <code className="bg-gray-100 px-1 rounded">{`{{variableName}}`}</code> in your
              prompt to insert variable values. Example:
            </p>
            <pre className="bg-gray-50 p-2 rounded mt-2 text-xs">
              Prompt: "Write an email to {`{{name}}`} at {`{{company}}`}"
              {'\n'}Variables: {`{"name": "John", "company": "Acme"}`}
            </pre>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-1">JSON Output</h4>
            <p>
              For structured data extraction, select "JSON" output format and optionally provide a
              schema to guide the AI's response structure.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-1">Batch Processing</h4>
            <p>
              To process multiple rows, use the API directly with <code>ai.runBatch</code> mutation.
              This supports concurrent processing of large datasets.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
