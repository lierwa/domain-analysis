import { createHash } from "node:crypto";

import type { FrozenPipelineInput, PipelineCommand } from "@domain-analysis/shared";
import canonicalize from "canonicalize";

export function pipelineIdentity(input: FrozenPipelineInput) {
  return `pipeline-${hashCanonical(input)}`;
}

export function commandId(runId: string, command: PipelineCommand) {
  return `command-${hashCanonical({ runId, command })}`;
}

export function stageId(runId: string, stage: string) {
  return `${runId}:${stage}`;
}

export function interventionTopic(interventionId: string) {
  return `pipeline-intervention:${interventionId}`;
}

export function hashCanonical(value: unknown) {
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("RFC 8785 无法序列化流水线身份");
  return createHash("sha256").update(serialized).digest("hex");
}
