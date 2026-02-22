import Fastify from "fastify";
import path from "node:path";
import {
  buildDraftPostRag,
  buildNext10PlanRag,
  loadConfig,
  loadHistoryFromDir,
  type IndexedPost,
  type PlanItem,
} from "@sail-away/core";
import { createPlanId, loadLatestPlan, saveLatestPlan, type QueueItem } from "./planStore";

interface DraftRequestBody {
  topic?: string;
  queueItem?: number;
  queueId?: string;
}

interface ReplaceQueueBody {
  topics?: string[];
  topicsText?: string;
}

interface SwapQueueBody {
  from?: number;
  to?: number;
}

interface RemoveQueueBody {
  index?: number;
}

function resolveHistoryRoot(): string {
  const fromEnv = process.env.HISTORY_DIR?.trim();
  if (fromEnv) {
    return path.resolve(process.cwd(), fromEnv);
  }
  return path.resolve(__dirname, "../../../history");
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUpcomingWeekMonday(baseDate: Date): Date {
  const d = new Date(baseDate);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const daysToNextMonday = day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + daysToNextMonday);
  return d;
}

function withWeeklySlots(topics: PlanItem[]): QueueItem[] {
  const start = startOfUpcomingWeekMonday(new Date());
  return topics.map((item, index) => {
    const weekStart = new Date(start);
    weekStart.setUTCDate(start.getUTCDate() + index * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    return {
      ...item,
      rank: index + 1,
      weekIndex: index + 1,
      weekStart: formatDateOnly(weekStart),
      weekEnd: formatDateOnly(weekEnd),
    };
  });
}

function parseTopicsText(raw: string): string[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => line.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
}

function buildQueueFromTopics(topics: string[], baseQueue: QueueItem[]): QueueItem[] {
  const fallback = baseQueue[0];
  const planItems: PlanItem[] = topics.map((topic, index) => {
    const source = baseQueue[index] ?? fallback;
    return {
      rank: index + 1,
      topic,
      objective: source?.objective ?? "engagement",
      tone: source?.tone ?? "casual",
      cta: source?.cta ?? "Поделитесь вашим опытом в комментариях",
      sourcePostIds: Array.isArray(source?.sourcePostIds) ? source.sourcePostIds : [],
    };
  });
  return withWeeklySlots(planItems);
}

async function generateAndSaveQueue(indexedPosts: IndexedPost[], config: ReturnType<typeof loadConfig>) {
  const latest = await loadLatestPlan();
  const avoidTopics = Array.isArray(latest?.queue) ? latest.queue.map((item) => item.topic) : [];

  const ragResult = await buildNext10PlanRag(indexedPosts, {
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    embeddingModel: config.openaiEmbeddingModel,
    topK: config.ragTopK,
    avoidTopics,
  });

  const queue = withWeeklySlots(ragResult.plan);
  const queueId = createPlanId();
  const createdAt = new Date().toISOString();

  await saveLatestPlan({
    queueId,
    createdAt,
    mode: "rag",
    totalPosts: indexedPosts.length,
    queue,
  });

  return {
    status: "ok" as const,
    mode: "rag" as const,
    topicSeeds: ragResult.topicSeeds,
    queueId,
    createdAt,
    totalPosts: indexedPosts.length,
    queue,
  };
}

async function generateSuggestedQueue(indexedPosts: IndexedPost[], config: ReturnType<typeof loadConfig>) {
  const latest = await loadLatestPlan();
  const avoidTopics = Array.isArray(latest?.queue) ? latest.queue.map((item) => item.topic) : [];

  const ragResult = await buildNext10PlanRag(indexedPosts, {
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    embeddingModel: config.openaiEmbeddingModel,
    topK: config.ragTopK,
    avoidTopics,
  });

  return {
    status: "ok" as const,
    mode: "rag" as const,
    topicSeeds: ragResult.topicSeeds,
    queue: withWeeklySlots(ragResult.plan),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const historyRoot = resolveHistoryRoot();
  let indexedPosts: IndexedPost[] = [];

  try {
    indexedPosts = await loadHistoryFromDir(historyRoot);
    app.log.info({ indexedPosts: indexedPosts.length, historyRoot }, "History indexed on startup");
  } catch (error) {
    app.log.error({ err: error, historyRoot }, "Failed to index history on startup");
    throw error;
  }

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "api",
      model: config.openaiModel,
      embeddingModel: config.openaiEmbeddingModel,
    };
  });

  app.get("/queue/suggest10", async (_request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "History is empty after startup indexing.",
      });
    }

    try {
      return await generateSuggestedQueue(indexedPosts, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "rag_generation_failed";
      app.log.error({ err: error }, "RAG suggestion generation failed");
      return reply.code(502).send({
        status: "error",
        message: `RAG generation failed: ${message}`,
      });
    }
  });

  app.get("/queue/next10", async (_request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "History is empty after startup indexing.",
      });
    }

    try {
      return await generateAndSaveQueue(indexedPosts, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "rag_generation_failed";
      app.log.error({ err: error }, "RAG generation failed");
      return reply.code(502).send({
        status: "error",
        message: `RAG generation failed: ${message}`,
      });
    }
  });

  app.get("/queue/latest", async (_request, reply) => {
    const latest = await loadLatestPlan();
    if (!latest) {
      return reply.code(404).send({
        status: "error",
        message: "No saved queue found. Call GET /queue/next10 first.",
      });
    }

    return {
      status: "ok",
      ...latest,
    };
  });

  app.post("/queue/init-empty", async () => {
    const latest = await loadLatestPlan();
    if (latest) {
      return {
        status: "ok",
        ...latest,
      };
    }

    const queueId = createPlanId();
    const createdAt = new Date().toISOString();
    const queue: QueueItem[] = [];
    await saveLatestPlan({
      queueId,
      createdAt,
      mode: "rag",
      totalPosts: indexedPosts.length,
      queue,
    });

    return {
      status: "ok",
      queueId,
      createdAt,
      mode: "rag" as const,
      totalPosts: indexedPosts.length,
      queue,
    };
  });

  app.post<{ Body: ReplaceQueueBody }>("/queue/replace", async (request, reply) => {
    const fromText = request.body?.topicsText?.trim();
    const fromArray = Array.isArray(request.body?.topics)
      ? request.body?.topics.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const topics = fromText ? parseTopicsText(fromText) : fromArray;

    if (topics.length < 1) {
      return reply.code(400).send({
        status: "error",
        message: "Provide at least 1 topic.",
      });
    }

    const latest = await loadLatestPlan();
    const queue = buildQueueFromTopics(topics, latest?.queue ?? []);
    const queueId = latest?.queueId ?? createPlanId();
    const createdAt = latest?.createdAt ?? new Date().toISOString();
    const totalPosts = latest?.totalPosts ?? indexedPosts.length;
    await saveLatestPlan({
      queueId,
      createdAt,
      mode: "rag",
      totalPosts,
      queue,
    });

    return {
      status: "ok",
      queueId,
      queue,
    };
  });

  app.post<{ Body: SwapQueueBody }>("/queue/swap", async (request, reply) => {
    const latest = await loadLatestPlan();
    if (!latest) {
      return reply.code(404).send({
        status: "error",
        message: "No saved queue found. Call GET /queue/next10 first.",
      });
    }

    const from = request.body?.from;
    const to = request.body?.to;
    const maxPosition = latest.queue.length;
    if (maxPosition < 2) {
      return reply.code(400).send({
        status: "error",
        message: "Need at least 2 items in queue to swap.",
      });
    }
    if (
      typeof from !== "number" ||
      typeof to !== "number" ||
      from < 1 ||
      from > maxPosition ||
      to < 1 ||
      to > maxPosition
    ) {
      return reply.code(400).send({
        status: "error",
        message: `from and to must be numbers in range 1..${maxPosition}`,
      });
    }

    const queue = [...latest.queue];
    const a = from - 1;
    const b = to - 1;
    [queue[a], queue[b]] = [queue[b], queue[a]];
    const normalized = queue.map((item, index) => ({
      ...item,
      rank: index + 1,
      weekIndex: index + 1,
    }));
    await saveLatestPlan({ ...latest, queue: normalized });

    return {
      status: "ok",
      queueId: latest.queueId,
      queue: normalized,
    };
  });

  app.post<{ Body: RemoveQueueBody }>("/queue/remove", async (request, reply) => {
    const latest = await loadLatestPlan();
    if (!latest) {
      return reply.code(404).send({
        status: "error",
        message: "No saved queue found. Call GET /queue/next10 first.",
      });
    }

    const index = request.body?.index;
    const maxPosition = latest.queue.length;
    if (typeof index !== "number" || index < 1 || index > maxPosition) {
      return reply.code(400).send({
        status: "error",
        message: `index must be a number in range 1..${maxPosition}`,
      });
    }

    const topics = latest.queue
      .filter((_, i) => i !== index - 1)
      .map((item) => item.topic);
    const queue = buildQueueFromTopics(topics, latest.queue);
    await saveLatestPlan({ ...latest, queue });

    return {
      status: "ok",
      queueId: latest.queueId,
      queue,
    };
  });

  app.post<{ Body: DraftRequestBody }>("/draft", async (request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "History is empty after startup indexing.",
      });
    }

    const queueItem = request.body?.queueItem;
    const queueId = request.body?.queueId?.trim();
    const directTopic = request.body?.topic?.trim();
    let topic = directTopic;
    let resolvedQueueId: string | undefined;

    if (!topic && typeof queueItem === "number") {
      if (queueItem < 1) {
        return reply.code(400).send({
          status: "error",
          message: "queueItem must be greater than 0",
        });
      }

      const latest = await loadLatestPlan();
      if (!latest) {
        return reply.code(400).send({
          status: "error",
          message: "No saved queue found. Call GET /queue/next10 first.",
        });
      }
      const maxQueueItem = latest.queue.length;
      if (queueItem > maxQueueItem) {
        return reply.code(400).send({
          status: "error",
          message: `queueItem must be in range 1..${maxQueueItem}`,
        });
      }

      if (queueId && latest.queueId !== queueId) {
        return reply.code(400).send({
          status: "error",
          message: "Requested queueId does not match latest saved queue.",
        });
      }

      topic = latest.queue[queueItem - 1]?.topic;
      resolvedQueueId = latest.queueId;
    }

    if (!topic) {
      return reply.code(400).send({
        status: "error",
        message: "Provide topic or queueItem",
      });
    }

    let draft;
    try {
      draft = await buildDraftPostRag(indexedPosts, topic, {
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        embeddingModel: config.openaiEmbeddingModel,
        topK: config.ragTopK,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "draft_generation_failed";
      app.log.error({ err: error, topic }, "Draft generation failed");
      return reply.code(502).send({
        status: "error",
        message: `Draft generation failed: ${message}`,
      });
    }

    return {
      status: "ok",
      queueId: resolvedQueueId,
      draft,
    };
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
