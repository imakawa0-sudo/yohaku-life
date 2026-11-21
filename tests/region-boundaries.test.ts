import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import type { Command, GameState } from "../src/game/types.ts";

function act(state: GameState, cmd: Command) {
  const result = command(state, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function settled() {
  const s = createGame(20261120);
  for (const p of s.residents) { p.policy = "rest"; p.hunger = 100; p.energy = 100; }
  return s;
}

test("Controlled changed-patient boundary is checked before a rescue step can move anyone", () => {
  let s = settled();
  s.enemy.defeated = true;
  s.residents[0].location = s.residents[1].location = "village";
  s.residents[0].hp = 20;
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" });
  const length = s.residents[1].action!.segmentDuration!;
  s = advance(s, length - 1);
  // A separately controlled save boundary, not a normal trip preparation.
  s.residents[0].location = "home";
  s = deserialize(serialize(s));
  const carrierPlace = s.residents[1].location;
  s = advance(s, 1);
  assert.equal(s.residents[0].location, "home");
  assert.equal(s.residents[1].location, carrierPlace);
  assert.equal(s.residents[1].action, null);
  assert.equal(s.life!.events.filter(e => e.kind === "rescue").length, 0);
});

test("Controlled new danger stops a field meal before consumption without moving its reserved food", () => {
  let s = settled();
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 1 });
  s.residents[0].location = "road";
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  s = advance(s, 14);
  s.enemy.location = "road";
  const food = s.inventory!.packs.aki.food;
  const hunger = s.residents[0].hunger;
  s = advance(deserialize(serialize(s)), 1);
  assert.equal(s.residents[0].action, null);
  assert.equal(s.inventory!.packs.aki.food, food);
  assert.ok(s.residents[0].hunger <= hunger);
  assert.ok(s.logs.some(e => e.title === "食事を見合わせた"));
});

test("Unstarted paused travel recomputes its load after a real deposit and preserves route progress", () => {
  let s = settled();
  s.resources.scrap = 30; // Controlled heavy-load boundary.
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 30 });
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["road", "meadow"] });
  const heavy = s.residents[0].action!.duration;
  s = act(s, { type: "pause", residentId: "aki" });
  const jobId = s.residents[0].suspended!.id;
  s = act(s, { type: "transfer", residentId: "aki", from: "aki", to: "base", resource: "scrap", amount: 30 });
  s = act(s, { type: "resume", residentId: "aki" });
  assert.equal(s.residents[0].action!.id, jobId);
  assert.equal(s.residents[0].action!.progress, 0);
  assert.equal(s.residents[0].action!.duration, 51);
  assert.ok(s.residents[0].action!.duration < heavy);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A carrier leaving a paused casualty does not keep a remote claim on that person's own food", () => {
  let s = settled();
  s.residents[0].hp = 20; // Controlled casualty, followed by actual commands.
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 1 });
  s = act(s, { type: "assign", residentIds: ["aki", "mio"], kind: "move", target: "road" });
  for (let n = 0; n < 100 && s.residents.some(p => p.action?.kind === "move"); n++) s = advance(s, 1);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" });
  s = act(s, { type: "pause", residentId: "mio" });
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home" });
  for (let n = 0; n < 100 && s.residents[1].action?.kind === "move"; n++) s = advance(s, 1);
  assert.equal(s.residents[0].location, "road");
  assert.equal(s.residents[1].location, "home");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  assert.equal(s.residents[0].action?.reservationSource, "pack");
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("An already completed saved travel segment is rejected before a resume can dereference a missing edge", () => {
  let s = settled();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "kitchen" });
  s = act(s, { type: "pause", residentId: "aki" });
  s.residents[0].suspended!.segment = s.residents[0].suspended!.path!.length;
  s.residents[0].location = "kitchen";
  assert.throws(() => deserialize(serialize(s)), /保存データ/);
});

test("Ordinary return from the village prefers the safe path while an explicit shortcut remains a choice", () => {
  let s = settled();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["road", "meadow"] });
  for (let n = 0; n < 100 && s.residents[0].action; n++) s = advance(s, 1);
  const ordinary = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  assert.deepEqual(ordinary.residents[0].action!.path, ["meadow", "road", "home"]);
  assert.equal(ordinary.residents[0].action!.duration, 51);
  const shortcut = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", via: ["ridge", "ruins", "road"] });
  assert.deepEqual(shortcut.residents[0].action!.path, ["ridge", "ruins", "road", "home"]);
  assert.equal(shortcut.residents[0].action!.duration, 41);
  s.enemy.defeated = true;
  const cleared = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  assert.equal(cleared.residents[0].action!.duration, 41);
});
