import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { advance, command, createGame, deserialize, serialize, estimateTravelMinutes, getCombatants,
  GUARD_AGREEMENT_RULE, inspectGuardAgreement, isGuardPresent, isGuardPresentAt } from "../src/game/engine.ts";
import { ownFreeResources, totalResources } from "../src/game/inventory.ts";
import { validGuardAgreement } from "../src/game/guard-agreement.ts";
import { AGREEMENT_FOOD_TERMS_ID, getVillageStock, hasReportedGuardAgreement, inspectRegionInteraction, type RegionChoice } from "../src/game/region.ts";
import { getLocationScene, getLocationSummary } from "../src/game/content.ts";
import { getTimeControls } from "../src/game/time-controls.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";
const person = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id = "aki") => s.inventory!.packs[id];
function act(s: GameState, cmd: Command): GameState { const result = command(s, cmd); assert.equal(result.error, undefined, result.error); return result.state; }
function quiet(): GameState { const s = createGame(5201); for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; } return s; }
function finish(s: GameState, id = "aki") {
  const job = person(s, id).action?.id; assert.ok(job);
  for (let n = 0; n < 2000; n++) { if (person(s, id).action?.id !== job) return s; s = advance(s, 1); }
  assert.fail("The actual job did not finish");
}
const assignMove = (s: GameState, target: LocationId, id = "aki") => act(s, { type: "assign", residentIds: [id], kind: "move", target });
const move = (s: GameState, target: LocationId, id = "aki") => finish(assignMove(s, target, id), id);
const agree = (s: GameState, id = "aki") => act(s, { type: "guard-agreement", residentIds: [id] });
const fixture = (name: string) => deserialize(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const hash = (s: GameState) => createHash("sha256").update(serialize(s)).digest("hex");
function rejected(s: GameState, cmd: unknown = { type: "guard-agreement", residentIds: ["aki"] }) {
  const raw = serialize(s), result = command(s, cmd as Command); assert.ok(result.error); assert.strictEqual(result.state, s); assert.equal(serialize(s), raw);
}
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const broken = structuredClone(s); mutate(broken);
  assert.throws(() => deserialize(serialize(broken)), e => { assert.ok(e instanceof Error && !(e instanceof TypeError)); assert.match(e.message, /保存データ.*不正/); return true; });
}
// Controlled unit boundary. The first test instead carries actual warehouse
// meals and walks through commands; HTML QA remains a separate activity.
function field(id = "aki"): GameState { const s = quiet(); person(s, id).location = "ruins"; pack(s, id).food = 3; return s; }
const completed = () => agree(field());

const shop = (choice: RegionChoice, residentId = "aki"): Command => ({
  type: "region", residentId, npcId: "village-trader", choice,
});

