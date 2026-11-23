import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import { advance, createGame, isGame, order } from "../src/reform/sim";
import { projectLegacyHousing } from "../src/reform/spatial/legacy";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

function sampleSlot() {
  const person = { ...makePersona(0, 127), id: "__proto__" };
  const origin = createGame(
    [person],
    generateWorld(defaultWorldConfig()),
    "village",
  );
  const game = advance(order(origin, person.id, "work", "cook"), 1);
  return {
    id: "original-slot",
    name: "検証の朝".repeat(24),
    game,
    origin,
    notes: { tags: ["synthetic"], optional: undefined },
  };
}

test("legacy_layout_is_not_rearranged", () => {
  const slot = sampleSlot();
  const house = initialHouse();
  const [living, bedroom, yard] = house.rooms;
  living.height = 4;
  living.walls = [6];
  living.doors = [2];
  living.fixtures[2].cell = 15;
  bedroom.name = yard.name;
  bedroom.id = "__proto__";
  bedroom.fixtures[0].id = "__proto__";
  house.links = [
    ["yard", "living"],
    ["__proto__", "yard"],
    ["living", "__proto__"],
  ];
  slot.game.house = house;
  const { game, source } = projectLegacyHousing(slot);

  assert.deepEqual(Object.keys(game.rooms), ["living", "__proto__", "yard"]);
  assert.deepEqual(game.rooms.living, living);
  assert.deepEqual(game.rooms["__proto__"], bedroom);
  assert.deepEqual(game.rooms.yard, yard);
  assert.ok(Object.hasOwn(game.fixtures, "__proto__"));
  assert.deepEqual(game.fixtures["__proto__"], { room: "__proto__", cell: 10 });
  assert.deepEqual(game.fixtures["window-1"], { room: "living", cell: 15 });
  assert.equal(game.rooms.constructor, undefined);
  assert.equal(game.fixtures.constructor, undefined);
  assert.deepEqual(game.links, [
    {
      a: { room: "yard", cell: 0 },
      b: { room: "living", cell: 0 },
      minutes: 3,
    },
    {
      a: { room: "__proto__", cell: 0 },
      b: { room: "yard", cell: 0 },
      minutes: 3,
    },
    {
      a: { room: "living", cell: 0 },
      b: { room: "__proto__", cell: 0 },
      minutes: 3,
    },
  ]);
  assert.deepEqual(source.game.house, house);
});

test("legacy_positions_stay_unspecified", () => {
  const slot = sampleSlot();
  // The pending cooking task names a different room from the saved actor.
  slot.game.actors[0].room = "bedroom";
  assert.equal(slot.game.actors[0].task?.room, "living");
  const { game } = projectLegacyHousing(slot);

  assert.ok(Object.hasOwn(game.actors, "__proto__"));
  assert.deepEqual(game.actors["__proto__"], {
    kind: "legacy-unspecified",
    location: "village",
    room: "bedroom",
  });
  assert.equal(game.actors.constructor, undefined);
});

test("legacy_work_is_preserved_without_recharge", () => {
  const slot = sampleSlot();
  slot.game.actors[0].cargo.coins = 3;
  slot.game.rng = 1437226410;
  const before = structuredClone(slot);
  const pending = before.game.actors[0].task;
  assert.ok(pending && pending.remaining < pending.total);
  assert.deepEqual(pending.reserved, { ingredients: 2 });

  const { source } = projectLegacyHousing(slot);

  assert.deepEqual(source, before);
  assert.deepEqual(source.game.actors[0].task, pending);
  assert.notEqual(source.game.actors[0].task, slot.game.actors[0].task);
  assert.equal(source.game.ingredients, before.origin.ingredients - 2);
  assert.equal(source.game.actors[0].cargo.coins, 3);
  assert.equal(source.game.rng, 1437226410);
  assert.deepEqual(slot, before);
});

test("game_and_origin_are_distinct", () => {
  const slot = sampleSlot();
  const [actor] = slot.game.actors;
  actor.location = "orchard";
  actor.room = "outdoors";
  actor.task = null;
  slot.game.house.rooms[0].name = "改装後";
  const before = structuredClone(slot);

  const { source, game, origin } = projectLegacyHousing(slot);

  assert.deepEqual(source.game, before.game);
  assert.deepEqual(source.origin, before.origin);
  assert.ok(game.rooms.living);
  assert.equal(game.rooms.living.name, "改装後");
  assert.equal(origin.rooms.living.name, "居間");
  assert.deepEqual(game.actors[actor.person.id], {
    kind: "legacy-unspecified",
    location: "orchard",
    room: "outdoors",
  });
  assert.equal(origin.actors[actor.person.id].location, "village");
  game.rooms.living.fixtures[0].cell = 7;
  game.links[0].a.room = "changed-view";
  game.actors[actor.person.id].room = "changed-view";
  assert.deepEqual(source, before);
  assert.deepEqual(origin.rooms.living, before.origin.house.rooms[0]);
  assert.equal(origin.links[0].a.room, "living");
  assert.equal(origin.actors[actor.person.id].room, "living");
  source.game.actors[0].person.name = "changed-copy";
  assert.deepEqual(slot, before);

  const shared = projectLegacyHousing({
    ...slot,
    game: { ...slot.game, house: slot.origin.house },
  });
  shared.source.game.house.rooms[0].doors.push(2);
  assert.deepEqual(shared.source.origin.house, before.origin.house);
  assert.deepEqual(slot, before);
});

test("invalid_origin_rejects_all", () => {
  const slot = sampleSlot();
  const damaged = { ...slot, origin: { ...slot.origin, rng: -1 } };
  const before = structuredClone(damaged);
  assert.ok(isGame(damaged.game));
  assert.equal(isGame(damaged.origin), false);

  assert.throws(() => projectLegacyHousing(damaged), Error);
  assert.deepEqual(damaged, before);

  for (const other of [
    { ...slot, game: damaged.origin },
    { ...slot, id: "" },
    { ...slot, id: 42 },
    { ...slot, name: "  " },
    { ...slot, name: null },
    { id: slot.id, name: slot.name, game: slot.game },
    { type: "yohaku-reform-save", version: 1, slot },
    null,
  ]) {
    assert.throws(() => projectLegacyHousing(other), Error);
  }
});
