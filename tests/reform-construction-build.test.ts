import assert from "node:assert/strict";
import test from "node:test";
import { editHouse } from "../src/reform/house";
import { constructionStatus } from "../src/reform/housing/constructionPresentation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import * as commands from "../src/reform/housing/construction";
import {
  advance,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { housingLinkId } from "../src/reform/housing/topology";
import {
  base,
  staged,
  bundle,
  hauling,
  one,
  two,
  plan,
  planId,
  planned,
  reserved,
  ok,
} from "./helpers/construction";

function build(g: Game, id = two) {
  return ok(commands.assignConstructionBuild(g, planId, id));
}
const link = housingLinkId("living", "bedroom");

test("a builder walks to the bundle, waits behind a closed passage and contributes only actual minutes of use", () => {
  const initial = staged();
  const working = build(order(initial, one, "work", "care"));
  const bound = plan(working).assignment!;
  assert.deepEqual(bound, {
    kind: "build",
    actorId: two,
    orderId: working.actors[1].task!.spatial!.orderId,
    startedWorkMinutes: 0,
  });
  assert.deepEqual(working.actors[1].task!.reserved, {});
  assert.equal(working.actors[1].task!.kind, "home-build");
  const held = advance(setHousingPassage(working, "link", link, false), 3);
  assert.equal(held.housing!.state.actors[two].order?.phase, "waiting");
  assert.equal(plan(held).workedMinutes, 0);
  const arrived = advance(setHousingPassage(held, "link", link, true), 5);
  assert.equal(arrived.housing!.state.actors[two].order?.phase, "use");
  assert.equal(plan(arrived).workedMinutes, 0);
  assert.equal(plan(advance(arrived, 1)).workedMinutes, 1);
  const seven = advance(arrived, 7);
  assert.equal(plan(seven).workedMinutes, 7);
  assert.equal(seven.actors[1].task!.total, 30);
  assert.equal(seven.actors[1].task!.remaining, 23);
  assert.equal(seven.housing!.state.actors[two].order?.useRemaining, 23);
  const stopped = ok(commands.releaseConstructionWorker(seven, planId));
  assert.deepEqual(bundle(stopped).position, {
    kind: "at",
    point: plan(stopped).staging,
  });
  assert.equal(plan(stopped).workedMinutes, 7);
  assert.equal(stopped.actors[1].task, null);
  const resumed = build(order(stopped, one, "cancel"), one);
  assert.equal(plan(resumed).assignment?.startedWorkMinutes, 7);
  assert.equal(resumed.actors[0].task!.total, 23);
  const eight = advance(resumed, 1);
  assert.equal(plan(eight).workedMinutes, 8);
  assert.equal(eight.actors[0].task!.remaining, 22);
  assert.equal(eight.housing!.state.actors[one].order!.useRemaining, 22);
});

test("material still in transit, missing, or on the wrong floor cannot start work; unsuccessful build leaves all inputs intact", () => {
  for (const g of [
    planned(),
    reserved(),
    hauling(),
    advance(hauling(), 2),
    order(staged(), two, "wait"),
    setHousingRoomAccess(staged(), "bedroom", [one]),
  ]) {
    const before = JSON.stringify(g);
    assert.equal(commands.inspectConstructionBuild(g, planId, two).ok, false);
    const result = commands.assignConstructionBuild(g, planId, two);
    assert.ok(result.error);
    assert.equal(result.game, g);
    assert.equal(JSON.stringify(g), before);
  }
});

test("losing work authority even on the room floor, injury or danger releases the builder and preserves the work", () => {
  const seven = advance(build(staged(), one), 7);
  const injury = structuredClone(seven),
    danger = structuredClone(seven);
  injury.actors[0].injury = 70;
  danger.actors[0].danger = true;
  for (const invalid of [injury, danger]) {
    const stopped = advance(invalid, 1);
    assert.equal(stopped.actors[0].task, null);
    assert.equal(plan(stopped).assignment, undefined);
    assert.equal(plan(stopped).workedMinutes, 7);
    assert.ok(isGame(stopped));
  }
  const denied = setHousingRoomAccess(seven, "bedroom", [two]);
  const permitted = setHousingRoomAccess(denied, "bedroom", null);
  for (const state of [denied, permitted]) {
    assert.equal(state.time, seven.time);
    assert.equal(state.rng, seven.rng);
    assert.equal(state.actors[0].task, null);
    assert.equal(plan(state).assignment, undefined);
    assert.equal(plan(state).workedMinutes, 7);
    assert.ok(isGame(state));
  }
  assert.equal(plan(advance(permitted, 1)).workedMinutes, 7);
  assert.equal(plan(advance(build(permitted, one), 1)).workedMinutes, 8);
  const transit = advance(build(staged()), 1);
  const closed = advance(setHousingRoomAccess(transit, "bedroom", []), 1);
  assert.equal(
    closed.housing!.state.actors[two].order!.phase,
    "exiting-after-cancel",
  );
  const out = advance(closed, 1);
  assert.equal(plan(out).workedMinutes, 0);
  assert.equal(out.actors[1].task, null);
  assert.ok(commands.assignConstructionBuild(out, planId, two).error);
  const restored = setHousingRoomAccess(out, "bedroom", [two]);
  assert.ok(plan(build(restored)).assignment);
});

test("the thirtieth use minute adds one empty linked room to today's house and consumes exactly the staged bundle", () => {
  const start = base();
  start.wood = 10;
  // Four separate travel supplies pay for a shelf. Only the six remaining in stock enter the construction bundle.
  const packed = advance(
    order(order(start, one, "work", "care"), two, "pack", "wood"),
    3,
  );
  const initial = staged(order(packed, one, "cancel"));
  assert.equal(initial.wood, 0);
  const working = advance(build(order(initial, two, "unpack", "wood"), one), 3);
  assert.equal(working.wood, 4);
  const withFixture = ok(
    applyHousingHouseEdit(
      working,
      editHouse(working.house, {
        type: "build",
        kind: "shelf",
        room: "yard",
        cell: 8,
      }),
    ),
  );
  const relocated = ok(
    applyHousingHouseEdit(
      withFixture,
      editHouse(withFixture.house, {
        type: "move",
        id: "window-1",
        room: "yard",
        cell: 9,
      }),
    ),
  );
  assert.equal(relocated.wood, 0);
  const before = advance(order(relocated, two, "work", "care:hard"), 26);
  // A second spatial order settles on the same tick as the builder.
  const other = order(
    before,
    two,
    "home-move",
    JSON.stringify({ roomId: "living", cell: 0 }),
  );
  const end = advance(other, 1);
  assert.equal(end.actors[1].task, null);
  assert.equal(plan(end).status, "completed");
  assert.match(constructionStatus(end, planId).detail, /作業室/);
  assert.match(constructionStatus(end, planId).material, /使用|消費/);
  assert.deepEqual(end.house.rooms.slice(0, -1), relocated.house.rooms);
  assert.deepEqual(end.house.rooms.at(-1), {
    id: "room-2",
    name: "作業室",
    width: 4,
    height: 3,
    walls: [],
    doors: [],
    fixtures: [],
  });
  assert.deepEqual(end.house.links, [
    ...relocated.house.links,
    ["bedroom", "room-2"],
  ]);
  assert.equal(plan(end).roomId, "room-2");
  assert.equal(plan(end).completedAt, end.time);
  assert.equal(plan(end).workedMinutes, 30);
  assert.equal(plan(end).assignment, undefined);
  assert.equal(plan(end).material?.state, "consumed");
  assert.equal(bundle(end), undefined);
  assert.equal(end.wood, 0);
  assert.equal(end.actors[0].task, null);
  assert.deepEqual(end.housing!.state.reservations, {});
  assert.equal(
    end.log.filter((line) => line.includes("作業室") && line.includes("完成"))
      .length,
    1,
  );
  for (const state of [end, JSON.parse(JSON.stringify(end))]) {
    assert.ok(isGame(state));
    assert.equal(commands.completeRoomConstruction(state, planId).game, state);
  }
  const move = order(
    end,
    one,
    "home-move",
    JSON.stringify({ roomId: "room-2", cell: 0 }),
  );
  const arrived = advance(move, 5);
  assert.equal(arrived.actors[0].room, "room-2");
  const onOldStaging = editHouse(arrived.house, {
    type: "move",
    id: "mat-1",
    room: "bedroom",
    cell: 2,
  });
  assert.equal(applyHousingHouseEdit(arrived, onOldStaging).error, undefined);
  const furnished = ok(
    applyHousingHouseEdit(
      move,
      editHouse(move.house, {
        type: "move",
        id: "window-1",
        room: "room-2",
        cell: 1,
      }),
    ),
  );
  const use = order(advance(furnished, 5), one, "need", "fun");
  assert.equal(use.actors[0].task!.room, "room-2");
  assert.equal(use.actors[0].task!.spatial?.kind, "use");
});

test("an exhausted room ID leaves finished labor and wood at the worksite; retrying a valid fixture needs no more time or stock", () => {
  const active = build(staged(), one);
  active.house.nextId = Number.MAX_SAFE_INTEGER;
  assert.ok(isGame(active));
  const blocked = advance(active, 30);
  assert.equal(plan(blocked).workedMinutes, 30);
  assert.equal(blocked.actors[0].task, null);
  assert.equal(plan(blocked).assignment, undefined);
  assert.equal(plan(blocked).status, "planned");
  assert.equal(plan(blocked).material?.state, "present");
  assert.ok(isGame(JSON.parse(JSON.stringify(blocked))));
  assert.match(constructionStatus(blocked, planId).phase, /完成反映待ち/);
  assert.match(constructionStatus(blocked, planId).detail, /番号/);
  assert.match(
    commands.inspectConstructionCompletion(blocked, planId).disabled!,
    /番号/,
  );
  assert.equal(
    commands.completeRoomConstruction(blocked, planId).game,
    blocked,
  );
  // This is a separate valid controlled candidate, not a gameplay path for changing the sequence.
  const available = structuredClone(blocked);
  available.house.nextId = 61;
  assert.ok(isGame(available));
  assert.equal(
    commands.inspectConstructionCompletion(available, planId).ok,
    true,
  );
  const done = ok(commands.completeRoomConstruction(available, planId));
  assert.equal(done.time, available.time);
  assert.equal(done.wood, 0);
  assert.equal(plan(done).roomId, "room-61");
  assert.equal(plan(done).material?.state, "consumed");
  assert.equal(commands.completeRoomConstruction(done, planId).game, done);
});
