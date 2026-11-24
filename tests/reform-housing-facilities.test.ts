import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse } from "../src/reform/house";
import { housingStatus } from "../src/reform/housing/presentation";
import { housingLinkId, housingSlotId } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  options,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [one, two, three] = people.map((p) => p.id);

function readingHouse() {
  const house = initialHouse();
  house.rooms[0].fixtures.push({ id: "near-books", kind: "shelf", cell: 4 });
  house.rooms[1].fixtures.push({ id: "constructor", kind: "shelf", cell: 6 });
  return house;
}

function base(house = readingHouse(), residents = 1) {
  const game = createGame(
    people.slice(0, residents),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  assert.ok(isGame(game));
  return game;
}

function assertRejected(
  game: Game,
  fixtureId: string,
  reason: RegExp,
  id = one,
) {
  const original = structuredClone(game);
  const preview = inspectOrder(game, id, "home-use", fixtureId);
  assert.match(preview.disabled ?? "", reason);
  assert.equal(preview.minutes, undefined);
  assert.deepEqual(structuredClone(game), original);
  const rejected = order(game, id, "home-use", fixtureId);
  assert.deepEqual({ ...rejected, log: original.log }, original);
  assert.deepEqual(structuredClone(game), original);
}

test("automatic and explicit reading preview and book their respective fixtures", () => {
  const game = enableHousing(base(), "new");
  const original = structuredClone(game);
  const automatic = inspectOrder(game, one, "need", "fun");
  const selected = inspectOrder(game, one, "home-use", "constructor");
  assert.deepEqual(automatic, {
    minutes: 14,
    reserved: {},
    facility: {
      fixtureId: "near-books",
      roomId: "living",
      fixtureKind: "shelf",
      fixtureCell: 4,
      moveMinutes: 0,
      useMinutes: 14,
    },
  });
  assert.deepEqual(selected, {
    minutes: 19,
    reserved: {},
    facility: {
      fixtureId: "constructor",
      roomId: "bedroom",
      fixtureKind: "shelf",
      fixtureCell: 6,
      moveMinutes: 5,
      useMinutes: 14,
    },
  });
  assert.deepEqual(
    options(game, one).find((o) => o.kind === "need" && o.target === "fun")
      ?.facility,
    automatic.facility,
  );
  assert.deepEqual(structuredClone(game), original);

  const autoGame = order(structuredClone(game), one, "need", "fun");
  const chosenGame = order(
    structuredClone(game),
    one,
    "home-use",
    "constructor",
  );
  assert.equal(
    autoGame.actors[0].task?.station,
    housingSlotId("living", "near-books", 0),
  );
  assert.equal(autoGame.actors[0].task?.room, "living");
  assert.equal(
    chosenGame.actors[0].task?.station,
    housingSlotId("bedroom", "constructor", 0),
  );
  assert.equal(chosenGame.actors[0].task?.room, "bedroom");
  assert.equal(chosenGame.actors[0].task?.total, 14);
  assert.equal(chosenGame.time, original.time);
  assert.equal(chosenGame.rng, original.rng);
  const arrived = advance(chosenGame, 5);
  assert.equal(arrived.actors[0].room, "bedroom");
  assert.equal(arrived.actors[0].task?.remaining, 14);
  assert.equal(housingStatus(arrived, one).phase, "use");
  assert.equal(advance(arrived, 14).actors[0].task, null);
});

test("replacement preview preserves a meal and predicts the booking after its refund", () => {
  const house = readingHouse();
  house.rooms[2].fixtures.push({ id: "yard-hearth", kind: "hearth", cell: 6 });
  const game = enableHousing(base(house), "new");
  game.food = 1;
  const eating = advance(order(game, one, "need", "hunger"), 3);
  const original = structuredClone(eating);
  assert.equal(eating.food, 0);
  assert.equal(housingStatus(eating, one).phase, "use");
  for (let i = 0; i < 2; i++) {
    const replacement = inspectOrder(eating, one, "home-use", "yard-hearth");
    assert.equal(replacement.disabled, undefined);
    assert.equal(replacement.facility?.fixtureId, "yard-hearth");
    assert.deepEqual(replacement.reserved, { food: 1 });
    assert.deepEqual(eating, original);
  }
  const replaced = order(eating, one, "home-use", "yard-hearth");
  assert.equal(replaced.food, 0);
  assert.equal(replaced.actors[0].task?.room, "yard");
  assert.notEqual(
    replaced.actors[0].task?.spatial?.orderId,
    eating.actors[0].task?.spatial?.orderId,
  );
  assert.equal(Object.keys(replaced.housing!.state.reservations).length, 1);
  assert.ok(isGame(replaced));
});

test("a two-seat fixture books its other seat and refuses a third resident without fallback", () => {
  const house = readingHouse();
  house.rooms[1].fixtures.push({ id: "spare-bench", kind: "bench", cell: 7 });
  const game = enableHousing(base(house, 3), "new");
  const first = order(game, one, "home-use", "bench-1");
  assert.equal(
    first.actors[0].task?.station,
    housingSlotId("living", "bench-1", 0),
  );
  assert.equal(
    inspectOrder(first, two, "home-use", "bench-1").disabled,
    undefined,
  );
  const second = order(first, two, "home-use", "bench-1");
  assert.equal(
    second.actors[1].task?.station,
    housingSlotId("living", "bench-1", 1),
  );
  assert.deepEqual(second.actors[0].task, first.actors[0].task);
  const busy = order(second, three, "need", "hunger");
  assert.deepEqual(busy.actors[2].task?.reserved, { food: 1 });
  assert.equal(
    inspectOrder(busy, three, "need", "social").facility?.fixtureId,
    "spare-bench",
  );
  assertRejected(busy, "bench-1", /予約/, three);
});

test("a blocked, forbidden, or missing fixture cannot fall back to reachable reading", () => {
  const game = enableHousing(base(), "new");
  const closed = setHousingPassage(
    game,
    "link",
    housingLinkId("living", "bedroom"),
    false,
  );
  const forbidden = setHousingRoomAccess(game, "bedroom", []);
  assert.equal(inspectOrder(closed, one, "need", "fun").minutes, 14);
  assert.equal(inspectOrder(forbidden, one, "need", "fun").minutes, 14);
  assertRejected(closed, "constructor", /通路/);
  assertRejected(forbidden, "constructor", /許可/);
  assertRejected(game, "__proto__", /選んだ設備がありません/);
  assertRejected(game, "constructor ", /選んだ設備がありません/);
});

function mealOrigin() {
  const house = initialHouse();
  house.rooms[2].fixtures.push({
    id: "yard-kitchen",
    kind: "kitchen",
    cell: 6,
  });
  const game = enableHousing(base(house), "new");
  game.actors[0].needs.hunger = 31;
  return game;
}

test("cancelling an explicit meal refunds its one reserved meal at the safe exit", () => {
  const origin = mealOrigin();
  const preview = inspectOrder(origin, one, "home-use", "yard-kitchen");
  assert.deepEqual(preview.reserved, { food: 1 });
  const booked = order(origin, one, "home-use", "yard-kitchen");
  assert.equal(booked.food, origin.food - 1);
  assert.equal(booked.actors[0].needs.hunger, origin.actors[0].needs.hunger);

  const still = order(booked, one, "cancel");
  assert.equal(still.food, origin.food);
  assert.equal(Object.keys(still.housing!.state.reservations).length, 0);

  const moving = advance(booked, 1);
  const pending = order(moving, one, "cancel");
  assert.equal(housingStatus(pending, one).phase, "cancelling");
  assert.equal(pending.food, origin.food - 1);
  const returned = advance(pending, 2);
  assert.equal(returned.actors[0].task, null);
  assert.equal(returned.food, origin.food);
  assert.equal(Object.keys(returned.housing!.state.reservations).length, 0);
  assert.equal(order(returned, one, "cancel").food, origin.food);
});

test("explicit meal import during travel and use preserves origin and completes exactly once", () => {
  const origin = mealOrigin();
  const preview = inspectOrder(origin, one, "home-use", "yard-kitchen");
  assert.equal(preview.minutes, 18);
  const active = order(origin, one, "home-use", "yard-kitchen");
  const arrived = advance(active, 8);
  assert.equal(arrived.actors[0].room, "yard");
  assert.equal(arrived.actors[0].metrics.travel, 8);
  assert.equal(arrived.actors[0].task?.remaining, 10);
  assert.equal(arrived.food, origin.food - 1);
  assert.ok(Math.abs(arrived.actors[0].needs.hunger - (31 - 8 * 0.12)) < 1e-8);
  const last = advance(active, 17);
  assert.equal(last.actors[0].task?.remaining, 1);
  assert.ok(
    Math.abs(last.actors[0].needs.hunger - (31 - 8 * 0.12 - 9 * 0.036)) < 1e-8,
  );
  const done = advance(last, 1);
  assert.equal(done.actors[0].task, null);
  assert.equal(done.food, origin.food - 1);
  assert.equal(Object.keys(done.housing!.state.reservations).length, 0);
  const expected = 31 - 8 * 0.12 - 10 * 0.036 + 56;
  assert.ok(Math.abs(done.actors[0].needs.hunger - expected) < 1e-8);
  assert.ok(
    Math.abs(advance(done, 1).actors[0].needs.hunger - (expected - 0.12)) <
      1e-8,
  );

  for (const elapsed of [4, 13]) {
    const game = advance(active, elapsed);
    const slot = { id: "meal", name: "食事の途中", game, origin };
    const loaded = importSlot(exportSlot(slot));
    assert.deepEqual(loaded.origin, structuredClone(origin));
    assert.deepEqual(loaded.game, game);
    assert.deepEqual(advance(loaded.game, 18 - elapsed), done);
  }
});

test("old games and actors away from home retain their old need orders", () => {
  const legacy = base();
  const legacyNeed = inspectOrder(legacy, one, "need", "fun");
  assert.equal(legacyNeed.minutes, 15);
  assert.equal(legacyNeed.facility, undefined);
  assert.equal(
    order(legacy, one, "need", "fun").actors[0].task?.station,
    "near-books",
  );
  assertRejected(legacy, "near-books", /自宅/);

  const home = enableHousing(base(), "new");
  const trip = order(home, one, "travel", "landing");
  assert.ok(trip.actors[0].task);
  const outside = advance(trip, trip.actors[0].task.remaining);
  assert.equal(outside.actors[0].location, "landing");
  assert.equal(inspectOrder(outside, one, "need", "fun").minutes, 27);
  assert.equal(
    order(outside, one, "need", "fun").actors[0].task?.spatial,
    undefined,
  );
  assertRejected(outside, "near-books", /自宅/);
});

test("explicit rest follows the established injury, danger, and transit rules", () => {
  const house = initialHouse();
  house.rooms[1].fixtures[0].kind = "bed";
  const game = enableHousing(base(house), "new");
  game.actors[0].injury = 70;
  const rest = inspectOrder(game, one, "need", "energy");
  assert.equal(rest.disabled, undefined);
  assert.deepEqual(inspectOrder(game, one, "home-use", "mat-1"), rest);
  assert.equal(
    order(game, one, "home-use", "mat-1").actors[0].task?.target,
    "energy",
  );

  const danger = structuredClone(game);
  danger.actors[0].danger = true;
  assertRejected(danger, "mat-1", /交渉・応戦・撤退/);

  const moving = advance(order(game, one, "need", "energy"), 1);
  assert.equal(moving.housing!.state.actors[one].position.kind, "transit");
  assertRejected(moving, "mat-1", /区間/);
});

test("the six explicit uses share the existing need task and save contract", () => {
  const game = enableHousing(base(), "new");
  for (const [fixtureId, need] of [
    ["hearth-1", "hunger"],
    ["latrine-1", "bladder"],
    ["basin-1", "hygiene"],
    ["mat-1", "energy"],
    ["bench-1", "social"],
    ["near-books", "fun"],
  ]) {
    const automatic = order(structuredClone(game), one, "need", need);
    const selected = order(structuredClone(game), one, "home-use", fixtureId);
    assert.equal(selected.actors[0].task?.kind, "need", fixtureId);
    assert.equal(selected.actors[0].task?.target, need, fixtureId);
    assert.deepEqual(selected, automatic, fixtureId);
    assert.ok(isGame(selected), fixtureId);
    selected.actors[0].task!.kind = "home-use";
    assert.equal(isGame(selected), false, fixtureId);
  }
});
