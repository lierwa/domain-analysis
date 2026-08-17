import { knowledgeLayers, sourceAuthorityTypes } from "@domain-analysis/shared";
import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { Field, FieldMessage, TextListField } from "./CategoryDefinitionSection";
import { knowledgeLayerLabels, sourceAuthorityLabels } from "./productKnowledgeLabels";
import type { DraftFormInput } from "./productProjectFormModel";

const populationOptions = [
  ["regulatory_registry", "监管登记"],
  ["official_current_catalog", "官方当前在售目录"],
  ["licensed_market_priority", "有授权的市场优先级"]
] as const;

const stopOptions = [
  ["login_required", "需要登录"],
  ["verification_required", "需要验证码"],
  ["access_denied", "拒绝访问"],
  ["sensitive_data_detected", "发现敏感数据"],
  ["source_abnormal", "来源页面异常"]
] as const;

export function ScopeSection() {
  const { control, register, formState: { errors } } = useFormContext<DraftFormInput>();
  const targets = useFieldArray({ control, name: "confirmedScope.targets" });
  return (
    <section className="form-section">
      <SectionHeading number="2" title="确定覆盖范围" description="明确要覆盖哪些品牌、型号或变体，并留下为什么纳入它们的证据。" />
      <fieldset>
        <legend className="field-label">用于确定市面范围的目录</legend>
        <Controller
          control={control}
          name="confirmedScope.populationLayers"
          render={({ field }) => (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {populationOptions.map(([value, label]) => (
                <label key={value} className="check-row">
                  <input type="checkbox" checked={field.value.includes(value)} onChange={() => field.onChange(toggleValue(field.value, value))} />
                  {label}
                </label>
              ))}
            </div>
          )}
        />
        <FieldMessage message={errors.confirmedScope?.populationLayers?.message} />
      </fieldset>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold">覆盖对象</h3><p className="field-help">先用品牌建立范围，之后可以继续补型号和变体。</p></div>
          <button type="button" className="button-secondary" onClick={() => targets.append(emptyTarget())}><Plus className="h-4 w-4" aria-hidden="true" />添加对象</button>
        </div>
        <div className="mt-3 space-y-3">
          {targets.fields.map((target, index) => {
            const error = errors.confirmedScope?.targets?.[index];
            return (
              <div key={target.id} className="nested-card">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-medium">覆盖对象 {index + 1}</h4>
                  <button type="button" className="icon-button text-muted hover:text-danger" onClick={() => targets.remove(index)} aria-label={`删除覆盖对象 ${index + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="唯一标识" error={error?.key?.message}><input className="input-base" placeholder="例如 brand:midea" {...register(`confirmedScope.targets.${index}.key`)} /></Field>
                  <Field label="类型"><select className="input-base" {...register(`confirmedScope.targets.${index}.kind`)}><option value="brand">品牌</option><option value="model">型号</option><option value="variant">变体</option></select></Field>
                  <Field label="显示名称" error={error?.label?.message}><input className="input-base" {...register(`confirmedScope.targets.${index}.label`)} /></Field>
                  <Field label="上级标识" error={error?.parentKey?.message}><input className="input-base" placeholder="品牌可留空" {...register(`confirmedScope.targets.${index}.parentKey`, { setValueAs: optionalText })} /></Field>
                  <Field label="处理方式"><select className="input-base" {...register(`confirmedScope.targets.${index}.disposition`)}><option value="included">纳入</option><option value="excluded">排除</option></select></Field>
                  <TextListField name={`confirmedScope.targets.${index}.evidenceReferenceIds`} label="证据编号" help="每行一个。" />
                  <Field label="纳入或排除原因" error={error?.reason?.message} className="sm:col-span-2 lg:col-span-3"><textarea className="input-base min-h-20" {...register(`confirmedScope.targets.${index}.reason`)} /></Field>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function CollectionSection() {
  const { control, register, formState: { errors } } = useFormContext<DraftFormInput>();
  const lanes = useFieldArray({ control, name: "collectionBoard.lanes" });
  return (
    <section className="form-section">
      <SectionHeading number="3" title="安排数据搜集" description="每条搜集路线说明从哪里取、覆盖谁、要取哪些知识；遇到登录或验证就停下来找人处理。" />
      <div className="flex justify-end">
        <button type="button" className="button-secondary" onClick={() => lanes.append(emptyLane(lanes.fields.length + 1))}><Plus className="h-4 w-4" aria-hidden="true" />添加搜集路线</button>
      </div>
      <div className="space-y-3">
        {lanes.fields.map((lane, index) => {
          const error = errors.collectionBoard?.lanes?.[index];
          return (
            <div key={lane.id} className="nested-card">
              <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-medium">搜集路线 {index + 1}</h4><button type="button" className="icon-button text-muted hover:text-danger" onClick={() => lanes.remove(index)} aria-label={`删除搜集路线 ${index + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="路线编号" error={error?.id?.message}><input className="input-base" {...register(`collectionBoard.lanes.${index}.id`)} /></Field>
                <Field label="来源类型"><select className="input-base" {...register(`collectionBoard.lanes.${index}.sourceAuthorityType`)}>{sourceAuthorityTypes.map((source) => <option key={source} value={source}>{sourceAuthorityLabels[source]}</option>)}</select></Field>
                <Field label="访问方式"><select className="input-base" {...register(`collectionBoard.lanes.${index}.accessMode`)}><option value="public_web">公开网页</option><option value="browser_session">登录浏览器</option><option value="licensed_api">授权接口</option><option value="document">文档</option></select></Field>
                <TextListField name={`collectionBoard.lanes.${index}.targetKeys`} label="覆盖对象标识" help="每行一个，必须是上一步纳入的对象。" />
                <Field label="刷新频率"><select className="input-base" {...register(`collectionBoard.lanes.${index}.refreshPolicy`)}><option value="manual">手动</option><option value="on_source_change">来源变化时</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></Field>
                <fieldset className="sm:col-span-2 lg:col-span-3">
                  <legend className="field-label">要搜集的知识层</legend>
                  <Controller control={control} name={`collectionBoard.lanes.${index}.knowledgeLayers`} render={({ field }) => <div className="mt-2 flex flex-wrap gap-2">{knowledgeLayers.map((layer) => <label key={layer} className="check-row"><input type="checkbox" checked={field.value.includes(layer)} onChange={() => field.onChange(toggleValue(field.value, layer))} />{knowledgeLayerLabels[layer]}</label>)}</div>} />
                  <FieldMessage message={error?.knowledgeLayers?.message} />
                </fieldset>
                <fieldset className="sm:col-span-2 lg:col-span-3">
                  <legend className="field-label">必须暂停并找人处理的情况</legend>
                  <Controller control={control} name={`collectionBoard.lanes.${index}.stopConditions`} render={({ field }) => <div className="mt-2 flex flex-wrap gap-2">{stopOptions.map(([value, label]) => <label key={value} className="check-row"><input type="checkbox" checked={field.value.includes(value)} onChange={() => field.onChange(toggleValue(field.value, value))} />{label}</label>)}</div>} />
                  <FieldMessage message={error?.stopConditions?.message} />
                </fieldset>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div><div className="mb-2 flex items-center gap-2"><span className="step-number">{number}</span><h2 className="text-base font-semibold">{title}</h2></div><p className="text-sm leading-6 text-muted">{description}</p></div>;
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function emptyTarget(): DraftFormInput["confirmedScope"]["targets"][number] {
  return { key: "", kind: "brand", label: "", evidenceReferenceIds: [], disposition: "included", reason: "" };
}

function emptyLane(sequence: number): DraftFormInput["collectionBoard"]["lanes"][number] {
  return { id: `lane-${sequence}`, sourceAuthorityType: "brand_official_site", accessMode: "public_web", targetKeys: [], knowledgeLayers: ["identity", "specification"], refreshPolicy: "weekly", stopConditions: ["login_required", "verification_required", "access_denied", "source_abnormal"] };
}
