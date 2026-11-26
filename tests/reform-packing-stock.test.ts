import assert from "node:assert/strict";
import test from "node:test";
import { createFoodBundle } from "../src/reform/housing/food";
import { setFoodSupply } from "../src/reform/housing/foodSupply";
import { exportSlot, importSlot } from "../src/reform/library";
import { stockLimit } from "../src/reform/mealStock";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  inspectOrder,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";
import { base, one, two, ok, reserved } from "./helpers/construction";

const people = [makePersona(0, 23), makePersona(1, 75)];
const [carrier, peer] = people.map((p) => p.id);
const origin = createGame(
  people,
  generateWorld(defaultWorldConfig()),
  "village",
);
const amounts = { wood: 4, food: 2, ingredients: 3, coins: 4 };
function reopen(game: Game) {
  assert.ok(isGame(game));
  const recovered = importSlot(
    exportSlot({ id: "cargo", name: "携行", game, origin }),
  ).game;
  assert.deepEqual(recovered, JSON.parse(JSON.stringify(game)));
  return recovered;
}

test("packing checks the carrier's own bag for all stock, and resumes safely after a partially completed pack", () => {
  for (const key of ["wood", "food", "ingredients", "coins"] as const) {
    const home = order(origin, peer, "recover");
    const amount = amounts[key];
    home.actors[0].cargo[key] = stockLimit - amount + 1;
    assert.match(
      inspectOrder(home, carrier, "pack", key).disabled ?? "",
      /荷物.*空き/,
    );
    const denied = order(home, carrier, "pack", key);
    assert.deepEqual(denied.actors, home.actors);
    assert.equal(denied[key], home[key]);
    home.actors[0].cargo[key]--;
    const held = reopen(advance(order(home, carrier, "pack", key), 1));
    assert.equal(held[key], home[key] - amount);
    assert.equal(held.actors[0].cargo[key], stockLimit - amount);
    const packed = reopen(advance(held, 2));
    assert.equal(packed.actors[0].cargo[key], stockLimit);
    assert.equal(packed[key], home[key] - amount);

    // An older save admitted this order even when the bag had too little room.
    held.actors[0].cargo[key]++;
    const refunded = reopen(advance(reopen(held), 2));
    assert.equal(refunded.actors[0].cargo[key], stockLimit - amount + 1);
    assert.equal(refunded[key], home[key]);
    assert.ok(!refunded.pendingPackReturns);
    assert.ok(!refunded.pendingMealReturns);
  }
});

test("heavy retained cargo never creates a regional travel order with an unsavable duration", () => {
  const home = structuredClone(origin);
  home.actors[0].cargo.wood = stockLimit;
  const away = structuredClone(home);
  away.actors[0].location = "landing";
  away.actors[0].room = "outdoors";
  for (const [start, kind, target] of [
    [home, "travel", "landing"],
    [away, "return", undefined],
  ] as const) {
    assert.match(
      inspectOrder(reopen(start), carrier, kind, target).disabled ?? "",
      /荷物.*移動時間/,
    );
    const denied = reopen(order(start, carrier, kind, target));
    assert.deepEqual(denied.actors, start.actors);
    assert.equal(denied.actors[0].cargo.wood, stockLimit);
    denied.actors[0].cargo.wood = 4;
    const allowed = reopen(order(denied, carrier, kind, target));
    assert.equal(allowed.actors[0].task?.kind, kind);
  }
});

test("a legacy pack with both ends full preserves its return through cancellation, completion, a new pack and reload", () => {
  for (const key of ["wood", "ingredients", "coins"] as const) {
    const home = order(origin, peer, "recover");
    const amount = amounts[key];
    const held = advance(order(home, carrier, "pack", key), 1);
    held[key] = stockLimit;
    held.actors[0].cargo[key] = stockLimit;
    const legacy = reopen(held);
    for (const ended of [
      order(legacy, carrier, "cancel"),
      advance(legacy, 2),
    ]) {
      const pending = reopen(ended);
      assert.equal(pending[key], stockLimit);
      assert.equal(pending.actors[0].cargo[key], stockLimit);
      assert.deepEqual(pending.pendingPackReturns, { [key]: amount });
      const rebooked = reopen(order(pending, peer, "pack", key));
      assert.equal(rebooked[key], stockLimit);
      assert.ok(!rebooked.pendingPackReturns);
      assert.equal(rebooked.actors[1].task?.reserved[key], amount);
      assert.deepEqual(
        reopen(order(rebooked, peer, "cancel")).pendingPackReturns,
        { [key]: amount },
      );
      const done = reopen(advance(order(rebooked, carrier, "recover"), 3));
      assert.equal(done.actors[1].cargo[key], amount);
      assert.equal(done.actors[0].cargo[key], stockLimit);
      assert.equal(done[key], stockLimit);
      assert.ok(!done.pendingPackReturns);
    }
  }
});

test("a staged vegetable bundle settles a prior return once, whether created by hand or by a resident's ordinary supply shift", () => {
  for (const task of ["cook", "pack"] as const) {
    const g = base();
    g.food = 10;
    const begun =
      task === "cook"
        ? order(g, two, "work", "cook")
        : order(g, two, "pack", "ingredients");
    const count = begun.actors[1].task!.reserved.ingredients!;
    begun.ingredients = stockLimit;
    const pending = order(begun, two, "cancel");
    const receipt =
      task === "cook" ? "pendingMealInputReturns" : "pendingPackReturns";
    assert.equal(pending[receipt]?.ingredients, count);
    const request = { roomId: "bedroom", storageCell: 2 };
    const configured = ok(
      setFoodSupply(order(pending, two, "recover"), {
        ...request,
        actorId: one,
      }),
    );
    const automatic = advance(configured, 1);
    assert.equal(automatic.actors[0].task?.kind, "home-haul");
    for (const result of [ok(createFoodBundle(pending, request)), automatic]) {
      assert.equal(reopen(result).ingredients, stockLimit);
      assert.equal(result[receipt]?.ingredients ?? 0, count - 2);
      assert.equal(result.housing!.foodLogistics!.bundle.quantity, 2);
    }
  }
});

test("wood really moved to a building site immediately frees shelves for a packing return", () => {
  const held = order(base(), one, "pack", "wood");
  held.wood = stockLimit;
  const pending = order(held, one, "cancel");
  assert.equal(pending.pendingPackReturns?.wood, amounts.wood);
  const staged = reserved(pending);
  const plan = Object.values(staged.housing!.construction!.plans)[0];
  assert.equal(
    reopen(staged).wood,
    stockLimit - plan.requiredWood + Math.min(plan.requiredWood, amounts.wood),
  );
  assert.equal(
    staged.pendingPackReturns?.wood ?? 0,
    Math.max(0, amounts.wood - plan.requiredWood),
  );
});

test("pack returns accept only bounded outstanding stock at both save boundaries", () => {
  const full = structuredClone(origin);
  full.wood = stockLimit;
  for (const wrong of [
    null,
    [],
    {},
    { wood: 0 },
    { food: 2 },
    { coins: 1 },
    { wood: 1.5 },
    { wood: 2 * stockLimit + 1 },
  ]) {
    const bad = Object.assign(structuredClone(full), {
      pendingPackReturns: wrong,
    });
    assert.equal(isGame(bad), false);
    for (const data of [
      { game: bad, origin },
      { game: origin, origin: bad },
    ])
      assert.throws(() =>
        importSlot(exportSlot({ ...data, id: "bad", name: "破損" })),
      );
  }
});
