export interface AppConfig {
  nodeEnv: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  apiPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    openaiModel: env.OPENAI_MODEL ?? "gpt-5-mini",
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    apiPort: Number(env.API_PORT ?? 3000),
  };
}
