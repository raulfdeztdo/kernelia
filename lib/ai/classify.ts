import type OpenAI from "openai";
import { getLlmClient, getLlmModel } from "./client";
import {
  buildClassifyUserPrompt,
  CLASSIFY_SYSTEM_PROMPT,
  type ClassifyInput,
} from "./prompts/classify-article";
import { classificationSchema, type Classification } from "./schemas";

/**
 * Error whose cause is *this article's* LLM output: empty content,
 * non-JSON, or a payload that fails schema validation. These are
 * terminal — retrying the same article against a healthy provider
 * would just reproduce them — so `runClassify` marks the row `failed`.
 *
 * Everything the LLM call can throw that is NOT this class (any
 * `APIError`, network error, timeout, 402 quota wall, 404 model
 * removed…) is a provider-side condition that says nothing about the
 * article, and must leave the row `pending` for a later tick.
 */
export class ClassificationContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassificationContentError";
  }
}

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
  const client = options.client ?? getLlmClient();
  const model = options.model ?? getLlmModel();
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
    throw new ClassificationContentError("LLM returned empty content");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new ClassificationContentError(`LLM returned non-JSON content: ${content.slice(0, 200)}`);
  }

  const parsed = classificationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ClassificationContentError(`Schema validation failed: ${parsed.error.message}`);
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
