import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  advance, availableResources, COIN_WEIGHT, command, createGame, deserialize,
  getVillageCash, getVillageStock, getWalletCoins, serialize, VILLAGE_DAILY_CASH,
} from "../src/game/engine.ts";
import { ensureInventory, getCarryLoad, ownFreeResources, totalResources } from "../src/game/inventory.ts";
import { inspectRegionInteraction, isCoinChoice } from "../src/game/region.ts";
import type { RegionChoice } from "../src/game/region.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id = "aki") => ensureInventory(s).packs[id];
const row = (s: GameState, index = s.region!.receipts.length - 1) =>
  s.region!.receipts[index] as unknown as Record<string, unknown>;

test("A genuine pre-currency village medicine exchange reproduces the old UI export bytes", () => {
  const raw = readFileSync(new URL("./fixtures/currency-barter-before-medicine-v3.json", import.meta.url), "utf8");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  assert.equal(sha(raw), "e5762bb33991ab7c282e0aa81c73e9d73b1325bb65a441ddb41dc670904d9ab4");
  const result = command(deserialize(raw), {
    type: "region", residentId: "aki", npcId: "village-trader", choice: "trade-medicine",
  });
  assert.equal(result.error, undefined, result.error);
  assert.equal(sha(serialize(result.state)), "06d894d145ef7a6ce0fd761e0561db6560f6829ae7f74df55af5cc845168bfa8");
});
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function interact(s: GameState, choice: RegionChoice, id = "aki", npcId = "village-trader"): GameState {
  return act(s, { type: "region", residentId: id, npcId, choice });
}
const sell = (s: GameState, id = "aki") => interact(s, "sell-scrap", id);
function rejected(s: GameState, cmd: unknown) {
  const before = serialize(s);
  const result = command(s, cmd as Command);
  assert.ok(result.error, JSON.stringify(cmd));
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
}
const rejectedChoice = (s: GameState, choice: RegionChoice, id = "aki", npcId = "village-trader") =>
  rejected(s, { type: "region", residentId: id, npcId, choice });
function rejectSave(s: GameState, mutate: (broken: GameState) => void) {
  const before = serialize(s), broken = structuredClone(s);
  mutate(broken);
  assert.throws(() => deserialize(serialize(broken)));
  assert.equal(serialize(s), before);
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
function ordinaryUntil(s: GameState, target: number): GameState {
  while (s.minutes < target) {
    const aki = person(s);
    if (!aki.action && aki.hunger < 42 && availableResources(s).food >= 1)
      s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
    else if (!aki.action && aki.energy < 28)
      s = act(s, { type: "assign", residentIds: ["aki"], kind: "rest" });
    const next = advance(s, 1);
    assert.equal(next.minutes, s.minutes + 1);
    s = next;
  }
  return s;
}
// Boundary tests control the opening time, local stock, and body state explicitly.
// The first carry/return/day/revisit test below instead uses real commands/ticks.
function village(scrap = 4): GameState {
  const s = createGame(681);
  s.minutes = 600;
  for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; }
  person(s).location = "village";
  pack(s).scrap = scrap;
  return s;
}
function nextControlledDay(s: GameState): GameState {
  const next = structuredClone(s);
  next.minutes += 1440;
  // Controlled clock boundary, not an engine journey; old merchant timing is absent.
  delete next.trade;
  return next;
}
function reorderWithIncreasingLogIds(s: GameState, order: number[]) {
  const previous = [...s.region!.receipts];
  const ids = previous.map(entry => (entry as unknown as Record<string, unknown>).logId);
  s.region!.receipts = order.map(index => previous[index]);
  s.region!.receipts.forEach((entry, index) => {
    (entry as unknown as Record<string, unknown>).logId = ids[index];
    // Keep real event linkage internally consistent, so only the negative prefix
    // distinguishes these controlled corruptions from valid transaction totals.
    const log = s.logs.find(log => log.id === ids[index])!;
    (log as unknown as Record<string, unknown>).coinTrade = { choice: entry.choice, termsId: "village-coins-v1" };
  });
}

