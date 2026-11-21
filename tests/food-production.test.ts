import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, getAutonomyDecision, serialize } from "../src/game/engine.ts";
import { accessibleResources, ensureInventory, freeBaseResources } from "../src/game/inventory.ts";
import {
  DEFAULT_FOOD_PRODUCTION_TARGET, MAX_FOOD_PRODUCTION_TARGET, getFoodProductionTarget,
  needsFoodProduction, setFoodProductionTarget, validFoodProduction,
} from "../src/game/food-production.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (s: GameState, id = "mio") => s.residents.find(resident => resident.id === id)!;
const snapshot = (s: GameState) => JSON.stringify(s);
const world = (s: GameState) => {
  const { foodProduction: _settings, ...rest } = s;
  return rest;
};
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
const target = (s: GameState, value: number) => act(s, { type: "food-production-target", target: value });
function fresh(seed = 851): GameState {
  const s = createGame(seed);
  s.resources.food = 6;
  s.resources.ingredients = 12;
  for (const resident of s.residents) { resident.hunger = 100; resident.energy = 100; }
  person(s, "ren").policy = "rest";
  return s;
}
function finish(s: GameState, id = "mio"): GameState {
  const jobId = person(s, id).action?.id;
  assert.ok(jobId);
  for (let minute = 0; minute < 1000; minute++) {
    if (person(s, id).action?.id !== jobId) return s;
    s = advance(s, 1);
  }
  assert.fail("The actual job did not finish");
}
function toolsAtKitchen(): GameState {
  let s = fresh(852);
  s.resources.food = 12;
  person(s, "aki").location = "kitchen";
  person(s).location = "road";
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "kitchen-tools" });
  s = finish(s, "aki");
  s = finish(act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" }), "aki");
  person(s).location = "home";
  s.resources.food = 0;
  s.resources.ingredients = 10;
  return s;
}
function freezeDeep(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
}

test("Absent legacy settings read as six without initialization, and explicit six retains the complete old route", () => {
  assert.equal(DEFAULT_FOOD_PRODUCTION_TARGET, 6);
  assert.equal(MAX_FOOD_PRODUCTION_TARGET, 99);
  for (const version of [1, 2, 3] as const) {
    const old = createGame(853);
    old.version = version;
    if (version === 1) { delete old.inventory; delete old.region; }
    const before = snapshot(old);
    freezeDeep(old);
    assert.equal(validFoodProduction(old), true);
    assert.equal(getFoodProductionTarget(old), 6);
    assert.equal(needsFoodProduction(old, { food: 5, ingredients: 2, medicine: 0, scrap: 0 }), true);
    assert.equal(snapshot(old), before);
    assert.equal(deserialize(serialize(old)).foodProduction, undefined);
    const same = command(old, { type: "food-production-target", target: 6 });
    assert.equal(same.error, undefined);
    assert.strictEqual(same.state, old);
    assert.equal(snapshot(old), before);
  }
  const old = toolsAtKitchen();
  assert.equal(getAutonomyDecision(old, "mio")?.reason.text, "食事が少ないため、料理道具のある場所で用意する");
  const explicit = structuredClone(old);
  explicit.foodProduction = { version: 1, target: 6 };
  const oldRoute = advance(old, 10), explicitRoute = advance(explicit, 10);
  assert.deepEqual(world(explicitRoute), oldRoute);
  assert.equal(person(oldRoute).action?.kind, "cook");
  assert.equal(person(oldRoute).action?.autonomyReason?.text, "食事が少ないため、料理道具のある場所で用意する");
});

