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
import type { Command, GameState } from "../src/game/types.ts";

function person(state: GameState, id = "aki") {
  return state.residents.find((resident) => resident.id === id)!;
}
function act(state: GameState, instruction: Command) {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function toggle(state: GameState, enabled = true) {
  return act(state, { type: "auto-combat", enabled });
}
function encounter(ids = ["aki"], seed = 20261119) {
  const state = createGame(seed);
  for (const id of ids) person(state, id).location = "ruins";
  return state;
}

test("Automatic battle is off by default and toggling does not consume time or random numbers", () => {
  const original = encounter();
  const snapshot = serialize(original);
  assert.equal(original.autoCombat, false);
  const enabled = toggle(original);
  assert.equal(enabled.autoCombat, true);
  assert.equal(enabled.minutes, original.minutes);
  assert.equal(enabled.seed, original.seed);
  assert.equal(
    person(enabled).action,
    null,
    "No battle runs until time is advanced",
  );
  assert.equal(
    serialize(original),
    snapshot,
    "Commands do not mutate their input",
  );
  const disabled = toggle(enabled, false);
  assert.equal(disabled.autoCombat, false);
  assert.equal(disabled.minutes, original.minutes);
  assert.equal(disabled.seed, original.seed);
});

test("A solo free resident attacks automatically only when a manual minute is advanced", () => {
  const state = toggle(encounter());
  const next = advance(state, 1);
  assert.equal(next.minutes, state.minutes + 1);
  assert.ok(next.enemy.hp < state.enemy.hp);
  assert.equal(person(next).action?.kind, "attack");
  assert.equal(person(next).action?.automatic, true);
  assert.equal(person(state).action, null);
});

test("A group gives its strongest effective health to defence and everyone else to attack", () => {
  const state = toggle(encounter(["aki", "mio", "ren"]));
  const next = advance(state, 1);
  assert.equal(person(next, "ren").action?.kind, "defend");
  assert.equal(person(next, "aki").action?.kind, "attack");
  assert.equal(person(next, "mio").action?.kind, "attack");
  assert.ok(
    next.residents
      .filter((resident) => resident.location === "ruins")
      .every((resident) => resident.action?.automatic),
  );
  assert.equal(
    person(next, "aki").hp,
    100,
    "The defender takes the incoming hit",
  );
  assert.equal(person(next, "mio").hp, 100);
  assert.ok(
    person(next, "ren").hp >= 95,
    "Defence and armour reduce real damage",
  );
});

test("Defender choice uses health and armour with a stable resident-id tie break", () => {
  let state = encounter(["aki", "mio", "ren"]);
  person(state, "ren").hp = 30;
  state = advance(toggle(state), 1);
  assert.equal(person(state, "aki").action?.kind, "defend");
  assert.equal(person(state, "mio").action?.kind, "attack");
  assert.equal(person(state, "ren").action?.kind, "attack");
});

test("An eligible automatic defender keeps the role instead of swapping after each small hit", () => {
  let state = encounter(["aki", "ren"]);
  person(state, "ren").hp = 66;
  state = advance(toggle(state), 1);
  assert.equal(person(state, "ren").action?.kind, "defend");
  const defenderId = person(state, "ren").action!.id;
  assert.ok(person(state, "ren").hp / 0.65 < person(state).hp);
  state = advance(state, 1);
  assert.equal(person(state, "ren").action?.kind, "defend");
  assert.equal(person(state, "ren").action?.id, defenderId);
  assert.equal(person(state).action?.kind, "attack");
});

test("An explicit defender stays in charge and free companions attack", () => {
  let state = toggle(encounter(["aki", "mio", "ren"]));
  state = act(state, { type: "assign", residentIds: ["mio"], kind: "defend" });
  const manualId = person(state, "mio").action!.id;
  state = advance(state, 1);
  assert.equal(person(state, "mio").action?.id, manualId);
  assert.equal(person(state, "mio").action?.automatic, false);
  assert.equal(person(state, "ren").action?.kind, "attack");
  assert.equal(person(state, "aki").action?.kind, "attack");
});

test("A manual attack overrides an automatic defender and remains explicit", () => {
  let state = advance(toggle(encounter(["aki", "ren"])), 1);
  assert.equal(person(state, "ren").action?.kind, "defend");
  state = act(state, { type: "assign", residentIds: ["ren"], kind: "attack" });
  const manualId = person(state, "ren").action!.id;
  state = advance(state, 1);
  assert.equal(person(state, "ren").action?.id, manualId);
  assert.equal(person(state, "ren").action?.kind, "attack");
  assert.equal(person(state, "ren").action?.automatic, false);
  assert.equal(person(state, "aki").action?.kind, "defend");
});

test("Pausing an explicit battle order keeps that resident paused while automatic battle stays on", () => {
  for (const kind of ["attack", "defend"] as const) {
    let state = toggle(encounter(["aki", "ren"]));
    state = act(state, { type: "assign", residentIds: ["aki"], kind });
    const manualId = person(state).action!.id;
    state = act(state, { type: "pause", residentId: "aki" });
    state = advance(state, 1);
    assert.equal(person(state).action, null);
    assert.equal(person(state).suspended?.id, manualId);
    assert.equal(person(state).suspended?.automatic, false);
    assert.equal(person(state, "ren").action?.kind, "attack");
    state = act(state, { type: "resume", residentId: "aki" });
    state = advance(state, 1);
    assert.equal(person(state).action?.id, manualId);
    assert.equal(person(state).action?.kind, kind);
    assert.equal(person(state).action?.automatic, false);
  }
});

test("Contact still pauses before the first strike, with automatic orders prepared", () => {
  let state = toggle(createGame());
  state = act(state, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "move",
    target: "ruins",
  });
  const before = state.minutes;
  state = advance(state, 60);
  assert.ok(state.pauseReason?.includes("遭遇"));
  assert.equal(state.minutes - before, 23);
  assert.equal(state.enemy.hp, 80);
  assert.equal(person(state).hp, 100);
  assert.equal(person(state, "ren").hp, 100);
  assert.equal(person(state).action?.kind, "attack");
  assert.equal(person(state, "ren").action?.kind, "defend");
});

