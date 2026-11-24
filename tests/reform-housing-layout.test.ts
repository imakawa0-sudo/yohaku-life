import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse } from "../src/reform/house";
import { inspectHousingLayoutUpgrade } from "../src/reform/housing/layout";
import { housingStatus } from "../src/reform/housing/presentation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import {
  buildHousingTopology,
  housingDoorId,
  housingLinkId,
  housingPoint,
  housingSlotId,
} from "../src/reform/housing/topology";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [one, two, three] = people.map((p) => p.id);
const bench = housingSlotId("living", "bench-1", 0);
const secondBench = housingSlotId("living", "bench-1", 1);

function base(house = initialHouse()) {
  return createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}

function oneSeatHouse() {
  const house = initialHouse();
  const living = house.rooms[0];
  living.fixtures = [living.fixtures[1]];
  living.walls = [1, 2, 7, 9, 10];
  return house;
}

function upgraded(game: Game) {
  const inspected = inspectHousingLayoutUpgrade(game);
  assert.ok(inspected.ok, inspected.ok ? "" : inspected.reason);
  return { ...game, housing: inspected.housing };
}

test("an omitted layout marker keeps the original starter slot IDs and points", () => {
  const { geometry } = buildHousingTopology(initialHouse(), []);
  assert.deepEqual(
    Object.entries(geometry.slots).map(([id, slot]) => [id, slot.point.cell]),
    [
      ['["slot","living","hearth-1",0]', 2],
      ['["slot","living","bench-1",0]', 1],
      ['["slot","living","bench-1",1]', 1],
      ['["slot","living","window-1",0]', 7],
      ['["slot","bedroom","mat-1",0]', 6],
      ['["slot","yard","latrine-1",0]', 2],
      ['["slot","yard","basin-1",0]', 7],
    ],
  );
});

test("layout 2 assigns the two starter bench seats distinct adjacent floors in order", () => {
  const layout = buildHousingTopology(
    initialHouse(),
    [],
    undefined,
    undefined,
    2,
  );
  assert.deepEqual(layout.slots[bench].point, housingPoint("living", 1));
  assert.deepEqual(layout.slots[secondBench].point, housingPoint("living", 4));
  assert.deepEqual(
    layout.geometry.slots[secondBench].point,
    housingPoint("living", 4),
  );
});

test("layout 2 exposes one real seat when only one neighboring floor is reachable", () => {
  const layout = buildHousingTopology(oneSeatHouse(), [], undefined, undefined, 2);
  assert.deepEqual(layout.slots[bench].point, housingPoint("living", 4));
  assert.equal(layout.slots[secondBench], undefined);
  assert.equal(layout.geometry.slots[secondBench], undefined);
});

for (const mode of ["new", "legacy"] as const) {
  test(`an active ${mode === "new" ? "spatial" : "legacy"} second-seat booking prevents a layout upgrade that would move it`, () => {
    const house = initialHouse();
    const fixtureId = 'bench|"/';
    house.rooms[0].fixtures[1].id = fixtureId;
    const source = mode === "new"
      ? enableHousing(base(house), "new")
      : base(house);
    const booked = order(
      order(source, one, "need", "social"),
      two,
      "need",
      "social",
    );
    const game = mode === "legacy" ? enableHousing(booked, "legacy") : booked;
    assert.equal(
      game.actors[1].task?.station,
      mode === "new" ? housingSlotId("living", fixtureId, 1) : fixtureId + "#2",
    );
    assert.ok(isGame(game));
    const before = JSON.stringify(game);
    const result = inspectHousingLayoutUpgrade(game);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("second-seat booking moved");
    assert.ok(result.reason.includes(game.actors[1].person.name), result.reason);
    assert.ok(result.reason.includes("長椅子"), result.reason);
    assert.equal(JSON.stringify(game), before);
  });
}

test("an active spatial second-seat booking also blocks removing that seat", () => {
  const game = order(
    order(enableHousing(base(oneSeatHouse()), "new"), one, "need", "social"),
    two,
    "need",
    "social",
  );
  assert.equal(game.actors[1].task?.station, secondBench);
  assert.ok(isGame(game));
  const result = inspectHousingLayoutUpgrade(game);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("second-seat booking was removed");
  assert.ok(result.reason.includes(game.actors[1].person.name), result.reason);
  assert.ok(result.reason.includes("長椅子"), result.reason);
});

test("upgrading retains in-progress first-seat use, meal history and an admitted transit segment", () => {
  const house = initialHouse();
  house.rooms[0].fixtures[0].kind = "kitchen";
  let game = enableHousing(base(house), "new");
  game = order(game, one, "need", "hunger");
  game = order(game, two, "need", "hunger");
  game = order(
    game,
    three,
    "home-move",
    JSON.stringify({ roomId: "yard", cell: 0 }),
  );
  game = order(advance(game, 4), two, "cancel");
  const original = game.housing!;
  const meal = game.actors[0].task!;
  const firstKitchenSeat = housingSlotId("living", "hearth-1", 0);
  assert.equal(meal.station, firstKitchenSeat);
  assert.equal(meal.remaining, 8);
  assert.deepEqual(meal.spatial?.mealPartners, { [two]: 2 });
  assert.equal(original.state.actors[three].position.kind, "transit");
  assert.ok(isGame(game));
  const before = JSON.stringify(game);
  const result = upgraded(game);
  assert.equal(result.housing.layoutVersion, 2);
  assert.deepEqual(
    result.housing.state.slots[firstKitchenSeat].point,
    housingPoint("living", 2),
  );
  assert.deepEqual(result.housing.state.actors, original.state.actors);
  assert.deepEqual(result.housing.state.reservations, original.state.reservations);
  assert.deepEqual(result.housing.controls, original.controls);
  assert.equal(result.housing.state.nextOrderId, original.state.nextOrderId);
  assert.equal(result.housing.state.time, game.time);
  assert.ok(isGame(result));
  assert.equal(JSON.stringify(game), before);
  result.housing.state.actors[one].order!.useRemaining = 1;
  assert.equal(original.state.actors[one].order?.useRemaining, 8);
});

