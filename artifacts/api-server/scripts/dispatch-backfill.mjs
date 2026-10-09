import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

function usage() {
  console.log(
    "Dispatch backfill (dry-run by default)\n"
      + "  pnpm --filter @workspace/api-server dispatch:backfill\n"
      + "  pnpm --filter @workspace/api-server dispatch:backfill -- --apply --backup-confirmed [--run-id RUN_ID]\n"
      + "  pnpm --filter @workspace/api-server dispatch:backfill -- --rollback RUN_ID --backup-confirmed\n"
      + "Pause order and dispatch writes during apply or rollback. The migration does not use transactions.\n",
  );
}

function lotCode(orderId, sequence) {
  return `${orderId}-L${sequence}`;
}

function legacyLotCode(orderId, sequence) {
  return `${orderId}-L${String(sequence).padStart(2, "0")}`;
}

function dispatchCode(orderId, sequence, dispatchNo) {
  return `${lotCode(orderId, sequence)}-D${dispatchNo}`;
}

function clone(value) {
  return structuredClone(value);
}

function orderSnapshot(order) {
  const snapshot = { status: order.status };
  for (const key of [
    "lots",
    "nextLotSequence",
    "dispatchStatus",
    "dispatchLifecyclePreviousStatus",
    "updatedAt",
    "updatedBy",
  ]) {
    if (Object.hasOwn(order, key)) snapshot[key] = clone(order[key]);
  }
  return snapshot;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function calculateOrderDispatchStatus(lots, dispatches) {
  const nonCancelled = dispatches.filter((record) => record.status !== "cancelled");
  const active = nonCancelled.some((record) =>
    record.status === "planned" || record.status === "dispatched");
  const deliveredEveryLot = lots.length > 0 && lots.every((lot) =>
    nonCancelled.some((record) =>
      record.lotRecordId === lot._id && record.status === "delivered"));
  if (deliveredEveryLot && !active) return "delivered";
  if (nonCancelled.some((record) =>
    ["dispatched", "delivered", "returned"].includes(record.status))) return "dispatched";
  return "pending_dispatch";
}

function dispatchWindowSnapshot(windows) {
  return windows.map((window) => ({
    windowId: String(window._id),
    windowNo: window.windowNo ?? "",
    widthMm: Number(window.widthMm ?? 0),
    heightMm: Number(window.heightMm ?? 0),
    windowType: window.windowType ?? "Window",
    sqFt: Number(window.sqFt ?? (
      Number(window.widthMm ?? 0) * Number(window.heightMm ?? 0) / 92903.04
    )),
    frameStatus: window.frameStatus ?? "pending",
    shutterStatus: window.shutterStatus ?? "pending",
    glassStatus: window.glassStatus ?? "pending",
  }));
}

function capturePreviousOrder(order) {
  return orderSnapshot(order);
}

function applyPreviousOrderUpdate(previousOrder) {
  const set = {};
  const unset = {};
  for (const key of [
    "lots",
    "nextLotSequence",
    "status",
    "dispatchStatus",
    "dispatchLifecyclePreviousStatus",
    "updatedAt",
    "updatedBy",
  ]) {
    if (Object.hasOwn(previousOrder, key)) set[key] = clone(previousOrder[key]);
    else unset[key] = "";
  }
  return { set, unset };
}

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI must be configured in the environment.");
  const url = new URL(uri);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    || "upvc_order_management";
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db(databaseName) };
}

async function ensureMigrationIndexes(db) {
  const dispatches = db.collection("dispatch_records");
  await Promise.all([
    dispatches.createIndex(
      { lotRecordId: 1, dispatchNo: 1 },
      { unique: true, name: "dispatch_number_per_lot_unique" },
    ),
    dispatches.createIndex(
      { dispatchCode: 1 },
      { unique: true, name: "dispatch_code_unique" },
    ),
    dispatches.createIndex(
      { qrToken: 1 },
      { unique: true, name: "dispatch_qr_token_unique" },
    ),
    db.collection("dispatch_migration_journal").createIndex(
      { runId: 1, orderRecordId: 1 },
      { unique: true, name: "dispatch_migration_journal_order_unique" },
    ),
    db.collection("order_document_metadata").createIndex(
      { dispatchId: 1, documentVersion: 1 },
      {
        unique: true,
        name: "dispatch_challan_version_unique",
        partialFilterExpression: {
          dispatchId: { $type: "string" },
          documentVersion: { $type: "number" },
        },
      },
    ),
  ]);
}