test("Manual retreat replaces automatic battle even when interrupted cooking is reserved", () => {
  let state = createGame();
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "cook" });
  state = advance(state, 5);
  state = act(state, { type: "pause", residentId: "aki" });
  const cooking = structuredClone(person(state).suspended);
  state = toggle(state);
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "ruins",
  });
  state = advance(state, 60);
  assert.equal(person(state).action?.kind, "attack");
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "home",
  });
  const movementId = person(state).action!.id;
  state = advance(state, 1);
  assert.equal(person(state).action?.kind, "move");
  assert.equal(person(state).action?.id, movementId);
  assert.equal(person(state).action?.automatic, false);
  assert.deepEqual(person(state).suspended, cooking);
  assert.equal(
    availableResources(state).ingredients,
    state.resources.ingredients - 2,
  );
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A manually assigned collection job is not interrupted or replaced by automatic battle", () => {
  let state = toggle(encounter(["aki", "ren"]));
  // Reserve the direct work while its place is clear, then use a controlled
  // enemy return to test battle priority without bypassing the gather guard.
  state.enemy.location = "road";
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "gather" });
  const gathering = person(state).action!.id;
  state.enemy.location = "ruins";
  state = advance(state, 1);
  assert.equal(person(state).action?.id, gathering);
  assert.equal(person(state).action?.kind, "gather");
  assert.equal(person(state).action?.automatic, false);
  assert.equal(person(state, "ren").action?.kind, "attack");
  assert.ok(
    state.enemy.hp < 80,
    "The only free actor attacks instead of defending forever beside a busy gatherer",
  );
});

