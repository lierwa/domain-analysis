import { BookOpenText, Database, FileText, LayoutDashboard, Settings } from "lucide-react";
import type { ReactNode } from "react";

// WHY: 导航只保留业务实体入口，移除 Topics/Queries/Sources/Tasks/Content 工程配置页面。
const navItems = [
  { key: "workspace", label: "Workspace", icon: LayoutDashboard },
  { key: "library", label: "Library", icon: Database },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "settings", label: "Settings", icon: Settings }
];

interface AppShellProps {
  activePage: string;
  onPageChange: (page: string) => void;
  children: ReactNode;
}

export function AppShell({ activePage, onPageChange, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpenText className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="truncate text-sm font-semibold">Social Intelligence</span>
          </div>
          <select
            className="max-w-[160px] rounded border border-line bg-panel px-2 py-1 text-sm"
            value={activePage}
            onChange={(event) => onPageChange(event.target.value)}
            aria-label="Navigate"
          >
            {navItems.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-line bg-panel px-3 py-4 md:block">
          <div className="mb-6 flex items-center gap-2 px-2">
            <BookOpenText className="h-5 w-5" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold">Social Intelligence</div>
              <div className="text-xs text-muted">Analysis Platform</div>
            </div>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onPageChange(item.key)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                    isActive
                      ? "bg-ink text-surface"
                      : "text-muted hover:bg-surface hover:text-ink"
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
