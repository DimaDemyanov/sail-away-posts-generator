import { Telegraf } from "telegraf";

interface ApiPlanItem {
  rank: number;
  topic: string;
}

interface ApiDraft {
  topic: string;
  text: string;
  imageOptions: string[];
  sourcePostIds: string[];
  mode: "rag" | "heuristic";
}

interface ApiLatestPlan {
  status: "ok" | "error";
  planId?: string;
  plan?: ApiPlanItem[];
  message?: string;
}

function getEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function parseAdminIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
}

async function apiFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json()) as T & { message?: string };
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? body.message : "API request failed";
    throw new Error(String(message));
  }
  return body as T;
}

function ensureAllowed(userId: number, adminIds: Set<number>): boolean {
  return adminIds.has(userId);
}

async function main(): Promise<void> {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  const apiBaseUrl = getOptionalEnv("API_BASE_URL", "http://localhost:3000");
  const adminIds = parseAdminIds(getEnv("ADMIN_TELEGRAM_IDS"));

  const bot = new Telegraf(botToken);

  bot.start(async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    await ctx.reply(
      [
        "Sail Away Bot",
        "",
        "Команды:",
        "/reindex",
        "/plan10",
        "/draft <номер_поста_1_до_10>",
      ].join("\n"),
    );
  });

  bot.command("reindex", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    try {
      const res = await apiFetch<{ status: string; indexedPosts: number }>(apiBaseUrl, "/reindex", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await ctx.reply(`История проиндексирована. Постов: ${res.indexedPosts}`);
    } catch (error) {
      await ctx.reply(`Ошибка reindex: ${(error as Error).message}`);
    }
  });

  bot.command("plan10", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    try {
      const res = await apiFetch<{
        status: string;
        mode: "rag" | "heuristic";
        planId: string;
        plan: ApiPlanItem[];
      }>(apiBaseUrl, "/plan/next10");

      const lines = res.plan.map((item) => `${item.rank}. ${item.topic}`);
      await ctx.reply([`План создан (${res.mode})`, `planId: ${res.planId}`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.reply(`Ошибка plan10: ${(error as Error).message}`);
    }
  });

  bot.command("draft", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }

    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    const planItem = Number(arg);
    if (!Number.isFinite(planItem) || planItem < 1 || planItem > 10) {
      await ctx.reply("Использование: /draft <номер_от_1_до_10>");
      return;
    }

    try {
      const latest = await apiFetch<ApiLatestPlan>(apiBaseUrl, "/plan/latest");
      if (!latest.planId) {
        await ctx.reply("Нет сохраненного плана. Сначала вызовите /plan10");
        return;
      }

      const res = await apiFetch<{ status: string; draft: ApiDraft }>(apiBaseUrl, "/draft", {
        method: "POST",
        body: JSON.stringify({
          planItem,
          planId: latest.planId,
        }),
      });

      const imageLines = res.draft.imageOptions.map((opt, idx) => `${idx + 1}. ${opt}`);
      await ctx.reply(
        [
          `Тема: ${res.draft.topic}`,
          `Режим: ${res.draft.mode}`,
          "",
          res.draft.text,
          "",
          "Идеи для изображений:",
          ...imageLines,
        ].join("\n"),
      );
    } catch (error) {
      await ctx.reply(`Ошибка draft: ${(error as Error).message}`);
    }
  });

  bot.catch(async (error, ctx) => {
    console.error("bot error", error);
    await ctx.reply("Внутренняя ошибка бота.");
  });

  await bot.launch();
  console.log("bot service started", {
    apiBaseUrl,
    admins: Array.from(adminIds),
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
