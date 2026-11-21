import test from "node:test";
import assert from "node:assert/strict";
import { command, createGame, deserialize, serialize, tradeSelection } from "../src/game/engine.ts";
import type { Action, GameState } from "../src/game/types.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { applyRegionInteraction, inspectRegionInteraction, regionNPCsAt, validRegion } from "../src/game/region.ts";
import { getRecruitmentStatus, recruitCompanion, RECRUIT_DEFINITIONS, validRoster } from "../src/game/recruitment.ts";
import { validAutonomy } from "../src/game/autonomy.ts";
import { validTradeState } from "../src/game/trade.ts";

const person = (s: GameState, id = "mio") => s.residents.find((resident) => resident.id === id)!;
const snapshot = (s: GameState) => JSON.stringify(s);
function ready(actorId = "mio"): GameState {
  const s = createGame(617);
  s.version = 3;
  s.minutes = 600;
  for (const resident of s.residents) { resident.action = null; resident.suspended = null; }
  person(s, actorId).location = "village";
  ensureInventory(s).packs[actorId].food = 3;
  assert.equal(applyRegionInteraction(s, actorId, "village-guide", "talk").error, undefined);
  assert.equal(applyRegionInteraction(s, actorId, "village-guide", "deliver").error, undefined);
  return s;
}
function join(s: GameState, actorId = "mio") {
  const result = recruitCompanion(s, actorId, "village-guide");
  assert.equal(result.error, undefined);
  assert.ok(result.resident);
  return result.resident;
}
function action(s: GameState, kind: Action["kind"], target?: string): Action {
  return { id: s.nextId++, kind, target, label: kind, duration: 30, progress: 0 };
}
function freezeDeep(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) freezeDeep(entry);
  }
}

test("Recruitment status is pure for both a credited legacy household and absent optional fields", () => {
  const s = ready();
  s.version = 2;
  delete s.inventory;
  const before = snapshot(s);
  freezeDeep(s);
  const status = getRecruitmentStatus(s, "mio", "village-guide");
  assert.equal(status.available, true);
  assert.equal(status.trust, 3);
  assert.equal(status.requiredTrust, 3);
  assert.equal(status.alreadyJoined, false);
  assert.equal(validRoster(s), true);
  assert.equal(snapshot(s), before);
  const old = createGame();
  delete old.region;
  delete old.inventory;
  const oldBefore = snapshot(old);
  freezeDeep(old);
  assert.equal(getRecruitmentStatus(old, "mio", "village-guide").available, false);
  assert.equal(snapshot(old), oldBefore);
});

