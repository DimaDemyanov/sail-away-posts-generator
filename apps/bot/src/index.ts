import { Markup, Telegraf } from "telegraf";

interface ApiQueueItem {
  rank: number;
  topic: string;
  weekStart: string;
  weekEnd: string;
}

interface ApiQueueResponse {
  status: string;
  mode?: "rag";
  queueId?: string;
  queue?: unknown;
}

interface ApiDraft {
  topic: string;
  text: string;
  imageOptions: string[];
  sourcePostIds: string[];
  mode: "rag";
}

interface ApiLatestQueue {
  status: "ok" | "error";
  queueId?: string;
  queue?: ApiQueueItem[];
  message?: string;
}

interface ApiQueueCreateResponse {
  status: string;
  queueId?: string;
  queue?: ApiQueueItem[];
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

function parseTargetChatId(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
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

async function tryLoadLatestQueue(baseUrl: string): Promise<ApiLatestQueue | null> {
  try {
    const latest = await apiFetch<ApiLatestQueue>(baseUrl, "/queue/latest");
    if (!latest.queueId || !Array.isArray(latest.queue)) {
      return null;
    }
    return latest;
  } catch {
    return null;
  }
}

function ensureAllowed(userId: number, adminIds: Set<number>): boolean {
  return adminIds.has(userId);
}

function parseTopicsText(raw: string): string[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => line.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
}

function formatQueueTopicLines(queue: ApiQueueItem[]): string[] {
  return queue.map((item) => `${item.rank}. ${item.topic}`);
}

function formatQueueScheduleLines(queue: ApiQueueItem[]): string[] {
  return queue.map((item) => `${item.rank}. ${item.topic}\nНеделя: ${item.weekStart} - ${item.weekEnd}`);
}

function getZonedNowParts(timeZone: string): { weekday: string; hour: number; minute: number; dateKey: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date());
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const weekday = map.get("weekday") ?? "";
  const year = map.get("year") ?? "0000";
  const month = map.get("month") ?? "01";
  const day = map.get("day") ?? "01";
  const hour = Number(map.get("hour") ?? "0");
  const minute = Number(map.get("minute") ?? "0");
  return {
    weekday,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    dateKey: `${year}-${month}-${day}`,
  };
}

function getUtcNowParts(): { weekday: number; hour: number; minute: number; dateKey: string } {
  const now = new Date();
  return {
    weekday: now.getUTCDay(),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    dateKey: now.toISOString().slice(0, 10),
  };
}

function getCurrentWeekItem(queue: ApiQueueItem[], dateKey: string): ApiQueueItem | null {
  for (const item of queue) {
    if (item.weekStart <= dateKey && dateKey <= item.weekEnd) {
      return item;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  const apiBaseUrl = getOptionalEnv("API_BASE_URL", "http://localhost:3000");
  const adminIds = parseAdminIds(getEnv("ADMIN_TELEGRAM_IDS"));
  const targetChatId = parseTargetChatId(process.env.TELEGRAM_TARGET_CHAT_ID);
  const botTimeZone = getOptionalEnv("BOT_TIMEZONE", "Europe/Moscow");
  const weeklyPostHour = Number(getOptionalEnv("WEEKLY_POST_HOUR", "9"));
  const weeklyPostMinute = Number(getOptionalEnv("WEEKLY_POST_MINUTE", "0"));

  const bot = new Telegraf(botToken);
  const replaceModeUsers = new Set<number>();
  const addTopicModeUsers = new Set<number>();

  const appendTopic = async (
    userId: number,
    topic: string,
    reply: (text: string) => Promise<unknown>,
  ): Promise<void> => {
    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      await reply("Тема не должна быть пустой.");
      return;
    }

    const latest = await tryLoadLatestQueue(apiBaseUrl);
    const topics = latest ? latest.queue?.map((item) => item.topic) ?? [] : [];
    topics.push(cleanTopic);
    const res = await apiFetch<{ status: string; queueId: string; queue: ApiQueueItem[] }>(
      apiBaseUrl,
      "/queue/replace",
      {
        method: "POST",
        body: JSON.stringify({ topics }),
      },
    );
    addTopicModeUsers.delete(userId);
    const lines = formatQueueTopicLines(res.queue);
    await reply([`Тема добавлена`, `queueId: ${res.queueId}`, "", ...lines].join("\n"));
  };

  await bot.telegram.setMyCommands([
    { command: "start", description: "Показать справку" },
    { command: "queue", description: "Показать текущую очередь постов" },
    { command: "schedule", description: "Показать расписание (с датами)" },
    { command: "replaceposts", description: "Обновить список тем (любое количество)" },
    { command: "addtopic", description: "Добавить тему в конец списка" },
    { command: "removetopic", description: "Удалить тему по номеру: /removetopic 3" },
    { command: "swapposts", description: "Поменять 2 поста местами: /swapposts 2 5" },
    { command: "queuesuggest", description: "Предложить 10 новых тем (без замены очереди)" },
    { command: "draft", description: "Сгенерировать черновик: /draft 1" },
  ]);

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
        "/queue",
        "/schedule",
        "/replaceposts",
        "/addtopic <тема>",
        "/removetopic <номер>",
        "/swapposts <from> <to>",
        "/queuesuggest",
        "/draft <номер_поста>",
      ].join("\n"),
    );
  });

  const handleQueue10 = async (ctx: { from: { id: number }; reply: (text: string) => Promise<unknown> }) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    try {
      const res = await apiFetch<ApiQueueResponse>(apiBaseUrl, "/queue/suggest10");
      if (!Array.isArray(res.queue)) {
        await ctx.reply(
          `Ошибка queuesuggest: некорректный формат ответа API (queue не массив). payload=${JSON.stringify(res).slice(0, 300)}`,
        );
        return;
      }

      const lines = formatQueueTopicLines(res.queue as ApiQueueItem[]);
      await ctx.reply(
        [`Предложено 10 новых тем (${res.mode ?? "unknown"})`, "Текущая очередь не изменена.", "", ...lines].join("\n"),
      );
    } catch (error) {
      await ctx.reply(`Ошибка queuesuggest: ${(error as Error).message}`);
    }
  };
  bot.command("queuesuggest", async (ctx) => handleQueue10(ctx));

  const handleQueueLatest = async (ctx: { from: { id: number }; reply: (text: string) => Promise<unknown> }) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    try {
      let latest = await tryLoadLatestQueue(apiBaseUrl);
      if (!latest) {
        const created = await apiFetch<ApiQueueCreateResponse>(apiBaseUrl, "/queue/init-empty", {
          method: "POST",
        });
        if (!created.queueId || !Array.isArray(created.queue)) {
          await ctx.reply("Не удалось создать текущую очередь.");
          return;
        }
        latest = {
          status: "ok",
          queueId: created.queueId,
          queue: created.queue,
        };
        await ctx.reply("Очередь была пустой, создала пустую очередь.");
      }

      const lines = formatQueueTopicLines(latest.queue ?? []);
      await ctx.reply([`Текущая очередь постов`, `queueId: ${latest.queueId}`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.reply(`Ошибка queue: ${(error as Error).message}`);
    }
  };
  bot.command("queue", async (ctx) => handleQueueLatest(ctx));

  bot.command("schedule", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    try {
      const latest = await apiFetch<ApiLatestQueue>(apiBaseUrl, "/queue/latest");
      if (!latest.queueId || !Array.isArray(latest.queue)) {
        await ctx.reply("Нет сохраненной очереди. Сначала вызовите /queuesuggest");
        return;
      }

      const lines = formatQueueScheduleLines(latest.queue);
      await ctx.reply([`Расписание`, `queueId: ${latest.queueId}`, "", ...lines].join("\n\n"));
    } catch (error) {
      await ctx.reply(`Ошибка schedule: ${(error as Error).message}`);
    }
  });

  bot.command("draft", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }

    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    const planItem = Number(arg);
    if (!Number.isFinite(planItem) || planItem < 1) {
      await ctx.reply("Использование: /draft <номер_поста>");
      return;
    }

    try {
      const latest = await apiFetch<ApiLatestQueue>(apiBaseUrl, "/queue/latest");
      if (!latest.queueId || !Array.isArray(latest.queue)) {
        await ctx.reply("Нет сохраненной очереди. Сначала вызовите /queuesuggest");
        return;
      }
      if (planItem > latest.queue.length) {
        await ctx.reply(`Номер поста вне диапазона: 1..${latest.queue.length}`);
        return;
      }

      const res = await apiFetch<{ status: string; draft: ApiDraft }>(apiBaseUrl, "/draft", {
        method: "POST",
        body: JSON.stringify({
          queueItem: planItem,
          queueId: latest.queueId,
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

  bot.command("replaceposts", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    replaceModeUsers.add(ctx.from.id);
    await ctx.reply(
      "Отправьте список тем сообщением (каждая с новой строки, любое количество). Можно в формате `1. Тема`.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("addtopic", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }
    const topicFromArgs = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (topicFromArgs) {
      try {
        await appendTopic(ctx.from.id, topicFromArgs, (text) => ctx.reply(text));
      } catch (error) {
        await ctx.reply(`Ошибка addtopic: ${(error as Error).message}`);
      }
      return;
    }
    addTopicModeUsers.add(ctx.from.id);
    await ctx.reply("Пришлите тему одним сообщением, я добавлю ее в конец текущей очереди.");
  });

  bot.command("swapposts", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1).map((a) => Number(a.trim()));
    const from = args[0];
    const to = args[1];
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      await ctx.reply("Использование: /swapposts <from> <to>");
      return;
    }

    try {
      const res = await apiFetch<{ status: string; queue: ApiQueueItem[] }>(apiBaseUrl, "/queue/swap", {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
      const lines = formatQueueTopicLines(res.queue);
      await ctx.reply([`Очередь обновлена`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.reply(`Ошибка swapposts: ${(error as Error).message}`);
    }
  });

  bot.command("removetopic", async (ctx) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.reply("Доступ запрещен.");
      return;
    }

    const index = Number(ctx.message.text.split(" ").slice(1).join(" ").trim());
    if (!Number.isFinite(index) || index < 1) {
      await ctx.reply("Использование: /removetopic <номер>");
      return;
    }

    try {
      const res = await apiFetch<{ status: string; queueId: string; queue: ApiQueueItem[] }>(
        apiBaseUrl,
        "/queue/remove",
        {
          method: "POST",
          body: JSON.stringify({ index }),
        },
      );
      const lines = formatQueueTopicLines(res.queue);
      await ctx.reply([`Тема удалена`, `queueId: ${res.queueId}`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.reply(`Ошибка removetopic: ${(error as Error).message}`);
    }
  });

  bot.action(/^wk_(delete_yes|keep|delete_no)\|([^|]+)\|(\d+)$/, async (ctx) => {
    if (!ctx.from || !ensureAllowed(ctx.from.id, adminIds)) {
      await ctx.answerCbQuery("Доступ запрещен.");
      return;
    }

    const action = ctx.match[1];
    const queueId = ctx.match[2];
    const index = Number(ctx.match[3]);

    try {
      if (action === "keep") {
        await ctx.answerCbQuery("Оставили тему в очереди.");
        await ctx.reply(`Ок, тема #${index} оставлена в очереди (queueId: ${queueId}).`);
        return;
      }

      const res = await apiFetch<{ status: string; queueId: string; queue: ApiQueueItem[] }>(
        apiBaseUrl,
        "/queue/remove",
        {
          method: "POST",
          body: JSON.stringify({ index }),
        },
      );
      const lines = formatQueueTopicLines(res.queue);
      await ctx.answerCbQuery("Тема удалена из очереди.");
      await ctx.reply([`Тема #${index} удалена`, `queueId: ${res.queueId}`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.answerCbQuery("Ошибка");
      await ctx.reply(`Ошибка действия по теме #${index}: ${(error as Error).message}`);
    }
  });

  bot.on("text", async (ctx, next) => {
    if (!ensureAllowed(ctx.from.id, adminIds)) {
      return next();
    }

    if (addTopicModeUsers.has(ctx.from.id)) {
      if (ctx.message.text.startsWith("/")) {
        return next();
      }
      try {
        await appendTopic(ctx.from.id, ctx.message.text, (text) => ctx.reply(text));
      } catch (error) {
        await ctx.reply(`Ошибка addtopic: ${(error as Error).message}`);
      }
      return;
    }

    if (!replaceModeUsers.has(ctx.from.id)) {
      return next();
    }

    if (ctx.message.text.startsWith("/")) {
      return next();
    }

    const topics = parseTopicsText(ctx.message.text);
    if (topics.length < 1) {
      await ctx.reply("Нужна минимум 1 тема. Отправьте заново.");
      return;
    }

    try {
      const res = await apiFetch<{ status: string; queueId: string; queue: ApiQueueItem[] }>(
        apiBaseUrl,
        "/queue/replace",
        {
          method: "POST",
          body: JSON.stringify({ topics }),
        },
      );
      replaceModeUsers.delete(ctx.from.id);
      const lines = formatQueueTopicLines(res.queue);
      await ctx.reply([`Список тем обновлен`, `queueId: ${res.queueId}`, "", ...lines].join("\n"));
    } catch (error) {
      await ctx.reply(`Ошибка replaceposts: ${(error as Error).message}`);
    }
  });

  bot.catch(async (error, ctx) => {
    console.error("bot error", error);
    await ctx.reply("Внутренняя ошибка бота.");
  });

  await bot.launch();
  let lastWeeklyPublicationDate = "";
  let lastThursdayDraftDate = "";
  let lastSundayReminderDate = "";
  setInterval(async () => {
    try {
      const now = getZonedNowParts(botTimeZone);
      if (
        now.weekday === "Sun" &&
        now.hour === weeklyPostHour &&
        now.minute === weeklyPostMinute &&
        now.dateKey !== lastWeeklyPublicationDate
      ) {
        const res = await apiFetch<ApiQueueResponse>(apiBaseUrl, "/queue/next10");
        if (!Array.isArray(res.queue)) return;
        const lines = formatQueueScheduleLines(res.queue as ApiQueueItem[]);
        const message = [`Еженедельная очередь на 10 недель`, `queueId: ${res.queueId ?? "n/a"}`, "", ...lines].join(
          "\n\n",
        );
        const targets = targetChatId ? [targetChatId] : Array.from(adminIds);
        for (const chatId of targets) {
          await bot.telegram.sendMessage(chatId, message);
        }
        lastWeeklyPublicationDate = now.dateKey;
      }

      const utc = getUtcNowParts();
      const targets = targetChatId ? [targetChatId] : Array.from(adminIds);

      // Thursday, 09:00 UTC: send draft for current week topic.
      if (utc.weekday === 4 && utc.hour === 9 && utc.minute === 0 && utc.dateKey !== lastThursdayDraftDate) {
        const latest = await tryLoadLatestQueue(apiBaseUrl);
        if (latest?.queueId && Array.isArray(latest.queue) && latest.queue.length > 0) {
          const current = getCurrentWeekItem(latest.queue, utc.dateKey);
          if (current) {
            const draftRes = await apiFetch<{ status: string; draft: ApiDraft }>(apiBaseUrl, "/draft", {
              method: "POST",
              body: JSON.stringify({
                queueItem: current.rank,
                queueId: latest.queueId,
              }),
            });
            const message = [
              "Черновик на текущую неделю",
              `Тема #${current.rank}: ${current.topic}`,
              `Неделя: ${current.weekStart} - ${current.weekEnd}`,
              "",
              draftRes.draft.text,
            ].join("\n");
            for (const chatId of targets) {
              await bot.telegram.sendMessage(chatId, message);
            }
          }
        }
        lastThursdayDraftDate = utc.dateKey;
      }

      // Sunday, 09:00 UTC: reminder for the same week topic with 3 actions.
      if (utc.weekday === 0 && utc.hour === 9 && utc.minute === 0 && utc.dateKey !== lastSundayReminderDate) {
        const latest = await tryLoadLatestQueue(apiBaseUrl);
        if (latest?.queueId && Array.isArray(latest.queue) && latest.queue.length > 0) {
          const current = getCurrentWeekItem(latest.queue, utc.dateKey);
          if (current) {
            const text = [
              "Напоминание по теме текущей недели",
              `Тема #${current.rank}: ${current.topic}`,
              "",
              "Выберите действие:",
            ].join("\n");
            const keyboard = Markup.inlineKeyboard([
              [Markup.button.callback("Да, удали тему из очереди", `wk_delete_yes|${latest.queueId}|${current.rank}`)],
              [Markup.button.callback("Нет, не удаляй тему из очереди", `wk_keep|${latest.queueId}|${current.rank}`)],
              [Markup.button.callback("Нет, удаляй тему из очереди", `wk_delete_no|${latest.queueId}|${current.rank}`)],
            ]);
            for (const chatId of targets) {
              await bot.telegram.sendMessage(chatId, text, keyboard);
            }
          }
        }
        lastSundayReminderDate = utc.dateKey;
      }
    } catch (error) {
      console.error("weekly queue publish failed", error);
    }
  }, 60_000);

  console.log("bot service started", {
    apiBaseUrl,
    admins: Array.from(adminIds),
    botTimeZone,
    weeklyPostHour,
    weeklyPostMinute,
    targetChatId,
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
