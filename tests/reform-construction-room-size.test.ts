import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConstructionPanel } from "../src/reform/ConstructionPanel";
import { editHouse } from "../src/reform/house";
import {
  cancelRoomConstruction,
  createRoomConstruction,
  inspectConstructionHaul,
  reviseRoomConstruction,
  reclaimConstructionMaterial,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import type { ConstructionRequest } from "../src/reform/housing/constructionTypes";
import { createRoomInsulation } from "../src/reform/housing/insulation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import {
  constructionSlotId,
  housingPoint,
} from "../src/reform/housing/topology";
import { importSlot, exportSlot } from "../src/reform/library";
import {
  advance,
  inspectOrder,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import {
  base,
  building,
  bundle,
  hauling,
  ok,
  one,
  plan,
  planId,
  request,
  two,
} from "./helpers/construction";

function morning(wood = 14) {
  const game = base();
  game.wood = wood;
  return game;
}
function proposed(game: Game, height?: 3 | 4) {
  return ok(
    createRoomConstruction(
      game,
      height === undefined ? request : { ...request, height },
    ),
  );
}
function reload(game: Game, origin: Game) {
  const loaded = importSlot(
    exportSlot({ id: "extension", name: "一室の計画", game, origin }),
  );
  assert.deepEqual(loaded.game, structuredClone(game));
  assert.deepEqual(loaded.origin, structuredClone(origin));
  return loaded.game;
}
function phases(origin: Game, height?: 3 | 4) {
  const pending = proposed(origin, height);
  const reserved = ok(reserveConstructionMaterial(pending, planId));
  const assigned = order(hauling(reserved), two, "work", "care:hard");
  const carrying = advance(assigned, 2);
  const staged = advance(carrying, 4);
  const active = building(staged);
  const last = advance(active, 29);
  const done = advance(last, 1);
  return { pending, reserved, assigned, carrying, staged, active, last, done };
}

test("planning either 4×3 or 4×4 is free and keeps an older plan's exact representation", () => {
  const origin = morning(9);
  const ordinary = proposed(origin);
  assert.deepEqual(proposed(origin, 3), ordinary);
  assert.equal(Object.hasOwn(plan(ordinary), "height"), false);
  assert.equal(plan(ordinary).requiredWood, 6);
  const larger = proposed(origin, 4);
  assert.equal(plan(larger).height, 4);
  assert.equal(plan(larger).requiredWood, 10);
  for (const state of [ordinary, larger]) {
    assert.equal(plan(state).workMinutes, 30);
    assert.equal(state.time, origin.time);
    assert.equal(state.wood, 9);
    assert.deepEqual(state.house, origin.house);
    assert.deepEqual(state.housing!.state.items, {});
    reload(state, origin);
  }
  const denied = reserveConstructionMaterial(larger, planId);
  assert.match(denied.error ?? "", /木材10/);
  assert.equal(denied.game, larger);
  assert.equal(plan(larger).material, undefined);
  assert.equal(ok(reserveConstructionMaterial(ordinary, planId)).wood, 3);
});

test("4×4 and 4×3 followed by expansion use the same wood, geometry, house ID and clock on the same staging floor", () => {
  const origin = morning();
  const standard = phases(origin);
  const large = phases(origin, 4);
  assert.equal(large.reserved.wood, origin.wood - 10);
  assert.deepEqual(plan(large.reserved).material, {
    itemId: "construction-material-1",
    quantity: 10,
    state: "present",
  });
  assert.equal(plan(large.last).workedMinutes, 29);
  assert.deepEqual(large.last.house, origin.house);
  assert.equal(plan(large.done).workedMinutes, 30);
  assert.equal(plan(large.done).completedAt, origin.time + 36);
  assert.equal(plan(large.done).material?.state, "consumed");
  assert.equal(bundle(large.done), undefined);
  for (const checkpoint of Object.values(large)) {
    const copy = reload(checkpoint, origin);
    assert.deepEqual(advance(copy, 1), advance(checkpoint, 1));
  }
  const roomId = plan(large.done).roomId!;
  assert.equal(plan(standard.done).roomId, roomId);
  const standardRoom = standard.done.house.rooms.find((r) => r.id === roomId)!;
  assert.equal(standardRoom.height, 3);
  const enlarged = ok(
    applyHousingHouseEdit(
      standard.done,
      editHouse(standard.done.house, { type: "expand", room: roomId }),
    ),
  );
  assert.equal(enlarged.time, large.done.time);
  assert.equal(enlarged.wood, large.done.wood);
  assert.equal(enlarged.house.nextId, origin.house.nextId + 1);
  assert.deepEqual(enlarged.house, large.done.house);
  assert.equal(large.done.house.rooms.find((r) => r.id === roomId)!.height, 4);
  assert.deepEqual(
    enlarged.housing!.state.domains,
    large.done.housing!.state.domains,
  );
  assert.deepEqual(
    enlarged.housing!.state.connections,
    large.done.housing!.state.connections,
  );
  assert.deepEqual(
    enlarged.actors.map((actor) => actor.metrics),
    large.done.actors.map((actor) => actor.metrics),
  );
  const toLastCell = JSON.stringify({ roomId, cell: 15 });
  assert.equal(
    inspectOrder(large.done, one, "home-move", toLastCell).disabled,
    undefined,
  );
  assert.ok(inspectOrder(standard.done, one, "home-move", toLastCell).disabled);
  const evenLarger = ok(
    applyHousingHouseEdit(
      large.done,
      editHouse(large.done.house, { type: "expand", room: roomId }),
    ),
  );
  assert.equal(evenLarger.wood, large.done.wood - 4);
  assert.equal(evenLarger.house.rooms.find((r) => r.id === roomId)!.height, 5);
  reload(evenLarger, origin);
});

test("cancelling a 10-wood bundle requires its physical return and refunds the actual quantity once", () => {
  const origin = morning(10);
  const { staged } = phases(origin, 4);
  const stopped = ok(cancelRoomConstruction(staged, planId));
  assert.equal(stopped.wood, 0);
  assert.deepEqual(bundle(stopped).position, {
    kind: "at",
    point: plan(stopped).staging,
  });
  assert.ok(reclaimConstructionMaterial(stopped, planId).error);
  assert.ok(createRoomConstruction(stopped, request).error);
  const returning = hauling(reload(stopped, origin), one, "return");
  const last = advance(returning, 5);
  assert.equal(last.wood, 0);
  const settled = advance(reload(last, origin), 1);
  assert.equal(settled.wood, 10);
  assert.equal(bundle(settled), undefined);
  assert.equal(plan(settled).material?.state, "returned");
  assert.equal(reclaimConstructionMaterial(settled, planId).game.wood, 10);
  assert.equal(cancelRoomConstruction(settled, planId).game.wood, 10);
  assert.equal(
    createRoomConstruction(reload(settled, origin), request).planId,
    "construction-2",
  );
  const withFullStock = { ...last, wood: 999_999_996 };
  const cannotRefund = advance(withFullStock, 1);
  assert.equal(cannotRefund.wood, withFullStock.wood);
  assert.equal(plan(cannotRefund).material?.state, "present");
  assert.ok(reclaimConstructionMaterial(cannotRefund, planId).error);
  const withSpace = { ...reload(cannotRefund, origin), wood: 999_999_990 };
  const reclaimed = ok(reclaimConstructionMaterial(withSpace, planId));
  assert.equal(reclaimed.wood, 1_000_000_000);
  assert.equal(plan(reclaimed).material?.state, "returned");
  reload(reclaimed, origin);
});

test("reject unsupported dimensions and forged quantities or completion receipts", () => {
  const origin = morning();
  for (const height of [2, 3.5, 5, "4", null]) {
    const invalid = { ...request, height } as ConstructionRequest;
    const result = createRoomConstruction(origin, invalid);
    assert.ok(result.error, JSON.stringify(invalid));
    assert.equal(result.game, origin);
  }
  const invalidWidth = { ...request, width: 5 };
  const invalidInsulation = { roomId: "bedroom", stagingCell: 2, height: 4 };
  for (const rejected of [
    createRoomConstruction(origin, invalidWidth),
    createRoomInsulation(origin, invalidInsulation),
  ]) {
    assert.match(rejected.error ?? "", /広さ/);
    assert.equal(rejected.game, origin);
  }
  const { reserved, done } = phases(origin, 4);
  for (const change of [
    { height: 5 },
    { height: 3 },
    { width: 5 },
    { requiredWood: 6 },
    { workMinutes: 29 },
    { material: { ...plan(reserved).material!, quantity: 6 } },
    { kind: "insulation" },
  ]) {
    const bad = structuredClone(reserved);
    Object.assign(plan(bad), change);
    assert.equal(isGame(bad), false, JSON.stringify(change));
  }
  const noHeight = structuredClone(done);
  delete plan(noHeight).height;
  assert.equal(isGame(noHeight), false);
  const ordinary = phases(origin).done;
  Object.assign(plan(ordinary), { height: 4, requiredWood: 10 });
  plan(ordinary).material!.quantity = 10;
  assert.equal(
    isGame(ordinary),
    false,
    "the completed room is only three rows tall",
  );
  const insulated = ok(
    createRoomInsulation(origin, { roomId: "bedroom", stagingCell: 2 }),
  );
  Object.assign(plan(insulated), { height: 4 });
  assert.equal(isGame(insulated), false, "insulation does not add floor area");
});

test("the construction screen offers both sizes and displays the chosen 4×4 plan before and after completion", () => {
  const render = (game: Game) => {
    const before = JSON.stringify(game);
    const html = renderToStaticMarkup(
      createElement(ConstructionPanel, {
        game,
        onGame: () => assert.fail("render issued an order"),
      }),
    );
    assert.equal(JSON.stringify(game), before);
    return html;
  };
  const origin = morning();
  const html = render(origin);
  assert.match(html, /増築する部屋の広さ/);
  assert.match(html, /<option value="3"[^>]*>[^<]*4 × 3/);
  assert.match(html, /<option value="4"[^>]*>[^<]*4 × 4/);
  const { pending, done } = phases(origin, 4);
  assert.match(
    render(pending),
    /計画内容　4 × 4マス（16マス）・木材10・施工30分/,
  );
  assert.match(
    render(done),
    /計画時の仕様　4 × 4マス（16マス）・木材10・施工30分/,
  );
});

test("a free revision updates only the existing unpaid plan and staging slot, even with past plans and a busy resident", () => {
  const origin = morning(9);
  const cancelled = ok(cancelRoomConstruction(proposed(origin), planId));
  const next = createRoomConstruction(cancelled, { ...request, height: 4 });
  const id = next.planId!;
  assert.notEqual(id, planId);
  const waiting = advance(order(ok(next), two, "work", "care:hard"), 1);
  const before = structuredClone(waiting);
  const earlier = before.housing!.construction!.plans[id];
  const changed = reviseRoomConstruction(waiting, id, {
    name: "  道具部屋  ",
    neighborId: "yard",
    stagingCell: 2,
  });
  const result = ok(changed);
  const after = result.housing!.construction!.plans[id];
  assert.equal(after.id, earlier.id);
  assert.equal(after.createdAt, earlier.createdAt);
  assert.equal(after.name, "道具部屋");
  assert.equal(after.neighborId, "yard");
  assert.equal(Object.hasOwn(after, "height"), false);
  assert.equal(after.requiredWood, 6);
  assert.equal(after.workedMinutes, 0);
  assert.equal(after.workMinutes, 30);
  assert.deepEqual(after.source, earlier.source);
  assert.deepEqual(after.staging, housingPoint("yard", 2));
  assert.deepEqual(
    result.housing!.state.slots[constructionSlotId(id)].point,
    after.staging,
  );
  assert.deepEqual(
    result.housing!.construction!.plans[planId],
    before.housing!.construction!.plans[planId],
  );
  assert.equal(
    result.housing!.construction!.nextId,
    before.housing!.construction!.nextId,
  );
  for (const key of [
    "house",
    "actors",
    "time",
    "rng",
    "ingredients",
    "coins",
    "food",
    "wood",
  ] as const)
    assert.deepEqual(result[key], before[key]);
  assert.deepEqual(result.housing!.state.items, before.housing!.state.items);
  assert.deepEqual(
    result.housing!.state.reservations,
    before.housing!.state.reservations,
  );
  assert.deepEqual(waiting, before);
  reload(result, origin);
  const wall = (room: string) =>
    editHouse(result.house, { type: "tile", tile: "wall", room, cell: 2 });
  assert.ok(applyHousingHouseEdit(waiting, wall("bedroom")).error);
  assert.equal(applyHousingHouseEdit(result, wall("bedroom")).error, undefined);
  assert.ok(applyHousingHouseEdit(result, wall("yard")).error);
  assert.equal(ok(reserveConstructionMaterial(result, id)).wood, 3);
});

test("a revised standard plan delivers the new wide room at the revised location and price after import", () => {
  const origin = morning();
  const normal = proposed(origin);
  const replacement = {
    name: "仕分け室",
    height: 4,
    neighborId: "yard",
    stagingCell: 2,
  } as const;
  const revised = reload(
    ok(reviseRoomConstruction(normal, planId, replacement)),
    origin,
  );
  assert.equal(plan(revised).requiredWood, 10);
  const reserved = ok(reserveConstructionMaterial(revised, planId));
  assert.equal(reserved.wood, origin.wood - 10);
  assert.equal(plan(reserved).material?.quantity, 10);
  const deliveryMinutes = inspectConstructionHaul(
    reserved,
    planId,
    one,
    "deliver",
  ).minutes!;
  const delivered = advance(
    order(hauling(reserved), two, "work", "care:hard"),
    deliveryMinutes,
  );
  assert.deepEqual(bundle(delivered).position, {
    kind: "at",
    point: housingPoint("yard", 2),
  });
  const done = advance(building(delivered), 30);
  const finished = plan(done);
  assert.equal(finished.status, "completed");
  assert.equal(finished.height, 4);
  assert.equal(finished.material?.state, "consumed");
  assert.equal(done.wood, origin.wood - 10);
  assert.equal(done.time, origin.time + deliveryMinutes + 30);
  const room = done.house.rooms.find((r) => r.id === finished.roomId)!;
  assert.equal(room.name, replacement.name);
  assert.equal(room.height, 4);
  assert.ok(
    done.house.links.some(
      (pair) => pair.includes(room.id) && pair.includes("yard"),
    ),
  );
  assert.equal(done.house.rooms.length, origin.house.rooms.length + 1);
  reload(done, origin);
});

test("bad edits and revisions after material reservation, work, cancellation, completion or insulation leave every receipt intact", () => {
  const origin = morning();
  const states = phases(origin, 4);
  const cancelled = ok(cancelRoomConstruction(states.pending, planId));
  const needsReturn = ok(cancelRoomConstruction(states.staged, planId));
  const returning = hauling(needsReturn, one, "return");
  const insulation = ok(
    createRoomInsulation(origin, { roomId: "bedroom", stagingCell: 2 }),
  );
  const badRequests = [
    { ...request, height: 5 },
    { ...request, width: 5 },
    { ...request, name: " " },
    { ...request, name: "室".repeat(25) },
    { ...request, neighborId: "missing" },
    { ...request, neighborId: "living", stagingCell: 0 },
    { ...request, stagingCell: 10 },
  ];
  function rejects(game: Game, id: string, edit: ConstructionRequest) {
    const before = JSON.stringify(game);
    const result = reviseRoomConstruction(game, id, edit);
    assert.ok(result.error);
    assert.equal(result.game, game);
    assert.equal(JSON.stringify(game), before);
  }
  for (const invalid of badRequests)
    rejects(states.pending, planId, invalid as ConstructionRequest);
  rejects(states.pending, "missing", request);
  for (const game of [
    origin,
    states.reserved,
    states.assigned,
    states.carrying,
    states.staged,
    states.active,
    states.last,
    states.done,
    cancelled,
    needsReturn,
    returning,
    insulation,
  ])
    rejects(game, planId, request);
});

test("the construction screen offers revision only for a live unpaid room addition", () => {
  const origin = morning();
  const states = phases(origin);
  const render = (game: Game) =>
    renderToStaticMarkup(
      createElement(ConstructionPanel, {
        game,
        onGame: () => assert.fail("render issued an order"),
      }),
    );
  assert.match(render(states.pending), /<button[^>]*>計画を見直す<\/button>/);
  for (const state of [
    origin,
    states.reserved,
    states.active,
    states.done,
    ok(cancelRoomConstruction(states.pending, planId)),
    ok(createRoomInsulation(origin, { roomId: "bedroom", stagingCell: 2 })),
  ])
    assert.doesNotMatch(render(state), /<button[^>]*>計画を見直す<\/button>/);
});
