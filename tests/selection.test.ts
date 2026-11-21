import test from "node:test";
import assert from "node:assert/strict";
import {
  availableResources,
  command,
  createGame,
  deserialize,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, GameState } from "../src/game/types.ts";

const resident = (state: GameState, id: string) =>
  state.residents.find((person) => person.id === id)!;
function rejectedWithoutMutation(
  state: GameState,
  ids: string[],
  kind: ActionKind,
  target?: string,
) {
  const before = serialize(state);
  const result = assignSelection(state, ids, kind, target);
  assert.ok(result.error, `${kind} should report why the selection cannot act`);
  assert.strictEqual(
    result.state,
    state,
    "A failed selection must return the original world",
  );
  assert.equal(
    serialize(state),
    before,
    "Failed selection must not mutate its input",
  );
  return result;
}
function acceptedWithoutTime(
  state: GameState,
  ids: string[],
  kind: ActionKind,
  target?: string,
) {
  const before = serialize(state);
  const result = assignSelection(state, ids, kind, target);
  assert.equal(result.error, undefined, result.error);
  assert.equal(
    result.state.minutes,
    state.minutes,
    "Selection only reserves actions; it does not run the world",
  );
  assert.equal(
    serialize(state),
    before,
    "A successful selection must not mutate its input",
  );
  assert.deepEqual(
    deserialize(serialize(result.state)),
    result.state,
    "Successful selections must remain saveable",
  );
  return result.state;
}

test("An empty or unknown selection is rejected without advancing or replacing the world", () => {
  const state = createGame(2026);
  rejectedWithoutMutation(state, [], "rest");
  rejectedWithoutMutation(state, ["missing-resident"], "rest");
});

for (const kind of ["eat", "rest", "hobby"] as const) {
  test(`${kind} queues exactly the chosen residents and leaves an unselected protagonist alone`, () => {
    const state = createGame(2026);
    const next = acceptedWithoutTime(state, ["mio", "ren"], kind);
    assert.equal(resident(next, "mio").action?.kind, kind);
    assert.equal(resident(next, "ren").action?.kind, kind);
    assert.equal(resident(next, "aki").action, null);
    assert.equal(resident(next, "aki").suspended, null);
    if (kind === "eat") {
      assert.equal(
        next.resources.food,
        state.resources.food,
        "Queued meals reserve rather than consume food",
      );
      assert.equal(availableResources(next).food, state.resources.food - 2);
    }
  });
}

for (const kind of ["attack", "defend"] as const) {
  test(`${kind} gives tactical orders to every selected resident without ticking combat`, () => {
    const state = createGame(2026);
    resident(state, "mio").location = "ruins";
    resident(state, "ren").location = "ruins";
    const next = acceptedWithoutTime(state, ["mio", "ren"], kind);
    assert.equal(resident(next, "mio").action?.kind, kind);
    assert.equal(resident(next, "ren").action?.kind, kind);
    assert.equal(resident(next, "aki").action, null);
    assert.equal(next.enemy.hp, state.enemy.hp);
    assert.equal(resident(next, "mio").hp, 100);
    assert.equal(resident(next, "ren").hp, 100);
  });
}

test("Garden gathering is assigned to all selected gatherers without an implicit move for a spectator", () => {
  const state = createGame(2026);
  resident(state, "aki").location = "garden";
  resident(state, "ren").location = "garden";
  const next = acceptedWithoutTime(state, ["aki", "ren"], "gather");
  assert.equal(resident(next, "aki").action?.kind, "gather");
  assert.equal(resident(next, "ren").action?.kind, "gather");
  assert.equal(resident(next, "mio").action, null);
  assert.equal(resident(next, "mio").location, "home");
  assert.deepEqual(next.resources, state.resources);
});

for (const kind of ["cook", "decorate"] as const) {
  test(`${kind} requires one selected worker and does not silently choose a representative`, () => {
    const state = createGame(2026);
    rejectedWithoutMutation(state, [], kind);
    rejectedWithoutMutation(state, ["mio", "ren"], kind);
    const next = acceptedWithoutTime(state, ["mio"], kind);
    assert.equal(resident(next, "mio").action?.kind, kind);
    assert.equal(resident(next, "aki").action, null);
    assert.equal(resident(next, "ren").action, null);
  });
}

test("Healing requires a single selected caregiver and preserves the explicit target", () => {
  const state = createGame(2026);
  resident(state, "aki").hp = 35;
  rejectedWithoutMutation(state, ["mio", "ren"], "heal", "aki");
  const next = acceptedWithoutTime(state, ["mio"], "heal", "aki");
  assert.equal(resident(next, "mio").action?.kind, "heal");
  assert.equal(resident(next, "mio").action?.target, "aki");
  assert.equal(resident(next, "ren").action, null);
  assert.equal(resident(next, "aki").action, null);
  assert.equal(availableResources(next).medicine, state.resources.medicine - 1);
});