test("The negotiator tells the shopkeeper in person and can barter once at the better price each day", () => {
  let s = act(quiet(), { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 3 });
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 4 });
  s = move(s, "village");
  s = act(s, shop("talk")); // The ordinary introduction may already be part of an older save.
  s = move(s, "ruins");
  s = agree(s);
  rejected(s, shop("report-agreement"));
  s = deserialize(serialize(move(s, "village")));
  const untouched = serialize(s);
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "trade-food").paid.scrap, 2);
  assert.ok(!hasReportedGuardAgreement(s, "aki"));
  assert.equal(serialize(s), untouched);
  const clock = s.minutes, stock = getVillageStock(s), supplies = structuredClone(s.inventory);
  s = act(s, shop("report-agreement"));
  assert.equal(s.minutes, clock);
  assert.deepEqual(s.inventory, supplies);
  assert.deepEqual(getVillageStock(s), stock);
  assert.equal(s.region!.trust["village-trader"].aki, 2);
  assert.equal(s.logs.at(-1)!.reportedGuardAgreementId, s.guardAgreement!.logId);
  assert.equal(hasReportedGuardAgreement(s, "aki"), true);
  rejected(s, shop("report-agreement"));
  assert.deepEqual(deserialize(serialize(s)), s);
  const trade = (s: GameState, id = "aki") => inspectRegionInteraction(s, id, "village-trader", "trade-food");
  assert.equal(trade(s, "mio").paid.scrap, 2);
  assert.equal(trade(s).termsId, AGREEMENT_FOOD_TERMS_ID);
  const food = pack(s).food, scrap = pack(s).scrap;
  s = act(s, shop("trade-food"));
  assert.deepEqual([pack(s).food, pack(s).scrap, getVillageStock(s).food], [food + 3, scrap - 1, 3]);
  assert.equal(s.region!.receipts.at(-1)!.termsId, AGREEMENT_FOOD_TERMS_ID);
  assert.equal(trade(s).paid.scrap, 2);
  s = act(deserialize(serialize(s)), shop("trade-food"));
  assert.deepEqual([pack(s).food, pack(s).scrap, getVillageStock(s).food], [food + 6, scrap - 3, 0]);
  rejected(s, shop("trade-food"));
  // Controlled day transition isolates the daily budget from hunger, sleep and travel.
  s.minutes = 1440 + 480;
  assert.equal(getVillageStock(s).food, 6);
  assert.equal(trade(s).paid.scrap, 1);
  s = act(s, shop("trade-food"));
  assert.deepEqual([pack(s).scrap, getVillageStock(s).food, s.region!.trust["village-trader"].aki], [scrap - 4, 3, 2]);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Leaving the guard in place preserves ordinary trade; the agreement cannot be reported at night or by a witness", () => {
  const original = field();
  person(original, "mio").location = "ruins";
  const retreat = move(original, "village");
  rejected(retreat, shop("report-agreement"));
  assert.equal(inspectRegionInteraction(retreat, "aki", "village-trader", "trade-food").paid.scrap, 2);
  let s = move(agree(original), "village", "mio");
  rejected(s, shop("report-agreement", "mio"));
  s = move(s, "village");
  rejected(s, { ...shop("report-agreement"), npcId: "village-guide" });
  s.minutes = 1080;
  rejected(s, shop("report-agreement"));
  s.minutes = 1440 + 480;
  s = act(s, shop("report-agreement"));
  assert.equal(s.region!.trust["village-trader"].aki, 1);
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "trade-food").error?.includes("携行品"), true);
  rejected(s, shop("trade-food"));
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "trade-food").paid.scrap, 1);
  assert.equal(inspectRegionInteraction(s, "mio", "village-trader", "trade-food").paid.scrap, 2);
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "buy-food").coinsPaid, 4);
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "trade-medicine").paid.scrap, 1);
  s = act(s, shop("talk"));
  assert.equal(s.region!.trust["village-trader"].aki, 2);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A report needs its agreement and its own social log; savings need a prior report, the same resident and a fresh day", () => {
  let s = move(completed(), "village");
  pack(s).scrap = 4;
  s = act(s, shop("report-agreement"));
  s = act(s, shop("trade-food"));
  s = act(s, shop("trade-food"));
  const report = s.region!.receipts.findIndex(entry => entry.choice === "report-agreement");
  const discount = report + 1;
  const reportLogId = s.region!.receipts[report].logId!;
  for (const change of [
    (b: GameState) => { delete b.logs.find(l => l.id === reportLogId)!.reportedGuardAgreementId; },
    (b: GameState) => { b.logs.find(l => l.id === reportLogId)!.reportedGuardAgreementId = reportLogId; },
    (b: GameState) => { b.region!.receipts[report].actorId = "mio"; },
    (b: GameState) => { b.region!.receipts.splice(report, 1); },
    (b: GameState) => { b.region!.receipts[discount].actorId = "mio"; },
    (b: GameState) => { const r = b.region!.receipts[discount + 1]; r.termsId = AGREEMENT_FOOD_TERMS_ID; r.paid.scrap = 1; },
    (b: GameState) => { b.region!.receipts.reverse(); },
  ]) rejectSave(s, change);
});

