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

  app.post<{ Body: ReplaceQueueBody }>("/queue/replace", async (request, reply) => {
    const latest = await loadLatestPlan();
    if (!latest) {
      return reply.code(404).send({
        status: "error",
        message: "No saved queue found. Call GET /queue/next10 first.",
      });
    }

    const fromText = request.body?.topicsText?.trim();
    const fromArray = Array.isArray(request.body?.topics)
      ? request.body?.topics.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const topics = fromText ? parseTopicsText(fromText) : fromArray;

    if (topics.length !== 10) {
      return reply.code(400).send({
        status: "error",
        message: "Provide exactly 10 topics.",
      });
    }

    const queue = latest.queue.map((item, index) => ({
      ...item,
      rank: index + 1,
      weekIndex: index + 1,
      topic: topics[index] ?? item.topic,
    }));
    await saveLatestPlan({ ...latest, queue });

    return {
      status: "ok",
      queueId: latest.queueId,
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
    if (
      typeof from !== "number" ||
      typeof to !== "number" ||
      from < 1 ||
      from > 10 ||
      to < 1 ||
      to > 10
    ) {
      return reply.code(400).send({
        status: "error",
        message: "from and to must be numbers in range 1..10",
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
      if (queueItem < 1 || queueItem > 10) {
        return reply.code(400).send({
          status: "error",
          message: "queueItem must be between 1 and 10",
        });
      }

      const latest = await loadLatestPlan();
      if (!latest) {
        return reply.code(400).send({
          status: "error",
          message: "No saved queue found. Call GET /queue/next10 first.",
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

  // Backward-compatible aliases
  app.get("/plan/next10", async (_request, reply) => {
    return app.inject({ method: "GET", url: "/queue/next10" }).then((res) => {
      reply.code(res.statusCode).headers(res.headers);
      return res.json();
    });
  });

  app.get("/plan/latest", async (_request, reply) => {
    return app.inject({ method: "GET", url: "/queue/latest" }).then((res) => {
      reply.code(res.statusCode).headers(res.headers);
      return res.json();
    });
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
