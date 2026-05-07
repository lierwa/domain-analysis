import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { LibraryPage } from "./pages/LibraryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkspacePage } from "./pages/WorkspacePage";

// WHY: App 只包含新业务页面，旧 Topics/Queries/Sources/Tasks/Content 页面已从导航移除。
export function App() {
  const [activePage, setActivePage] = useState("workspace");

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage}>
      {activePage === "workspace" && <WorkspacePage />}
      {activePage === "library" && <LibraryPage />}
      {activePage === "reports" && <ReportsPage />}
      {activePage === "settings" && <SettingsPage />}
    </AppShell>
  );
}
