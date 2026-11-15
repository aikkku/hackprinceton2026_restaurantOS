import { TacticalWorkspace } from "./components/tactical-workspace";
import { loadDataset } from "../backend/load-dataset";

export default async function TacticalPage() {
  const loaded = await loadDataset().catch(() => null);
  if (!loaded) return <main className="route-error"><h1>Restaurant dataset unavailable</h1><p>Check the mock fixture or server MongoDB configuration, seed the selected restaurant, and reload. A database failure will not silently switch to demo data.</p></main>;
  return <TacticalWorkspace fixture={loaded.dataset} dataSource={loaded.source} revision={loaded.revision} />;
}
