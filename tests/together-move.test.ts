import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, command, createGame, deserialize, inspectTogetherMove, serialize, estimateTravelMinutes, RIVER_PATH_RULE } from "../src/game/engine.ts";
import { ownFreeResources, totalResources } from "../src/game/inventory.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "mio") => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id = "ren") => s.inventory!.packs[id];
const ids = ["mio", "ren"];
function act(s: GameState, cmd: Command) {
  const result = command(s, cmd); assert.equal(result.error, undefined, result.error); return result.state;
}
function quiet(seed = 5601) {
  const s = createGame(seed);
  for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; }
  return s;
}
const together = (s: GameState, target: LocationId = "village", via?: LocationId[]) => act(s, { type: "move-together", residentIds: ids, target, ...(via ? { via } : {}) });
function finish(s: GameState, id = "mio") {
  const job = person(s, id).action?.id; assert.ok(job);
  for (let n = 0; n < 1000; n++) { if (person(s, id).action?.id !== job) return s; s = advance(s, 1); }
  assert.fail("actual action boundary not reached");
}
function reject(s: GameState, cmd: unknown) {
  const raw = serialize(s), result = command(s, cmd as Command);
  assert.ok(result.error); assert.strictEqual(result.state, s); assert.equal(serialize(s), raw);
}
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const broken = structuredClone(s); mutate(broken);
  assert.throws(() => deserialize(serialize(broken)), error => {
    assert.ok(error instanceof Error && !(error instanceof TypeError)); assert.match(error.message, /保存データ.*不正/); return true;
  });
}
// Explicitly controlled UNIT boundaries. Public-command travel/payment is used
// in the first test; location, injury, stock or KO edits below are not UI play.
function field(location: LocationId = "meadow") {
  const s = quiet(); for (const id of ids) person(s, id).location = location;
  pack(s).scrap = 16; pack(s, "mio").food = 1; return s;
}
function fixture(name: string) { return deserialize(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")); }
const noLinks = (s: GameState) => s.residents.every(r => !r.action?.together && !r.suspended?.together);

test("A real one-trip command preserves individual bodies and supplies, and shares every edge max", () => {
  let s = act(quiet(), { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "scrap", amount: 4 });
  s = act(s, { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "ingredients", amount: 8 });
  s = act(s, { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "food", amount: 6 });
  const previewBefore = serialize(s), preview = inspectTogetherMove(s, ids, "village", ["meadow"]);
  assert.equal(serialize(s), previewBefore); assert.equal(s.version, 3); assert.equal(preview.error, undefined);
  assert.equal(preview.residents.length, 2); assert.ok(preview.residents[1].individualMinutes > preview.residents[0].individualMinutes);
  const before = structuredClone(s), total = totalResources(s);
  s = together(s, "village", ["meadow"]);
  assert.equal(s.version, 5); assert.equal(s.minutes, before.minutes); assert.equal(s.seed, before.seed); assert.equal(s.nextId, before.nextId + 2);
  assert.deepEqual(s.inventory, before.inventory); assert.deepEqual(s.resources, before.resources);
  for (const id of ids) { const { action, ...r } = person(s, id), { action: _old, ...old } = person(before, id); assert.deepEqual(r, old); assert.ok(action!.together); }
  let boundaries = 0;
  while (person(s).action?.together) {
    const prior = person(s).location;
    s = advance(s, 1);
    assert.equal(person(s).location, person(s, "ren").location);
    if (person(s).action && person(s, "ren").action) {
      assert.deepEqual([person(s).action!.segment, person(s).action!.segmentProgress, person(s).action!.segmentDuration, person(s).action!.duration],
        [person(s, "ren").action!.segment, person(s, "ren").action!.segmentProgress, person(s, "ren").action!.segmentDuration, person(s, "ren").action!.duration]);
    }
    if (prior !== person(s).location) boundaries++;
    s = deserialize(serialize(s));
  }
  assert.ok(boundaries >= 3); assert.equal(person(s).location, "village"); assert.equal(person(s, "ren").action, null);
  assert.equal(s.minutes - before.minutes, preview.minutes); assert.deepEqual(totalResources(s), total); assert.ok(noLinks(s));
});

test("Arrival and local witnesses do not depend on resident array order, including the dangerous destination", () => {
  const initial = fixture("second-encounter-public-local-retreat-v4.json");
  // Controlled endpoints, stock and idle jobs isolate the actual pair arrival.
  for (const id of ids) { const r = person(initial, id); r.location = "meadow"; r.action = r.suspended = null; r.hp = r.hunger = r.energy = 100; }
  pack(initial).scrap = 8;
  const results = [false, true].map(reverse => {
    let s = structuredClone(initial); if (reverse) s.residents.reverse();
    s = together(s, "ridge"); const start = s.minutes;
    s = finish(s);
    assert.equal(person(s).location, "ridge"); assert.equal(person(s, "ren").location, "ridge");
    const contacts = s.logs.filter(l => l.time > start && l.title === "尾根の見張りと遭遇"); assert.equal(contacts.length, 2);
    for (const log of contacts) for (const id of ids) assert.ok(log.witnesses.includes(id));
    assert.equal(person(s).hp, 100); assert.equal(person(s, "ren").hp, 100); // contact minute never strikes
    return { minutes: s.minutes, positions: ids.map(id => person(s, id).location),
      facts: contacts.map(l => ({ actor: l.actors[0], witnesses: [...l.witnesses].sort() })).sort((a, b) => a.actor.localeCompare(b.actor)) };
  });
  assert.deepEqual(results[0], results[1]);
});

test("Every failed new reservation is atomic, including identity exhaustion and full old slots", () => {
  const base = quiet();
  const cases: unknown[] = [
    { type: "move-together", residentIds: [], target: "ridge" },
    { type: "move-together", residentIds: ["mio", "mio"], target: "ridge" },
    { type: "move-together", residentIds: ["mio", "absent"], target: "ridge" },
    { type: "move-together", residentIds: ids, target: "home" },
    { type: "move-together", residentIds: ids, target: "unknown" },
    { type: "move-together", residentIds: ids, target: "ridge", via: ["unknown"] },
    { type: "move-together", residentIds: ids, target: "ridge", cargo: { resource: "food", amount: 1 } },
  ];
  cases.forEach(cmd => reject(base, cmd));
  for (const mutate of [
    (s: GameState) => { person(s, "ren").location = "bedroom"; },
    (s: GameState) => { person(s, "ren").hp = 0; },
    (s: GameState) => { s.nextId = Number.MAX_SAFE_INTEGER - 1; },
  ]) { const s = quiet(); mutate(s); reject(s, { type: "move-together", residentIds: ids, target: "ridge" }); }
  let sleeping = act(quiet(), { type: "assign", residentIds: ["ren"], kind: "sleep" });
  reject(sleeping, { type: "move-together", residentIds: ids, target: "ridge" });
  let moving = act(base, { type: "assign", residentIds: ["ren"], kind: "move", target: "village" });
  reject(moving, { type: "move-together", residentIds: ids, target: "ridge" });
  let full = act(base, { type: "assign", residentIds: ["ren"], kind: "eat" });
  full = act(full, { type: "assign", residentIds: ["ren"], kind: "rest" });
  reject(full, { type: "move-together", residentIds: ids, target: "ridge" });
});

test("Old held material reservations survive the pair and full-slot pause fails without detaching", () => {
  let s = act(quiet(), { type: "assign", residentIds: ["mio"], kind: "cook" });
  s = act(s, { type: "pause", residentId: "mio" });
  const held = structuredClone(person(s).suspended), free = ownFreeResources(s, "mio");
  s = together(s);
  assert.deepEqual(person(s).suspended, held); assert.deepEqual(ownFreeResources(s, "mio"), free);
  reject(s, { type: "pause", residentId: "mio" });
  assert.ok(person(s, "ren").action!.together);
  s = deserialize(serialize(s)); assert.deepEqual(person(s).suspended, held);
  s = act(s, { type: "cancel", residentId: "mio", actionId: person(s).action!.id });
  assert.deepEqual(person(s).suspended, held); assert.ok(noLinks(s)); assert.ok(person(s, "ren").action);
});

for (const progress of [0, 1]) test(`Pause at progress ${progress} detaches both, preserves begun duration, and resumes only the individual`, () => {
  let s = together(field(), "village"); if (progress) s = advance(s, progress);
  const before = structuredClone(s), peer = structuredClone(person(s, "ren").action!), job = structuredClone(person(s).action!);
  s = act(s, { type: "pause", residentId: "mio" });
  assert.ok(noLinks(s)); assert.equal(s.minutes, before.minutes); assert.equal(person(s).action, null);
  const held = structuredClone(person(s).suspended!); assert.equal(held.id, job.id); assert.equal(held.progress, job.progress); assert.equal(held.segmentDuration, job.segmentDuration);
  assert.equal(person(s, "ren").action!.id, peer.id); assert.equal(person(s, "ren").action!.progress, peer.progress);
  s = act(s, { type: "resume", residentId: "mio" });
  assert.ok(noLinks(s)); assert.equal(person(s).action!.id, job.id); assert.equal(person(s).action!.progress, progress);
  if (progress) assert.equal(person(s).action!.segmentDuration, job.segmentDuration);
  else assert.ok(person(s).action!.segmentDuration! < job.segmentDuration!);
  assert.deepEqual(deserialize(serialize(s)), s);
});

for (const instruction of ["cancel", "new-order"] as const) test(`${instruction} changes only the requested person's job; peer keeps id, path and elapsed travel`, () => {
  let s = together(field(), "village"); s = advance(s, 1);
  const peer = structuredClone(person(s, "ren").action!), original = structuredClone(person(s).action!);
  s = instruction === "cancel" ? act(s, { type: "cancel", residentId: "mio" })
    : act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home" });
  assert.ok(noLinks(s)); const after = person(s, "ren").action!;
  assert.deepEqual({ id: after.id, path: after.path, progress: after.progress, segmentProgress: after.segmentProgress, segmentDuration: after.segmentDuration },
    { id: peer.id, path: peer.path, progress: peer.progress, segmentProgress: peer.segmentProgress, segmentDuration: peer.segmentDuration });
  if (instruction === "new-order") { assert.equal(person(s).suspended!.id, original.id); assert.equal(person(s).suspended!.together, undefined); }
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Detached edge zero recalculates personal speed immediately, while future legs become independent", () => {
  let s = together(field(), "home", ["village"]);
  const shared = person(s).action!.segmentDuration!;
  s = act(s, { type: "cancel", residentId: "ren" });
  assert.equal(person(s).action!.segmentProgress, 0); assert.ok(person(s).action!.segmentDuration! < shared);
  const expected = act(field(), { type: "assign", residentIds: ["mio"], kind: "move", target: "home", via: ["village"] });
  assert.equal(person(s).action!.duration, person(expected).action!.duration);
});

test("A base KO/revival minute breaks the link before snapshot and blocks only the recovering person", () => {
  let s = together(quiet(), "village");
  person(s).hunger = 0; person(s).hp = 0.01;
  const before = structuredClone(s), duration = person(s, "ren").action!.segmentDuration!;
  // Put the pair on the last minute of this edge, keeping a valid shared save.
  for (const id of ids) { person(s, id).action!.segmentProgress = duration - 1; person(s, id).action!.progress = duration - 1; }
  s = advance(s, 1);
  assert.ok(noLinks(s)); assert.equal(person(s).location, "home"); assert.equal(person(s).action!.progress, duration - 1);
  assert.equal(person(s, "ren").location, "road"); assert.ok(s.pauseReason?.includes("意識"));
  assert.equal(s.minutes, before.minutes + 1); assert.deepEqual(deserialize(serialize(s)), s);
});

test("Rescue and KO use the owner's old two-slot rules, without erasing the peer or old material locks", () => {
  let s = field(); person(s, "aki").location = "meadow";
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "eat" });
  s = act(s, { type: "pause", residentId: "mio" });
  const held = structuredClone(person(s).suspended!);
  s = together(s, "village"); person(s).hp = 30;
  const peer = structuredClone(person(s, "ren").action!);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "rescue", target: "mio" });
  assert.ok(noLinks(s)); assert.equal(person(s).action, null); assert.deepEqual(person(s).suspended, held);
  assert.equal(person(s, "ren").action!.id, peer.id); assert.equal(person(s, "ren").action!.progress, peer.progress);
  assert.deepEqual(deserialize(serialize(s)), s);
  reject(s, { type: "move-together", residentIds: ids, target: "home" });
  // Separate controlled field starvation: no base revival and no third slot.
  let ko = together(field(), "village"); person(ko).hp = 0.01; person(ko).hunger = 0;
  const otherJob = person(ko, "ren").action!.id;
  ko = advance(ko, 1);
  assert.equal(person(ko).hp, 0); assert.ok(noLinks(ko)); assert.equal(person(ko, "ren").action!.id, otherJob);
});

