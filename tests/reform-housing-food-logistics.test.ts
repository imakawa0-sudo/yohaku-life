import * as food from "../src/reform/housing/food";
import { foodTaskMinutes } from "../src/reform/housing/foodPresentation";
import { editHouse } from "../src/reform/house";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
} from "../src/reform/sim";
import { housingPoint, housingLinkId } from "../src/reform/housing/topology";
import { base, ok, one, two } from "./helpers/construction";

test("setting aside two vegetables creates one physical bundle and cancelling a haul leaves it on the floor", () => {
  const origin = base();
  origin.ingredients = 6;
  const request = { roomId: "bedroom", storageCell: 2 };
  const result = food.createFoodBundle(origin, request);
  const g = ok(result);
  assert.equal(g.time, origin.time);
  assert.equal(g.ingredients, 4);
  assert.equal(origin.ingredients, 6);
  const b = g.housing!.foodLogistics!.bundle;
  assert.equal(b.state, "present");
  assert.equal(b.quantity, 2);
  assert.deepEqual(g.housing!.state.items[b.itemId].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.ok(food.createFoodBundle(g, request).error);
  const begun = ok(food.assignFoodHaul(g, b.id, one, "store"));
  const stopped = order(begun, one, "cancel");
  assert.equal(stopped.ingredients, 4);
  assert.deepEqual(stopped.housing!.foodLogistics!.bundle, b);
  assert.deepEqual(stopped.housing!.state.items, g.housing!.state.items);
  assert.equal(
    advance(stopped, 1).housing!.foodLogistics!.bundle.state,
    "present",
  );
});

test("an interrupted carrier drops at the passage exit; another worker brings the same bundle back for a single refund", () => {
  const origin = base();
  origin.ingredients = 6;
  const result = food.createFoodBundle(origin, {
    roomId: "bedroom",
    storageCell: 2,
  });
  const id = result.bundleId!;
  const start = ok(food.assignFoodHaul(ok(result), id, one, "store"));
  const inPassage = advance(order(start, two, "work", "care"), 2);
  assert.equal(inPassage.housing!.state.actors[one].position.kind, "transit");
  const exiting = order(inPassage, one, "cancel");
  assert.equal(
    exiting.housing!.state.actors[one].order?.phase,
    "exiting-after-cancel",
  );
  const pos = exiting.housing!.state.actors[one].position;
  assert.equal(pos.kind, "transit");
  const floor = advance(exiting, pos.remaining);
  assert.equal(floor.actors[0].task, null);
  assert.deepEqual(Object.values(floor.housing!.state.items)[0].position, {
    kind: "at",
    point: pos.step.to,
  });
  const swap = order(floor, two, "cancel");
  const back = ok(food.assignFoodHaul(swap, id, two, "return"));
  back.ingredients = 1e9;
  const arrived = advance(
    back,
    food.inspectFoodHaul(swap, id, two, "return").minutes!,
  );
  assert.equal(arrived.ingredients, 1e9);
  assert.equal(arrived.housing!.foodLogistics!.bundle.state, "present");
  assert.deepEqual(Object.values(arrived.housing!.state.items)[0].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  arrived.ingredients = 4;
  const returned = ok(food.returnFoodBundle(arrived, id));
  assert.equal(returned.ingredients, 6);
  assert.equal(returned.housing!.foodLogistics!.bundle.state, "returned");
  assert.ok(food.returnFoodBundle(returned, id).error);
});

test("storage and equipment floors survive renovation while physical, and a receipt releases the storage floor", () => {
  const origin = base();
  origin.ingredients = 6;
  const b = food.createFoodBundle(origin, {
      roomId: "bedroom",
      storageCell: 2,
    }),
    g = ok(b);
  const changed = editHouse(g.house, {
    type: "tile",
    room: "bedroom",
    cell: 2,
    tile: "wall",
  });
  assert.match(applyHousingHouseEdit(g, changed).error!, /食材|一束/);
  const cook = order(g, one, "work", "cook", {
    bundleId: b.bundleId!,
    fixtureId: "hearth-1",
  });
  const moved = editHouse(cook.house, {
    type: "move",
    room: "living",
    cell: 7,
    id: "hearth-1",
  });
  assert.ok(applyHousingHouseEdit(cook, moved).error);
  assert.equal(
    applyHousingHouseEdit(ok(food.returnFoodBundle(g, b.bundleId!)), changed)
      .error,
    undefined,
  );
});

test("waiting at a closed passage keeps the payload; injury, danger and lost route authority release it safely", () => {
  const origin = base();
  origin.ingredients = 6;
  const result = food.createFoodBundle(origin, {
    roomId: "yard",
    storageCell: 2,
  });
  const begun = ok(
    food.assignFoodHaul(ok(result), result.bundleId!, one, "store"),
  );
  const link = housingLinkId("living", "bedroom");
  const waiting = advance(setHousingPassage(begun, "link", link, false), 3);
  assert.equal(foodTaskMinutes(waiting, one), null);
  assert.equal(waiting.housing!.state.actors[one].order?.phase, "waiting");
  const resumed = setHousingPassage(waiting, "link", link, true);
  const stored = advance(resumed, foodTaskMinutes(resumed, one)!);
  assert.deepEqual(Object.values(stored.housing!.state.items)[0].position, {
    kind: "at",
    point: housingPoint("yard", 2),
  });
  const forbidden = setHousingRoomAccess(begun, "bedroom", []);
  assert.equal(forbidden.actors[0].task, null);
  for (const issue of ["injury", "danger"] as const) {
    const g = advance(begun, 2);
    if (issue === "injury") g.actors[0].injury = 70;
    else g.actors[0].danger = true;
    const out = advance(g, 2);
    assert.equal(out.actors[0].task, null);
    assert.deepEqual(Object.values(out.housing!.state.items)[0].position, {
      kind: "at",
      point: housingPoint("bedroom", 0),
    });
  }
});

test("empty stock, an occupied storage cell, the supply floor and unavailable workers refuse without any changes", () => {
  const origin = base("legacy");
  origin.ingredients = 1;
  const request = { roomId: "bedroom", storageCell: 2 };
  assert.ok(food.createFoodBundle(origin, request).error);
  origin.ingredients = 2;
  for (const cell of [0, 3, -1, 99])
    assert.ok(
      food.createFoodBundle(origin, { roomId: "living", storageCell: cell })
        .error,
    );
  const result = food.createFoodBundle(origin, request),
    g = ok(result);
  const busy = order(g, one, "wait");
  assert.equal(
    food.assignFoodHaul(busy, result.bundleId!, one, "store").game,
    busy,
  );
  assert.equal(
    food.inspectFoodHaul(g, result.bundleId!, one, "store").ok,
    true,
  );
  assert.equal(Object.hasOwn(g.housing!.unlocated, one), true);
  const assigned = ok(food.assignFoodHaul(g, result.bundleId!, one, "store"));
  assert.equal(Object.hasOwn(assigned.housing!.unlocated, one), false);
});

test("revoking the only intermediate room cancels even while its passage is physically closed", () => {
  const origin = base();
  origin.ingredients = 6;
  const r = food.createFoodBundle(origin, { roomId: "yard", storageCell: 2 });
  const begun = ok(food.assignFoodHaul(ok(r), r.bundleId!, one, "store"));
  const waiting = advance(
    setHousingPassage(begun, "link", housingLinkId("living", "bedroom"), false),
    2,
  );
  const revoked = setHousingRoomAccess(waiting, "bedroom", []);
  assert.equal(revoked.actors[0].task, null);
  assert.equal(revoked.ingredients, 4);
});

test("store and return reject a route requiring re-entry after pickup while a one-way delivery remains available", () => {
  const source = base();
  source.ingredients = 6;
  // Reach the bedroom while the other resident keeps a known direct task.
  const move = order(
    order(source, two, "work", "care"),
    one,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  const bedroom = advance(move, 3);
  assert.equal(bedroom.actors[0].room, "bedroom");
  const yard = food.createFoodBundle(bedroom, {
    roomId: "yard",
    storageCell: 2,
  });
  const id = yard.bundleId!;
  const denied = setHousingRoomAccess(ok(yard), "bedroom", [two]);
  assert.ok(isGame(denied));
  const preview = food.inspectFoodHaul(denied, id, one, "store");
  assert.equal(preview.ok, false);
  assert.match(preview.disabled!, /入室/);
  assert.equal(food.assignFoodHaul(denied, id, one, "store").game, denied);

  const available = order(order(denied, one, "work", "care"), two, "cancel");
  const started = ok(food.assignFoodHaul(available, id, two, "store"));
  const stored = advance(
    started,
    food.inspectFoodHaul(available, id, two, "store").minutes!,
  );
  const returnedBy = order(stored, one, "cancel");
  assert.equal(returnedBy.actors[0].room, "bedroom");
  assert.equal(food.inspectFoodHaul(returnedBy, id, one, "return").ok, false);
  assert.equal(
    food.assignFoodHaul(returnedBy, id, one, "return").game,
    returnedBy,
  );

  const inside = food.createFoodBundle(
    setHousingRoomAccess(bedroom, "bedroom", [two]),
    { roomId: "living", storageCell: 2 },
  );
  const near = ok(inside),
    nearId = inside.bundleId!;
  const allowed = food.inspectFoodHaul(near, nearId, one, "store");
  assert.equal(allowed.minutes, 5);
  const done = advance(ok(food.assignFoodHaul(near, nearId, one, "store")), 5);
  assert.deepEqual(Object.values(done.housing!.state.items)[0].position, {
    kind: "at",
    point: housingPoint("living", 2),
  });
});
