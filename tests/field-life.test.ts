import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, command, createGame, deserialize, getAutonomyDecision,
  getWishProgress, serialize,
} from "../src/game/engine.ts";
import { decideAutonomy, validAutonomy } from "../src/game/autonomy.ts";
import { accessibleResources, ensureInventory } from "../src/game/inventory.ts";
import { makeMorningReflections, validLifeState } from "../src/game/life.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((r) => r.id === id)!;
function act(state: GameState, cmd: Command): GameState {
  const result = command(state, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function calm(): GameState {
  const state = createGame(20261120);
  for (const r of state.residents) {
    r.hunger = 100;
    r.energy = 100;
    r.policy = "rest";
  }
  return state;
}
function packFood(state: GameState, id: string, amount: number): GameState {
  return act(state, { type: "transfer", residentId: id, from: "base", to: id, resource: "food", amount });
}

for (const location of ["village", "meadow", "ridge"] as LocationId[]) {
  test(`A real shared field meal at ${location} survives saving without inventing warmth or a distant diner`, () => {
    let state = packFood(calm(), "aki", 2);
    person(state).location = location;
    person(state, "mio").location = location;
    const baseFood = state.resources.food;
    const result = assignSelection(state, ["aki", "mio"], "eat");
    assert.equal(result.error, undefined, result.error);
    state = advance(result.state, 15);
    const meals = state.life!.events.filter((event) => event.kind === "meal");
    assert.equal(meals.length, 1);
    const event = meals[0];
    assert.equal(event.location, location);
    assert.deepEqual([...event.actors].sort(), ["aki", "mio"]);
    assert.deepEqual([...event.witnesses].sort(), ["aki", "mio"]);
    assert.doesNotMatch(event.text, /温か|食卓|室内/);
    assert.equal(state.resources.food, baseFood, "the warehouse cannot pay for food already carried outside");
    assert.equal(state.inventory!.packs.aki.food + state.inventory!.packs.mio.food, 0);
    assert.equal(state.autonomy!.mealPairs["aki:mio"].location, location);
    assert.equal(validLifeState(state), true);
    assert.equal(validAutonomy(state), true);
    assert.deepEqual(deserialize(serialize(state)), state);
  });
}

test("Three travelling diners remember their actual meal without completing a warm-home-meal wish", () => {
  let state = calm();
  for (const id of ["aki", "mio", "ren"]) state = packFood(state, id, 1);
  for (const r of state.residents) r.location = "village";
  const result = assignSelection(state, ["aki", "mio", "ren"], "eat");
  assert.equal(result.error, undefined, result.error);
  state = advance(result.state, 15);
  const event = state.life!.events.find((e) => e.kind === "meal")!;
  assert.equal(event.actors.length, 3);
  assert.equal(getWishProgress(state, "mio").completed, false);
  // A controlled next-morning clock isolates the stored words from unrelated
  // events; this is not presented as a normal overnight travelling playthrough.
  state.minutes = 1920;
  const reflections = makeMorningReflections(state);
  assert.equal(reflections.length, 3);
  assert.equal(new Set(reflections.map((r) => r.text)).size, 3);
  for (const reflection of reflections) {
    assert.equal(reflection.eventId, event.id);
    assert.match(reflection.text, /三人.*食事/);
    assert.doesNotMatch(reflection.text, /温か|食卓|室内/);
  }
});

test("Outdoor autonomy only offers safe local food to an idle companion and never takes over the expedition", () => {
  const state = calm();
  ensureInventory(state).packs.ren.food = 1;
  person(state, "mio").location = "meadow";
  person(state, "mio").hunger = 30;
  person(state, "ren").location = "meadow";
  const before = serialize(state);
  const decide = () => decideAutonomy(state, "mio", () => 1, accessibleResources(state, "mio"));
  const decision = decide();
  assert.equal(decision?.kind, "eat");
  assert.equal(decision?.reason.code, "food");
  assert.equal(decision?.target, undefined);
  assert.equal(serialize(state), before, "the decision is a read-only projection");
  person(state, "ren").location = "ridge";
  assert.equal(decide(), undefined, "the distant warehouse and other camp cannot supply a meal");
  person(state, "ren").location = "meadow";
  state.enemy.location = "meadow";
  assert.equal(decide(), undefined, "a nearby hostile blocks an autonomous meal");
  state.enemy.defeated = true;
  person(state, "mio").suspended = { id: state.nextId++, kind: "observe", label: "景色を眺める", progress: 3, duration: 20, origin: "meadow" };
  assert.equal(decide(), undefined, "a paused direct order retains control");
  person(state, "mio").suspended = null;
  person(state, "mio").hunger = 100;
  assert.equal(decide(), undefined, "outside hunger is not permission to gather, return, or start leisure");
  person(state).location = "meadow";
  person(state).hunger = 30;
  assert.equal(decideAutonomy(state, "aki", () => 1, accessibleResources(state, "aki")), undefined);
});

test("The common clock can start and finish a companion's local field meal without using warehouse food", () => {
  let state = packFood(calm(), "ren", 1);
  person(state, "mio").location = "meadow";
  person(state, "mio").hunger = 30;
  person(state, "ren").location = "meadow";
  const baseFood = state.resources.food;
  assert.equal(getAutonomyDecision(state, "mio")?.kind, "eat");
  state = advance(state, 1);
  const meal = person(state, "mio").action;
  assert.equal(meal?.kind, "eat");
  assert.equal(meal?.automatic, true);
  assert.equal(meal?.reservationSource, "pack");
  assert.equal(person(state, "ren").action, null);
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored, state);
  state = advance(restored, 15);
  assert.ok(person(state, "mio").hunger > 70);
  assert.equal(state.resources.food, baseFood);
  assert.equal(state.inventory!.packs.ren.food + state.inventory!.packs.mio.food, 0);
  const experience = state.life!.events.find((e) => e.kind === "meal")!;
  assert.deepEqual(experience.actors, ["mio"]);
  assert.ok(!experience.witnesses.includes("aki"));
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("New field locations do not make home crafts, shelves, or life equipment valid outdoors", () => {
  let craft = calm();
  craft = act(craft, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  craft = advance(craft, 45);
  assert.equal(validLifeState(craft), true);
  const piece = craft.life!.crafts[0];
  piece.createdLocation = "village";
  craft.life!.events.find((e) => e.craftId === piece.id)!.location = "village";
  assert.equal(validLifeState(craft), false);

  let shelf = calm();
  shelf = act(shelf, { type: "assign", residentIds: ["aki"], kind: "decorate" });
  shelf = advance(shelf, 25);
  assert.equal(validLifeState(shelf), true);
  shelf.life!.shelf!.location = "ridge";
  assert.equal(validLifeState(shelf), false);

  let upgrade = calm();
  upgrade = act(upgrade, { type: "assign", residentIds: ["aki"], kind: "project", target: "kitchen-tools" });
  upgrade = advance(upgrade, 60);
  assert.equal(validLifeState(upgrade), true);
  upgrade.life!.upgrades![0].location = "meadow";
  assert.equal(validLifeState(upgrade), false);
});
