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

function quiet(seed = 20261120): GameState {
  let state = createGame(seed);
  for (const resident of state.residents)
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  return state;
}

function relations(state: GameState) {
  return structuredClone({
    aki: person(state).relations.mio,
    mio: person(state, "mio").relations.aki,
  });
}

const helpEvents = (state: GameState) =>
  state.life?.events.filter((event) => event.kind === "help") ?? [];

test("A helper whose original work finishes cannot speed up the worker's new meal or receive false shared experience", () => {
  let state = advance(assign(quiet(30), "hobby"), 40);
  const hobbyId = person(state).action!.id;
  state = assign(state, "help", "mio", "aki");
  assert.equal(person(state, "mio").action?.targetActionId, hobbyId);
  state = advance(state, 5);
  assert.equal(person(state).action, null);
  assert.equal(person(state, "mio").action?.progress, 5);
  // The referenced action is no longer active. This is a legitimate save,
  // because finishing the original task does not erase the helper's interval.
  state = deserialize(serialize(state));
  const beforeRelations = relations(state);
  const food = state.resources.food;
  state = assign(state, "eat");
  const mealId = person(state).action!.id;
  assert.notEqual(mealId, hobbyId);
  state = advance(state, 5);
  assert.equal(person(state).action?.id, mealId);
  assert.equal(person(state).action?.progress, 5);
  assert.equal(person(state, "mio").action, null);
  assert.equal(state.resources.food, food);
  assert.deepEqual(relations(state), beforeRelations);
  assert.equal(helpEvents(state).length, 0);
  assert.equal(state.logs.some((entry) => entry.title === "二人で進める仕事"), false);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Cancelling work cannot transfer an existing helper to a new project with the same recipe", () => {
  let state = assign(quiet(31), "project", "aki", "wood-flower");
  const originalId = person(state).action!.id;
  state = assign(state, "help", "mio", "aki");
  state = advance(state, 3);
  state = act(state, { type: "cancel", residentId: "aki", actionId: originalId });
  assert.equal(availableResources(state).scrap, state.resources.scrap);
  state = assign(state, "project", "aki", "wood-flower");
  const replacementId = person(state).action!.id;
  assert.notEqual(replacementId, originalId);
  const beforeRelations = relations(state);
  state = advance(deserialize(serialize(state)), 7);
  assert.equal(person(state).action?.id, replacementId);
  assert.equal(person(state).action?.progress, 7);
  assert.deepEqual(relations(state), beforeRelations);
  assert.equal(helpEvents(state).length, 0);
  assert.equal(state.life!.crafts.length, 0);
});

test("Saved interrupted help still advances the same resumed project and awards one real shared experience", () => {
  let state = assign(quiet(32), "project", "aki", "kitchen-tools");
  const projectId = person(state).action!.id;
  state = assign(state, "help", "mio", "aki");
  const helperId = person(state, "mio").action!.id;
  state = advance(state, 3);
  state = act(state, { type: "pause", residentId: "mio" });
  state = act(state, { type: "pause", residentId: "aki" });
  state = deserialize(serialize(state));
  assert.equal(person(state, "mio").suspended?.targetActionId, projectId);
  state = act(state, { type: "resume", residentId: "aki" });
  state = act(state, { type: "resume", residentId: "mio" });
  assert.equal(person(state, "mio").action?.id, helperId);
  assert.equal(person(state, "mio").action?.targetActionId, projectId);
  const beforeRelations = relations(state);
  state = advance(state, 7);
  assert.equal(person(state).action?.id, projectId);
  assert.equal(person(state).action?.progress, 22);
  assert.equal(person(state, "mio").action, null);
  assert.ok(person(state).relations.mio.trust > beforeRelations.aki.trust);
  assert.ok(person(state, "mio").relations.aki.trust > beforeRelations.mio.trust);
  assert.equal(helpEvents(state).length, 1);
  assert.deepEqual(helpEvents(state)[0].actors, ["mio"]);
  assert.equal(helpEvents(state)[0].subjectId, "aki");
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Resuming paused help never silently binds it to replacement work", () => {
  let state = assign(quiet(33), "hobby");
  const originalId = person(state).action!.id;
  state = assign(state, "help", "mio", "aki");
  state = advance(state, 3);
  state = act(state, { type: "pause", residentId: "mio" });
  state = act(state, { type: "cancel", residentId: "aki", actionId: originalId });
  state = assign(state, "hobby");
  const replacementId = person(state).action!.id;
  state = deserialize(serialize(state));
  const before = serialize(state);
  const result = command(state, { type: "resume", residentId: "mio" });
  assert.match(result.error ?? "", /作業|仕事|対象/);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
  assert.equal(person(state, "mio").suspended?.targetActionId, originalId);
  assert.equal(person(state).action?.id, replacementId);
  assert.equal(helpEvents(state).length, 0);
});

test("Legacy help without a recorded target action remains loadable but cannot accelerate an ambiguous job", () => {
  let state = assign(quiet(34), "project", "aki", "kitchen-tools");
  state = assign(state, "help", "mio", "aki");
  state = advance(state, 2);
  const activeLegacy = structuredClone(state);
  delete person(activeLegacy, "mio").action!.targetActionId;
  const activeRestored = deserialize(serialize(activeLegacy));
  const activeRelations = relations(activeRestored);
  const ended = advance(activeRestored, 8);
  assert.equal(person(ended).action?.progress, 10);
  assert.equal(person(ended, "mio").action, null);
  assert.deepEqual(relations(ended), activeRelations);
  assert.equal(helpEvents(ended).length, 0);

  state = act(state, { type: "pause", residentId: "mio" });
  delete person(state, "mio").suspended!.targetActionId;
  state = deserialize(serialize(state));
  const beforeRelations = relations(state);
  const before = serialize(state);
  const resumed = command(state, { type: "resume", residentId: "mio" });
  assert.match(resumed.error ?? "", /特定|取消|取り消/);
  assert.strictEqual(resumed.state, state);
  assert.equal(serialize(state), before);
  assert.equal(person(state, "mio").suspended?.targetActionId, undefined);
  assert.deepEqual(relations(state), beforeRelations);
  assert.equal(helpEvents(state).length, 0);
  assert.deepEqual(deserialize(serialize(state)), state);
});
