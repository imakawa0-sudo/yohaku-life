import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_RECIPES,
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  getCraftTitle,
  getLocalProjectEffects,
  getProjectRecipe,
  getProjectSummary,
  getResidentLife,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;

function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function assign(
  state: GameState,
  kind: ActionKind,
  id = "aki",
  target?: string,
): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}

function project(state: GameState, recipe: string, id = "aki"): GameState {
  return assign(state, "project", id, recipe);
}

function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 1000; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The project/action did not complete within a reasonable time");
}

function quiet(seed = 20261120): GameState {
  let state = createGame(seed);
  for (const resident of state.residents)
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  return state;
}

test("Project recipes and summaries explain the current choices without altering the world", () => {
  const state = quiet();
  const before = serialize(state);
  assert.deepEqual(
    PROJECT_RECIPES.map((recipe) => recipe.id).sort(),
    ["crafting-tools", "kitchen-tools", "rest-corner", "wood-flower"],
  );
  assert.equal(getProjectRecipe("wood-flower")?.cost.scrap, 1);
  assert.equal(getProjectRecipe("kitchen-tools")?.cost.scrap, 3);
  assert.equal(getProjectRecipe("rest-corner")?.cost.scrap, 3);
  assert.equal(getProjectRecipe("crafting-tools")?.cost.scrap, 3);
  assert.equal(getProjectRecipe("not-a-recipe"), undefined);
  assert.equal(getProjectSummary(state).length, 4);
  getLocalProjectEffects(state, "home");
  getLocalProjectEffects(state, "kitchen");
  assert.equal(serialize(state), before);
});