test("A companion carries meals, agrees without a hit, recovers separately and leaves a usable path", () => {
  let s = act(quiet(), { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "food", amount: 3 }); s = move(s, "ruins", "ren");
  const before = structuredClone(s), raw = serialize(s), preview = inspectGuardAgreement(s, ["ren"]);
  assert.equal(preview.error, undefined); assert.equal(preview.actorName, "レン"); assert.deepEqual([preview.freeFood, preview.foodAfter], [3, 0]); assert.equal(serialize(s), raw);
  assert.equal(getCombatants(s).some(r => r.id === "ren"), true); s = agree(s, "ren");
  assert.deepEqual([s.minutes, s.seed, s.nextId], [before.minutes, before.seed, before.nextId + 1]);
  for (const key of ["residents", "enemy", "flags", "resources", "life", "autonomy", "region", "trade"] as const) assert.deepEqual(s[key], before[key]);
  const inventory = structuredClone(before.inventory!); inventory.packs.ren.food -= 3; assert.deepEqual(s.inventory, inventory);
  assert.equal(totalResources(s).food, totalResources(before).food - 3); assert.equal(s.pauseReason, undefined);
  const l = s.logs.at(-1)!; assert.equal(s.logs.length, before.logs.length + 1); assert.deepEqual(l.actors, ["ren", "ruins-guard"]); assert.deepEqual(l.witnesses, ["ren", "ruins-guard"]);
  assert.deepEqual(l.guardAgreement, { ruleId: GUARD_AGREEMENT_RULE.id, location: "ruins" });
  assert.deepEqual(s.guardAgreement, { version: 1, ...l.guardAgreement, actorId: "ren", agreedAt: s.minutes, logId: l.id }); assert.deepEqual(deserialize(serialize(s)), s);
  assert.equal(isGuardPresent(s), false); assert.deepEqual(getCombatants(s), []); assert.equal(getTimeControls(s).combat, false);
  rejected(s, { type: "guard-agreement", residentIds: ["ren"] }); for (const kind of ["attack", "defend"]) rejected(s, { type: "assign", residentIds: ["ren"], kind });
  s = finish(act(s, { type: "assign", residentIds: ["ren"], kind: "gather" }), "ren");
  assert.equal(s.flags.suppliesRecovered, true); assert.deepEqual(pack(s, "ren"), { food: 0, ingredients: 4, medicine: 2, scrap: 8 }); rejected(s, { type: "assign", residentIds: ["ren"], kind: "gather" });
  const hits = s.logs.filter(l => l.type === "combat").length, hp = person(s, "mio").hp; assert.equal(estimateTravelMinutes(s, "mio", "village"), 41);
  s = move(s, "village", "mio"); assert.equal(person(s, "mio").hp, hp); assert.equal(estimateTravelMinutes(s, "mio", "home"), 41); s = move(s, "home", "mio");
  assert.equal(person(s, "mio").hp, hp); assert.equal(s.logs.filter(l => l.type === "combat").length, hits); assert.deepEqual([s.enemy.hp, s.enemy.defeated], [80, false]); assert.deepEqual(deserialize(serialize(s)), s);
});

test("Exact selection, conscious local endpoint and a present guard are atomic prerequisites", () => {
  for (const ids of [[], ["aki", "aki"], ["aki", "mio"], ["absent"], [1], null]) rejected(field(), { type: "guard-agreement", residentIds: ids });
  const cases: ((s: GameState) => void)[] = [s => { s.ended = true; }, s => { person(s).location = "road"; }, s => { person(s).hp = 0; }, s => { s.enemy.defeated = true; }, s => { s.enemy.location = "road"; }, s => { s.enemy.hp = 18; },
    s => { person(s).action = { id: s.nextId++, kind: "sleep", label: "sleep", progress: 0, duration: 40 }; }];
  for (const setup of cases) { const s = field(); setup(s); rejected(s); }
  const exhausted = field(); exhausted.nextId = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(deserialize(serialize(exhausted)), exhausted); rejected(exhausted);
  let s = assignMove(field(), "village"); rejected(s); s = act(s, { type: "pause", residentId: "aki" }); assert.equal(inspectGuardAgreement(s, ["aki"]).error, undefined); s = act(s, { type: "resume", residentId: "aki" }); rejected(s);
});

