import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  serialize,
} from "../src/game/engine.ts";
import { advanceFromControls } from "../src/game/time-controls.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;

function assign(state: GameState, kind: ActionKind, id = "aki"): GameState {
  const result = command(state, { type: "assign", residentIds: [id], kind });
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function preparedNight(minutes = 1320): GameState {
  const state = createGame(20261120);
  state.minutes = minutes;
  for (const resident of state.residents) resident.hunger = 100;
  return state;
}

test("A five-minute sleep only restores five minutes of health and energy, without healing wounds", () => {
  let state = preparedNight(1440 + 475);
  person(state).hp = 40;
  person(state).energy = 10;
  person(state).wounds = { arm: 2, leg: 1, body: 2 };
  const wounds = { ...person(state).wounds };
  state = assign(state, "sleep");
  assert.equal(person(state).action?.duration, 5);
  state = advance(state, 5);
  assert.equal(person(state).action, null);
  assert.ok(Math.abs(person(state).hp - 40.2) < 1e-8);
  assert.ok(Math.abs(person(state).energy - 10.94) < 1e-8);
  assert.deepEqual(person(state).wounds, wounds);
  assert.ok(state.logs.some((entry) => entry.title === "新しい朝"));
});

test("Finishing an eight-hour sleep gives no sudden health bonus beyond elapsed recovery", () => {
  let state = preparedNight();
  person(state).hp = 40;
  person(state).energy = 20;
  person(state).wounds.arm = 2;
  state = assign(state, "sleep");
  assert.equal(person(state).action?.duration, 480);
  state = advance(state, 479);
  assert.equal(person(state).action?.progress, 479);
  const beforeFinish = person(state).hp;
  state = advance(deserialize(serialize(state)), 1);
  assert.equal(state.minutes, 1800);
  assert.equal(person(state).action, null);
  assert.ok(Math.abs(person(state).hp - beforeFinish - 0.04) < 1e-8);
  assert.ok(Math.abs(person(state).hp - 59.2) < 1e-8);
  assert.equal(person(state).wounds.arm, 1);
  assert.ok(state.logs.some((entry) => entry.title === "眠りから覚めた"));
  assert.equal(state.logs.some((entry) => entry.title === "新しい朝"), false);
});

test("Only a completed sleep of at least four hours eases one wound level", () => {
  for (const duration of [239, 240]) {
    let state = preparedNight(1440 + 480 - duration);
    person(state).hp = 40;
    person(state).energy = 20;
    person(state).wounds = { arm: 2, leg: 1, body: 3 };
    state = assign(state, "sleep");
    assert.equal(person(state).action?.duration, duration);
    state = advance(state, duration);
    const relief = duration === 240 ? 1 : 0;
    assert.deepEqual(person(state).wounds, {
      arm: 2 - relief,
      leg: 1 - relief,
      body: 3 - relief,
    });
    assert.ok(person(state).energy < 100);
  }
});

test("A short rest gives modest health recovery without removing recorded wounds", () => {
  let state = preparedNight();
  person(state).hp = 40;
  person(state).wounds = { arm: 2, leg: 1, body: 2 };
  const wounds = { ...person(state).wounds };
  state = advance(assign(state, "rest"), 30);
  assert.equal(person(state).hp, 42);
  assert.deepEqual(person(state).wounds, wounds);
});

test("Crossing the hunger warning stops a long advance once while preserving work and materials", () => {
  let state = createGame(30);
  state = assign(state, "cook", "mio");
  state = assign(state, "hobby");
  person(state).hunger = 20.05;
  const ingredients = state.resources.ingredients;
  const freeIngredients = availableResources(state).ingredients;
  const hobbyId = person(state).action!.id;
  const cookingId = person(state, "mio").action!.id;
  const seed = state.seed;
  const before = serialize(state);
  const warned = advanceFromControls(state, 60);
  assert.equal(warned.minutes, state.minutes + 1);
  assert.match(warned.pauseReason ?? "", /アキ.*空腹/);
  assert.equal(person(warned).action?.id, hobbyId);
  assert.equal(person(warned).action?.progress, 1);
  assert.equal(person(warned, "mio").action?.id, cookingId);
  assert.equal(person(warned, "mio").action?.progress, 1);
  assert.equal(warned.resources.ingredients, ingredients);
  assert.equal(availableResources(warned).ingredients, freeIngredients);
  assert.equal(warned.seed, seed);
  assert.equal(serialize(state), before);
  const restored = deserialize(serialize(warned));
  const continued = advanceFromControls(restored, 10);
  assert.equal(continued.minutes, warned.minutes + 10);
  assert.equal(person(continued).action?.progress, 11);
  assert.doesNotMatch(continued.pauseReason ?? "", /空腹/);
});

test("Energy warning uses the final minute state and does not trap an already tired resident", () => {
  let state = assign(createGame(31), "hobby");
  person(state).energy = 12.02;
  const warned = advance(state, 60);
  assert.equal(warned.minutes, state.minutes + 1);
  assert.match(warned.pauseReason ?? "", /アキ.*活力/);
  assert.equal(person(warned).action?.progress, 1);
  const continued = advance(deserialize(serialize(warned)), 5);
  assert.equal(continued.minutes, warned.minutes + 5);
  assert.equal(person(continued).action?.progress, 6);

  let sleeping = preparedNight();
  person(sleeping).energy = 12.005;
  sleeping = advance(assign(sleeping, "sleep"), 10);
  assert.equal(sleeping.minutes, 1330);
  assert.ok(person(sleeping).energy > 12);
  assert.doesNotMatch(sleeping.pauseReason ?? "", /活力/);
});

test("A meal completed in the same minute prevents a false hunger-crossing interruption", () => {
  let state = assign(createGame(35), "eat");
  person(state).hunger = 20.01;
  person(state).action!.progress = 14;
  const food = state.resources.food;
  state = advance(state, 5);
  assert.equal(state.minutes, 485);
  assert.ok(person(state).hunger > 70);
  assert.equal(state.resources.food, food - 1);
  assert.doesNotMatch(state.pauseReason ?? "", /空腹/);
});

test("A need-warning checkpoint replays deterministically across save and split advancement", () => {
  let state = assign(createGame(48), "hobby");
  person(state).hunger = 20.05;
  const whole = advance(state, 60);
  const split = advance(deserialize(serialize(state)), 1);
  assert.deepEqual(split, whole);
  const afterWhole = advance(deserialize(serialize(whole)), 10);
  let afterSplit = deserialize(serialize(split));
  for (let minute = 0; minute < 10; minute++) afterSplit = advance(afterSplit, 1);
  assert.deepEqual(afterSplit, afterWhole);
  assert.deepEqual(advance(whole, 0), whole);
  assert.deepEqual(advance(whole, Number.NaN), whole);
});

test("Old saved long sleeps remain readable while newly reserved sleep is limited", () => {
  let legacy = assign(preparedNight(), "sleep");
  person(legacy).action!.duration = 1200;
  person(legacy).action!.label = "翌朝まで眠る";
  delete legacy.life;
  const restored = deserialize(serialize(legacy));
  assert.equal(person(restored).action?.duration, 1200);
  const progressed = advance(restored, 30);
  assert.equal(person(progressed).action?.progress, 30);
  assert.deepEqual(deserialize(serialize(progressed)), progressed);
  const fresh = assign(preparedNight(), "sleep");
  assert.equal(person(fresh).action?.duration, 480);
});

test("Conscious starving residents can finish their reserved meals at very low health and consume each portion once", () => {
  const initial = createGame(90);
  for (const resident of initial.residents) {
    resident.hp = 0.5;
    resident.hunger = 0;
  }
  const food = initial.resources.food;
  const eating = assignSelection(initial, ["aki", "mio", "ren"], "eat");
  assert.equal(eating.error, undefined);
  assert.equal(eating.state.resources.food, food);
  assert.equal(availableResources(eating.state).food, food - 3);
  const finished = advance(deserialize(serialize(eating.state)), 15);
  assert.equal(finished.minutes, initial.minutes + 15);
  assert.equal(finished.resources.food, food - 3);
  for (const resident of finished.residents) {
    assert.equal(resident.hp, 0.5);
    assert.equal(resident.hunger, 55);
    assert.equal(resident.action, null);
    assert.equal(resident.suspended, null);
  }
  assert.deepEqual(deserialize(serialize(finished)), finished);
});

test("Cancelling or suspending an unfinished meal gives no food benefit and removes active starvation protection", () => {
  for (const mode of ["cancel", "pause"] as const) {
    let state = createGame(91);
    person(state).hp = 1;
    person(state).hunger = 0;
    const food = state.resources.food;
    state = advance(assign(state, "eat"), 5);
    assert.equal(person(state).hp, 1);
    assert.equal(person(state).hunger, 0);
    assert.equal(state.resources.food, food);
    const interrupted = command(state, { type: mode, residentId: "aki" });
    assert.equal(interrupted.error, undefined);
    state = advance(deserialize(serialize(interrupted.state)), 1);
    assert.ok(Math.abs(person(state).hp - 0.95) < 1e-8);
    assert.equal(person(state).hunger, 0);
    assert.equal(state.resources.food, food);
    assert.equal(availableResources(state).food, food - (mode === "pause" ? 1 : 0));
    assert.equal(person(state).action, null);
    assert.equal(person(state).suspended?.kind, mode === "pause" ? "eat" : undefined);
  }
});

test("An unconscious resident still cannot self-feed and rejects a mixed meal order atomically", () => {
  const state = createGame(92);
  person(state).hp = 0;
  person(state).hunger = 0;
  const before = serialize(state);
  const result = assignSelection(state, ["mio", "aki"], "eat");
  assert.match(result.error ?? "", /意識/);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
});
