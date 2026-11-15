import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvidenceImage } from "./backend/investigation-sources.ts";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "restaurantos-image-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const volume = join(root, "volume");
  const images = join(volume, "evidence-images");
  mkdirSync(images, { recursive: true });
  const alias = join(root, "repository-data");
  symlinkSync(volume, alias, "dir");
  const photo = join(images, "aerial.jpg");
  writeFileSync(photo, jpeg);
  return { root, images, photo, allowed: join(alias, "evidence-images") };
}

test("aerial images accept the helper's real volume path behind the Docker directory symlink", t => {
  const { photo, allowed } = fixture(t);
  // Python Path.resolve() returns this path, not the repository's symlink alias.
  assert.deepEqual(readEvidenceImage(realpathSync(photo), allowed), jpeg);
  assert.deepEqual(readEvidenceImage(join(allowed, "aerial.jpg"), allowed), jpeg);
});

test("aerial images still work in a normal non-symlink directory", t => {
  const { photo, images } = fixture(t);
  assert.deepEqual(readEvidenceImage(photo, images), jpeg);
});

test("aerial image guard rejects a symlink escaping the image directory", t => {
  const { root, images } = fixture(t);
  const outside = join(root, "private.txt");
  writeFileSync(outside, "must not be served");
  const link = join(images, "escape.jpg");
  symlinkSync(outside, link);
  assert.throws(() => readEvidenceImage(link, images), /Invalid image reference/);
});

test("aerial image guard rejects traversal and a sibling with the same prefix", t => {
  const { images } = fixture(t);
  const sibling = `${images}-outside`;
  mkdirSync(sibling);
  const outside = join(sibling, "private.jpg");
  writeFileSync(outside, jpeg);
  assert.throws(() => readEvidenceImage(outside, images), /Invalid image reference/);
  assert.throws(() => readEvidenceImage(`${images}/../evidence-images-outside/private.jpg`, images), /Invalid image reference/);
  assert.throws(() => readEvidenceImage(images, images), /Invalid image reference/);
});

test("aerial images retain their size limit and reject missing files", t => {
  const { images, photo } = fixture(t);
  writeFileSync(photo, Buffer.alloc(15_000_001));
  assert.throws(() => readEvidenceImage(photo, images), /Image exceeds limit/);
  assert.throws(() => readEvidenceImage(join(images, "missing.jpg"), images));
});