test("upgrading a game without housing preserves the legacy station path and unknown positions", () => {
  const game = order(base(), one, "need", "bladder");
  const before = JSON.stringify(game);
  const result = upgraded(game);
  const { housing } = result;
  assert.equal(housing.layoutVersion, 2);
  assert.deepEqual(Object.keys(housing.state.actors), []);
  assert.deepEqual(
    Object.keys(housing.unlocated).sort(),
    [one, two, three].sort(),
  );
  assert.deepEqual(housing.legacyStationPaths[one], [
    housingLinkId("living", "bedroom"),
    housingLinkId("bedroom", "yard"),
  ]);
  assert.equal(housing.state.time, game.time);
  assert.equal(housing.state.nextOrderId, 1);
  assert.ok(isGame(result));
  const again = upgraded(result);
  assert.equal(JSON.stringify(again.housing), JSON.stringify(housing));
  again.housing.legacyStationPaths[one].pop();
  assert.equal(housing.legacyStationPaths[one].length, 2);
  assert.equal(JSON.stringify(game), before);
});

test("layout 2 survives passage and access rebuilds, a house edit, and an in-transit display projection", () => {
  const house = initialHouse();
  house.rooms[0].doors = [9];
  let game = upgraded(enableHousing(base(house), "new"));
  const checkLayout = (current: Game) => {
    assert.ok(isGame(JSON.parse(JSON.stringify(current))));
    assert.equal(current.housing!.layoutVersion, 2);
    assert.deepEqual(
      current.housing!.state.slots[secondBench].point,
      housingPoint("living", 4),
    );
  };
  const door = housingDoorId("living", 9);
  game = setHousingPassage(game, "door", door, false);
  assert.deepEqual(game.housing!.controls.closedDoors, [door]);
  checkLayout(game);
  game = setHousingRoomAccess(game, "living", [one, two, three]);
  assert.deepEqual(
    game.housing!.state.slots[secondBench].allowedActorIds,
    [one, two, three].sort(),
  );
  checkLayout(game);

  const edited = structuredClone(game.house);
  edited.rooms[0].doors = [];
  const edit = applyHousingHouseEdit(game, edited);
  assert.equal(edit.error, undefined);
  assert.deepEqual(edit.game.house.rooms[0].doors, []);
  checkLayout(edit.game);

  game = order(edit.game, one, "need", "social");
  game = order(
    game,
    two,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  game = order(game, three, "leisure");
  game = order(advance(game, 3), two, "need", "social");
  assert.equal(game.actors[1].task?.station, secondBench);
  game = advance(game, 1);
  assert.equal(game.housing!.state.actors[two].position.kind, "transit");
  checkLayout(game);
  const before = JSON.stringify(game);
  const status = housingStatus(game, two);
  assert.equal(status.phase, "move");
  assert.match(status.destination ?? "", /長椅子/);
  assert.equal(status.minutes, 23);
  assert.equal(JSON.stringify(game), before);
});

test("a layout 2 edit rejects relocating the floor of a reserved second seat", () => {
  const initial = upgraded(enableHousing(base(), "new"));
  const game = order(order(initial, one, "need", "social"), two, "need", "social");
  assert.equal(game.actors[1].task?.station, secondBench);
  const edit = structuredClone(game.house);
  edit.rooms[0].walls = [4];
  const result = applyHousingHouseEdit(game, edit);
  assert.equal(result.game, game);
  assert.match(result.error ?? "", /予約した設備と利用位置/);
});

test("a layout 2 edit may move the legacy use point while keeping the booked fixture and a reachable seat", () => {
  const game = upgraded(order(base(), one, "need", "social"));
  const relocated = structuredClone(game.house);
  relocated.rooms[0].walls = [1];
  const moved = applyHousingHouseEdit(game, relocated);
  assert.equal(moved.error, undefined);
  assert.ok(isGame(moved.game));
  assert.deepEqual(
    moved.game.housing!.state.slots[bench].point,
    housingPoint("living", 4),
  );
  assert.deepEqual(moved.game.actors[0].task, game.actors[0].task);
});

test("layout 2 save validation rejects a legacy booking for a missing seat", () => {
  const house = oneSeatHouse();
  const oldGame = order(
    order(base(house), one, "need", "social"),
    two,
    "need",
    "social",
  );
  const game = upgraded(base(house));
  const invalid = {
    ...oldGame,
    housing: { ...game.housing, legacyStationPaths: { [one]: [], [two]: [] } },
  };
  assert.ok(isGame(oldGame));
  assert.equal(invalid.actors[1].task?.station, "bench-1#2");
  assert.equal(isGame(invalid), false);
});

test("saved legacy runtimes validate, and only numeric 2 is allowed as a present layout marker", () => {
  const game = enableHousing(base(), "new");
  assert.equal(Object.hasOwn(game.housing!, "layoutVersion"), false);
  assert.ok(isGame(JSON.parse(JSON.stringify(game))));
  const layout = upgraded(game);
  assert.ok(isGame(JSON.parse(JSON.stringify(layout))));
  for (const layoutVersion of [undefined, null, 0, 1, 3, "2", {}, []]) {
    const malformed = { ...layout, housing: { ...layout.housing, layoutVersion } };
    assert.equal(isGame(malformed), false, String(layoutVersion));
  }
  assert.equal(
    isGame({ ...game, housing: { ...game.housing, layoutVersion: 2 } }),
    false,
  );
});
