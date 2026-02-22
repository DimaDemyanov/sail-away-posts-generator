import OpenAI from "openai";
import type { IndexedPost } from "./history";
import { buildNext10Plan, type PlanItem } from "./planner";

const TOPIC_SEEDS = [
  "История маршрута из последнего путешествия",
  "Практический совет по управлению яхтой в реальных условиях",
  "Обзор марины: что важно знать перед заходом",
  "Жизнь экипажа за кадром",
  "Разбор погодного окна и решения по выходу",
  "Урок навигации на примере реального перехода",
  "Проверка и обслуживание лодки перед выходом",
  "Фотоистория о любимой якорной стоянке",
  "Как мы планируем провизию и бюджет в походе",
  "Пост с ответами на вопросы подписчиков",
];

interface RagOptions {
  apiKey: string;
  model: string;
  embeddingModel: string;
  topK: number;
}

interface RetrievedContext {
  topic: string;
  sources: IndexedPost[];
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

async function embedTexts(client: OpenAI, model: string, inputs: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({
    model,
    input: inputs,
  });
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

function parsePlanResponse(raw: string, fallback: PlanItem[]): PlanItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return fallback;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<Partial<PlanItem>>;
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;

    const normalized = parsed.slice(0, 10).map((item, index) => ({
      rank: index + 1,
      topic: typeof item.topic === "string" && item.topic.trim() ? item.topic.trim() : fallback[index]?.topic ?? "",
      objective:
        item.objective === "engagement" || item.objective === "storytelling" || item.objective === "promotion"
          ? item.objective
          : fallback[index]?.objective ?? "engagement",
      tone:
        item.tone === "inspiring" || item.tone === "casual" || item.tone === "adventure"
          ? item.tone
          : fallback[index]?.tone ?? "inspiring",
      cta: typeof item.cta === "string" && item.cta.trim() ? item.cta.trim() : fallback[index]?.cta ?? "",
      sourcePostIds: Array.isArray(item.sourcePostIds)
        ? item.sourcePostIds.filter((id): id is string => typeof id === "string")
        : fallback[index]?.sourcePostIds ?? [],
    }));

    while (normalized.length < 10) {
      normalized.push(fallback[normalized.length]);
    }

    return normalized;
  } catch {
    return fallback;
  }
}

export async function buildNext10PlanRag(posts: IndexedPost[], options: RagOptions): Promise<PlanItem[]> {
  if (!options.apiKey) {
    return buildNext10Plan(posts);
  }
  if (posts.length === 0) {
    return buildNext10Plan(posts);
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const fallback = buildNext10Plan(posts);

  const postTexts = posts.map((post) => truncate(post.text, 900));
  const [topicEmbeddings, postEmbeddings] = await Promise.all([
    embedTexts(client, options.embeddingModel, TOPIC_SEEDS),
    embedTexts(client, options.embeddingModel, postTexts),
  ]);

  const contexts: RetrievedContext[] = TOPIC_SEEDS.map((topic, index) => ({
    topic,
    sources: retrieveForTopic(topicEmbeddings[index] ?? [], posts, postEmbeddings, options.topK),
  }));

  const evidence = contexts
    .map((ctx, idx) => {
      const lines = ctx.sources.map(
        (post) => `- id=${post.id}; channel=${post.channel}; text="${truncate(post.text, 260)}"`,
      );
      return `Тема ${idx + 1}: ${ctx.topic}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const prompt = [
    "Сформируй план из 10 постов для Telegram-канала про яхтинг.",
    "Используй только приведенный контекст.",
    "Ответ строго JSON-массив из 10 объектов формата:",
    '[{"topic":"...","objective":"engagement|storytelling|promotion","tone":"inspiring|casual|adventure","cta":"...","sourcePostIds":["..."]}]',
    "Не добавляй markdown и комментарии.",
    "",
    "Контекст:",
    evidence,
  ].join("\n");

  try {
    const response = await client.responses.create({
      model: options.model,
      input: prompt,
      max_output_tokens: 1800,
    });

    const text = response.output_text ?? "";
    return parsePlanResponse(text, fallback).map((item, index) => {
      const sourceIds =
        item.sourcePostIds.length > 0
          ? item.sourcePostIds
          : contexts[index]?.sources.map((p) => p.id) ?? [];
      return {
        ...item,
        rank: index + 1,
        sourcePostIds: sourceIds,
      };
    });
  } catch {
    return fallback;
  }
}
