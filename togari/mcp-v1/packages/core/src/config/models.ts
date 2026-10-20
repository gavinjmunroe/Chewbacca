/**
 * Model IDs and pricing information for Claude AI models
 */

export const MODEL_IDS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-20250514',
  OPUS: 'claude-opus-4-20250514',
} as const;

export type ModelId = typeof MODEL_IDS[keyof typeof MODEL_IDS];

export interface ModelInfo {
  id: ModelId;
  name: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
}

/**
 * Model pricing information (per 1M tokens)
 */
export const MODELS: Record<ModelId, ModelInfo> = {
  [MODEL_IDS.HAIKU]: {
    id: MODEL_IDS.HAIKU,
    name: 'Claude Haiku 4.5',
    pricing: {
      inputPerMillion: 0.25,
      outputPerMillion: 1.25,
    },
  },
  [MODEL_IDS.SONNET]: {
    id: MODEL_IDS.SONNET,
    name: 'Claude Sonnet 4',
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
  },
  [MODEL_IDS.OPUS]: {
    id: MODEL_IDS.OPUS,
    name: 'Claude Opus 4',
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
    },
  },
};
