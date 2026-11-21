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

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function heal(state: GameState, healer = "aki"): GameState {
  return act(state, { type: "assign", residentIds: [healer], kind: "heal", target: "aki" });
}
function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let minute = 0; minute < 200; minute++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The real action did not complete");
}

/** Actual combat and travel produce the injury; no body, resource or action is fabricated. */
function returnedFromCombat(): GameState {
  let state = createGame(20261120);
  for (const resident of state.residents) state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  state = finish(act(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "ruins" }));
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "defend" });
  for (let hits = 0; person(state).hp > 40 && hits < 25; hits++) state = advance(state, 1);
  assert.ok(person(state).hp > 0 && person(state).hp <= 40);
  state = finish(act(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" }));
  assert.equal(person(state).location, "home");
  assert.equal(person(state).hp, 24);
  assert.deepEqual(person(state).wounds, { arm: 0, leg: 2, body: 2 });
  return state;
}

test("A real self-treatment writes one unique actor and applies medicine, recovery and memories once", () => {
  const before = returnedFromCombat();
  const original = serialize(before);
  const relations = structuredClone(before.residents.map((resident) => resident.relations));
  let state = heal(before);
  assert.equal(serialize(before), original);
  assert.equal(state.minutes, before.minutes);
  assert.equal(state.seed, before.seed);
  assert.equal(state.resources.medicine, before.resources.medicine);
  assert.equal(availableResources(state).medicine, before.resources.medicine - 1);
  assert.deepEqual(person(state).action?.reserved, { medicine: 1 });
  state = finish(state);
  assert.equal(state.minutes, before.minutes + 20);
  assert.equal(person(state).hp, 69);
  assert.deepEqual(person(state).wounds, { arm: 0, leg: 0, body: 0 });
  assert.equal(state.resources.medicine, before.resources.medicine - 1);
  assert.equal(availableResources(state).medicine, state.resources.medicine);
  const logs = state.logs.filter((log) => log.title === "傷の手当");
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].actors, ["aki"]);
  const experiences = state.life!.events.filter((event) => event.kind === "heal");
  assert.equal(experiences.length, 1);
  assert.deepEqual(experiences[0].actors, ["aki"]);
  assert.equal(experiences[0].subjectId, "aki");
  assert.deepEqual(state.residents.map((resident) => resident.relations), relations);
  for (const id of logs[0].witnesses) assert.equal(person(state, id).memories.length, person(before, id).memories.length + 1);
  const after = deserialize(serialize(state));
  assert.deepEqual(advance(after, 0), state);
  assert.deepEqual(advance(after, 1).resources, state.resources);
});

test("An accepted old duplicate-actor save stays byte-for-byte intact while only later treatment logs become unique", () => {
  let legacy = finish(heal(returnedFromCombat()));
  const oldLog = legacy.logs.find((log) => log.title === "傷の手当")!;
  // Reproduce the actual previous writer's [healer, patient] shape for self-treatment.
  oldLog.actors = ["aki", "aki"];
  const oldId = oldLog.id;
  const saved = serialize(legacy);
  const oldLogs = structuredClone(legacy.logs);
  const imported = deserialize(saved);
  assert.equal(serialize(imported), saved);
  assert.deepEqual(imported, legacy);
  assert.equal(serialize(advance(imported, 0)), saved);
  const medicine = imported.resources.medicine;
  const completed = finish(heal(imported));
  assert.equal(serialize(imported), saved);
  assert.deepEqual(completed.logs.slice(0, oldLogs.length), oldLogs);
  assert.deepEqual(completed.logs.find((log) => log.id === oldId)?.actors, ["aki", "aki"]);
  const newLogs = completed.logs.filter((log) => log.title === "傷の手当" && log.id !== oldId);
  assert.equal(newLogs.length, 1);
  assert.deepEqual(newLogs[0].actors, ["aki"]);
  assert.equal(completed.resources.medicine, medicine - 1);
  assert.deepEqual(finish(heal(deserialize(saved))), completed);
  const resaved = serialize(completed);
  assert.equal(serialize(deserialize(resaved)), resaved);
});

test("Another healer's actor order remains healer then patient, with one actual treatment and one memory per witness", () => {
  const before = returnedFromCombat();
  const patientBond = { ...person(before).relations.ren };
  const healerBond = { ...person(before, "ren").relations.aki };
  const state = finish(heal(before, "ren"), "ren");
  const log = state.logs.find((entry) => entry.title === "傷の手当")!;
  assert.deepEqual(log.actors, ["ren", "aki"], "Actor order is initial appearance, not ID sorting");
  assert.equal(new Set(log.actors).size, log.actors.length);
  assert.equal(person(state).hp, person(before).hp + 45);
  assert.equal(state.resources.medicine, before.resources.medicine - 1);
  assert.deepEqual(person(state).relations.ren, { closeness: patientBond.closeness + 3, trust: patientBond.trust + 7 });
  assert.deepEqual(person(state, "ren").relations.aki, healerBond);
  for (const id of log.witnesses) assert.equal(person(state, id).memories.length, person(before, id).memories.length + 1);
  const experience = state.life!.events.find((event) => event.kind === "heal")!;
  assert.deepEqual(experience.actors, ["ren"]);
  assert.equal(experience.subjectId, "aki");
  assert.deepEqual(deserialize(serialize(state)), state);
});
