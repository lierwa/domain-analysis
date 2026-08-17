export type SourceDatasetErrorCode =
  | "project_not_confirmed"
  | "collection_lane_not_found"
  | "plan_not_found"
  | "plan_mismatch"
  | "run_not_found"
  | "run_closed"
  | "idempotency_conflict"
  | "snapshot_not_found"
  | "asset_reference_not_found"
  | "asset_too_large";

export class SourceDatasetError extends Error {
  constructor(readonly code: SourceDatasetErrorCode, message: string) {
    super(message);
    this.name = "SourceDatasetError";
  }
}
