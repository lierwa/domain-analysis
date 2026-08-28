import { z } from "zod";

export const modelReasoningEffortSchema = z.enum([
  "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

export const taskModelSelectionSchema = z.object({
  modelId: z.string().min(1).max(240),
  reasoningEffort: modelReasoningEffortSchema,
}).strict();

export type TaskModelSelection = z.infer<typeof taskModelSelectionSchema>;

export const DEFAULT_TASK_MODEL_SELECTION: TaskModelSelection = {
  modelId: "gpt-5.6-terra",
  reasoningEffort: "medium",
};
