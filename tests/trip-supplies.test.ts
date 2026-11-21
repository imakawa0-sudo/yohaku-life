import test from "node:test";
import assert from "node:assert/strict";
import { command, createGame, serialize } from "../src/game/engine.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { previewTripSupplies, HUNGER_PER_MINUTE, TARGET_HUNGER } from "../src/game/trip-supplies.ts";
import type { Action, Command, GameState, LocationId } from "../src/game/types.ts";

const resident = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
function fresh(location: LocationId = "village"): GameState {
  const s = createGame(617);
  for (const r of s.residents) { r.location = location; r.hunger = 100; r.action = null; r.suspended = null; }
  return s;
}
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function food(s: GameState, id: string, amount: number) { ensureInventory(s).packs[id].food = amount; }
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`); }

test("A day's carried-food budget uses current hunger, rather than a fixed number of meals per resident", () => {
  const s = fresh();
  resident(s).hunger = 100;
  resident(s, "ren").hunger = 35;
  food(s, "aki", 1); food(s, "ren", 2);
  const view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 1440, { estimateReturnMinutes: () => 51 });
  assert.equal(HUNGER_PER_MINUTE, 0.055);
  assert.equal(TARGET_HUNGER, 35);
  assert.equal(view.people[0].requiredMeals, 1);
  assert.equal(view.people[1].requiredMeals, 2);
  assert.equal(view.requiredMeals, 3);
  assert.equal(view.freeFood, 3);
  assert.equal(view.shortfall, 0);
  assert.equal(view.people[0].returnMinutes, 51);
  assert.match(view.assumption, /満腹度35.*適時食べる想定/);
  near(view.people[0].projectedHungerWithoutNewMeals, 20.8);
});

test("An active meal is credited after its actual remaining time and its hunger cap, not as an unconditional free 55", () => {
  let s = fresh("home");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  const before = serialize(s);
  const view = previewTripSupplies(s, ["aki"], s.minutes + 1440);
  assert.equal(view.people[0].activeMealCredit, true);
  assert.equal(view.people[0].requiredMeals, 1, "A forced full-hunger meal cannot replace tomorrow's needed portion");
  near(view.people[0].projectedHungerWithoutNewMeals, 21.625);
  assert.equal(view.people[0].reservedFood, 0, "The already reserved base meal is not travelling pack stock");
  assert.equal(view.freeFood, 0);
  assert.equal(serialize(s), before);
});

test("A low-hunger active pack meal can fund its actual future nutrition without being counted as free stock", () => {
  let s = fresh(); resident(s).hunger = 20; food(s, "aki", 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  resident(s).action!.progress = 10;
  const view = previewTripSupplies(s, ["aki"], s.minutes + 60);
  assert.equal(view.people[0].activeMealCredit, true);
  assert.equal(view.people[0].requiredMeals, 0);
  assert.equal(view.people[0].freeFood, 0);
  assert.equal(view.people[0].reservedFood, 1);
  near(view.people[0].projectedHungerWithoutNewMeals, 71.7);
});

test("An unfinished, unsafe, unconscious or displaced meal never promises its future calories", () => {
  let s = fresh(); resident(s).hunger = 20; food(s, "aki", 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  const short = previewTripSupplies(s, ["aki"], s.minutes + 10);
  assert.equal(short.people[0].activeMealCredit, false);
  assert.equal(short.people[0].requiredMeals, 1);
  assert.match(short.people[0].warnings.join(" "), /完了しない.*15分/);
  near(short.people[0].projectedHungerWithoutNewMeals, 19.45);
  for (const change of [
    (x: GameState) => { x.enemy.location = "village"; },
    (x: GameState) => { resident(x).hp = 0; },
    (x: GameState) => { resident(x).action!.origin = "home"; },
    (x: GameState) => { delete resident(x).action!.origin; },
    (x: GameState) => { x.inventory!.packs.aki.food = 0; },
    (x: GameState) => { resident(x).action!.reservationSource = "base"; },
  ]) {
    const altered = structuredClone(s); change(altered);
    const view = previewTripSupplies(altered, ["aki"], altered.minutes + 60);
    assert.equal(view.people[0].activeMealCredit, false);
    assert.equal(view.people[0].requiredMeals, 1);
    assert.ok(view.people[0].warnings.length > 0);
  }
  const legacy = fresh("home"); resident(legacy).hunger = 20;
  let old = act(legacy, { type: "assign", residentIds: ["aki"], kind: "eat" });
  delete resident(old).action!.origin;
  assert.equal(previewTripSupplies(old, ["aki"], old.minutes + 60).people[0].activeMealCredit, true);
});

test("Held meals remain unavailable and base reservations never become a traveller's carried food", () => {
  let s = fresh(); resident(s).hunger = 20; food(s, "aki", 2);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  s = act(s, { type: "pause", residentId: "aki" });
  let view = previewTripSupplies(s, ["aki"], s.minutes + 60);
  assert.equal(view.people[0].activeMealCredit, false);
  assert.equal(view.people[0].heldMealFood, 1);
  assert.equal(view.people[0].reservedFood, 1);
  assert.equal(view.freeFood, 1);
  assert.equal(view.requiredMeals, 1);
  assert.match(view.people[0].warnings.join(" "), /中断中の食事/);
  s = fresh("home"); resident(s).hunger = 20;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  s = act(s, { type: "pause", residentId: "aki" });
  resident(s).location = "village";
  view = previewTripSupplies(s, ["aki"], s.minutes + 60);
  assert.equal(view.people[0].heldMealFood, 1);
  assert.equal(view.people[0].reservedFood, 0);
  assert.equal(view.freeFood, 0);
  assert.equal(view.shortfall, 1);
  assert.match(view.people[0].warnings.join(" "), /拠点予約.*携行食/);
});

test("Borrowed meal inputs have already moved into the eater's pack and are never counted at the former donor again", () => {
  let s = fresh(); resident(s).hunger = resident(s, "mio").hunger = 20;
  food(s, "mio", 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  assert.equal(s.inventory!.packs.mio.food, 0);
  assert.equal(s.inventory!.packs.aki.food, 1);
  const view = previewTripSupplies(s, ["aki", "mio"], s.minutes + 60);
  assert.equal(view.people[0].activeMealCredit, true);
  assert.equal(view.freeFood, 0);
  assert.equal(view.requiredMeals, 1);
  assert.equal(view.shortfall, 1);
});

test("Each selected free pack is counted once, excluding nearby people, warehouse, ground and future production", () => {
  const s = fresh(); resident(s).hunger = resident(s, "ren").hunger = 35;
  food(s, "ren", 1); food(s, "mio", 99);
  s.resources.food = 99;
  s.inventory!.ground.village = { food: 99, ingredients: 0, medicine: 0, scrap: 0 };
  const view = previewTripSupplies(s, ["aki", "ren", "aki"], s.minutes + 60);
  assert.equal(view.people.length, 2);
  assert.equal(view.freeFood, 1);
  assert.equal(view.requiredMeals, 2);
  assert.equal(view.shortfall, 1);
});

test("A surplus at a different place cannot erase a shortage, and fractional portions combine only at the same location", () => {
  const s = fresh(); resident(s).hunger = resident(s, "ren").hunger = 35;
  resident(s, "ren").location = "shelter";
  food(s, "ren", 4);
  let view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 60);
  assert.equal(view.groups.length, 2);
  assert.equal(view.freeFood, 4);
  assert.equal(view.requiredMeals, 2);
  assert.equal(view.shortfall, 1);
  food(s, "aki", 0.5); food(s, "ren", 0.5);
  view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 60);
  assert.equal(view.shortfall, 2, "Two different half portions cannot feed either separated person");
  resident(s, "ren").location = "village";
  view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 60);
  assert.equal(view.groups.length, 1);
  assert.equal(view.shortfall, 1, "Two local halves form one usable portion");
});

test("A moving person's pack cannot fund a stationary neighbour, while a paused move follows actual sharing rules", () => {
  let s = fresh(); resident(s).hunger = resident(s, "ren").hunger = 35;
  food(s, "ren", 4);
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "move", target: "home" });
  let view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 60);
  assert.equal(view.groups.length, 2);
  assert.equal(view.shortfall, 1);
  assert.deepEqual(view.groups.map(group => [group.key, group.shareable, group.location]), [
    ["location:village", true, "village"], ["person:ren", false, "village"],
  ]);
  assert.match(view.people.find(person => person.residentId === "ren")!.warnings.join(" "), /携行食.*融通していません/);
  s = act(s, { type: "pause", residentId: "ren" });
  view = previewTripSupplies(s, ["aki", "ren"], s.minutes + 60);
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].key, "location:village");
  assert.equal(view.groups[0].shareable, true);
  assert.equal(view.shortfall, 0, "A held move alone no longer prevents actual local sharing");
});

test("An actual rescue isolates the carrier and patient, including a held patient's transport claim", () => {
  let s = fresh();
  for (const person of s.residents) person.hunger = 35;
  resident(s, "mio").hp = 20;
  food(s, "ren", 4); food(s, "mio", 4);
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "mio" });
  let view = previewTripSupplies(s, ["aki", "ren", "mio"], s.minutes + 60);
  assert.equal(view.groups.length, 3);
  assert.equal(view.shortfall, 1, "Neither travelling pack can erase stationary Aki's shortage");
  assert.equal(view.groups.find(group => group.key === "person:ren")?.shareable, false);
  assert.equal(view.groups.find(group => group.key === "person:mio")?.shareable, false);
  let patientEtaCalls = 0;
  const transported = previewTripSupplies(s, ["mio"], s.minutes + 60, {
    estimateReturnMinutes: () => { patientEtaCalls++; return 51; },
  });
  assert.equal(patientEtaCalls, 0, "A conscious carried patient cannot be promised an independent walking time");
  assert.equal(transported.people[0].returnMinutes, undefined);
  s = act(s, { type: "pause", residentId: "ren" });
  view = previewTripSupplies(s, ["aki", "ren", "mio"], s.minutes + 60);
  assert.equal(view.groups.length, 2);
  assert.deepEqual(view.groups.find(group => group.key === "location:village")?.residentIds, ["aki", "ren"]);
  assert.equal(view.groups.find(group => group.key === "person:mio")?.shareable, false,
    "The patient's active or held rescue claim excludes their pack from peers");
  assert.equal(previewTripSupplies(s, ["mio"], s.minutes + 60, {
    estimateReturnMinutes: () => { patientEtaCalls++; return 51; },
  }).people[0].returnMinutes, undefined);
  assert.equal(patientEtaCalls, 0);
  assert.equal(view.shortfall, 0);
  food(s, "ren", 0);
  view = previewTripSupplies(s, ["aki", "ren", "mio"], s.minutes + 60);
  assert.equal(view.shortfall, 2, "The held patient's surplus remains isolated from both neighbours");
  resident(s, "ren").hp = 0;
  view = previewTripSupplies(s, ["aki", "ren", "mio"], s.minutes + 60);
  assert.equal(view.groups.length, 1, "A dead carrier's stale claim is not a physical transport boundary");
});

test("Being idle at a live enemy still prevents a return-time promise and current-meal credit", () => {
  let s = fresh();
  s.enemy.location = "village";
  let calls = 0;
  let view = previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => { calls++; return 51; } });
  assert.equal(calls, 0);
  assert.equal(view.people[0].returnMinutes, undefined);
  assert.match(view.people[0].warnings.join(" "), /交戦.*所要時間は見込んでいません/);
  s.enemy.defeated = true;
  view = previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => { calls++; return 51; } });
  assert.equal(calls, 1);
  assert.equal(view.people[0].returnMinutes, 51);
  s.enemy.defeated = false; s.enemy.hp = 0;
  view = previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => { calls++; return 51; } });
  assert.equal(calls, 2);
  assert.equal(view.people[0].returnMinutes, 51);
  s.enemy.location = "ruins"; s.enemy.hp = 80;
  resident(s).hunger = 20; food(s, "aki", 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  s.enemy.location = "village";
  assert.equal(previewTripSupplies(s, ["aki"], s.minutes + 60).people[0].activeMealCredit, false);
  s.enemy.hp = 0;
  assert.equal(previewTripSupplies(s, ["aki"], s.minutes + 60).people[0].activeMealCredit, true);
});

test("Stationary return estimates are optional and never fabricated for movement, transport, battle or unconsciousness", () => {
  const cases: ["action" | "suspended", Action["kind"]][] = [
    ["action", "move"], ["suspended", "move"], ["action", "rescue"], ["suspended", "rescue"],
    ["action", "attack"], ["action", "defend"],
  ];
  for (const [slot, kind] of cases) {
    const s = fresh();
    resident(s)[slot] = { id: s.nextId++, kind, label: kind, duration: 30, progress: 5 };
    let calls = 0;
    const view = previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => { calls++; return 51; } });
    assert.equal(calls, 0);
    assert.equal(view.people[0].returnMinutes, undefined);
    assert.match(view.people[0].warnings.join(" "), /所要時間は見込んでいません/);
  }
  const s = fresh(); resident(s).hp = 0;
  let calls = 0;
  const unconscious = previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => { calls++; return 51; } });
  assert.equal(calls, 0);
  assert.equal(unconscious.people[0].returnMinutes, undefined);
  assert.match(unconscious.people[0].warnings.join(" "), /意識がありません/);
  resident(s).hp = 100;
  for (const estimate of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(previewTripSupplies(s, ["aki"], s.minutes + 60, { estimateReturnMinutes: () => estimate }).people[0].returnMinutes, undefined);
  const late = previewTripSupplies(s, ["aki"], s.minutes + 30, { estimateReturnMinutes: () => 51 });
  assert.match(late.people[0].warnings.join(" "), /帰還目安を過ぎる/);
  assert.equal(previewTripSupplies(s, ["aki"], s.minutes, { estimateReturnMinutes: () => 0 }).people[0].returnMinutes, 0);
});

test("Past and exact-boundary horizons stay finite without creating elapsed time or an extra portion", () => {
  const s = fresh(); resident(s).hunger = 35;
  const dueNow = previewTripSupplies(s, ["aki"], s.minutes);
  assert.equal(dueNow.horizonMinutes, 0);
  assert.equal(dueNow.overdue, false);
  assert.equal(dueNow.requiredMeals, 0);
  const overdue = previewTripSupplies(s, ["aki"], s.minutes - 1);
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.horizonMinutes, 0);
  assert.equal(overdue.requiredMeals, 0);
  assert.equal(previewTripSupplies(s, ["aki"], s.minutes + 1000).requiredMeals, 1);
  resident(s).hunger = 34.99;
  assert.equal(previewTripSupplies(s, ["aki"], s.minutes).requiredMeals, 1);
  assert.ok(Number.isSafeInteger(previewTripSupplies(s, ["aki"], Number.MAX_SAFE_INTEGER).requiredMeals));
});

test("Invalid times and selections return an empty safe projection rather than inventing an actor", () => {
  const s = fresh(), before = serialize(s);
  for (const until of [Number.NaN, Number.POSITIVE_INFINITY, -1, 4.5]) {
    const view = previewTripSupplies(s, ["aki"], until);
    assert.ok(view.error);
    assert.deepEqual(view.people, []);
    assert.equal(view.requiredMeals, 0);
    assert.equal(view.shortfall, 0);
    assert.ok(Number.isFinite(view.until));
  }
  for (const ids of [[], ["unknown"], ["aki", null]] as string[][]) {
    const view = previewTripSupplies(s, ids, s.minutes + 60);
    assert.ok(view.error);
    assert.deepEqual(view.groups, []);
  }
  assert.equal(serialize(s), before);
});

test("A recruited fourth person shares the same forecast rules without being folded into another resident", () => {
  let s = fresh(); s.minutes = 600;
  food(s, "mio", 3);
  s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "talk" });
  s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "deliver" });
  s = act(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  for (const person of s.residents) { person.hunger = 100; food(s, person.id, 1); }
  const view = previewTripSupplies(s, s.residents.map(person => person.id), s.minutes + 1440);
  assert.equal(view.people.length, 4);
  assert.ok(view.people.some(person => person.residentId === "village-guide"));
  assert.equal(view.requiredMeals, 4);
  assert.equal(view.freeFood, 4);
  assert.equal(view.shortfall, 0);
});

test("Frozen legacy and current saves are projected without initializing inventory or changing randomness", () => {
  for (const version of [2, 3] as const) {
    const s = fresh(); s.version = version;
    delete s.inventory;
    delete s.region;
    const before = serialize(s), { seed, nextId, minutes } = s;
    freezeDeep(s);
    const a = previewTripSupplies(s, ["aki", "ren"], minutes + 1440, { estimateReturnMinutes: () => 51 });
    const b = previewTripSupplies(s, ["aki", "ren"], minutes + 1440, { estimateReturnMinutes: () => 51 });
    assert.deepEqual(a, b);
    assert.equal(a.freeFood, 0);
    assert.equal(s.inventory, undefined);
    assert.deepEqual([s.seed, s.nextId, s.minutes], [seed, nextId, minutes]);
    assert.equal(serialize(s), before);
  }
});
