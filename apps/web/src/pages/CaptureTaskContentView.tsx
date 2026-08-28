import type { CaptureTaskContent } from "@domain-analysis/shared";

export function CaptureTaskContentView({ content }: { content: CaptureTaskContent }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Block title="门类与市场">
        <p className="font-medium">{content.category.label}</p>
        <p className="mt-2 text-sm leading-6 text-muted">{content.marketScope}</p>
      </Block>
      <TopicList title="通用抓取内容" items={content.generalTopics} />
      <TopicList title="品类补充内容" items={content.categoryTopics} empty="暂无补充项" />
      <Block title={`候选来源（${content.sourceCandidates.length}）`} wide>
        <p className="mb-3 text-xs leading-5 text-muted">这是当前版本已经找到的入口，不代表品牌或来源覆盖已经完成；可以继续对话增量补充。</p>
        {content.sourceCandidates.length === 0 ? <p className="text-sm text-muted">尚未形成经过实际调查的候选来源。</p> : (
          <div className="space-y-3">
            {content.sourceCandidates.map((source) => (
              <article key={source.id} className="rounded-lg border border-line p-3">
                <a className="font-medium underline" href={source.entryUrl} target="_blank" rel="noreferrer">{source.name}</a>
                <p className="mt-1 text-xs text-muted">{source.publisher} · {source.sourceKind} · {source.accessState}</p>
                <p className="mt-2 text-sm">预期内容：{source.expectedContents.join("、")}</p>
                <p className="mt-1 text-xs text-muted">观察格式：{source.observedFormats.join("、") || "待确认"} · 观察时间：{source.observedAt}</p>
              </article>
            ))}
          </div>
        )}
      </Block>
      {content.excludedContent.length > 0 && <TopicList title="明确不抓" items={content.excludedContent} />}
      {content.unresolvedItems.length > 0 && (
        <Block title="仍未解决">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {content.unresolvedItems.map((item) => <li key={item.key}>{item.description}（{item.owner === "system" ? "系统继续调查" : "需要负责人决定"}）</li>)}
          </ul>
        </Block>
      )}
      <Block title="确认依据">
        <p className="text-sm text-muted">已确认负责人取舍 {content.decisionIds.length} 项。确认后完整内容原样进入正式抓取任务。</p>
      </Block>
    </div>
  );
}

function TopicList({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <Block title={title}>
      {items.length > 0
        ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : <p className="text-sm text-muted">{empty}</p>}
    </Block>
  );
}

function Block({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return <section className={wide ? "lg:col-span-2" : undefined}><h3 className="mb-3 text-sm font-semibold">{title}</h3>{children}</section>;
}
