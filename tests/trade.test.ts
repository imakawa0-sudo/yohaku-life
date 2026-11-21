import test from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_OFFERS,
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  getMerchantStatus,
  getTradeOffer,
  previewTrade,
  serialize,
  tradeSelection,
} from "../src/game/engine.ts";
import type { ActionKind, Command, GameState, TradeOfferId } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;

function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function assign(state: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}

function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 1000; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The action did not finish");
}

function beforeArrival(minutes = 2159): GameState {
  let state = createGame(20261120);
  state.minutes = minutes;
  state.resources.food = 12;
  state.resources.ingredients = 12;
  for (const resident of state.residents) {
    resident.hunger = 100;
    resident.energy = 100;
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  }
  return state;
}

function openVisit(): GameState {
  const state = advance(beforeArrival(), 1);
  assert.equal(state.minutes, 2160);
  assert.equal(getMerchantStatus(state).status, "open");
  return state;
}

function exchange(state: GameState, offer: TradeOfferId, id = "aki"): GameState {
  const result = tradeSelection(state, [id], state.trade!.visit!.id, offer);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function rejectedUnchanged(state: GameState, ids: string[], offer: TradeOfferId, intent: { allowLowFood?: boolean; confirmationKey?: string } = {}) {
  const before = serialize(state);
  const result = tradeSelection(state, ids, state.trade!.visit!.id, offer, intent);
  assert.ok(result.error);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
  return result;
}

test("Merchant status and offer previews are pure, including legacy saves and zero-time inspection", () => {
  const state = createGame(10);
  const before = serialize(state);
  assert.deepEqual(TRADE_OFFERS.map((offer) => offer.id).sort(), ["ingredients-for-medicine", "ingredients-for-scrap", "meal-for-medicine", "meal-for-scrap"]);
  assert.deepEqual(getTradeOffer("meal-for-scrap")?.paid, { food: 2 });
  assert.deepEqual(getTradeOffer("ingredients-for-medicine")?.paid, { ingredients: 4 });
  assert.equal(getTradeOffer("unknown"), undefined);
  const status = getMerchantStatus(state);
  assert.equal(status.status, "upcoming");
  assert.equal(status.arrivesAt, 2160);
  assert.equal(status.stock, undefined);
  assert.ok(previewTrade(state, ["aki"], undefined, "meal-for-scrap").error);
  assert.equal(serialize(state), before);

  const legacy = beforeArrival(2160);
  delete legacy.trade;
  legacy.pauseReason = "Preserve this existing attention";
  const old = serialize(legacy);
  assert.equal(getMerchantStatus(legacy).arrivesAt, 3600);
  previewTrade(legacy, ["aki"], undefined, "meal-for-scrap");
  assert.deepEqual(advance(legacy, 0), legacy);
  assert.deepEqual(advance(legacy, Number.NaN), legacy);
  assert.ok(tradeSelection(legacy, ["aki"], 2160, "meal-for-scrap").error);
  assert.equal(serialize(legacy), old);
  assert.equal(legacy.trade, undefined);
});

test("A legacy save schedules the first strictly future noon only when positive time starts", () => {
  for (const [minutes, expected] of [[480, 2160], [2159, 2160], [2160, 3600], [2400, 3600]] as const) {
    const legacy = beforeArrival(minutes);
    delete legacy.trade;
    const before = serialize(legacy);
    const next = advance(deserialize(before), 1);
    assert.equal(next.minutes, minutes + 1);
    assert.equal(serialize(legacy), before);
    if (minutes + 1 === expected) {
      assert.equal(next.trade?.visit?.id, expected);
      assert.equal(next.trade?.nextArrival, expected + 1440);
    } else {
      assert.equal(next.trade?.nextArrival, expected);
      assert.equal(next.trade?.visit, undefined);
    }
    assert.deepEqual(deserialize(serialize(next)), next);
  }
});

test("Arrival happens once and remains recorded when a simultaneous care or combat stop has priority", () => {
  const before = beforeArrival();
  const arrived = advance(before, 60);
  assert.equal(arrived.minutes, 2160);
  assert.equal(arrived.logs.length, before.logs.length + 1);
  assert.deepEqual(arrived.logs.at(-1)?.actors, []);
  assert.deepEqual(arrived.trade!.visit!.stock, { scrap: 3, medicine: 1 });
  const oneMore = advance(arrived, 1);
  assert.equal(oneMore.logs.length, arrived.logs.length);
  assert.equal(oneMore.trade!.visit!.id, arrived.trade!.visit!.id);

  const hungry = beforeArrival();
  person(hungry).hunger = 20.05;
  const care = advance(hungry, 60);
  assert.equal(care.minutes, 2160);
  assert.match(care.pauseReason ?? "", /空腹/);
  assert.equal(getMerchantStatus(care).status, "open");

  let endangered = beforeArrival();
  person(endangered, "ren").location = "ruins";
  person(endangered, "ren").hp = 1;
  endangered = assign(endangered, "defend", "ren");
  const combat = advance(endangered, 60);
  assert.equal(combat.minutes, 2160);
  assert.match(combat.pauseReason ?? "", /倒れ/);
  assert.equal(getMerchantStatus(combat).status, "open");
});

test("Trading uses the half-open noon-to-sixteen window and the next visit renews its own stock", () => {
  let state = advance(openVisit(), 239);
  assert.equal(state.minutes, 2399);
  assert.equal(getMerchantStatus(state).status, "open");
  state = exchange(state, "meal-for-scrap");
  assert.equal(state.trade!.visit!.stock.scrap, 2);
  state = advance(state, 1);
  assert.equal(state.minutes, 2400);
  assert.equal(getMerchantStatus(state).status, "departed");
  rejectedUnchanged(state, ["aki"], "meal-for-scrap");
  while (state.minutes < 3360) state = advance(state, Math.min(60, 3360 - state.minutes));
  assert.equal(getMerchantStatus(state).status, "upcoming");
  assert.equal(getMerchantStatus(state).arrivesAt, 3600);
  assert.equal(getMerchantStatus(state).stock, undefined);
  while (state.minutes < 3600) state = advance(state, Math.min(60, 3600 - state.minutes));
  assert.deepEqual(state.trade!.visit!.stock, { scrap: 3, medicine: 1 });
  assert.equal(state.trade!.visit!.id, 3600);
  assert.equal(state.trade!.receipts.length, 1);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A successful exchange is time-free, atomic, attributed to its actor, and preserves stationary work and its interruption", () => {
  let state = assign(openVisit(), "hobby");
  state = advance(state, 5);
  state = assign(state, "cook");
  state.pauseReason = "Keep the current pause reason";
  const before = serialize(state);
  const people = structuredClone(state.residents);
  const nextId = state.nextId;
  const preview = previewTrade(state, ["aki"], state.trade!.visit!.id, "ingredients-for-scrap");
  assert.equal(preview.error, undefined);
  assert.equal(preview.before.ingredients, 10);
  assert.equal(preview.reserved.ingredients, 2);
  assert.equal(preview.after?.ingredients, 7);
  assert.equal(preview.after?.scrap, state.resources.scrap + 1);
  const exchanged = exchange(state, "ingredients-for-scrap");
  assert.equal(exchanged.minutes, state.minutes);
  assert.equal(exchanged.seed, state.seed);
  assert.equal(exchanged.pauseReason, state.pauseReason);
  assert.deepEqual(exchanged.residents, people);
  assert.equal(exchanged.nextId, nextId + 2);
  assert.equal(exchanged.resources.ingredients, state.resources.ingredients - 3);
  assert.equal(exchanged.resources.scrap, state.resources.scrap + 1);
  assert.deepEqual(exchanged.logs.at(-1)?.actors, ["aki"]);
  assert.equal(exchanged.trade!.receipts.at(-1)?.actorId, "aki");
  assert.equal(exchanged.trade!.receipts.at(-1)?.lowFoodConfirmed, undefined);
  assert.equal(serialize(state), before);
  assert.deepEqual(deserialize(serialize(exchanged)), exchanged);
});

test("Selection and actor eligibility never choose a hidden representative, while home companions can trade without the hero", () => {
  const state = openVisit();
  rejectedUnchanged(state, [], "meal-for-scrap");
  rejectedUnchanged(state, ["aki", "mio"], "meal-for-scrap");
  rejectedUnchanged(state, ["unknown"], "meal-for-scrap");
  const asleep = assign(state, "sleep", "mio");
  rejectedUnchanged(asleep, ["mio"], "meal-for-scrap");
  const walking = assign(state, "move", "mio", "kitchen");
  rejectedUnchanged(walking, ["mio"], "meal-for-scrap");
  const elsewhere = structuredClone(state);
  person(elsewhere, "mio").location = "bedroom";
  rejectedUnchanged(elsewhere, ["mio"], "meal-for-scrap");

  let absent = structuredClone(state);
  person(absent).location = "road";
  person(absent).hp = 0;
  person(absent, "ren").location = "ruins";
  absent = assign(absent, "defend", "ren");
  const exchanged = exchange(absent, "meal-for-scrap", "mio");
  assert.deepEqual(exchanged.logs.at(-1)?.actors, ["mio"]);
  assert.equal(exchanged.trade!.receipts.at(-1)?.actorId, "mio");
  assert.deepEqual(exchanged.residents, absent.residents);

  // Controlled legacy state: a rescue job remains after both people reached
  // home. Normal rescue completion and arrival occur together. The old claim
  // still holds the carrier's own job, but cannot pin the returned patient.
  let carried = openVisit();
  person(carried).location = "road";
  person(carried).hp = 20;
  person(carried, "mio").location = "road";
  carried = assign(carried, "rescue", "mio", "aki");
  person(carried).location = "home";
  person(carried, "mio").location = "home";
  rejectedUnchanged(carried, ["mio"], "meal-for-scrap");
  const patientTrade = exchange(carried, "meal-for-scrap", "aki");
  assert.deepEqual(patientTrade.residents, carried.residents);
  assert.equal(patientTrade.trade!.receipts.at(-1)?.actorId, "aki");
});

test("Current meals and suspended cooking keep their reservations out of tradeable food", () => {
  let state = openVisit();
  state.resources.food = 2;
  state.resources.ingredients = 4;
  state = assign(state, "cook");
  state = advance(state, 3);
  state = assign(state, "eat");
  const jobs = structuredClone(person(state));
  const mealPreview = previewTrade(state, ["mio"], state.trade!.visit!.id, "meal-for-scrap");
  assert.equal(mealPreview.before.food, 1);
  assert.equal(mealPreview.reserved.food, 1);
  assert.equal(mealPreview.reserved.ingredients, 2);
  assert.ok(mealPreview.error);
  rejectedUnchanged(state, ["mio"], "meal-for-scrap", { allowLowFood: true, confirmationKey: "not-a-bypass" });
  rejectedUnchanged(state, ["mio"], "ingredients-for-scrap", { allowLowFood: true, confirmationKey: "not-a-bypass" });
  assert.deepEqual(person(state), jobs);
});

test("Payment alternatives share a finite stock instead of each receiving a separate inventory", () => {
  let state = openVisit();
  state = exchange(state, "meal-for-medicine");
  assert.equal(state.trade!.visit!.stock.medicine, 0);
  rejectedUnchanged(state, ["aki"], "ingredients-for-medicine");
  state = exchange(state, "meal-for-scrap");
  state = exchange(state, "ingredients-for-scrap");
  state = exchange(state, "meal-for-scrap");
  assert.equal(state.trade!.visit!.stock.scrap, 0);
  rejectedUnchanged(state, ["aki"], "ingredients-for-scrap");
  assert.equal(state.trade!.receipts.length, 4);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Low-food confirmation follows the same boundary for meals and ingredients and only a matching confirmation executes", () => {
  for (const [food, ingredients, offer, warning] of [
    [5, 0, "meal-for-scrap", false],
    [4, 2, "meal-for-scrap", false],
    [4, 1, "meal-for-scrap", true],
    [2, 4, "ingredients-for-scrap", true],
    [2, 5, "ingredients-for-scrap", false],
  ] as const) {
    const state = openVisit();
    state.resources.food = food;
    state.resources.ingredients = ingredients;
    const preview = previewTrade(state, ["aki"], state.trade!.visit!.id, offer);
    assert.equal(preview.error, undefined);
    assert.equal(!!preview.warning, warning);
  }
  let state = openVisit();
  state.resources.food = 4;
  state.resources.ingredients = 0;
  const preview = previewTrade(state, ["aki"], state.trade!.visit!.id, "meal-for-scrap");
  assert.ok(preview.warning);
  assert.ok(preview.confirmationKey);
  rejectedUnchanged(state, ["aki"], "meal-for-scrap");
  rejectedUnchanged(state, ["aki"], "meal-for-scrap", { allowLowFood: true });
  const confirmed = tradeSelection(state, ["aki"], state.trade!.visit!.id, "meal-for-scrap", { allowLowFood: true, confirmationKey: preview.confirmationKey });
  assert.equal(confirmed.error, undefined);
  state = confirmed.state;
  assert.equal(state.resources.food, 2);
  assert.equal(state.trade!.receipts.at(-1)?.lowFoodConfirmed, true);
  rejectedUnchanged(state, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: preview.confirmationKey });
});

