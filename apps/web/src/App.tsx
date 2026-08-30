import { AppShell } from "./components/AppShell";
import { CaptureTaskWorkspacePage } from "./pages/CaptureTaskWorkspacePage";

// WHY：当前主入口只展示标准商品来源采集的数据面，确保导航与领域事实源一致。
export function App() {
  return (
    <AppShell>
      <CaptureTaskWorkspacePage />
    </AppShell>
  );
}
