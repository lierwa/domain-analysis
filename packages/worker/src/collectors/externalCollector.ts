import { spawn } from "node:child_process";
import type { Platform } from "@domain-analysis/shared";
import type { CollectedRawContent, CollectionQuery } from "../adapters/types";

export type ExternalCollectorErrorCode = "login_required" | "rate_limited" | "parse_failed" | "no_content" | "failed";

export interface ExternalCollectorInput {
  platform: Platform;
  query: Partial<CollectionQuery>;
  config: Record<string, unknown>;
}

export interface ExternalCollectorRunOptions {
  command: string;
  args: string[];
  input: ExternalCollectorInput;
  timeoutMs: number;
}

export interface ExternalCollectorSuccess {
  items: CollectedRawContent[];
}

export class ExternalCollectorError extends Error {
  constructor(
    public readonly code: ExternalCollectorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExternalCollectorError";
  }
}

export function createExternalCollectorError(code: ExternalCollectorErrorCode, message: string) {
  return new ExternalCollectorError(code, message);
}

export async function runExternalCollectorCommand(options: ExternalCollectorRunOptions): Promise<ExternalCollectorSuccess> {
  const stdout = await runProcessWithJsonInput(options);
  return parseCollectorStdout(stdout);
}

function runProcessWithJsonInput(options: ExternalCollectorRunOptions) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(options.command, options.args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      reject(createExternalCollectorError("rate_limited", "external collector timed out"));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(createExternalCollectorError("parse_failed", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(createExternalCollectorError("parse_failed", stderr.trim() || `collector exited with ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(JSON.stringify(options.input));
  });
}

function parseCollectorStdout(stdout: string): ExternalCollectorSuccess {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw createExternalCollectorError("parse_failed", "external collector returned malformed JSON");
  }

  if (isCollectorErrorEnvelope(payload)) {
    throw createExternalCollectorError(normalizeErrorCode(payload.error.code), payload.error.message);
  }

  if (!isCollectorSuccessEnvelope(payload)) {
    throw createExternalCollectorError("parse_failed", "external collector JSON does not match the contract");
  }

  return { items: payload.items };
}

function isCollectorSuccessEnvelope(payload: unknown): payload is ExternalCollectorSuccess {
  return typeof payload === "object" && payload !== null && Array.isArray((payload as { items?: unknown }).items);
}

function isCollectorErrorEnvelope(
  payload: unknown
): payload is { error: { code: string; message: string } } {
  if (typeof payload !== "object" || payload === null) return false;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  return typeof (error as { code?: unknown }).code === "string" && typeof (error as { message?: unknown }).message === "string";
}

function normalizeErrorCode(code: string): ExternalCollectorErrorCode {
  if (code === "login_required" || code === "rate_limited" || code === "parse_failed" || code === "no_content") {
    return code;
  }
  return "failed";
}