test("A project reserves shared material until one completion, keeping progress through save and interruption", () => {
  let state = quiet(10);
  state.resources.scrap = 10;
  const original = serialize(state);
  state = project(state, "kitchen-tools");
  assert.equal(state.minutes, 480);
  assert.equal(state.resources.scrap, 10);
  assert.equal(availableResources(state).scrap, 7);
  assert.equal(JSON.parse(original).resources.scrap, 10);
  const projectId = person(state).action!.id;
  state = advance(state, 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state = deserialize(serialize(state));
  assert.equal(person(state).suspended?.id, projectId);
  assert.equal(person(state).suspended?.progress, 5);
  assert.equal(availableResources(state).scrap, 7);
  state = act(state, { type: "resume", residentId: "aki" });
  state = finish(state);
  assert.equal(state.resources.scrap, 7);
  assert.equal(state.life!.upgrades?.length, 1);
  assert.equal(state.life!.upgrades![0].id, projectId);
  assert.equal(state.life!.upgrades![0].creatorId, "aki");
  const after = advance(deserialize(serialize(state)), 5);
  assert.equal(after.resources.scrap, 7);
  assert.equal(after.life!.upgrades?.length, 1);
});

test("Cancelling releases a project's material and unique projects remain exclusive while paused or completed", () => {
  let state = quiet(11);
  state.resources.scrap = 20;
  state = project(state, "rest-corner");
  const firstId = person(state).action!.id;
  const activeBefore = serialize(state);
  const activeConflict = command(state, { type: "assign", residentIds: ["ren"], kind: "project", target: "rest-corner" });
  assert.ok(activeConflict.error);
  assert.strictEqual(activeConflict.state, state);
  assert.equal(serialize(state), activeBefore);
  state = act(state, { type: "pause", residentId: "aki" });
  state = deserialize(serialize(state));
  const pausedConflict = command(state, { type: "assign", residentIds: ["ren"], kind: "project", target: "rest-corner" });
  assert.ok(pausedConflict.error);
  assert.equal(availableResources(state).scrap, 17);
  state = act(state, { type: "cancel", residentId: "aki", actionId: firstId });
  assert.equal(state.resources.scrap, 20);
  assert.equal(availableResources(state).scrap, 20);
  assert.equal(state.life?.upgrades?.length ?? 0, 0);
  state = finish(project(state, "rest-corner", "ren"), "ren");
  assert.equal(state.resources.scrap, 17);
  assert.equal(state.life!.upgrades![0].creatorId, "ren");
  const completedConflict = command(state, { type: "assign", residentIds: ["mio"], kind: "project", target: "rest-corner" });
  assert.ok(completedConflict.error);
  assert.strictEqual(completedConflict.state, state);
});

test("Shared scrap creates real choices and rejects unaffordable or multi-person projects atomically", () => {
  let state = quiet(12);
  state = project(state, "kitchen-tools");
  assert.equal(availableResources(state).scrap, 1);
  const before = serialize(state);
  const unaffordable = command(state, { type: "assign", residentIds: ["ren"], kind: "project", target: "rest-corner" });
  assert.ok(unaffordable.error);
  assert.strictEqual(unaffordable.state, state);
  assert.equal(serialize(state), before);
  state = project(state, "wood-flower", "ren");
  assert.equal(availableResources(state).scrap, 0);
  assert.equal(state.resources.scrap, 4);
  state = finish(state);
  state = finish(state, "ren");
  assert.equal(state.resources.scrap, 0);

  const fresh = quiet(13);
  const freshBefore = serialize(fresh);
  const group = assignSelection(fresh, ["aki", "mio"], "project", "wood-flower");
  assert.ok(group.error);
  assert.strictEqual(group.state, fresh);
  const unknown = command(fresh, { type: "assign", residentIds: ["aki"], kind: "project", target: "unknown-recipe" });
  assert.ok(unknown.error);
  assert.strictEqual(unknown.state, fresh);
  assert.equal(serialize(fresh), freshBefore);
});

test("Craft skill and arm injuries affect project time without blocking beginners or changing the old hobby", () => {
  const beginner = quiet(14);
  person(beginner).skills.craft = 0;
  const practiced = structuredClone(beginner);
  person(practiced).skills.craft = 10;
  const injured = structuredClone(practiced);
  person(injured).wounds.arm = 2;
  const expectedTimes: Record<string, [number, number, number]> = {
    "wood-flower": [55, 25, 38],
    "kitchen-tools": [60, 30, 45],
    "rest-corner": [50, 25, 38],
    "crafting-tools": [60, 30, 45],
  };
  for (const recipe of PROJECT_RECIPES) {
    const slow = project(beginner, recipe.id);
    const fast = project(practiced, recipe.id);
    const hurt = project(injured, recipe.id);
    assert.ok(person(slow).action!.duration > person(fast).action!.duration);
    assert.ok(person(hurt).action!.duration > person(fast).action!.duration);
    assert.deepEqual(
      [person(slow).action!.duration, person(fast).action!.duration, person(hurt).action!.duration],
      expectedTimes[recipe.id],
      "Skill and injury apply once when reserving the project",
    );
  }
  assert.equal(person(assign(beginner, "hobby")).action?.duration, 45);
  assert.equal(person(assign(practiced, "hobby")).action?.duration, 45);
  const completed = finish(project(beginner, "wood-flower"));
  assert.equal(person(completed).skills.craft, 0.2);
});

test("Kitchen tools shorten only new cooking in their own room and do not lose the benefit for a skilled cook", () => {
  let state = quiet(15);
  state = project(state, "kitchen-tools");
  state = advance(state, person(state).action!.duration - 1);
  state = assign(state, "cook", "mio");
  const beforeCompletionDuration = person(state, "mio").action!.duration;
  assert.equal(beforeCompletionDuration, 22);
  state = advance(state, 1);
  assert.equal(state.life!.upgrades?.length, 1);
  assert.equal(person(state, "mio").action!.duration, beforeCompletionDuration);
  state = finish(state, "mio");
  state = assign(state, "cook", "mio");
  const shortened = person(state, "mio").action!.duration;
  assert.equal(shortened, 17);
  state = act(state, { type: "cancel", residentId: "mio" });
  state = assign(state, "cook", "mio");
  assert.equal(person(state, "mio").action!.duration, shortened, "The same equipment must not stack its reduction on each new reservation");
  state = act(state, { type: "cancel", residentId: "mio" });
  person(state, "mio").wounds.arm = 1;
  state = assign(state, "cook", "mio");
  assert.equal(person(state, "mio").action!.duration, 21);
  state = act(state, { type: "cancel", residentId: "mio" });
  person(state, "mio").wounds.arm = 0;
  person(state, "mio").skills.cooking = 10;
  state = assign(state, "cook", "mio");
  assert.equal(person(state, "mio").action!.duration, 15);
  state = act(state, { type: "cancel", residentId: "mio" });
  state = finish(assign(state, "move", "mio", "bedroom"), "mio");
  state = assign(state, "cook", "mio");
  assert.equal(person(state, "mio").action!.duration, 20);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A rest corner improves rest in its room without granting remote or sleep bonuses", () => {
  const upgraded = finish(project(quiet(16), "rest-corner"));
  function rested(withCorner: boolean, location: "home" | "bedroom", sleep = false) {
    let state = withCorner ? structuredClone(upgraded) : quiet(16);
    state.minutes = 1440 + 450;
    person(state).location = location;
    person(state).hp = 40;
    person(state).energy = 20;
    person(state).hunger = 100;
    state = advance(assign(state, sleep ? "sleep" : "rest"), 30);
    return person(state);
  }
  const ordinary = rested(false, "home");
  const local = rested(true, "home");
  const remote = rested(true, "bedroom");
  assert.ok(Math.abs(local.energy - ordinary.energy - 8) < 1e-8);
  assert.equal(local.hp, ordinary.hp + 2);
  assert.ok(Math.abs(remote.energy - ordinary.energy) < 1e-8);
  assert.equal(remote.hp, ordinary.hp);
  assert.equal(rested(true, "home", true).hp, rested(false, "home", true).hp);
  assert.equal(rested(true, "home", true).energy, rested(false, "home", true).energy);
});

test("A helper contributes time without taking authorship, and repeatable flowers remain flowers when displayed", () => {
  let state = quiet(17);
  state.minutes = 1320;
  for (const resident of state.residents) resident.hunger = 100;
  state = project(state, "wood-flower");
  state = assign(state, "help", "mio", "aki");
  state = finish(state, "mio");
  state = finish(state);
  const first = getResidentLife(state, "aki").crafts[0];
  assert.ok(first);
  assert.equal(first.authorId, "aki");
  assert.equal(first.design, "flower");
  assert.match(getCraftTitle(first), /花/);
  assert.equal(getResidentLife(state, "mio").crafts.length, 0);
  state = finish(assign(state, "move", "aki", "bedroom"));
  const carried = getResidentLife(state, "aki").crafts.find((piece) => piece.id === first.id);
  assert.ok(carried);
  assert.equal(carried.createdLocation, "home");
  assert.equal(carried.displayedAt, undefined);
  assert.match(getCraftTitle(carried), /花/);
  state = finish(assign(state, "move", "aki", "home"));
  state = finish(project(state, "wood-flower"));
  assert.equal(getResidentLife(state, "aki").crafts.length, 2);
  assert.equal(new Set(state.life!.crafts.map((piece) => piece.id)).size, 2);
  assert.equal(state.resources.scrap, 2);
  state = finish(assign(state, "decorate"));
  state = finish(assign(state, "place-craft", "aki", String(first.id)));
  const display = state.life!.events.find((event) => event.kind === "display" && event.craftId === first.id);
  assert.ok(display);
  assert.doesNotMatch(display.text, /小鳥/);
  assert.match(getCraftTitle(state.life!.crafts[0]), /花/);
  state = finish(assign(state, "sleep"));
  while (state.minutes < 1920) {
    state = advance(state, Math.min(30, 1920 - state.minutes));
    assert.doesNotMatch(state.pauseReason ?? "", /空腹|活力/);
  }
  const reflection = getResidentLife(state, "aki").reflection;
  assert.ok(reflection);
  assert.doesNotMatch(reflection.text, /小鳥/);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Project completion reproduces across saved partial progress, and old saves do not invent upgrades", () => {
  let state = project(quiet(18), "kitchen-tools");
  state = advance(state, 5);
  const whole = advance(state, 10);
  let split = deserialize(serialize(state));
  for (let minute = 0; minute < 10; minute++) split = advance(split, 1);
  assert.deepEqual(split, whole);
  assert.deepEqual(finish(deserialize(serialize(whole))), finish(whole));

  const legacy = quiet(19);
  delete legacy.life;
  legacy.flags.decorated = true;
  const restored = deserialize(serialize(legacy));
  assert.deepEqual(restored.life?.upgrades ?? [], []);
  assert.equal(person(assign(restored, "cook", "mio"), "mio").action?.duration, 22);
});

test("Malformed or ungrounded completed equipment is rejected before replacing the current state", () => {
  const valid = finish(project(quiet(20), "kitchen-tools"));
  const before = serialize(valid);
  const corruptions: Array<(state: GameState) => void> = [
    (state) => { state.life!.upgrades![0].recipeId = "wood-flower" as "kitchen-tools"; },
    (state) => { state.life!.upgrades![0].creatorId = "unknown-person"; },
    (state) => { state.life!.upgrades![0].location = "unknown-place" as "home"; },
    (state) => { state.life!.upgrades![0].completedAt = state.minutes + 1; },
    (state) => { state.life!.upgrades!.push({ ...state.life!.upgrades![0] }); },
    (state) => { state.life!.events = state.life!.events.filter((event) => event.kind !== "project"); },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(valid);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  assert.equal(serialize(valid), before);
  assert.deepEqual(deserialize(before), valid);
});
