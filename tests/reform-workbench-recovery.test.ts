import assert from "node:assert/strict";
import test from "node:test";
import { editHouse } from "../src/reform/house";
import {
  cancelBenchRecovery,
  inspectBenchRecovery,
  inspectBenchReturn,
  reclaimBenchBoard,
  returnBenchBoard,
  startBenchRecovery,
} from "../src/reform/housing/benchRecovery";
import { createFoodBundle } from "../src/reform/housing/food";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import {
  housingLinkId,
  housingPoint,
  housingSlotId,
} from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import {
  advance,
  inspectOrder,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import {
  base,
  building,
  ok,
  one,
  two,
  plan,
  reserved,
  staged,
} from "./helpers/construction";

const bench = "fixture-1";
const room = "yard";
const boardId = JSON.stringify(["bench-board", bench]);
const atBench = housingPoint(room, 6);
const supply = housingPoint("living", 0);

function equipped() {
  const original = base();
  original.wood = 20;
  const house = editHouse(original.house, {
    type: "build",
    room,
    kind: "workbench",
    cell: 6,
  });
  return ok(applyHousingHouseEdit(original, house));
}

function roundTrip(game: Game, origin: Game) {
  const loaded = importSlot(
    exportSlot({ id: "recovery", name: "木工台の解体", game, origin }),
  );
  assert.deepEqual(loaded.game, structuredClone(game));
  assert.deepEqual(loaded.origin, structuredClone(origin));
  return loaded.game;
}

function fixtures(game: Game) {
  return game.house.rooms.flatMap((r) => r.fixtures);
}
function freeWorker() {
  return order(equipped(), two, "work", "care:hard");
}
function demolish(game: Game) {
  const preview = inspectBenchRecovery(game, bench, one);
  assert.equal(preview.ok, true, preview.disabled);
  const active = ok(startBenchRecovery(game, bench, one));
  return advance(active, preview.minutes!);
}

test("demolition reserves the real bench for a walk and 15 work minutes; the board adds one wood only after physical return", () => {
  const origin = freeWorker();
  const original = structuredClone(origin);
  const preview = inspectBenchRecovery(origin, bench, one);
  const walk = inspectOrder(origin, one, "work", "wood", { fixtureId: bench })
    .facility!.moveMinutes;
  assert.equal(preview.minutes, walk + 15);
  const active = ok(startBenchRecovery(origin, bench, one));
  assert.equal(active.time, origin.time);
  assert.equal(active.actors[0].task?.station, housingSlotId(room, bench, 0));
  assert.deepEqual(origin, original);
  const last = advance(active, preview.minutes! - 1);
  assert.equal(last.wood, origin.wood);
  assert.ok(fixtures(last).some((f) => f.id === bench));
  assert.equal(last.housing!.state.items[boardId], undefined);
  const finished = advance(last, 1);
  assert.equal(finished.actors[0].task, null);
  assert.equal(finished.wood, origin.wood);
  assert.equal(
    fixtures(finished).some((f) => f.id === bench),
    false,
  );
  assert.equal(finished.housing!.benchRecovery!.phase, "board");
  assert.deepEqual(finished.housing!.state.items[boardId].position, {
    kind: "at",
    point: atBench,
  });
  assert.ok(reclaimBenchBoard(finished, bench).error);
  const back = inspectBenchReturn(finished, bench, one);
  assert.ok(back.ok, back.disabled);
  const returning = ok(returnBenchBoard(finished, bench, one));
  const arriving = advance(returning, back.minutes! - 1);
  assert.equal(arriving.wood, origin.wood);
  assert.deepEqual(arriving.housing!.state.items[boardId].position, {
    kind: "carried",
    carrierId: one,
  });
  const done = advance(arriving, 1);
  assert.equal(done.wood, origin.wood + 1);
  assert.equal(done.time, origin.time + walk + 15 + back.minutes!);
  assert.equal(done.housing!.benchRecovery, undefined);
  assert.equal(done.housing!.state.items[boardId], undefined);
  assert.equal(done.actors[0].task, null);
  assert.deepEqual(done.housing!.state.reservations, {});
  for (const result of [
    reclaimBenchBoard(done, bench),
    returnBenchBoard(done, bench, one),
    startBenchRecovery(done, bench, one),
  ]) {
    assert.ok(result.error);
    assert.equal(result.game, done);
  }
  for (const [flow, end, length] of [
    [active, finished, preview.minutes!],
    [returning, done, back.minutes!],
  ] as const) {
    for (let minute = 0; minute <= length; minute++) {
      const checkpoint = minute ? advance(flow, minute) : flow;
      const loaded = roundTrip(checkpoint, origin);
      assert.deepEqual(
        advance(loaded, length - minute),
        end,
        `${flow.actors[0].task?.kind} at minute ${minute}`,
      );
    }
  }
});

test("a busy or inaccessible bench rejects demolition, and an active demolition prevents woodworking and removal", () => {
  const origin = equipped();
  const busy = order(origin, two, "work", "wood", { fixtureId: bench });
  for (const game of [
    busy,
    setHousingRoomAccess(origin, room, [two]),
    setHousingPassage(origin, "link", housingLinkId("bedroom", room), false),
  ]) {
    const before = JSON.stringify(game);
    assert.equal(inspectBenchRecovery(game, bench, one).ok, false);
    const rejected = startBenchRecovery(game, bench, one);
    assert.ok(rejected.error);
    assert.equal(rejected.game, game);
    assert.equal(JSON.stringify(game), before);
  }
  assert.ok(startBenchRecovery(origin, "bench-1", one).error);
  const active = ok(startBenchRecovery(origin, bench, one));
  assert.ok(
    inspectOrder(active, two, "work", "wood", { fixtureId: bench }).disabled,
  );
  assert.ok(startBenchRecovery(active, bench, two).error);
  for (const candidate of [
    editHouse(active.house, { type: "remove", id: bench }),
    editHouse(active.house, {
      type: "move",
      id: bench,
      room: "bedroom",
      cell: 6,
    }),
  ]) {
    const denied = applyHousingHouseEdit(active, candidate);
    assert.ok(denied.error);
    assert.equal(denied.game, active);
  }
  assert.equal(inspectOrder(active, two, "work", "wood").disabled, undefined);
});

test("cancellation on approach or during work always leaves the intact bench and no payout, including after a save", () => {
  const origin = freeWorker();
  const demolition = ok(startBenchRecovery(origin, bench, one));
  const onLink = advance(demolition, 1);
  assert.equal(onLink.housing!.state.actors[one].position.kind, "transit");
  const exiting = ok(cancelBenchRecovery(onLink, bench));
  assert.equal(
    exiting.housing!.state.actors[one].order?.phase,
    "exiting-after-cancel",
  );
  let idle = roundTrip(exiting, origin);
  while (idle.actors[0].task && idle.time < onLink.time + 6)
    idle = advance(idle, 1);
  assert.equal(idle.actors[0].task, null);
  const using = advance(
    demolition,
    inspectBenchRecovery(origin, bench, one).minutes! - 1,
  );
  const explicit = ok(cancelBenchRecovery(using, bench));
  const normal = order(using, one, "cancel");
  for (const checkpoint of [idle, explicit, normal]) {
    assert.equal(checkpoint.housing!.benchRecovery, undefined);
    assert.equal(checkpoint.housing!.state.items[boardId], undefined);
    assert.equal(checkpoint.wood, origin.wood);
    assert.ok(fixtures(checkpoint).some((f) => f.id === bench));
    const loaded = roundTrip(checkpoint, origin);
    assert.equal(inspectBenchRecovery(loaded, bench, one).ok, true);
  }
});

test("after demolition, cancellation of a carried board drops it on a real floor and another worker can finish the return", () => {
  const origin = freeWorker();
  const board = demolish(origin);
  const attempts = editHouse(board.house, {
    type: "build",
    kind: "mat",
    room,
    cell: atBench.cell,
  });
  const denied = applyHousingHouseEdit(board, attempts);
  assert.match(denied.error ?? "", /解体した板/);
  assert.equal(denied.game, board);
  const started = ok(returnBenchBoard(board, bench, one));
  let carried = started;
  for (let i = 0; i < 25; i++) {
    if (
      carried.housing!.state.items[boardId]?.position.kind === "carried" &&
      carried.housing!.state.actors[one].position.kind === "transit"
    )
      break;
    carried = advance(carried, 1);
  }
  assert.equal(carried.housing!.state.items[boardId].position.kind, "carried");
  assert.equal(carried.housing!.state.actors[one].position.kind, "transit");
  let dropped = roundTrip(ok(cancelBenchRecovery(carried, bench)), origin);
  for (let i = 0; i < 6 && dropped.actors[0].task; i++)
    dropped = advance(dropped, 1);
  assert.equal(dropped.actors[0].task, null);
  assert.equal(dropped.housing!.benchRecovery?.phase, "board");
  assert.equal(dropped.housing!.benchRecovery?.assignment, undefined);
  assert.equal(dropped.housing!.state.items[boardId].position.kind, "at");
  assert.equal(dropped.wood, origin.wood);
  // The receipt names the original workbench cell. Once the board has
  // physically left it, other furniture is allowed to occupy that old cell.
  assert.notDeepEqual(dropped.housing!.state.items[boardId].position, {
    kind: "at",
    point: atBench,
  });
  const reused = ok(applyHousingHouseEdit(dropped, attempts));
  roundTrip(reused, origin);
  assert.deepEqual(
    reused.housing!.state.items[boardId],
    dropped.housing!.state.items[boardId],
  );
  const another = order(roundTrip(dropped, origin), two, "cancel");
  const ready = order(another, one, "work", "care:hard");
  const back = inspectBenchReturn(ready, bench, two);
  assert.ok(back.ok, back.disabled);
  const done = advance(ok(returnBenchBoard(ready, bench, two)), back.minutes!);
  assert.equal(done.wood, origin.wood + 1);
  assert.equal(done.housing!.benchRecovery, undefined);
  roundTrip(done, origin);
});

test("a full supply leaves the returned board available for later settlement exactly once", () => {
  const origin = freeWorker();
  const board = demolish(origin);
  const preview = inspectBenchReturn(board, bench, one);
  const carrying = ok(returnBenchBoard(board, bench, one));
  const full = advance(carrying, preview.minutes! - 1);
  full.wood = 1_000_000_000;
  const waiting = advance(full, 1);
  assert.equal(waiting.wood, full.wood);
  assert.equal(waiting.housing!.benchRecovery?.phase, "board");
  assert.deepEqual(waiting.housing!.state.items[boardId].position, {
    kind: "at",
    point: supply,
  });
  assert.ok(reclaimBenchBoard(waiting, bench).error);
  const safe = roundTrip(waiting, origin);
  safe.wood--;
  const reclaimed = ok(reclaimBenchBoard(safe, bench));
  assert.equal(reclaimed.wood, 1_000_000_000);
  assert.equal(reclaimed.housing!.benchRecovery, undefined);
  assert.equal(reclaimed.housing!.state.items[boardId], undefined);
  assert.equal(reclaimBenchBoard(reclaimed, bench).game.wood, 1_000_000_000);
  roundTrip(reclaimed, origin);
});

test("recovery coexists with construction material and food, and forged records and item/task bindings are rejected", () => {
  const origin = ok(
    createFoodBundle(reserved(freeWorker()), {
      roomId: "bedroom",
      storageCell: 1,
    }),
  );
  const active = ok(startBenchRecovery(origin, bench, one));
  const board = demolish(origin);
  const returning = ok(returnBenchBoard(board, bench, one));
  assert.equal(Object.keys(board.housing!.state.items).length, 3);
  assert.ok(isGame(origin));
  for (const valid of [active, board, returning]) roundTrip(valid, origin);
  function rejects(original: Game, change: (state: Game) => void) {
    const forged = structuredClone(original);
    change(forged);
    assert.equal(isGame(forged), false, String(change));
    assert.throws(() =>
      importSlot(exportSlot({ id: "bad", name: "破損", game: forged, origin })),
    );
  }
  for (const patch of [
    { version: 2 },
    { phase: "returned" },
    { quantity: 2 },
    { fixtureId: "missing" },
    { roomId: "missing" },
    { cell: -1 },
  ])
    rejects(active, (g) => Object.assign(g.housing!.benchRecovery!, patch));
  rejects(active, (g) => {
    delete g.housing!.benchRecovery!.assignment;
  });
  rejects(active, (g) => {
    g.housing!.benchRecovery!.phase = "board";
  });
  rejects(active, (g) => {
    g.housing!.benchRecovery!.assignment!.actorId = two;
  });
  rejects(active, (g) => {
    g.housing!.benchRecovery!.assignment!.orderId = "order-999";
  });
  rejects(active, (g) => {
    g.actors[0].task!.reserved.wood = 1;
  });
  rejects(active, (g) => {
    g.actors[0].task!.remaining++;
  });
  rejects(board, (g) => {
    delete g.housing!.state.items[boardId];
  });
  rejects(board, (g) => {
    delete g.housing!.benchRecovery;
  });
  rejects(board, (g) => {
    const fakeId = "fixture-" + g.house.nextId;
    g.housing!.benchRecovery!.fixtureId = fakeId;
    const fakeItem = JSON.stringify(["bench-board", fakeId]);
    const items = g.housing!.state.items;
    items[fakeItem] = { ...items[boardId], id: fakeItem };
    delete items[boardId];
  });
  rejects(returning, (g) => {
    g.actors[0].task!.kind = "home-dismantle";
  });
  rejects(returning, (g) => {
    g.actors[0].task!.reserved.wood = 1;
  });
  rejects(active, (g) => {
    delete g.housing!.benchRecovery;
  });
  rejects(board, (g) => {
    Object.assign(g.actors[1].task!, {
      spatial: { kind: "use", orderId: "order-999", benchRecoveryId: bench },
    });
  });
  rejects(board, (g) => {
    g.housing!.state.items[boardId].position = {
      kind: "at",
      point: housingPoint("living", 3),
    };
  });
  rejects(board, (g) => {
    g.housing!.state.items[boardId].position = {
      kind: "carried",
      carrierId: two,
    };
  });
  rejects(board, (g) => {
    g.housing!.state.items[boardId].carryAllowedActorIds = [];
  });
  rejects(returning, (g) => {
    g.actors[0].task!.spatial!.benchRecoveryId = "fixture-99";
  });
  rejects(returning, (g) => {
    delete g.housing!.benchRecovery!.assignment;
  });
  rejects(returning, (g) => {
    const o = g.housing!.state.actors[one].order!;
    if (o.intent.kind === "carry") o.intent.destination = atBench;
  });
  const legacy = equipped();
  delete legacy.housing;
  assert.equal(roundTrip(legacy, legacy).housing, undefined);
});

test("closing a route pauses the existing order while revoked room rights release it without removing or crediting an object", () => {
  const origin = freeWorker();
  const initial = ok(startBenchRecovery(origin, bench, one));
  const link = housingLinkId("bedroom", room);
  const closed = advance(setHousingPassage(initial, "link", link, false), 15);
  assert.equal(closed.housing!.state.actors[one].order?.phase, "waiting");
  assert.equal(closed.actors[0].task!.remaining, 15);
  assert.equal(closed.wood, origin.wood);
  const reopened = setHousingPassage(
    roundTrip(closed, origin),
    "link",
    link,
    true,
  );
  let resumed = reopened;
  for (
    let i = 0;
    i < 35 && resumed.housing!.benchRecovery?.phase === "dismantling";
    i++
  )
    resumed = advance(resumed, 1);
  assert.equal(resumed.housing!.benchRecovery?.phase, "board");
  assert.deepEqual(resumed.housing!.state.items[boardId].position, {
    kind: "at",
    point: atBench,
  });

  const atWork = advance(
    initial,
    inspectBenchRecovery(origin, bench, one).minutes! - 3,
  );
  let revoked = setHousingRoomAccess(atWork, room, [two]);
  for (let i = 0; i < 5 && revoked.housing!.benchRecovery; i++)
    revoked = advance(revoked, 1);
  assert.equal(revoked.housing!.benchRecovery, undefined);
  assert.ok(fixtures(revoked).some((f) => f.id === bench));
  assert.equal(revoked.wood, origin.wood);
  roundTrip(revoked, origin);

  const board = demolish(origin);
  const sending = ok(returnBenchBoard(board, bench, one));
  const blocked = setHousingRoomAccess(sending, "living", [two]);
  let released = blocked;
  for (let i = 0; i < 5 && released.housing!.benchRecovery?.assignment; i++)
    released = advance(released, 1);
  assert.equal(released.housing!.benchRecovery?.assignment, undefined);
  assert.equal(released.wood, origin.wood);
  assert.equal(released.housing!.state.items[boardId].position.kind, "at");
  assert.equal(inspectBenchReturn(released, bench, one).ok, false);
  roundTrip(released, origin);
});

test("a room build and bench demolition completing in the same minute retain both results after import", () => {
  const origin = staged(equipped());
  const duration = inspectBenchRecovery(origin, bench, two).minutes!;
  assert.ok(duration > 15 && duration < 30);
  const buildingRoom = building(order(origin, two, "work", "care:hard"), one);
  const ready = order(advance(buildingRoom, 30 - duration), two, "cancel");
  const both = ok(startBenchRecovery(ready, bench, two));
  const last = advance(both, duration - 1);
  assert.equal(plan(last).workedMinutes, 29);
  assert.equal(last.actors[1].task!.remaining, 1);
  const completed = advance(roundTrip(last, origin), 1);
  assert.equal(plan(completed).status, "completed");
  assert.equal(plan(completed).material!.state, "consumed");
  assert.equal(completed.house.rooms.length, origin.house.rooms.length + 1);
  assert.equal(completed.housing!.benchRecovery?.phase, "board");
  assert.deepEqual(completed.housing!.state.items[boardId].position, {
    kind: "at",
    point: atBench,
  });
  assert.equal(completed.wood, origin.wood);
  roundTrip(completed, origin);
});

test("a neighboring bed booked after demolition begins retains its reserved use floor when removing the bench would shift it", () => {
  const oldRoom = base();
  const matSlot = housingSlotId("bedroom", "mat-1", 0);
  assert.equal(oldRoom.housing!.state.slots[matSlot].point.cell, 6);
  const origin = ok(
    applyHousingHouseEdit(
      oldRoom,
      editHouse(oldRoom.house, {
        type: "build",
        kind: "workbench",
        room: "bedroom",
        cell: 6,
      }),
    ),
  );
  assert.equal(origin.housing!.state.slots[matSlot].point.cell, 9);
  const duration = inspectBenchRecovery(origin, bench, one).minutes!;
  const dismantling = ok(startBenchRecovery(origin, bench, one));
  const sleeping = order(dismantling, two, "home-use", "mat-1");
  assert.equal(sleeping.actors[1].task!.station, matSlot);
  const last = advance(sleeping, duration - 1);
  assert.equal(last.actors[0].task!.remaining, 1);
  const after = advance(roundTrip(last, origin), 1);
  assert.equal(after.actors[0].task, null);
  assert.match(after.actors[0].reason, /木工台を残しました/);
  assert.ok(fixtures(after).some((f) => f.id === bench));
  assert.equal(after.housing!.state.slots[matSlot].point.cell, 9);
  assert.equal(after.actors[1].task!.station, matSlot);
  assert.equal(after.housing!.benchRecovery, undefined);
  assert.equal(after.housing!.state.items[boardId], undefined);
  assert.equal(after.wood, origin.wood);
  const free = order(roundTrip(after, origin), two, "cancel");
  const retry = ok(startBenchRecovery(free, bench, one));
  const done = advance(retry, inspectBenchRecovery(free, bench, one).minutes!);
  assert.equal(done.housing!.state.slots[matSlot].point.cell, 6);
  assert.equal(done.housing!.benchRecovery?.phase, "board");
});
