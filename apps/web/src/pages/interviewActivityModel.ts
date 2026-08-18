import type { InterviewTurnActivity } from "@domain-analysis/shared";

export function mergeInterviewActivity(
  current: InterviewTurnActivity[],
  next: InterviewTurnActivity,
) {
  const settled = current.map((activity) => activity.status === "running" && activity.id !== next.id
    ? { ...activity, status: "completed" as const }
    : activity);
  const existingIndex = settled.findIndex((activity) => activity.id === next.id);
  if (existingIndex < 0) return [...settled, next];
  return settled.map((activity, index) => index === existingIndex
    ? { ...activity, ...next, detail: next.detail ?? activity.detail }
    : activity);
}

export function completeInterviewActivities(current: InterviewTurnActivity[]) {
  return current.map((activity) => activity.status === "running"
    ? { ...activity, status: "completed" as const }
    : activity);
}

export function failInterviewActivities(current: InterviewTurnActivity[]) {
  let failed = false;
  return [...current].reverse().map((activity) => {
    if (!failed && activity.status === "running") {
      failed = true;
      return { ...activity, status: "failed" as const };
    }
    return activity;
  }).reverse();
}
