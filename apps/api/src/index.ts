import Fastify from "fastify";
import path from "node:path";
import {
  buildNext10Plan,
  buildDraftPostRag,
  buildNext10PlanRag,
  loadConfig,
  loadHistoryFromDir,
  type IndexedPost,
} from "@sail-away/core";
import { createPlanId, loadLatestPlan, saveLatestPlan } from "./planStore";

interface DraftRequestBody {
  topic?: string;
  planItem?: number;
  planId?: string;
}

function resolveHistoryRoot(): string {
  const fromEnv = process.env.HISTORY_DIR?.trim();
  if (fromEnv) {
    return path.resolve(process.cwd(), fromEnv);
  }
  return path.resolve(__dirname, "../../../history");
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

  app.get("/plan/next10", async (_request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "History is empty after startup indexing.",
      });
    }
    const plan = config.openaiApiKey
      ? await buildNext10PlanRag(indexedPosts, {
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          embeddingModel: config.openaiEmbeddingModel,
          topK: config.ragTopK,
        })
      : buildNext10Plan(indexedPosts);
    const mode: "rag" | "heuristic" = config.openaiApiKey ? "rag" : "heuristic";
    const planId = createPlanId();
    const createdAt = new Date().toISOString();

    await saveLatestPlan({
      planId,
      createdAt,
      mode,
      totalPosts: indexedPosts.length,
      plan,
    });

    return {
      status: "ok",
      mode,
      planId,
      createdAt,
      totalPosts: indexedPosts.length,
      plan,
    };
  });

  app.get("/plan/latest", async (_request, reply) => {
    const latest = await loadLatestPlan();
    if (!latest) {
      return reply.code(404).send({
        status: "error",
        message: "No saved plan found. Call GET /plan/next10 first.",
      });
    }

    return {
      status: "ok",
      ...latest,
    };
  });

  app.post<{ Body: DraftRequestBody }>("/draft", async (request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "History is empty after startup indexing.",
      });
    }

    const planItem = request.body?.planItem;
    const planId = request.body?.planId?.trim();
    const directTopic = request.body?.topic?.trim();
    let topic = directTopic;
    let resolvedPlanId: string | undefined;

    if (!topic && typeof planItem === "number") {
      if (planItem < 1 || planItem > 10) {
        return reply.code(400).send({
          status: "error",
          message: "planItem must be between 1 and 10",
        });
      }

      const latest = await loadLatestPlan();
      if (!latest) {
        return reply.code(400).send({
          status: "error",
          message: "No saved plan found. Call GET /plan/next10 first.",
        });
      }

      if (planId && latest.planId !== planId) {
        return reply.code(400).send({
          status: "error",
          message: "Requested planId does not match latest saved plan.",
        });
      }

      topic = latest.plan[planItem - 1]?.topic;
      resolvedPlanId = latest.planId;
    }

    if (!topic) {
      return reply.code(400).send({
        status: "error",
        message: "Provide topic or planItem",
      });
    }

    const draft = await buildDraftPostRag(indexedPosts, topic, {
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      embeddingModel: config.openaiEmbeddingModel,
      topK: config.ragTopK,
    });

    return {
      status: "ok",
      planId: resolvedPlanId,
      draft,
    };
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
