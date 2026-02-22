import OpenAI from "openai";
import type { IndexedPost } from "./history";
import type { PlanItem } from "./planner";

const MAX_RETRIEVAL_POSTS = 1200;
const MAX_SEED_SOURCE_POSTS = 120;
const TOPIC_SEED_COUNT = 10;
const LLM_LOG_MAX_CHARS = 1200;

interface RagOptions {
  apiKey: string;
  model: string;
  embeddingModel: string;
  topK: number;
  avoidTopics?: string[];
}

interface RetrievedContext {
  topic: string;
  sources: IndexedPost[];
}

export interface RagPlanResult {
  plan: PlanItem[];
  topicSeeds: string[];
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
  const ranked = posts
    .map((post, idx) => ({
      post,
      score: cosineSimilarity(topicEmbedding, postEmbeddings[idx] ?? []),
    }))
    .sort((a, b) => b.score - a.score);

  const diversityPool = Math.min(ranked.length, Math.max(topK * 3, topK));
  const pool = ranked.slice(0, diversityPool);
  const shuffled = pool.sort(() => Math.random() - 0.5);

  return shuffled.slice(0, topK).map((entry) => entry.post);
}

function normalizeTopic(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function computeRecencyScore(publishedAt: string): number {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0;
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  const windowDays = 730;
  return Math.max(0, 1 - ageDays / windowDays);
}

function computeEngagementScore(post: IndexedPost, maxLogReactions: number): number {
  const reactions = post.metrics?.reactions ?? 0;
  if (maxLogReactions <= 0) return 0;
  return Math.log1p(Math.max(0, reactions)) / maxLogReactions;
}

function pickSeedCandidates(posts: IndexedPost[]): IndexedPost[] {
  const candidatePool = posts.slice(0, Math.min(posts.length, MAX_RETRIEVAL_POSTS));
  const maxReactions = candidatePool.reduce((max, post) => Math.max(max, post.metrics?.reactions ?? 0), 0);
  const maxLogReactions = Math.log1p(maxReactions);

  return candidatePool
    .map((post) => {
      const recency = computeRecencyScore(post.published_at);
      const engagement = computeEngagementScore(post, maxLogReactions);
      const score = recency * 0.55 + engagement * 0.45;
      return { post, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEED_SOURCE_POSTS)
    .map((entry) => entry.post);
}

function parseTopicSeeds(raw: string): string[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return null;
    const unique = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const normalized = item.trim();
      if (!normalized) continue;
      unique.add(normalized);
      if (unique.size >= TOPIC_SEED_COUNT) break;
    }
    return unique.size === TOPIC_SEED_COUNT ? Array.from(unique) : null;
  } catch {
    return null;
  }
}

async function deriveTopicSeedsFromHistory(client: OpenAI, model: string, posts: IndexedPost[]): Promise<string[]> {
  const seedCandidates = pickSeedCandidates(posts);
  if (seedCandidates.length === 0) {
    throw new Error("seed_candidates_empty");
  }

  const evidence = seedCandidates
    .map((post) => {
      const reactions = post.metrics?.reactions ?? 0;
      return `- date=${post.published_at}; reactions=${reactions}; text="${truncate(post.text, 220)}"`;
    })
    .join("\n");

  const prompt = [
    "Сформируй РОВНО 10 тем для следующих постов Telegram-канала про яхтинг.",
    "Ориентируйся на более свежие и более вовлекающие посты из контекста.",
    "Темы должны быть разнообразными, без дублей, короткими (до 12 слов).",
    "КРИТИЧНО: верни только JSON-массив из 10 строк.",
    "Нельзя добавлять markdown, пояснения, нумерацию, код-блоки или любой текст вне JSON.",
    'Формат ответа строго такой: ["тема 1","тема 2",...,"тема 10"]',
    "Перед ответом проверь, что элементов ровно 10 и они уникальны.",
    "",
    "Контекст постов:",
    evidence,
  ].join("\n");

  logLlmInfo("topic_seeds.request", {
    model,
    promptChars: prompt.length,
    candidates: seedCandidates.length,
  });

  const response = await client.responses.create({
    model,
    input: prompt,
    max_output_tokens: 1200,
    reasoning: { effort: "minimal" },
  });
  logLlmRawResponse("topic_seeds.response", response);

  const outputText = response.output_text ?? "";
  logLlmInfo("topic_seeds.response", {
    model,
    outputChars: outputText.length,
    outputPreview: clip(outputText),
  });

  const parsed = parseTopicSeeds(outputText);
  if (!parsed) {
    logLlmInfo("topic_seeds.parse_error", {
      reason: "invalid_topic_seeds",
      outputPreview: clip(outputText),
    });
    throw new Error("invalid_topic_seeds");
  }
  logLlmInfo("topic_seeds.parsed", { count: parsed.length, topics: parsed });
  return parsed;
}

function parsePlanResponse(raw: string): PlanItem[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<Partial<PlanItem>>;
    if (!Array.isArray(parsed) || parsed.length < TOPIC_SEED_COUNT) return null;

    const normalized = parsed.slice(0, TOPIC_SEED_COUNT).map((item, index) => {
      if (
        typeof item.topic !== "string" ||
        (item.objective !== "engagement" && item.objective !== "storytelling" && item.objective !== "promotion") ||
        (item.tone !== "inspiring" && item.tone !== "casual" && item.tone !== "adventure") ||
        typeof item.cta !== "string"
      ) {
        throw new Error("invalid_plan_item");
      }

      return {
        rank: index + 1,
        topic: item.topic.trim(),
        objective: item.objective,
        tone: item.tone,
        cta: item.cta.trim(),
        sourcePostIds: Array.isArray(item.sourcePostIds)
          ? item.sourcePostIds.filter((id): id is string => typeof id === "string")
          : [],
      } as PlanItem;
    });

    return normalized;
  } catch {
    return null;
  }
}

