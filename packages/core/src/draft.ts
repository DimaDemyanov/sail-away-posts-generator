import OpenAI from "openai";
import type { IndexedPost } from "./history";

const MAX_DRAFT_RETRIEVAL_POSTS = 1200;
const EMBEDDING_BATCH_SIZE = 128;
const LLM_LOG_MAX_CHARS = 1200;

export interface DraftOptions {
  apiKey: string;
  model: string;
  embeddingModel: string;
  topK: number;
}

export interface DraftResult {
  topic: string;
  text: string;
  imageOptions: string[];
  sourcePostIds: string[];
  mode: "rag";
}

interface DraftModelResponse {
  text?: string;
  imageOptions?: string[];
  sourcePostIds?: string[];
}

function clip(text: string, max = LLM_LOG_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function logLlmInfo(event: string, payload: Record<string, unknown>): void {
  try {
    console.info(`[llm:${event}]`, JSON.stringify(payload));
  } catch {
    console.info(`[llm:${event}]`, payload);
  }
}

function logLlmRawResponse(event: string, response: unknown): void {
  try {
    console.info(`[llm:${event}.raw]`, JSON.stringify(response));
  } catch {
    console.info(`[llm:${event}.raw]`, response);
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max = 420): string {
  const clean = normalize(text);
  return clean.length <= max ? clean : `${clean.slice(0, max)}...`;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denom = norm(a) * norm(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}

async function embedTexts(
  client: OpenAI,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const chunk = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);
    const res = await client.embeddings.create({ model, input: chunk });
    embeddings.push(...res.data.map((item) => item.embedding));
  }
  return embeddings;
}

function retrieveForTopic(
  topicEmbedding: number[],
  posts: IndexedPost[],
  postEmbeddings: number[][],
  topK: number,
): IndexedPost[] {
  return posts
    .map((post, idx) => ({
      post,
      score: cosineSimilarity(topicEmbedding, postEmbeddings[idx] ?? []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.post);
}

function parseDraftResponse(raw: string): DraftModelResponse | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1)) as DraftModelResponse;
  } catch {
    return null;
  }
}

export async function buildDraftPostRag(
  posts: IndexedPost[],
  topic: string,
  options: DraftOptions,
): Promise<DraftResult> {
  if (!options.apiKey) {
    throw new Error("missing_api_key");
  }
  if (posts.length === 0) {
    throw new Error("empty_posts");
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const candidatePosts = posts.slice(0, MAX_DRAFT_RETRIEVAL_POSTS);
  const postTexts = candidatePosts.map((post) => truncate(post.text, 900));

  const [topicEmbeddingSet, postEmbeddings] = await Promise.all([
    embedTexts(client, options.embeddingModel, [topic]),
    embedTexts(client, options.embeddingModel, postTexts),
  ]);

  const retrieved = retrieveForTopic(
    topicEmbeddingSet[0] ?? [],
    candidatePosts,
    postEmbeddings,
    options.topK,
  );
  const evidence = retrieved
    .map(
      (post) =>
        `- id=${post.id}; channel=${post.channel}; text="${truncate(post.text, 260)}"`,
    )
    .join("\n");

  const prompt = [
    "Сгенерируй пост для Telegram-канала про яхтинг.",
    `Тема: ${topic}`,
    "Используй только контекст ниже.",
    "Цель: текст должен быть понятен новичкам и людям без яхтенного опыта.",
    "Допускаются общетуристические акценты: подготовка, комфорт, бюджет, безопасность, что взять с собой.",
    "Избегай узкого профессионального жаргона. Если термин нужен, объясни его простыми словами.",
    "Избегай историй, завязанных на конкретных людях и их личных кейсах.",
    "Верни строго JSON-объект формата:",
    '{"text":"...","imageOptions":["...","...","..."],"sourcePostIds":["..."]}',
    "Требования:",
    "- text: 700-1200 символов, живой стиль, без markdown.",
    "- imageOptions: 3 короткие идеи для изображений.",
    "- sourcePostIds: только id из контекста.",
    "",
    "Контекст:",
    evidence,
  ].join("\n");

  logLlmInfo("draft.request", {
    model: options.model,
    embeddingModel: options.embeddingModel,
    promptChars: prompt.length,
    candidatePosts: candidatePosts.length,
    topK: options.topK,
    topicChars: topic.length,
  });

  const response = await client.responses.create({
    model: options.model,
    input: prompt,
    max_output_tokens: 1200,
    reasoning: { effort: "minimal" },
  });
  logLlmRawResponse("draft.response", response);

  const outputText = response.output_text ?? "";
  logLlmInfo("draft.response", {
    model: options.model,
    outputChars: outputText.length,
    outputPreview: clip(outputText),
  });

  const parsed = parseDraftResponse(outputText);
  if (!parsed?.text) {
    logLlmInfo("draft.parse_error", {
      reason: "invalid_draft_response",
      outputPreview: clip(outputText),
    });
    throw new Error("invalid_draft_response");
  }

  const imageOptions =
    Array.isArray(parsed.imageOptions) && parsed.imageOptions.length > 0
      ? parsed.imageOptions
          .filter((item): item is string => typeof item === "string")
          .slice(0, 5)
      : [];

  const sourceIdsFromContext = new Set(retrieved.map((p) => p.id));
  const sourcePostIds =
    Array.isArray(parsed.sourcePostIds) && parsed.sourcePostIds.length > 0
      ? parsed.sourcePostIds
          .filter((id): id is string => typeof id === "string")
          .filter((id) => sourceIdsFromContext.has(id))
      : retrieved.map((p) => p.id);

  return {
    topic,
    mode: "rag",
    text: parsed.text.trim(),
    imageOptions,
    sourcePostIds:
      sourcePostIds.length > 0 ? sourcePostIds : retrieved.map((p) => p.id),
  };
}
