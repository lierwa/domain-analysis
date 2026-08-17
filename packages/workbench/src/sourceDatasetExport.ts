import {
  sourceSnapshotRecordSchema,
  type SourceCollectionRunView,
  type SourceSnapshotRecord,
} from "@domain-analysis/shared";
import { stringify } from "csv-stringify/sync";

const csvColumns = [
  "run_id",
  "snapshot_id",
  "object_kind",
  "external_key",
  "observation_state",
  "content_kind",
  "path",
  "name",
  "value",
  "unit",
  "position",
  "source_url",
] as const;

type CsvColumn = typeof csvColumns[number];
type CsvRow = Record<CsvColumn, string | number>;

export class SourceDatasetExportError extends Error {
  constructor(readonly code: "csv_content_unsupported", message: string) {
    super(message);
    this.name = "SourceDatasetExportError";
  }
}

export async function* serializeSourceCollectionRun(
  view: SourceCollectionRunView,
  format: "jsonl" | "csv",
): AsyncIterable<string> {
  if (format === "jsonl") {
    for (const record of view.records) {
      yield `${JSON.stringify(sourceSnapshotRecordSchema.parse(record))}\n`;
    }
    return;
  }

  let first = true;
  for (const record of view.records) {
    for (const row of projectCsvRows(view.run.id, record)) {
      yield stringify([secureCsvRow(row)], {
        header: first,
        columns: csvColumns,
        record_delimiter: "unix",
      });
      first = false;
    }
  }
  if (first) {
    yield stringify([], { header: true, columns: csvColumns, record_delimiter: "unix" });
  }
}

function projectCsvRows(runId: string, record: SourceSnapshotRecord): CsvRow[] {
  const common = commonCsvRow(runId, record);
  const content = record.snapshot.content;
  if (!content) {
    return [{
      ...common,
      path: "observation",
      name: record.snapshot.observation.failureCode ?? record.snapshot.observation.state,
      value: record.snapshot.observation.httpValidation?.status ?? "",
    }];
  }
  if (content.kind === "document") {
    throw new SourceDatasetExportError(
      "csv_content_unsupported",
      "document 来源内容请使用 JSONL 导出",
    );
  }
  if (content.kind === "ordered_record") {
    return content.fieldGroups.flatMap((group, groupIndex) => group.fields.map((field, index) => ({
      ...common,
      path: `fieldGroups[${groupIndex}]`,
      name: field.name,
      value: field.value,
      unit: field.unit ?? "",
      position: index + 1,
    })));
  }
  if (content.kind === "catalog") {
    return content.entries.map((entry) => ({
      ...common,
      path: content.taxonomyPath.join(" > "),
      name: entry.label,
      value: entry.target.externalKey,
      position: entry.position,
      source_url: entry.sourceUrl ?? "",
    }));
  }
  return content.samples.map((sample) => ({
    ...common,
    path: "samples",
    name: sample.title ?? sample.externalKey,
    value: sample.text,
    unit: sample.rating === undefined ? "" : String(sample.rating),
    position: sample.position,
  }));
}

function commonCsvRow(runId: string, record: SourceSnapshotRecord): CsvRow {
  return {
    run_id: runId,
    snapshot_id: record.snapshot.id,
    object_kind: record.object.kind,
    external_key: record.object.externalKey,
    observation_state: record.snapshot.observation.state,
    content_kind: record.snapshot.content?.kind ?? "",
    path: "",
    name: "",
    value: "",
    unit: "",
    position: "",
    source_url: record.snapshot.observation.finalUrl
      ?? record.snapshot.observation.requestedUrl,
  };
}

function secureCsvRow(row: CsvRow): CsvRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value,
  ])) as CsvRow;
}
