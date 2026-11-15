import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importLocalDataset } from "../../backend/local-dataset.ts";

/**
 * Playwright global setup: build a test-owned synthetic CoStar cache and
 * import it through the REAL import pipeline, so the candidate-search
 * acceptance spec exercises the actual backend (no route mocking except
 * controlled failure injection).
 *
 * Paths are under the git-ignored data/ directory and match the
 * EXPANSION_E2E_* overrides set in playwright.config.ts.
 */
export default async function globalSetup() {
  const dataDir = resolve(process.cwd(), "src/features/expansion/data/data");
  const kitDir = join(dataDir, "e2e-kit");
  const dbPath = join(dataDir, "e2e-synthetic.sqlite");
  const runsDir = join(dataDir, "runs-e2e");
  await rm(kitDir, { recursive: true, force: true });
  await rm(dbPath, { force: true });
  await rm(runsDir, { recursive: true, force: true });
  await mkdir(join(kitDir, "data"), { recursive: true });

  const property = {
    id: 1,
    buildingName: "E2E Synthetic Building",
    propertyType: 6,
    primaryAddress: {
      researchMarketId: 14,
      streetNumber: "1",
      streetName: "Synthetic",
      streetType: "Way",
      latitude: 29.76,
      longitude: -95.36,
    },
  };
  const space = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    propertyId: 1,
    rateLow: 2,
    rateHigh: 2,
    rateBasis: 1,
    monetaryUnit: 1,
    serviceType: 13,
    squareFeetMin: 1200,
    squareFeetMax: 1200,
    spaceUse: 5,
    availabilityType: null,
    ...over,
  });
  const activeSpaces = Array.from({ length: 30 }, (_, index) =>
    space(100 + index, {
      suite: `S${index}`,
      serviceType: index % 3 === 0 ? 7 : 13,
      rateLow: 2 + (index % 5),
      rateHigh: 2 + (index % 5),
    }),
  );
  // One active retail space with NO asking rent ("call for pricing"): its
  // derived rent estimate comes from the other listed spaces' snapshot.
  activeSpaces.push(space(400, { suite: "NE", rateLow: 0, rateHigh: 0, askingRateHasValue: false }));
  for (let index = 0; index < 5; index += 1) activeSpaces.push(space(200 + index, { spaceUse: 7 }));
  const activeListing = {
    id: 10,
    propertyId: 1,
    listingStatus: 1,
    certifiedFreshDate: "2026-01-02T00:00:00Z",
    forLeaseSummary: { askingRateMeasurementType: 1, spaces: activeSpaces },
  };
  const offListing = {
    id: 11,
    propertyId: 1,
    listingStatus: 3,
    certifiedFreshDate: "2026-01-02T00:00:00Z",
    forLeaseSummary: {
      askingRateMeasurementType: 1,
      spaces: [space(300), space(301, { spaceUse: 0 })],
    },
  };
  await writeFile(
    join(kitDir, "data/commercial-property.jsonl"),
    `${JSON.stringify(property)}\n`,
  );
  await writeFile(
    join(kitDir, "data/commercial-listing-summary.jsonl"),
    `${JSON.stringify(activeListing)}\n${JSON.stringify(offListing)}\n`,
  );
  const report = await importLocalDataset({
    rootPath: kitDir,
    dbPath,
    datasetId: "synthetic-e2e-v1",
    datasetDate: null,
  });
  console.log(
    `E2E synthetic cache ready: ${report.accepted.properties} properties, ` +
      `${report.accepted.spaces} spaces at ${dbPath}`,
  );
}
