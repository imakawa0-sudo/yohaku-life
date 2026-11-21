import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, advance, deserialize, serialize } from "../src/game/engine";
import type { ActionKind, GameState } from "../src/game/types";

// Controlled codec boundaries. Location and invalid JSON edits are not genuine UI play.
const person = (s: GameState) => s.residents.find(r => r.id === "ren")!;
function current(kind: "attack" | "defend"): GameState {
  let s = createGame();
  person(s).location = "ridge";
  let result = command(s, { type: "assign", residentIds: ["ren"], kind: "approach-ridge" });
  assert.equal(result.error, undefined);
  s = advance(result.state, 20);
  result = command(s, { type: "assign", residentIds: ["ren"], kind, encounterId: "ridge-watch" });
  assert.equal(result.error, undefined);
  assert.deepEqual(deserialize(serialize(result.state)), result.state);
  return result.state;
}
function held(s: GameState): GameState {
  const result = command(s, { type: "pause", residentId: "ren" });
  assert.equal(result.error, undefined);
  assert.equal(person(result.state).action, null);
  assert.ok(person(result.state).suspended);
  return result.state;
}

test("Second current attack/defend cannot load at Home, while the same held jobs can", () => {
  for (const kind of ["attack", "defend"] as const) {
    const live = current(kind), invalid = structuredClone(live);
    person(invalid).location = "home";
    assert.throws(() => deserialize(serialize(invalid)), /保存データ.*不正/);
    const paused = held(live);
    person(paused).location = "home";
    assert.deepEqual(deserialize(serialize(paused)), paused);
    const eating = command(paused, { type: "assign", residentIds: ["ren"], kind: "eat" });
    assert.equal(eating.error, undefined);
    assert.deepEqual(deserialize(serialize(eating.state)), eating.state);
  }
});

test("Second current attack/defend cannot load after retirement, while held jobs remain", () => {
  for (const kind of ["attack", "defend"] as const) {
    const live = current(kind), invalid = structuredClone(live);
    invalid.secondaryEncounter!.hp = 18;
    invalid.secondaryEncounter!.defeated = true;
    assert.throws(() => deserialize(serialize(invalid)), /保存データ.*不正/);
    const paused = held(live);
    paused.secondaryEncounter!.hp = 18;
    paused.secondaryEncounter!.defeated = true;
    assert.deepEqual(deserialize(serialize(paused)), paused);
  }
});

test("Old missing-first current ghosts retain their existing reader compatibility", () => {
  for (const kind of ["attack", "defend"] as const) for (const version4 of [false, true]) {
    let s = version4 ? current("attack") : createGame();
    if (version4) s = command(s, { type: "cancel", residentId: "ren" }).state;
    person(s).location = "ruins";
    const result = command(s, { type: "assign", residentIds: ["ren"], kind: kind as ActionKind });
    assert.equal(result.error, undefined);
    const legacy = result.state;
    person(legacy).location = "home";
    legacy.enemy.hp = 18;
    legacy.enemy.defeated = true;
    assert.equal(person(legacy).action!.encounterId, undefined);
    assert.deepEqual(deserialize(serialize(legacy)), legacy);
  }
});
