import { loadConfig } from "@sail-away/core";

function main(): void {
  const config = loadConfig();
  console.log("bot service started", {
    nodeEnv: config.nodeEnv,
    openaiModel: config.openaiModel,
  });
}

main();
