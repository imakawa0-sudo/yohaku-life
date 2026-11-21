import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import { totalResources } from "../src/game/inventory.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
const evening = () => deserialize(readFileSync(new URL("./fixtures/outside-evening-v3.json", import.meta.url), "utf8"));
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function tick(s: GameState, minutes: number): GameState {
  for (let n = 0; n < minutes; n++) s = advance(s, 1);
  return s;
}

test("Travellers sleep without returning or using the distant warehouse while a companion cooks", () => {
  let s = evening();
  const goods = totalResources(s), before = structuredClone(s);
  s = act(s, { type: "assign", residentIds: ["aki", "ren"], kind: "sleep" });
  assert.equal(s.minutes, before.minutes);
  assert.equal(s.seed, before.seed);
  assert.deepEqual(totalResources(s), goods);
  assert.ok(s.residents.filter((r) => r.id !== "mio").every((r) => r.action?.kind === "sleep" && r.action.duration === 480));
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  const held = tick(s, 5);
  assert.equal(person(held).location, "village");
  assert.equal(person(held).action?.progress, 5);
  assert.equal(person(held, "mio").location, "home");
  assert.equal(person(held, "mio").action?.progress, 5);
  assert.deepEqual(deserialize(serialize(held)), held);
  const completed = tick(deserialize(serialize(held)), 17);
  assert.equal(person(completed, "mio").action, null);
  assert.equal(completed.resources.food, before.resources.food + 3);
  assert.equal(completed.resources.ingredients, before.resources.ingredients - 2);
  assert.equal(person(completed).action?.progress, 22);
  assert.equal(person(completed).location, "village");
});

test("Sheltered field sleep recovers only actual minutes and leaves wounds for treatment", () => {
  let s = evening();
  for (const r of s.residents) { r.policy = "rest"; r.hunger = 100; r.energy = 50; r.hp = 50; r.wounds.arm = 1; }
  s = act(s, { type: "assign", residentIds: ["aki", "mio"], kind: "sleep" });
  const before = structuredClone(s);
  s = tick(s, 240);
  assert.ok(Math.abs(person(s).hp - (before.residents[0].hp + 4.8)) < 0.00001);
  assert.ok(Math.abs(person(s, "mio").hp - (before.residents[1].hp + 9.6)) < 0.00001);
  assert.equal(person(s).wounds.arm, 1);
  s = tick(deserialize(serialize(s)), 240);
  assert.equal(person(s).action, null);
  assert.equal(person(s).location, "village");
  assert.equal(person(s).wounds.arm, 1);
  assert.equal(person(s, "mio").wounds.arm, 0);
  assert.ok(s.logs.some((l) => l.actors.includes("aki") && l.text.includes("集落の休み所で眠りから覚めた")));
  assert.ok(!person(s).memories.some((m) => m.includes("朝の光が家に差し込む")));
});

test("Repeated direct sleep controls continue the same active or held sleep instead of stacking jobs", () => {
  let s = act(evening(), { type: "assign", residentIds: ["aki"], kind: "sleep" });
  s = tick(s, 5);
  const before = serialize(s), sleepId = person(s).action!.id;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  assert.equal(serialize(s), before);
  s = act(s, { type: "pause", residentId: "aki" });
  const nextId = s.nextId;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  assert.equal(person(s).action?.id, sleepId);
  assert.equal(person(s).action?.progress, 5);
  assert.equal(person(s).suspended, null);
  assert.equal(s.nextId, nextId);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Paused sleep survives travel and saves, but resumes only at its actual sleeping place", () => {
  let s = act(evening(), { type: "assign", residentIds: ["aki"], kind: "sleep" });
  s = tick(s, 5);
  const sleepId = person(s).action!.id;
  s = act(s, { type: "pause", residentId: "aki" });
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "shelter" });
  for (let n = 0; n < 120 && person(s).action; n++) s = advance(s, 1);
  assert.equal(person(s).location, "shelter");
  assert.equal(person(s).suspended?.id, sleepId);
  s = deserialize(serialize(s));
  const before = serialize(s), wrong = command(s, { type: "resume", residentId: "aki" });
  assert.ok(wrong.error?.includes("中断した場所"));
  assert.strictEqual(wrong.state, s);
  assert.equal(serialize(s), before);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  for (let n = 0; n < 120 && person(s).action; n++) s = advance(s, 1);
  s = act(deserialize(serialize(s)), { type: "resume", residentId: "aki" });
  assert.equal(person(s).action?.id, sleepId);
  assert.equal(person(s).action?.progress, 5);
});