for (const reversed of [false, true]) test(`Real combat KO retains ordinary two-slot behavior, array reverse=${reversed}`, () => {
  let s = field("shelter");
  for (const id of ids) {
    person(s, id).hp = 1; pack(s, id).food = 1;
    s = act(s, { type: "assign", residentIds: [id], kind: "eat" });
    s = act(s, { type: "pause", residentId: id });
    person(s, id).location = "ruins";
  }
  if (reversed) s.residents.reverse();
  const held = new Map(ids.map(id => [id, structuredClone(person(s, id).suspended)]));
  s = together(s, "ridge"); const jobs = new Map(ids.map(id => [id, person(s, id).action!.id]));
  s = advance(s, 1);
  const fallen = ids.find(id => person(s, id).hp === 0)!; assert.ok(fallen);
  const peer = ids.find(id => id !== fallen)!;
  assert.ok(noLinks(s)); assert.deepEqual(person(s, fallen).suspended, held.get(fallen));
  assert.equal(person(s, fallen).action, null); assert.equal(person(s, peer).action!.id, jobs.get(peer));
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Roadwork completion updates a paired zero segment and future estimates once, retaining a begun edge", () => {
  for (const walked of [0, 1]) for (const reverse of [false, true]) {
    let s = field();
    if (reverse) s.residents.reverse(); person(s, "aki").location = "meadow"; pack(s, "aki").scrap = 2;
    s = act(s, { type: "assign", residentIds: ["aki"], kind: "repair-route", target: RIVER_PATH_RULE.id });
    s = advance(s, 39 - walked);
    // Finish road->meadow exactly when construction completes; the newly
    // reserved meadow->village segment must use 14, regardless of array order.
    if (walked === 0) {
      for (const id of ids) person(s, id).location = "road";
      s = together(s, "village", ["meadow"]);
      const d = person(s).action!.segmentDuration!;
      for (const id of ids) { const a = person(s, id).action!; a.progress = d - 1; a.segmentProgress = d - 1; }
    } else s = together(s, "village");
    const old = person(s).action!.segmentDuration!;
    s = advance(s, 1);
    if (walked) { assert.equal(s.routeWorks, undefined); s = advance(s, 1); }
    assert.ok(s.routeWorks); assert.ok(person(s).action!.together);
    assert.equal(person(s).action!.duration, person(s, "ren").action!.duration);
    assert.equal(person(s).action!.segmentDuration, person(s, "ren").action!.segmentDuration);
    if (walked) assert.equal(person(s).action!.segmentDuration, old);
    else {
      assert.equal(person(s).location, "meadow");
      assert.equal(person(s).action!.segmentProgress, 0);
      assert.equal(person(s).action!.segmentDuration, 18); // ceil(14 * Ren's 1.25 load)
    }
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Version five survives after the pair, secondary introduction, reload and recruitment", () => {
  let s = together(quiet(), "garden"); s = finish(s);
  assert.ok(noLinks(s)); assert.equal(s.version, 5); s = deserialize(serialize(s)); assert.equal(s.version, 5); assert.equal(s.secondaryEncounter, undefined);
  // Controlled local setup, then real 20-minute introduction and social inputs.
  person(s, "aki").location = "ridge";
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "approach-ridge" }); s = finish(s, "aki");
  assert.equal(s.version, 5); assert.ok(s.secondaryEncounter); assert.deepEqual(deserialize(serialize(s)), s);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "attack", encounterId: "ridge-watch" });
  assert.deepEqual(deserialize(serialize(s)), s);
  s = act(s, { type: "cancel", residentId: "aki" }); person(s, "aki").location = "village"; pack(s, "aki").food = 3;
  s = act(s, { type: "region", residentId: "aki", npcId: "village-guide", choice: "talk" });
  s = act(s, { type: "region", residentId: "aki", npcId: "village-guide", choice: "deliver" });
  s = act(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  assert.equal(s.version, 5); assert.equal(s.residents.length, 4); assert.deepEqual(deserialize(serialize(s)), s);
});

