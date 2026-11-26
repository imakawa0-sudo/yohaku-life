import { rebuildHousingGeometry } from "../src/reform/housing/bridge";
import { inspectHousingGathering } from "../src/reform/housing/gathering";
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  isGame,
  inspectOrder,
  nextCompletionMinutes,
  order,
  setHousingRoomAccess,
} from "../src/reform/sim";
import { createFoodBundle } from "../src/reform/housing/food";
import { foodTaskMinutes } from "../src/reform/housing/foodPresentation";
import { housingSlotId } from "../src/reform/housing/topology";
import { base, one, two, ok } from "./helpers/construction";

function setup() {
  let g = base();
  g.ingredients = 6;
  g.actors[0].person.skills.cook = 3;
  g.house.rooms[0].fixtures[0].kind = "kitchen";
  rebuildHousingGeometry(g, g.housing!);
  g = order(g, two, "need", "energy");
  const result = createFoodBundle(g, { roomId: "bedroom", storageCell: 2 });
  return {
    g: ok(result),
    selection: { fixtureId: "hearth-1", bundleId: result.bundleId! },
  };
}

test("a bundle claims the cooking seat during delivery and cooks only on subsequent ticks", () => {
  const { g, selection } = setup();
  const before = structuredClone(g);
  const preview = inspectOrder(g, one, "work", "cook", selection);
  assert.deepEqual(g, before);
  assert.equal(preview.foodBundle?.transportMinutes, 3);
  const use = preview.facility!.useMinutes;
  assert.equal(preview.minutes, 3 + use);
  const begun = order(g, one, "work", "cook", selection);
  assert.equal(begun.ingredients, 4);
  assert.deepEqual(begun.actors[0].task!.reserved, {});
  assert.equal(foodTaskMinutes(begun, one), preview.minutes);
  assert.equal(nextCompletionMinutes(begun), preview.minutes);
  assert.ok(
    inspectOrder(begun, two, "work", "cook", { fixtureId: selection.fixtureId })
      .disabled,
  );
  const dining = order(begun, two, "home-use", selection.fixtureId);
  assert.equal(
    dining.actors[1].task?.station,
    housingSlotId("living", selection.fixtureId, 1),
  );
  const arrived = advance(begun, 3);
  assert.equal(arrived.food, g.food);
  assert.equal(arrived.actors[0].task!.spatial!.kind, "use");
  assert.equal(arrived.actors[0].task!.remaining, use);
  const stopped = order(arrived, one, "cancel");
  const restarted = inspectOrder(stopped, one, "work", "cook:easy", selection);
  assert.equal(restarted.foodBundle?.transportMinutes, 0);
  const last = advance(arrived, use - 1);
  assert.equal(last.food, g.food);
  assert.equal(last.housing!.foodLogistics!.bundle.state, "present");
  const done = advance(last, 1);
  assert.equal(done.food, g.food + 4);
  assert.equal(done.ingredients, 4);
  assert.equal(done.housing!.foodLogistics!.bundle.state, "consumed");
  assert.deepEqual(done.housing!.state.items, {});
  const shared = order(g, one, "work", "cook", {
    fixtureId: selection.fixtureId,
  });
  const normal = advance(
    shared,
    inspectOrder(g, one, "work", "cook", { fixtureId: selection.fixtureId })
      .minutes!,
  );
  assert.equal(done.food, normal.food);
  assert.deepEqual(done.actors[0].xp, normal.actors[0].xp);
  assert.ok(inspectOrder(done, one, "work", "cook", selection).disabled);
});

test("bundle authority follows the pickup floor and stove; invalid recipes preserve existing reservations", () => {
  const { g, selection } = setup();
  const restricted = setHousingRoomAccess(g, "bedroom", [two]);
  const working = order(restricted, one, "work", "cook", selection);
  assert.equal(working.actors[0].task?.spatial?.kind, "carry");
  const denied = order(working, one, "work", "cook:hard", selection);
  assert.deepEqual(denied.actors[0].task, working.actors[0].task);
  assert.deepEqual(denied.housing, working.housing);
  const released = setHousingRoomAccess(working, "living", [two]);
  assert.equal(released.actors[0].task, null);
  assert.equal(released.ingredients, 4);
});

test("a full meal stock on the completion tick preserves the physical bundle and gives no experience", () => {
  const { g, selection } = setup();
  const begun = order(g, one, "work", "cook", selection);
  const last = advance(
    begun,
    inspectOrder(g, one, "work", "cook", selection).minutes! - 1,
  );
  last.food = 1e9 - 3;
  const done = advance(last, 1);
  assert.equal(done.food, 1e9 - 3);
  assert.deepEqual(done.actors[0].xp, last.actors[0].xp);
  assert.equal(done.actors[0].task, null);
  const b = done.housing!.foodLogistics!.bundle;
  assert.equal(b.state, "present");
  assert.equal(b.assignment, undefined);
  assert.deepEqual(done.housing!.state.items[b.itemId].position, {
    kind: "at",
    point:
      done.housing!.state.slots[housingSlotId("living", "hearth-1", 0)].point,
  });
});

