import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, command, createGame, deserialize, getCarryLoad, getVillageCash,
  getVillageStock, getWalletCoins, inspectCoinTransfer, serialize,
} from "../src/game/engine.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import type { RegionChoice } from "../src/game/region.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id = "aki") => ensureInventory(s).packs[id];
const record = (value: unknown) => value as Record<string, unknown>;
const lastTransfer = (s: GameState) => s.currency!.transfers.at(-1)!;
const transferLog = (s: GameState, index = s.currency!.transfers.length - 1) =>
  s.logs.find(log => log.id === s.currency!.transfers[index].logId)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
const interact = (s: GameState, choice: RegionChoice, id = "aki", npcId = "village-trader") =>
  act(s, { type: "region", residentId: id, npcId, choice });
const handoff = (s: GameState, from: string, to: string, amount: number, residentId = from) =>
  act(s, { type: "transfer-coins", residentId, from, to, amount });
function rejected(s: GameState, cmd: unknown) {
  const before = serialize(s), result = command(s, cmd as Command);
  assert.ok(result.error, JSON.stringify(cmd));
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
}
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const raw = serialize(s), broken = structuredClone(s);
  mutate(broken);
  assert.throws(() => deserialize(serialize(broken)), error => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof TypeError, false);
    assert.match(error.message, /保存データ.*不正/);
    return true;
  });
  assert.equal(serialize(s), raw);
}
function finish(s: GameState, id = "aki"): GameState {
  const job = person(s, id).action?.id;
  assert.ok(job);
  for (let n = 0; n < 2000; n++) {
    if (person(s, id).action?.id !== job) return s;
    s = advance(s, 1);
  }
  assert.fail("The real action did not finish");
}
const move = (s: GameState, target: LocationId, id = "aki") =>
  finish(act(s, { type: "assign", residentIds: [id], kind: "move", target,
    ...(target === "village" ? { via: ["road" as const, "meadow" as const] } : {}) }), id);
// The first journey is made from createGame through actual commands. Other tests
// deliberately control position, opening time, stock and bodies at a boundary.
function village(scrap = 6): GameState {
  const s = createGame(691);
  s.minutes = 600;
  for (const r of s.residents) {
    r.location = "village"; r.policy = "rest"; r.hunger = r.energy = 100;
  }
  pack(s).scrap = scrap;
  return s;
}
function funded(sales = 3): GameState {
  let s = village();
  for (let n = 0; n < sales; n++) s = interact(s, "sell-scrap");
  return s;
}
function purchasePath() {
  let s = interact(village(), "sell-scrap");
  s = handoff(s, "aki", "mio", 2);
  return interact(s, "buy-medicine", "mio");
}
function swapMonetaryIds(s: GameState, first: number, second: number) {
  const swap = (id: number) => id === first ? second : id === second ? first : id;
  for (const log of s.logs) log.id = swap(log.id);
  for (const entry of s.region!.receipts) if (typeof record(entry).logId === "number")
    record(entry).logId = swap(record(entry).logId as number);
  for (const entry of s.currency!.transfers) entry.logId = swap(entry.logId);
}

