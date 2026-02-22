import test from "node:test";
import assert from "node:assert/strict";
import { buildNext10Plan } from "../src/planner";
import type { IndexedPost } from "../src/history";

function makePost(index: number): IndexedPost {
  return {
    id: `p-${index}`,
    published_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T10:00:00Z`,
    text: `Пост номер ${index}`,
    channel: "Test",
    sourceFile: "test.json",
  };
}

test("buildNext10Plan returns exactly 10 items", () => {
  const posts = Array.from({ length: 40 }, (_, i) => makePost(i + 1));
  const plan = buildNext10Plan(posts);

  assert.equal(plan.length, 10);
  assert.equal(plan[0]?.rank, 1);
  assert.equal(plan[9]?.rank, 10);
});

test("buildNext10Plan uses source text when available", () => {
  const posts = Array.from({ length: 5 }, (_, i) => makePost(i + 1));
  const plan = buildNext10Plan(posts);

  assert.match(plan[0]?.topic ?? "", /Пост номер/);
});

test("buildNext10Plan uses Russian fallback topics when no source text", () => {
  const posts: IndexedPost[] = [];
  const plan = buildNext10Plan(posts);

  assert.equal(plan[0]?.topic, "История маршрута из последнего путешествия");
  assert.equal(plan[0]?.cta, "Подписывайтесь, чтобы не пропустить следующий пост");
  assert.equal(plan[1]?.cta, "Поделитесь своим опытом в комментариях");
});
