export interface AppConfig {
  nodeEnv: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  ragTopK: number;
  apiPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-5-mini",
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    ragTopK: Number(env.RAG_TOP_K ?? 3),
    apiPort: Number(env.API_PORT ?? 3000),
  };
}
