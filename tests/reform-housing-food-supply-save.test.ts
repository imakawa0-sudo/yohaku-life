import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFoodSupply,
  setFoodSupply,
  setFoodSupplyEnabled,
} from "../src/reform/housing/foodSupply";
import { assignFoodHaul, presentFood } from "../src/reform/housing/food";
import { foodTaskMinutes } from "../src/reform/housing/foodPresentation";
import { housingPoint } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { advance, isGame, order, type Game } from "../src/reform/sim";
import { base, one, two, ok } from "./helpers/construction";

const request = { actorId: one, roomId: "bedroom", storageCell: 2 };
function setup() {
  const origin = base();
  origin.ingredients = 6;
  const configured = ok(
    setFoodSupply(order(origin, two, "work", "care"), request),
  );
  const held = advance(configured, 2);
  assert.equal(
    Object.values(held.housing!.state.items)[0].position.kind,
    "carried",
  );
  const stored = advance(held, foodTaskMinutes(held, one)!);
  return { origin, configured, held, stored };
}
test("formal save keeps optional policy and an auto store task through pause or clear without starting work", () => {
  const { origin, configured, held, stored } = setup();
  const paused = ok(setFoodSupplyEnabled(held, false));
  const cleared = ok(clearFoodSupply(held));
  for (const g of [origin, configured, held, stored, paused, cleared]) {
    assert.ok(isGame(g));
    const saved = importSlot(
      exportSlot({ id: "food-supply", name: "補充", game: g, origin: g }),
    );
    assert.deepEqual(saved.game, JSON.parse(JSON.stringify(g)));
    assert.deepEqual(saved.origin, JSON.parse(JSON.stringify(g)));
    assert.deepEqual(advance(saved.game, 9), advance(g, 9));
  }
  assert.equal(Object.hasOwn(origin.housing!, "foodSupply"), false);
  assert.equal(Object.hasOwn(cleared.housing!, "foodSupply"), false);
  assert.equal(cleared.actors[0].task?.mode, "auto");
});

test("invalid policy shape/actor/floor and auto cook/return are rejected while legitimate auto store survives", () => {
  const { configured, held, stored } = setup();
  const policy = configured.housing!.foodSupply!;
  for (const invalid of [
    null,
    undefined,
    { ...policy, extra: 1 },
    { ...policy, version: 2 },
    { ...policy, actorId: "missing" },
    { ...policy, enabled: "yes" },
    { ...policy, storage: housingPoint("living", 0) },
    { ...policy, storage: housingPoint("living", 3) },
    { ...policy, storage: housingPoint("missing", 2) },
    { ...policy, storage: { ...policy.storage, extra: true } },
  ]) {
    const damaged = structuredClone(configured);
    damaged.housing!.foodSupply = invalid as never;
    assert.equal(isGame(damaged), false, JSON.stringify(invalid));
  }
  const b = presentFood(stored.housing)!;
  const returning = ok(assignFoodHaul(stored, b.id, one, "return"));
  const cooking = order(stored, one, "work", "cook", {
    fixtureId: "hearth-1",
    bundleId: b.id,
  });
  for (const g of [returning, cooking]) {
    assert.ok(isGame(g));
    g.actors[0].task!.mode = "auto";
    assert.equal(isGame(g), false);
  }
  assert.ok(isGame(held));
  const bad = structuredClone(held);
  bad.actors[0].task!.reserved = { ingredients: 2 };
  assert.equal(isGame(bad), false);
});
