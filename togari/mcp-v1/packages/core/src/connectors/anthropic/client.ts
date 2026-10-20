import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from '../../utils/retry';
import { UpstreamAPIError } from '../../errors/types';
import { createLogger } from '../../utils/logger';
import type { CompletionParams, CompletionResult } from './types';

const logger = createLogger('AnthropicClient');

/**
 * Client for interacting with Claude API
 */
export class AnthropicClient {
  private client: Anthropic;

  /**
   * Create a new AnthropicClient instance
   * @param apiKey - Anthropic API key
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
    });
  }

  /**
   * Generate a completion using Claude API
   * @param params - Completion parameters
   * @returns Completion result with content and metadata
   * @throws UpstreamAPIError if the API request fails
   */
  async complete(params: CompletionParams): Promise<CompletionResult> {
    try {
      const response = await withRetry(
        async () => {
          return await this.client.messages.create({
            model: params.model,
            max_tokens: params.maxTokens,
            messages: params.messages,
            system: params.system,
            temperature: params.temperature ?? 0,
            stop_sequences: params.stopSequences,
          });
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Claude API request (attempt ${attempt})`, {
              model: params.model,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      const content = this.extractTextContent(response);

      // Log request metadata (but not content for privacy)
      logger.info('Claude API request completed', {
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      });

      return {
        content,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        stopReason: response.stop_reason as 'end_turn' | 'max_tokens' | 'stop_sequence',
      };
    } catch (error) {
      logger.error('Claude API request failed', error, {
        model: params.model,
      });
      throw new UpstreamAPIError('claude', error);
    }
  }

  /**
   * Extract text content from Claude API response
   * The response contains an array of content blocks, we need to filter and concatenate text blocks
   * @param response - Claude API message response
   * @returns Concatenated text content
   */
  private extractTextContent(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
