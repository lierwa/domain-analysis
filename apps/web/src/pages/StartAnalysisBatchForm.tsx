import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  createAnalysisBatch,
  startAnalysisBatch,
  type AnalysisBatch,
  type CreateAnalysisBatchInput,
  type PlatformLimit
} from "../lib/api";

const PLATFORM_OPTIONS: Array<{ platform: PlatformLimit["platform"]; label: string; defaultLimit: number }> = [
  { platform: "x", label: "X / Twitter", defaultLimit: 200 },
  { platform: "reddit", label: "Reddit", defaultLimit: 200 },
  { platform: "youtube", label: "YouTube", defaultLimit: 50 },
  { platform: "web", label: "Web", defaultLimit: 50 }
];

interface StartAnalysisBatchFormProps {
  onSuccess: (batch: AnalysisBatch) => void;
  onCancel?: () => void;
}

export function StartAnalysisBatchForm({ onSuccess, onCancel }: StartAnalysisBatchFormProps) {
  const [baseForm, setBaseForm] = useState<Omit<CreateAnalysisBatchInput, "includeKeywords" | "platformLimits">>({
    goal: "",
    excludeKeywords: [],
    language: "en",
    market: "US"
  });
  const [keywordsInput, setKeywordsInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const [platformLimits, setPlatformLimits] = useState<PlatformLimit[]>([
    { platform: "x", limit: 200 },
    { platform: "reddit", limit: 200 }
  ]);

  const createMutation = useMutation({ mutationFn: createAnalysisBatch });
  const startMutation = useMutation({ mutationFn: startAnalysisBatch });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const includeKeywords = splitCommaList(keywordsInput);
    const excludeKeywords = splitCommaList(excludeInput);
    if (includeKeywords.length === 0 || platformLimits.length === 0) return;

    const batch = await createMutation.mutateAsync({
      ...baseForm,
      includeKeywords,
      excludeKeywords,
      platformLimits
    });
    const started = await startMutation.mutateAsync(batch.id);
    onSuccess(started);
  }

  const isLoading = createMutation.isPending || startMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-1 text-lg font-semibold">Start a multi-platform analysis</h2>
      <p className="mb-6 text-sm text-muted">
        Enter one goal and one keyword set, then run independent collection limits per platform.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Analysis goal" required>
          <textarea
            required
            rows={2}
            placeholder="e.g. Understand tattoo design demand and purchase intent"
            value={baseForm.goal}
            onChange={(e) => setBaseForm((form) => ({ ...form, goal: e.target.value }))}
            className="input-base w-full resize-none"
          />
        </Field>

        <Field label="Include keywords (comma separated)" required>
          <input
            required
            type="text"
            placeholder="e.g. tattoo design, tattoo ideas"
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            className="input-base w-full"
          />
        </Field>

        <Field label="Platforms and limits" required>
          <div className="grid gap-2">
            {PLATFORM_OPTIONS.map((option) => (
              <PlatformLimitRow
                key={option.platform}
                option={option}
                value={platformLimits.find((item) => item.platform === option.platform)}
                onChange={(next) => setPlatformLimits((items) => upsertPlatformLimit(items, option.platform, next))}
              />
            ))}
          </div>
        </Field>

        <Field label="Exclude keywords (comma separated)">
          <input
            type="text"
            placeholder="e.g. spam, advertisement"
            value={excludeInput}
            onChange={(e) => setExcludeInput(e.target.value)}
            className="input-base w-full"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Language">
            <input
              type="text"
              value={baseForm.language}
              onChange={(e) => setBaseForm((form) => ({ ...form, language: e.target.value }))}
              className="input-base w-full"
            />
          </Field>
          <Field label="Market">
            <input
              type="text"
              value={baseForm.market}
              onChange={(e) => setBaseForm((form) => ({ ...form, market: e.target.value }))}
              className="input-base w-full"
            />
          </Field>
        </div>

        {(createMutation.isError || startMutation.isError) && (
          <p className="text-sm text-red-600">Batch creation failed. Check platform limits and try again.</p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isLoading || platformLimits.length === 0}
            className="rounded bg-ink px-5 py-2.5 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
          >
            {isLoading ? "Starting..." : "Start batch"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-line px-5 py-2.5 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function PlatformLimitRow({
  option,
  value,
  onChange
}: {
  option: { platform: PlatformLimit["platform"]; label: string; defaultLimit: number };
  value?: PlatformLimit;
  onChange: (value?: PlatformLimit) => void;
}) {
  const checked = Boolean(value);

  return (
    <div className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded-lg border border-line px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) =>
            onChange(event.target.checked ? { platform: option.platform, limit: option.defaultLimit } : undefined)
          }
        />
        <span>{option.label}</span>
      </label>
      <input
        type="number"
        min={1}
        max={500}
        disabled={!checked}
        value={value?.limit ?? option.defaultLimit}
        onChange={(event) => onChange({ platform: option.platform, limit: Number(event.target.value) })}
        className="input-base w-full"
      />
    </div>
  );
}

function upsertPlatformLimit(
  items: PlatformLimit[],
  platform: PlatformLimit["platform"],
  next?: PlatformLimit
) {
  // WHY: batch 表单只维护平台执行参数；业务 goal/keywords 保持一份，避免各平台配置漂移。
  if (!next) return items.filter((item) => item.platform !== platform);
  const exists = items.some((item) => item.platform === platform);
  if (exists) return items.map((item) => (item.platform === platform ? next : item));
  return [...items, next];
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function Field({
  label,
  required,
  children
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