test("A low-food acknowledgement cannot be reused after offer, actor, time, stock, total inventory, or reservations change", () => {
  const state = openVisit();
  state.resources.food = 4;
  state.resources.ingredients = 0;
  const key = previewTrade(state, ["aki"], state.trade!.visit!.id, "meal-for-scrap").confirmationKey;
  assert.ok(key);
  rejectedUnchanged(state, ["aki"], "meal-for-medicine", { allowLowFood: true, confirmationKey: key });
  rejectedUnchanged(state, ["mio"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  rejectedUnchanged(advance(state, 1), ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const unrelatedInventory = structuredClone(state);
  unrelatedInventory.resources.medicine += 1;
  rejectedUnchanged(unrelatedInventory, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const newlyReserved = assign(state, "eat", "mio");
  assert.ok(previewTrade(newlyReserved, ["aki"], newlyReserved.trade!.visit!.id, "meal-for-scrap").warning);
  rejectedUnchanged(newlyReserved, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const mioKey = previewTrade(state, ["mio"], state.trade!.visit!.id, "meal-for-scrap").confirmationKey;
  const otherPurchase = tradeSelection(state, ["mio"], state.trade!.visit!.id, "meal-for-scrap", { allowLowFood: true, confirmationKey: mioKey });
  assert.equal(otherPurchase.error, undefined);
  // Controlled, loader-valid inventory fixture isolates changed merchant stock.
  // Receipt accounting intentionally does not prescribe today's total inventory.
  const changedStock = otherPurchase.state;
  changedStock.resources = { ...state.resources };
  assert.deepEqual(deserialize(serialize(changedStock)), changedStock);
  rejectedUnchanged(changedStock, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const noLongerLow = structuredClone(state);
  noLongerLow.resources.ingredients = 2;
  assert.equal(previewTrade(noLongerLow, ["aki"], noLongerLow.trade!.visit!.id, "meal-for-scrap").warning, undefined);
  rejectedUnchanged(noLongerLow, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  assert.equal(tradeSelection(noLongerLow, ["aki"], noLongerLow.trade!.visit!.id, "meal-for-scrap").error, undefined);
});

test("Explicit low-food approval never bypasses absolute shortage, empty stock, a closed visit, or an unavailable actor", () => {
  const base = openVisit();
  base.resources.food = 4;
  base.resources.ingredients = 0;
  const key = previewTrade(base, ["aki"], base.trade!.visit!.id, "meal-for-scrap").confirmationKey;
  const insufficient = structuredClone(base);
  insufficient.resources.food = 1;
  rejectedUnchanged(insufficient, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const sleeping = assign(base, "sleep");
  rejectedUnchanged(sleeping, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  let emptyStock = openVisit();
  for (const offer of ["meal-for-scrap", "ingredients-for-scrap", "meal-for-scrap"] as const)
    emptyStock = exchange(emptyStock, offer);
  assert.equal(emptyStock.trade!.visit!.stock.scrap, 0);
  rejectedUnchanged(emptyStock, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
  const closed = advance(base, 240);
  rejectedUnchanged(closed, ["aki"], "meal-for-scrap", { allowLowFood: true, confirmationKey: key });
});

test("Trade save validation rejects malformed schedules, receipts, rates, IDs, and stock accounting", () => {
  const valid = exchange(openVisit(), "meal-for-scrap");
  const before = serialize(valid);
  const corruptions: Array<(state: GameState) => void> = [
    (state) => { state.trade!.version = 99 as 1; },
    (state) => { state.trade!.nextArrival += 1; },
    (state) => { state.trade!.visit!.id += 1; },
    (state) => { state.trade!.visit!.stock.scrap += 1; },
    (state) => { state.trade!.receipts[0].paid.food = 3; },
    (state) => { state.trade!.receipts[0].received.scrap = 2; },
    (state) => { state.trade!.receipts[0].actorId = "unknown"; },
    (state) => { state.trade!.receipts[0].time = state.trade!.visit!.leavesAt; },
    (state) => { state.trade!.receipts[0].id = state.logs[0].id; },
    (state) => { state.trade!.receipts.push({ ...state.trade!.receipts[0] }); },
    (state) => { (state.trade!.receipts[0].paid as Record<string, number>).gold = 1; },
    (state) => { state.minutes = state.trade!.visit!.leavesAt; },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(valid);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  assert.equal(serialize(valid), before);
  assert.deepEqual(deserialize(before), valid);
});

test("Legitimately spending traded materials on projects does not invalidate past receipts", () => {
  let state = exchange(openVisit(), "meal-for-scrap");
  assert.equal(state.resources.scrap, 5);
  for (const recipe of ["kitchen-tools", "wood-flower", "wood-flower"])
    state = finish(assign(state, "project", "aki", recipe));
  assert.equal(state.resources.scrap, 0);
  assert.equal(state.trade!.receipts.length, 1);
  assert.equal(state.trade!.visit!.stock.scrap, 2);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Arrival and an actual exchange replay identically with a saved state and the same seed", () => {
  const initial = beforeArrival();
  const whole = advance(initial, 10);
  const split = advance(deserialize(serialize(initial)), 1);
  assert.deepEqual(split, whole);
  const preview = previewTrade(whole, ["aki"], whole.trade!.visit!.id, "meal-for-scrap");
  const restored = deserialize(serialize(whole));
  assert.equal(previewTrade(restored, ["aki"], restored.trade!.visit!.id, "meal-for-scrap").confirmationKey, preview.confirmationKey);
  assert.deepEqual(exchange(restored, "meal-for-scrap"), exchange(whole, "meal-for-scrap"));
});
