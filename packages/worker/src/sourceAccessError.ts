export type SourceAccessFailureCode =
  | "origin_not_allowed"
  | "source_abnormal"
  | "evidence_not_found"
  | "login_required"
  | "verification_required"
  | "access_denied"
  | "rate_limited";

export class SourceAccessError extends Error {
  constructor(
    readonly code: SourceAccessFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SourceAccessError";
  }
}