test("The seller really carries their proceeds home, saves overnight, revisits, and buys later", () => {
  let s = createGame(20261120);
  for (const r of s.residents) s = act(s, { type: "policy", residentId: r.id, policy: "rest" });
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 2 });
  s = move(s, "village");
  const before = structuredClone(s), load = getCarryLoad(s, "aki");
  const preview = inspectRegionInteraction(s, "aki", "village-trader", "sell-scrap");
  assert.deepEqual([preview.coinsPaid, preview.coinsReceived, preview.walletBefore, preview.walletAfter,
    preview.villageCashBefore, preview.villageCashAfter], [0, 2, 0, 2, 6, 4]);
  s = sell(s);
  assert.equal(s.minutes, before.minutes);
  assert.equal(s.seed, before.seed);
  assert.equal(s.nextId, before.nextId + 1);
  assert.deepEqual(s.residents, before.residents);
  assert.deepEqual(s.resources, before.resources);
  assert.equal(s.logs.length, before.logs.length + 1);
  assert.equal(row(s).logId, s.logs.at(-1)!.id);
  assert.equal(row(s).termsId, "village-coins-v1");
  assert.deepEqual((s.logs.at(-1) as unknown as Record<string, unknown>).coinTrade,
    { choice: "sell-scrap", termsId: "village-coins-v1" });
  assert.deepEqual([row(s).coinsPaid, row(s).coinsReceived], [0, 2]);
  assert.equal(getWalletCoins(s, "aki"), 2);
  assert.equal(getWalletCoins(s, "mio"), 0);
  assert.ok(Math.abs(getCarryLoad(s, "aki").weight - (load.weight - 1 + 2 * COIN_WEIGHT)) < 1e-9);
  s = sell(s);
  s = move(s, "home");
  assert.equal(getWalletCoins(s, "aki"), 4);
  rejectedChoice(s, "buy-food");
  s = deserialize(serialize(s));
  s = ordinaryUntil(s, 1920);
  assert.equal(getVillageCash(s), VILLAGE_DAILY_CASH);
  assert.equal(getWalletCoins(s, "aki"), 4);
  s = move(s, "village");
  const hunger = person(s).hunger, hp = person(s).hp, clock = s.minutes;
  s = interact(s, "buy-food");
  assert.equal(getWalletCoins(s, "aki"), 0);
  assert.equal(pack(s).food, 3);
  assert.equal(person(s).hunger, hunger);
  assert.equal(person(s).hp, hp);
  assert.equal(s.minutes, clock);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Selling then buying has the same physical price as barter and shares both daily stocks", () => {
  const initial = village(10);
  const barterFood = interact(initial, "trade-food");
  const coinFood = interact(sell(sell(initial)), "buy-food");
  assert.deepEqual(totalResources(coinFood), totalResources(barterFood));
  assert.deepEqual(coinFood.inventory, barterFood.inventory);
  assert.deepEqual(getVillageStock(coinFood), getVillageStock(barterFood));
  assert.equal(getWalletCoins(coinFood, "aki"), 0);
  const barterMedicine = interact(initial, "trade-medicine");
  const coinMedicine = interact(sell(initial), "buy-medicine");
  assert.deepEqual(totalResources(coinMedicine), totalResources(barterMedicine));
  assert.deepEqual(coinMedicine.inventory, barterMedicine.inventory);
  let mixed = interact(barterFood, "trade-medicine");
  mixed = interact(sell(sell(mixed)), "buy-food");
  assert.deepEqual(getVillageStock(mixed), { food: 0, medicine: 2 });
  rejectedChoice(mixed, "trade-food");
  rejectedChoice(mixed, "buy-food");
  mixed = interact(sell(mixed), "buy-medicine");
  mixed = interact(mixed, "trade-medicine");
  assert.deepEqual(getVillageStock(mixed), { food: 0, medicine: 0 });
  rejectedChoice(mixed, "trade-medicine");
  mixed = sell(sell(mixed));
  assert.equal(getWalletCoins(mixed, "aki"), 4, "Empty stock is checked even when this owner can pay");
  rejectedChoice(mixed, "buy-food");
  rejectedChoice(mixed, "buy-medicine");
  assert.deepEqual(deserialize(serialize(mixed)), mixed);
});

