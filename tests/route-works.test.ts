import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  advance, command, createGame, deserialize, serialize, estimateTravelMinutes,
  RIVER_PATH_RULE, getRouteWorkSummary, getRouteWorkDuration, getRouteWorkEdgeMinutes, getCarryLoad,
} from "../src/game/engine.ts";
import { ownFreeResources, totalResources } from "../src/game/inventory.ts";
import { assignSelection } from "../src/game/selection.ts";
import { validRouteWorks } from "../src/game/route-works.ts";
import type { Action, Command, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id = "aki") => s.inventory!.packs[id];
const asRecord = (v: unknown) => v as Record<string, unknown>;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function quiet(): GameState {
  const s = createGame(5101);
  for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; }
  return s;
}
function finish(s: GameState, id = "aki") {
  const job = person(s, id).action?.id;
  assert.ok(job);
  for (let n = 0; n < 2000; n++) {
    if (person(s, id).action?.id !== job) return s;
    s = advance(s, 1);
  }
  assert.fail("The actual job did not finish");
}
const assignMove = (s: GameState, target: LocationId, id = "aki", via?: LocationId[]) =>
  act(s, { type: "assign", residentIds: [id], kind: "move", target, ...(via ? { via } : {}) });
const move = (s: GameState, target: LocationId, id = "aki", via?: LocationId[]) => finish(assignMove(s, target, id, via), id);
const repair = (s: GameState, id = "aki") => act(s, { type: "assign", residentIds: [id], kind: "repair-route", target: RIVER_PATH_RULE.id });
const pause = (s: GameState, id = "aki") => act(s, { type: "pause", residentId: id });
const resume = (s: GameState, id = "aki") => act(s, { type: "resume", residentId: id });
const completedLogs = (s: GameState) => s.logs.filter(l => l.routeWork !== undefined);
function rejected(s: GameState, cmd: unknown) {
  const before = serialize(s), result = command(s, cmd as Command);
  assert.ok(result.error, JSON.stringify(cmd));
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
}
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const broken = structuredClone(s);
  mutate(broken);
  assert.throws(() => deserialize(serialize(broken)), e => {
    assert.ok(e instanceof Error && !(e instanceof TypeError));
    assert.match(e.message, /保存データ.*不正/);
    return true;
  });
}
// Explicitly controlled boundary setup. The first test below instead walks to
// the real site with resources actually transferred from the warehouse.
function field(id = "aki"): GameState {
  const s = quiet();
  person(s, id).location = "meadow";
  pack(s, id).scrap = 2;
  return s;
}
const completed = () => finish(repair(field()));
const fixture = (name: string) => deserialize(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const hash = (s: GameState) => createHash("sha256").update(serialize(s)).digest("hex");

test("A real companion carries material to the site, completes once and leaves the road for another traveler", () => {
  let s = act(quiet(), { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "scrap", amount: 2 });
  s = move(s, "meadow", "ren");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "cook" });
  const before = structuredClone(s), total = totalResources(s), stats = structuredClone(person(s, "ren"));
  const raw = serialize(s);
  assert.equal(getRouteWorkSummary(s).completed, undefined);
  assert.equal(getRouteWorkDuration(s, "absent"), undefined);
  assert.equal(getRouteWorkEdgeMinutes(s, "meadow", "village"), undefined);
  assert.equal(command(s, { type: "assign", residentIds: ["ren"], kind: "repair-route", target: RIVER_PATH_RULE.id }).error, undefined);
  assert.equal(serialize(s), raw);
  s = repair(s, "ren");
  assert.deepEqual([s.minutes, s.seed, s.nextId], [before.minutes, before.seed, before.nextId + 1]);
  assert.deepEqual(s.inventory, before.inventory);
  assert.equal(ownFreeResources(s, "ren").scrap, 0);
  assert.equal(person(s, "ren").action!.duration, 40);
  s = advance(s, 39);
  assert.equal(s.routeWorks, undefined);
  assert.equal(pack(s, "ren").scrap, 2);
  assert.equal(person(s).skills.cooking > person(before).skills.cooking, true);
  const nextId = s.nextId;
  s = advance(s, 1);
  assert.equal(s.nextId, nextId + 1);
  assert.equal(pack(s, "ren").scrap, 0);
  assert.equal(totalResources(s).scrap, total.scrap - 2);
  assert.deepEqual(person(s, "ren").skills, stats.skills);
  assert.equal(person(s, "ren").mood, stats.mood);
  assert.equal(s.life!.upgrades?.length ?? 0, 0);
  assert.equal(s.life!.events.some(e => e.kind === "project"), false);
  assert.equal(completedLogs(s).length, 1);
  assert.equal(s.routeWorks!.riverPath.actorId, "ren");
  assert.deepEqual(completedLogs(s)[0].actors, ["ren"]);
  assert.equal(s.routeWorks!.riverPath.logId, completedLogs(s)[0].id);
  assert.deepEqual(deserialize(serialize(s)), s);
  assert.deepEqual(advance(s, 5), advance(deserialize(serialize(s)), 5));
  assert.equal(completedLogs(advance(s, 5)).length, 1);
  assert.equal(estimateTravelMinutes(s, "mio", "village"), 41); // Existing risky outward shortest path is preserved.
  const out = assignMove(s, "village", "mio", ["road", "meadow"]);
  assert.equal(person(out, "mio").action!.duration, 47);
  const arrived = finish(out, "mio"), home = assignMove(arrived, "home", "mio");
  assert.deepEqual(person(home, "mio").action!.path, ["meadow", "road", "home"]);
  assert.equal(person(home, "mio").action!.duration, 47);
  assert.equal(getRouteWorkEdgeMinutes(home, "village", "meadow"), 14);
  assert.equal(getRouteWorkEdgeMinutes(home, "road", "meadow"), undefined);
  const retreat = structuredClone(home); retreat.enemy.defeated = true;
  assert.equal(person(assignMove(act(retreat, { type: "cancel", residentId: "mio" }), "home", "mio"), "mio").action!.duration, 41);
});

