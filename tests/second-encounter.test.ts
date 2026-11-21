import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advance, command, createGame, deserialize, serialize, estimateTravelMinutes, getCombatants,
  getCombatGroups, getEncounter, getEncounters, getPresentEncounterAt,
  getLocalEncounter, inspectRidgeApproach, SECOND_ENCOUNTER_RULE,
} from "../src/game/engine.ts";
import { getTimeControls } from "../src/game/time-controls.ts";
import type { Command, GameState } from "../src/game/types.ts";

// These are controlled UNIT boundaries, including explicit location/body/item
// edits. They are not genuine UI play, API-prepared UI fixtures, or screenshots.
const resident = (s: GameState, id: string) => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id: string) => s.inventory!.packs[id];
const first = "ruins-guard" as const;
const second = "ridge-watch" as const;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function rejectCommand(s: GameState, cmd: unknown) {
  const raw = serialize(s), result = command(s, cmd as Command);
  assert.ok(result.error);
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), raw);
}
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const broken = structuredClone(s);
  mutate(broken);
  assert.throws(() => deserialize(serialize(broken)), error => {
    assert.ok(error instanceof Error && !(error instanceof TypeError));
    assert.match(error.message, /保存データ.*不正/);
    return true;
  });
}
function quiet(seed = 5205): GameState {
  const s = createGame(seed);
  for (const r of s.residents) {
    r.policy = "rest";
    r.hunger = r.energy = 100;
  }
  return s;
}
function approach(s: GameState, id = "aki") {
  return act(s, { type: "assign", residentIds: [id], kind: "approach-ridge" });
}
function finishCurrent(s: GameState, id = "aki") {
  const job = resident(s, id).action?.id;
  assert.ok(job);
  for (let n = 0; n < 1000; n++) {
    if (resident(s, id).action?.id !== job) return s;
    s = advance(s, 1);
  }
  assert.fail("Controlled job did not reach its real boundary");
}
function introduced(seed = 5205): GameState {
  const s = quiet(seed);
  resident(s, "aki").location = "ridge";
  return finishCurrent(approach(s));
}
function twoFronts(seed = 5205): GameState {
  const s = introduced(seed);
  resident(s, "ren").location = "ruins";
  return s;
}
function attack(s: GameState, id: string, encounterId?: typeof first | typeof second) {
  return act(s, { type: "assign", residentIds: [id], kind: "attack", ...(encounterId ? { encounterId } : {}) });
}
function defend(s: GameState, id: string, encounterId?: typeof first | typeof second) {
  return act(s, { type: "assign", residentIds: [id], kind: "defend", ...(encounterId ? { encounterId } : {}) });
}
function pause(s: GameState, id: string) { return act(s, { type: "pause", residentId: id }); }
function introLog(s: GameState) { return s.logs.find(log => log.id === s.secondaryEncounter!.logId)!; }

test("Old genuine v3 reads and pure encounter queries add no second world, target or raw fields", () => {
  const raw = readFileSync(new URL("./fixtures/guard-agreement-genuine-home-1920-v3.json", import.meta.url), "utf8");
  const s = deserialize(raw), before = serialize(s);
  assert.equal(s.version, 3);
  assert.equal(s.secondaryEncounter, undefined);
  assert.equal(getEncounter(s, second), undefined);
  assert.equal(getPresentEncounterAt(s, "ridge"), undefined);
  assert.equal(getLocalEncounter(s, "ridge"), undefined);
  assert.deepEqual(getEncounters(s).map(e => e.id), [first]);
  assert.ok(inspectRidgeApproach(s, ["aki"]).error);
  assert.equal(serialize(s), before);
  assert.equal(before, JSON.stringify(JSON.parse(raw), null, 2));
  assert.equal(createGame(5205).secondaryEncounter, undefined);
});

test("The explicit first target preserves old job, ID, RNG and continuation bytes", () => {
  const s = quiet(); resident(s, "ren").location = "ruins";
  for (const kind of ["attack", "defend"] as const) {
    const missing = act(s, { type: "assign", residentIds: ["ren"], kind });
    const explicit = act(s, { type: "assign", residentIds: ["ren"], kind, encounterId: first });
    assert.equal(resident(explicit, "ren").action?.encounterId, undefined);
    assert.equal(serialize(explicit), serialize(missing));
    assert.equal(serialize(advance(explicit, 1)), serialize(advance(missing, 1)));
  }
});