test("Only the actor's unreserved meals pay; a held meal and all remaining stock stay reserved", () => {
  const s = field(); pack(s).food = 2; pack(s, "mio").food = 20; person(s, "mio").location = "ruins"; s.resources.food = 20; s.inventory!.ground.ruins = { food: 20, ingredients: 0, medicine: 0, scrap: 0 }; rejected(s);
  let held = quiet(); pack(held).food = 3; held = act(held, { type: "assign", residentIds: ["aki"], kind: "eat" }); held = act(held, { type: "pause", residentId: "aki" }); person(held).location = "ruins";
  assert.equal(ownFreeResources(held, "aki").food, 2); rejected(held); pack(held).food = 4; const job = structuredClone(person(held).suspended);
  const paid = agree(held); assert.deepEqual(person(paid).suspended, job); assert.equal(pack(paid).food, 1); assert.equal(ownFreeResources(paid, "aki").food, 0); assert.deepEqual(deserialize(serialize(paid)), paid);
});

test("Held travel at progress zero and one stays exact and existing safe travel is not rerouted", () => {
  for (const progress of [0, 1]) {
    let s = assignMove(field(), "village"); if (progress) s = advance(s, 1); s = act(s, { type: "pause", residentId: "aki" }); person(s, "mio").location = "village"; s = assignMove(s, "home", "mio");
    assert.deepEqual(person(s, "mio").action!.path, ["meadow", "road", "home"]); const jobs = structuredClone(s.residents.map(r => [r.action, r.suspended]));
    const result = agree(s); assert.deepEqual(result.residents.map(r => [r.action, r.suspended]), jobs); assert.equal(estimateTravelMinutes(result, "mio", "home"), 41); assert.deepEqual(deserialize(serialize(result)), result);
  }
});