test("A conscious rescue patient and the manually commanded carrier never receive AI orders", () => {
  let state = encounter(["aki", "ren"]);
  person(state).hp = 20;
  state = toggle(state);
  state = act(state, {
    type: "assign",
    residentIds: ["ren"],
    kind: "rescue",
    target: "aki",
  });
  const rescueId = person(state, "ren").action!.id;
  state = advance(state, 1);
  assert.equal(person(state).action, null);
  assert.equal(person(state, "ren").action?.id, rescueId);
  assert.equal(person(state, "ren").action?.kind, "rescue");
  assert.equal(person(state, "ren").action?.automatic, false);
  assert.equal(state.enemy.hp, 80);
});

test("Unconscious residents and moving actors do not receive automatic battle orders", () => {
  let state = encounter(["aki", "ren"]);
  person(state).hp = 0;
  state = toggle(state);
  state = act(state, {
    type: "assign",
    residentIds: ["ren"],
    kind: "move",
    target: "home",
  });
  const movementId = person(state, "ren").action!.id;
  state = advance(state, 1);
  assert.equal(person(state).action, null);
  assert.equal(person(state, "ren").action?.id, movementId);
  assert.equal(person(state, "ren").action?.kind, "move");
  assert.equal(state.enemy.hp, 80);
});

test("Switching off clears automatic battle but preserves explicit orders and suspended old work", () => {
  let state = createGame();
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "cook" });
  state = advance(state, 5);
  state = act(state, { type: "pause", residentId: "aki" });
  const cooking = structuredClone(person(state).suspended);
  person(state).location = "ruins";
  person(state, "ren").location = "ruins";
  state = toggle(state);
  state = act(state, { type: "assign", residentIds: ["ren"], kind: "defend" });
  state = advance(state, 1);
  const manualDefence = structuredClone(person(state, "ren").action);
  const minutes = state.minutes;
  const seed = state.seed;
  state = toggle(state, false);
  assert.equal(person(state).action, null);
  assert.deepEqual(person(state).suspended, cooking);
  assert.deepEqual(person(state, "ren").action, manualDefence);
  assert.equal(state.minutes, minutes);
  assert.equal(state.seed, seed);
  assert.equal(
    availableResources(state).ingredients,
    state.resources.ingredients - 2,
  );
});

test("Automatic battle cleans up after victory without resuming interrupted work", () => {
  let state = toggle(encounter(["aki", "mio", "ren"]));
  state = advance(state, 30);
  assert.equal(state.enemy.defeated, true);
  assert.ok(state.pauseReason?.includes("退き"));
  for (const resident of state.residents) assert.equal(resident.action, null);
  assert.equal(
    state.autoCombat,
    true,
    "The preference stays enabled for later encounters",
  );
});

test("Automatic roles and battle results reproduce exactly across save/load with the same seed", () => {
  const state = toggle(encounter(["aki", "mio", "ren"], 123456));
  const loaded = deserialize(serialize(state));
  assert.deepEqual(advance(state, 3), advance(loaded, 3));
  const first = advance(state, 1);
  assert.deepEqual(
    advance(first, 2),
    advance(deserialize(serialize(first)), 2),
  );
});

test("Old version-1 saves keep battle off, while present malformed automatic battle flags are rejected", () => {
  const state = encounter();
  const oldSave = structuredClone(state);
  delete oldSave.autoCombat;
  const loaded = deserialize(serialize(oldSave));
  assert.equal(loaded.autoCombat ?? false, false);
  const next = advance(loaded, 1);
  assert.equal(next.enemy.hp, state.enemy.hp);
  assert.equal(person(next).action, null);
  for (const flag of ["true", 1, null, {}, []]) {
    const invalid = { ...state, autoCombat: flag };
    assert.throws(() => deserialize(JSON.stringify(invalid)), /不正/);
  }
});
