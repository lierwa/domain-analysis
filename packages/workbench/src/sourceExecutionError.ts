export class SourceExecutionError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state" | "preflight_failed",
    message: string,
  ) {
    super(message);
    this.name = "SourceExecutionError";
  }
}
