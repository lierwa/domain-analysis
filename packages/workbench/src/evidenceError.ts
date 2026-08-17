export type EvidenceErrorCode =
  | "not_found"
  | "project_not_confirmed"
  | "request_outside_confirmed_scope"
  | "observation_not_accessible"
  | "candidate_rejected"
  | "integrity_mismatch";

export class EvidenceError extends Error {
  constructor(readonly code: EvidenceErrorCode, message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}
