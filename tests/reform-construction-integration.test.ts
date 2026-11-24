import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  enableHousing,
  isGame,
  nextCompletionMinutes,
  order,
  setHousingRoomAccess,
} from "../src/reform/sim";
import { editHouse, isHouse } from "../src/reform/house";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import {
  inspectHousingGathering,
  startHousingGathering,
} from "../src/reform/housing/gathering";
import {
  housingStatus,
  nextGatheringCompletionMinutes,
} from "../src/reform/housing/presentation";
import {
  constructionStatus,
  constructionTaskMinutes,
} from "../src/reform/housing/constructionPresentation";
import {
  cancelRoomConstruction,
  inspectConstructionBuild,
  releaseConstructionWorker,
} from "../src/reform/housing/construction";
import {
  constructionSlotId,
  housingPoint,
} from "../src/reform/housing/topology";
import {
  base,
  building,
  bundle,
  hauling,
  itemId,
  ok,
  one,
  two,
  plan,
  planId,
  reserved,
  staged,
} from "./helpers/construction";
const third = "resident-three";
const request = {
  kind: "talk" as const,
  actorIds: [two, third],
  roomId: "living",
  fixtureId: "bench-1",
};
const slotId = constructionSlotId(planId);
test("adding any new room after creation directs both runtime and older games through construction", () => {
  for (const legacy of [false, true]) {
    const g = base();
    if (legacy) delete g.housing;
    const setup = editHouse(g.house, {
      type: "room",
      name: "応接室",
      neighbor: "living",
    });
    assert.ok(isHouse(setup));
    const result = applyHousingHouseEdit(g, setup);
    assert.equal(result.game, g);
    assert.match(result.error!, legacy ? /住居の移動/ : /増築|工事/);
  }
});

test("the first shared seating upgrade, locating an old resident and room permission rebuilds retain the construction reservation", () => {
  const old = base("legacy", one, [third]);
  delete old.housing;
  const seeded = enableHousing(
    order(old, third, "work", "care:hard"),
    "legacy",
  );
  const work = building(staged(seeded));
  const idle = order(work, third, "cancel");
  assert.ok(Object.hasOwn(idle.housing!.unlocated, third));
  assert.deepEqual(
    idle.housing!.state.slots[slotId].point,
    housingPoint("bedroom", 2),
  );
  const before = JSON.stringify(idle);
  const inspection = inspectHousingGathering(idle, request);
  assert.equal(inspection.ok, true, inspection.disabled);
  assert.equal(JSON.stringify(idle), before);
  const group = startHousingGathering(idle, request);
  assert.equal(group.housing!.layoutVersion, 2);
  assert.ok(Object.hasOwn(group.housing!.state.actors, third));
  const permitted = setHousingRoomAccess(group, "bedroom", [one]);
  assert.deepEqual(permitted.housing!.state.slots[slotId].allowedActorIds, [
    one,
  ]);
  assert.deepEqual(bundle(permitted).carryAllowedActorIds, [one]);
  for (const g of [group, permitted, advance(permitted, 3)]) {
    assert.equal(plan(g).assignment?.actorId, one);
    assert.deepEqual(bundle(g).position, {
      kind: "at",
      point: plan(g).staging,
    });
    assert.ok(
      Object.values(g.housing!.state.reservations).some(
        (r) => r.kind === "slot" && r.targetId === slotId && r.actorId === one,
      ),
    );
    assert.ok(isGame(g));
  }
});