function assertBackupConfirmed() {
  if (!has("--backup-confirmed")) {
    throw new Error(
      "No changes were made. Take a verified MongoDB backup first, then pass --backup-confirmed.",
    );
  }
}

async function runDryRun(db) {
  const orders = await db.collection("orders").find({}).toArray();
  const windows = await db.collection("order_windows").find({}).toArray();
  const records = await db.collection("dispatch_records").find({}).toArray();
  const existingDispatchesByLot = new Set(records.map((record) => record.lotRecordId));
  let ordersNeedingLots = 0;
  let lotsToNormalize = 0;
  let windowsToAssign = 0;
  let historicalOrders = 0;
  let dispatchesToBackfill = 0;

  for (const order of orders) {
    const lots = order.lots ?? [];
    if (!lots.length) ordersNeedingLots += 1;
    const prepared = lots.length
      ? lots
      : [{ _id: "(new lot)", sequence: 1, lotId: lotCode(order.orderId, 1) }];
    for (const lot of prepared) {
      const sequence = Number(lot.sequence ?? 1);
      if (lot.lotId !== lotCode(order.orderId, sequence)) lotsToNormalize += 1;
    }
    const primaryLotId = prepared[0]?._id;
    windowsToAssign += windows.filter((window) =>
      window.orderRecordId === order._id
      && window.lotRecordId == null
      && primaryLotId).length;

    const historical = order.status === "dispatched"
      || order.status === "installed"
      || order.dispatchStatus === "dispatched"
      || order.dispatchStatus === "delivered";
    if (!historical) continue;
    historicalOrders += 1;
    for (const lot of prepared) {
      const lotRecordId = lot._id;
      if (lotRecordId && !existingDispatchesByLot.has(lotRecordId)) {
        dispatchesToBackfill += 1;
      }
    }
  }
  console.log(JSON.stringify({
    mode: "dry-run",
    orderCount: orders.length,
    ordersNeedingLots,
    lotsToNormalize,
    windowsToAssign,
    historicalOrders,
    dispatchesToBackfill,
    note: "Read-only preview. No documents or indexes were changed.",
  }, null, 2));
}