test("Mio invites the guide without the absent unconscious protagonist, keeping identity and quantities", () => {
  const s = ready();
  person(s, "aki").hp = 0;
  const oldRelations = structuredClone(s.residents.map((resident) => resident.relations));
  const oldLogs = structuredClone(s.logs);
  const oldMemories = structuredClone(s.residents.map((resident) => resident.memories));
  const oldStock = structuredClone(s.resources);
  const oldInventory = structuredClone(s.inventory!);
  const { minutes, seed, nextId } = s;
  const haru = join(s);
  assert.equal(haru.id, "village-guide");
  assert.equal(haru.name, "ハル");
  assert.equal(haru.sourceNpcId, "village-guide");
  assert.equal(haru.joinedAt, minutes);
  assert.equal(haru.joinedLogId, nextId);
  assert.deepEqual(haru.memories, []);
  assert.deepEqual(haru.skills, { cooking: 2, combat: 4, craft: 3 });
  assert.deepEqual(haru.routine, { workRole: "support", home: "home", leisure: "quiet" });
  assert.equal(haru.wishKind, "settle");
  assert.equal(haru.weapon, "staff");
  assert.equal(haru.location, "village");
  assert.deepEqual([s.minutes, s.seed, s.nextId], [minutes, seed, nextId + 1]);
  assert.deepEqual(s.resources, oldStock);
  for (const key of ["ground", "baseGear"] as const) assert.deepEqual(s.inventory![key], oldInventory[key]);
  for (const id of ["aki", "mio", "ren"]) assert.deepEqual(s.inventory!.packs[id], oldInventory.packs[id]);
  assert.deepEqual(s.inventory!.packs[haru.id], { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
  assert.deepEqual(s.logs.slice(0, -1), oldLogs);
  assert.deepEqual(s.residents.slice(0, 3).map((resident) => resident.memories), oldMemories);
  for (let i = 0; i < 3; i++) for (const [id, relation] of Object.entries(oldRelations[i]))
    assert.deepEqual(s.residents[i].relations[id], relation);
  assert.deepEqual(haru.relations.mio, { closeness: 20, trust: 25 });
  assert.deepEqual(person(s).relations[haru.id], haru.relations.mio);
  assert.deepEqual(haru.relations.aki, { closeness: 0, trust: 0 });
  assert.deepEqual(haru.relations.ren, { closeness: 0, trust: 0 });
  assert.deepEqual(s.logs.at(-1)?.actors, ["mio", "village-guide"]);
  assert.deepEqual(s.logs.at(-1)?.witnesses, ["mio", "village-guide"]);
  assert.deepEqual(s.region?.recruitments, [{ residentId: "village-guide", invitedBy: "mio", time: minutes, logId: nextId }]);
  assert.equal(validRegion(s), true);
  assert.equal(validRoster(s), true);
});

test("Only present awake peers meet the new member, and pending work and reservations are untouched", () => {
  const s = ready();
  person(s, "ren").location = "village";
  person(s, "ren").action = { ...action(s, "hobby"), reserved: { scrap: 1 } };
  person(s, "aki").location = "village";
  person(s, "aki").action = action(s, "sleep");
  person(s).suspended = { ...action(s, "cook"), reserved: { ingredients: 2 } };
  const jobs = structuredClone(s.residents.map((resident) => [resident.action, resident.suspended]));
  const haru = join(s);
  assert.deepEqual(haru.relations.ren, { closeness: 10, trust: 15 });
  assert.deepEqual(haru.relations.aki, { closeness: 0, trust: 0 });
  assert.deepEqual(s.residents.slice(0, 3).map((resident) => [resident.action, resident.suspended]), jobs);
  assert.deepEqual(s.logs.at(-1)?.witnesses, ["mio", "ren", "village-guide"]);
});

test("Trust and completed delivery belong to the actual inviter, never the selected protagonist by default", () => {
  const s = ready("ren");
  person(s).location = "village";
  assert.equal(getRecruitmentStatus(s, "mio", "village-guide").available, false);
  assert.equal(getRecruitmentStatus(s, "ren", "village-guide").available, true);
  assert.equal(getRecruitmentStatus(s, "aki", "village-guide").available, false);
  for (const change of [
    (state: GameState) => { state.region!.talked["village-guide"] = ["ren"]; },
    (state: GameState) => { state.region!.request!.deliveredBy = "ren"; },
    (state: GameState) => { state.region!.trust["village-guide"].mio = 2; },
  ]) {
    const state = ready(); change(state);
    const before = snapshot(state);
    assert.ok(recruitCompanion(state, "mio", "village-guide").error);
    assert.equal(snapshot(state), before);
  }
});

test("Remote, asleep, closed, busy, carried and dangerous invitations fail atomically", () => {
  const changes: ((s: GameState) => void)[] = [
    (s) => { person(s).location = "home"; },
    (s) => { person(s).hp = 0; },
    (s) => { person(s).action = action(s, "sleep"); },
    (s) => { s.minutes = 479; },
    (s) => { s.minutes = 1080; },
    (s) => { s.ended = true; },
    (s) => { s.enemy.location = "village"; s.enemy.hp = 80; s.enemy.defeated = false; },
    (s) => { person(s).hp = 20; person(s, "ren").location = "village"; person(s, "ren").suspended = action(s, "rescue", "mio"); },
  ];
  for (const kind of ["move", "rescue", "attack", "defend"] as const)
    for (const field of ["action", "suspended"] as const) changes.push((s) => { person(s)[field] = action(s, kind); });
  for (const change of changes) {
    const s = ready(); change(s); delete s.inventory;
    const before = snapshot(s);
    assert.ok(recruitCompanion(s, "mio", "village-guide").error);
    assert.equal(snapshot(s), before);
  }
  const s = ready();
  for (const [actor, npc] of [["nobody", "village-guide"], ["mio", "village-trader"], ["mio", "unknown"]]) {
    const before = snapshot(s);
    assert.ok(recruitCompanion(s, actor, npc).error);
    assert.equal(snapshot(s), before);
  }
});

test("Joining is idempotent and removes the NPC wherever its resident later travels", () => {
  const s = ready();
  const haru = join(s);
  const before = snapshot(s);
  assert.ok(recruitCompanion(s, "mio", "village-guide").error);
  assert.equal(snapshot(s), before);
  assert.equal(getRecruitmentStatus(s, "mio", "village-guide").alreadyJoined, true);
  haru.location = "home";
  assert.deepEqual(regionNPCsAt(s, "village").map((npc) => npc.id), ["village-trader"]);
  assert.ok(inspectRegionInteraction(s, "mio", "village-guide", "talk").error);
  assert.equal(RECRUIT_DEFINITIONS[0].id, haru.id);
});

test("Roster validation accepts old founders in any order and rejects identity or joining-proof forgery", () => {
  const original = createGame();
  delete original.region;
  original.version = 1;
  original.residents.reverse();
  assert.equal(validRoster(original), true);
  for (const change of [
    (s: GameState) => { s.residents.pop(); },
    (s: GameState) => { s.residents.push(structuredClone(person(s))); },
    (s: GameState) => { person(s, "aki").sourceNpcId = "village-guide"; },
    (s: GameState) => { person(s, "aki").joinedAt = 600; },
    (s: GameState) => { person(s, "aki").joinedLogId = 1; },
    (s: GameState) => { person(s, "ren").id = "unknown"; },
    (s: GameState) => { const guide = structuredClone(person(s)); guide.id = "village-guide"; s.residents.push(guide); },
  ]) {
    const s = ready(); change(s); assert.equal(validRoster(s), false);
  }
  const changes: ((s: GameState) => void)[] = [
    (s) => { s.version = 2; },
    (s) => { delete s.region!.recruitments; },
    (s) => { s.region!.recruitments!.push({ ...s.region!.recruitments![0] }); },
    (s) => { s.region!.recruitments![0].invitedBy = "aki"; },
    (s) => { s.region!.recruitments![0].invitedBy = "village-guide"; },
    (s) => { s.region!.recruitments![0].residentId = "village-trader"; },
    (s) => { person(s, "village-guide").sourceNpcId = "village-trader"; },
    (s) => { person(s, "village-guide").joinedAt!--; },
    (s) => { person(s, "village-guide").joinedLogId!--; },
    (s) => { s.logs.pop(); },
    (s) => { s.logs.at(-1)!.actors = ["aki", "village-guide"]; },
    (s) => { s.logs.at(-1)!.title = "別の出来事"; },
    (s) => { s.region!.receipts[1].time++; s.region!.request!.time++; s.minutes++; },
    (s) => { s.region!.receipts[0].actorId = "ren"; },
    (s) => { s.region!.trust["village-guide"].mio = 9; },
    (s) => { s.region!.harvests.push({ actorId: "village-guide", day: 1, time: 599 }); },
  ];
  for (const change of changes) {
    const s = ready(); join(s); change(s); assert.equal(validRoster(s), false);
  }
});

test("Regional membership extension rejects malformed arrays, duplicate records and unknown IDs", () => {
  for (const value of [null, [], "region", { version: 1, recruitments: [] }]) {
    const s = ready();
    (s as unknown as Record<string, unknown>).region = value;
    assert.doesNotThrow(() => validRoster(s));
    assert.equal(validRoster(s), false);
  }
  for (const value of [null, {}, [null], [{ residentId: "unknown", invitedBy: "mio", time: 600, logId: 1 }]]) {
    const s = ready();
    (s.region as unknown as Record<string, unknown>).recruitments = value;
    assert.equal(validRegion(s), false);
    assert.equal(validRoster(s), false);
  }
  const s = ready(); join(s);
  s.region!.recruitments![0].time = s.minutes + 1;
  assert.equal(validRegion(s), false);
});

test("A credited format-2 save remains loadable and a joined household roundtrips with its exact membership", () => {
  const legacy = ready(); legacy.version = 2;
  const loaded = deserialize(serialize(legacy));
  assert.equal(loaded.version, 3);
  assert.equal(getRecruitmentStatus(loaded, "mio", "village-guide").available, true);
  join(loaded);
  const text = serialize(loaded);
  assert.equal(serialize(deserialize(text)), text);
});

test("Current and suspended jobs must begin after joining, including their autonomous decision", () => {
  for (const field of ["action", "suspended"] as const) {
    let s = ready();
    join(s);
    person(s, "village-guide").location = "home";
    const assigned = command(s, { type: "assign", residentIds: ["village-guide"], kind: "rest" });
    assert.equal(assigned.error, undefined);
    s = assigned.state;
    const haru = person(s, "village-guide");
    if (field === "suspended") { haru.suspended = haru.action; haru.action = null; }
    haru[field]!.automatic = true;
    haru[field]!.autonomyReason = { code: "recovery", text: "加入後の休息", decidedAt: haru.joinedAt! };
    assert.equal(validAutonomy(s), true);
    assert.equal(validRoster(s), true);
    assert.doesNotThrow(() => deserialize(serialize(s)), "same-minute post-join jobs remain valid");
    for (const change of [
      (state: GameState) => { person(state, "village-guide")[field]!.id = haru.joinedLogId!; },
      (state: GameState) => { person(state, "village-guide")[field]!.autonomyReason!.decidedAt = haru.joinedAt! - 1; },
    ]) {
      const invalid = structuredClone(s); change(invalid);
      assert.equal(validAutonomy(invalid), true);
      assert.equal(validRoster(invalid), false);
      assert.throws(() => deserialize(serialize(invalid)), /保存データ/);
    }
  }
});

test("Leisure and manual-stay history cannot predate membership, with same-minute history accepted", () => {
  const s = ready();
  const haru = join(s);
  const actionId = s.nextId++;
  s.autonomy = { version: 1, leisure: {
    [haru.id]: { day: 1, startedAt: haru.joinedAt!, kind: "quiet", actionId },
  }, manualStays: {
    [haru.id]: { time: haru.joinedAt!, location: "home", source: "cancel" },
  }, conversations: {}, mealPairs: {} };
  assert.equal(validAutonomy(s), true);
  assert.equal(validRoster(s), true);
  assert.doesNotThrow(() => deserialize(serialize(s)));
  for (const change of [
    (state: GameState) => { state.autonomy!.leisure[haru.id].startedAt = 500; },
    (state: GameState) => { state.autonomy!.leisure[haru.id].actionId = haru.joinedLogId!; },
    (state: GameState) => { state.autonomy!.manualStays[haru.id].time = haru.joinedAt! - 1; },
  ]) {
    const invalid = structuredClone(s); change(invalid);
    assert.equal(validAutonomy(invalid), true);
    assert.equal(validRoster(invalid), false);
    assert.throws(() => deserialize(serialize(invalid)), /保存データ/);
  }
});

test("New-member trade receipts must occur after joining in both clock and ID order", () => {
  let s = ready();
  s.minutes = 2250;
  s.nextId += 10; // Completed earlier jobs may leave unused IDs; they are not proof of membership.
  const haru = join(s);
  haru.location = "home";
  s.resources.food = 12;
  s.trade = { version: 1, nextArrival: 3600, receipts: [], visit: {
    id: 2160, arrivesAt: 2160, leavesAt: 2400, status: "open", stock: { scrap: 3, medicine: 1 },
  } };
  const exchange = tradeSelection(s, [haru.id], 2160, "meal-for-scrap");
  assert.equal(exchange.error, undefined);
  s = exchange.state;
  assert.equal(s.trade!.receipts[0].time, haru.joinedAt);
  assert.ok(s.trade!.receipts[0].id > haru.joinedLogId!);
  assert.equal(validTradeState(s), true);
  assert.equal(validRoster(s), true);
  assert.doesNotThrow(() => deserialize(serialize(s)));
  for (const change of [
    (state: GameState) => { state.trade!.receipts[0].time = haru.joinedAt! - 1; },
    (state: GameState) => { state.trade!.receipts[0].id = haru.joinedLogId! - 1; },
  ]) {
    const invalid = structuredClone(s); change(invalid);
    assert.equal(validTradeState(invalid), true);
    assert.equal(validRoster(invalid), false);
    assert.throws(() => deserialize(serialize(invalid)), /保存データ/);
  }
});

test("A newly joined guide cannot create a self-talk receipt even within the joining minute", () => {
  const s = ready();
  const haru = join(s);
  s.region!.receipts.push({ actorId: haru.id, npcId: "village-guide", time: s.minutes,
    choice: "talk", paid: {}, received: {}, trustGain: 1 });
  s.region!.talked["village-guide"].push(haru.id);
  s.region!.trust["village-guide"][haru.id] = 1;
  s.region!.routeKnownBy.push(haru.id);
  assert.equal(validRegion(s), false);
  assert.equal(validRoster(s), false);
  assert.throws(() => deserialize(serialize(s)), /保存データ/);
});
