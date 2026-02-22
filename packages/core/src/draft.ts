import OpenAI from "openai";
import type { IndexedPost } from "./history";

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
  mode: "rag" | "heuristic";
}

interface DraftModelResponse {
  text?: string;
  imageOptions?: string[];
  sourcePostIds?: string[];
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
  const res = await client.embeddings.create({ model, input: inputs });
  return res.data.map((item) => item.embedding);
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

function buildHeuristicDraft(
  topic: string,
  posts: IndexedPost[],
  topK: number,
): DraftResult {
  const sources = posts.slice(0, topK);
  const sourcePostIds = sources.map((post) => post.id);
  const sourceHint = sources[0]?.text
    ? truncate(sources[0].text, 120)
    : "Недавний опыт команды";

  return {
    topic,
    mode: "heuristic",
    sourcePostIds,
    text: [
      `Тема: ${topic}`,
      "",
      `${sourceHint}.`,
      "Расскажите, как это было у вас, и какие решения сработали лучше всего.",
      "В следующем посте разберем практические детали по этой теме.",
    ].join("\n"),
    imageOptions: [],
  };
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
  if (!options.apiKey || posts.length === 0) {
    return buildHeuristicDraft(topic, posts, options.topK);
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const postTexts = posts.map((post) => truncate(post.text, 900));

  try {
    const [topicEmbeddingSet, postEmbeddings] = await Promise.all([
      embedTexts(client, options.embeddingModel, [topic]),
      embedTexts(client, options.embeddingModel, postTexts),
    ]);

    const retrieved = retrieveForTopic(
      topicEmbeddingSet[0] ?? [],
      posts,
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

    const response = await client.responses.create({
      model: options.model,
      input: prompt,
      max_output_tokens: 1200,
    });

    const parsed = parseDraftResponse(response.output_text ?? "");
    if (!parsed?.text) {
      return buildHeuristicDraft(topic, retrieved, options.topK);
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
  } catch {
    return buildHeuristicDraft(topic, posts, options.topK);
  }
}