test("The shop stops at cash zero, accepts returned purchase money, and projects a new day purely", () => {
  let s = sell(sell(sell(village(6))));
  assert.equal(getVillageCash(s), 0);
  assert.equal(getWalletCoins(s, "aki"), 6);
  assert.deepEqual(getVillageStock(s), { food: 6, medicine: 3 }, "Sold scrap is external procurement, not merchandise");
  rejectedChoice(s, "sell-scrap");
  const blocked = inspectRegionInteraction(s, "aki", "village-trader", "sell-scrap");
  assert.ok(blocked.error);
  assert.deepEqual([blocked.walletBefore, blocked.walletAfter, blocked.villageCashBefore, blocked.villageCashAfter], [6, 8, 0, -2]);
  s = interact(s, "buy-food");
  assert.equal(getVillageCash(s), 4);
  s = sell(sell(s));
  assert.equal(getVillageCash(s), 0);
  assert.equal(pack(s).scrap, 1);
  rejectedChoice(s, "sell-scrap");
  const tomorrow = nextControlledDay(s), raw = serialize(tomorrow);
  assert.equal(getVillageCash(tomorrow), 6);
  assert.equal(getWalletCoins(tomorrow, "aki"), 6);
  assert.deepEqual(getVillageStock(tomorrow), { food: 6, medicine: 3 });
  inspectRegionInteraction(tomorrow, "aki", "village-trader", "sell-scrap");
  assert.equal(serialize(tomorrow), raw);
  const next = sell(tomorrow);
  assert.equal(getVillageCash(next), 4);
  assert.equal(getWalletCoins(next, "aki"), 8);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Wallets use every established receipt, rather than the last ten displayed rows", () => {
  let s = village(12);
  for (let day = 0; day < 4; day++) {
    if (day) s = nextControlledDay(s);
    for (let n = 0; n < 3; n++) s = sell(s);
    assert.equal(getVillageCash(s), 0);
  }
  assert.equal(s.region!.receipts.length, 12);
  assert.equal(getWalletCoins(s, "aki"), 24);
  s = interact(s, "buy-medicine");
  assert.equal(getWalletCoins(s, "aki"), 22);
  assert.equal(getVillageCash(s), 2);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A sale needs the actor's free pack; the base, another resident, ground, and another wallet do not pay", () => {
  let s = village(0);
  s.pauseReason = "Keep this prior attention";
  s.resources.scrap = 100;
  person(s, "mio").location = "village";
  pack(s, "mio").scrap = 3;
  ensureInventory(s).ground.village = { food: 0, ingredients: 0, medicine: 0, scrap: 2 };
  rejectedChoice(s, "sell-scrap");
  s = act(s, { type: "transfer", residentId: "aki", from: "mio", to: "aki", resource: "scrap", amount: 1 });
  s = sell(s);
  assert.equal(getWalletCoins(s, "aki"), 2);
  assert.equal(getWalletCoins(s, "mio"), 0);
  rejectedChoice(s, "buy-medicine", "mio");
  rejected(s, { type: "transfer", residentId: "aki", from: "aki", to: "mio", resource: "coins", amount: 2 });
  assert.equal(s.resources.scrap, 100);
  assert.equal(s.inventory!.ground.village!.scrap, 2);
  assert.equal(pack(s, "mio").scrap, 2);
});

test("Reserved current and held materials survive sales, blocked sales, save, and actual completion", () => {
  let s = village(3);
  person(s).location = "home";
  pack(s).food = 1;
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "wood-flower" });
  s = advance(s, 5);
  const work = structuredClone(person(s).action);
  s = act(s, { type: "pause", residentId: "aki" });
  s = move(s, "village");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  const current = structuredClone(person(s).action), held = structuredClone(person(s).suspended);
  assert.deepEqual(held, work);
  assert.deepEqual(current!.reserved, { food: 1 });
  assert.equal(held!.reservationSource, "pack");
  s = sell(sell(s));
  assert.equal(ownFreeResources(s, "aki").scrap, 0);
  rejectedChoice(s, "sell-scrap");
  assert.deepEqual(person(s).action, current);
  assert.deepEqual(person(s).suspended, held);
  s = deserialize(serialize(s));
  assert.deepEqual(person(s).suspended, held);
  s = finish(s);
  assert.equal(pack(s).food, 0);
  s = move(s, "home");
  s = act(s, { type: "resume", residentId: "aki" });
  assert.deepEqual(person(s).action, held);
  s = finish(s);
  assert.equal(pack(s).scrap, 0);
  assert.equal(getWalletCoins(s, "aki"), 4);
  assert.equal(s.life!.crafts.filter(craft => craft.design === "flower").length, 1);
});

