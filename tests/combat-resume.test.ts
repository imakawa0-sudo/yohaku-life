import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, command, deserialize, serialize, getCombatants } from "../src/game/engine";
import type { Command, GameState } from "../src/game/types";

const person = (s: GameState, id: string) => s.residents.find(r => r.id === id)!;
const act = (s: GameState, cmd: Command) => {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, JSON.stringify(cmd) + ": " + result.error);
  return result.state;
};
function until(s: GameState, done: (s: GameState) => boolean, limit = 500) {
  for (let i = 0; i < limit && !done(s); i++) {
    s = advance(s, 1);
    assert.equal(s.ended, false);
  }
  assert(done(s));
  return s;
}
const travel = (s: GameState, id: string, to: string) => until(
  act(s, { type: "assign", residentIds: [id], kind: "move", target: to }),
  next => person(next, id).location === to && person(next, id).action === null,
);

for (const kind of ["attack", "defend"] as const) {
  test(`A held ${kind} rechecks its opponent and keeps the original state when battle has ended`, () => {
    let s = deserialize(readFileSync(new URL("./fixtures/guard-agreement-genuine-home-1920-v3.json", import.meta.url), "utf8"));
    s = act(s, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "food", amount: 3 });
    s = travel(s, "mio", "ruins");
    s = act(s, { type: "assign", residentIds: ["mio"], kind });
    s = advance(s, 1);
    s = act(s, { type: "pause", residentId: "mio" });
    s = deserialize(serialize(s));
    const held = structuredClone(person(s, "mio").suspended)!;
    assert.equal(held.progress, 1);

    // A live target still permits the original job to continue after loading.
    const live = act(s, { type: "resume", residentId: "mio" });
    assert.deepEqual(person(live, "mio").action, held);
    assert.equal(person(live, "mio").suspended, null);
    assert.equal(live.minutes, s.minutes);
    assert.equal(live.nextId, s.nextId);
    const progressed = advance(live, 1);
    assert.equal(progressed.minutes, live.minutes + 1);
    assert.equal(person(progressed, "mio").action?.id, held.id);
    if (kind === "attack") assert(progressed.enemy.hp < live.enemy.hp);
    else assert(person(progressed, "mio").hp < person(live, "mio").hp);

    // In a separate continuation, another resident resolves the real battle.
    s = travel(s, "mio", "home");
    const wrongPlace = command(s, { type: "resume", residentId: "mio" });
    assert.match(wrongPlace.error!, /場所/);
    assert.equal(wrongPlace.state, s);
    s = travel(s, "ren", "ruins");
    s = act(s, { type: "assign", residentIds: ["ren"], kind: "attack" });
    s = until(s, next => next.enemy.defeated, 30);
    const absentAtHome = command(s, { type: "resume", residentId: "mio" });
    assert.match(absentAtHome.error!, /相手/);
    assert.match(absentAtHome.error!, /取り消|取消/);
    assert.equal(absentAtHome.state, s);
    s = travel(s, "mio", "ruins");
    assert.deepEqual(person(s, "mio").suspended, held);
    s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
    s = deserialize(serialize(s));
    const before = serialize(s);
    const refused = command(s, { type: "resume", residentId: "mio" });
    assert.match(refused.error!, /相手/);
    assert.match(refused.error!, /取り消|取消/);
    assert.equal(refused.state, s);
    assert.equal(serialize(refused.state), before);
    assert.deepEqual(person(refused.state, "mio").suspended, held);
    assert.equal(getCombatants(refused.state).length, 0);

    // The player can explicitly discard just that order and continue home.
    s = act(s, { type: "cancel", residentId: "mio", actionId: held.id });
    assert.equal(person(s, "mio").suspended, null);
    s = travel(s, "mio", "home");
    assert.equal(person(s, "mio").action, null);
    assert.equal(person(s, "mio").suspended, null);
    assert.deepEqual(deserialize(serialize(s)), s);
  });
}
