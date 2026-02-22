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

interface DraftRequestBody {
  topic?: string;
  planItem?: number;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  let indexedPosts: IndexedPost[] = [];

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "api",
      model: config.openaiModel,
      embeddingModel: config.openaiEmbeddingModel,
    };
  });

  app.post("/reindex", async (_request, reply) => {
    const historyRoot = path.resolve(process.cwd(), "history");
    try {
      indexedPosts = await loadHistoryFromDir(historyRoot);
      return {
        status: "ok",
        indexedPosts: indexedPosts.length,
      };
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({
        status: "error",
        message: "Не удалось обработать файлы истории из ./history",
      });
    }
  });

  app.get("/plan/next10", async (_request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "No indexed history. Call POST /reindex first.",
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
    return {
      status: "ok",
      mode: config.openaiApiKey ? "rag" : "heuristic",
      totalPosts: indexedPosts.length,
      plan,
    };
  });

  app.post<{ Body: DraftRequestBody }>("/draft", async (request, reply) => {
    if (indexedPosts.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "No indexed history. Call POST /reindex first.",
      });
    }

    const planItem = request.body?.planItem;
    const directTopic = request.body?.topic?.trim();
    let topic = directTopic;

    if (!topic && typeof planItem === "number") {
      if (planItem < 1 || planItem > 10) {
        return reply.code(400).send({
          status: "error",
          message: "planItem must be between 1 and 10",
        });
      }
      const plan = buildNext10Plan(indexedPosts);
      topic = plan[planItem - 1]?.topic;
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
      draft,
    };
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
