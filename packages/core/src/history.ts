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
  const parsed = JSON.parse(raw) as Partial<HistoryFile>;
  if (!parsed.channel || parsed.platform !== "telegram" || !Array.isArray(parsed.posts)) {
    throw new Error(`Invalid history file schema: ${sourceFile}`);
  }
  return parsed as HistoryFile;
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