test("The start uses arm condition once; held progress survives another job and cancellation releases unspent material", () => {
  let s = field(); person(s).wounds.arm = 1;
  s = repair(s);
  s = advance(s, 5);
  s = pause(s);
  const job = structuredClone(person(s).suspended)!;
  person(s).wounds.arm = 3; // Controlled later injury, not a revised start quote.
  s = move(s, "village");
  rejected(s, { type: "resume", residentId: "aki" });
  s = move(s, "meadow");
  s = resume(deserialize(serialize(s)));
  assert.deepEqual(person(s).action, job);
  assert.equal(job.duration, 50);
  const replay = finish(s), replayRead = finish(deserialize(serialize(s)));
  assert.deepEqual(replayRead, replay);
  let cancelled = act(pause(s), { type: "cancel", residentId: "aki" });
  assert.equal(cancelled.routeWorks, undefined);
  assert.equal(pack(cancelled).scrap, 2);
  assert.equal(ownFreeResources(cancelled, "aki").scrap, 2);
  person(cancelled, "mio").location = "meadow";
  cancelled = act(cancelled, { type: "transfer", residentId: "mio", from: "aki", to: "mio", resource: "scrap", amount: 2 });
  cancelled = repair(cancelled, "mio");
  assert.equal(person(cancelled, "mio").action!.progress, 0);
});

