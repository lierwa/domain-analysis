import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  crawlPlanningRuntimeOutputSchema,
  type CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";

import type {
  CrawlPlanningRuntime,
  CrawlPlanningRuntimeEvent,
} from "./crawlPlanningModule";
import { finalizingActivity, projectCodexAppServerActivity } from "./codexAppServerActivity";
import {
  CodexAppServerError,
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerResult,
} from "./codexAppServerClient";
import { parseCodexStructuredOutput, zodSchemaToCodexJsonSchema } from "./codexStructuredOutput";

export interface CodexCrawlPlanningRuntimeOptions {
  repositoryRoot: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
}

export function createCodexCrawlPlanningRuntime(
  options: CodexCrawlPlanningRuntimeOptions,
): CrawlPlanningRuntime {
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-crawl-planning");
  const skillPath = path.join(runtimeCwd, ".agents", "skills", "plan-product-crawl", "SKILL.md");
  const client = createCodexAppServerClient({
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    webSearch: true,
    skill: { name: "plan-product-crawl", path: skillPath },
  });
  return {
    run: (input) => runPlanning(options, client, runtimeCwd, skillPath, input),
    close: () => client.close(),
  };
}

async function* runPlanning(
  options: CodexCrawlPlanningRuntimeOptions,
  client: CodexAppServerClient,
  runtimeCwd: string,
  skillPath: string,
  input: Parameters<CrawlPlanningRuntime["run"]>[0],
): AsyncIterable<CrawlPlanningRuntimeEvent> {
  await mkdir(path.dirname(skillPath), { recursive: true });
  await copyFile(path.join(options.repositoryRoot, ".agents", "skills", "plan-product-crawl", "SKILL.md"), skillPath);
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  // WHY：规划运行时复用自己的 stdio 连接；每次规划仍是独立 ephemeral thread，不持久化 Codex 对话。
  for await (const item of client.run(planningPrompt(input), input.signal)) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = projectCodexAppServerActivity(item, eventSequence, {
        lifecycle: "启动抓取计划 Agent",
        analysis: "核对任务范围并规划来源",
        finalizing: "整理并校验抓取计划",
      });
      if (activity?.id === "turn-finalizing") {
        if (finalizingStarted && activity.status === "running") continue;
        finalizingStarted = true;
      }
      if (activity) yield { type: "activity", activity };
      continue;
    }
    result = item.result;
  }
  if (!result) throw new Error("Codex 抓取规划流未返回结果");
  if (result.interrupted) {
    yield { type: "interrupted" };
    return;
  }
  requireWebResearch(result);
  const output = parseOutput(result.outputText ?? "", result.observedEvents);
  if (!finalizingStarted) {
    yield { type: "activity", activity: finalizingActivity("整理并校验抓取计划", "running") };
  }
  yield { type: "activity", activity: finalizingActivity("整理并校验抓取计划", "completed") };
  yield { type: "completed", output };
}

function planningPrompt(input: Parameters<CrawlPlanningRuntime["run"]>[0]) {
  const topics = [...input.task.content.generalTopics, ...input.task.content.categoryTopics];
  return [
    "$plan-product-crawl 请严格执行该 Skill。Skill 已由 Workbench 显式注入；不要通过本地命令读取 Skill、仓库、AGENTS.md 或 Git 状态。",
    "你只制定计划，不运行批量抓取、不登录、不下载文件、不访问 Cookie/Profile，也不生成 Source Run。",
    "必须使用 web search 核实具体发布者和入口。当前 contract 只允许把来源标为 search_discovered、accessState 写 unknown；真实页面可访问性与 Provider 能力必须写入 executionBlockers，不能凭空宣布通过。observedAt 会由 Workbench 覆盖为真实完成时间。",
    "计划必须直接决定来源、内容和数量。每个任务 topic 必须按下面完全一致的原文至少出现在一个 target.taskTopics 中，不能改写或新增 topic。",
    `Required task topics: ${JSON.stringify(topics)}`,
    "quantity.mode 只能是 all_available、target_count 或 sample。target_count/sample 必须给正整数；all_available 也必须写清可审核分母和停止口径。不得使用‘尽量多’。",
    "不得编造 Provider key、频率数值、登录许可或反风控能力；尚未验证的执行前提写入 executionBlockers。",
    "执行期间只用 commentary 普通中文持续解释搜索与判断；commentary 不能输出 JSON。final_answer 只返回符合 JSON Schema 的对象，不加 Markdown 代码块。",
    `Final answer JSON Schema: ${JSON.stringify(zodSchemaToCodexJsonSchema(crawlPlanningRuntimeOutputSchema))}`,
    `Capture Task: ${JSON.stringify(input.task)}`,
    `Previous plan versions: ${JSON.stringify(input.previousPlans.slice(0, 3))}`,
    `User revision instruction: ${JSON.stringify(input.instruction ?? "首次制定计划")}`,
  ].join("\n\n");
}

function requireWebResearch(result: CodexAppServerResult) {
  if (!result.observedItemTypes.includes("web_search")) {
    throw new CodexAppServerError(
      "invalid_output",
      "抓取计划缺少本轮真实网页搜索记录，请重试。",
      `events=${result.observedEvents.join(",")} itemTypes=${result.observedItemTypes.join(",")}`,
    );
  }
}

function parseOutput(text: string, observedEvents: string[]): CrawlPlanningRuntimeOutput {
  return parseCodexStructuredOutput({
    text,
    schema: crawlPlanningRuntimeOutputSchema,
    label: "Codex 返回的抓取计划",
    observedEvents,
  });
}
