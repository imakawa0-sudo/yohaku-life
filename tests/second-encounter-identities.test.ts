import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, advance, deserialize, serialize } from "../src/game/engine";
import { assignSelection } from "../src/game/selection";

test("New selection options cannot be discarded by a non-combat branch or duplicate-person normalization", () => {
  const s = createGame();
  s.residents.find(r => r.id === "ren")!.location = "ridge";
  const before = serialize(s);
  for (const result of [assignSelection(s, ["aki", "mio"], "socialize", undefined, "ridge-watch"),
    assignSelection(s, ["ren", "ren"], "approach-ridge")]) {
    assert.ok(result.error);
    assert.equal(result.state, s);
    assert.equal(serialize(s), before);
  }
});

// Controlled unit setup only: these locations/invalid JSON edits are not UI play evidence.
test("Second marked combat facts cannot reuse a current identity, a retained reference or another log", () => {
  let s = createGame();
  s.residents.find(r => r.id === "ren")!.location = "ridge";
  s = command(s, { type: "assign", residentIds: ["ren"], kind: "approach-ridge" }).state;
  s = advance(s, 20);
  s = command(s, { type: "assign", residentIds: ["ren"], kind: "attack", encounterId: "ridge-watch" }).state;
  s = advance(s, 1);
  assert.deepEqual(deserialize(serialize(s)), s);
  const current = structuredClone(s);
  current.logs.at(-1)!.id = current.residents.find(r => r.id === "ren")!.action!.id;
  assert.throws(() => deserialize(serialize(current)), /不正/);
  const duplicate = structuredClone(s);
  duplicate.logs.push(structuredClone(duplicate.logs.at(-1)!));
  assert.throws(() => deserialize(serialize(duplicate)), /不正/);
  const reference = structuredClone(s);
  const helper = reference.residents.find(r => r.id === "mio")!;
  helper.action = { id: reference.nextId++, kind: "help", label: "古い手伝い", progress: 0, duration: 10,
    target: "aki", targetActionId: reference.logs.at(-1)!.id, automatic: false, origin: "home" };
  assert.throws(() => deserialize(serialize(reference)), /不正/);
});
