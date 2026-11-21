import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, command, createGame, deserialize, getCombatants, serialize } from "../src/game/engine.ts";
import { deriveAttention } from "../src/game/presentation.ts";
import { getOpenTravelPlans } from "../src/game/travel-plans.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function fresh(): GameState {
  let s = createGame(739);
  for (const r of s.residents) s = act(s, { type: "policy", residentId: r.id, policy: "rest" });
  return s;
}
const plan = (s: GameState, minutes = 5, ids = ["aki"]) => act(s, {
  type: "plan-trip", residentIds: ids, purpose: "旅先で物資を探す", returnAt: s.minutes + minutes,
});

test("Management intentions leave the clock, body, manual work, reservations, RNG and old pause untouched", () => {
  let s = act(fresh(), { type: "assign", residentIds: ["mio"], kind: "cook" });
  s = advance(s, 5);
  s = act(s, { type: "pause", residentId: "mio" });
  person(s).hp = 0;
  s.pauseReason = "既存の体調確認";
  const original = structuredClone(s);
  s = plan(s, 1440, ["aki", "mio"]);
  const { nextId: _next, travelPlans: _plans, ...world } = s;
  const { nextId: _oldNext, ...oldWorld } = original;
  assert.deepEqual(world, oldWorld);
  assert.equal(s.nextId, original.nextId + 1);
  assert.equal(s.travelPlans?.entries[0].residentIds.includes("aki"), true);
  assert.deepEqual(deserialize(serialize(s)), s);
  const unchanged = command(s, { type: "plan-trip", planId: s.travelPlans!.entries[0].id,
    residentIds: ["mio", "aki"], purpose: "旅先で物資を探す", returnAt: s.travelPlans!.entries[0].returnAt });
  assert.strictEqual(unchanged.state, s);
  assert.equal(unchanged.error, undefined);
});

test("A return reminder stops once at its clock time and never claims a real departure or return", () => {
  let s = plan(fresh());
  const memories = structuredClone(s.residents.map((r) => r.memories));
  s = advance(s, 60);
  assert.equal(s.minutes, 485);
  assert.match(s.pauseReason!, /旅の予定/);
  assert.equal(s.travelPlans!.entries[0].remindedAt, 485);
  const reminder = s.logs.find((l) => l.title === "旅の予定の時刻")!;
  assert.equal(reminder.type, "system");
  assert.deepEqual(reminder.actors, []);
  assert.deepEqual(reminder.witnesses, []);
  assert.deepEqual(s.residents.map((r) => r.memories), memories);
  assert.ok(s.residents.every((r) => r.location === "home"));
  assert.equal(s.life?.events.some((e) => e.kind === "return"), false);
  assert.equal(getOpenTravelPlans(s).length, 1, "A predeparture plan cannot auto-complete just because everyone is home");
  s = advance(deserialize(serialize(s)), 5);
  assert.equal(s.minutes, 490);
  assert.equal(s.logs.filter((l) => l.title === "旅の予定の時刻").length, 1);
});

