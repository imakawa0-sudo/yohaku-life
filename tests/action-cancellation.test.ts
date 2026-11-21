import test from "node:test";
import assert from "node:assert/strict";
import {
  availableResources,
  command,
  createGame,
  deserialize,
  serialize,
} from "../src/game/engine.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (state: GameState) =>
  state.residents.find((resident) => resident.id === "mio")!;
function act(state: GameState, instruction: Command) {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function twoReservedJobs() {
  let state = act(createGame(2026), {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  state = act(state, { type: "assign", residentIds: ["mio"], kind: "eat" });
  assert.equal(person(state).suspended!.kind, "cook");
  assert.equal(person(state).action!.kind, "eat");
  return state;
}

test("Cancelling the suspended action by ID releases only its materials and preserves the active meal", () => {
  const state = twoReservedJobs();
  const before = serialize(state);
  const active = person(state).action!;
  const paused = person(state).suspended!;
  const next = act(state, {
    type: "cancel",
    residentId: "mio",
    actionId: paused.id,
  });
  assert.deepEqual(person(next).action, active);
  assert.equal(person(next).suspended, null);
  assert.equal(
    availableResources(next).ingredients,
    state.resources.ingredients,
  );
  assert.equal(availableResources(next).food, state.resources.food - 1);
  assert.deepEqual(
    next.resources,
    state.resources,
    "Cancelling a reservation does not consume inventory",
  );
  assert.equal(next.minutes, state.minutes);
  assert.equal(next.seed, state.seed);
  assert.equal(serialize(state), before);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Cancelling the active action by ID leaves the suspended cooking reservation intact", () => {
  const state = twoReservedJobs();
  const next = act(state, {
    type: "cancel",
    residentId: "mio",
    actionId: person(state).action!.id,
  });
  assert.equal(person(next).action, null);
  assert.deepEqual(person(next).suspended, person(state).suspended);
  assert.equal(
    availableResources(next).ingredients,
    state.resources.ingredients - 2,
  );
  assert.equal(availableResources(next).food, state.resources.food);
});

test("A stale action ID cannot silently cancel a different current or suspended job", () => {
  const state = act(twoReservedJobs(), {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  const before = serialize(state);
  for (const actionId of [999999, state.residents[0].action!.id]) {
    const result = command(state, {
      type: "cancel",
      residentId: "mio",
      actionId,
    });
    assert.ok(result.error);
    assert.strictEqual(result.state, state);
    assert.equal(serialize(result.state), before);
  }
  const pausedId = person(state).suspended!.id;
  const cancelled = act(state, {
    type: "cancel",
    residentId: "mio",
    actionId: pausedId,
  });
  const repeated = command(cancelled, {
    type: "cancel",
    residentId: "mio",
    actionId: pausedId,
  });
  assert.ok(repeated.error);
  assert.strictEqual(repeated.state, cancelled);
  assert.deepEqual(person(repeated.state).action, person(state).action);
});

test("Legacy cancellation without an ID keeps its active-first behavior and can then release the suspended job", () => {
  const state = twoReservedJobs();
  const first = act(state, { type: "cancel", residentId: "mio" });
  assert.equal(person(first).action, null);
  assert.deepEqual(person(first).suspended, person(state).suspended);
  const second = act(first, { type: "cancel", residentId: "mio" });
  assert.equal(person(second).suspended, null);
  assert.deepEqual(availableResources(second), second.resources);
});
