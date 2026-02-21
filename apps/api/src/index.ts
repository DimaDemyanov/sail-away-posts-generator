import Fastify from "fastify";
import { loadConfig } from "@sail-away/core";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "api",
      model: config.openaiModel,
      embeddingModel: config.openaiEmbeddingModel,
    };
  });

  await app.listen({ host: "0.0.0.0", port: config.apiPort });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