test("An actual second-night hunger checkpoint wins over the simultaneous plan reminder", () => {
  let s = deserialize(readFileSync(new URL("./fixtures/two-night-evening-v3.json", import.meta.url), "utf8"));
  assert.equal(s.minutes, 2520);
  s = plan(s, 481, ["aki", "ren"]);
  s = act(s, { type: "assign", residentIds: ["aki", "ren"], kind: "sleep" });
  s = advance(s, 840);
  assert.equal(s.minutes, 3001);
  assert.match(s.pauseReason!, /アキ.*空腹/);
  assert.equal(s.travelPlans!.entries[0].remindedAt, 3001);
  assert.equal(s.logs.filter((l) => l.title === "旅の予定の時刻").length, 1);
  assert.match(deriveAttention(s).find((item) => item.id === "hunger:aki")!.detail, /利用できる食事は5食/);
  assert.equal(person(s).location, "village");
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A simultaneous unselected encounter keeps battle priority while the plan is marked and saved", () => {
  let s = act(fresh(), { type: "assign", residentIds: ["aki"], kind: "move", target: "ruins" });
  const duration = person(s).action!.duration;
  s = plan(s, duration, ["mio"]);
  s = advance(s, 60);
  assert.equal(s.minutes, 480 + duration);
  assert.match(s.pauseReason!, /遭遇/);
  assert.equal(getCombatants(s)[0].id, "aki");
  assert.equal(s.travelPlans!.entries[0].remindedAt, s.minutes);
  assert.ok(!s.residents.some((r) => r.memories.some((m) => m.includes("旅先で物資を探す"))));
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Changing purpose preserves a due mark, while changing the deadline creates one later reminder", () => {
  let s = advance(plan(fresh(), 1), 1);
  const id = s.travelPlans!.entries[0].id;
  const returnAt = s.travelPlans!.entries[0].returnAt;
  s = advance(s, 1);
  s = act(s, { type: "plan-trip", planId: id, residentIds: ["aki"], purpose: "目的だけ変更", returnAt });
  assert.equal(s.travelPlans!.entries[0].remindedAt, returnAt);
  s = advance(s, 1);
  assert.equal(s.logs.filter((l) => l.title === "旅の予定の時刻").length, 1);
  s = act(s, { type: "plan-trip", planId: id, residentIds: ["aki"], purpose: "目的だけ変更", returnAt: s.minutes + 2 });
  assert.equal(s.travelPlans!.entries[0].remindedAt, undefined);
  s = advance(deserialize(serialize(s)), 10);
  assert.equal(s.logs.filter((l) => l.title === "旅の予定の時刻").length, 2);
  s = act(s, { type: "close-trip", planId: id });
  const before = s;
  const duplicate = command(s, { type: "close-trip", planId: id });
  assert.strictEqual(duplicate.state, before);
  assert.equal(getOpenTravelPlans(s).length, 0);
});

test("An overdue unreminded save catches up on the next real minute, never on reading", () => {
  const old = plan(fresh());
  old.minutes = 490;
  let s = deserialize(serialize(old));
  const before = serialize(s);
  assert.equal(getOpenTravelPlans(s)[0].returnAt, 485);
  assert.equal(serialize(s), before);
  s = advance(s, 1);
  assert.equal(s.minutes, 491);
  assert.equal(s.travelPlans!.entries[0].remindedAt, 491);
  assert.equal(s.logs.filter((l) => l.title === "旅の予定の時刻").length, 1);
});

test("A later timestamp cannot legitimize a plan revision ID allocated before its new companion joined", () => {
  let s = advance(fresh(), 20);
  s = plan(s, 1440, ["mio"]);
  const id = s.travelPlans!.entries[0].id;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "rest" });
  const unusedOldId = person(s).action!.id;
  s = act(s, { type: "cancel", residentId: "aki" });
  s = act(s, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "food", amount: 3 });
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "village", via: ["road", "meadow"] });
  for (let n = 0; n < 100 && person(s, "mio").action; n++) s = advance(s, 1);
  for (const choice of ["talk", "deliver"] as const)
    s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice });
  s = act(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  const joined = person(s, "village-guide");
  s = advance(s, 1);
  s = act(s, { type: "plan-trip", planId: id, residentIds: ["mio", "village-guide"],
    purpose: "仲間と帰り道を歩く", returnAt: s.travelPlans!.entries[0].returnAt });
  assert.ok(s.travelPlans!.entries[0].updatedAt > joined.joinedAt!);
  assert.ok(s.travelPlans!.entries[0].revisionId > joined.joinedLogId!);
  assert.deepEqual(deserialize(serialize(s)), s);
  const forged = structuredClone(s);
  forged.travelPlans!.entries[0].revisionId = unusedOldId;
  assert.throws(() => deserialize(serialize(forged)), /保存データ/);
});
