import OpenAI from "openai";

export const CEREBRAS_DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";
export const CEREBRAS_DEFAULT_MODEL = "llama3.1-8b";

let cachedClient: OpenAI | null = null;
let cachedKey: string | null = null;

export function getCerebrasClient(): OpenAI {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY is not set");
  }
  const baseURL = process.env.CEREBRAS_BASE_URL ?? CEREBRAS_DEFAULT_BASE_URL;

  if (cachedClient && cachedKey === apiKey + baseURL) return cachedClient;

  cachedClient = new OpenAI({ apiKey, baseURL });
  cachedKey = apiKey + baseURL;
  return cachedClient;
}

export function getCerebrasModel(): string {
  return process.env.CEREBRAS_MODEL ?? CEREBRAS_DEFAULT_MODEL;
}
