import { zodResolver } from "@hookform/resolvers/zod";
import { productProjectDraftInputSchema, type ProductProjectView } from "@domain-analysis/shared";
import { ArrowLeft, Save } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { ApiError, saveProductProjectDraft } from "../lib/api";
import { CategoryDefinitionSection, Field } from "./CategoryDefinitionSection";
import { CollectionSection, ScopeSection } from "./ScopeCollectionSections";
import { draftFromView, type DraftFormInput, type DraftFormOutput } from "./productProjectFormModel";

interface ProductProjectFormProps {
  project: ProductProjectView;
  onCancel: () => void;
  onSaved: (project: ProductProjectView) => void;
}

export function ProductProjectForm({ project, onCancel, onSaved }: ProductProjectFormProps) {
  const form = useForm<DraftFormInput, unknown, DraftFormOutput>({
    resolver: zodResolver(productProjectDraftInputSchema),
    defaultValues: draftFromView(project),
    mode: "onBlur"
  });

  async function handleSave(input: DraftFormOutput) {
    try {
      const saved = await saveProductProjectDraft(input);
      onSaved(saved);
    } catch (error) {
      const message = error instanceof ApiError && error.code === "revision_conflict"
        ? "这个项目刚被其他操作更新了。返回详情并重新编辑，避免覆盖新内容。"
        : error instanceof Error ? error.message : "保存失败，请稍后重试。";
      form.setError("root.server", { message });
    }
  }

  const serverError = form.formState.errors.root?.server?.message;
  const invalidCount = countErrors(form.formState.errors);

  return (
    <FormProvider {...form}>
      <form className="mx-auto max-w-5xl space-y-5" onSubmit={form.handleSubmit(handleSave)} noValidate>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <button type="button" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink" onClick={onCancel}><ArrowLeft className="h-4 w-4" aria-hidden="true" />返回项目</button>
            <h1 className="text-2xl font-semibold tracking-tight">检查和修改项目草稿</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">这份草稿来自已确认调研任务书；在正式搜集前检查知识结构、覆盖范围和来源路线。</p>
          </div>
          <span className="status-badge">草稿版本 {project.project.revision}</span>
        </div>

        {(invalidCount > 0 || serverError) && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            {serverError ?? `还有 ${invalidCount} 处内容需要补全，请查看各字段下方提示。`}
          </div>
        )}

        <section className="form-section">
          <div><div className="mb-2 flex items-center gap-2"><span className="step-number">0</span><h2 className="text-base font-semibold">项目是什么</h2></div><p className="text-sm leading-6 text-muted">用简单的话说明要生产哪一类商品知识，以及服务哪个市场。</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目名称" error={form.formState.errors.name?.message}><input className="input-base" placeholder="例如 中国市场微波炉知识" {...form.register("name")} /></Field>
            <Field label="市场" error={form.formState.errors.market?.message}><input className="input-base" placeholder="例如 CN" {...form.register("market")} /></Field>
            <Field label="知识主题" error={form.formState.errors.knowledgeTopic?.message} className="sm:col-span-2"><textarea className="input-base min-h-24" placeholder="例如：覆盖主流品牌型号、核心配置、功能原理与导购决策的专业知识" {...form.register("knowledgeTopic")} /></Field>
          </div>
        </section>

        <CategoryDefinitionSection />
        <ScopeSection />
        <CollectionSection />

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface/95 py-4 backdrop-blur">
          <button type="button" className="button-secondary" onClick={onCancel}>取消</button>
          <button type="submit" className="button-primary" disabled={form.formState.isSubmitting}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {form.formState.isSubmitting ? "正在保存…" : "保存完整草稿"}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}

function countErrors(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if ("message" in value && typeof value.message === "string") return 1;
  return Object.values(value).reduce((total, child) => total + countErrors(child), 0);
}
