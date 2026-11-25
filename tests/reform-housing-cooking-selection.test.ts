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
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type CookingFacilitySelection,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [one, two, three] = people.map((p) => p.id);
const farther = { fixtureId: "yard-cooker" };
const near = { fixtureId: "hearth-1" };

function base(kind: "hearth" | "kitchen" = "hearth", residents = 1) {
  const house = initialHouse();
  house.rooms[2].fixtures.push({ id: farther.fixtureId, kind, cell: 6 });
  const game = createGame(
    people.slice(0, residents),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  // Make all recipes available and keep recipe costs independent of personas.
  game.actors[0].person.skills.cook = 5;
  game.ingredients = 6;
  assert.ok(isGame(game));
  return game;
}

test("explicit farther hearth keeps the recipe, time, material reservation and pure preview", () => {
  const game = enableHousing(base(), "new");
  const original = structuredClone(game);
  for (const [recipe, cost, extra] of [
    ["cook", 2, 0],
    ["cook:easy", 2, 0],
    ["cook:hard", 3, 21],
    ["cook:master", 3, 42],
  ] as const) {
    const automatic = inspectOrder(game, one, "work", recipe);
    const selected = inspectOrder(game, one, "work", recipe, farther);
    const useMinutes =
      Math.ceil((32 + extra) * (1 - 5 * 0.035 - game.actors[0].mood * 0.001)) +
      10;
    assert.equal(automatic.facility?.fixtureId, near.fixtureId);
    assert.deepEqual(selected, {
      minutes: useMinutes + 8,
      reserved: { ingredients: cost },
      facility: {
        fixtureId: farther.fixtureId,
        fixtureKind: "hearth",
        roomId: "yard",
        fixtureCell: 6,
        moveMinutes: 8,
        useMinutes,
      },
    });
    assert.deepEqual(structuredClone(game), original);
    const active = order(game, one, "work", recipe, farther);
    assert.equal(active.actors[0].task?.kind, "work");
    assert.equal(active.actors[0].task?.target, recipe);
    assert.equal(
      active.actors[0].task?.station,
      housingSlotId("yard", farther.fixtureId, 0),
    );
    assert.equal(active.actors[0].task?.room, "yard");
    assert.equal(active.actors[0].task?.total, useMinutes);
    assert.deepEqual(active.actors[0].task?.reserved, { ingredients: cost });
    assert.equal(active.ingredients, game.ingredients - cost);
    assert.equal(active.food, game.food);
    assert.equal(active.time, game.time);
    assert.equal(active.rng, game.rng);
    assert.ok(isGame(active));
    assert.deepEqual(structuredClone(game), original);
    assert.deepEqual(inspectOrder(game, one, "work", recipe, near), automatic);
    assert.deepEqual(
      order(game, one, "work", recipe, near),
      order(game, one, "work", recipe),
    );
  }
});

test("selected kitchen reserves only cooking seat zero; seat one is available for dining", () => {
  const game = enableHousing(base("kitchen", 3), "new");
  const active = order(game, one, "work", "cook", farther);
  assert.equal(
    active.actors[0].task?.station,
    housingSlotId("yard", farther.fixtureId, 0),
  );
  const dining = order(active, two, "home-use", farther.fixtureId);
  assert.equal(
    dining.actors[1].task?.station,
    housingSlotId("yard", farther.fixtureId, 1),
  );
  assert.deepEqual(dining.actors[0].task, active.actors[0].task);
  assert.equal(dining.food, game.food - 1);
  assert.equal(dining.ingredients, game.ingredients - 2);
  assert.ok(isGame(dining));
  assert.match(
    inspectOrder(active, two, "work", "cook", farther).disabled ?? "",
    /予約/,
  );
  assert.equal(
    inspectOrder(active, two, "work", "cook").facility?.fixtureId,
    near.fixtureId,
  );
  assert.match(
    inspectOrder(dining, three, "work", "cook", farther).disabled ?? "",
    /予約/,
  );
});

function assertRejected(
  game: Game,
  selection: unknown,
  reason: RegExp,
  kind = "work",
  target = "cook",
  id = one,
) {
  const original = structuredClone(game);
  // Deliberately exercise runtime callers that bypass TypeScript's input contract.
  const input = selection as CookingFacilitySelection;
  const preview = inspectOrder(game, id, kind, target, input);
  assert.match(preview.disabled ?? "", reason);
  assert.equal(preview.minutes, undefined);
  assert.equal(preview.reserved, undefined);
  assert.equal(preview.facility, undefined);
  assert.deepEqual(structuredClone(game), original);
  const rejected = order(game, id, kind, target, input);
  assert.match(rejected.log[0], reason);
  assert.deepEqual({ ...rejected, log: original.log }, original);
  assert.deepEqual(structuredClone(game), original);
}

test("malformed selections, missing or noncooking equipment, and nonrecipe commands preserve an active task", () => {
  const game = order(enableHousing(base(), "new"), one, "work", "cook");
  for (const input of [
    null,
    {},
    1,
    "yard-cooker",
    [],
    { fixtureId: "" },
    { fixtureId: 1 },
  ])
    assertRejected(game, input, /設備/);
  assertRejected(game, { fixtureId: "missing" }, /設備/);
  assertRejected(game, { fixtureId: "hearth-1 " }, /設備/);
  assertRejected(game, { fixtureId: "__proto__" }, /設備/);
  assertRejected(game, { fixtureId: "mat-1" }, /料理/);
  assertRejected(game, farther, /料理/, "need", "hunger");
  assertRejected(game, farther, /料理/, "home-use", near.fixtureId);
  assertRejected(game, farther, /料理/, "cancel");
  for (const target of [
    "wood",
    "cook:unknown",
    "cook:hard:extra",
    "cook:",
    "cook:easy:",
  ])
    assertRejected(game, farther, /料理/, "work", target);
  assert.deepEqual(
    order(game, one, "work", "cook", undefined),
    order(game, one, "work", "cook"),
  );
});

test("the specifically chosen cooking fixture cannot fall back to an available alternative", () => {
  const game = enableHousing(base(), "new");
  for (const [blocked, reason] of [
    [
      setHousingPassage(game, "link", housingLinkId("bedroom", "yard"), false),
      /通路/,
    ],
    [setHousingRoomAccess(game, "yard", []), /許可/],
  ] as const) {
    assert.equal(
      inspectOrder(blocked, one, "work", "cook").facility?.fixtureId,
      near.fixtureId,
    );
    assertRejected(blocked, farther, reason);
  }

  // Controlled geometry error: the legacy house validator disallows this
  // surrounded fixture, but the planner must still report the missing use cell.
  const raw = base();
  raw.house.rooms[2].walls = [2, 5, 7, 10];
  const noCell = enableHousing(raw, "new");
  assert.equal(
    inspectOrder(noCell, one, "work", "cook").facility?.fixtureId,
    near.fixtureId,
  );
  assertRejected(noCell, farther, /使用位置/);

  const occupied = order(
    enableHousing(base("kitchen", 2), "new"),
    two,
    "home-use",
    farther.fixtureId,
  );
  assert.equal(
    occupied.actors[1].task?.station,
    housingSlotId("yard", farther.fixtureId, 0),
  );
  assert.equal(
    inspectOrder(occupied, one, "work", "cook").facility?.fixtureId,
    near.fixtureId,
  );
  assertRejected(occupied, farther, /予約/);
});

test("explicit cooking follows the existing skill, materials, injury, danger and transit rules", () => {
  const game = enableHousing(base(), "new");
  const insufficient = structuredClone(game);
  insufficient.ingredients = 1;
  assertRejected(insufficient, farther, /足りません/);
  assertRejected(insufficient, farther, /足りません/, "work", "cook:hard");
  const lowSkill = structuredClone(game);
  lowSkill.actors[0].person.skills.cook = 4;
  assertRejected(lowSkill, farther, /技能5/, "work", "cook:master");
  const injured = structuredClone(game);
  injured.actors[0].injury = 70;
  assertRejected(injured, farther, /重い傷/);
  const dangerous = structuredClone(game);
  dangerous.actors[0].danger = true;
  assertRejected(dangerous, farther, /交渉・応戦・撤退/);
  const moving = advance(
    order(game, one, "home-move", JSON.stringify({ roomId: "yard", cell: 0 })),
    1,
  );
  assert.equal(moving.housing!.state.actors[one].position.kind, "transit");
  assertRejected(moving, farther, /区間/);
  assertRejected(moving, farther, /料理/, "cancel");
});

test("legacy and away-from-home cooking remain available only without explicit selection", () => {
  const legacy = base();
  assert.equal(inspectOrder(legacy, one, "work", "cook").disabled, undefined);
  assert.equal(
    order(legacy, one, "work", "cook").actors[0].task?.station,
    near.fixtureId,
  );
  assertRejected(legacy, farther, /自宅/);

  const home = enableHousing(base(), "new");
  const trip = order(home, one, "travel", "landing");
  const outside = advance(trip, trip.actors[0].task!.remaining);
  assert.equal(outside.actors[0].location, "landing");
  outside.actors[0].cargo.ingredients = 3;
  assert.equal(inspectOrder(outside, one, "work", "cook").disabled, undefined);
  const cookedOutside = order(outside, one, "work", "cook");
  assert.equal(cookedOutside.actors[0].task?.spatial, undefined);
  assert.equal(cookedOutside.actors[0].cargo.ingredients, 1);
  assertRejected(outside, farther, /自宅/);
});

test("replacement and cancellation use the established once-only reservation accounting", () => {
  const origin = enableHousing(base(), "new");
  origin.ingredients = 3;
  const cooking = order(origin, one, "work", "cook:hard", near);
  const using = advance(cooking, 2);
  assert.equal(housingStatus(using, one).phase, "use");
  assert.equal(using.ingredients, 0);
  const original = structuredClone(using);
  assert.deepEqual(inspectOrder(using, one, "work", "cook", farther).reserved, {
    ingredients: 2,
  });
  assert.deepEqual(using, original);
  const replacement = order(using, one, "work", "cook", farther);
  assert.equal(replacement.ingredients, 1);
  assert.equal(replacement.food, origin.food);
  assert.equal(
    replacement.actors[0].task?.station,
    housingSlotId("yard", farther.fixtureId, 0),
  );
  assert.equal(Object.keys(replacement.housing!.state.reservations).length, 1);
  assert.notEqual(
    replacement.actors[0].task?.spatial?.orderId,
    using.actors[0].task?.spatial?.orderId,
  );
  assert.ok(isGame(replacement));
  const stopped = order(replacement, one, "cancel");
  assert.equal(stopped.ingredients, 3);
  assert.equal(stopped.food, origin.food);
  assert.equal(Object.keys(stopped.housing!.state.reservations).length, 0);
  assert.equal(order(stopped, one, "cancel").ingredients, 3);
});

function reload(game: Game, origin: Game) {
  assert.ok(isGame(game));
  const loaded = importSlot(
    exportSlot({ id: "cooking", name: "台所への移動", game, origin }),
  );
  assert.deepEqual(loaded.game, game);
  assert.deepEqual(loaded.origin, structuredClone(origin));
  return loaded.game;
}

test("selected cooking saves during travel and use, then completes the original recipe exactly once", () => {
  const raw = base("kitchen");
  raw.house.rooms[0].fixtures[0].kind = "kitchen";
  const origin = enableHousing(raw, "new");
  const preview = inspectOrder(origin, one, "work", "cook:hard", farther);
  assert.equal(preview.facility?.fixtureId, farther.fixtureId);
  assert.equal(preview.facility?.fixtureKind, "kitchen");
  assert.equal(preview.facility?.moveMinutes, 8);
  const active = order(origin, one, "work", "cook:hard", farther);
  const moving = advance(active, 1);
  assert.equal(moving.housing!.state.actors[one].position.kind, "transit");
  const arrived = advance(active, 8);
  assert.equal(housingStatus(arrived, one).phase, "use");
  assert.equal(arrived.actors[0].task?.remaining, preview.facility?.useMinutes);
  const total = preview.minutes!;
  const last = advance(active, total - 1);
  assert.equal(last.food, origin.food);
  const done = advance(last, 1);
  assert.equal(done.actors[0].task, null);
  assert.equal(done.food, origin.food + 6);
  assert.equal(done.ingredients, origin.ingredients - 3);
  assert.equal(Object.keys(done.housing!.state.reservations).length, 0);
  for (const elapsed of [1, 8, total - 1]) {
    assert.deepEqual(
      advance(reload(advance(active, elapsed), origin), total - elapsed),
      done,
    );
  }
  reload(done, origin);

  const cancelling = order(reload(moving, origin), one, "cancel");
  assert.equal(housingStatus(cancelling, one).phase, "cancelling");
  assert.equal(cancelling.ingredients, origin.ingredients - 3);
  const cancelled = advance(reload(cancelling, origin), 2);
  assert.equal(cancelled.actors[0].task, null);
  assert.equal(cancelled.ingredients, origin.ingredients);
  assert.equal(cancelled.food, origin.food);
  assert.equal(Object.keys(cancelled.housing!.state.reservations).length, 0);
  assert.equal(
    order(reload(cancelled, origin), one, "cancel").ingredients,
    origin.ingredients,
  );
  const stoppedWhileUsing = order(reload(arrived, origin), one, "cancel");
  assert.equal(stoppedWhileUsing.ingredients, origin.ingredients);
  assert.equal(stoppedWhileUsing.food, origin.food);
  reload(stoppedWhileUsing, origin);
});
