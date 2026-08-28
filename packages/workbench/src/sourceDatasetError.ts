export class SourceDatasetError extends Error {
  constructor(readonly code: "batch_not_found" | "run_not_found" | "snapshot_not_found"
    | "asset_not_found" | "invalid_state" | "export_failed", message: string) {
    super(message);
    this.name = "SourceDatasetError";
  }
}
