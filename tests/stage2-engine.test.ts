import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, previewTrade, serialize } from "../src/game/engine.ts";
import type { Command, GameState, ResidentRoutine } from "../src/game/types.ts";

const person = (s: GameState, id = "mio") => s.residents.find((r) => r.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function credited(): GameState {
  let s = createGame(872);
  for (const resident of s.residents) s = act(s, { type: "policy", residentId: resident.id, policy: "rest" });
  s = act(s, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "food", amount: 3 });
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "village", via: ["road", "meadow"] });
  for (let n = 0; n < 51; n++) s = advance(s, 1);
  assert.equal(person(s).location, "village");
  s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "talk" });
  return act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "deliver" });
}

test("Actual journey and invitation commands join once without changing the shared world clock or an absent job", () => {
  let s = credited();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  const before = structuredClone(s);
  s = act(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  assert.equal(s.residents.length, 4);
  assert.deepEqual([s.minutes, s.seed, s.nextId], [before.minutes, before.seed, before.nextId + 1]);
  assert.deepEqual(person(s, "aki").action, person(before, "aki").action);
  assert.deepEqual(s.resources, before.resources);
  assert.deepEqual(deserialize(serialize(s)), s);
  const replay = command(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  assert.ok(replay.error);
  assert.strictEqual(replay.state, s);
});

test("Routine edits preserve running and held work, reservations and random sequence, then roundtrip", () => {
  let s = createGame(592);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  s = advance(s, 5);
  s = act(s, { type: "pause", residentId: "mio" });
  const before = structuredClone(s);
  const routine: ResidentRoutine = { workRole: "gather", home: "garden", leisure: "quiet" };
  s = act(s, { type: "routine", residentId: "mio", routine });
  routine.workRole = "cook";
  assert.equal(person(s).routine?.workRole, "gather");
  const { routine: _old, ...oldPerson } = person(before);
  const { routine: _new, ...newPerson } = person(s);
  assert.deepEqual(newPerson, oldPerson);
  assert.deepEqual([s.minutes, s.seed, s.nextId, s.resources, s.logs], [before.minutes, before.seed, before.nextId, before.resources, before.logs]);
  assert.deepEqual(deserialize(serialize(s)), s);
  const ingredients = s.resources.ingredients, food = s.resources.food;
  s = act(s, { type: "resume", residentId: "mio" });
  const jobId = person(s).action!.id;
  for (let n = 0; n < 100 && person(s).action?.id === jobId; n++) s = advance(s, 1);
  assert.notEqual(person(s).action?.id, jobId);
  assert.equal(s.resources.ingredients, ingredients - 2);
  assert.equal(s.resources.food, food + 3);
});

test("Invalid or protagonist routine edits and unearned invitation commands return the original untouched state", () => {
  const s = createGame();
  const before = serialize(s);
  for (const cmd of [
    { type: "routine", residentId: "aki", routine: { workRole: "support", home: "home", leisure: "quiet" } },
    { type: "routine", residentId: "unknown", routine: { workRole: "cook", home: "home", leisure: "social" } },
    { type: "routine", residentId: "mio", routine: { workRole: "anything", home: "home", leisure: "social" } },
    { type: "routine", residentId: "mio", routine: null },
    { type: "recruit", residentId: "mio", npcId: "village-guide" },
  ]) {
    const result = command(s, cmd as Command);
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
    assert.equal(serialize(s), before);
  }
});

test("Migration initializes only missing profiles and rejects malformed saved roles and identities", () => {
  const old = credited(); old.version = 2;
  for (const resident of old.residents) { delete resident.routine; delete resident.wishKind; }
  const before = structuredClone(old);
  const loaded = deserialize(serialize(old));
  assert.equal(loaded.version, 3);
  assert.deepEqual(loaded.residents.map((r) => r.routine?.workRole), ["support", "cook", "gather"]);
  for (const key of ["minutes", "seed", "nextId", "resources", "inventory", "region", "logs", "life"] as const)
    assert.deepEqual(loaded[key], before[key]);
  for (const change of [
    (s: GameState) => { (person(s).routine as unknown as Record<string, unknown>).leisure = "random"; },
    (s: GameState) => { person(s).wishKind = "unknown" as never; },
    (s: GameState) => { person(s).joinedAt = 1; },
    (s: GameState) => { person(s).id = "invented"; },
  ]) {
    const invalid = structuredClone(loaded); change(invalid);
    assert.throws(() => deserialize(serialize(invalid)), /保存データ/);
  }
});

test("Merchant food warning accounts for a fourth household member", () => {
  let s = act(credited(), { type: "recruit", residentId: "mio", npcId: "village-guide" });
  s.minutes = 2159;
  for (const resident of s.residents) {
    resident.location = "home"; resident.policy = "rest"; resident.hp = resident.hunger = resident.energy = 100;
  }
  s.resources.food = 5; s.resources.ingredients = 0;
  s = advance(s, 1);
  const preview = previewTrade(s, ["aki"], s.trade!.visit!.id, "meal-for-scrap");
  assert.equal(preview.after?.food, 3);
  assert.match(preview.warning!, /4人分/);
});
