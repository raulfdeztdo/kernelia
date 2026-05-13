import type OpenAI from "openai";
import { getCerebrasClient, getCerebrasModel } from "./client";
import {
  buildClassifyUserPrompt,
  CLASSIFY_SYSTEM_PROMPT,
  type ClassifyInput,
} from "./prompts/classify-article";
import { classificationSchema, type Classification } from "./schemas";

export interface ClassifyResult {
  classification: Classification;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  model: string;
}

export type LlmClient = Pick<OpenAI, "chat">;

export interface ClassifyOptions {
  client?: LlmClient;
  model?: string;
  temperature?: number;
}

export async function classifyArticle(
  input: ClassifyInput,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const client = options.client ?? getCerebrasClient();
  const model = options.model ?? getCerebrasModel();
  const temperature = options.temperature ?? 0.2;

  const startedAt = Date.now();
  const completion = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user", content: buildClassifyUserPrompt(input) },
    ],
    response_format: { type: "json_object" },
  });
  const latencyMs = Date.now() - startedAt;

  const choice = completion.choices[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty content");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error(`LLM returned non-JSON content: ${content.slice(0, 200)}`);
  }

  const parsed = classificationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Schema validation failed: ${parsed.error.message}`);
  }

  const usage = completion.usage;
  return {
    classification: parsed.data,
    usage: {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
    latencyMs,
    model,
  };
}