test("Version five without a second encounter permits recruitment; joining never downgrades it", () => {
  let s = finish(together(quiet(), "garden"));
  person(s, "aki").location = "village"; pack(s, "aki").food = 3;
  s = act(s, { type: "region", residentId: "aki", npcId: "village-guide", choice: "talk" });
  s = act(s, { type: "region", residentId: "aki", npcId: "village-guide", choice: "deliver" });
  s = act(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  assert.equal(s.version, 5); assert.equal(s.secondaryEncounter, undefined); assert.deepEqual(deserialize(serialize(s)), s);
});

test("Old v3/v4 worlds and independent moves read unchanged, while new linked v5 is exact", () => {
  for (const name of ["guard-agreement-genuine-home-1920-v3.json", "second-encounter-public-local-retreat-v4.json"]) {
    const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), s = deserialize(raw);
    assert.equal(serialize(s), JSON.stringify(JSON.parse(raw), null, 2));
    const before = serialize(s); inspectTogetherMove(s, ids, "ridge"); assert.equal(serialize(s), before);
  }
  const old = act(quiet(), { type: "assign", residentIds: ids, kind: "move", target: "village" });
  assert.equal(old.version, 3); assert.ok(noLinks(old)); assert.deepEqual(deserialize(serialize(old)), old);
  const v4 = fixture("second-encounter-public-local-retreat-v4.json");
  for (const id of ids) { person(v4, id).location = "meadow"; person(v4, id).action = person(v4, id).suspended = null; }
  const paired = together(v4, "village"); assert.equal(paired.version, 5); assert.deepEqual(deserialize(serialize(paired)), paired);
});

