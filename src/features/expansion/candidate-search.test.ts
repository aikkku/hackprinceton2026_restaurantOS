import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  importLocalDataset,
  openDatabase,
  LocalDataError,
  type LocalConfig,
} from "./backend/local-dataset.ts";
import { searchOfferedSpaces, BATCH_SIZE } from "./backend/candidate-search.ts";

const property = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  buildingName: `Synthetic property ${id}`,
  propertyType: 6,
  primaryAddress: {
    researchMarketId: 14,
    streetNumber: String(id),
    streetName: "Synthetic",
    streetType: "Street",
    latitude: 29.76,
    longitude: -95.36,
  },
  ...extra,
});
const space = (id: number, extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});
const listing = (id: number, spaces: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  propertyId: 1,
  listingStatus: 1,
  certifiedFreshDate: "2026-01-02T00:00:00Z",
  forLeaseSummary: { askingRateMeasurementType: 1, spaces },
  ...extra,
});

async function fixture(
  properties: unknown[],
  listings: unknown[],
  run: (config: LocalConfig) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "restaurantos-search-"));
  const settings: LocalConfig = {
    rootPath: directory,
    dbPath: join(directory, "cache.sqlite"),
    datasetId: "synthetic-search-tests",
    datasetDate: null,
  };
  try {
    await mkdir(join(directory, "data"));
    await writeFile(join(directory, "data/commercial-property.jsonl"), properties.map((p) => JSON.stringify(p)).join("\n"));
    await writeFile(join(directory, "data/commercial-listing-summary.jsonl"), listings.map((p) => JSON.stringify(p)).join("\n"));
    await run(settings);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("citywide search separates active candidates, off-market records, unknown status and incompatible uses", async () => {
  await fixture(
    [property(1)],
    [
      listing(10, [
        space(100, { suite: "A" }),
        space(101, { spaceUse: 7, suite: "B" }), // Industrial → incompatible
        space(102, { spaceUse: 0, suite: "C" }), // unknown use, included but flagged
        space(103, { spaceUse: null, suite: "D" }), // unknown use, included but flagged
      ]),
      listing(11, [space(200)], { listingStatus: 3 }), // OffMarket
      listing(12, [space(300)], { listingStatus: null }), // unknown status
    ],
    async (config) => {
      await importLocalDataset(config);
      const db = openDatabase(config);
      try {
        const result = await searchOfferedSpaces(db, "houston");
        assert.equal(result.counts.examined, 6);
        assert.equal(result.counts.included, 3);
        assert.equal(result.counts.excluded, 3);
        assert.equal(result.counts.offMarket, 1);
        assert.equal(result.counts.unknownMarketingStatus, 1);
        assert.equal(result.counts.incompatibleUse, 1);
        assert.equal(result.counts.useUnknown, 2);
        assert.equal(result.counts.scanCapped, false);
        assert.equal(result.cancelled, false);
        assert.deepEqual(
          result.candidates.map((c) => c.id).sort(),
          ["costar-space:100", "costar-space:102", "costar-space:103"],
        );
        assert.deepEqual(
          result.excluded.map((e) => e.reasonCode).sort(),
          ["incompatible_space_use", "off_market", "unknown_marketing_status"],
        );
        assert.ok(result.excluded.every((e) => e.reason.length > 10));
        const candidate = result.candidates.find((c) => c.id === "costar-space:100")!;
        assert.equal(candidate.spaceUseCode, 5);
        assert.equal(candidate.listingStatusCode, 1);
        assert.equal(candidate.suite, "A");
        assert.equal(candidate.propertyId, "1");
        assert.equal(candidate.rent!.serviceTypeCode, 13);
      } finally {
        db.close();
      }
    },
  );
});

test("several suites at one address stay distinct candidates with stable space IDs", async () => {
  await fixture(
    [property(1)],
    [listing(10, [space(100, { suite: "A" }), space(101, { suite: "B" }), space(102, { suite: "A" })])],
    async (config) => {
      await importLocalDataset(config);
      const db = openDatabase(config);
      try {
        const result = await searchOfferedSpaces(db, "houston");
        const ids = result.candidates.map((c) => c.id);
        assert.equal(new Set(ids).size, 3);
        assert.deepEqual(ids, ["costar-space:100", "costar-space:101", "costar-space:102"]);
      } finally {
        db.close();
      }
    },
  );
});

test("rent and size ranges plus service codes survive import into candidates", async () => {
  await fixture(
    [property(1)],
    [listing(10, [space(100, { rateLow: 1, rateHigh: 3, rateBasis: 2, squareFeetMin: 500, squareFeetMax: 2000, serviceType: 7 })])],
    async (config) => {
      await importLocalDataset(config);
      const db = openDatabase(config);
      try {
        const result = await searchOfferedSpaces(db, "houston");
        const candidate = result.candidates[0];
        assert.equal(candidate.floorAreaSqFt, null);
        assert.deepEqual(candidate.sizeRangeSqFt, { minimum: 500, maximum: 2000 });
        assert.deepEqual(candidate.rent, {
          low: 1,
          high: 3,
          rateBasisCode: 2,
          currencyCode: 1,
          measurementCode: 1,
          serviceTypeCode: 7,
        });
      } finally {
        db.close();
      }
    },
  );
});

test("every page beyond the first batch is evaluated; panning cannot change run results", async () => {
  const many = Array.from({ length: BATCH_SIZE + 50 }, (_, index) => space(1000 + index));
  await fixture([property(1)], [listing(10, many)], async (config) => {
    await importLocalDataset(config);
    const db = openDatabase(config);
    try {
      const result = await searchOfferedSpaces(db, "houston");
      assert.equal(result.counts.examined, BATCH_SIZE + 50);
      assert.equal(result.counts.included, BATCH_SIZE + 50);
      assert.equal(result.counts.scanCapped, false);
      assert.equal(result.candidates.length, BATCH_SIZE + 50);
    } finally {
      db.close();
    }
  });
});

test("a scan cap is reported explicitly, never hidden", async () => {
  const many = Array.from({ length: 250 }, (_, index) => space(2000 + index));
  await fixture([property(1)], [listing(10, many)], async (config) => {
    await importLocalDataset(config);
    const db = openDatabase(config);
    try {
      const result = await searchOfferedSpaces(db, "houston", { maxScan: 100 });
      assert.equal(result.counts.examined, 100);
      assert.equal(result.counts.scanCapped, true);
      assert.equal(result.candidates.length, 100);
      assert.equal(result.cancelled, false);
    } finally {
      db.close();
    }
  });
});

test("cancellation between batches stops the scan and keeps partial results", async () => {
  const many = Array.from({ length: BATCH_SIZE + 200 }, (_, index) => space(3000 + index));
  await fixture([property(1)], [listing(10, many)], async (config) => {
    await importLocalDataset(config);
    const db = openDatabase(config);
    try {
      let yields = 0;
      let cancelRequested = false;
      const result = await searchOfferedSpaces(db, "houston", {
        yieldLoop: async () => {
          yields += 1;
          if (yields === 2) cancelRequested = true;
        },
        shouldCancel: () => cancelRequested,
      });
      assert.equal(result.cancelled, true);
      assert.ok(result.counts.examined <= BATCH_SIZE * 2);
      assert.ok(result.counts.examined < BATCH_SIZE + 200);
    } finally {
      db.close();
    }
  });
});

test("legacy v1 caches require the documented reimport and rebuild atomically", async () => {
  await fixture([property(1)], [listing(10, [space(100)])], async (config) => {
    await importLocalDataset(config);
    const db = new DatabaseSync(config.dbPath);
    db.prepare("UPDATE meta SET value='expansion-local-v1' WHERE key='schemaVersion'").run();
    db.close();
    assert.throws(
      () => openDatabase(config),
      (error: unknown) =>
        error instanceof LocalDataError &&
        error.code === "source_failure" &&
        error.message.includes("v2 required"),
    );
    // The documented reimport rebuilds the cache and restores service.
    await importLocalDataset(config);
    const reopened = openDatabase(config);
    try {
      const result = await searchOfferedSpaces(reopened, "houston");
      assert.equal(result.counts.included, 1);
    } finally {
      reopened.close();
    }
  });
});

test("zero candidate spaces complete truthfully instead of fabricating results", async () => {
  await fixture([property(1)], [listing(10, [space(100, { spaceUse: 7 })], { listingStatus: 1 })], async (config) => {
    await importLocalDataset(config);
    const db = openDatabase(config);
    try {
      const result = await searchOfferedSpaces(db, "houston");
      assert.equal(result.counts.examined, 1);
      assert.equal(result.counts.included, 0);
      assert.equal(result.candidates.length, 0);
      assert.equal(result.counts.incompatibleUse, 1);
    } finally {
      db.close();
    }
  });
});
