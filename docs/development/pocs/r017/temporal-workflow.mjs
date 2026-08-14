import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

export const approveSignal = defineSignal("approve");
export const statusQuery = defineQuery("status");

const { recordStage } = proxyActivities({ startToCloseTimeout: "10 seconds" });

export async function pipelineWorkflow(input) {
  let approved = false;
  let status = "collecting";
  setHandler(approveSignal, () => { approved = true; });
  setHandler(statusQuery, () => status);

  await recordStage(input.runId, "collect");
  status = "waiting_review";
  await condition(() => approved);
  status = "packaging";
  await recordStage(input.runId, "package");
  return { runId: input.runId, status: "completed" };
}