test("The earner keeps working while a real receiver takes their coins and later buys with them", () => {
  let s = createGame(20261120);
  for (const r of s.residents) s = act(s, { type: "policy", residentId: r.id, policy: "rest" });
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 2 });
  s = move(s, "village");
  s = interact(interact(s, "sell-scrap"), "sell-scrap");
  s = move(s, "home");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "wood-flower" });
  s = advance(s, 5);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "cook" });
  s.pauseReason = "Keep the present attention";
  const before = structuredClone(s), raw = serialize(s);
  const combinedWeight = getCarryLoad(s, "aki").weight + getCarryLoad(s, "mio").weight;
  const preview = inspectCoinTransfer(s, "mio", "aki", "mio", 4);
  assert.equal(preview.error, undefined);
  assert.deepEqual([preview.actorId, preview.location, preview.from, preview.to, preview.amount], ["mio", "home", "aki", "mio", 4]);
  assert.deepEqual([preview.fromBefore, preview.fromAfter, preview.toBefore, preview.toAfter], [4, 0, 0, 4]);
  assert.equal(serialize(s), raw);
  s = handoff(s, "aki", "mio", 4, "mio");
  assert.deepEqual([s.minutes, s.seed, s.pauseReason, s.nextId], [before.minutes, before.seed, before.pauseReason, before.nextId + 1]);
  assert.deepEqual(s.resources, before.resources);
  assert.deepEqual(s.inventory, before.inventory);
  assert.deepEqual(s.residents, before.residents);
  assert.deepEqual(s.region, before.region);
  assert.equal(s.logs.length, before.logs.length + 1);
  assert.deepEqual(s.currency, { version: 1, transfers: [{ logId: s.logs.at(-1)!.id,
    time: s.minutes, location: "home", actorId: "mio", from: "aki", to: "mio", amount: 4 }] });
  assert.equal(transferLog(s).type, "work");
  assert.deepEqual(transferLog(s).actors, ["mio"]);
  assert.deepEqual(record(transferLog(s)).coinTransfer, { from: "aki", to: "mio", amount: 4, location: "home" });
  assert.equal("coinTrade" in transferLog(s), false);
  assert.equal(getWalletCoins(s, "aki"), 0);
  assert.equal(getWalletCoins(s, "mio"), 4);
  assert.equal(getVillageCash(s), getVillageCash(before));
  assert.ok(Math.abs(getCarryLoad(s, "aki").weight + getCarryLoad(s, "mio").weight - combinedWeight) < 1e-9);
  assert.deepEqual(deserialize(serialize(s)), s);
  const buy = (start: GameState) => interact(move(start, "village", "mio"), "buy-food", "mio");
  const next = buy(s);
  assert.equal(getWalletCoins(next, "mio"), 0);
  assert.equal(getVillageCash(next), 6);
  assert.deepEqual(getVillageStock(next), { food: 3, medicine: 3 });
  assert.equal(pack(next, "mio").food, 3);
  assert.deepEqual(person(next).suspended, person(s).suspended);
  assert.deepEqual(buy(deserialize(serialize(s))), next);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("A single coin can be split and returned, and every transfer is included beyond the history display limit", () => {
  let s = funded();
  // Controlled next-day timing; these sales and all handoffs still use commands.
  s.minutes += 1440; delete s.trade;
  for (let n = 0; n < 3; n++) s = interact(s, "sell-scrap");
  assert.equal(getWalletCoins(s, "aki"), 12);
  const shop = getVillageCash(s), stock = getVillageStock(s);
  for (let n = 0; n < 12; n++) s = handoff(s, "aki", "mio", 1);
  assert.equal(s.currency!.transfers.length, 12);
  assert.deepEqual([getWalletCoins(s, "aki"), getWalletCoins(s, "mio")], [0, 12]);
  assert.equal(getVillageCash(s), shop);
  assert.deepEqual(getVillageStock(s), stock);
  s = handoff(s, "mio", "aki", 1, "aki");
  assert.deepEqual([getWalletCoins(s, "aki"), getWalletCoins(s, "mio")], [1, 11]);
  s = interact(s, "buy-medicine", "mio");
  assert.equal(getWalletCoins(s, "mio"), 9);
  assert.equal(getVillageCash(s), shop + 2);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Invalid quantities and endpoints fail atomically without creating bookkeeping", () => {
  const s = funded(), base = { type: "transfer-coins", residentId: "aki", from: "aki", to: "mio", amount: 1 };
  s.pauseReason = "Keep the old notice";
  for (const amount of [undefined, null, 0, -1, 0.5, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 7])
    rejected(s, { ...base, amount });
  for (const patch of [{ from: "aki", to: "aki" }, { from: "mio", to: "ren" }, { residentId: "ren" },
    { residentId: "" }, { residentId: "unknown" }, { residentId: ["aki", "mio"] },
    { from: "base" }, { to: "ground" }, { from: "village-trader" }, { to: "village-guide" },
    { from: "unknown" }, { to: "unknown" }, { from: null }, { to: 1 }, { to: undefined }]) rejected(s, { ...base, ...patch });
  assert.equal(s.currency, undefined);
  const empty = village(), raw = serialize(empty);
  const preview = inspectCoinTransfer(empty, "aki", "aki", "mio", 1);
  assert.ok(preview.error);
  assert.equal(serialize(empty), raw);
  rejected(empty, base);
  const remote = structuredClone(s); person(remote, "mio").location = "home";
  rejected(remote, base);
  const ended = structuredClone(s); ended.ended = true;
  rejected(ended, base);
});

