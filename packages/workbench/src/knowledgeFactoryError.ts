export class KnowledgeFactoryError extends Error {
  constructor(
    readonly code: "project_not_confirmed" | "request_not_found" | "input_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeFactoryError";
  }
}
