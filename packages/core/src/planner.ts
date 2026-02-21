import type { IndexedPost } from "./history";

export interface PlanItem {
  rank: number;
  topic: string;
  objective: "engagement" | "storytelling" | "promotion";
  tone: "inspiring" | "casual" | "adventure";
  cta: string;
  sourcePostIds: string[];
}

const DEFAULT_TOPICS = [
  "Route story from last voyage",
  "Seamanship tip from real conditions",
  "Harbor spotlight and what to expect",
  "Crew life behind the scenes",
  "Weather window decision breakdown",
  "Navigation lesson with chart context",
  "Boat maintenance reality check",
  "Favorite anchorage photo story",
  "Provisioning strategy on a budget",
  "Q&A post for follower questions",
];

function pickObjective(rank: number): PlanItem["objective"] {
  if (rank % 3 === 0) return "promotion";
  if (rank % 2 === 0) return "storytelling";
  return "engagement";
}

function pickTone(rank: number): PlanItem["tone"] {
  if (rank % 3 === 0) return "adventure";
  if (rank % 2 === 0) return "casual";
  return "inspiring";
}

export function buildNext10Plan(posts: IndexedPost[]): PlanItem[] {
  const recent = posts.slice(0, 30);

  return Array.from({ length: 10 }, (_, i) => {
    const rank = i + 1;
    const sourceSlice = recent.slice(i * 3, i * 3 + 3);
    const topic =
      sourceSlice.find((p) => p.text && p.text.trim().length > 0)?.text.slice(0, 80) ??
      DEFAULT_TOPICS[i];

    return {
      rank,
      topic,
      objective: pickObjective(rank),
      tone: pickTone(rank),
      cta: rank % 2 === 0 ? "Share your experience in comments" : "Follow for the next sailing update",
      sourcePostIds: sourceSlice.map((p) => p.id),
    };
  });
}
