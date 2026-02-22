import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface HistoryPost {
  id: string;
  published_at: string;
  text: string;
  media?: string[];
  metrics?: Record<string, number>;
}

export interface HistoryFile {
  channel: string;
  platform: "telegram";
  posts: HistoryPost[];
}

export interface IndexedPost extends HistoryPost {
  channel: string;
  sourceFile: string;
}

interface TelegramReaction {
  count?: number;
}

interface TelegramMessage {
  id?: number | string;
  type?: string;
  date?: string;
  text?: string | Array<string | { text?: string }>;
  photo?: string;
  file_name?: string;
  media_type?: string;
  reactions?: TelegramReaction[];
}

interface TelegramExportFile {
  name?: string;
  type?: string;
  messages?: TelegramMessage[];
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkJsonFiles(fullPath);
      }
      return fullPath.endsWith(".json") ? [fullPath] : [];
    }),
  );
  return files.flat();
}

function parseHistoryFile(raw: string, sourceFile: string): HistoryFile {
  const parsed = JSON.parse(raw) as Partial<HistoryFile> & TelegramExportFile;

  if (parsed.channel && parsed.platform === "telegram" && Array.isArray(parsed.posts)) {
    return parsed as HistoryFile;
  }

  if (parsed.type === "public_channel" && parsed.name && Array.isArray(parsed.messages)) {
    return convertTelegramExport(parsed, sourceFile);
  }

  throw new Error(`Invalid history file schema: ${sourceFile}`);
}

function normalizeTelegramText(
  text: string | Array<string | { text?: string }> | undefined,
): string {
  if (typeof text === "string") {
    return text;
  }
  if (!Array.isArray(text)) {
    return "";
  }
  return text
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (chunk && typeof chunk.text === "string") return chunk.text;
      return "";
    })
    .join("");
}

function extractMedia(message: TelegramMessage): string[] | undefined {
  const media: string[] = [];
  if (typeof message.photo === "string" && message.photo.length > 0) {
    media.push(message.photo);
  }
  if (typeof message.file_name === "string" && message.file_name.length > 0) {
    media.push(message.file_name);
  }
  if (typeof message.media_type === "string" && message.media_type.length > 0) {
    media.push(message.media_type);
  }
  return media.length > 0 ? media : undefined;
}

function extractMetrics(message: TelegramMessage): Record<string, number> | undefined {
  if (!Array.isArray(message.reactions) || message.reactions.length === 0) {
    return undefined;
  }
  const reactions = message.reactions.reduce((sum, item) => {
    return sum + (typeof item.count === "number" ? item.count : 0);
  }, 0);
  return { reactions };
}

function convertTelegramExport(parsed: TelegramExportFile, sourceFile: string): HistoryFile {
  const messages = parsed.messages ?? [];
  const posts: HistoryPost[] = messages
    .filter((message) => message.type === "message" && message.id != null && typeof message.date === "string")
    .map((message) => {
      const text = normalizeTelegramText(message.text);
      return {
        id: String(message.id),
        published_at: message.date as string,
        text,
        media: extractMedia(message),
        metrics: extractMetrics(message),
      };
    })
    .filter((post) => post.text.trim().length > 0);

  if (!parsed.name) {
    throw new Error(`Invalid telegram export schema: ${sourceFile}`);
  }

  return {
    channel: parsed.name,
    platform: "telegram",
    posts,
  };
}

export async function loadHistoryFromDir(historyRoot: string): Promise<IndexedPost[]> {
  const jsonFiles = await walkJsonFiles(historyRoot);
  const indexedPosts: IndexedPost[] = [];

  for (const filePath of jsonFiles) {
    const raw = await readFile(filePath, "utf-8");
    const history = parseHistoryFile(raw, filePath);
    for (const post of history.posts) {
      indexedPosts.push({
        ...post,
        channel: history.channel,
        sourceFile: filePath,
      });
    }
  }

  return indexedPosts.sort((a, b) => {
    const ta = Date.parse(a.published_at);
    const tb = Date.parse(b.published_at);
    return Number.isNaN(tb - ta) ? 0 : tb - ta;
  });
}