test("Only the selected actor must be awake, including a receiver taking coins from a sleeping or unconscious peer", () => {
  for (const mode of ["sleep", "ko"] as const) {
    let s = handoff(funded(1), "aki", "mio", 2);
    if (mode === "sleep") s = act(s, { type: "assign", residentIds: ["mio"], kind: "sleep" });
    else person(s, "mio").hp = 0;
    const peer = structuredClone(person(s, "mio"));
    rejected(s, { type: "transfer-coins", residentId: "mio", from: "mio", to: "aki", amount: 1 });
    s = handoff(s, "mio", "aki", 1, "aki");
    assert.deepEqual([getWalletCoins(s, "aki"), getWalletCoins(s, "mio")], [1, 1]);
    assert.deepEqual(transferLog(s).actors, ["aki"]);
    assert.equal(transferLog(s).witnesses.includes("mio"), false);
    assert.deepEqual(person(s, "mio"), peer);
    s = handoff(s, "aki", "mio", 1);
    assert.deepEqual([getWalletCoins(s, "aki"), getWalletCoins(s, "mio")], [0, 2]);
    assert.equal(transferLog(s).witnesses.includes("mio"), false);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Current movement blocks either endpoint but ordinary attack and defence do not invent a transfer ban", () => {
  const base = funded(1);
  for (const id of ["aki", "mio"]) {
    const moving = act(base, { type: "assign", residentIds: [id], kind: "move", target: "home" });
    rejected(moving, { type: "transfer-coins", residentId: "aki", from: "aki", to: "mio", amount: 1 });
  }
  let battle = structuredClone(base);
  for (const r of battle.residents) r.location = "ruins"; // Controlled encounter boundary, no battle tick.
  battle = act(battle, { type: "assign", residentIds: ["aki"], kind: "attack" });
  battle = act(battle, { type: "assign", residentIds: ["mio"], kind: "defend" });
  const jobs = structuredClone(battle.residents.map(r => [r.action, r.suspended]));
  battle = handoff(battle, "aki", "mio", 1);
  assert.deepEqual(battle.residents.map(r => [r.action, r.suspended]), jobs);
  assert.equal(lastTransfer(battle).location, "ruins");
  assert.deepEqual(deserialize(serialize(battle)), battle);
});

test("Valid current or held rescue protects a patient, while obsolete or unconscious-carrier claims do not", () => {
  let s = funded(1);
  person(s, "mio").hp = 20;
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "mio" });
  for (const id of ["mio", "ren"])
    rejected(s, { type: "transfer-coins", residentId: "aki", from: "aki", to: id, amount: 1 });
  s = act(s, { type: "pause", residentId: "ren" });
  const held = structuredClone(person(s, "ren").suspended);
  rejected(s, { type: "transfer-coins", residentId: "aki", from: "aki", to: "mio", amount: 1 });
  const carrier = handoff(s, "aki", "ren", 1);
  assert.deepEqual(person(carrier, "ren").suspended, held);
  assert.equal(getWalletCoins(carrier, "ren"), 1);
  const returned = structuredClone(s);
  for (const r of returned.residents) r.location = "home"; // Controlled stale home rescue claim.
  assert.equal(getWalletCoins(handoff(returned, "aki", "mio", 1), "mio"), 1);
  const collapsed = structuredClone(s); person(collapsed, "ren").hp = 0;
  assert.equal(getWalletCoins(handoff(collapsed, "aki", "mio", 1), "mio"), 1);
});

test("A held move recalculates an unstarted edge after coins cross the recipient's load threshold", () => {
  let s = funded(1);
  pack(s, "mio").ingredients = 44; // 11kg plus staff 1kg: exactly half of 24kg.
  assert.equal(getCarryLoad(s, "mio").weight, 12);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home" });
  const original = structuredClone(person(s, "mio").action)!;
  s = act(s, { type: "pause", residentId: "mio" });
  s = handoff(s, "aki", "mio", 2);
  assert.equal(getCarryLoad(s, "mio").multiplier, 1.25);
  assert.deepEqual(person(s, "mio").suspended, original);
  s = deserialize(serialize(s));
  s = act(s, { type: "resume", residentId: "mio" });
  const resumed = person(s, "mio").action!;
  assert.equal(resumed.id, original.id);
  assert.equal(resumed.progress, 0);
  assert.equal(resumed.segmentProgress, 0);
  assert.ok(resumed.segmentDuration! > original.segmentDuration!);
  assert.ok(resumed.duration > original.duration);
  assert.deepEqual(resumed.path, original.path);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A partly travelled held edge keeps its accrued timing; later edges use the new coin load", () => {
  let s = funded(1);
  pack(s, "mio").ingredients = 44;
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "home" });
  s = advance(s, 5);
  const original = structuredClone(person(s, "mio").action)!;
  s = act(s, { type: "pause", residentId: "mio" });
  s = handoff(s, "aki", "mio", 2);
  s = act(deserialize(serialize(s)), { type: "resume", residentId: "mio" });
  const resumed = person(s, "mio").action!;
  assert.equal(resumed.progress, original.progress);
  assert.equal(resumed.segmentProgress, 5);
  assert.equal(resumed.segmentDuration, original.segmentDuration);
  assert.ok(resumed.duration > original.duration);
  for (let n = 0; n < original.segmentDuration! - 5; n++) s = advance(s, 1);
  assert.equal(person(s, "mio").location, "meadow");
  assert.ok(person(s, "mio").action!.segmentDuration! > original.segmentDuration!);
  assert.equal(getWalletCoins(s, "mio"), 2);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Old formats remain extension-free on inspection and failed commands; history keeps its real past location", () => {
  for (const version of [1, 2, 3] as const) {
    const s = createGame(); s.version = version;
    const raw = serialize(s);
    getWalletCoins(s, "aki");
    assert.ok(inspectCoinTransfer(s, "aki", "aki", "mio", 1).error);
    rejected(s, { type: "transfer-coins", residentId: "aki", from: "aki", to: "mio", amount: 1 });
    assert.equal(serialize(s), raw);
    const loaded = deserialize(raw);
    assert.equal("currency" in loaded, false);
  }
  let moved = handoff(funded(1), "aki", "mio", 1);
  moved = move(moved, "home", "mio");
  assert.equal(lastTransfer(moved).location, "village");
  assert.equal(person(moved, "mio").location, "home");
  assert.equal(getWalletCoins(moved, "mio"), 1);
  assert.deepEqual(deserialize(serialize(moved)), moved);
});