test("A current rescue blocks its carrier and current or held rescue blocks its patient; a held carrier preserves both endpoints", () => {
  let s = field("ren"); person(s).location = "ruins"; person(s).hp = 35; pack(s).food = 3; s = act(s, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
  rejected(s, { type: "guard-agreement", residentIds: ["ren"] }); rejected(s); s = act(s, { type: "pause", residentId: "ren" }); rejected(s);
  assert.equal(inspectGuardAgreement(s, ["ren"]).error, undefined); const residents = structuredClone(s.residents); const result = agree(s, "ren"); assert.deepEqual(result.residents, residents); assert.deepEqual(deserialize(serialize(result)), result);
});

test("Manual current and held attack/defend require explicit cancellation, including a remote held order", () => {
  for (const kind of ["attack", "defend"] as const) for (const held of [false, true]) {
    let s = field(); person(s, "ren").location = "ruins"; s = act(s, { type: "assign", residentIds: ["ren"], kind });
    if (held) { s = act(s, { type: "pause", residentId: "ren" }); person(s, "ren").location = "home"; }
    assert.match(inspectGuardAgreement(s, ["aki"]).error!, /レン.*指示/); rejected(s); s = act(s, { type: "cancel", residentId: "ren", actionId: (person(s, "ren").action ?? person(s, "ren").suspended)!.id }); assert.equal(inspectGuardAgreement(s, ["aki"]).error, undefined);
  }
});

test("Automatic attack and defence clean up without changing the toggle or reserved held manual work", () => {
  let s = act(quiet(), { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 3 }); s = act(s, { type: "assign", residentIds: ["aki"], kind: "cook" }); s = act(s, { type: "auto-combat", enabled: true }); s = act(s, { type: "assign", residentIds: ["aki", "ren"], kind: "move", target: "ruins" });
  for (let n = 0; n < 100 && (person(s).location !== "ruins" || person(s, "ren").location !== "ruins"); n++) s = advance(s, 1);
  assert.equal(person(s).action?.automatic, true); assert.equal(person(s, "ren").action?.automatic, true); const held = structuredClone(person(s).suspended), enemy = structuredClone(s.enemy), seed = s.seed;
  s = agree(s); assert.equal(s.autoCombat, true); assert.equal(person(s).action, null); assert.equal(person(s, "ren").action, null); assert.deepEqual(person(s).suspended, held); assert.deepEqual(s.enemy, enemy); assert.equal(s.seed, seed);
  const after = advance(s, 1); assert.equal(after.seed, seed); assert.deepEqual(after.enemy, enemy); assert.deepEqual(getCombatants(after), []); assert.deepEqual(deserialize(serialize(s)), s);
});

test("Only conscious local witnesses are recorded, and scene copy identifies a peaceful departure", () => {
  const s = field(); person(s, "mio").location = "ruins"; person(s, "ren").location = "ruins"; person(s, "ren").hp = 0; const result = agree(s);
  assert.deepEqual(result.logs.at(-1)!.witnesses, ["aki", "mio", "ruins-guard"]); for (const location of ["ruins", "road", "ridge"] as const) assert.match(getLocationScene(result, location).paragraphs.join(""), /食事.*立ち去った/);
  assert.match(getLocationSummary(result, "ruins"), /譲って立ち去った/); assert.equal(result.logs.at(-1)!.type, "social"); assert.doesNotMatch(result.logs.at(-1)!.text, /傷を押さえ|倒れ|死亡/);
  const sleepy = field(); person(sleepy, "mio").location = "ruins"; person(sleepy, "mio").action = { id: sleepy.nextId++, kind: "sleep", label: "sleep", progress: 0, duration: 40 }; assert.deepEqual(agree(sleepy).logs.at(-1)!.witnesses, ["aki", "ruins-guard"]);
});

test("One exact record and marker reject orphans, foreign identities, mixed results and incompatible enemy state", () => {
  const s = completed(); assert.equal(validGuardAgreement(s), true); assert.deepEqual(deserialize(serialize(s)), s);
  const mutations: ((s: GameState) => void)[] = [s => { delete s.guardAgreement; }, s => { delete s.logs.at(-1)!.guardAgreement; }, s => { Object.assign(s.guardAgreement!, { extra: 1 }); }, s => { Object.assign(s.logs.at(-1)!.guardAgreement!, { extra: 1 }); },
    s => { s.guardAgreement!.agreedAt = s.minutes + 1; }, s => { s.guardAgreement!.actorId = "absent"; }, s => { s.guardAgreement!.location = "road" as "ruins"; }, s => { s.enemy.defeated = true; }, s => { s.enemy.hp = 18; }, s => { s.enemy.location = "road"; },
    s => { s.logs.at(-1)!.actors = ["aki", "ruins-guard", "mio"]; }, s => { s.logs.at(-1)!.witnesses.push("ruins-guard"); }, s => { s.logs.at(-1)!.witnesses.push("unknown"); }, s => { s.logs.at(-1)!.actors = ["aki", "unknown-guard"]; }, s => { s.logs.at(-1)!.type = "combat"; },
    s => { s.logs.at(-1)!.routeWork = { ruleId: "river-path-v1", location: "meadow" }; }, s => { s.logs.at(-1)!.coinTrade = { choice: "buy-food", termsId: "village-coins-v1" }; }, s => { s.logs.at(-1)!.coinTransfer = { from: "aki", to: "mio", amount: 1, location: "ruins" }; },
    s => { s.logs[0].actors.push("ruins-guard"); }, s => { s.logs.push({ ...structuredClone(s.logs.at(-1)!), id: s.nextId++ }); }, s => { person(s).action = { id: s.nextId++, kind: "attack", label: "attack", progress: 0, duration: 2 }; }];
  for (const mutate of mutations) rejectSave(s, mutate);
});

test("Agreement log identity cannot alias current, held, helper, leisure or conversation action references", async t => {
  const cases: [string, () => { state: GameState; reference: number }][] = [
    ["current", () => { const state = assignMove(completed(), "garden", "mio"); return { state, reference: person(state, "mio").action!.id }; }],
    ["held", () => { const state = act(assignMove(completed(), "garden", "mio"), { type: "pause", residentId: "mio" }); return { state, reference: person(state, "mio").suspended!.id }; }],
    ["stale helper target", () => { let state = completed(); person(state).location = "home"; state = act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" }); state = act(state, { type: "assign", residentIds: ["mio"], kind: "help", target: "aki" }); const reference = person(state, "mio").action!.targetActionId!; state = act(state, { type: "cancel", residentId: "aki" }); return { state, reference }; }],
    ["autonomous leisure", () => { let state = act(completed(), { type: "routine", residentId: "mio", routine: { workRole: "support", home: "home", leisure: "quiet" } }); state = act(state, { type: "policy", residentId: "mio", policy: "balanced" }); state = advance(state, 1); const reference = state.autonomy!.leisure.mio.actionId; state = act(state, { type: "cancel", residentId: "mio" }); return { state, reference }; }],
    ["conversation peer", () => { let state = completed(); person(state).location = "home"; state = finish(act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" })); state = act(state, { type: "discuss-craft", residentIds: ["aki", "mio"], craftId: state.life!.crafts.at(-1)!.id }); return { state, reference: person(state).action!.topic!.peerActionId }; }],
  ];
  for (const [name, setup] of cases) await t.test(name, () => { const { state, reference } = setup(); assert.deepEqual(deserialize(serialize(state)), state); rejectSave(state, broken => { const entry = broken.guardAgreement!, log = broken.logs.find(l => l.id === entry.logId)!; entry.logId = log.id = reference; }); });
});

test("Joined actors and witnesses cannot precede membership or the same-minute joining ID", () => {
  let s = fixture("coin-transfer-controlled-recruited-peer-valid-gift-v3.json"); const id = "village-guide"; person(s, id).location = "ruins"; pack(s, id).food = 3; person(s, id).action = person(s, id).suspended = null; s = agree(s, id); assert.deepEqual(deserialize(serialize(s)), s);
  for (const earlier of [true, false]) { const broken = structuredClone(s), entry = broken.guardAgreement!, log = broken.logs.find(l => l.id === entry.logId)!; entry.agreedAt = log.time = person(broken, id).joinedAt! - (earlier ? 1 : 0); if (!earlier) entry.logId = log.id = person(broken, id).joinedLogId! - 1; assert.equal(validGuardAgreement(broken), false); assert.throws(() => deserialize(serialize(broken)), /保存データ/); }
  const witness = structuredClone(s), entry = witness.guardAgreement!, log = witness.logs.find(l => l.id === entry.logId)!; entry.actorId = "aki"; log.actors = ["aki", "ruins-guard"]; log.witnesses = ["aki", id, "ruins-guard"]; entry.agreedAt = log.time = person(witness, id).joinedAt! - 1; assert.equal(validGuardAgreement(witness), false);
});

test("Unused old saves and a genuine command continuation keep exact raw and gain no agreement", () => {
  for (const version of [1, 2, 3] as const) { const s = quiet(); s.version = version; const read = deserialize(serialize(s)), before = serialize(read); inspectGuardAgreement(read, ["aki"]); isGuardPresent(read); isGuardPresentAt(read, "ruins"); assert.equal(serialize(read), before); assert.equal(read.guardAgreement, undefined); }
  const initial = fixture("coin-transfer-genuine-common-current-five-v3.json"); assert.equal(hash(act(initial, { type: "pause", residentId: "aki" })), "aaf1b52020f156ba27812f78106fa0d35518c6e1ec48b581c0ac6f0389c0fe61");
  let s = act(initial, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "scrap", amount: 1 }); s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "village", via: ["road", "meadow"] }); s = advance(advance(s, 40), 11); s = act(s, { type: "region", residentId: "mio", npcId: "village-trader", choice: "trade-medicine" }); s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home", via: ["meadow", "road"] }); s = advance(s, 51); s = act(s, { type: "transfer", residentId: "mio", from: "mio", to: "base", resource: "medicine", amount: 1 }); assert.equal(hash(s), "f6a71f1fa78debdce4a7e5a2869320bb3720c85dc2f38dc3fd8271db5fe411a4"); assert.equal(s.guardAgreement, undefined);
  const hpZero = quiet(); hpZero.enemy.hp = 0; assert.deepEqual(deserialize(serialize(hpZero)), hpZero); assert.equal(isGuardPresent(hpZero), true); rejected(hpZero);
});