test("Travel in either job slot cannot be hidden by a new outside sleep command", () => {
  for (const paused of [false, true]) {
    let s = act(evening(), { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
    s = tick(s, 2);
    if (paused) s = act(s, { type: "pause", residentId: "aki" });
    const before = serialize(s), result = command(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
    assert.match(result.error!, /移動・救助・交戦/);
    assert.strictEqual(result.state, s);
    assert.equal(serialize(s), before);
  }
});

test("A newly dangerous sleeping place stops recovery before progress and preserves the held sleep", () => {
  let s = act(evening(), { type: "assign", residentIds: ["aki"], kind: "sleep" });
  s = tick(s, 5);
  person(s).hp = 60;
  s.enemy.location = "village";
  const sleepId = person(s).action!.id;
  const next = advance(s, 1);
  assert.equal(person(next).action, null);
  assert.equal(person(next).suspended?.id, sleepId);
  assert.equal(person(next).suspended?.progress, 5);
  assert.ok(person(next).hp <= 60, "Unsafe sleep cannot recover health before the encounter");
  assert.match(next.pauseReason!, /睡眠を中断/);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Sleep save validation rejects unsupported or teleported active sleep but retains legacy base and held travel history", () => {
  const s = act(evening(), { type: "assign", residentIds: ["aki"], kind: "sleep" });
  for (const change of [
    (x: GameState) => { person(x).action!.origin = "road"; },
    (x: GameState) => { person(x).location = "shelter"; },
    (x: GameState) => { delete person(x).action!.origin; },
  ]) {
    const bad = structuredClone(s); change(bad);
    assert.throws(() => deserialize(serialize(bad)), /保存データ/);
  }
  let legacy = act(createGame(), { type: "assign", residentIds: ["aki"], kind: "sleep" });
  person(legacy).action!.duration = 1200;
  delete person(legacy).action!.origin;
  legacy = deserialize(serialize(legacy));
  assert.equal(person(legacy).action?.duration, 1200);
  assert.equal(advance(legacy, 1).residents[0].action?.progress, 1);
});

test("Originless legacy sleep remains saveable during real travel and resumes only at base", () => {
  let s = createGame(651);
  for (const r of s.residents) { r.policy = "rest"; r.hunger = 100; }
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  person(s).action!.duration = 1200;
  delete person(s).action!.origin;
  s = act(deserialize(serialize(s)), { type: "pause", residentId: "aki" });
  const sleepId = person(s).suspended!.id;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  for (let n = 0; n < 100 && person(s).action; n++) s = deserialize(serialize(advance(s, 1)));
  assert.equal(person(s).location, "village");
  assert.equal(person(s).suspended?.id, sleepId);
  for (const cmd of [{ type: "resume", residentId: "aki" }, { type: "assign", residentIds: ["aki"], kind: "sleep" }] as Command[]) {
    const result = command(s, cmd);
    assert.match(result.error!, /以前の睡眠.*拠点/);
    assert.strictEqual(result.state, s);
  }
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  for (let n = 0; n < 100 && person(s).action; n++) s = deserialize(serialize(advance(s, 1)));
  s = act(s, { type: "resume", residentId: "aki" });
  assert.equal(person(s).action?.id, sleepId);
  assert.equal(person(s).action?.duration, 1200);
});

test("A safety pause retains sleep as well as an older held material-reserving job", () => {
  let s = createGame(652);
  for (const r of s.residents) { r.policy = "rest"; r.hunger = 100; }
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "wood-flower" });
  s = tick(s, 5);
  s = act(s, { type: "pause", residentId: "aki" });
  const work = structuredClone(person(s).suspended);
  assert.equal(work?.reserved?.scrap, 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  for (let n = 0; n < 100 && person(s).action; n++) s = advance(s, 1);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  s = tick(s, 5);
  person(s).hp = 60;
  person(s).energy = 50;
  const sleep = structuredClone(person(s).action), goods = totalResources(s);
  s.enemy.location = "village";
  const withoutRecovery = structuredClone(s);
  person(withoutRecovery).action = null;
  const expectedBody = person(advance(withoutRecovery, 1));
  s = advance(s, 1);
  assert.deepEqual(person(s).action, sleep);
  assert.deepEqual(person(s).suspended, work);
  assert.deepEqual(totalResources(s), goods);
  assert.equal(person(s).hp, expectedBody.hp, "The same battle without sleep recovery gives the same health");
  assert.equal(person(s).energy, expectedBody.energy, "Blocked sleep cannot add recovery before the shared battle cost");
  assert.match(s.pauseReason!, /睡眠と中断中の仕事は保持/);
  s = deserialize(serialize(s));
  s.enemy.defeated = true;
  const next = advance(s, 1);
  assert.equal(person(next).action?.id, sleep!.id);
  assert.equal(person(next).action?.progress, sleep!.progress + 1);
  assert.deepEqual(person(next).suspended, work);
});