test("food preparation uses the new floor's authority after delivery, including when the old supply room is revoked", () => {
  const origin = base();
  origin.ingredients = 6;
  origin.house.rooms[1].fixtures.push({ kind: "kitchen", id: "far", cell: 3 });
  rebuildHousingGeometry(origin, origin.housing!);
  const r = createFoodBundle(origin, { roomId: "yard", storageCell: 2 });
  const g = ok(r),
    selection = { fixtureId: "far", bundleId: r.bundleId! };
  const preview = inspectOrder(g, one, "work", "cook", selection);
  const begun = order(
    order(g, two, "need", "energy"),
    one,
    "work",
    "cook",
    selection,
  );
  const arrived = advance(begun, preview.foodBundle!.transportMinutes);
  const permitted = setHousingRoomAccess(arrived, "living", [two]);
  assert.equal(permitted.actors[0].task!.spatial!.kind, "use");
  assert.equal(
    advance(permitted, arrived.actors[0].task!.remaining).housing!
      .foodLogistics!.bundle.state,
    "consumed",
  );
});

test("another cook finishing on the same minute gets accounted before a bundle may fill the remaining space", () => {
  const { g, selection } = setup();
  g.house.rooms[0].fixtures.push({ kind: "hearth", id: "second", cell: 7 });
  rebuildHousingGeometry(g, g.housing!);
  let started = order(
    order(g, one, "work", "cook", selection),
    two,
    "work",
    "cook",
    { fixtureId: "second" },
  );
  started = advance(started, 6);
  for (const actor of started.actors) {
    actor.task!.remaining = 1;
    started.housing!.state.actors[actor.person.id].order!.useRemaining = 1;
  }
  started.food = 1e9 - 4;
  const done = advance(started, 1);
  assert.ok(done.food <= 1e9);
  assert.ok(done.food > started.food);
  assert.deepEqual(done.actors[0].xp, started.actors[0].xp);
  assert.equal(done.housing!.foodLogistics!.bundle.state, "present");
});

test("autonomous meals reserve common ingredients, and gatherings see the occupied cooking seat during carry", () => {
  const { g, selection } = setup();
  g.food = 0;
  g.actors[0].needs.hunger = 10;
  const automatic = advance(g, 1);
  assert.equal(automatic.actors[0].task!.mode, "auto");
  assert.deepEqual(automatic.actors[0].task!.reserved, { ingredients: 2 });
  assert.equal(automatic.ingredients, 2);
  assert.equal(automatic.housing!.foodLogistics!.bundle.state, "present");
  const claimed = order(g, one, "work", "cook", selection);
  const seats = inspectHousingGathering(claimed, {
    kind: "talk",
    actorIds: [one, two],
    roomId: "living",
    fixtureId: selection.fixtureId,
  });
  assert.equal(seats.ok, false);
  assert.equal(seats.capacity, 1);
});

test("when a second cook takes over a bundle at the stove only the worker walks to its use floor", () => {
  const { g, selection } = setup();
  const staged = order(
    advance(order(g, one, "work", "cook", selection), 3),
    one,
    "cancel",
  );
  const candidate = order(staged, two, "cancel");
  const preview = inspectOrder(candidate, two, "work", "cook", selection);
  assert.equal(preview.foodBundle?.transportMinutes, 0);
  assert.ok(preview.facility!.moveMinutes > 0);
  assert.equal(
    preview.minutes,
    preview.facility!.moveMinutes + preview.facility!.useMinutes,
  );
  const cooking = order(candidate, two, "work", "cook", selection);
  assert.equal(cooking.actors[1].task!.spatial!.kind, "use");
  assert.equal(
    advance(cooking, preview.minutes!).housing!.foodLogistics!.bundle.state,
    "consumed",
  );
});

test("an unsafe cook has no predicted completion and stops before another minute of use", () => {
  const { g, selection } = setup();
  const use = advance(order(g, one, "work", "cook", selection), 4);
  use.actors[0].injury = 70;
  assert.equal(foodTaskMinutes(use, one), null);
  const stopped = advance(use, 1);
  assert.equal(stopped.actors[0].task, null);
  assert.equal(stopped.food, g.food);
  assert.equal(stopped.housing!.foodLogistics!.bundle.state, "present");
});

test("a cook may leave a restricted bedroom to cook in the living room but cannot cross it again after pickup", () => {
  const initial = base();
  initial.ingredients = 6;
  initial.house.rooms[2].fixtures.push({
    id: "yard-cooker",
    kind: "kitchen",
    cell: 6,
  });
  rebuildHousingGeometry(initial, initial.housing!);
  const move = order(
    order(initial, two, "work", "care"),
    one,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  const at = advance(move, 3);
  const b = createFoodBundle(setHousingRoomAccess(at, "bedroom", [two]), {
    roomId: "yard",
    storageCell: 2,
  });
  const g = order(ok(b), one, "wait");
  const far = { fixtureId: "yard-cooker", bundleId: b.bundleId! };
  assert.ok(isGame(g));
  assert.match(
    inspectOrder(g, one, "work", "cook", far).disabled ?? "",
    /入室/,
  );
  const refused = order(g, one, "work", "cook", far);
  assert.deepEqual(refused.housing, g.housing);
  assert.deepEqual(refused.actors[0].task, g.actors[0].task);
  const near = { ...far, fixtureId: "hearth-1" };
  const preview = inspectOrder(g, one, "work", "cook", near);
  assert.equal(preview.foodBundle?.transportMinutes, 5);
  const done = advance(order(g, one, "work", "cook", near), preview.minutes!);
  assert.equal(done.housing!.foodLogistics!.bundle.state, "consumed");
});
