import { sourceSnapshotRecordSchema, type SourceDatasetRunView } from "@domain-analysis/shared";
import { stringify } from "csv-stringify/sync";

const columns = [
  "run_id", "target_key", "snapshot_id", "source_identity", "object_kind", "external_key",
  "requested_url", "final_url", "state", "observed_at", "media_type", "asset_count",
  "asset_filenames", "resource_reference_count", "resource_references", "payload",
] as const;

export async function* serializeSourceDataset(
  view: SourceDatasetRunView,
  format: "jsonl" | "csv",
): AsyncIterable<string> {
  if (format === "jsonl") {
    for (const record of view.records) yield `${JSON.stringify(sourceSnapshotRecordSchema.parse(record))}\n`;
    return;
  }
  const rows = view.records.map((record) => {
    const payload = record.snapshot.payload;
    return secure({
      run_id: view.run.id,
      target_key: record.snapshot.targetKey ?? "",
      snapshot_id: record.snapshot.id,
      source_identity: record.object.sourceIdentity,
      object_kind: record.object.kind,
      external_key: record.object.externalKey,
      requested_url: record.snapshot.observation.requestedUrl,
      final_url: record.snapshot.observation.finalUrl ?? "",
      state: record.snapshot.observation.state,
      observed_at: record.snapshot.observation.observedAt,
      media_type: payload && "mediaType" in payload ? payload.mediaType : payload?.kind ?? "",
      asset_count: String(record.assets.length),
      asset_filenames: record.assets.map((asset) => asset.filename).join(" | "),
      resource_reference_count: String(record.resourceReferences.length),
      resource_references: JSON.stringify(record.resourceReferences.map((reference) => ({
        kind: reference.kind,
        sourceUrl: reference.sourceUrl,
        observedValue: reference.observedValue,
        locator: reference.locator,
        role: reference.role,
        section: reference.section,
        ordinal: reference.ordinal,
      }))),
      payload: payload?.kind === "inline_text" ? payload.text : JSON.stringify(payload ?? null),
    });
  });
  yield stringify(rows, { header: true, columns, record_delimiter: "unix" });
}

function secure<T extends Record<string, string>>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key, /^[=+\-@]/.test(value) ? `'${value}` : value,
  ])) as T;
}