function applyTopicAvoidanceStrict(plan: PlanItem[], avoidTopics: string[] | undefined): PlanItem[] {
  if (!avoidTopics || avoidTopics.length === 0) return plan;

  const avoidSet = new Set(avoidTopics.map(normalizeTopic));
  const filtered = plan.filter((item) => !avoidSet.has(normalizeTopic(item.topic)));
  if (filtered.length < TOPIC_SEED_COUNT) {
    throw new Error("insufficient_unique_topics_after_avoidance");
  }
  return filtered.slice(0, TOPIC_SEED_COUNT).map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function buildNext10PlanRag(posts: IndexedPost[], options: RagOptions): Promise<RagPlanResult> {
  if (!options.apiKey) {
    throw new Error("missing_api_key");
  }
  if (posts.length === 0) {
    throw new Error("empty_posts");
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const topicSeeds = await deriveTopicSeedsFromHistory(client, options.model, posts);

  const candidatePosts = posts.slice(0, MAX_RETRIEVAL_POSTS);
  const postTexts = candidatePosts.map((post) => truncate(post.text, 900));
  const [topicEmbeddings, postEmbeddings] = await Promise.all([
    embedTexts(client, options.embeddingModel, topicSeeds),
    embedTexts(client, options.embeddingModel, postTexts),
  ]);

  const contexts: RetrievedContext[] = topicSeeds.map((topic, index) => ({
    topic,
    sources: retrieveForTopic(topicEmbeddings[index] ?? [], candidatePosts, postEmbeddings, options.topK),
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

  logLlmInfo("plan.request", {
    model: options.model,
    embeddingModel: options.embeddingModel,
    promptChars: prompt.length,
    topicSeedsCount: topicSeeds.length,
    candidatePosts: candidatePosts.length,
  });

  const response = await client.responses.create({
    model: options.model,
    input: prompt,
    max_output_tokens: 2200,
    reasoning: { effort: "minimal" },
  });
  logLlmRawResponse("plan.response", response);

  const outputText = response.output_text ?? "";
  logLlmInfo("plan.response", {
    model: options.model,
    outputChars: outputText.length,
    outputPreview: clip(outputText),
  });

  const parsedPlan = parsePlanResponse(outputText);
  if (!parsedPlan) {
    logLlmInfo("plan.parse_error", {
      reason: "invalid_plan_response",
      outputPreview: clip(outputText),
    });
    throw new Error("invalid_plan_response");
  }

  const generated = parsedPlan.map((item, index) => {
    const sourceIds =
      item.sourcePostIds.length > 0 ? item.sourcePostIds : contexts[index]?.sources.map((p) => p.id) ?? [];
    return {
      ...item,
      rank: index + 1,
      sourcePostIds: sourceIds,
    };
  });

  return {
    plan: applyTopicAvoidanceStrict(generated, options.avoidTopics),
    topicSeeds,
  };
}