test("Only the selected person's own free pack supplies the atomic single-site work", () => {
  const s = field(), cmd = { type: "assign", residentIds: ["aki"], kind: "repair-route", target: RIVER_PATH_RULE.id };
  for (const patch of [{ residentIds: [] }, { residentIds: ["aki", "mio"] }, { residentIds: ["absent"] },
    { target: "unknown" }, { target: undefined }, { subjectEventId: 1 }, { via: ["meadow"] }, { cargo: { resource: "scrap", amount: 2 } }]) rejected(s, { ...cmd, ...patch });
  assert.ok(assignSelection(s, ["aki", "mio"], "repair-route", RIVER_PATH_RULE.id).error);
  for (const source of ["peer", "base", "ground", "none"] as const) {
    const t = field(); pack(t).scrap = 0;
    person(t, "mio").location = "meadow";
    if (source === "peer") pack(t, "mio").scrap = 2;
    if (source === "ground") t.inventory!.ground.meadow = { food: 0, ingredients: 0, medicine: 0, scrap: 2 };
    rejected(t, cmd);
  }
  for (const change of [(t: GameState) => { person(t).location = "village"; },
    (t: GameState) => { person(t).hp = 0; }, (t: GameState) => { person(t).energy = 2; },
    (t: GameState) => { t.enemy.location = "meadow"; }, (t: GameState) => { t.ended = true; }]) {
    const t = field(); change(t); rejected(t, cmd);
  }
  const held = pause(repair(s));
  rejected(held, cmd);
  rejected(held, { ...cmd, residentIds: ["mio"] });
  rejected(completed(), cmd);
});

test("Explicit old work is held, autonomous current is displaced, and held move does not prohibit local work", () => {
  let s = assignMove(field(), "village");
  s = advance(s, 3);
  const old = structuredClone(person(s).action)!;
  s = repair(s);
  assert.deepEqual(person(s).suspended, old);
  assert.equal(person(s).action!.kind, "repair-route");
  assert.deepEqual(deserialize(serialize(s)), s);
  rejected(s, { type: "assign", residentIds: ["aki"], kind: "observe" });
  const automatic = field();
  person(automatic).action = { id: automatic.nextId++, kind: "eat", label: "自主的な食事", duration: 15, progress: 0,
    reserved: { food: 1 }, reservationSource: "pack", automatic: true, origin: "meadow" };
  pack(automatic).food = 1;
  const taken = repair(automatic);
  assert.equal(person(taken).suspended, null);
  assert.equal(ownFreeResources(taken, "aki").food, 1);
  assert.equal(taken.seed, automatic.seed);
});

function simultaneous(kind: "entry" | "ongoing" | "first" | "future" | "blocked", reverse = false) {
  let s = field();
  person(s, "mio").location = kind === "entry" || kind === "future" ? "road" : "meadow";
  s = assignMove(s, "village", "mio", ["meadow"]);
  const a = person(s, "mio").action!;
  if (kind === "entry") { a.progress = 17; a.segmentProgress = 17; }
  if (kind === "ongoing" || kind === "future") { a.progress = 1; a.segmentProgress = 1; }
  if (kind === "blocked") person(s, "mio").hp = 0;
  s = repair(s); person(s).action!.progress = 39;
  if (reverse) s.residents.reverse();
  return advance(s, 1);
}

