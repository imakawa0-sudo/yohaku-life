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

function quietNight(seed: number): GameState {
  let state = createGame(seed);
  state.minutes = 1320;
  for (const resident of state.residents) {
    resident.hunger = 100;
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  }
  return state;
}

test("A conversation interrupted by the other person's sleep grants no invented response, relationship, or experience", () => {
  let state = assign(quietNight(60), "socialize", "aki", "mio");
  state = advance(state, 5);
  state = assign(state, "sleep", "mio");
  const before = structuredClone({
    akiMood: person(state).mood,
    mioMood: person(state, "mio").mood,
    akiRelation: person(state).relations.mio,
    mioRelation: person(state, "mio").relations.aki,
    akiMemories: person(state).memories,
    mioMemories: person(state, "mio").memories,
  });
  const logStart = state.logs.length;
  state = advance(deserialize(serialize(state)), 15);
  assert.equal(person(state).action, null);
  assert.equal(person(state, "mio").action?.kind, "sleep");
  assert.equal(person(state, "mio").action?.progress, 15);
  assert.equal(person(state).mood, before.akiMood);
  assert.equal(person(state, "mio").mood, before.mioMood);
  assert.deepEqual(person(state).relations.mio, before.akiRelation);
  assert.deepEqual(person(state, "mio").relations.aki, before.mioRelation);
  assert.deepEqual(person(state).memories, before.akiMemories);
  assert.deepEqual(person(state, "mio").memories, before.mioMemories);
  assert.equal(state.life!.events.some((event) => event.kind === "conversation"), false);
  const added = state.logs.slice(logStart);
  assert.ok(added.some((entry) => entry.title === "会話はおあずけ"));
  assert.equal(added.some((entry) => entry.title === "少しだけ、近くに"), false);
  assert.equal(added.some((entry) => /相手が笑った/.test(entry.text)), false);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Treatment heals a sleeping person without waking them or giving them unobserved memories", () => {
  let sleeping = quietNight(61);
  person(sleeping).hp = 20;
  person(sleeping).wounds = { arm: 2, leg: 1, body: 2 };
  sleeping = assign(sleeping, "sleep");
  const sleepId = person(sleeping).action!.id;
  const patientRelation = structuredClone(person(sleeping).relations.mio);
  const before = Object.fromEntries(sleeping.residents.map((resident) => [resident.id, [...resident.memories]]));
  const medicine = sleeping.resources.medicine;
  const baseline = advance(deserialize(serialize(sleeping)), 20);
  let treated = assign(sleeping, "heal", "mio", "aki");
  treated = advance(deserialize(serialize(treated)), 20);
  assert.equal(person(treated).action?.kind, "sleep");
  assert.equal(person(treated).action?.id, sleepId);
  assert.equal(person(treated).action?.progress, 20);
  assert.ok(Math.abs(person(treated).hp - person(baseline).hp - 45) < 1e-8);
  assert.deepEqual(person(treated).wounds, { arm: 0, leg: 0, body: 0 });
  assert.equal(treated.resources.medicine, medicine - 1);
  assert.deepEqual(person(treated).memories, before.aki);
  assert.deepEqual(person(treated).relations.mio, patientRelation);
  assert.equal(person(treated, "mio").memories.length, before.mio.length + 1);
  assert.equal(person(treated, "ren").memories.length, before.ren.length + 1);
  const event = treated.life!.events.find((entry) => entry.kind === "heal");
  assert.ok(event);
  assert.deepEqual(event.actors, ["mio"]);
  assert.equal(event.subjectId, "aki");
  assert.equal(event.witnesses.includes("aki"), false);
  assert.ok(event.witnesses.includes("mio"));
  assert.ok(event.witnesses.includes("ren"));
  const treatmentLog = treated.logs.find((entry) => entry.title === "傷の手当");
  assert.ok(treatmentLog);
  assert.equal(treatmentLog.witnesses.includes("aki"), false);
  assert.doesNotMatch(treatmentLog.title + treatmentLog.text, /ありがとう/);
  assert.deepEqual(deserialize(serialize(treated)), treated);
});

test("Treatment cannot be reserved across different rooms or interrupt the would-be healer's current work", () => {
  let state = assign(quietNight(62), "hobby");
  person(state, "ren").location = "bedroom";
  person(state, "ren").hp = 40;
  person(state, "ren").wounds.arm = 1;
  const before = serialize(state);
  const result = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "heal",
    target: "ren",
  });
  assert.match(result.error ?? "", /レン.*同じ部屋/);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
  assert.equal(person(result.state).action?.kind, "hobby");
  assert.equal(person(result.state).suspended, null);
  assert.equal(availableResources(result.state).medicine, state.resources.medicine);
});

test("A patient leaving the room ends pending treatment without consuming medicine or applying remote effects", () => {
  let state = quietNight(63);
  person(state, "ren").hp = 40;
  person(state, "ren").wounds.arm = 1;
  const medicine = state.resources.medicine;
  const relation = structuredClone(person(state, "ren").relations.aki);
  state = assign(state, "heal", "aki", "ren");
  assert.equal(state.resources.medicine, medicine);
  assert.equal(availableResources(state).medicine, medicine - 1);
  state = advance(state, 5);
  state = assign(state, "move", "ren", "bedroom");
  const beforePatient = structuredClone({
    hp: person(state, "ren").hp,
    mood: person(state, "ren").mood,
    wounds: person(state, "ren").wounds,
  });
  state = advance(deserialize(serialize(state)), 15);
  assert.equal(person(state, "ren").location, "bedroom");
  assert.equal(person(state).action, null);
  assert.equal(state.resources.medicine, medicine);
  assert.equal(availableResources(state).medicine, medicine);
  assert.equal(person(state, "ren").hp, beforePatient.hp);
  assert.equal(person(state, "ren").mood, beforePatient.mood);
  assert.deepEqual(person(state, "ren").wounds, beforePatient.wounds);
  assert.deepEqual(person(state, "ren").relations.aki, relation);
  assert.equal(state.life!.events.some((entry) => entry.kind === "heal"), false);
  assert.ok(state.logs.some((entry) => entry.title === "手当を見合わせた"));
  assert.equal(state.logs.some((entry) => entry.title === "傷の手当"), false);
  assert.deepEqual(deserialize(serialize(state)), state);
});
