export type HealthStatus = "ok";

export function healthcheck(): HealthStatus {
  return "ok";
}

export { loadConfig, type AppConfig } from "./config";
export {
  loadHistoryFromDir,
  type HistoryFile,
  type HistoryPost,
  type IndexedPost,
} from "./history";
export { buildNext10Plan, type PlanItem } from "./planner";
export { buildNext10PlanRag } from "./rag";
