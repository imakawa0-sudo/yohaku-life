import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import { createFoodBundle } from "../src/reform/housing/food";
import { startHousingGathering } from "../src/reform/housing/gathering";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  setHousingRoomAccess,
} from "../src/reform/sim";
import { stockLimit } from "../src/reform/mealStock";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [host, guest, worker] = people.map((p) => p.id);
const roomId = "bedroom";
const meal = {
  kind: "meal" as const,
  roomId,
  fixtureId: "fixture-1",
  actorIds: [host, guest],
  invitation: { hostId: host, guestId: guest },
};

function home() {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: roomId,
    kind: "table",
    cell: 5,
  });
  const g = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  return setHousingRoomAccess(enableHousing(g, "new"), roomId, [host]);
}

function keepDinersIdle(g: ReturnType<typeof home>) {
  return order(order(g, host, "recover"), guest, "recover");
}
function releaseDiners(g: ReturnType<typeof home>) {
  return order(order(g, host, "cancel"), guest, "cancel");
}

for (const physical of [false, true])
  test(
    (physical ? "physical ingredients" : "shared ingredients") +
      " remain available when the meal would take the shelves needed by a newly invited pair",
    () => {
      const g = home();
      const separated = physical
        ? createFoodBundle(g, { roomId: "living", storageCell: 2 })
        : null;
      if (separated) assert.ok(separated.bundleId, separated.error);
      const selection = separated
        ? { fixtureId: "hearth-1", bundleId: separated.bundleId! }
        : undefined;
      const occupied = keepDinersIdle(separated?.game ?? g);
      const preview = inspectOrder(occupied, worker, "work", "cook", selection);
      assert.ok(preview.minutes, preview.disabled);
      const cut = advance(
        order(occupied, worker, "work", "cook", selection),
        preview.minutes - 1,
      );
      const free = releaseDiners(cut);
      const yieldMeals = advance(free, 1).food - free.food;
      assert.ok(yieldMeals >= 3);
      free.food = stockLimit - yieldMeals + 2;
      const booked = startHousingGathering(free, meal);
      assert.equal(booked.food, free.food - 2);
      const blocked = advance(booked, 1);
      assert.ok(isGame(blocked));
      assert.equal(blocked.food, booked.food);
      assert.deepEqual(blocked.actors[2].xp, booked.actors[2].xp);
      if (physical) {
        const bundle = blocked.housing!.foodLogistics!.bundle;
        assert.equal(bundle.state, "present");
        assert.equal(bundle.assignment, undefined);
        assert.equal(blocked.ingredients, booked.ingredients);
        assert.ok(blocked.housing!.state.items[bundle.itemId]);
      } else {
        assert.equal(
          blocked.ingredients,
          booked.ingredients + booked.actors[2].task!.reserved.ingredients!,
        );
      }
      const cancelled = order(blocked, host, "cancel");
      const released = advance(cancelled, 2);
      assert.equal(released.food, free.food);
      assert.ok(!Object.hasOwn(released, "pendingMealReturns"));
      assert.ok(isGame(released));
    },
  );

test("a market purchase rechecks the home pantry before spending money or transferring the vendor's meal", () => {
  const occupied = keepDinersIdle(home());
  const buying = order(occupied, worker, "buy");
  const cut = advance(buying, buying.actors[2].task!.remaining - 1);
  const free = releaseDiners(cut);
  free.food = stockLimit;
  const booked = startHousingGathering(free, meal);
  const after = advance(booked, 1);
  assert.ok(isGame(after));
  assert.equal(after.world.trade.stock, free.world.trade.stock);
  assert.equal(after.coins, occupied.coins);
  assert.equal(after.food, stockLimit - 2);
  assert.match(inspectOrder(after, worker, "buy").disabled ?? "", /空き/);
});

test("unloading uses only unreserved shelves and returns the remaining food to the same resident's cargo", () => {
  const g = home();
  g.food = stockLimit - 1;
  g.actors[2].cargo.food = 5;
  const unloading = order(g, worker, "unpack", "food");
  const booked = startHousingGathering(unloading, meal);
  const unloaded = advance(booked, 3);
  assert.equal(unloaded.food, stockLimit - 2);
  assert.equal(unloaded.actors[2].cargo.food, 4);
  assert.ok(isGame(unloaded));
  assert.match(
    inspectOrder(unloaded, worker, "unpack", "food").disabled ?? "",
    /空き/,
  );
});

test("return and rescue leave excess meals with their actual carrier and can unload them once shelves open", () => {
  for (const rescue of [false, true]) {
    const g = createGame(
      people.slice(0, rescue ? 2 : 1),
      generateWorld(defaultWorldConfig()),
      "village",
    );
    g.food = stockLimit - 1;
    for (const a of g.actors) {
      a.location = "landing";
      a.room = "outdoors";
      a.cargo.food = 3;
    }
    if (rescue) g.actors[1].injury = 30;
    const booked = order(
      g,
      host,
      rescue ? "rescue" : "return",
      rescue ? guest : undefined,
    );
    assert.ok(booked.actors[0].task);
    const done = advance(booked, booked.actors[0].task.remaining);
    assert.ok(isGame(done));
    assert.equal(done.food, stockLimit);
    assert.deepEqual(
      done.actors.map((a) => [a.location, a.cargo.food]),
      rescue
        ? [
            ["village", 2],
            ["village", 3],
          ]
        : [["village", 2]],
    );
    done.food -= 2;
    const retry = advance(order(done, host, "unpack", "food"), 3);
    assert.equal(retry.actors[0].cargo.food, 0);
    assert.equal(retry.food, stockLimit);
    if (rescue) assert.equal(retry.actors[1].cargo.food, 3);
  }
});
