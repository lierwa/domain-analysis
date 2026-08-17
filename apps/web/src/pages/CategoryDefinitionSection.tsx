import { knowledgeLayers, sourceAuthorityTypes } from "@domain-analysis/shared";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { knowledgeLayerLabels, sourceAuthorityLabels } from "./productKnowledgeLabels";
import type { DraftFormInput } from "./productProjectFormModel";
import { linesToValues } from "./productProjectFormModel";

export function CategoryDefinitionSection() {
  const { control, register, formState: { errors } } = useFormContext<DraftFormInput>();
  const attributes = useFieldArray({ control, name: "categoryDefinition.attributes" });
  const dimensions = useFieldArray({ control, name: "categoryDefinition.decisionDimensions" });

  return (
    <section className="form-section">
      <SectionHeading number="1" title="定义商品类型" description="这套定义以后可以复用到电视、微波炉等其他品类。" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="品类编码" error={errors.categoryDefinition?.categoryCode?.message}>
          <input className="input-base" placeholder="例如 microwave_oven" {...register("categoryDefinition.categoryCode")} />
        </Field>
        <Field label="品类名称" error={errors.categoryDefinition?.label?.message}>
          <input className="input-base" placeholder="例如 微波炉" {...register("categoryDefinition.label")} />
        </Field>
      </div>

      <fieldset>
        <legend className="field-label">允许使用的权威来源</legend>
        <p className="field-help">只勾选可作为事实依据的来源，不包含第三方小商家。</p>
        <Controller
          control={control}
          name="categoryDefinition.sourceAuthorityPolicy"
          render={({ field }) => (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sourceAuthorityTypes.map((source) => (
                <label key={source} className="check-row">
                  <input
                    type="checkbox"
                    checked={field.value.includes(source)}
                    onChange={() => field.onChange(toggleValue(field.value, source))}
                  />
                  <span>{sourceAuthorityLabels[source]}</span>
                </label>
              ))}
            </div>
          )}
        />
        <FieldMessage message={errors.categoryDefinition?.sourceAuthorityPolicy?.message} />
      </fieldset>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">主要参数</h3>
            <p className="field-help">定义后续清洗、对比和导购会使用的统一参数。</p>
          </div>
          <AddButton label="添加参数" onClick={() => attributes.append(emptyAttribute())} />
        </div>
        <div className="mt-3 space-y-3">
          {attributes.fields.map((attribute, index) => (
            <AttributeCard key={attribute.id} index={index} onRemove={() => attributes.remove(index)} />
          ))}
        </div>
        <FieldMessage message={errors.categoryDefinition?.attributes?.root?.message} />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">导购判断维度</h3>
            <p className="field-help">把参数组合成用户能理解的选择依据。</p>
          </div>
          <AddButton label="添加维度" onClick={() => dimensions.append(emptyDimension())} />
        </div>
        <div className="mt-3 space-y-3">
          {dimensions.fields.map((dimension, index) => (
            <div key={dimension.id} className="nested-card">
              <CardHeader title={`判断维度 ${index + 1}`} onRemove={() => dimensions.remove(index)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="维度编码" error={errors.categoryDefinition?.decisionDimensions?.[index]?.code?.message}>
                  <input className="input-base" {...register(`categoryDefinition.decisionDimensions.${index}.code`)} />
                </Field>
                <Field label="显示名称" error={errors.categoryDefinition?.decisionDimensions?.[index]?.label?.message}>
                  <input className="input-base" {...register(`categoryDefinition.decisionDimensions.${index}.label`)} />
                </Field>
                <Field label="说明" error={errors.categoryDefinition?.decisionDimensions?.[index]?.description?.message} className="sm:col-span-2">
                  <textarea className="input-base min-h-20" {...register(`categoryDefinition.decisionDimensions.${index}.description`)} />
                </Field>
                <TextListField
                  name={`categoryDefinition.decisionDimensions.${index}.relatedAttributeCodes`}
                  label="关联的参数编码"
                  help="每行一个，必须与上面的参数编码一致。"
                  className="sm:col-span-2"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <TextListField
        name="categoryDefinition.competencyQuestions"
        label="这套知识必须能回答的问题"
        help="每行一个真实用户问题，用来检查知识库是否真正有用。"
      />
    </section>
  );
}

function AttributeCard({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { control, register, setValue, formState: { errors } } = useFormContext<DraftFormInput>();
  const valueKind = useWatch({ control, name: `categoryDefinition.attributes.${index}.valueKind` });
  const error = errors.categoryDefinition?.attributes?.[index];
  useEffect(() => {
    if (valueKind !== "enum") {
      setValue(`categoryDefinition.attributes.${index}.allowedValues`, undefined);
    }
  }, [index, setValue, valueKind]);
  return (
    <div className="nested-card">
      <CardHeader title={`参数 ${index + 1}`} onRemove={onRemove} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="参数编码" error={error?.code?.message}>
          <input className="input-base" placeholder="例如 heating.power" {...register(`categoryDefinition.attributes.${index}.code`)} />
        </Field>
        <Field label="显示名称" error={error?.label?.message}>
          <input className="input-base" {...register(`categoryDefinition.attributes.${index}.label`)} />
        </Field>
        <Field label="知识层">
          <select className="input-base" {...register(`categoryDefinition.attributes.${index}.knowledgeLayer`)}>
            {knowledgeLayers.map((layer) => <option key={layer} value={layer}>{knowledgeLayerLabels[layer]}</option>)}
          </select>
        </Field>
        <Field label="值类型">
          <select className="input-base" {...register(`categoryDefinition.attributes.${index}.valueKind`)}>
            <option value="text">文本</option><option value="decimal">数字</option>
            <option value="boolean">是 / 否</option><option value="enum">固定选项</option>
          </select>
        </Field>
        <Field label="统一单位" error={error?.canonicalUnitCode?.message}>
          <input className="input-base" placeholder="没有可留空" {...register(`categoryDefinition.attributes.${index}.canonicalUnitCode`, { setValueAs: optionalText })} />
        </Field>
        {valueKind === "enum" && (
          <TextListField name={`categoryDefinition.attributes.${index}.allowedValues`} label="可选值" help="每行一个。" />
        )}
        <Field label="参数说明" error={error?.description?.message} className="sm:col-span-2 lg:col-span-3">
          <textarea className="input-base min-h-20" {...register(`categoryDefinition.attributes.${index}.description`)} />
        </Field>
        <TextListField name={`categoryDefinition.attributes.${index}.externalMappings`} label="外部字段别名" help="可选，每行一个。" />
        <label className="check-row self-end"><input type="checkbox" {...register(`categoryDefinition.attributes.${index}.filterable`)} />可筛选</label>
        <label className="check-row self-end"><input type="checkbox" {...register(`categoryDefinition.attributes.${index}.comparable`)} />可对比</label>
      </div>
    </div>
  );
}

export function TextListField({ name, label, help, className = "" }: {
  name: Parameters<ReturnType<typeof useFormContext<DraftFormInput>>["register"]>[0];
  label: string;
  help?: string;
  className?: string;
}) {
  const { control } = useFormContext<DraftFormInput>();
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="field-label">{label}</span>
      {help && <span className="field-help">{help}</span>}
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) => <TextListInput field={field} error={fieldState.error?.message} />}
      />
    </label>
  );
}

export function Field({ label, error, children, className = "" }: {
  label: string; error?: string; children: ReactNode; className?: string;
}) {
  return <label className={`flex flex-col gap-1.5 ${className}`}><span className="field-label">{label}</span>{children}<FieldMessage message={error} /></label>;
}

function TextListInput({ field, error }: {
  field: { value: unknown; onChange: (value: string[]) => void; onBlur: () => void };
  error?: string;
}) {
  const [text, setText] = useState(Array.isArray(field.value) ? field.value.join("\n") : "");
  return (
    <>
      <textarea
        className="input-base min-h-20"
        value={text}
        onBlur={() => { field.onChange(linesToValues(text)); field.onBlur(); }}
        onChange={(event) => { setText(event.target.value); field.onChange(linesToValues(event.target.value)); }}
      />
      <FieldMessage message={error} />
    </>
  );
}

export function FieldMessage({ message }: { message?: string }) {
  return message ? <span className="text-xs text-danger" role="alert">{message}</span> : null;
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div><div className="mb-2 flex items-center gap-2"><span className="step-number">{number}</span><h2 className="text-base font-semibold">{title}</h2></div><p className="text-sm leading-6 text-muted">{description}</p></div>;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="button-secondary" onClick={onClick}><Plus className="h-4 w-4" aria-hidden="true" />{label}</button>;
}

function CardHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-medium">{title}</h4><button type="button" className="icon-button text-muted hover:text-danger" onClick={onRemove} aria-label={`删除${title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>;
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function emptyAttribute(): DraftFormInput["categoryDefinition"]["attributes"][number] {
  return { code: "", label: "", description: "", knowledgeLayer: "specification", valueKind: "text", externalMappings: [], filterable: true, comparable: true };
}

function emptyDimension(): DraftFormInput["categoryDefinition"]["decisionDimensions"][number] {
  return { code: "", label: "", description: "", relatedAttributeCodes: [] };
}
