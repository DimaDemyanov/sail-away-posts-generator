import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPostRag } from "../src/draft";
import type { IndexedPost } from "../src/history";

const samplePost: IndexedPost = {
  id: "p1",
  channel: "test_channel",
  platform: "telegram",
  published_at: "2026-02-22T00:00:00.000Z",
  text: "Test post text",
  media: [],
  metrics: { views: 10, reactions: 2 },
};

test("buildDraftPostRag throws missing_api_key when apiKey is empty", async () => {
  await assert.rejects(
    () =>
      buildDraftPostRag([samplePost], "Тема", {
        apiKey: "",
        model: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        topK: 3,
      }),
    /missing_api_key/,
  );
});

test("buildDraftPostRag throws empty_posts when posts list is empty", async () => {
  await assert.rejects(
    () =>
      buildDraftPostRag([], "Тема", {
        apiKey: "test-key",
        model: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        topK: 3,
      }),
    /empty_posts/,
  );
});
