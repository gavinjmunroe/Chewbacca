/**
 * Parameters for Claude API completion requests
 */
export interface CompletionParams {
  /** Model ID to use for completion */
  model: string;
  /** Array of messages in the conversation */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Maximum number of tokens to generate */
  maxTokens: number;
  /** System prompt to guide the model's behavior */
  system?: string;
  /** Temperature for randomness (0-1, default 0) */
  temperature?: number;
  /** Sequences that will cause the model to stop generating */
  stopSequences?: string[];
}

/**
 * Result from a Claude API completion request
 */
export interface CompletionResult {
  /** Generated content from the model */
  content: string;
  /** Model ID that was used */
  model: string;
  /** Token usage statistics */
  usage: {
    /** Number of input tokens used */
    inputTokens: number;
    /** Number of output tokens generated */
    outputTokens: number;
  };
  /** Reason why the model stopped generating */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence';
}
