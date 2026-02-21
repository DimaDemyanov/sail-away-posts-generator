import { loadConfig } from "@sail-away/core";

function main(): void {
  const config = loadConfig();
  console.log("worker service started", {
    nodeEnv: config.nodeEnv,
    openaiModel: config.openaiModel,
    embeddingModel: config.openaiEmbeddingModel,
  });
}

main();