test("New link validation rejects malformed metadata, asymmetric geometry, held/automatic jobs and impossible time", () => {
  const s = advance(together(field(), "home", ["village"]), 1);
  const mutations: ((b: GameState) => void)[] = [
    b => { b.version = 3; }, b => { b.version = 4; },
    b => { b.nextId += 0.5; }, b => { b.nextId = Number.MAX_SAFE_INTEGER + 1; },
    b => { delete person(b).action!.together; },
    b => { person(b).action!.together!.peerResidentId = "mio"; },
    b => { person(b).action!.together!.peerResidentId = "absent"; },
    b => { person(b).action!.together!.peerActionId += 100; },
    b => { Object.assign(person(b).action!.together!, { extra: true }); },
    b => { person(b).action!.together = null as never; },
    b => { person(b).suspended = person(b).action; person(b).action = null; },
    b => { person(b).action!.automatic = true; },
    b => { person(b).hp = 0; }, b => { person(b).location = "home"; },
    b => { person(b).action!.segment = 1; }, b => { person(b).action!.segmentProgress = 0; },
    b => { person(b).action!.duration++; }, b => { person(b).action!.path![0] = "home"; },
    b => { Object.assign(person(b).action!, { cargo: { resource: "food", amount: 1 } }); },
    b => { for (const id of ids) { const a = person(b, id).action!; a.progress = 0; a.segmentProgress = 1; } },
    b => { for (const id of ids) { const a = person(b, id).action!; a.duration = a.progress + a.segmentDuration! - a.segmentProgress!; } },
  ];
  for (const mutate of mutations) rejectSave(s, mutate);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("The linked final edge saves exact remaining time and rejects matching but impossible tail estimates", () => {
  const s = advance(together(field(), "village"), 1);
  rejectSave(s, b => { for (const id of ids) person(b, id).action!.duration++; });
  assert.deepEqual(deserialize(serialize(s)), s);
  const reference = deserialize(serialize(s));
  assert.deepEqual(advance(s, 5), advance(reference, 5));
  assert.ok(estimateTravelMinutes(s, "ren", "village"));
});


test("A paused carrier may leave a held rescue, but neither a moving carrier nor its patient may form a pair", () => {
  let s = field(); person(s, "aki").location = "meadow"; person(s).hp = 30;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "rescue", target: "mio" });
  reject(s, { type: "move-together", residentIds: ["aki", "ren"], target: "village" });
  reject(s, { type: "move-together", residentIds: ids, target: "village" });
  s = act(s, { type: "pause", residentId: "aki" });
  const held = structuredClone(person(s, "aki").suspended!);
  s = act(s, { type: "move-together", residentIds: ["aki", "ren"], target: "village" });
  assert.deepEqual(person(s, "aki").suspended, held); assert.ok(person(s, "ren").action!.together);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Returning pairs record both present witnesses for both arrival logs and return experiences", () => {
  let s = together(field(), "home"); const start = s.minutes;
  s = finish(s);
  const logs = s.logs.filter(log => log.time > start && log.title === "移動を終えて" && ids.includes(log.actors[0]));
  assert.equal(logs.length, 2);
  for (const log of logs) for (const id of ids) assert.ok(log.witnesses.includes(id));
  const returns = s.life!.events.filter(event => event.kind === "return" && event.time > start);
  assert.equal(returns.length, 2);
  for (const event of returns) for (const id of ids) assert.ok(event.witnesses.includes(id));
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("The next shared edge snapshots current personal load, even when the slower resident has changed", () => {
  let s = together(field(), "home", ["village"]);
  s = advance(s, 1); const first = person(s).action!.segmentDuration!;
  // Controlled UNIT load change; local transfer remains prohibited mid-move.
  pack(s).scrap = 0; pack(s, "mio").scrap = 40;
  while (person(s).action!.segment === 0) s = advance(s, 1);
  assert.equal(person(s).location, "village"); assert.equal(person(s, "ren").location, "village");
  assert.equal(person(s).action!.segmentDuration, person(s, "ren").action!.segmentDuration);
  const individual = act({ ...structuredClone(s), residents: s.residents.map(r => ({ ...structuredClone(r), action: null, suspended: null })) },
    { type: "assign", residentIds: ["mio"], kind: "move", target: "home", via: [person(s).action!.path![person(s).action!.segment!]] });
  assert.equal(person(s).action!.segmentDuration, person(individual).action!.segmentDuration);
  assert.ok(first > 0); assert.deepEqual(deserialize(serialize(s)), s);
});