test("Ridge approach pauses and resumes the same v3 job, then introduces once without a first hit or cache", () => {
  let s = quiet(); resident(s, "aki").location = "ridge";
  assert.equal(SECOND_ENCOUNTER_RULE.id, second);
  assert.equal(SECOND_ENCOUNTER_RULE.location, "ridge");
  const before = serialize(s); assert.equal(inspectRidgeApproach(s, ["aki"]).error, undefined); assert.equal(serialize(s), before);
  s = approach(s); const id = resident(s, "aki").action!.id;
  assert.equal(resident(s, "aki").action!.duration, 20);
  s = advance(s, 5); assert.equal(s.version, 3); assert.equal(s.secondaryEncounter, undefined);
  s = pause(s, "aki"); const held = structuredClone(resident(s, "aki").suspended);
  assert.deepEqual(deserialize(serialize(s)), s);
  s = act(s, { type: "resume", residentId: "aki" });
  assert.equal(resident(s, "aki").action!.id, id); assert.equal(resident(s, "aki").action!.progress, 5);
  assert.equal(held!.id, id);
  const seed = s.seed, start = s.minutes, resources = structuredClone(s.resources), inventory = structuredClone(s.inventory), flags = structuredClone(s.flags), enemy = structuredClone(s.enemy);
  s = finishCurrent(s);
  assert.equal(s.minutes, start + 15); assert.equal(s.version, 4);
  assert.equal(s.seed, seed); assert.equal(resident(s, "aki").hp, 100);
  assert.deepEqual(s.resources, resources); assert.deepEqual(s.inventory, inventory); assert.deepEqual(s.flags, flags); assert.deepEqual(s.enemy, enemy);
  assert.equal(s.secondaryEncounter!.hp, 60); assert.equal(s.secondaryEncounter!.defeated, false);
  assert.equal(s.secondaryEncounter!.introducedAt, s.minutes); assert.equal(s.secondaryEncounter!.actorId, "aki");
  const log = introLog(s); assert.equal(log.type, "explore"); assert.equal(log.time, s.minutes);
  assert.deepEqual(log.encounter, { id: second, location: "ridge" });
  assert.deepEqual(log.actors, ["aki"]); assert.deepEqual(log.witnesses, ["aki"]);
  assert.ok(s.pauseReason); assert.equal(getTimeControls(s).combat, true);
  assert.deepEqual(deserialize(serialize(s)), s);
  rejectCommand(s, { type: "assign", residentIds: ["aki"], kind: "approach-ridge" });
  assert.equal(s.logs.filter(l => l.id === s.secondaryEncounter!.logId).length, 1);
});