test("Unified chronological prefixes reject a transfer or peer purchase that happened before its funding", () => {
  const valid = purchasePath();
  assert.deepEqual([getWalletCoins(valid, "aki"), getWalletCoins(valid, "mio")], [0, 0]);
  const incomeId = record(valid.region!.receipts[0]).logId as number;
  const purchaseId = record(valid.region!.receipts[1]).logId as number;
  const handoffId = lastTransfer(valid).logId;
  rejectSave(valid, broken => { swapMonetaryIds(broken, incomeId, handoffId); });
  rejectSave(valid, broken => { swapMonetaryIds(broken, handoffId, purchaseId); });
  rejectSave(valid, broken => {
    lastTransfer(broken).time++;
    transferLog(broken).time++;
    broken.minutes++;
  });
});

test("Each original array keeps its order and a shared global log ID cannot appear in both ledgers", () => {
  let valid = handoff(funded(2), "aki", "mio", 1);
  valid = handoff(valid, "aki", "mio", 1);
  valid = handoff(valid, "mio", "ren", 1);
  assert.deepEqual(deserialize(serialize(valid)), valid);
  rejectSave(valid, broken => { broken.currency!.transfers.reverse(); });
  rejectSave(valid, broken => { broken.currency!.transfers.push({ ...broken.currency!.transfers[0] }); });
  rejectSave(valid, broken => { lastTransfer(broken).logId = broken.currency!.transfers[0].logId; });
  rejectSave(valid, broken => { lastTransfer(broken).logId = record(broken.region!.receipts[0]).logId as number; });
  rejectSave(valid, broken => {
    broken.currency!.transfers[0].time++;
    transferLog(broken, 0).time++;
    broken.minutes++;
  });
});

