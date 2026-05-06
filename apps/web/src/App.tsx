import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { fetchModules } from "./lib/api";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ContentPage } from "./pages/ContentPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PlainModulePage } from "./pages/PlainModulePage";
import { QueriesPage } from "./pages/QueriesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { TasksPage } from "./pages/TasksPage";
import { TopicsPage } from "./pages/TopicsPage";

export function App() {
  const [activePage, setActivePage] = useState("overview");
  const modulesQuery = useQuery({
    queryKey: ["modules"],
    queryFn: fetchModules,
    retry: 1
  });

  const moduleMap = useMemo(
    () => new Map(modulesQuery.data?.map((moduleInfo) => [moduleInfo.key, moduleInfo])),
    [modulesQuery.data]
  );

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage}>
      {activePage === "overview" && <OverviewPage apiOnline={modulesQuery.isSuccess} />}
      {activePage === "tasks" && <TasksPage />}
      {activePage === "content" && <ContentPage />}
      {activePage === "analytics" && <AnalyticsPage />}
      {activePage === "reports" && <ReportsPage />}
      {activePage === "topics" && <TopicsPage />}
      {activePage === "queries" && <QueriesPage />}
      {activePage === "sources" && <SourcesPage />}
      {["settings"].includes(activePage) && (
        <PlainModulePage
          title={moduleMap.get(activePage)?.label ?? activePage}
          description={moduleMap.get(activePage)?.description ?? "Module scaffold"}
        />
      )}
    </AppShell>
  );
}