test("Approach rejects wrong selection, location, movement, patient and an occupied first site atomically", () => {
  const local = quiet(); resident(local, "aki").location = "ridge";
  for (const ids of [[], ["aki", "aki"], ["aki", "mio"], ["absent"]]) {
    assert.ok(inspectRidgeApproach(local, ids).error);
    rejectCommand(local, { type: "assign", residentIds: ids, kind: "approach-ridge" });
  }
  for (const change of [
    (s: GameState) => { resident(s, "aki").location = "home"; },
    (s: GameState) => { resident(s, "aki").hp = 0; },
    (s: GameState) => { s.enemy.location = "ridge"; },
  ]) { const s = structuredClone(local); change(s); rejectCommand(s, { type: "assign", residentIds: ["aki"], kind: "approach-ridge" }); }
  const oldCollision = structuredClone(local); oldCollision.enemy.location = "ridge";
  assert.deepEqual(deserialize(serialize(oldCollision)), oldCollision);
  let moving = act(local, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  rejectCommand(moving, { type: "assign", residentIds: ["aki"], kind: "approach-ridge" });
  const patient = structuredClone(local); resident(patient, "aki").hp = 30; resident(patient, "ren").location = "ridge";
  moving = act(patient, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
  rejectCommand(moving, { type: "assign", residentIds: ["aki"], kind: "approach-ridge" });
});

test("Dynamic danger, real knockout and rescue retain current approach plus an older reserved cook", () => {
  let s = quiet();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "cook" });
  s = pause(s, "aki");
  resident(s, "aki").location = "ridge"; // Controlled unit relocation, not normal travel.
  s = approach(s); s = advance(s, 5);
  const current = structuredClone(resident(s, "aki").action), held = structuredClone(resident(s, "aki").suspended);
  assert.equal(current!.kind, "approach-ridge"); assert.equal(current!.progress, 5);
  assert.equal(held!.kind, "cook"); assert.deepEqual(held!.reserved, { ingredients: 2 });
  const resources = structuredClone(s.resources), inventory = structuredClone(s.inventory);
  // Place the existing first enemy here and lower HP for the actual combat KO.
  // This is a controlled edge setup, not an API-prepared or genuine UI fixture.
  s.enemy.location = "ridge"; resident(s, "aki").hp = 1;
  s = advance(s, 1);
  assert.equal(resident(s, "aki").hp, 0);
  assert.deepEqual(resident(s, "aki").action, current); assert.deepEqual(resident(s, "aki").suspended, held);
  assert.equal(s.secondaryEncounter, undefined); assert.deepEqual(deserialize(serialize(s)), s);
  // Resolve only the controlled danger setup so the real rescue can finish.
  s.enemy.hp = 18; s.enemy.defeated = true; resident(s, "ren").location = "ridge";
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
  assert.deepEqual(resident(s, "aki").action, current); assert.deepEqual(resident(s, "aki").suspended, held);
  s = finishCurrent(s, "ren");
  assert.equal(resident(s, "ren").location, "home"); assert.equal(resident(s, "aki").location, "home");
  assert.deepEqual(resident(s, "aki").action, current); assert.deepEqual(resident(s, "aki").suspended, held);
  assert.deepEqual(s.resources, resources); assert.deepEqual(s.inventory, inventory);
  assert.equal(s.version, 3); assert.equal(s.secondaryEncounter, undefined);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("An existing recruitment command keeps introduced v4 and its exact encounter proof loadable", () => {
  let s = introduced();
  resident(s, "mio").location = "village"; pack(s, "mio").food = 3; // Controlled eligibility setup only.
  s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "talk" });
  s = act(s, { type: "region", residentId: "mio", npcId: "village-guide", choice: "deliver" });
  assert.equal(s.version, 4); assert.deepEqual(deserialize(serialize(s)), s);
  const secondary = structuredClone(s.secondaryEncounter), proof = structuredClone(introLog(s)), before = structuredClone(s);
  s = act(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  assert.equal(s.version, 4); assert.equal(s.minutes, before.minutes); assert.equal(s.seed, before.seed);
  assert.equal(s.residents.length, 4); assert.equal(resident(s, "village-guide").sourceNpcId, "village-guide");
  assert.deepEqual(s.secondaryEncounter, secondary); assert.deepEqual(introLog(s), proof);
  assert.deepEqual(s.enemy, before.enemy); assert.deepEqual(s.flags, before.flags);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A second approach cannot create a duplicate introduction after another worker completes", () => {
  let s = quiet(); resident(s, "aki").location = resident(s, "mio").location = "ridge";
  s = approach(s); const duplicate = command(s, { type: "assign", residentIds: ["mio"], kind: "approach-ridge" });
  // An implementation may reject the duplicate reservation or stop it at the
  // common completion check. Both preserve the one-introduction contract.
  if (!duplicate.error) s = duplicate.state;
  for (let n = 0; n < 25 && !s.secondaryEncounter; n++) s = advance(s, 1);
  assert.ok(s.secondaryEncounter);
  const record = structuredClone(s.secondaryEncounter);
  s = advance(s, 5); assert.deepEqual(s.secondaryEncounter, record);
  assert.equal(s.logs.filter(l => l.type === "explore" && l.encounter?.id === second).length, 1);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Two battle groups resolve both local hits in the first-to-second shared RNG order", () => {
  let s = twoFronts(); s = attack(s, "ren"); s = attack(s, "aki", second);
  assert.deepEqual(getCombatGroups(s).map(g => [g.encounter.id, g.residents.map(r => r.id)]), [[first, ["ren"]], [second, ["aki"]]]);
  assert.deepEqual(new Set(getCombatants(s).map(r => r.id)), new Set(["aki", "ren"]));
  const before = structuredClone(s); s = advance(s, 1);
  assert.equal(s.minutes, before.minutes + 1);
  assert.ok(s.enemy.hp < before.enemy.hp); assert.ok(s.secondaryEncounter!.hp < before.secondaryEncounter!.hp);
  assert.ok(resident(s, "ren").hp < 100); assert.ok(resident(s, "aki").hp < 100);
  assert.equal(resident(s, "mio").hp, 100);
  // A golden six-draw LCG sequence asserts order, rather than giving the two
  // sites independent seeds or comparing them to isolated parallel worlds.
  const draws: number[] = []; let seed = before.seed;
  for (let n = 0; n < 6; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; draws.push(seed / 4294967296); }
  assert.equal(s.seed, seed);
  assert.ok(Math.abs(s.enemy.hp - (80 - (17.4 + Math.floor(draws[0] * 5)))) < 1e-9);
  assert.equal(resident(s, "ren").hp, 100 - Math.round((13 + Math.floor(draws[2] * 7)) * 0.65));
  assert.ok(Math.abs(s.secondaryEncounter!.hp - (60 - (7.8 + Math.floor(draws[3] * 5)))) < 1e-9);
  assert.equal(resident(s, "aki").hp, 100 - (10 + Math.floor(draws[5] * 5)));
  const logs = s.logs.slice(before.logs.length).filter(l => l.type === "combat");
  assert.equal(logs.length, 2); assert.equal(logs[0].encounter, undefined); assert.deepEqual(logs[0].actors, ["ren"]); assert.deepEqual(logs[0].witnesses, ["ren"]);
  assert.deepEqual(logs[1].encounter, { id: second, location: "ridge" }); assert.deepEqual(logs[1].actors, ["aki"]); assert.deepEqual(logs[1].witnesses, ["aki"]);
  assert.deepEqual(deserialize(serialize(s)), s);
  assert.deepEqual(advance(deserialize(serialize(before)), 1), s);
});

test("First-front knockout pauses after the second front and home work also receive that minute", () => {
  let s = twoFronts(); resident(s, "ren").hp = 1;
  s = attack(s, "ren"); s = attack(s, "aki", second);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  const home = structuredClone(resident(s, "mio").action), before = structuredClone(s); s = advance(s, 10);
  assert.equal(s.minutes, before.minutes + 1); assert.equal(resident(s, "ren").hp, 0);
  assert.ok(s.secondaryEncounter!.hp < before.secondaryEncounter!.hp); assert.ok(resident(s, "aki").hp < 100);
  assert.equal(resident(s, "mio").action!.id, home!.id); assert.equal(resident(s, "mio").action!.progress, 1);
  assert.deepEqual(resident(s, "mio").action!.reserved, home!.reserved); assert.deepEqual(s.resources, before.resources);
});

test("New second introduction skips only its own first hit while an old first battle continues", () => {
  let s = quiet(); resident(s, "aki").location = "ridge"; s = approach(s); s = advance(s, 19);
  resident(s, "ren").location = "ruins"; s = attack(s, "ren");
  const oldHp = s.enemy.hp, before = s.minutes; s = advance(s, 1);
  assert.equal(s.minutes, before + 1); assert.equal(s.secondaryEncounter!.hp, 60); assert.equal(resident(s, "aki").hp, 100);
  assert.ok(s.enemy.hp < oldHp); assert.ok(resident(s, "ren").hp < 100);
  assert.equal(s.logs.filter(l => l.encounter?.id === second && l.type === "combat").length, 0);
});

test("New first contact does not skip an already engaged second front", () => {
  let s = introduced(); resident(s, "ren").location = "road";
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "move", target: "ruins" });
  // Seven peaceful-to-first travel minutes, while only Aki fights the second.
  // A defender contains the controlled damage without attacking it away.
  s = defend(s, "aki", second); s = advance(s, 7);
  const secondHp = resident(s, "aki").hp, firstHp = s.enemy.hp;
  s = advance(s, 1);
  assert.equal(resident(s, "ren").location, "ruins"); assert.equal(resident(s, "ren").hp, 100);
  assert.equal(s.enemy.hp, firstHp); assert.ok(resident(s, "aki").hp < secondHp);
});

