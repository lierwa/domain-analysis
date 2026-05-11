import { join } from "node:path";
import { hasExcludedKeyword, type CollectedRawContent, type CollectionAdapter } from "./types";
import { runExternalCollectorCommand } from "../collectors/externalCollector";

interface YoutubeCollectorRow {
  videoId?: string;
  url?: string;
  title?: string;
  channel?: string;
  channelHandle?: string;
  transcript?: string;
  description?: string;
  metrics?: Record<string, unknown>;
  publishedAt?: string;
  raw?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 120000;

export function createYoutubeAdapter(env: NodeJS.ProcessEnv = process.env, timeoutMs = DEFAULT_TIMEOUT_MS): CollectionAdapter {
  return {
    async collect(query) {
      const command = env.YOUTUBE_COLLECTOR_COMMAND || getDefaultPythonCommand(env);
      const args = env.YOUTUBE_COLLECTOR_ARGS
        ? splitCommandArgs(env.YOUTUBE_COLLECTOR_ARGS)
        : [getDefaultYoutubeCollectorPath()];
      const result = await runExternalCollectorCommand({
        command,
        args,
        timeoutMs,
        input: {
          platform: "youtube",
          query,
          config: {
            mode: env.YOUTUBE_COLLECTION_MODE || "yt_dlp_transcript"
          }
        }
      });

      return normalizeYoutubeCollectorItems(result.items as YoutubeCollectorRow[], query.excludeKeywords).slice(
        0,
        query.limitPerRun
      );
    }
  };
}

export function normalizeYoutubeCollectorItems(
  rows: YoutubeCollectorRow[],
  excludeKeywords: string[] = []
): CollectedRawContent[] {
  return rows
    .map((row) => {
      const url = row.url || (row.videoId ? `https://www.youtube.com/watch?v=${row.videoId}` : "");
      const text = [row.title, row.transcript || row.description].filter(Boolean).join("\n\n").trim();
      return { row, url, text };
    })
    .filter(({ url, text }) => url && text && !isBlockedYoutubeText(url, text) && !hasExcludedKeyword(text, excludeKeywords))
    .map(({ row, url, text }) => ({
      platform: "youtube" as const,
      externalId: row.videoId,
      url,
      authorName: row.channel,
      authorHandle: row.channelHandle,
      text,
      metricsJson: row.metrics,
      publishedAt: row.publishedAt,
      rawJson: row.raw
    }));
}

function getDefaultPythonCommand(env: NodeJS.ProcessEnv) {
  return env.PYTHON_COMMAND || "python";
}

function getDefaultYoutubeCollectorPath() {
  return join(process.cwd(), "scripts/collectors/youtube_collector.py");
}

function isBlockedYoutubeText(url: string, text: string) {
  const haystack = `${url}\n${text}`.toLowerCase();
  // WHY: YouTube 登录/验证页不是领域内容，写入 raw_contents 会污染后续分析和报告。
  // TRADE-OFF: 这里采用保守过滤，可能跳过少量讨论登录页的公开视频，但适合个人低频分析工具。
  return ["sign in to confirm", "verify you are not a bot", "captcha", "login"].some((keyword) =>
    haystack.includes(keyword)
  );
}

function splitCommandArgs(value: string) {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}
