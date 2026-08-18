import { Database, FolderKanban } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink lg:h-dvh lg:overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-surface">跳到主要内容</a>
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-surface"><Database className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0"><div className="truncate text-sm font-semibold">Data Collection Workbench</div><div className="text-xs text-muted">商品原始数据抓取</div></div>
          </div>
          <div className="hidden min-h-11 items-center gap-2 rounded-lg bg-surface px-3 text-sm font-medium sm:flex"><FolderKanban className="h-4 w-4" aria-hidden="true" />抓取任务</div>
        </div>
      </header>
      <main id="main-content" className="flex min-h-0 flex-1 px-4 py-6 sm:px-6 lg:overflow-hidden lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