test("gathering and construction forecasts remain pure while a nonmember physically carries the bundle", () => {
  let g = base("new", one, [third]);
  const move = order(
    g,
    two,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  g = advance(
    order(order(move, one, "work", "care:hard"), third, "work", "care:hard"),
    3,
  );
  g = order(order(g, one, "cancel"), third, "cancel");
  g = hauling(reserved(g));
  g = startHousingGathering(g, request);
  g = advance(g, 2);
  assert.deepEqual(bundle(g).position, { kind: "carried", carrierId: one });
  const before = JSON.stringify(g);
  const gathering = nextGatheringCompletionMinutes(g);
  assert.ok(gathering && gathering > 4);
  assert.equal(constructionTaskMinutes(g, one), 4);
  assert.equal(nextCompletionMinutes(g), 4);
  assert.equal(JSON.stringify(g), before);
  const released = advance(g, gathering!);
  assert.equal(released.actors[1].task?.kind === "home-gather", false);
  assert.ok(isGame(released));
});

test("the construction forecast counts approach and work, and a denied or injured worker cannot forecast normal completion", () => {
  const g = staged();
  const raw = JSON.stringify(g);
  assert.deepEqual(inspectConstructionBuild(g, planId, two), {
    ok: true,
    minutes: 35,
  });
  assert.equal(JSON.stringify(g), raw);
  const working = building(order(g, one, "work", "care:hard"), two);
  const before = JSON.stringify(working);
  assert.equal(housingStatus(working, two).minutes, 35);
  assert.equal(constructionTaskMinutes(working, two), 35);
  assert.equal(nextCompletionMinutes(working), 35);
  assert.equal(JSON.stringify(working), before);
  assert.match(constructionStatus(working, planId).phase, /施工/);
  assert.equal(plan(advance(working, 35)).status, "completed");
  const hurt = structuredClone(working);
  hurt.actors[1].injury = 70;
  assert.equal(housingStatus(hurt, two).minutes, null);
  assert.equal(constructionTaskMinutes(hurt, two), null);
});

test("replacing a build by an indoor move or regional departure keeps exactly the partial work and the staged material", () => {
  const seven = advance(building(), 7);
  for (const [kind, target] of [
    ["home-move", JSON.stringify({ roomId: "yard", cell: 1 })],
    ["travel", "mill"],
  ]) {
    const replaced = order(seven, one, kind, target);
    assert.equal(replaced.actors[0].task?.kind, kind);
    assert.equal(plan(replaced).assignment, undefined);
    assert.equal(plan(replaced).workedMinutes, 7);
    assert.deepEqual(bundle(replaced).position, {
      kind: "at",
      point: plan(replaced).staging,
    });
    assert.equal(replaced.wood, seven.wood);
    assert.ok(isGame(replaced));
    assert.equal(
      Object.values(replaced.housing!.state.reservations).some(
        (r) => r.targetId === slotId,
      ),
      false,
    );
  }
});

test("cancelling a builder approaching in transit keeps the use slot until safe exit; recovery frees the old staging floor", () => {
  const inTransit = advance(building(staged(), two), 1);
  const cancelling = ok(cancelRoomConstruction(inTransit, planId));
  assert.ok(isGame(cancelling));
  assert.ok(cancelling.housing!.state.slots[slotId]);
  const stopped = advance(cancelling, 2);
  assert.ok(isGame(stopped));
  assert.equal(stopped.housing!.state.slots[slotId], undefined);
  assert.deepEqual(bundle(stopped).position, {
    kind: "at",
    point: plan(stopped).staging,
  });
  const mover = order(stopped, one, "cancel");
  const returned = advance(hauling(mover, one, "return"), 6);
  assert.equal(plan(returned).material?.state, "returned");
  assert.equal(returned.housing!.state.items[itemId], undefined);
  const edited = editHouse(returned.house, {
    type: "tile",
    tile: "wall",
    room: "bedroom",
    cell: 2,
  });
  assert.equal(applyHousingHouseEdit(returned, edited).error, undefined);
});

test("safe-exit descriptions distinguish walking to pick up wood, carrying it and building without lifting the staged bundle", () => {
  let remote = base();
  remote.actors[0].room = "bedroom";
  remote.housing!.state.actors[one].position = {
    kind: "at",
    point: housingPoint("bedroom", 0),
  };
  const beforePickup = advance(hauling(reserved(remote)), 1);
  const carrying = advance(hauling(), 2);
  const builder = advance(building(staged(), two), 1);
  for (const [state, id, required] of [
    [beforePickup, one, /拾|元の床/],
    [carrying, one, /下ろ/],
    [builder, two, /施工/],
  ] as const) {
    const stopped = order(state, id, "cancel");
    const released = ok(releaseConstructionWorker(state, planId));
    for (const message of [
      stopped.actors.find((a) => a.person.id === id)!.reason,
      housingStatus(stopped, id).detail,
      constructionStatus(released, planId).detail,
    ]) {
      assert.match(message, required);
    }
  }
});

test("whole-project cancellation en route to the first pickup allows the source bundle to return after safe exit", () => {
  const remote = base();
  remote.actors[0].room = "bedroom";
  remote.housing!.state.actors[one].position = {
    kind: "at",
    point: housingPoint("bedroom", 0),
  };
  const beforePickup = advance(hauling(reserved(remote)), 1);
  for (const stock of [0, 1_000_000_000]) {
    const cancelled = ok(
      cancelRoomConstruction({ ...beforePickup, wood: stock }, planId),
    );
    assert.deepEqual(bundle(cancelled).position, {
      kind: "at",
      point: housingPoint("living", 0),
    });
    for (const message of [
      cancelled.actors[0].reason,
      housingStatus(cancelled, one).detail,
      constructionStatus(cancelled, planId).detail,
    ]) {
      assert.match(message, /木材はまだ拾っていません/);
      assert.doesNotMatch(message, /元の床に残ります/);
    }
    const settled = advance(cancelled, 2);
    assert.equal(plan(settled).assignment, undefined);
    assert.equal(settled.wood, stock === 0 ? 6 : stock);
    assert.equal(
      plan(settled).material?.state,
      stock === 0 ? "returned" : "present",
    );
    assert.equal(!!bundle(settled), stock !== 0);
    assert.ok(isGame(settled));
  }
});