test("Transfer records require complete exact facts and do not accept price or balance fields", () => {
  const valid = handoff(funded(1), "aki", "mio", 1);
  for (const key of ["logId", "time", "location", "actorId", "from", "to", "amount"])
    rejectSave(valid, broken => { delete record(lastTransfer(broken))[key]; });
  for (const amount of [null, "1", {}, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    rejectSave(valid, broken => {
      record(lastTransfer(broken)).amount = amount;
      record(record(transferLog(broken)).coinTransfer).amount = amount;
    });
  for (const [key, value] of [["from", "base"], ["to", "ground"], ["from", "village-trader"],
    ["to", "unknown"], ["actorId", "ren"], ["location", "unknown"], ["from", "mio"]] as const)
    rejectSave(valid, broken => { record(lastTransfer(broken))[key] = value; });
  for (const [key, value] of [["coinsPaid", 0], ["coinsReceived", 0], ["termsId", "village-coins-v1"],
    ["walletBefore", 2], ["walletAfter", 1]] as const)
    rejectSave(valid, broken => { record(lastTransfer(broken))[key] = value; });
});

test("Every work marker matches exactly one transfer and cannot overlap a trade marker", () => {
  const valid = handoff(funded(1), "aki", "mio", 1);
  rejectSave(valid, broken => { delete record(transferLog(broken)).coinTransfer; });
  rejectSave(valid, broken => { delete broken.currency; });
  rejectSave(valid, broken => { broken.currency!.transfers = []; });
  rejectSave(valid, broken => { record(transferLog(broken)).coinTrade = { choice: "sell-scrap", termsId: "village-coins-v1" }; });
  rejectSave(valid, broken => { record(broken.logs.find(log => "coinTrade" in log)!).coinTransfer = { from: "aki", to: "mio", amount: 1, location: "village" }; });
  for (const bad of [null, 1, [], {}, "coins", { from: "aki", to: "mio", amount: 2, location: "village" },
    { from: "aki", to: "mio", amount: 1, location: "home" }])
    rejectSave(valid, broken => { record(transferLog(broken)).coinTransfer = bad; });
  for (const mutate of [
    (s: GameState) => { transferLog(s).type = "social"; },
    (s: GameState) => { transferLog(s).time--; },
    (s: GameState) => { transferLog(s).actors = ["mio"]; },
    (s: GameState) => { transferLog(s).actors.push("mio"); },
    (s: GameState) => { transferLog(s).witnesses = ["mio"]; },
    (s: GameState) => { s.logs = s.logs.filter(log => log.id !== lastTransfer(s).logId); },
  ]) rejectSave(valid, mutate);
  const old = act(funded(1), { type: "transfer", residentId: "aki", from: "aki", to: "mio", resource: "scrap", amount: 1 });
  const oldId = old.logs.at(-1)!.id;
  const mixed = handoff(old, "aki", "mio", 1);
  rejectSave(mixed, broken => { lastTransfer(broken).logId = oldId; });
  rejectSave(old, broken => { record(broken.logs.at(-1)).coinTransfer = { from: "aki", to: "mio", amount: 1, location: "village" }; });
  const reworded = structuredClone(valid);
  transferLog(reworded).title = "将来の表記";
  transferLog(reworded).text = "記録の言い回しを変更した。";
  assert.deepEqual(deserialize(serialize(reworded)), reworded);
});

test("Malformed extension or journal data is rejected normally, without internal TypeErrors", () => {
  const valid = handoff(funded(1), "aki", "mio", 1);
  for (const bad of [null, [], "currency", 1, {}, { version: 2, transfers: [] },
    { version: 1, transfers: null }, { version: 1, transfers: {} },
    { version: 1, transfers: [null] }, { version: 1, transfers: [1] }, { version: 1, transfers: ["handoff"] }])
    rejectSave(valid, broken => { record(broken).currency = bad; });
  for (const bad of [null, {}, [null], [1], ["log"]])
    rejectSave(valid, broken => { record(broken).logs = bad; });
});

test("Currency-only transfer fields do not pollute old regional or travelling-merchant receipts", () => {
  const states = [funded(1), interact(village(), "trade-food")];
  for (const s of states) for (const [key, value] of [["from", "aki"], ["to", "mio"], ["amount", 1], ["location", "village"]] as const)
    rejectSave(s, broken => { record(broken.region!.receipts[0])[key] = value; });
  let home = createGame(692);
  home.minutes = 2159; home.resources.food = home.resources.ingredients = 12;
  for (const r of home.residents) { r.hunger = r.energy = 100; r.policy = "rest"; }
  home = advance(home, 1);
  home = act(home, { type: "trade", residentId: "aki", visitId: home.trade!.visit!.id, offerId: "meal-for-scrap" });
  for (const [key, value] of [["from", "aki"], ["to", "mio"], ["amount", 1], ["location", "home"]] as const)
    rejectSave(home, broken => { record(broken.trade!.receipts[0])[key] = value; });
});

test("New members may act, give and receive in their joining minute, while no endpoint predates membership", () => {
  let s = funded(); pack(s).food = 3;
  s = interact(s, "talk", "aki", "village-guide");
  s = interact(s, "deliver", "aki", "village-guide");
  s = act(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  const joined = person(s, "village-guide");
  s = handoff(s, "aki", joined.id, 2, joined.id);
  s = handoff(s, "aki", joined.id, 1);
  s = handoff(s, joined.id, "mio", 1, "mio");
  assert.deepEqual([getWalletCoins(s, joined.id), getWalletCoins(s, "mio")], [2, 1]);
  assert.ok(s.currency!.transfers.every(entry => entry.time === joined.joinedAt && entry.logId > joined.joinedLogId!));
  assert.deepEqual(deserialize(serialize(s)), s);
  rejectSave(s, broken => {
    const firstId = broken.currency!.transfers[0].logId;
    const joiningId = person(broken, joined.id).joinedLogId!;
    swapMonetaryIds(broken, firstId, joiningId);
    person(broken, joined.id).joinedLogId = firstId;
    broken.region!.recruitments![0].logId = firstId;
  });
});