test("Completion at an edge boundary applies after the loop identically for either resident order", () => {
  for (const kind of ["entry", "ongoing", "first", "future", "blocked"] as const) {
    const s = simultaneous(kind), reversed = simultaneous(kind, true), a = person(s, "mio").action!;
    assert.deepEqual(person(s, "mio"), person(reversed, "mio"), kind);
    assert.equal(s.routeWorks!.riverPath.completedAt, s.minutes);
    if (kind === "entry") {
      assert.deepEqual([person(s, "mio").location, a.segment, a.segmentProgress, a.segmentDuration, a.duration], ["meadow", 1, 0, 14, 32]);
      const end = finish(s, "mio"); assert.equal(end.minutes - s.minutes, 14);
    } else if (kind === "blocked") assert.deepEqual([a.segmentProgress, a.segmentDuration, a.duration], [0, 14, 14]);
    else if (kind === "future") assert.deepEqual([a.segmentProgress, a.segmentDuration, a.duration], [2, 18, 32]);
    else assert.equal(a.segmentDuration, 18);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Completion does not rewrite held travel; resume preserves started segments and requotes untouched ones", () => {
  for (const progress of [0, 1]) {
    let s = field(); person(s, "mio").location = "meadow";
    s = assignMove(s, "village", "mio");
    if (progress) s = advance(s, 1);
    s = pause(s, "mio");
    const old = structuredClone(person(s, "mio").suspended)!;
    s = finish(repair(s));
    assert.deepEqual(person(s, "mio").suspended, old);
    s = resume(deserialize(serialize(s)), "mio");
    assert.equal(person(s, "mio").action!.id, old.id);
    assert.equal(person(s, "mio").action!.segmentDuration, progress ? 18 : 14);
    assert.equal(person(s, "mio").action!.progress, progress);
  }
});

test("Off-route cargo resumes with one original pack lock and current road costs", () => {
  let s = field(); person(s, "mio").location = "road"; pack(s, "mio").food = 2;
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home", cargo: { resource: "food", amount: 2 } });
  s = pause(s, "mio");
  const oldId = person(s, "mio").suspended!.id;
  person(s, "mio").location = "village"; // Controlled off-route relocation while held.
  s = finish(repair(s));
  s = resume(s, "mio");
  assert.notEqual(person(s, "mio").action!.id, oldId);
  assert.equal(person(s, "mio").action!.duration, 47);
  assert.equal(ownFreeResources(s, "mio").food, 0);
  assert.equal(pack(s, "mio").food, 2);
  const previous = s.resources.food;
  s = finish(s, "mio");
  assert.equal(s.resources.food, previous + 2);
  assert.equal(pack(s, "mio").food, 0);
  assert.equal(s.logs.filter(l => l.title === "荷物を倉庫へ届けた").length, 1);
});

test("Improved edge time precedes wound, currency load and rescued-person load exactly once", () => {
  let s = completed();
  person(s, "mio").location = "village"; pack(s, "mio").scrap = 30;
  person(s, "mio").wounds.leg = 1;
  for (let n = 0; n < 2; n++) s = act(s, { type: "region", residentId: "mio", npcId: "village-trader", choice: "sell-scrap" });
  const mult = getCarryLoad(s, "mio").multiplier, expect = Math.ceil(14 * 1.35 * mult);
  s = assignMove(s, "meadow", "mio");
  assert.equal(person(s, "mio").action!.duration, expect);
  const start = s.minutes; s = finish(s, "mio");
  assert.equal(s.minutes - start, expect);
  assert.equal(person(assignMove(s, "village", "mio"), "mio").action!.duration, expect);
  let rescue = completed();
  person(rescue).location = person(rescue, "ren").location = "village";
  person(rescue).hp = 20;
  person(rescue, "ren").wounds.leg = 1;
  rescue = act(rescue, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
  assert.deepEqual(person(rescue, "ren").action!.path, ["meadow", "road", "home"]);
  assert.equal(person(rescue, "ren").action!.segmentDuration, Math.ceil(14 * 1.35 * getCarryLoad(rescue, "ren").multiplier));
  rescue = finish(rescue, "ren");
  assert.equal(person(rescue).location, "home");
  assert.deepEqual(deserialize(serialize(rescue)), rescue);
});

test("Unsafe local work retains both slots and reservations while other residents keep using the clock", () => {
  for (const held of [false, true]) {
    let s = field();
    if (held) s = assignMove(s, "village");
    s = repair(s);
    const current = structuredClone(person(s).action), old = structuredClone(person(s).suspended);
    person(s, "mio").location = "village";
    s = assignMove(s, "meadow", "mio");
    s.enemy.location = "meadow"; // Controlled danger after the order, no forced ordinary combat.
    s = advance(s, 5);
    assert.equal(person(s, "mio").action!.progress, 5);
    assert.equal(pack(s).scrap, 2);
    assert.equal(ownFreeResources(s, "aki").scrap, 0);
    assert.equal(s.routeWorks, undefined);
    if (held) {
      assert.deepEqual(person(s).action, current);
      assert.deepEqual(person(s).suspended, old);
      assert.match(getRouteWorkSummary(s).working!.blockedReason!, /危険/);
    } else {
      assert.equal(person(s).action, null);
      assert.deepEqual(person(s).suspended, current);
      assert.equal(s.logs.filter(l => l.title === "道の整備を中断した").length, 1);
    }
    rejected(s, { type: "resume", residentId: "aki" });
    s.enemy.location = "ruins";
    if (!held) s = resume(s);
    s = advance(s, 1);
    assert.equal(person(s).action!.progress, 1);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Rescue preserves both roadwork and an older reservation through homecoming, recovery and an explicit choice", () => {
  for (const held of [false, true]) {
    let s = field();
    if (held) {
      pack(s).food = 1;
      s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
    }
    s = repair(s);
    s = advance(s, 3);
    person(s, "mio").location = "meadow";
    person(s).hp = 20;
    const old = structuredClone(person(s).suspended), job = structuredClone(person(s).action)!;
    s = act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" });
    assert.deepEqual(person(s).action, held ? job : null);
    assert.equal(pack(s).scrap, 2);
    assert.equal(ownFreeResources(s, "aki").scrap, 0);
    assert.deepEqual(person(s).suspended, held ? old : job);
    assert.match(getRouteWorkSummary(s).working!.blockedReason!, /運搬/);
    rejected(s, { type: "resume", residentId: "aki" });
    s = advance(deserialize(serialize(s)), 5);
    assert.equal(getRouteWorkSummary(s).working!.paused, !held);
    assert.equal((held ? person(s).action : person(s).suspended)!.progress, 3);
    s = finish(s, "mio");
    assert.equal(s.routeWorks, undefined);
    assert.equal(person(s).location, "home");
    assert.deepEqual(person(s).action, held ? job : null);
    assert.deepEqual(person(s).suspended, held ? old : job);
    assert.match(getRouteWorkSummary(s).working!.blockedReason!, /現場/);
    s = finish(act(deserialize(serialize(s)), { type: "assign", residentIds: ["mio"], kind: "heal", target: "aki" }), "mio");
    assert.ok(person(s).hp > 35);
    assert.deepEqual(deserialize(serialize(s)), s);
    assert.deepEqual(person(s).action, held ? job : null);
    assert.deepEqual(person(s).suspended, held ? old : job);
    if (held) {
      const cancelled = act(s, { type: "cancel", residentId: "aki", actionId: job.id });
      assert.equal(ownFreeResources(cancelled, "aki").scrap, 2);
      assert.equal(ownFreeResources(cancelled, "aki").food, 0);
      assert.deepEqual(person(cancelled).suspended, old);
      assert.deepEqual(deserialize(serialize(cancelled)), cancelled);
      s = act(s, { type: "cancel", residentId: "aki", actionId: old!.id });
    }
    s = move(s, "meadow");
    s = resume(s);
    assert.deepEqual(person(s).action, job);
    s = finish(s);
    assert.equal(pack(s).scrap, 0);
    assert.equal(completedLogs(s).length, 1);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Actual controlled outdoor knockout preserves the old slot and never spends unfinished road material", () => {
  for (const held of [false, true]) {
    let s = field();
    if (held) {
      pack(s).food = 1;
      s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
    }
    s = repair(s);
    s = advance(s, 3);
    const job = structuredClone(person(s).action), old = structuredClone(person(s).suspended);
    person(s).hp = 1;
    s.enemy.location = "meadow"; // Controlled new danger; the real combat tick causes the knockout.
    s = advance(s, 1);
    assert.equal(person(s).hp, 0);
    assert.equal(pack(s).scrap, 2);
    assert.equal(s.routeWorks, undefined);
    assert.deepEqual(person(s).action, held ? job : null);
    assert.deepEqual(person(s).suspended, held ? old : job);
    s = advance(deserialize(serialize(s)), 1);
    assert.deepEqual(person(s).action, held ? job : null);
    assert.deepEqual(person(s).suspended, held ? old : job);
    assert.equal(ownFreeResources(s, "aki").scrap, 0);
    s.enemy.location = "ruins";
    person(s, "mio").location = "meadow";
    s = finish(act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" }), "mio");
    assert.equal(person(s).location, "home");
    s = advance(deserialize(serialize(s)), 1);
    assert.ok(person(s).hp > 0);
    s = finish(act(s, { type: "assign", residentIds: ["mio"], kind: "heal", target: "aki" }), "mio");
    assert.ok(person(s).hp > 35);
    assert.deepEqual(person(s).action, held ? job : null);
    assert.deepEqual(person(s).suspended, held ? old : job);
    assert.equal(ownFreeResources(s, "aki").scrap, 0);
    assert.deepEqual(deserialize(serialize(s)), s);
    s = act(s, { type: "cancel", residentId: "aki", actionId: job!.id });
    assert.equal(ownFreeResources(s, "aki").scrap, 2);
    assert.deepEqual(person(s).suspended, held ? old : null);
    assert.equal(s.routeWorks, undefined);
    if (held) assert.equal(ownFreeResources(s, "aki").food, 0);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("A changed physical site cannot finish remotely, even with two occupied job slots", () => {
  for (const held of [false, true]) {
    let s = field();
    if (held) s = assignMove(s, "village");
    s = repair(s); person(s).action!.progress = 39;
    person(s).location = "village"; // Controlled displacement after the instruction.
    const start = s.minutes;
    s = advance(s, 3);
    assert.equal(s.minutes - start, 3);
    assert.equal(s.routeWorks, undefined);
    assert.equal(pack(s).scrap, 2);
    assert.equal((person(s).action ?? person(s).suspended)!.progress, 39);
    assert.match(getRouteWorkSummary(s).working!.blockedReason!, /現場/);
    s = deserialize(serialize(s));
    if (!held) rejected(s, { type: "resume", residentId: "aki" });
    person(s).location = "meadow";
    if (!held) s = resume(s);
    s = advance(s, 1);
    assert.equal(pack(s).scrap, 0);
    assert.equal(completedLogs(s).length, 1);
  }
});

test("Roadwork does not become a helper or autonomous-work target", () => {
  const s = repair(field()); person(s, "mio").location = "meadow";
  rejected(s, { type: "assign", residentIds: ["mio"], kind: "help", target: "aki" });
  const progressed = advance(s, 10);
  assert.equal(person(progressed).action!.progress, 10);
  assert.notEqual(person(progressed, "mio").action?.kind, "repair-route");
  assert.notEqual(person(progressed, "mio").action?.kind, "help");
});

test("New work saves reject forged reservations, hidden purposes and duplicate current or held work", () => {
  const s = repair(field());
  for (const mutate of [(a: Action) => { a.target = "other"; }, (a: Action) => { a.origin = "village"; },
    (a: Action) => { a.automatic = true; }, (a: Action) => { delete a.automatic; }, (a: Action) => { a.id += .5; },
    (a: Action) => { a.duration = 39; }, (a: Action) => { a.duration = 71; }, (a: Action) => { a.progress = .5; },
    (a: Action) => { a.progress = a.duration; }, (a: Action) => { a.reserved = { scrap: 2, food: 0 }; },
    (a: Action) => { a.reservationSource = "base"; }, (a: Action) => { a.reserved = { scrap: 1 }; },
    (a: Action) => { a.materialTransfers = []; }, (a: Action) => { a.cargo = { resource: "scrap", amount: 2 }; },
    (a: Action) => { a.path = ["village"]; }, (a: Action) => { a.craftingToolsId = 1; },
    (a: Action) => { a.subjectEventId = 1; }, (a: Action) => { a.targetActionId = 1; },
    (a: Action) => { a.autonomyNext = "gather"; }, (a: Action) => { asRecord(a).hidden = true; }]) {
    rejectSave(s, t => mutate(person(t).action!));
  }
  rejectSave(s, t => { pack(t).scrap = 1; });
  rejectSave(s, t => { person(t, "mio").suspended = { ...structuredClone(person(t).action!), id: t.nextId++ }; });
  assert.deepEqual(deserialize(serialize(pause(s))), pause(s));
  let remote = pause(s); person(remote).location = "village";
  assert.deepEqual(deserialize(serialize(remote)), remote);
});

test("Completed facts and work markers are a strict one-to-one pair independent of wording", () => {
  const s = completed();
  const result = (t: GameState) => t.routeWorks!.riverPath;
  const log = (t: GameState) => t.logs.find(l => l.id === result(t).logId)!;
  for (const mutate of [(t: GameState) => { delete t.routeWorks; }, (t: GameState) => { delete log(t).routeWork; },
    (t: GameState) => { asRecord(t.routeWorks).version = 2; }, (t: GameState) => { asRecord(t.routeWorks).extra = true; },
    (t: GameState) => { asRecord(result(t)).ruleId = "unknown"; }, (t: GameState) => { asRecord(result(t)).location = "village"; },
    (t: GameState) => { asRecord(result(t)).extra = true; }, (t: GameState) => { asRecord(log(t).routeWork).extra = true; },
    (t: GameState) => { asRecord(log(t).routeWork).ruleId = "unknown"; }, (t: GameState) => { asRecord(log(t).routeWork).location = "village"; },
    (t: GameState) => { result(t).actorId = "absent"; }, (t: GameState) => { result(t).logId = t.nextId; },
    (t: GameState) => { result(t).logId = t.logs[0].id; }, (t: GameState) => { result(t).completedAt--; },
    (t: GameState) => { log(t).type = "social"; }, (t: GameState) => { log(t).actors.push("mio"); },
    (t: GameState) => { log(t).witnesses = []; }, (t: GameState) => { log(t).witnesses.push("aki"); },
    (t: GameState) => { log(t).coinTrade = { choice: "sell-scrap", termsId: "village-coins-v1" }; },
    (t: GameState) => { log(t).coinTransfer = { from: "aki", to: "mio", amount: 1, location: "meadow" }; },
    (t: GameState) => { t.logs[0].routeWork = { ...log(t).routeWork! }; },
    (t: GameState) => { person(t).suspended = structuredClone(person(repair(field())).action); }]) rejectSave(s, mutate);
  const translated = structuredClone(s); log(translated).title = "別の言葉"; log(translated).text = "道の整備が完了した。";
  assert.deepEqual(deserialize(serialize(translated)), translated);
  rejectSave(quiet(), t => { asRecord(t).routeWorks = { version: 1 }; });
});

test("Completion log identity cannot be reused by current, held or retained action references", async t => {
  const cases: [string, () => { state: GameState; reference: number }][] = [
    ["current action", () => {
      const state = assignMove(completed(), "garden", "mio");
      return { state, reference: person(state, "mio").action!.id };
    }],
    ["held action", () => {
      const state = pause(assignMove(completed(), "garden", "mio"), "mio");
      return { state, reference: person(state, "mio").suspended!.id };
    }],
    ["stale helper target", () => {
      let state = completed(); person(state).location = "home";
      state = act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" });
      state = act(state, { type: "assign", residentIds: ["mio"], kind: "help", target: "aki" });
      const reference = person(state, "mio").action!.targetActionId!;
      state = act(state, { type: "cancel", residentId: "aki" });
      return { state, reference };
    }],
    ["retained autonomous leisure", () => {
      let state = act(completed(), { type: "routine", residentId: "mio", routine: { workRole: "support", home: "home", leisure: "quiet" } });
      state = act(state, { type: "policy", residentId: "mio", policy: "balanced" });
      state = advance(state, 1);
      assert.equal(person(state, "mio").action!.autonomyReason!.code, "quiet");
      const reference = state.autonomy!.leisure.mio.actionId;
      state = act(state, { type: "cancel", residentId: "mio" });
      return { state, reference };
    }],
    ["reciprocal conversation peer", () => {
      let state = completed(); person(state).location = "home";
      state = finish(act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" }));
      state = act(state, { type: "discuss-craft", residentIds: ["aki", "mio"], craftId: state.life!.crafts.at(-1)!.id });
      return { state, reference: person(state).action!.topic!.peerActionId };
    }],
  ];
  for (const [name, setup] of cases) await t.test(name, () => {
    const { state, reference } = setup();
    assert.deepEqual(deserialize(serialize(state)), state);
    rejectSave(state, broken => {
      const entry = broken.routeWorks!.riverPath, log = broken.logs.find(l => l.id === entry.logId)!;
      entry.logId = log.id = reference;
    });
  });
});

test("Recruited builders and witnesses cannot acquire a completion before their membership or log order", () => {
  let s = fixture("coin-transfer-controlled-recruited-peer-valid-gift-v3.json");
  for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; }
  const id = "village-guide"; person(s, id).location = "meadow"; pack(s, id).scrap = 2;
  s = finish(repair(s, id), id);
  assert.deepEqual(deserialize(serialize(s)), s);
  for (const earlier of [true, false]) {
    const t = structuredClone(s), entry = t.routeWorks!.riverPath, l = t.logs.find(v => v.id === entry.logId)!;
    entry.completedAt = l.time = person(t, id).joinedAt! - (earlier ? 1 : 0);
    if (!earlier) { entry.logId = l.id = person(t, id).joinedLogId! - 1; }
    assert.equal(validRouteWorks(t), false);
    assert.throws(() => deserialize(serialize(t)), /保存データ/);
  }
  const witness = structuredClone(s), entry = witness.routeWorks!.riverPath, l = witness.logs.find(v => v.id === entry.logId)!;
  entry.actorId = "aki"; l.actors = ["aki"]; l.witnesses = ["aki", id];
  entry.completedAt = l.time = person(witness, id).joinedAt! - 1;
  assert.equal(validRouteWorks(witness), false);
});

test("Unused legacy 1–3 saves gain no road state, and genuine old45 raw exports remain exact", () => {
  for (const version of [1, 2, 3] as const) {
    const s = quiet(); s.version = version;
    const read = deserialize(serialize(s));
    assert.equal(read.routeWorks, undefined);
    assert.equal(getRouteWorkSummary(read).completed, undefined);
    assert.equal(read.logs.some(l => l.routeWork !== undefined), false);
  }
  const initial = fixture("coin-transfer-genuine-common-current-five-v3.json");
  assert.equal(hash(pause(initial)), "aaf1b52020f156ba27812f78106fa0d35518c6e1ec48b581c0ac6f0389c0fe61");
  let s = act(initial, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "scrap", amount: 1 });
  s = assignMove(s, "village", "mio", ["road", "meadow"]);
  assert.equal(person(s, "mio").action!.duration, 51);
  s = advance(advance(s, 40), 11);
  s = act(s, { type: "region", residentId: "mio", npcId: "village-trader", choice: "trade-medicine" });
  s = assignMove(s, "home", "mio", ["meadow", "road"]);
  assert.equal(person(s, "mio").action!.duration, 51);
  s = advance(s, 51);
  s = act(s, { type: "transfer", residentId: "mio", from: "mio", to: "base", resource: "medicine", amount: 1 });
  assert.equal(hash(s), "f6a71f1fa78debdce4a7e5a2869320bb3720c85dc2f38dc3fd8271db5fe411a4");
  assert.equal(s.routeWorks, undefined);
});