test("Helping work requires one selected helper instead of giving several actors the same target implicitly", () => {
  let state = createGame(2026);
  const cooking = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  assert.equal(cooking.error, undefined);
  state = cooking.state;
  rejectedWithoutMutation(state, ["aki", "ren"], "help", "mio");
  const next = acceptedWithoutTime(state, ["ren"], "help", "mio");
  assert.equal(resident(next, "ren").action?.kind, "help");
  assert.equal(resident(next, "ren").action?.target, "mio");
  assert.deepEqual(resident(next, "mio").action, resident(state, "mio").action);
  assert.equal(resident(next, "aki").action, null);
});

test("Rescue requires one selected carrier and never assigns the patient or an unselected actor", () => {
  const state = createGame(2026);
  for (const person of state.residents) person.location = "road";
  resident(state, "aki").hp = 20;
  rejectedWithoutMutation(state, ["mio", "ren"], "rescue", "aki");
  const next = acceptedWithoutTime(state, ["ren"], "rescue", "aki");
  assert.equal(resident(next, "ren").action?.kind, "rescue");
  assert.equal(resident(next, "ren").action?.target, "aki");
  assert.equal(resident(next, "aki").action, null);
  assert.equal(resident(next, "mio").action, null);
});

test("Socializing needs at least two selected people; a target outside the selection cannot substitute", () => {
  const state = createGame(2026);
  rejectedWithoutMutation(state, ["aki"], "socialize");
  rejectedWithoutMutation(state, ["aki"], "socialize", "mio");
});

test("Two selected residents socialize with each other while the third keeps their own action", () => {
  let state = createGame(2026);
  const resting = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  assert.equal(resting.error, undefined);
  state = resting.state;
  const next = acceptedWithoutTime(state, ["mio", "ren"], "socialize");
  assert.equal(resident(next, "mio").action?.kind, "socialize");
  assert.equal(resident(next, "mio").action?.target, "ren");
  assert.equal(resident(next, "ren").action?.kind, "socialize");
  assert.equal(resident(next, "ren").action?.target, "mio");
  assert.deepEqual(resident(next, "aki").action, resident(state, "aki").action);
});

test("A larger selected conversation gives every participant another selected partner in circular order", () => {
  const state = createGame(2026);
  const ids = ["ren", "aki", "mio"];
  const next = acceptedWithoutTime(state, ids, "socialize");
  ids.forEach((id, index) => {
    const action = resident(next, id).action;
    assert.equal(action?.kind, "socialize");
    assert.equal(action?.target, ids[(index + 1) % ids.length]);
    assert.notEqual(action?.target, id);
  });
});

test("Mixed-location conversation rolls back earlier reservations and preserves previous explicit jobs", () => {
  let state = createGame(2026);
  resident(state, "ren").location = "road";
  const working = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  assert.equal(working.error, undefined);
  state = working.state;
  rejectedWithoutMutation(state, ["aki", "mio", "ren"], "socialize");
  assert.equal(resident(state, "aki").action?.kind, "hobby");
  assert.equal(resident(state, "aki").suspended, null);
});

test("Insufficient group meals cannot partly reserve food or suspend only the first selected resident", () => {
  let state = createGame(2026);
  state.resources.food = 1;
  const working = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  assert.equal(working.error, undefined);
  state = working.state;
  rejectedWithoutMutation(state, ["aki", "mio"], "eat");
  assert.equal(resident(state, "aki").action?.kind, "hobby");
  assert.equal(resident(state, "aki").suspended, null);
  assert.equal(availableResources(state).food, 1);
});

test("A mixed movement selection leaves already-arrived people and their jobs untouched", () => {
  let state = createGame(2026);
  resident(state, "ren").location = "road";
  const working = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  assert.equal(working.error, undefined);
  state = working.state;
  const next = acceptedWithoutTime(state, ["aki", "ren"], "move", "home");
  assert.deepEqual(resident(next, "aki"), resident(state, "aki"));
  assert.equal(resident(next, "ren").action?.kind, "move");
  assert.equal(resident(next, "ren").action?.target, "home");
  assert.equal(resident(next, "mio").action, null);
  assert.equal(
    resident(next, "ren").location,
    "road",
    "Movement must wait for the shared-clock advance",
  );
});

test("Movement reports when the whole selection is already at the destination without cancelling their jobs", () => {
  let state = createGame(2026);
  const working = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  assert.equal(working.error, undefined);
  state = working.state;
  rejectedWithoutMutation(state, ["aki", "mio", "ren"], "move", "home");
  rejectedWithoutMutation(state, ["ren"], "move", "missing-place");
  assert.equal(resident(state, "mio").action?.kind, "cook");
});

test("An incapacitated selected actor makes a group command fail atomically while healthy companions remain controllable", () => {
  const state = createGame(2026);
  resident(state, "aki").hp = 0;
  rejectedWithoutMutation(state, ["mio", "aki"], "hobby");
  const next = acceptedWithoutTime(state, ["mio", "ren"], "hobby");
  assert.equal(resident(next, "mio").action?.kind, "hobby");
  assert.equal(resident(next, "ren").action?.kind, "hobby");
  assert.equal(resident(next, "aki").action, null);
});
