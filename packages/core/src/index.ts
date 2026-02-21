export type HealthStatus = "ok";

export function healthcheck(): HealthStatus {
  return "ok";
}

export { loadConfig, type AppConfig } from "./config";
