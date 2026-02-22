import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanItem } from "@sail-away/core";

export interface QueueItem extends PlanItem {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
}

export interface StoredQueue {
  queueId: string;
  createdAt: string;
  mode: "rag";
  totalPosts: number;
  queue: QueueItem[];
}

function queueStorePath(): string {
  return path.resolve(process.cwd(), "data", "latest-queue.json");
}

export function createPlanId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `queue_${ts}_${suffix}`;
}

export async function saveLatestPlan(data: StoredQueue): Promise<void> {
  const filePath = queueStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function loadLatestPlan(): Promise<StoredQueue | null> {
  try {
    const raw = await readFile(queueStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredQueue>;
    if (
      !parsed ||
      typeof parsed.queueId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      parsed.mode !== "rag" ||
      typeof parsed.totalPosts !== "number" ||
      !Array.isArray(parsed.queue)
    ) {
      return null;
    }
    return parsed as StoredQueue;
  } catch {
    return null;
  }
}
