import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPostRag, buildReferencesForTopic } from "../src/draft";
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

test("buildReferencesForTopic prefers posts lexically matching topic", () => {
  const topic = "Аптечка на яхте";
  const topicEmbedding = [1, 0];
  const posts: IndexedPost[] = [
    {
      id: "101",
      channel: "Silavetra",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка на яхте: что взять для первой помощи",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/silavetrasila.json",
    },
    {
      id: "102",
      channel: "Silavetra",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Что взять с собой в путешествие: одежда и обувь",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/silavetrasila.json",
    },
  ];
  const embeddings = [
    [0.95, 0.05],
    [0.95, 0.05],
  ];

  const refs = buildReferencesForTopic(topic, topicEmbedding, posts, embeddings);
  assert.equal(refs[0]?.id, "101");
});

test("buildReferencesForTopic ignores non-similar sources", () => {
  const topic = "Аптечка на яхте";
  const topicEmbedding = [1, 0];
  const posts: IndexedPost[] = [
    {
      id: "201",
      channel: "Own",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка для перехода",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/own-channel/sail_away.json",
    },
    {
      id: "202",
      channel: "Other",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка для яхтинга и безопасность",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/yachtfitclub.json",
    },
  ];
  const embeddings = [
    [1, 0],
    [0.9, 0.1],
  ];

  const refs = buildReferencesForTopic(topic, topicEmbedding, posts, embeddings);
  assert.deepEqual(refs.map((r) => r.id), ["202"]);
});

test("buildReferencesForTopic keeps channel diversity (max 2 per channel)", () => {
  const topic = "Яхтинг для новичков";
  const topicEmbedding = [1, 0];
  const posts: IndexedPost[] = [
    {
      id: "301",
      channel: "A",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Новичкам в яхтинге: базовые советы",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/a.json",
    },
    {
      id: "302",
      channel: "A",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Яхтинг для новичков: что взять в первую поездку",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/a.json",
    },
    {
      id: "303",
      channel: "A",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Первые шаги в яхтинге",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/a.json",
    },
    {
      id: "304",
      channel: "B",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Вводный гид по яхтингу для путешественников",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/b.json",
    },
  ];
  const embeddings = [
    [0.99, 0.01],
    [0.98, 0.02],
    [0.97, 0.03],
    [0.96, 0.04],
  ];

  const refs = buildReferencesForTopic(topic, topicEmbedding, posts, embeddings);
  const channelA = refs.filter((r) => r.channel === "A").length;
  assert.equal(channelA, 2);
  assert.ok(refs.some((r) => r.channel === "B"));
});

test("buildReferencesForTopic keeps semantic priority when lexical signal is close", () => {
  const topic = "Аптечка на яхте";
  const topicEmbedding = [1, 0];
  const posts: IndexedPost[] = [
    {
      id: "a1",
      channel: "A",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Что взять в путешествие",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/a.json",
    },
    {
      id: "a2",
      channel: "B",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка и первая помощь на яхте",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/b.json",
    },
  ];
  const embeddings = [
    [0.9, 0.1],
    [0.89, 0.11],
  ];

  const refs = buildReferencesForTopic(
    topic,
    topicEmbedding,
    posts,
    embeddings,
    { topicKeywords: ["аптечка", "первая помощь"] },
  );
  assert.equal(refs[0]?.id, "a2");
});

test("buildReferencesForTopic applies must/exclude keywords", () => {
  const topic = "Аптечка на яхте";
  const topicEmbedding = [1, 0];
  const posts: IndexedPost[] = [
    {
      id: "m1",
      channel: "A",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка и лекарства в море",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/a.json",
    },
    {
      id: "m2",
      channel: "B",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Список одежды в поездку",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/b.json",
    },
    {
      id: "m3",
      channel: "C",
      platform: "telegram",
      published_at: "2026-02-01T00:00:00.000Z",
      text: "Аптечка и реклама казино",
      media: [],
      metrics: {},
      sourceFile: "/tmp/history/similar/c.json",
    },
  ];
  const embeddings = [
    [0.9, 0.1],
    [0.9, 0.1],
    [0.9, 0.1],
  ];

  const refs = buildReferencesForTopic(topic, topicEmbedding, posts, embeddings, {
    topicKeywords: ["аптечка", "лекарства"],
    mustHaveKeywords: ["аптечка"],
    excludeKeywords: ["казино"],
  });

  assert.equal(refs[0]?.id, "m1");
  assert.ok(refs.every((r) => r.id !== "m2"));
});
