import Fastify from "fastify";
import path from "node:path";
import {
  buildNext10Plan,
  loadConfig,
  loadHistoryFromDir,
  type IndexedPost,
} from "@sail-away/core";

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
        message: "Failed to index history files from ./history",
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
    const plan = buildNext10Plan(indexedPosts);
    return {
      status: "ok",
      totalPosts: indexedPosts.length,
      plan,
    };
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
