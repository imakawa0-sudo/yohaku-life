import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, getEventKnowledge, serialize } from "../src/game/engine.ts";
import { getHomeHistoryItems, type HomeHistoryItem } from "../src/game/presentation.ts";
import type { Command, GameLog, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 200; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The real action did not finish");
}
function movement(id: number, actor: string, time = 582, changes: Partial<GameLog> = {}): GameLog {
  return { id, time, type: "explore", title: "移動を終えて", text: `${actor}の元の移動本文`, actors: [actor], witnesses: [actor], ...changes };
}
function flatten(items: HomeHistoryItem[]): GameLog[] {
  return [...items].reverse().flatMap((item) => item.kind === "log" ? [item.log] : [...item.sourceLogs]);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("Home history handles empty and single records and applies an explicit zero limit", () => {
  assert.deepEqual(getHomeHistoryItems([]), []);
  const log = movement(31, "aki");
  const items = getHomeHistoryItems([log]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "log");
  if (items[0].kind !== "log") assert.fail("A single record must stay a record");
  assert.equal(items[0].log, log);
  assert.equal(items[0].key, "log:31");
  assert.deepEqual(getHomeHistoryItems([log], 0), []);
});

test("Adjacent simultaneous moves retain each real record, nonconsecutive ID, actor and separate witness list", () => {
  const logs = [movement(31, "aki", 582, { witnesses: ["aki", "ren"] }), movement(33, "mio", 582, { witnesses: ["mio"] }), movement(35, "ren", 582, { witnesses: [] })];
  for (const count of [2, 3]) {
    const input = deepFreeze(logs.slice(0, count));
    const items = getHomeHistoryItems(input);
    assert.equal(items.length, 1);
    const item = items[0];
    if (item.kind !== "movement-summary") assert.fail("Real distinct moves should share a display summary");
    assert.equal(item.time, 582);
    assert.equal(item.key, `movement:${input.map((log) => log.id).join(":")}`);
    assert.deepEqual(item.actorIds, input.map((log) => log.actors[0]));
    assert.notEqual(item.sourceLogs, input);
    item.sourceLogs.forEach((log, index) => assert.equal(log, input[index]));
    assert.deepEqual(item.sourceLogs.map((log) => log.witnesses), input.map((log) => log.witnesses));
    assert.deepEqual(flatten(items), input);
  }
});

test("Different absolute minutes and the same displayed time on another day form separate movement groups", () => {
  const logs = [movement(1, "aki", 582), movement(2, "mio", 583), movement(3, "ren", 583), movement(4, "aki", 2023), movement(5, "mio", 2023)];
  const items = getHomeHistoryItems(logs, logs.length);
  assert.deepEqual(items.map((item) => item.key), ["movement:4:5", "movement:2:3", "log:1"]);
  assert.deepEqual(flatten(items), logs);
});

test("Intervening events and records outside the exact movement shape prevent merging without parsing prose", () => {
  const blockers: Partial<GameLog>[] = [
    { type: "social", title: "同じ食卓で" },
    { type: "combat", title: "移動を終えて" },
    { title: "帰ってきた" },
    { actors: [] },
    { actors: ["aki", "mio"] },
  ];
  for (const changes of blockers) {
    const logs = [movement(1, "aki"), movement(2, "ren", 582, { text: "アキとミオが同じ家へ着いた", ...changes }), movement(3, "mio")];
    const items = getHomeHistoryItems(logs, logs.length);
    assert.ok(items.every((item) => item.kind === "log"));
    assert.deepEqual(flatten(items), logs);
  }
});

test("A repeated actor splits the run and cannot become a fictitious additional person", () => {
  const logs = [movement(1, "aki"), movement(2, "mio"), movement(3, "aki"), movement(4, "ren")];
  const items = getHomeHistoryItems(logs, logs.length);
  assert.deepEqual(items.map((item) => item.key), ["movement:3:4", "movement:1:2"]);
  for (const item of items) {
    assert.equal(item.kind, "movement-summary");
    if (item.kind === "movement-summary") assert.equal(new Set(item.actorIds).size, item.actorIds.length);
  }
  assert.deepEqual(flatten(items), logs);
  assert.deepEqual(getHomeHistoryItems([movement(5, "aki"), movement(6, "aki")]).map((item) => item.key), ["log:6", "log:5"]);
});

test("A real three-person cache trip shows the joint supply between movement summaries and round-trips every log in order", () => {
  let state = createGame(20261120);
  const ids = ["aki", "mio", "ren"];
  state = act(state, { type: "assign", residentIds: ids, kind: "move", target: "shelter" });
  state = finish(state);
  state = act(state, { type: "assign", residentIds: ids, kind: "gather" });
  state = finish(state);
  state = act(state, { type: "assign", residentIds: ids, kind: "move", target: "home" });
  state = finish(state);
  assert.ok(state.residents.every((resident) => resident.location === "home"));
  const lastMoves = state.logs.slice(-3);
  assert.ok(lastMoves.every((log) => log.title === "移動を終えて"));
  const supply = state.logs.find((log) => log.title === "争わずに得たもの")!;
  assert.ok(supply);
  const items = getHomeHistoryItems(state.logs);
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, "movement-summary");
  assert.equal(items[1].kind, "log");
  assert.equal(items[2].kind, "movement-summary");
  if (items[0].kind === "movement-summary") assert.deepEqual(items[0].sourceLogs, lastMoves);
  if (items[1].kind === "log") assert.equal(items[1].log, supply);
  assert.deepEqual(flatten(getHomeHistoryItems(state.logs, state.logs.length)).map((log) => log.id), state.logs.map((log) => log.id));
  assert.deepEqual(getHomeHistoryItems(deserialize(serialize(state)).logs), items);
});

test("History projection accepts a frozen world and leaves clock, IDs, seed, work, source facts and private knowledge unchanged", () => {
  let state = createGame(101);
  for (const resident of state.residents) state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  person(state).hp = 20;
  person(state, "ren").location = "bedroom";
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  state = act(state, { type: "assign", residentIds: ["mio"], kind: "heal", target: "aki" });
  state = finish(state, "mio");
  const source = state.life!.events.find((event) => event.kind === "heal")!;
  const before = serialize(state);
  assert.equal(getEventKnowledge(state, "aki", source.id).status, "unknown");
  deepFreeze(state);
  const first = getHomeHistoryItems(state.logs, state.logs.length);
  assert.deepEqual(getHomeHistoryItems(state.logs, state.logs.length), first);
  assert.deepEqual(flatten(first), state.logs);
  assert.equal(getEventKnowledge(state, "aki", source.id).status, "unknown");
  assert.equal(getEventKnowledge(state, "mio", source.id).status, "direct");
  assert.equal(serialize(state), before);
});
