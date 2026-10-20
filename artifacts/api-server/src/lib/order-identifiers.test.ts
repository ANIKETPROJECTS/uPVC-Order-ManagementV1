import assert from "node:assert/strict";
import test from "node:test";
import { formatProjectPieceId, matchesProjectPieceId } from "./order-identifiers";

const lotId = "P-26-0042-L1";

test("formats project shutter IDs with independent glass and mesh numbering", () => {
  assert.deepEqual(
    [1, 2, 3].map((pieceNo) => formatProjectPieceId(lotId, "W3", "glass_shutter", pieceNo)),
    [`${lotId}-W3-GS1`, `${lotId}-W3-GS2`, `${lotId}-W3-GS3`],
  );
  assert.deepEqual(
    [1, 2, 3].map((pieceNo) => formatProjectPieceId(lotId, "W3", "mesh_shutter", pieceNo)),
    [`${lotId}-W3-MS1`, `${lotId}-W3-MS2`, `${lotId}-W3-MS3`],
  );
});

test("normalizes window numbers and preserves frame IDs", () => {
  assert.equal(formatProjectPieceId(lotId, "W03", "glass_shutter", 1), `${lotId}-W3-GS1`);
  assert.equal(formatProjectPieceId(lotId, "W03", "mesh_shutter", 1), `${lotId}-W3-MS1`);
  assert.equal(formatProjectPieceId(lotId, "W03", "frame", 1), `${lotId}-W3-F`);
  assert.equal(formatProjectPieceId(lotId, "W03", "frame", 2), `${lotId}-W3-F2`);
});

test("matches current and legacy IDs only for the same lot, window, kind, and piece", () => {
  assert.equal(matchesProjectPieceId(`${lotId}-W3-GS1`, lotId, "W3", "glass_shutter", 1), true);
  assert.equal(matchesProjectPieceId(`${lotId}-W3-G1`, lotId, "W03", "glass_shutter", 1), true);
  assert.equal(matchesProjectPieceId(`${lotId}-W3-MS1`, lotId, "W3", "mesh_shutter", 1), true);
  assert.equal(matchesProjectPieceId(`${lotId}-W3-M1`, lotId, "W3", "mesh_shutter", 1), true);

  assert.equal(matchesProjectPieceId(`${lotId}-W3-G1`, lotId, "W4", "glass_shutter", 1), false);
  assert.equal(matchesProjectPieceId("P-26-0042-L2-W3-G1", lotId, "W3", "glass_shutter", 1), false);
  assert.equal(matchesProjectPieceId(`${lotId}-W3-G1`, lotId, "W3", "mesh_shutter", 1), false);
  assert.equal(matchesProjectPieceId(`${lotId}-W3-G1`, lotId, "W3", "glass_shutter", 2), false);
});
