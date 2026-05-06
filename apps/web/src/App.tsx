import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { FlowStepper } from "./components/FlowStepper";
import { fetchModules, fetchTopics } from "./lib/api";
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
  const [workspaceTopicId, setWorkspaceTopicId] = useState("");
  const modulesQuery = useQuery({
    queryKey: ["modules"],
    queryFn: fetchModules,
    retry: 1
  });
  const topicsQuery = useQuery({ queryKey: ["topics"], queryFn: fetchTopics });

  const topicIds = useMemo(() => topicsQuery.data?.map((t) => t.id) ?? [], [topicsQuery.data]);

  useEffect(() => {
    if (!topicsQuery.data?.length) return;
    const first = topicsQuery.data[0];
    if (!first) return;
    if (!workspaceTopicId) {
      setWorkspaceTopicId(first.id);
      return;
    }
    if (topicIds.length && !topicIds.includes(workspaceTopicId)) {
      setWorkspaceTopicId(first.id);
    }
  }, [topicsQuery.data, topicIds, workspaceTopicId]);

  function navigateToContent(topicId: string) {
    setWorkspaceTopicId(topicId);
    setActivePage("content");
  }

  const moduleMap = useMemo(
    () => new Map(modulesQuery.data?.map((moduleInfo) => [moduleInfo.key, moduleInfo])),
    [modulesQuery.data]
  );

  const flowSlot =
    activePage === "topics" ||
    activePage === "queries" ||
    activePage === "tasks" ||
    activePage === "content" ? (
      <FlowStepper activePage={activePage} onNavigate={setActivePage} />
    ) : null;

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage} flowSlot={flowSlot}>
      {activePage === "overview" && <OverviewPage apiOnline={modulesQuery.isSuccess} />}
      {activePage === "tasks" && <TasksPage onViewRawContent={navigateToContent} />}
      {activePage === "content" && (
        <ContentPage
          topicId={workspaceTopicId}
          onOpenTopics={() => setActivePage("topics")}
          onTopicIdChange={setWorkspaceTopicId}
        />
      )}
      {activePage === "analytics" && <AnalyticsPage />}
      {activePage === "reports" && <ReportsPage />}
      {activePage === "topics" && (
        <TopicsPage workspaceTopicId={workspaceTopicId} onWorkspaceTopicChange={setWorkspaceTopicId} />
      )}
      {activePage === "queries" && (
        <QueriesPage topicId={workspaceTopicId} onTopicIdChange={setWorkspaceTopicId} />
      )}
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
