import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, availableResources, command, createGame, deserialize, getMerchantOffers,
  getMerchantStatus, getTradeOffer, previewTrade, serialize,
} from "../src/game/engine.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { inspectRegionInteraction } from "../src/game/region.ts";
import type { Command, GameState, TradeOfferId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function trade(s: GameState, offerId: TradeOfferId = "meal-for-scrap"): GameState {
  return act(s, { type: "trade", residentId: "aki", visitId: s.trade!.visit!.id, offerId });
}
// Controlled timing boundary, separate from the ordinary two-visit path below.
function beforeVisit(): GameState {
  const s = createGame(20261120);
  s.minutes = 2159;
  s.resources.food = 12;
  s.resources.ingredients = 12;
  for (const r of s.residents) { r.hunger = 100; r.energy = 100; }
  return s;
}
const openVisit = () => advance(beforeVisit(), 1);
function village(): GameState {
  const s = createGame(421);
  s.minutes = 600;
  person(s).location = "village";
  ensureInventory(s).packs.aki.scrap = 8;
  return s;
}
const regionAct = (s: GameState, npcId: string, choice: "talk" | "trade-food" | "trade-medicine" | "deliver") =>
  act(s, { type: "region", residentId: "aki", npcId, choice });

test("Merchant historical terms and saved-visit offers stay pure and immutable", () => {
  const s = createGame(10);
  delete s.trade;
  const before = serialize(s);
  const offers = getMerchantOffers(s);
  assert.deepEqual(offers.map((o) => [o.id, o.paid, o.received]), [
    ["meal-for-scrap", { food: 2 }, { scrap: 1 }],
    ["ingredients-for-scrap", { ingredients: 3 }, { scrap: 1 }],
    ["meal-for-medicine", { food: 3 }, { medicine: 1 }],
    ["ingredients-for-medicine", { ingredients: 4 }, { medicine: 1 }],
  ]);
  assert.throws(() => { offers[0].paid.food = 99; }, TypeError);
  assert.throws(() => { offers[0].received.scrap = 99; }, TypeError);
  assert.deepEqual(getTradeOffer("meal-for-scrap")?.paid, { food: 2 });
  previewTrade(s, ["aki"], undefined, "meal-for-scrap");
  getMerchantStatus(s);
  assert.deepEqual(advance(s, 0), s);
  assert.equal(serialize(s), before);
});

test("A real positive arrival and trade record the same historical terms without changing settlement rules", () => {
  const before = beforeVisit();
  getMerchantOffers(before);
  assert.equal(before.trade?.visit, undefined);
  const s = advance(before, 1);
  assert.equal(s.trade!.visit!.termsId, "merchant-barter-v1");
  const raw = serialize(s);
  const preview = previewTrade(s, ["aki"], s.trade!.visit!.id, "meal-for-scrap");
  assert.equal(preview.termsId, "merchant-barter-v1");
  assert.equal(serialize(s), raw);
  assert.ok(preview.confirmationKey!.includes("merchant-barter-v1"));
  const next = trade(s);
  assert.equal(next.trade!.receipts[0].termsId, preview.termsId);
  assert.equal(next.minutes, s.minutes);
  assert.equal(next.seed, s.seed);
  assert.equal(next.nextId, s.nextId + 2);
  assert.equal(next.resources.food, s.resources.food - 2);
  assert.equal(next.resources.scrap, s.resources.scrap + 1);
  assert.deepEqual(next.trade!.visit!.stock, { scrap: 2, medicine: 1 });
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Version 1–3 legacy term omissions survive reading, preview, new trades and replay", () => {
  for (const version of [1, 2, 3] as const) {
    const legacy = trade(openVisit());
    legacy.version = version;
    // Legacy encoding: only the new metadata is removed from a real transaction.
    delete legacy.trade!.visit!.termsId;
    delete legacy.trade!.receipts[0].termsId;
    const raw = serialize(legacy);
    const loaded = deserialize(raw);
    assert.equal("termsId" in loaded.trade!.visit!, false);
    assert.equal("termsId" in loaded.trade!.receipts[0], false);
    const beforePreview = serialize(loaded);
    assert.equal(previewTrade(loaded, ["aki"], loaded.trade!.visit!.id, "ingredients-for-scrap").termsId, "merchant-barter-v1");
    getMerchantOffers(loaded);
    assert.equal(serialize(loaded), beforePreview);
    const next = trade(loaded, "ingredients-for-scrap");
    assert.equal("termsId" in next.trade!.visit!, false);
    assert.equal("termsId" in next.trade!.receipts[0], false);
    assert.equal(next.trade!.receipts[1].termsId, "merchant-barter-v1");
    assert.deepEqual(deserialize(serialize(next)), next);
    assert.deepEqual(trade(deserialize(beforePreview), "ingredients-for-scrap"), next);
    assert.equal(serialize(legacy), raw);
  }
});

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

test("An ordinary two-visit path preserves an old encoded receipt beside the next new visit and receipt", () => {
  let s = createGame(20261120);
  s = act(s, { type: "food-production-target", target: 12 });
  s = act(s, { type: "policy", residentId: "mio", policy: "cook" });
  s = act(s, { type: "policy", residentId: "ren", policy: "gather" });
  s = ordinaryUntil(s, 2160);
  s = trade(s, "ingredients-for-scrap");
  delete s.trade!.visit!.termsId;
  delete s.trade!.receipts[0].termsId;
  s = deserialize(serialize(s));
  s = ordinaryUntil(s, 3600);
  assert.equal(s.trade!.visit!.termsId, "merchant-barter-v1");
  assert.equal(s.trade!.visit!.id, 3600);
  const before = serialize(s);
  const next = trade(s, "ingredients-for-scrap");
  assert.equal("termsId" in next.trade!.receipts[0], false);
  assert.equal(next.trade!.receipts[1].termsId, "merchant-barter-v1");
  assert.deepEqual(deserialize(serialize(next)), next);
  assert.deepEqual(trade(deserialize(before), "ingredients-for-scrap"), next);
});

test("Merchant saves reject malformed, unknown and other-venue terms and mismatched amounts", () => {
  const valid = trade(openVisit());
  for (const bad of [null, 1, {}, "unknown", "village-barter-v1"]) {
    for (const where of ["visit", "receipt"]) {
      const broken = structuredClone(valid);
      const target = where === "visit" ? broken.trade!.visit! : broken.trade!.receipts[0];
      (target as unknown as Record<string, unknown>).termsId = bad;
      assert.throws(() => deserialize(serialize(broken)), `${where}: ${JSON.stringify(bad)}`);
    }
  }
  for (const mutate of [
    (s: GameState) => { s.trade!.receipts[0].paid.food = 3; },
    (s: GameState) => { s.trade!.receipts[0].received.scrap = 2; },
    (s: GameState) => { s.trade!.visit!.stock.scrap = 3; },
  ]) {
    const broken = structuredClone(valid);
    mutate(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
});

test("Invalid saved visit terms never fall back to a current offer during execution", () => {
  const s = openVisit();
  (s.trade!.visit! as unknown as Record<string, unknown>).termsId = "village-barter-v1";
  const before = serialize(s);
  assert.deepEqual(getMerchantOffers(s), []);
  assert.ok(previewTrade(s, ["aki"], s.trade!.visit!.id, "meal-for-scrap").error);
  const result = command(s, { type: "trade", residentId: "aki", visitId: s.trade!.visit!.id, offerId: "meal-for-scrap" });
  assert.ok(result.error);
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
});

test("Village barter previews have terms, while conversations and the one-time delivery do not", () => {
  const s = village();
  const before = serialize(s);
  for (const choice of ["trade-food", "trade-medicine"] as const) {
    const preview = inspectRegionInteraction(s, "aki", "village-trader", choice);
    assert.equal(preview.termsId, "village-barter-v1");
    preview.paid.scrap = 99;
    assert.equal(inspectRegionInteraction(s, "aki", "village-trader", choice).paid.scrap, choice === "trade-food" ? 2 : 1);
  }
  for (const choice of ["talk", "deliver"] as const)
    assert.equal("termsId" in inspectRegionInteraction(s, "aki", "village-guide", choice), false);
  assert.equal(serialize(s), before);
});

test("Mixed village receipts retain old omissions, current terms, stock and guide credit on save and replay", () => {
  let s = regionAct(village(), "village-trader", "trade-food");
  delete s.region!.receipts[0].termsId;
  s = deserialize(serialize(s));
  const before = serialize(s);
  let next = regionAct(s, "village-trader", "trade-medicine");
  next = regionAct(next, "village-guide", "talk");
  next = regionAct(next, "village-guide", "deliver");
  assert.equal("termsId" in next.region!.receipts[0], false);
  assert.equal(next.region!.receipts[1].termsId, "village-barter-v1");
  assert.equal("termsId" in next.region!.receipts[2], false);
  assert.equal("termsId" in next.region!.receipts[3], false);
  assert.deepEqual(next.region!.stock, { food: 3, medicine: 2 });
  assert.equal(next.region!.trust["village-guide"].aki, 3);
  assert.equal(next.region!.request!.deliveredBy, "aki");
  assert.deepEqual(deserialize(serialize(next)), next);
  let replay = regionAct(deserialize(before), "village-trader", "trade-medicine");
  replay = regionAct(replay, "village-guide", "talk");
  replay = regionAct(replay, "village-guide", "deliver");
  assert.deepEqual(replay, next);
});

test("Village saves reject wrong terms and do not accept barter terms on social deeds", () => {
  let valid = regionAct(village(), "village-trader", "trade-food");
  valid = regionAct(valid, "village-guide", "talk");
  valid = regionAct(valid, "village-guide", "deliver");
  for (const bad of [null, 1, {}, "unknown", "merchant-barter-v1"]) {
    const broken = structuredClone(valid);
    (broken.region!.receipts[0] as unknown as Record<string, unknown>).termsId = bad;
    assert.throws(() => deserialize(serialize(broken)));
  }
  for (const index of [1, 2]) {
    const broken = structuredClone(valid);
    broken.region!.receipts[index].termsId = "village-barter-v1";
    assert.throws(() => deserialize(serialize(broken)));
  }
  const wrongAmount = structuredClone(valid);
  wrongAmount.region!.receipts[0].paid.scrap = 1;
  assert.throws(() => deserialize(serialize(wrongAmount)));
});

test("Versioned merchant trade preserves held work and its reservations through save and continuation", () => {
  let s = openVisit();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "wood-flower" });
  s = advance(s, 5);
  s = act(s, { type: "pause", residentId: "aki" });
  const held = structuredClone(person(s).suspended);
  const stock = { ...s.resources };
  const clock = s.minutes, seed = s.seed;
  s = trade(s, "ingredients-for-scrap");
  assert.deepEqual(person(s).suspended, held);
  assert.equal(s.minutes, clock);
  assert.equal(s.seed, seed);
  assert.equal(s.resources.ingredients, stock.ingredients - 3);
  assert.equal(s.resources.scrap, stock.scrap + 1);
  const restored = deserialize(serialize(s));
  assert.deepEqual(person(restored).suspended, held);
  const next = act(restored, { type: "resume", residentId: "aki" });
  assert.deepEqual(person(next).action, held);
  assert.deepEqual(act(deserialize(serialize(s)), { type: "resume", residentId: "aki" }), next);
});