test("Settings only change their metadata, preserving the complete world and both reservations", () => {
  let s = fresh(854);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  s = advance(s, 5);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "eat" });
  person(s, "aki").hp = 0;
  person(s, "aki").location = "village";
  s = act(s, { type: "plan-trip", residentIds: ["aki"], purpose: "現地で手当を待つ", returnAt: s.minutes + 60 });
  s = act(s, { type: "save-selection-preset", name: "留守番", residentIds: ["mio", "ren"] });
  s.pauseReason = "既存の遭遇と体調確認";
  const original = structuredClone(s), source = s;
  const before = snapshot(s);
  s = target(s, 12);
  assert.equal(snapshot(source), before);
  assert.deepEqual(world(s), original);
  assert.equal(person(s).action?.reserved?.food, 1);
  assert.equal(person(s).suspended?.reserved?.ingredients, 2);
  const same = command(s, { type: "food-production-target", target: 12 });
  assert.strictEqual(same.state, s);
  s = target(s, 0);
  assert.deepEqual(world(s), original);
  s = target(s, 6);
  assert.deepEqual(world(s), original);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Six to twelve produces two real three-meal batches, then stops starting new cooking", () => {
  let s = fresh(855);
  assert.notEqual(getAutonomyDecision(s, "mio")?.kind, "cook");
  s = target(s, 12);
  s = advance(s, 1);
  assert.equal(person(s).action?.kind, "cook");
  assert.equal(person(s).action?.duration, 22);
  assert.match(person(s).action!.autonomyReason!.text, /補充目安12食/);
  s = finish(s);
  assert.equal(s.resources.food, 9);
  assert.equal(s.resources.ingredients, 10);
  s = advance(s, 1);
  assert.equal(person(s).action?.kind, "cook");
  s = finish(deserialize(serialize(s)));
  assert.equal(s.resources.food, 12);
  assert.equal(s.resources.ingredients, 8);
  s = advance(s, 5);
  assert.notEqual(person(s).action?.kind, "cook");
  assert.equal(s.logs.filter(log => log.title === "温かい食事ができた").length, 2);
  assert.equal(s.resources.food, 12);
  let overshoot = target(fresh(856), 10);
  overshoot = finish(advance(overshoot, 1));
  overshoot = finish(advance(overshoot, 1));
  assert.equal(overshoot.resources.food, 12, "A started three-meal batch is completed in full");
  assert.notEqual(getAutonomyDecision(overshoot, "mio")?.kind, "cook");
});

test("Zero pauses only new autonomous cooking, preserving direct cooking, eating, recovery and ingredient thresholds", () => {
  let s = target(fresh(857), 0);
  assert.notEqual(getAutonomyDecision(s, "mio")?.kind, "cook");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "cook" });
  s = finish(s, "aki");
  assert.equal(s.resources.food, 9);
  assert.equal(s.resources.ingredients, 10);
  person(s).hunger = 40;
  assert.equal(getAutonomyDecision(s, "mio")?.kind, "eat");
  s = finish(advance(s, 1));
  assert.ok(person(s).hunger > 90);
  const recovering = target(fresh(858), 0);
  person(recovering).hp = 40;
  person(recovering).energy = 20;
  assert.equal(getAutonomyDecision(recovering, "mio")?.kind, "rest");
  assert.equal(person(advance(recovering, 1)).action?.kind, "rest");
  for (const [policy, low, enough] of [["balanced", 3, 4], ["gather", 11, 12]] as const) {
    const gathering = target(fresh(859), 0);
    person(gathering, "ren").policy = policy;
    gathering.resources.ingredients = low;
    assert.equal(getAutonomyDecision(gathering, "ren")?.reason.code, "gathering");
    gathering.resources.ingredients = enough;
    assert.notEqual(getAutonomyDecision(gathering, "ren")?.reason.code, "gathering");
  }
});

test("Lowering the target preserves actual and held cooking, and resumed material is consumed exactly once", () => {
  for (const held of [false, true]) {
    let s = advance(target(fresh(860), 12), 1);
    if (held) s = act(s, { type: "pause", residentId: "mio" });
    const job = structuredClone(held ? person(s).suspended : person(s).action);
    s = target(s, 0);
    assert.deepEqual(held ? person(s).suspended : person(s).action, job);
    s = deserialize(serialize(s));
    if (held) {
      s = advance(s, 10);
      assert.deepEqual(person(s).suspended, job);
      assert.equal(s.resources.food, 6);
      assert.equal(s.resources.ingredients, 12);
      assert.equal(freeBaseResources(s).ingredients, 10);
      s = act(s, { type: "resume", residentId: "mio" });
    }
    s = finish(s);
    assert.equal(s.resources.food, 9);
    assert.equal(s.resources.ingredients, 10);
    s = advance(deserialize(serialize(s)), 5);
    assert.equal(s.resources.food, 9);
    assert.equal(s.resources.ingredients, 10);
    assert.equal(s.logs.filter(log => log.title === "温かい食事ができた").length, 1);
  }
});

test("Unreserved tool travel keeps its ID after a target change and skips an unnecessary arrival cook", () => {
  for (const value of [0, 6]) {
    let s = toolsAtKitchen();
    s.resources.food = 7;
    s = advance(target(s, 12), 1);
    const movement = structuredClone(person(s).action);
    assert.equal(movement?.autonomyNext, "cook");
    assert.equal(movement?.reserved, undefined);
    const ingredients = s.resources.ingredients;
    s = target(s, value);
    assert.deepEqual(person(s).action, movement);
    s = advance(deserialize(serialize(s)), 2);
    assert.equal(person(s).location, "kitchen");
    assert.notEqual(person(s).action?.kind, "cook");
    assert.equal(freeBaseResources(s).ingredients, ingredients);
    assert.equal(s.logs.some(log => log.title === "温かい食事ができた"), false);
    s = advance(s, 1);
    assert.notEqual(person(s).action?.kind, "cook");
  }
});