test("Either retirement cleans up only its local current actions and preserves both held orders", () => {
  for (const retiring of [first, second]) {
    let s = twoFronts(); s = pause(defend(s, "ren"), "ren"); s = attack(s, "ren");
    s = pause(defend(s, "aki", second), "aki"); s = attack(s, "aki", second);
    const held = s.residents.map(r => structuredClone(r.suspended));
    if (retiring === first) s.enemy.hp = 19; else s.secondaryEncounter!.hp = 19;
    const before = structuredClone(s); s = advance(s, 1);
    const retiredId = retiring === first ? "ren" : "aki", otherId = retiring === first ? "aki" : "ren";
    assert.equal(getEncounter(s, retiring)!.defeated, true); assert.equal(resident(s, retiredId).action, null);
    assert.equal(resident(s, otherId).action!.id, resident(before, otherId).action!.id);
    assert.deepEqual(s.residents.map(r => r.suspended), held); assert.equal(getTimeControls(s).combat, true);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("First agreement coexists with second manual current or held jobs and preserves their full slots", () => {
  for (const held of [false, true]) {
    let s = twoFronts(); pack(s, "ren").food = 3;
    s = defend(s, "aki", second); if (held) s = pause(s, "aki");
    s = act(s, { type: "auto-combat", enabled: true });
    const secondState = structuredClone(s.secondaryEncounter), jobs = structuredClone([resident(s, "aki").action, resident(s, "aki").suspended]);
    const before = structuredClone(s);
    s = act(s, { type: "guard-agreement", residentIds: ["ren"] });
    assert.equal(s.minutes, before.minutes); assert.equal(s.seed, before.seed); assert.equal(s.autoCombat, true);
    assert.deepEqual(s.enemy, before.enemy); assert.deepEqual(s.secondaryEncounter, secondState);
    assert.deepEqual([resident(s, "aki").action, resident(s, "aki").suspended], jobs);
    assert.equal(pack(s, "ren").food, 0); assert.equal(getTimeControls(s).combat, true);
    assert.deepEqual(s.logs.at(-1)!.actors, ["ren", first]); assert.deepEqual(s.logs.at(-1)!.witnesses, ["ren", first]);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Automatic roles are local, first agreement clears first AI only, and global OFF clears both", () => {
  let s = twoFronts(); pack(s, "ren").food = 3; resident(s, "mio").location = "ridge";
  s = act(s, { type: "auto-combat", enabled: true }); s = advance(s, 1);
  assert.equal(resident(s, "ren").action?.kind, "attack"); assert.equal(resident(s, "ren").action?.encounterId, undefined);
  const ridgeJobs = [resident(s, "aki").action!, resident(s, "mio").action!];
  assert.ok(ridgeJobs.every(a => a.automatic && a.encounterId === second));
  assert.deepEqual(ridgeJobs.map(a => a.kind).sort(), ["attack", "defend"]);
  const prior = structuredClone(s), secondJobs = structuredClone(ridgeJobs);
  const agreed = act(s, { type: "guard-agreement", residentIds: ["ren"] });
  assert.equal(resident(agreed, "ren").action, null); assert.equal(agreed.autoCombat, true);
  assert.deepEqual([resident(agreed, "aki").action, resident(agreed, "mio").action], secondJobs);
  assert.deepEqual(agreed.secondaryEncounter, prior.secondaryEncounter); assert.equal(getTimeControls(agreed).combat, true);
  assert.deepEqual(deserialize(serialize(agreed)), agreed);
  const off = act(s, { type: "auto-combat", enabled: false });
  assert.equal(off.autoCombat, false); assert.ok(off.residents.every(r => !r.action && !r.suspended));
  assert.deepEqual(off.enemy, s.enemy); assert.deepEqual(off.secondaryEncounter, s.secondaryEncounter); assert.equal(off.seed, s.seed);
});

test("A resolved second held target cannot resume against the first, and mixed-location orders are atomic", () => {
  let s = twoFronts();
  for (const encounterId of [first, second]) {
    rejectCommand(s, { type: "assign", residentIds: ["aki", "ren"], kind: "attack", encounterId });
  }
  s = pause(defend(s, "aki", second), "aki");
  s.secondaryEncounter!.hp = 18; s.secondaryEncounter!.defeated = true;
  rejectCommand(s, { type: "resume", residentId: "aki" });
  assert.equal(resident(s, "aki").suspended!.encounterId, second);
  rejectCommand(s, { type: "assign", residentIds: ["aki", "ren"], kind: "attack", encounterId: first });
  rejectCommand(s, { type: "assign", residentIds: ["aki", "ren"], kind: "attack", encounterId: second });
});

test("First agreement does not make a present ridge safe or rewrite a reserved return path", () => {
  let s = twoFronts(); resident(s, "aki").location = "village"; pack(s, "ren").food = 3;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  const path = structuredClone(resident(s, "aki").action);
  assert.deepEqual(path!.path, ["meadow", "road", "home"]);
  s = act(s, { type: "guard-agreement", residentIds: ["ren"] });
  assert.deepEqual(resident(s, "aki").action, path);
  assert.equal(estimateTravelMinutes(s, "aki", "home"), 51);
  s.secondaryEncounter!.hp = 18; s.secondaryEncounter!.defeated = true;
  assert.equal(estimateTravelMinutes(s, "aki", "home"), 41);
  assert.deepEqual(resident(s, "aki").action, path);
  s = advance(s, 1);
  assert.equal(resident(s, "aki").action!.id, path!.id);
  assert.deepEqual(resident(s, "aki").action!.path, path!.path);
});

test("Local view prioritizes a present first over retired second history without duplicating state", () => {
  const s = introduced(); s.secondaryEncounter!.hp = 18; s.secondaryEncounter!.defeated = true;
  assert.equal(getLocalEncounter(s, "ridge")!.id, second); assert.equal(getPresentEncounterAt(s, "ridge"), undefined);
  s.enemy.location = "ridge";
  assert.equal(getLocalEncounter(s, "ridge")!.id, first); assert.equal(getPresentEncounterAt(s, "ridge")!.id, first);
  assert.equal(getEncounter(s, second)!.present, false); assert.equal(getEncounter(s, first)!.present, true);
});

test("Unknown or non-combat encounter targets and v3 second targets are rejected without changing jobs", () => {
  const s = introduced();
  rejectCommand(s, { type: "assign", residentIds: ["aki"], kind: "attack", encounterId: "unknown" });
  rejectCommand(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", encounterId: second });
  rejectCommand(s, { type: "assign", residentIds: ["aki"], kind: "approach-ridge", encounterId: second });
  const old = quiet(); resident(old, "aki").location = "ridge";
  rejectCommand(old, { type: "assign", residentIds: ["aki"], kind: "attack", encounterId: second });
  const target = attack(s, "aki", second);
  rejectSave(target, broken => {
    broken.version = 3;
    delete broken.secondaryEncounter;
    // Isolate the illegal v3 job target from an unrelated orphan-log failure.
    broken.logs = broken.logs.filter(log => !log.encounter);
  });
  rejectSave(target, broken => { resident(broken, "aki").action!.encounterId = "unknown" as never; });
});

test("Version4 requires one paired introduction and validates its marker, actor, clock and identities", () => {
  const s = introduced(); assert.deepEqual(deserialize(serialize(s)), s);
  const mutations: ((b: GameState) => void)[] = [
    b => { b.version = 3; },
    b => { delete b.secondaryEncounter; },
    b => { Object.assign(b.secondaryEncounter!, { version: 2 }); },
    b => { Object.assign(b.secondaryEncounter!, { location: "ridge" }); },
    b => { b.secondaryEncounter!.introducedAt = b.minutes + 1; },
    b => { b.secondaryEncounter!.actorId = "absent"; },
    b => { delete introLog(b).encounter; },
    b => { introLog(b).encounter!.location = "road"; },
    b => { introLog(b).encounter!.id = first; },
    b => { introLog(b).type = "social"; },
    b => { introLog(b).time--; },
    b => { introLog(b).actors = ["mio"]; },
    b => { introLog(b).coinTrade = { choice: "buy-food", termsId: "village-coins-v1" }; },
  ];
  for (const mutate of mutations) rejectSave(s, mutate);
  const old = quiet();
  old.logs.push({ id: old.nextId++, time: old.minutes, type: "explore", title: "controlled orphan", text: "controlled orphan", actors: ["aki"], witnesses: ["aki"], encounter: { id: second, location: "ridge" } });
  assert.throws(() => deserialize(serialize(old)), /保存データ/);
  const withCurrent = act(s, { type: "assign", residentIds: ["mio"], kind: "hobby" });
  for (const held of [false, true]) {
    const state = held ? pause(withCurrent, "mio") : withCurrent;
    const job = (resident(state, "mio").action ?? resident(state, "mio").suspended)!;
    rejectSave(state, broken => { const log = introLog(broken); log.id = broken.secondaryEncounter!.logId = job.id; });
  }
});
