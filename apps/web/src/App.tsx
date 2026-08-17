import { AppShell } from "./components/AppShell";
import { ProductProjectWorkspacePage } from "./pages/ProductProjectWorkspacePage";

// WHY: 当前主入口只展示已经接上新架构的数据面，避免把旧社媒分析页面误当成商品知识能力。
export function App() {
  return (
    <AppShell>
      <ProductProjectWorkspacePage />
    </AppShell>
  );
}
