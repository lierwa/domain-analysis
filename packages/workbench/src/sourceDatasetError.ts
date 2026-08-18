export class SourceDatasetError extends Error {
  constructor(readonly code: "run_not_found" | "snapshot_not_found" | "export_failed", message: string) {
    super(message);
    this.name = "SourceDatasetError";
  }
}
