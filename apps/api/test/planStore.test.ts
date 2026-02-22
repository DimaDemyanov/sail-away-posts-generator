import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createPlanId, loadLatestPlan, saveLatestPlan, type StoredQueue } from "../src/planStore";

async function withTempCwd(run: () => Promise<void>): Promise<void> {
  const previousCwd = process.cwd();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sail-away-api-test-"));
  process.chdir(tmpDir);
  try {
    await run();
  } finally {
    process.chdir(previousCwd);
  }
}

function buildStoredQueue(): StoredQueue {
  return {
    queueId: "queue_test_123",
    createdAt: "2026-02-22T00:00:00.000Z",
    mode: "rag",
    totalPosts: 42,
    queue: [
      {
        rank: 1,
        topic: "Тестовая тема",
        objective: "engagement",
        tone: "casual",
        cta: "Поделитесь мнением",
        sourcePostIds: ["p1", "p2"],
        weekIndex: 1,
        weekStart: "2026-02-23",
        weekEnd: "2026-03-01",
      },
    ],
  };
}

test("createPlanId returns queue-prefixed id", () => {
  const id = createPlanId();
  assert.match(id, /^queue_/);
});

test("createPlanId generates different ids", () => {
  const a = createPlanId();
  const b = createPlanId();
  assert.notEqual(a, b);
});

test("saveLatestPlan and loadLatestPlan roundtrip", async () => {
  await withTempCwd(async () => {
    const expected = buildStoredQueue();
    await saveLatestPlan(expected);
    const loaded = await loadLatestPlan();
    assert.deepEqual(loaded, expected);
  });
});

test("loadLatestPlan returns null when file is missing", async () => {
  await withTempCwd(async () => {
    const loaded = await loadLatestPlan();
    assert.equal(loaded, null);
  });
});

test("loadLatestPlan returns null for invalid json shape", async () => {
  await withTempCwd(async () => {
    const dir = path.resolve(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "latest-queue.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    const loaded = await loadLatestPlan();
    assert.equal(loaded, null);
  });
});

test("loadLatestPlan returns null for malformed json", async () => {
  await withTempCwd(async () => {
    const dir = path.resolve(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "latest-queue.json"), "{not-valid-json", "utf-8");
    const loaded = await loadLatestPlan();
    assert.equal(loaded, null);
  });
});

test("loadLatestPlan returns null for invalid mode", async () => {
  await withTempCwd(async () => {
    const dir = path.resolve(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    const invalid = { ...buildStoredQueue(), mode: "heuristic" };
    await writeFile(path.join(dir, "latest-queue.json"), JSON.stringify(invalid), "utf-8");
    const loaded = await loadLatestPlan();
    assert.equal(loaded, null);
  });
});

test("loadLatestPlan returns null when queue is not an array", async () => {
  await withTempCwd(async () => {
    const dir = path.resolve(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    const invalid = { ...buildStoredQueue(), queue: {} };
    await writeFile(path.join(dir, "latest-queue.json"), JSON.stringify(invalid), "utf-8");
    const loaded = await loadLatestPlan();
    assert.equal(loaded, null);
  });
});