test("A necessary arrival cook uses current stock and the newest target reason without rewriting its old decision", () => {
  for (const value of [6, 9]) {
    let s = toolsAtKitchen();
    if (value === 6) s.resources.food = 7;
    s = advance(target(s, 12), 1);
    const departure = s, movement = structuredClone(person(s).action);
    assert.match(movement!.autonomyReason!.text, /補充目安12食/);
    s = target(s, value);
    if (value === 6) {
      s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 2 });
      assert.equal(s.resources.food, 5, "An actual withdrawal makes cooking necessary again before arrival");
    }
    s = advance(deserialize(serialize(s)), 2);
    assert.equal(person(s).action?.kind, "cook");
    assert.equal(person(s).action?.progress, 0);
    assert.equal(person(s).action?.reserved?.ingredients, 2);
    assert.notEqual(person(s).action?.id, movement!.id);
    const expected = value === 6 ? "食事が少ないため、料理道具のある場所で用意する" : "補充目安9食に届かないため、料理する";
    assert.equal(person(s).action?.autonomyReason?.text, expected);
    assert.equal(person(s).action?.autonomyReason?.decidedAt, s.minutes);
    assert.deepEqual(person(departure).action, movement);
  }
});

test("The replenishment threshold still uses local unreserved food, including packs but excluding remote or moving peers", () => {
  let s = fresh(861);
  s.resources.food = 4;
  const inventory = ensureInventory(s);
  inventory.packs.mio.food = 2;
  assert.equal(accessibleResources(s, "mio").food, 6);
  assert.equal(needsFoodProduction(s, accessibleResources(s, "mio")), false);
  inventory.packs.mio.food = 0;
  inventory.packs.ren.food = 2;
  person(s, "ren").location = "bedroom";
  assert.equal(accessibleResources(s, "mio").food, 4);
  assert.equal(needsFoodProduction(s, accessibleResources(s, "mio")), true);
  person(s, "ren").location = "home";
  assert.equal(needsFoodProduction(s, accessibleResources(s, "mio")), false);
  const moving = act(s, { type: "assign", residentIds: ["ren"], kind: "move", target: "bedroom" });
  assert.equal(person(moving, "ren").location, "home");
  assert.equal(needsFoodProduction(moving, accessibleResources(moving, "mio")), true);
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "eat" });
  assert.equal(accessibleResources(s, "mio").food, 5, "One reserved pack meal is not free stock");
  assert.equal(needsFoodProduction(s, accessibleResources(s, "mio")), true);
  s = act(s, { type: "pause", residentId: "ren" });
  assert.equal(accessibleResources(s, "mio").food, 5, "A held reservation is still excluded");
  assert.equal(needsFoodProduction(s, { food: 0, ingredients: 1, medicine: 0, scrap: 0 }), false);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Invalid targets and malformed extensions reject atomically through the actual save loader", () => {
  const s = fresh(862);
  for (const value of [undefined, null, "12", -1, 100, 0.5, Number.NaN, Infinity]) {
    const before = snapshot(s);
    assert.ok(setFoodProductionTarget(s, value as never).error);
    assert.equal(snapshot(s), before);
    const result = command(s, { type: "food-production-target", target: value } as never);
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
  }
  for (const value of [null, [], {}, { version: 2, target: 6 }, { version: 1, target: -1 },
    { version: 1, target: 100 }, { version: 1, target: 1.5 }, { version: 1, target: "6" },
    { version: 1, target: 6, extra: true }]) {
    const malformed = fresh(863);
    (malformed as unknown as Record<string, unknown>).foodProduction = value;
    const before = snapshot(malformed);
    assert.equal(validFoodProduction(malformed), false);
    assert.equal(getFoodProductionTarget(malformed), 6);
    assert.ok(setFoodProductionTarget(malformed, 12).error);
    assert.equal(snapshot(malformed), before);
    assert.throws(() => deserialize(serialize(malformed)), /保存データ/);
  }
  for (const value of [0, 99]) assert.deepEqual(deserialize(serialize(target(fresh(), value))).foodProduction, { version: 1, target: value });
  s.ended = true;
  for (const value of [6, 12]) {
    const before = snapshot(s);
    const result = command(s, { type: "food-production-target", target: value });
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
    assert.equal(snapshot(s), before);
  }
  for (const value of [null, undefined, "unknown", []]) {
    assert.equal(validFoodProduction(value as never), false);
    assert.equal(getFoodProductionTarget(value as never), 6);
    assert.ok(setFoodProductionTarget(value as never, 12).error);
  }
});