async function runApply(db) {
  assertBackupConfirmed();
  await ensureMigrationIndexes(db);
  const runs = db.collection("dispatch_migration_runs");
  const journals = db.collection("dispatch_migration_journal");
  const ordersCollection = db.collection("orders");
  const windowsCollection = db.collection("order_windows");
  const dispatchesCollection = db.collection("dispatch_records");
  const eventsCollection = db.collection("activity_events");
  const suppliedRunId = valueAfter("--run-id");
  if (has("--run-id") && !suppliedRunId) {
    throw new Error("Provide a value after --run-id.");
  }
  const runId = suppliedRunId || randomUUID();
  let run = await runs.findOne({ _id: runId });
  if (run?.state === "complete") {
    throw new Error(`Migration ${runId} is already complete. Use --rollback only after a deliberate decision.`);
  }
  if (run?.state === "reverted") {
    throw new Error(`Migration ${runId} was reverted and cannot be resumed.`);
  }
  const startedAt = new Date();
  if (!run) {
    run = {
      _id: runId,
      state: "running",
      startedAt,
      completedAt: null,
      revertedAt: null,
      backupConfirmedAt: startedAt,
    };
    await runs.insertOne(run);
  }
  console.log(`Dispatch backfill run ID: ${runId}`);

  const orders = await ordersCollection.find({}).toArray();
  let normalizedOrderCount = 0;
  let migratedDispatchCount = 0;
  let assignedWindowCount = 0;
  for (const initialOrder of orders) {
    let order = await ordersCollection.findOne({ _id: initialOrder._id });
    if (!order) continue;
    const existingJournal = await journals.findOne({
      runId,
      orderRecordId: order._id,
    });
    const initiallyHistorical = order.status === "dispatched"
      || order.status === "installed"
      || order.dispatchStatus === "dispatched"
      || order.dispatchStatus === "delivered";
    const windowsBefore = await windowsCollection
      .find({ orderRecordId: order._id })
      .toArray();
    const journalPreviousWindows = existingJournal?.previousWindows
      ?? windowsBefore.map((window) => ({
        windowId: String(window._id),
        ...(Object.hasOwn(window, "lotRecordId")
          ? { lotRecordId: window.lotRecordId }
          : {}),
      }));
    if (!existingJournal) {
      await journals.insertOne({
        _id: randomUUID(),
        runId,
        orderRecordId: order._id,
        shouldBackfillDispatch: initiallyHistorical,
        previousOrder: capturePreviousOrder(order),
        previousWindows: journalPreviousWindows,
        createdDispatchIds: [],
      });
    }

    const sourceLots = [...(order.lots ?? [])].sort((a, b) =>
      Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
    const lots = sourceLots.length
      ? sourceLots.map((lot, index) => {
          const sequence = Number.isInteger(lot.sequence) && lot.sequence > 0
            ? lot.sequence
            : index + 1;
          const id = String(lot._id ?? randomUUID());
          const canonical = lotCode(order.orderId, sequence);
          const originalLotId = lot.lotId ? String(lot.lotId) : null;
          return {
            ...lot,
            _id: id,
            sequence,
            lotId: canonical,
            ...(originalLotId && originalLotId !== canonical
              ? { legacyLotId: lot.legacyLotId ?? originalLotId }
              : {}),
          };
        })
      : [{
          _id: randomUUID(),
          sequence: 1,
          lotId: lotCode(order.orderId, 1),
          createdBy: "dispatch-backfill",
          createdAt: startedAt,
        }];
    const maxSequence = Math.max(0, ...lots.map((lot) => lot.sequence));
    const nextLotSequence = Math.max(
      Number(order.nextLotSequence ?? 1),
      maxSequence + 1,
    );
    const primaryLot = lots[0];
    const runCreatedRecord = await dispatchesCollection.findOne({
      orderRecordId: order._id,
      migrationRunId: runId,
    });
    const historical = Boolean(existingJournal?.shouldBackfillDispatch)
      || initiallyHistorical
      || Boolean(runCreatedRecord);
    for (const window of windowsBefore) {
      const targetLotRecordId = lots.some((lot) => lot._id === window.lotRecordId)
        ? window.lotRecordId
        : primaryLot._id;
      if ((window.lotRecordId ?? null) !== targetLotRecordId) {
        await windowsCollection.updateOne(
          { _id: window._id, orderRecordId: order._id },
          { $set: { lotRecordId: targetLotRecordId } },
        );
        assignedWindowCount += 1;
      }
    }
    const now = new Date();
    const orderSet = {
      lots,
      nextLotSequence,
      updatedAt: now,
      updatedBy: "dispatch-backfill",
    };
    if (historical) {
      const lotDispatches = await dispatchesCollection.find({
        orderRecordId: order._id,
      }).toArray();
      const windowsAfter = await windowsCollection
        .find({ orderRecordId: order._id })
        .toArray();
      const delivered = order.status === "installed"
        || order.dispatchStatus === "delivered";
      for (const lot of lots) {
        const existingForLot = lotDispatches.find((dispatch) =>
          dispatch.lotRecordId === lot._id);
        if (existingForLot) {
          if (existingForLot.migrationRunId === runId) {
            await journals.updateOne(
              { runId, orderRecordId: order._id },
              { $addToSet: { createdDispatchIds: existingForLot._id } },
            );
          }
          continue;
        }
        const lotWindows = windowsAfter.filter((window) =>
          (window.lotRecordId ?? primaryLot._id) === lot._id);
        const dispatchNo = 1;
        const previousLotId = sourceLots.find((oldLot) => String(oldLot._id) === lot._id)?.lotId;
        const legacyLot = previousLotId && previousLotId !== lot.lotId
          ? String(previousLotId)
          : legacyLotCode(order.orderId, lot.sequence);
        const newDispatch = {
          _id: randomUUID(),
          orderRecordId: order._id,
          orderId: order.orderId,
          clientName: order.clientName,
          lotRecordId: lot._id,
          lotId: lot.lotId,
          lotSequence: lot.sequence,
          legacyLotIds: legacyLot === lot.lotId ? [] : [legacyLot],
          legacyDispatchCodes: [`${legacyLot}-D${dispatchNo}`],
          dispatchNo,
          dispatchCode: dispatchCode(order.orderId, lot.sequence, dispatchNo),
          dispatchNote: "Backfilled from the pre-dispatch order lifecycle.",
          status: delivered ? "delivered" : "dispatched",
          plannedAt: null,
          dispatchedAt: order.updatedAt ?? order.createdAt ?? now,
          deliveredAt: delivered ? (order.updatedAt ?? now) : null,
          returnedAt: null,
          locationName: order.locationName ?? "",
          siteAddress: order.siteAddress ?? null,
          siteLatitude: order.siteLatitude ?? null,
          siteLongitude: order.siteLongitude ?? null,
          vehicleNumber: null,
          driverName: null,
          driverPhone: null,
          challanNumber: null,
          windowsSnapshot: dispatchWindowSnapshot(lotWindows),
          qrToken: randomUUID(),
          qrRevokedAt: null,
          overrideReason: null,
          createdBy: "dispatch-backfill",
          createdAt: now,
          updatedBy: "dispatch-backfill",
          updatedAt: now,
          cancelledBy: null,
          cancelledAt: null,
          cancelReason: null,
          migrationRunId: runId,
        };
        await dispatchesCollection.insertOne(newDispatch);
        await journals.updateOne(
          { runId, orderRecordId: order._id },
          { $addToSet: { createdDispatchIds: newDispatch._id } },
        );
        await eventsCollection.insertOne({
          _id: randomUUID(),
          entityType: "dispatch",
          orderRecordId: order._id,
          dispatchId: newDispatch._id,
          eventType: "dispatch.backfilled",
          actorId: "dispatch-backfill",
          actorName: "Dispatch migration",
          message: `Backfilled ${newDispatch.dispatchCode} from the existing order lifecycle.`,
          metadata: { runId, status: newDispatch.status },
          createdAt: now,
        });
        migratedDispatchCount += 1;
      }

      const afterDispatches = await dispatchesCollection
        .find({ orderRecordId: order._id })
        .toArray();
      orderSet.dispatchStatus = calculateOrderDispatchStatus(lots, afterDispatches);
      if (
        orderSet.dispatchStatus !== "pending_dispatch"
        && order.status !== "installed"
      ) {
        if (order.status !== "dispatched") {
          orderSet.dispatchLifecyclePreviousStatus =
            order.dispatchLifecyclePreviousStatus ?? order.status;
        } else if (order.dispatchLifecyclePreviousStatus) {
          orderSet.dispatchLifecyclePreviousStatus = order.dispatchLifecyclePreviousStatus;
        }
        orderSet.status = "dispatched";
      }
    }
    await ordersCollection.updateOne({ _id: order._id }, { $set: orderSet });
    const updatedOrder = await ordersCollection.findOne({ _id: order._id });
    const updatedWindows = await windowsCollection
      .find({ orderRecordId: order._id })
      .toArray();
    const appliedWindowLotIds = new Map(updatedWindows.map((window) => [
      String(window._id),
      window.lotRecordId ?? null,
    ]));
    const finalWindowJournal = journalPreviousWindows.map((previous) => ({
      ...previous,
      appliedLotRecordId: appliedWindowLotIds.get(previous.windowId) ?? null,
    }));
    await journals.updateOne(
      { runId, orderRecordId: order._id },
      {
        $set: {
          appliedOrder: updatedOrder ? orderSnapshot(updatedOrder) : orderSnapshot(order),
          previousWindows: finalWindowJournal,
        },
      },
    );
    if (JSON.stringify(sourceLots) !== JSON.stringify(lots)) normalizedOrderCount += 1;
  }

  await runs.updateOne(
    { _id: runId, state: "running" },
    { $set: { state: "complete", completedAt: new Date() } },
  );
  console.log(JSON.stringify({
    mode: "applied",
    runId,
    orderCount: orders.length,
    normalizedOrderCount,
    assignedWindowCount,
    migratedDispatchCount,
    note: "Backup confirmation was recorded. Keep this run ID if a deliberate rollback is needed.",
  }, null, 2));
}

async function runRollback(db) {
  assertBackupConfirmed();
  const runId = valueAfter("--rollback");
  if (!runId) throw new Error("Provide the migration run ID after --rollback.");
  const runs = db.collection("dispatch_migration_runs");
  const run = await runs.findOne({ _id: runId });
  if (!run || run.state !== "complete") {
    throw new Error("Only a completed dispatch backfill can be rolled back.");
  }
  const journals = await db.collection("dispatch_migration_journal")
    .find({ runId })
    .toArray();
  const ordersCollection = db.collection("orders");
  const windowsCollection = db.collection("order_windows");
  const dispatchesCollection = db.collection("dispatch_records");

  for (const journal of journals) {
    const order = await ordersCollection.findOne({ _id: journal.orderRecordId });
    if (!order || !journal.appliedOrder) {
      throw new Error(`Rollback stopped: order ${journal.orderRecordId} is missing or its migration snapshot is incomplete.`);
    }
    if (!sameValue(orderSnapshot(order), journal.appliedOrder)) {
      throw new Error(`Rollback stopped: order ${order.orderId} changed after migration.`);
    }
    const createdDispatches = await dispatchesCollection.find({
      _id: { $in: journal.createdDispatchIds ?? [] },
    }).toArray();
    if (createdDispatches.length !== (journal.createdDispatchIds ?? []).length
      || createdDispatches.some((record) =>
        record.migrationRunId !== runId
        || record.status !== "dispatched" && record.status !== "delivered"
        || record.updatedAt?.getTime() !== record.createdAt?.getTime())) {
      throw new Error(`Rollback stopped: a backfilled dispatch for ${order.orderId} was edited or is missing.`);
    }
    const nonMigrationDispatch = await dispatchesCollection.findOne({
      orderRecordId: order._id,
      migrationRunId: { $ne: runId },
    });
    if (nonMigrationDispatch) {
      throw new Error(`Rollback stopped: ${order.orderId} has dispatch records not created by this migration.`);
    }
    for (const windowSnapshot of journal.previousWindows ?? []) {
      const current = await windowsCollection.findOne({ _id: windowSnapshot.windowId });
      if (!current || (current.lotRecordId ?? null) !== (windowSnapshot.appliedLotRecordId ?? null)) {
        throw new Error(`Rollback stopped: window ${windowSnapshot.windowId} changed after migration.`);
      }
    }
    const oldLotIds = new Set((journal.previousOrder.lots ?? []).map((lot) => lot._id));
    const appliedLotIds = new Set((journal.appliedOrder.lots ?? []).map((lot) => lot._id));
    const migrationAddedLotIds = [...appliedLotIds].filter((id) => !oldLotIds.has(id));
    if (migrationAddedLotIds.length) {
      const postMigrationWindow = await windowsCollection.findOne({
        orderRecordId: order._id,
        lotRecordId: { $in: migrationAddedLotIds },
        _id: { $nin: (journal.previousWindows ?? []).map((window) => window.windowId) },
      });
      if (postMigrationWindow) {
        throw new Error(`Rollback stopped: a new window was assigned to a migration-created lot on ${order.orderId}.`);
      }
    }
  }

  for (const journal of journals) {
    const orderId = journal.orderRecordId;
    for (const windowSnapshot of journal.previousWindows ?? []) {
      if (Object.hasOwn(windowSnapshot, "lotRecordId")) {
        await windowsCollection.updateOne(
          { _id: windowSnapshot.windowId },
          { $set: { lotRecordId: windowSnapshot.lotRecordId } },
        );
      } else {
        await windowsCollection.updateOne(
          { _id: windowSnapshot.windowId },
          { $unset: { lotRecordId: "" } },
        );
      }
    }
    const restore = applyPreviousOrderUpdate(journal.previousOrder);
    await ordersCollection.updateOne(
      { _id: orderId },
      {
        $set: restore.set,
        ...(Object.keys(restore.unset).length ? { $unset: restore.unset } : {}),
      },
    );
    if (journal.createdDispatchIds?.length) {
      await dispatchesCollection.deleteMany({
        _id: { $in: journal.createdDispatchIds },
        migrationRunId: runId,
      });
    }
  }
  await runs.updateOne(
    { _id: runId, state: "complete" },
    { $set: { state: "reverted", revertedAt: new Date() } },
  );
  console.log(JSON.stringify({
    mode: "rolled-back",
    runId,
    orderCount: journals.length,
    note: "Only the backfill changes were reverted. Migration audit events and journals were retained.",
  }, null, 2));
}

async function main() {
  if (has("--help") || has("-h")) {
    usage();
    return;
  }
  if (has("--apply") && has("--rollback")) {
    throw new Error("Choose either --apply or --rollback, not both.");
  }
  if (has("--run-id") && !has("--apply")) {
    throw new Error("--run-id is only valid with --apply.");
  }
  if (has("--rollback") && !valueAfter("--rollback")) {
    throw new Error("Provide the migration run ID after --rollback.");
  }
  if (!has("--apply") && !has("--rollback")) {
    if (args.length) usage();
    const { client, db } = await connect();
    try {
      await runDryRun(db);
    } finally {
      await client.close();
    }
    return;
  }
  assertBackupConfirmed();
  const { client, db } = await connect();
  try {
    if (has("--apply")) await runApply(db);
    else await runRollback(db);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dispatch migration failed.");
  process.exitCode = 1;
});
