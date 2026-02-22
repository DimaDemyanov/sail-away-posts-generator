import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadHistoryFromDir } from "../src/history";

test("loadHistoryFromDir parses Telegram export format", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sail-away-history-"));
  const historyDir = path.join(tmpRoot, "history", "similar");
  await mkdir(historyDir, { recursive: true });

  const filePath = path.join(historyDir, "channel.json");
  await writeFile(
    filePath,
    JSON.stringify({
      name: "Test Channel",
      type: "public_channel",
      messages: [
        { id: 1, type: "service", date: "2026-01-01T00:00:00" },
        {
          id: 2,
          type: "message",
          date: "2026-01-02T10:00:00",
          text: ["Привет ", { type: "bold", text: "мир" }],
          reactions: [{ count: 3 }],
        },
        {
          id: 3,
          type: "message",
          date: "2026-01-03T10:00:00",
          text: "",
        },
      ],
    }),
    "utf-8",
  );

  const posts = await loadHistoryFromDir(path.join(tmpRoot, "history"));
  await rm(tmpRoot, { recursive: true, force: true });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.id, "2");
  assert.equal(posts[0]?.channel, "Test Channel");
  assert.equal(posts[0]?.text, "Привет мир");
  assert.equal(posts[0]?.metrics?.reactions, 3);
});

test("loadHistoryFromDir parses normalized internal format", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sail-away-history-"));
  const historyDir = path.join(tmpRoot, "history", "own-channel");
  await mkdir(historyDir, { recursive: true });

  const filePath = path.join(historyDir, "own.json");
  await writeFile(
    filePath,
    JSON.stringify({
      channel: "own",
      platform: "telegram",
      posts: [
        {
          id: "p1",
          published_at: "2026-01-10T12:00:00Z",
          text: "Тестовый пост",
        },
      ],
    }),
    "utf-8",
  );

  const posts = await loadHistoryFromDir(path.join(tmpRoot, "history"));
  await rm(tmpRoot, { recursive: true, force: true });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.id, "p1");
  assert.equal(posts[0]?.channel, "own");
});

test("loadHistoryFromDir throws on invalid schema", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sail-away-history-"));
  const historyDir = path.join(tmpRoot, "history");
  await mkdir(historyDir, { recursive: true });

  await writeFile(path.join(historyDir, "broken.json"), JSON.stringify({ foo: "bar" }), "utf-8");

  await assert.rejects(() => loadHistoryFromDir(historyDir), /Invalid history file schema/);
  await rm(tmpRoot, { recursive: true, force: true });
});
