import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFoodSupply,
  inspectFoodSupply,
  setFoodSupply,
  setFoodSupplyEnabled,
  tryFoodSupply,
} from "../src/reform/housing/foodSupply";
import {
  assignFoodHaul,
  createFoodBundle,
  presentFood,
  returnFoodBundle,
} from "../src/reform/housing/food";
import { foodTaskMinutes } from "../src/reform/housing/foodPresentation";
import { editHouse } from "../src/reform/house";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import {
  advance,
  inspectOrder,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { base, one, two, ok } from "./helpers/construction";

const request = { actorId: one, roomId: "bedroom", storageCell: 2 };
const configured = (g = base()) => ok(setFoodSupply(g, request));
function readyGame() {
  const g = base();
  g.ingredients = 6;
  g.food = 10;
  return order(g, two, "work", "care");
}
function start(g = configured(readyGame())) {
  return advance(g, 1);
}
function delivery(g: Game) {
  const minutes = foodTaskMinutes(g, one);
  assert.notEqual(minutes, null);
  return advance(g, minutes!);
}

test("setting and previewing a future assignment leaves time, stock, tasks and old saves unchanged", () => {
  const origin = readyGame(),
    original = structuredClone(origin);
  assert.equal(inspectFoodSupply(origin).state, "unset");
  for (const invalid of [
    { ...request, actorId: "missing" },
    { ...request, roomId: "missing" },
    { ...request, roomId: "living", storageCell: 0 },
    { ...request, storageCell: -1 },
    { ...request, storageCell: 2.5 },
  ]) {
    const rejected = setFoodSupply(origin, invalid);
    assert.ok(rejected.error);
    assert.equal(rejected.game, origin);
  }
  const g = configured(origin);
  assert.deepEqual(g.housing!.foodSupply, {
    version: 1,
    actorId: one,
    storage: housingPoint("bedroom", 2),
    enabled: true,
  });
  const snap = structuredClone(g);
  assert.equal(inspectFoodSupply(g).state, "ready");
  assert.ok(inspectFoodSupply(g).minutes! > 0);
  assert.deepEqual(g, snap);
  assert.deepEqual(origin, original);
  assert.equal(g.time, origin.time);
  assert.equal(g.ingredients, origin.ingredients);
  assert.deepEqual(g.actors, origin.actors);
  assert.equal(g.housing!.foodLogistics, undefined);
  assert.ok(isGame(g));
  const busy = order(origin, one, "wait");
  assert.equal(inspectFoodSupply(configured(busy)).state, "waiting");
  assert.deepEqual(configured(busy).actors, busy.actors);
});

test("a closed link, lost permission or exhausted stock/number prevents atomic start", () => {
  for (const g of [
    setHousingPassage(
      configured(readyGame()),
      "link",
      housingLinkId("living", "bedroom"),
      false,
    ),
    setHousingRoomAccess(configured(readyGame()), "bedroom", [two]),
    { ...configured(readyGame()), ingredients: 1 },
  ]) {
    const snapshot = structuredClone(g);
    assert.equal(inspectFoodSupply(g).state, "waiting");
    assert.equal(tryFoodSupply(g, g.actors[0]), false);
    assert.deepEqual(g, snapshot);
    const next = advance(g, 1);
    assert.equal(next.housing!.foodLogistics, undefined);
  }
  const made = createFoodBundle(configured(readyGame()), request);
  const g = ok(returnFoodBundle(ok(made), made.bundleId!));
  g.housing!.foodSupply!.enabled = true;
  g.housing!.foodLogistics!.nextId = Number.MAX_SAFE_INTEGER;
  g.housing!.foodLogistics!.bundle.id =
    "food-bundle-" + (Number.MAX_SAFE_INTEGER - 1);
  const snap = structuredClone(g);
  assert.equal(tryFoodSupply(g, g.actors[0]), false);
  assert.deepEqual(g, snap);
});

test("auto delivery keeps the same actors array and prior actor's reservation, and finishes one bundle", () => {
  const g = configured(readyGame());
  const refs = [g.actors, ...g.actors];
  const second = structuredClone(g.actors[1]);
  assert.equal(tryFoodSupply(g, g.actors[0]), true);
  assert.equal(g.actors, refs[0]);
  assert.equal(g.actors[0], refs[1]);
  assert.equal(g.actors[1], refs[2]);
  assert.deepEqual(g.actors[1], second);
  assert.equal(g.actors[0].task?.mode, "auto");
  assert.equal(g.actors[0].task?.kind, "home-haul");
  assert.equal(g.ingredients, 4);
  assert.ok(isGame(g));
  assert.equal(inspectFoodSupply(g).state, "hauling");
  const end = delivery(g);
  assert.equal(inspectFoodSupply(end).state, "stocked");
  assert.equal(presentFood(end.housing)!.assignment, undefined);
  assert.equal(end.ingredients, 4);
  assert.ok(end.actors[1].metrics.work > 0 || end.actors[1].metrics.care > 0);
  assert.equal(advance(end, 1).housing!.foodLogistics!.nextId, 2);
  assert.ok(isGame(end));

  // The earlier actor starts an ordinary reservation in this same selection loop.
  const before = readyGame();
  before.actors[0].priority = "cook";
  const switched = ok(
    setFoodSupply(order(before, two, "cancel"), { ...request, actorId: two }),
  );
  switched.food = 7;
  const tick = advance(switched, 1);
  assert.equal(tick.actors[0].task?.target, "cook");
  assert.equal(tick.actors[1].task?.mode, "auto");
  assert.equal(tick.ingredients, 2);
  assert.ok(isGame(tick));
});

test("exact eligibility and existing direct task precedence", () => {
  const baseState = configured(readyGame());
  for (const [field, value, allowed] of [
    ["injury", 49, true],
    ["injury", 50, false],
    ["mood", 24, false],
    ["mood", 25, true],
    ["hunger", 41, false],
    ["hunger", 42, true],
    ["minute", 419, false],
    ["minute", 420, true],
    ["minute", 1179, true],
    ["minute", 1180, false],
    ["danger", true, false],
    ["away", true, false],
  ] as const) {
    const g = structuredClone(baseState),
      a = g.actors[0];
    if (field === "minute") {
      g.time = 1440 + Number(value);
      g.housing!.state.time = g.time;
    } else if (field === "hunger") a.needs.hunger = Number(value);
    else if (field === "away") a.location = "village-away";
    else Object.assign(a, { [field]: value });
    const snap = structuredClone(g);
    assert.equal(tryFoodSupply(g, a), allowed, field + String(value));
    if (!allowed) {
      assert.equal(inspectFoodSupply(g).state, "waiting");
      assert.deepEqual(g, snap);
    }
  }
  const busy = order(baseState, one, "wait");
  assert.equal(advance(busy, 1).housing!.foodLogistics, undefined);
  for (const condition of ["need", "injury", "stocking"] as const) {
    const g = structuredClone(baseState);
    if (condition === "need") g.actors[0].needs.hunger = 41;
    if (condition === "injury") g.actors[0].injury = 50;
    if (condition === "stocking") g.food = 0;
    assert.equal(advance(g, 1).housing!.foodLogistics, undefined, condition);
  }
});

test("reuse matching unassigned material without creating another; wait for different or assigned material", () => {
  const origin = configured(readyGame());
  const made = createFoodBundle(origin, request),
    matching = ok(made);
  assert.equal(inspectFoodSupply(matching).state, "ready");
  const reused = start(matching);
  assert.equal(reused.ingredients, 4);
  assert.equal(presentFood(reused.housing)!.id, made.bundleId);
  assert.equal(reused.actors[0].task?.mode, "auto");
  const alternate = createFoodBundle(origin, {
    roomId: "yard",
    storageCell: 2,
  });
  const notReused = start(ok(alternate));
  assert.equal(presentFood(notReused.housing)!.assignment, undefined);
  assert.equal(notReused.ingredients, 4);
  const manual = ok(assignFoodHaul(matching, made.bundleId!, one, "store"));
  const next = start(manual);
  assert.equal(next.actors[0].task?.mode, "direct");
  assert.equal(next.ingredients, 4);
  const other = ok(
    assignFoodHaul(
      order(matching, two, "cancel"),
      made.bundleId!,
      two,
      "store",
    ),
  );
  assert.equal(presentFood(start(other).housing)!.assignment?.actorId, two);
});

test("repeated cooking consumes three bundles without taking more than six ingredients", () => {
  let g = configured(readyGame());
  g.actors[1].person.skills.cook = 3;
  for (let serial = 1; serial <= 3; serial++) {
    // Keep the control fixture free of unrelated autonomous shifts.
    if (g.actors[0].task) g = order(g, one, "cancel");
    for (const actor of g.actors) {
      Object.keys(actor.needs).forEach((n) =>
        Object.assign(actor.needs, { [n]: 100 }),
      );
      actor.mood = 90;
    }
    g = delivery(start(g));
    const b = presentFood(g.housing)!;
    assert.equal(b.id, "food-bundle-" + serial);
    assert.equal(b.assignment, undefined);
    assert.equal(g.ingredients, 6 - serial * 2);
    const selection = { fixtureId: "hearth-1", bundleId: b.id };
    const cook = order(g, two, "work", "cook", selection);
    const minutes = inspectOrder(g, two, "work", "cook", selection).minutes;
    assert.ok(minutes);
    assert.equal(cook.actors[1].task?.kind, "work");
    g = advance(cook, minutes);
    assert.equal(g.housing!.foodLogistics!.bundle.state, "consumed");
    assert.ok(isGame(g));
    assert.equal(g.food, 10 + serial * 4);
  }
  g = advance(g, 1);
  assert.equal(g.housing!.foodLogistics!.nextId, 4);
  assert.equal(g.ingredients, 0);
});

test("cancel pauses, valid replacement retains policy, rejected direct instruction preserves in-flight state", () => {
  const g = configured(readyGame());
  assert.ok(tryFoodSupply(g, g.actors[0]));
  const failed = order(g, one, "not-a-command");
  assert.deepEqual(failed.housing, g.housing);
  assert.deepEqual(failed.actors, g.actors);
  const wait = order(g, one, "wait");
  assert.equal(wait.housing!.foodSupply!.enabled, true);
  assert.equal(wait.actors[0].task?.kind, "wait");
  assert.equal(presentFood(wait.housing)!.assignment, undefined);
  const cancel = order(g, one, "cancel");
  assert.equal(cancel.housing!.foodSupply!.enabled, false);
  assert.equal(presentFood(cancel.housing)!.assignment, undefined);
  assert.equal(advance(cancel, 1).ingredients, 4);
  assert.equal(
    presentFood(start(ok(setFoodSupplyEnabled(cancel, true))).housing)!
      .assignment?.kind,
    "store",
  );

  const moving = advance(g, 2);
  const interrupted = order(moving, one, "cancel");
  assert.equal(interrupted.housing!.foodSupply!.enabled, false);
  assert.equal(
    interrupted.housing!.state.actors[one].order?.phase,
    "exiting-after-cancel",
  );
  assert.ok(isGame(interrupted));
});

test("pausing or clearing in flight never cancels the current haul; configured floor is protected even without a physical bundle", () => {
  const origin = configured(readyGame());
  const change = editHouse(origin.house, {
    type: "tile",
    room: "bedroom",
    cell: 2,
    tile: "wall",
  });
  for (const g of [origin, ok(setFoodSupplyEnabled(origin, false))]) {
    assert.match(applyHousingHouseEdit(g, change).error!, /補充/);
    assert.equal(
      applyHousingHouseEdit(ok(clearFoodSupply(g)), change).error,
      undefined,
    );
  }
  const hauling = start(origin);
  for (const control of [
    setFoodSupplyEnabled(hauling, false),
    clearFoodSupply(hauling),
  ]) {
    const g = ok(control);
    assert.equal(g.time, hauling.time);
    assert.deepEqual(g.actors, hauling.actors);
    assert.deepEqual(g.housing!.state, hauling.housing!.state);
    assert.ok(isGame(g));
    const delivered = delivery(g);
    assert.equal(presentFood(delivered.housing)!.assignment, undefined);
    assert.deepEqual(
      Object.values(delivered.housing!.state.items)[0].position,
      { kind: "at", point: housingPoint("bedroom", 2) },
    );
    assert.ok(isGame(delivered));
  }
});

test("accepted return pauses immediately and refund pauses; rejected return and safety cancellation retain policy", () => {
  const g = delivery(start());
  const b = presentFood(g.housing)!;
  assert.equal(assignFoodHaul(g, "missing", one, "return").game, g);
  assert.equal(returnFoodBundle(g, b.id).game, g);
  const back = ok(assignFoodHaul(g, b.id, one, "return"));
  assert.equal(back.housing!.foodSupply!.enabled, false);
  assert.equal(order(back, one, "cancel").housing!.foodSupply!.enabled, false);
  const settled = delivery(back);
  assert.equal(settled.ingredients, 6);
  assert.equal(
    advance(settled, 1).housing!.foodLogistics!.bundle.state,
    "returned",
  );
  const manual = createFoodBundle(configured(readyGame()), request);
  const refunded = ok(returnFoodBundle(ok(manual), manual.bundleId!));
  assert.equal(refunded.housing!.foodSupply!.enabled, false);
  const hauling = start();
  const safety = setHousingRoomAccess(hauling, "bedroom", []);
  assert.equal(safety.housing!.foodSupply!.enabled, true);
  assert.equal(presentFood(safety.housing)!.assignment, undefined);
});

test("the policy may target an absent resident, and a legacy resident is located only when actually starting", () => {
  const origin = readyGame();
  const trip = order(origin, one, "travel", "landing");
  const away = advance(trip, trip.actors[0].task!.remaining);
  assert.notEqual(away.actors[0].location, away.home);
  const assigned = configured(away);
  assert.ok(isGame(assigned));
  assert.match(inspectFoodSupply(assigned).detail, /帰宅/);
  assert.equal(advance(assigned, 1).housing!.foodLogistics, undefined);

  const legacy = configured(base("legacy"));
  assert.ok(Object.hasOwn(legacy.housing!.unlocated, one));
  const preview = inspectFoodSupply(legacy);
  assert.equal(preview.state, "ready");
  assert.ok(Object.hasOwn(legacy.housing!.unlocated, one));
  const auto = start(legacy);
  assert.equal(Object.hasOwn(auto.housing!.unlocated, one), false);
  assert.ok(isGame(auto));
});

test("a capacity-blocked meal keeps the old bundle for redelivery without using ingredients", () => {
  const g = delivery(start());
  const id = presentFood(g.housing)!.id;
  const selection = { fixtureId: "hearth-1", bundleId: id };
  const preview = inspectOrder(g, two, "work", "cook", selection);
  const cook = order(g, two, "work", "cook", selection);
  let last = advance(cook, preview.minutes! - 1);
  last.food = 1e9;
  last = advance(last, 1);
  assert.equal(presentFood(last.housing)!.id, id);
  assert.equal(last.ingredients, 4);
  assert.ok(isGame(last));
  if (last.actors[0].task) last = order(last, one, "cancel");
  last.actors[0].mood = 90;
  for (const need of Object.keys(last.actors[0].needs))
    Object.assign(last.actors[0].needs, { [need]: 100 });
  const resumed = start(last);
  assert.equal(presentFood(resumed.housing)!.assignment?.kind, "store");
  assert.equal(presentFood(resumed.housing)!.id, id);
  assert.equal(resumed.ingredients, 4);
  assert.ok(isGame(resumed));
});
