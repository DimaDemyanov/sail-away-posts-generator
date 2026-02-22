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
  "История маршрута из последнего путешествия",
  "Практический совет по управлению яхтой в реальных условиях",
  "Обзор марины: что важно знать перед заходом",
  "Жизнь экипажа за кадром",
  "Разбор погодного окна и решения по выходу",
  "Урок навигации на примере реального перехода",
  "Проверка и обслуживание лодки перед выходом",
  "Фотоистория о любимой якорной стоянке",
  "Как мы планируем провизию и бюджет в походе",
  "Пост с ответами на вопросы подписчиков",
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
      cta:
        rank % 2 === 0
          ? "Поделитесь своим опытом в комментариях"
          : "Подписывайтесь, чтобы не пропустить следующий пост",
      sourcePostIds: sourceSlice.map((p) => p.id),
    };
  });
}
