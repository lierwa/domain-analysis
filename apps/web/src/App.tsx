import { AppShell } from "./components/AppShell";
import { CaptureTaskWorkspacePage } from "./pages/CaptureTaskWorkspacePage";
import { KnowledgeWorkspace } from "./pages/KnowledgeWorkspace";
import { useState } from "react";

export function App() {
  const [surface, setSurface] = useState<"capture" | "knowledge">(location.hash === "#knowledge" ? "knowledge" : "capture");
  return (
    <AppShell surface={surface} onNavigate={value => { setSurface(value); history.replaceState(null, "", value === "knowledge" ? "#knowledge" : "#capture"); }}>
      {surface === "capture" ? <CaptureTaskWorkspacePage /> : <KnowledgeWorkspace />}
    </AppShell>
  );
}
