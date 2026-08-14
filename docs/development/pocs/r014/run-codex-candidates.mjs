import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Codex } from "@openai/codex-sdk";

import { sha256, writeImmutableJson } from "../lib/poc-artifact.mjs";
import {
  assertKnownEvidenceReferences,
  buildCodexJsonSchema,
  codexOutputSchema,
} from "./candidate-schema.mjs";

const CONNECTORS_DEPRECATION = /^`\[features\]\.connectors` is deprecated\./;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const dataRoot = await realpath(path.join(projectRoot, "data/pocs/r014"));
  const inputPath = await realpath(requireArgument(process.argv[2], "extraction.json 路径"));
  const imagePath = await realpath(path.join(dataRoot, "inputs/manual/page-05.png"));
  assertInside(dataRoot, inputPath);
  assertInside(dataRoot, imagePath);

  const [inputText, image] = await Promise.all([readFile(inputPath, "utf8"), readFile(imagePath)]);
  const source = JSON.parse(inputText);
  const modelInput = buildPrimaryCandidateInput(source);
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: projectRoot,
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
  });
  const turn = await thread.run(
    [
      { type: "text", text: buildPrompt(modelInput) },
      { type: "local_image", path: imagePath },
    ],
    { outputSchema: buildCodexJsonSchema() },
  );
  const nonBlockingSdkWarnings = assertNoBlockingErrorItems(turn.items);
  const candidates = codexOutputSchema.parse(JSON.parse(turn.finalResponse));
  assertKnownEvidenceReferences(candidates, modelInput.evidence);

  const attemptId = new Date().toISOString().replaceAll(":", "-");
  const outputRoot = path.join(dataRoot, "codex", attemptId);
  await mkdir(outputRoot, { recursive: true });
  const artifact = await writeImmutableJson(path.join(outputRoot, "candidates.json"), {
    schemaVersion: "r014-codex-run-v3",
    createdAt: new Date().toISOString(),
    threadId: thread.id,
    input: {
      extractionSha256: sha256(inputText),
      modelInputSha256: sha256(JSON.stringify(modelInput)),
      imageSha256: sha256(image),
    },
    usage: turn.usage,
    itemTypes: turn.items.map(({ type }) => type),
    nonBlockingSdkWarnings,
    candidates,
  });
  console.log(
    JSON.stringify({
      attemptId,
      threadId: thread.id,
      claims: candidates.claims.length,
      conflicts: candidates.conflicts.length,
      unknowns: candidates.unknowns.length,
      artifact,
    }, null, 2),
  );
}

export function buildPrimaryCandidateInput(source) {
  return {
    schemaVersion: source.schemaVersion,
    modelKey: source.modelKey,
    variants: source.variants,
    evidence: source.evidence,
    comparison: source.comparison,
  };
}

export function assertNoBlockingErrorItems(items) {
  const errors = items.filter(({ type }) => type === "error");
  const blocking = errors.filter(({ message }) => !CONNECTORS_DEPRECATION.test(message));
  if (blocking.length > 0) {
    // WHY：SDK 的非致命错误可能与最终文本同时出现，未知错误不能被误记为成功证据。
    throw new Error(`Codex 本轮包含错误条目：${blocking.map(({ message }) => message).join("；")}`);
  }
  // WHY：这是用户级旧配置键的迁移提示，与本轮证据处理无关；保留原文用于审计。
  return errors.map(({ message }) => message);
}

function buildPrompt(source) {
  return `你是商品知识候选加工器。只使用下方 JSON 证据和随附的 PDF 第 5 页图片，不浏览、不读其他文件、不补常识。

规则：
1. 每条 claim 必须逐字复制输入中存在的 sourceObjectId、snapshotSha256、locator；禁止创造证据。
2. 所有 Codex 结论只能是 review_required，不能标记已确认或已发布。
3. 官网颜色不同是销售变体差异，不是同一事实冲突；某一页面缺字段是缺失，不是数值冲突。
4. 监管表证明备案与能效等级，不自动证明当前在售；PDF 参数若声明以铭牌为准，必须写入 limitations。
5. 生成 6 至 10 条高价值候选，覆盖身份、核心规格、能效备案、使用条件或机制；证据不够的内容进入 unknowns。
6. conflicts 只能包含同一身份、同一属性、不同值且都有直接证据的情况；没有就返回空数组。
7. claimId 使用 C001 起的连续编号，conflictId 使用 X001 起的连续编号，unknownId 使用 U001 起的连续编号。

输入证据：
${JSON.stringify(source)}`;
}

function requireArgument(value, label) {
  if (!value) throw new Error(`缺少 ${label}`);
  return value;
}

function assertInside(root, target) {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("R-014 输入路径越界");
  }
}
