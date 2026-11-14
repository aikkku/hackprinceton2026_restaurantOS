import { TacticalWorkspace } from "./components/tactical-workspace";
import demo from "./data/demo-restaurant.json";
import { fixtureSchema } from "../domain/schemas";

export default function TacticalPage() {
  const fixture = fixtureSchema.safeParse(demo);
  if (!fixture.success) {
    return (
      <main className="route-error">
        <h1>Demo restaurant unavailable</h1>
        <p>Check the demo data, then refresh to try again.</p>
        <ul>
          {fixture.error.issues.map((issue, index) => (
            <li key={index}>{issue.path.join(".")} — {issue.message}</li>
          ))}
        </ul>
      </main>
    );
  }
  return <TacticalWorkspace fixture={fixture.data} />;
}
