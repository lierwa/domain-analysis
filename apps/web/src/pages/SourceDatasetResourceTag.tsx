import type { SourceDatasetResourceFormat } from "@domain-analysis/shared";

import { resourceFormatClass, resourceFormatLabel } from "./sourceDatasetMapLabels";

export function SourceDatasetResourceTag({ format, count, compact = false }: {
  format: SourceDatasetResourceFormat;
  count?: number;
  compact?: boolean;
}) {
  return <span className={`inline-flex shrink-0 items-center border font-semibold tabular-nums ${
    compact ? "h-5 rounded px-1.5 text-[9px] tracking-[0.04em]" : "h-6 rounded-md px-2 text-[10px] tracking-[0.06em]"
  } ${resourceFormatClass(format)}`}>
    {resourceFormatLabel(format)}{count === undefined ? "" : ` ${count}`}
  </span>;
}
