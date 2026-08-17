import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import ndjson from "ndjson";
import { z } from "zod";

const codexExecEventSchema = z.object({
  type: z.string(),
  item: z.object({ type: z.string() }).passthrough().optional(),
}).passthrough();

export interface CodexExecClientOptions {
  cwd: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  outputSchema: object;
  executable?: string;
  timeoutMs?: number;
  webSearch?: boolean;
  skipGitRepoCheck?: boolean;
  packageRoot?: string;
}

export interface CodexExecResult {
  interrupted: boolean;
  outputText?: string;
  observedEvents: string[];
  observedItemTypes: string[];
}

export async function runCodexExec(
  options: CodexExecClientOptions,
  prompt: string,
  signal?: AbortSignal,
): Promise<CodexExecResult> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "domain-analysis-codex-exec-"));
  const schemaPath = path.join(temporaryRoot, "output-schema.json");
  const outputPath = path.join(temporaryRoot, "last-message.json");
  const observedEvents = new Set<string>();
  const observedItemTypes = new Set<string>();
  try {
    await writeFile(schemaPath, JSON.stringify(options.outputSchema));
    const codexArgs = codexExecArgs(options, schemaPath, outputPath);
    // WHY：生产默认通过项目已锁定的官方 @openai/codex 包运行，避免命中机器上损坏或漂移的全局 CLI。
    const executable = options.executable ?? "npm";
    const executableArgs = options.executable
      ? codexArgs
      : ["--prefix", options.packageRoot ?? options.cwd, "exec", "--", "codex", ...codexArgs];
    const subprocess = execa(executable, executableArgs, {
      cwd: options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      reject: false,
      cleanup: true,
      timeout: options.timeoutMs ?? 180_000,
      forceKillAfterDelay: 2_000,
    });
    if (!subprocess.stdin || !subprocess.stdout) throw new Error("Codex exec stdio 未建立管道");
    subprocess.stdout.pipe(ndjson.parse()).on("data", (input: unknown) => {
      const event = codexExecEventSchema.safeParse(input);
      if (event.success) {
        observedEvents.add(event.data.type);
        if (event.data.item) observedItemTypes.add(event.data.item.type);
      }
    });
    const interrupt = () => subprocess.kill("SIGTERM");
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) interrupt();
    subprocess.stdin.end(prompt);
    try {
      const result = await subprocess;
      if (signal?.aborted || result.signal) {
        return {
          interrupted: true,
          observedEvents: [...observedEvents],
          observedItemTypes: [...observedItemTypes],
        };
      }
      if (result.exitCode !== 0) {
        const diagnostic = String(result.stderr ?? "")
          .replace(/[\r\n]+/g, " ")
          .trim()
          .slice(-2_000);
        throw new Error(
          `Codex exec 失败（exitCode=${result.exitCode}, events=${[...observedEvents].join(",")}, stderr=${diagnostic || "empty"}）`,
        );
      }
      let outputText: string;
      try {
        outputText = await readFile(outputPath, "utf8");
      } catch (error) {
        const diagnostic = String(result.stderr ?? result.stdout ?? "")
          .replace(/[\r\n]+/g, " ").trim().slice(-2_000);
        throw new Error(
          `Codex exec 未生成结构化输出（events=${[...observedEvents].join(",")}, diagnostic=${diagnostic || "empty"}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        interrupted: false,
        outputText,
        observedEvents: [...observedEvents],
        observedItemTypes: [...observedItemTypes],
      };
    } finally {
      signal?.removeEventListener("abort", interrupt);
    }
  } finally {
    // WHY：schema 和最终输出只用于本轮协议校验；任何成功、失败或取消都不能把临时模型内容留在磁盘。
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function codexExecArgs(
  options: CodexExecClientOptions,
  schemaPath: string,
  outputPath: string,
) {
  const args = [
    "--ask-for-approval", "never",
    "exec",
    "--ephemeral",
    "--json",
    "--model", options.model,
    "--sandbox", "read-only",
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    "--config", `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
    "-",
  ];
  if (options.webSearch) args.splice(2, 0, "--search");
  if (options.skipGitRepoCheck) args.splice(args.indexOf("--ephemeral") + 1, 0, "--skip-git-repo-check");
  return args;
}
