import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanItem } from "@sail-away/core";

export interface StoredPlan {
  planId: string;
  createdAt: string;
  mode: "rag" | "heuristic";
  totalPosts: number;
  plan: PlanItem[];
}

function storePath(): string {
  return path.resolve(process.cwd(), "data", "latest-plan.json");
}

export function createPlanId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `plan_${ts}_${suffix}`;
}

export async function saveLatestPlan(data: StoredPlan): Promise<void> {
  const filePath = storePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function loadLatestPlan(): Promise<StoredPlan | null> {
  try {
    const raw = await readFile(storePath(), "utf-8");
    return JSON.parse(raw) as StoredPlan;
  } catch {
    return null;
  }
}
