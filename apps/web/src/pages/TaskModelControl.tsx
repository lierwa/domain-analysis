import {
  DEFAULT_TASK_MODEL_SELECTION,
  type TaskModelSelection,
} from "@domain-analysis/shared";
import { Check, ChevronDown, ChevronRight, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";

const INHERIT_VALUE = "__default__";
const MODELS = [
  model("gpt-5.3-codex-spark", "high", ["low", "medium", "high", "xhigh"]),
  model("gpt-5.4", "medium", ["low", "medium", "high", "xhigh"]),
  model("gpt-5.4-mini", "medium", ["low", "medium", "high", "xhigh"]),
  model("gpt-5.5", "medium", ["low", "medium", "high", "xhigh"]),
  model("gpt-5.6-luna", "medium", ["low", "medium", "high", "xhigh", "max"]),
  model("gpt-5.6-sol", "low", ["low", "medium", "high", "xhigh", "max", "ultra"]),
  model("gpt-5.6-terra", "medium", ["low", "medium", "high", "xhigh", "max", "ultra"]),
] as const;

export function TaskModelControl({ value, disabled, saving, error, onChange }: {
  value: TaskModelSelection;
  disabled: boolean;
  saving: boolean;
  error?: string;
  onChange(value: TaskModelSelection): void;
}) {
  const selectedModel = MODELS.find((item) => item.modelId === value.modelId) ?? MODELS.at(-1)!;
  const modelValue = sameSelection(value, DEFAULT_TASK_MODEL_SELECTION)
    ? INHERIT_VALUE : selectedModel.modelId;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" disabled={disabled} aria-label="抓取任务模型与推理深度"
          className="group inline-flex h-8 min-w-0 max-w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-muted outline-none transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 data-[state=open]:bg-surface data-[state=open]:text-ink disabled:pointer-events-none disabled:opacity-50">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono" translate="no">{value.modelId} · {value.reasoningEffort}</span>
          {saving
            ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="保存中" />
            : <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={8} collisionPadding={12}
          className="z-[120] w-max min-w-[13rem] overflow-hidden rounded-xl border border-line bg-panel p-1.5 shadow-xl outline-none">
          {error && <div role="alert" className="max-w-80 px-2.5 py-2 text-xs text-danger">{error}</div>}
          <DropdownMenu.Sub>
            <MenuRow label="模型" value={value.modelId} disabled={disabled || saving} />
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={6} alignOffset={-6} collisionPadding={12}
                aria-label="选择模型"
                className="z-[121] max-h-[min(24rem,calc(100vh-1rem))] min-w-[15rem] overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-xl outline-none">
                <DropdownMenu.Label className="px-2.5 py-1.5 text-[11px] font-medium text-muted">ChatGPT Plus / Pro</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={modelValue} onValueChange={(next) => {
                  if (next === INHERIT_VALUE) return onChange(DEFAULT_TASK_MODEL_SELECTION);
                  const selected = MODELS.find((item) => item.modelId === next);
                  if (selected) onChange({ modelId: selected.modelId, reasoningEffort: selected.defaultEffort });
                }}>
                  <ModelItem value={INHERIT_VALUE} prefix="继承默认" modelId={DEFAULT_TASK_MODEL_SELECTION.modelId} />
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  {MODELS.map((item) => <ModelItem key={item.modelId} value={item.modelId} modelId={item.modelId} />)}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <MenuRow label="推理深度" value={value.reasoningEffort} disabled={disabled || saving} />
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={6} alignOffset={-6} collisionPadding={12}
                aria-label="推理深度"
                className="z-[121] min-w-24 overflow-hidden rounded-xl border border-line bg-panel p-1.5 shadow-xl outline-none">
                <DropdownMenu.RadioGroup value={value.reasoningEffort} onValueChange={(reasoningEffort) =>
                  onChange({
                    modelId: selectedModel.modelId,
                    reasoningEffort: reasoningEffort as TaskModelSelection["reasoningEffort"],
                  })}>
                  {selectedModel.efforts.map((effort) => (
                    <DropdownMenu.RadioItem key={effort} value={effort}
                      className="flex h-9 select-none items-center gap-2.5 rounded-lg px-2.5 font-mono text-xs outline-none hover:bg-surface focus:bg-surface data-[state=checked]:bg-accent-soft">
                      <Indicator />{effort}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuRow({ label, value, disabled }: { label: string; value: string; disabled: boolean }) {
  return (
    <DropdownMenu.SubTrigger disabled={disabled}
      className="flex h-10 min-w-[13rem] select-none items-center gap-3 rounded-lg px-2.5 outline-none hover:bg-surface focus:bg-surface data-[state=open]:bg-surface disabled:pointer-events-none disabled:opacity-50">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="ml-auto max-w-[18rem] truncate font-mono text-xs text-muted" translate="no">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
    </DropdownMenu.SubTrigger>
  );
}

function ModelItem({ value, modelId, prefix }: { value: string; modelId: string; prefix?: string }) {
  return (
    <DropdownMenu.RadioItem value={value}
      className="flex h-9 min-w-[14rem] select-none items-center gap-2.5 rounded-lg px-2.5 text-xs outline-none hover:bg-surface focus:bg-surface data-[state=checked]:bg-accent-soft">
      <Indicator />
      {prefix && <span className="text-muted">{prefix}</span>}
      <span className="font-mono" translate="no">{modelId}</span>
    </DropdownMenu.RadioItem>
  );
}

function Indicator() {
  return <span className="flex h-4 w-4 items-center justify-center"><DropdownMenu.ItemIndicator>
    <Check className="h-3.5 w-3.5" aria-hidden="true" />
  </DropdownMenu.ItemIndicator></span>;
}

function model<T extends TaskModelSelection["reasoningEffort"]>(
  modelId: string,
  defaultEffort: T,
  efforts: readonly T[],
) {
  return { modelId, defaultEffort, efforts } as const;
}

function sameSelection(left: TaskModelSelection, right: TaskModelSelection) {
  return left.modelId === right.modelId && left.reasoningEffort === right.reasoningEffort;
}
