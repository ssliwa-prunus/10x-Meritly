import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Verify the current id at https://openrouter.ai/models before changing it.
export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-5.5";

export function createModel(modelId: string = DEFAULT_MODEL_ID) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set (copy .env.example to .env).");
  }
  return createOpenRouter({ apiKey })(modelId);
}
