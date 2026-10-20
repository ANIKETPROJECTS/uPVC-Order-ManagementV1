import assert from "node:assert/strict";
import test from "node:test";
import {
  createWindowPieces,
  isPiecePrinted,
  pieceDisplayId,
  pieceQrPayload,
  reconcileWindowPieceCounts,
} from "./order-qr-printing";
import type { OrderDocument, OrderWindowDocument } from "./mongo";

const baseWindow = (overrides: Partial<OrderWindowDocument> = {}): OrderWindowDocument => ({
  _id: "window-1",
  orderRecordId: "record-1",
  windowNo: "W03",
  lotId: "P-26-0293-L1",
  widthMm: 1000,
  heightMm: 1000,
  windowType: "Casement",
  glassShutterCount: 1,
  glassShutterReadyCount: 0,
  meshShutterCount: 1,
  meshShutterReadyCount: 0,
  frameCount: 2,
  frameStatus: "pending",
  shutterStatus: "pending",
  glassStatus: "pending",
  pendingReason: null,
  sqFt: 10,
  createdBy: "user",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedBy: "user",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});
const project = { orderId: "P-26-0293", clientType: "Project" } as OrderDocument;

test("project display IDs preserve lot/window codes and show first frame as F1", () => {
  const window = baseWindow();
  assert.equal(pieceDisplayId(project, window, { kind: "frame", pieceNo: 1 }), "P-26-0293-L1-W3-F1");
  assert.equal(pieceDisplayId(project, window, { kind: "frame", pieceNo: 2 }), "P-26-0293-L1-W3-F2");
  assert.equal(pieceDisplayId(project, window, { kind: "glass_shutter", pieceNo: 1 }), "P-26-0293-L1-W3-GS1");
  assert.equal(pieceDisplayId(project, window, { kind: "mesh_shutter", pieceNo: 1 }), "P-26-0293-L1-W3-MS1");
});

test("retail display IDs are readable while QR payload keeps the stored piece ID", () => {
  const retail = { orderId: "R-26-0293", clientType: "Retail" } as OrderDocument;
  const window = baseWindow({ lotId: null, windowNo: "W03" });
  assert.equal(pieceDisplayId(retail, window, { kind: "frame", pieceNo: 1 }), "R-26-0293-W3-F1");
  assert.equal(pieceDisplayId(retail, window, { kind: "glass_shutter", pieceNo: 1 }), "R-26-0293-W3-GS1");
  assert.equal(pieceQrPayload(retail.orderId, window._id, "stored-uuid"), "FRAMEWISE_PIECE:R-26-0293:window-1:stored-uuid");
});

test("legacy pieces are treated printed and newly synthesized pieces are pending", () => {
  const legacyPieces = createWindowPieces(baseWindow(), true);
  const newPieces = createWindowPieces(baseWindow());
  assert.equal(legacyPieces.length, 4);
  assert(legacyPieces.every(isPiecePrinted));
  assert(newPieces.every((piece) => !isPiecePrinted(piece)));
});

test("count sync adds pending pieces, rejects removing ready pieces, and warns for printed removals", () => {
  const initial = createWindowPieces(baseWindow());
  const added = reconcileWindowPieceCounts({ ...baseWindow(), pieces: initial }, { glassShutterCount: 2 });
  assert.equal(added.error, null);
  assert.equal(added.pieces.filter((piece) => piece.kind === "glass_shutter").length, 2);
  assert.equal(added.pieces.find((piece) => piece.kind === "glass_shutter" && piece.pieceNo === 2)?.qrPrint?.status, "pending");

  const ready = initial.map((piece) => piece.kind === "glass_shutter" ? { ...piece, status: "ready" as const } : piece);
  const blocked = reconcileWindowPieceCounts({ ...baseWindow(), pieces: ready }, { glassShutterCount: 0 });
  assert.match(blocked.error ?? "", /already ready/);

  const printed = initial.map((piece) => piece.kind === "mesh_shutter" ? { ...piece, qrPrint: { status: "printed" as const, printCount: 1, firstPrintedAt: new Date(), lastPrintedAt: new Date(), lastPrintedBy: "user" } } : piece);
  const removed = reconcileWindowPieceCounts({ ...baseWindow(), pieces: printed }, { meshShutterCount: 0 });
  assert.equal(removed.error, null);
  assert.equal(removed.printedRemoved, 1);
});