test("Coins have physical weight, affect a load threshold, and travel with a rescued owner", () => {
  assert.equal(COIN_WEIGHT, 0.01);
  assert.equal(VILLAGE_DAILY_CASH, 6);
  const dry = village(0);
  pack(dry).ingredients = 46; // Controlled exact 12kg boundary with the 0.5kg knife.
  const rich = sell(village(1));
  pack(rich).ingredients = 46;
  assert.equal(getCarryLoad(dry, "aki").weight, 12);
  assert.equal(getCarryLoad(dry, "aki").multiplier, 1);
  assert.ok(Math.abs(getCarryLoad(rich, "aki").weight - 12.02) < 1e-9);
  assert.equal(getCarryLoad(rich, "aki").multiplier, 1.25);
  const dryMove = act(dry, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  const richMove = act(rich, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  assert.ok(person(richMove).action!.duration > person(dryMove).action!.duration);
  assert.deepEqual(person(richMove).action!.path, person(dryMove).action!.path);
  assert.deepEqual(deserialize(serialize(richMove)), richMove);

  let patient = sell(village(1));
  person(patient).hp = 20; // Controlled casualty; rescue itself is a real command and journey.
  person(patient, "ren").location = "village";
  const rescuerWeight = getCarryLoad(patient, "ren").weight;
  patient = act(patient, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
  assert.ok(Math.abs(getCarryLoad(patient, "ren").weight - (rescuerWeight + 55 + 0.5 + 0.02)) < 1e-9);
  assert.equal(getWalletCoins(patient, "ren"), 0);
  patient = finish(patient, "ren");
  assert.equal(person(patient).location, "home");
  assert.equal(getWalletCoins(patient, "aki"), 2);
  assert.ok(Math.abs(getCarryLoad(patient, "ren").weight - rescuerWeight) < 1e-9);
  assert.deepEqual(deserialize(serialize(patient)), patient);
});

test("Old formats and old deeds receive no coins, wallet state, or receipt fields on inspection", () => {
  for (const version of [1, 2, 3] as const) {
    const old = interact(village(2), "trade-food");
    old.version = version;
    delete row(old).termsId; // Old barter encoding, with no currency metadata.
    const raw = serialize(old);
    assert.equal(getWalletCoins(old, "aki"), 0);
    assert.equal(getWalletCoins(old, "unknown"), 0);
    assert.equal(getVillageCash(old), 6);
    getCarryLoad(old, "aki");
    const oldPreview = inspectRegionInteraction(old, "aki", "village-trader", "trade-medicine");
    assert.equal("coinsPaid" in oldPreview, false);
    assert.equal("walletBefore" in oldPreview, false);
    assert.equal(serialize(old), raw);
    const loaded = deserialize(raw);
    assert.deepEqual(loaded.region!.receipts, old.region!.receipts);
    for (const key of ["coinsPaid", "coinsReceived", "logId", "termsId"])
      assert.equal(key in row(loaded), false);
    assert.equal("wallet" in loaded, false);
    assert.equal("coins" in pack(loaded), false);
    assert.equal(getWalletCoins(loaded, "aki"), 0);
  }
  const absent = createGame();
  delete absent.region;
  const before = serialize(absent);
  getWalletCoins(absent, "aki"); getVillageCash(absent);
  assert.equal(serialize(absent), before);
  for (const value of [null, {}, 1, "trade-food", "deliver", "unknown"]) assert.equal(isCoinChoice(value), false);
  for (const value of ["sell-scrap", "buy-food", "buy-medicine"]) assert.equal(isCoinChoice(value), true);
});

test("Old barter and guide credit mix with coins and replay, while journal wording is not a save schema", () => {
  let s = interact(village(5), "trade-food");
  delete row(s).termsId;
  s = interact(s, "talk", "aki", "village-guide");
  const before = serialize(s);
  const sequence = (start: GameState) => interact(interact(sell(start), "buy-medicine"), "deliver", "aki", "village-guide");
  const next = sequence(s);
  assert.deepEqual(sequence(deserialize(before)), next);
  assert.equal("termsId" in row(next, 0), false);
  assert.equal(row(next, 2).termsId, "village-coins-v1");
  assert.equal(getWalletCoins(next, "aki"), 0);
  assert.equal(next.region!.trust["village-guide"].aki, 3);
  assert.equal(next.region!.request!.deliveredBy, "aki");
  const reworded = structuredClone(next);
  for (const entry of reworded.region!.receipts) if (isCoinChoice(entry.choice)) {
    const log = reworded.logs.find(log => log.id === (entry as unknown as { logId: number }).logId)!;
    log.title = "将来の表記"; log.text = "成立した売買の言い回しを変更した。";
  }
  assert.deepEqual(deserialize(serialize(reworded)), reworded);
});

test("Same-minute sales have distinct journal IDs; simple duplication and reordered journal linkage are rejected", () => {
  const s = sell(sell(sell(village(3))));
  assert.equal(new Set(s.region!.receipts.map(entry => entry.time)).size, 1);
  const ids = s.region!.receipts.map(entry => (entry as unknown as { logId: number }).logId);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, 3);
  assert.equal(getWalletCoins(s, "aki"), 6);
  assert.deepEqual(deserialize(serialize(s)), s);
  const one = sell(village(3));
  rejectSave(one, broken => { broken.region!.receipts.push({ ...broken.region!.receipts[0] }); });
  rejectSave(s, broken => { broken.region!.receipts.reverse(); });
  rejectSave(s, broken => { row(broken, 1).logId = row(broken, 0).logId; });
});

test("A nonnegative final balance cannot hide an earlier empty wallet or shop deficit", () => {
  const wallet = interact(sell(sell(village(2))), "buy-food");
  assert.equal(getWalletCoins(wallet, "aki"), 0);
  rejectSave(wallet, broken => { reorderWithIncreasingLogIds(broken, [2, 0, 1]); });
  let shop = sell(sell(sell(village(5))));
  shop = sell(sell(interact(shop, "buy-food")));
  assert.equal(getVillageCash(shop), 0);
  rejectSave(shop, broken => { reorderWithIncreasingLogIds(broken, [0, 1, 2, 4, 5, 3]); });
});

test("Coin saves reject missing, wrong-type, unknown-venue and wrong-price metadata", () => {
  const valid = sell(village(2));
  for (const key of ["coinsPaid", "coinsReceived", "termsId", "logId"])
    rejectSave(valid, broken => { delete row(broken)[key]; });
  for (const key of ["coinsPaid", "coinsReceived", "logId"])
    for (const bad of [null, "2", {}, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      rejectSave(valid, broken => { row(broken)[key] = bad; });
  for (const terms of [null, "unknown", "village-barter-v1", "merchant-barter-v1"])
    rejectSave(valid, broken => { row(broken).termsId = terms; });
  rejectSave(valid, broken => { row(broken).coinsReceived = 4; });
  rejectSave(valid, broken => { row(broken).coinsPaid = 2; });
  rejectSave(valid, broken => { (row(broken).paid as Record<string, number>).scrap = 2; });
  rejectSave(valid, broken => { (row(broken).received as Record<string, number>).medicine = 1; });
  rejectSave(valid, broken => { row(broken).npcId = "village-guide"; });
  rejectSave(valid, broken => { row(broken).actorId = "mio"; });
  rejectSave(valid, broken => { row(broken).time = (row(broken).time as number) - 1; });
  for (const choice of ["talk", "deliver", "trade-food"] as const) {
    const old = village(3); pack(old).food = 3;
    const deed = interact(old, choice, "aki", choice === "trade-food" ? "village-trader" : "village-guide");
    for (const [key, value] of [["coinsPaid", 0], ["coinsReceived", 0], ["logId", deed.logs.at(-1)!.id]] as const)
      rejectSave(deed, broken => { row(broken)[key] = value; });
  }
});

test("A coin receipt needs the real social journal event, actor, NPC, time and witnesses", () => {
  const valid = sell(village(1));
  const mutations: Array<(s: GameState) => void> = [
    s => { row(s).logId = s.nextId; },
    s => { s.logs.at(-1)!.type = "work"; },
    s => { s.logs.at(-1)!.time--; },
    s => { s.logs.at(-1)!.actors = ["aki"]; },
    s => { s.logs.at(-1)!.actors = ["village-trader"]; },
    s => { s.logs.at(-1)!.witnesses = ["aki"]; },
    s => { s.logs.at(-1)!.witnesses = ["village-trader"]; },
    s => { s.logs.pop(); },
  ];
  for (const mutate of mutations) rejectSave(valid, mutate);
});

test("Coin markers bind one actual choice in both directions and cannot reuse an old same-minute social event", () => {
  const valid = sell(village(3));
  rejectSave(valid, broken => { delete (broken.logs.at(-1) as unknown as Record<string, unknown>).coinTrade; });
  for (const bad of [null, 1, [], {}, "sell-scrap", { choice: "unknown", termsId: "village-coins-v1" },
    { choice: "sell-scrap", termsId: "village-barter-v1" }, { choice: "buy-food", termsId: "village-coins-v1" }])
    rejectSave(valid, broken => { (broken.logs.at(-1) as unknown as Record<string, unknown>).coinTrade = bad; });
  rejectSave(valid, broken => { broken.region!.receipts.pop(); });
  const withTalk = interact(valid, "talk", "aki", "village-guide");
  rejectSave(withTalk, broken => {
    (broken.logs.at(-1) as unknown as Record<string, unknown>).coinTrade = { choice: "sell-scrap", termsId: "village-coins-v1" };
  });
  for (const choice of ["talk", "trade-food"] as const) {
    const old = interact(village(4), choice, "aki", choice === "talk" ? "village-guide" : "village-trader");
    const oldLogId = old.logs.at(-1)!.id;
    const mixed = sell(old);
    assert.equal(mixed.logs.at(-1)!.time, old.logs.at(-1)!.time);
    rejectSave(mixed, broken => { row(broken).logId = oldLogId; });
  }
});

test("Malformed journal collections reject as invalid saves rather than leaking internal TypeErrors", () => {
  const valid = sell(village(1));
  for (const bad of [null, {}, [null], [1], ["journal"], [true]]) {
    const broken = structuredClone(valid) as unknown as Record<string, unknown>;
    broken.logs = bad;
    assert.throws(() => deserialize(JSON.stringify(broken)), error => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof TypeError, false);
      assert.match(error.message, /保存データ.*不正/);
      return true;
    });
  }
});

test("Home barter receipts do not accept village currency bookkeeping fields", () => {
  let s = createGame(682);
  s.minutes = 2159;
  s.resources.food = s.resources.ingredients = 12;
  for (const r of s.residents) { r.hunger = r.energy = 100; r.policy = "rest"; }
  s = advance(s, 1);
  s = act(s, { type: "trade", residentId: "aki", visitId: s.trade!.visit!.id, offerId: "meal-for-scrap" });
  for (const [key, value] of [["coinsPaid", 0], ["coinsReceived", 0], ["logId", s.logs.at(-1)!.id]] as const)
    rejectSave(s, broken => { (broken.trade!.receipts[0] as unknown as Record<string, unknown>)[key] = value; });
});

test("A new companion's wallet starts empty and same-minute trading follows the actual joining log", () => {
  let s = village(3); pack(s).food = 3;
  s = interact(s, "talk", "aki", "village-guide");
  s = interact(s, "deliver", "aki", "village-guide");
  s = act(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  const joined = person(s, "village-guide");
  assert.equal(getWalletCoins(s, joined.id), 0);
  s = act(s, { type: "transfer", residentId: "aki", from: "aki", to: joined.id, resource: "scrap", amount: 1 });
  s = sell(s, joined.id);
  assert.equal(row(s).time, joined.joinedAt);
  assert.ok((row(s).logId as number) > joined.joinedLogId!);
  assert.equal(getWalletCoins(s, joined.id), 2);
  assert.equal(getWalletCoins(s, "aki"), 0);
  assert.deepEqual(deserialize(serialize(s)), s);
  rejectSave(s, broken => {
    const oldLog = broken.logs.find(log => log.id < joined.joinedLogId!)!;
    row(broken).logId = oldLog.id;
    oldLog.actors = [joined.id, "village-trader"];
    oldLog.witnesses = [joined.id, "village-trader"];
    (oldLog as unknown as Record<string, unknown>).coinTrade = { choice: "sell-scrap", termsId: "village-coins-v1" };
    delete (broken.logs.at(-1) as unknown as Record<string, unknown>).coinTrade;
  });
});
