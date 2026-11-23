import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, houseValue, type House } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";
import {
  advanceSpatial,
  issueSpatialOrder,
} from "../src/reform/spatial/actions";
import { inspectSpatialRoute } from "../src/reform/spatial/route";
import type { SpatialIntent } from "../src/reform/spatial/types";
import {
  buildHousingTopology,
  housingDoorId,
  housingLinkId,
  housingPoint,
  housingRoomId,
  housingSlotId,
} from "../src/reform/housing/topology";
import {
  applyHousingHouseEdit,
  createHousingRuntime,
  isHousingRuntime,
} from "../src/reform/housing/runtime";
import type { HousingRuntime } from "../src/reform/housing/types";

const residents = [makePersona(0, 23), makePersona(1, 75)];
const [id, other] = residents.map((p) => p.id);
function base() {
  return createGame(residents, generateWorld(defaultWorldConfig()), "village");
}
function fresh(g = base(), mode: "new" | "legacy" = "new") {
  return { ...g, housing: createHousingRuntime(g, mode) };
}
function rebuild(g: Game & { housing: HousingRuntime }) {
  const h = g.housing;
  Object.assign(
    h.state,
    buildHousingTopology(
      g.house,
      Object.keys(h.state.actors),
      h.controls,
      h.state.actors,
    ).geometry,
  );
}
function use(g = fresh(), target: "hunger" | "energy" = "hunger") {
  const room = target === "energy" ? "bedroom" : "living";
  const slotId = housingSlotId(
    room,
    target === "energy" ? "mat-1" : "hearth-1",
    0,
  );
  const useMinutes = target === "energy" ? 85 : 20;
  const result = issueSpatialOrder(g.housing.state, {
    kind: "use",
    actorId: id,
    slotId,
    useMinutes,
  });
  assert.ok(result.ok);
  g.housing.state = result.state;
  g.actors[0].task = {
    kind: "need",
    target,
    label: "設備を使う",
    from: g.home,
    mode: "direct",
    metric: "care",
    station: slotId,
    room,
    total: useMinutes,
    remaining: useMinutes,
    reserved: target === "hunger" ? { food: 1 } : {},
    spatial: { orderId: result.orderId, kind: "use" },
  };
  return g;
}
function checkReject(g: Game, house: House, message: RegExp) {
  const before = structuredClone(g);
  const result = applyHousingHouseEdit(g, house);
  assert.match(result.error ?? "", message);
  assert.equal(result.game, g);
  assert.deepEqual(structuredClone(g), before);
}

test("walls and furniture block walking, and adjacent use points choose distance then cell", () => {
  const g = fresh();
  const room = g.house.rooms[0];
  room.fixtures = [{ kind: "kitchen", id: 'table|"/[]', cell: 5 }];
  room.walls = [9];
  const topology = buildHousingTopology(g.house, [id, other]);
  const slots = Object.values(topology.slots).filter(
    (s) => s.fixtureId === room.fixtures[0].id,
  );
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((s) => s.seat).sort(), [0, 1]);
  assert.notEqual(slots[0].id, slots[1].id);
  for (const slot of slots) {
    assert.equal(slot.kind, "kitchen");
    assert.deepEqual(slot.point, housingPoint("living", 1));
    assert.deepEqual(topology.geometry.slots[slot.id].point, slot.point);
  }
  assert.deepEqual(
    topology.geometry.domains[housingPoint("living", 0).domainId].blockedCells,
    [5, 9],
  );
  room.walls = [1, 4];
  assert.equal(
    Object.values(buildHousingTopology(g.house, [id]).slots).filter(
      (s) => s.roomId === "living",
    ).length,
    0,
  );
});

test("JSON-derived IDs round trip separators and distinguish parameter boundaries", () => {
  const room = 'room#|/"[],寝室';
  assert.equal(housingRoomId(housingPoint(room, 3).domainId), room);
  for (const bad of ["not-json", "null", '["door","abc"]', '["room","a",0]'])
    assert.equal(housingRoomId(bad), null);
  assert.equal(housingLinkId("A|B", "C"), housingLinkId("C", "A|B"));
  assert.notEqual(housingLinkId("A|B", "C"), housingLinkId("A", "B|C"));
  assert.notEqual(housingSlotId("A|B", "C", 1), housingSlotId("A", "B|C", 1));
});

test("every edge incident to a closed door is gated, including the shared edge of two doors", () => {
  const g = fresh();
  g.house.rooms[0].fixtures = [];
  g.house.rooms[0].doors = [5, 6];
  for (const closed of [5, 6]) {
    g.housing.controls.closedDoors = [housingDoorId("living", closed)];
    rebuild(g);
    for (const neighbor of [closed - 4, closed + 4, closed - 1, closed + 1]) {
      for (const [a, b] of [
        [closed, neighbor],
        [neighbor, closed],
      ])
        assert.deepEqual(
          inspectSpatialRoute(
            g.housing.state,
            id,
            housingPoint("living", a),
            housingPoint("living", b),
          ),
          { ok: false, physical: false, reason: "physical-block" },
        );
    }
    assert.ok(isGame(g));
  }
});
test("room links cost three minutes; revoked occupants can exit, but cannot use or re-enter", () => {
  const g = fresh();
  const { state, controls } = g.housing;
  const living = housingPoint("living", 0),
    bedroom = housingPoint("bedroom", 0);
  const link = inspectSpatialRoute(state, id, living, bedroom);
  assert.ok(link.ok);
  assert.equal(link.minutes, 3);
  controls.roomAccess.living = [];
  state.actors[id].position = { kind: "at", point: housingPoint("living", 2) };
  rebuild(g);
  assert.ok(
    inspectSpatialRoute(state, id, housingPoint("living", 2), bedroom).ok,
  );
  assert.deepEqual(
    issueSpatialOrder(state, {
      kind: "use",
      actorId: id,
      slotId: housingSlotId("living", "hearth-1", 0),
      useMinutes: 20,
    }),
    { ok: false, reason: "use-denied" },
  );
  state.actors[id].position = { kind: "at", point: bedroom };
  g.actors[0].room = "bedroom";
  rebuild(g);
  assert.deepEqual(inspectSpatialRoute(state, id, bedroom, living), {
    ok: false,
    physical: true,
    reason: "entry-denied",
  });
  controls.closedLinks = [housingLinkId("living", "bedroom")];
  rebuild(g);
  assert.deepEqual(inspectSpatialRoute(state, id, bedroom, living), {
    ok: false,
    physical: false,
    reason: "physical-block",
  });
  assert.ok(isGame(g));
});

test("new residents start at home entrance; legacy, outside and travelling positions remain unknown", () => {
  const g = base();
  const n = fresh(g);
  assert.deepEqual(n.housing.state.actors[id].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  const old = fresh(g, "legacy");
  assert.equal(old.housing.unlocated[id].reason, "legacy-unspecified");
  assert.ok(isGame(old));
  g.actors[1].location = "mill";
  g.actors[1].room = "outdoors";
  const trip = fresh(order(g, id, "travel", "mill"), "legacy");
  assert.deepEqual(trip.housing.unlocated[id], {
    reason: "regional-travel",
    location: g.home,
    room: "living",
  });
  assert.equal(trip.housing.unlocated[other].reason, "outside");
  trip.housing.controls.roomAccess.bedroom = [other];
  rebuild(trip);
  assert.ok(isGame(trip));
});

test("clock, partitions, controls, graph and unsupported carry state reject corruption", () => {
  const valid = fresh();
  const mutations: ((g: typeof valid) => void)[] = [
    (g) => {
      g.housing.state.time++;
    },
    (g) => {
      delete g.housing.state.actors[id];
    },
    (g) => {
      g.housing.unlocated[id] = {
        room: "living",
        location: g.home,
        reason: "legacy-unspecified",
      };
    },
    (g) => {
      g.actors[0].room = "yard";
    },
    (g) => {
      g.housing.controls.closedLinks = ["bad"];
    },
    (g) => {
      g.housing.controls.closedDoors = ["bad"];
    },
    (g) => {
      g.housing.controls.roomAccess.yard = [id, id];
    },
    (g) => {
      g.housing.controls.roomAccess.yard = ["stranger"];
    },
    (g) => {
      delete g.housing.controls.roomAccess.yard;
    },
    (g) => {
      g.housing.state.domains[housingPoint("living", 0).domainId].stepMinutes++;
    },
    (g) => {
      g.housing.state.items.x = {
        id: "x",
        position: { kind: "at", point: housingPoint("living", 0) },
        carryAllowedActorIds: null,
      };
    },
    (g) => {
      g.housing.state.actors[id].carryAllowedActorIds = [other];
    },
  ];
  for (const mutate of mutations) {
    const g = structuredClone(valid);
    mutate(g);
    assert.equal(isGame(g), false, String(mutate));
  }
});

test("task, slot, reservation, progress and historical meal minutes are checked together", () => {
  const valid = use();
  assert.ok(isGame(valid));
  const mutations: ((g: typeof valid) => void)[] = [
    (g) => {
      g.actors[0].task = null;
    },
    (g) => {
      delete g.actors[0].task!.spatial;
    },
    (g) => {
      g.actors[0].task!.spatial!.orderId = "order-2";
    },
    (g) => {
      g.actors[0].task!.spatial!.kind = "move";
    },
    (g) => {
      g.actors[0].task!.station = housingSlotId("living", "window-1", 0);
    },
    (g) => {
      g.actors[0].task!.room = "yard";
    },
    (g) => {
      g.actors[0].task!.target = "bladder";
    },
    (g) => {
      g.actors[0].task!.remaining--;
    },
    (g) => {
      g.actors[0].task!.total++;
    },
    (g) => {
      g.housing.state.actors[id].order!.useRemaining--;
    },
    (g) => {
      g.housing.state.reservations = {};
    },
    (g) => {
      g.actors[0].task!.reserved = {};
    },
    ...[
      { [id]: 1 },
      { unknown: 1 },
      { [other]: -1 },
      { [other]: 1.5 },
      { [other]: 1 },
    ].map((mealPartners) => (g: typeof valid) => {
      g.actors[0].task!.spatial!.mealPartners = mealPartners;
    }),
  ];
  for (const mutate of mutations) {
    const g = structuredClone(valid);
    mutate(g);
    assert.equal(isGame(g), false, String(mutate));
  }
  const noHousing: Game = { ...valid };
  delete noHousing.housing;
  assert.equal(isGame(noHousing), false);
  valid.housing.state = advanceSpatial(valid.housing.state, 3).state;
  valid.time += 3;
  const left = valid.housing.state.actors[id].order!.useRemaining;
  assert.ok(left < 20);
  valid.actors[0].task!.remaining = left;
  valid.actors[0].task!.spatial!.mealPartners = { [other]: 1 };
  assert.ok(isGame(valid));
  valid.housing.controls.roomAccess.living = [];
  rebuild(valid);
  assert.ok(isGame(valid));
});
test("changes under occupied cells, transit landings and entered connections cost nothing", () => {
  const g = fresh();
  g.housing.state.actors[id].position = {
    kind: "at",
    point: housingPoint("living", 4),
  };
  for (const house of [
    editHouse(g.house, { type: "tile", room: "living", cell: 4, tile: "wall" }),
    editHouse(g.house, { type: "build", room: "living", cell: 4, kind: "bed" }),
  ])
    checkReject(g, house, /人物|現在|立って/);
  const transit = use(fresh(), "energy");
  transit.housing.state = advanceSpatial(transit.housing.state, 1).state;
  transit.time++;
  assert.equal(transit.housing.state.actors[id].position.kind, "transit");
  assert.ok(isGame(transit));
  const without = structuredClone(transit.house);
  without.links = [
    ["living", "yard"],
    ["yard", "bedroom"],
  ];
  checkReject(transit, without, /移動|通路|接続/);
  // One-minute walking segments can also be represented on the H1-A save boundary.
  const step = inspectSpatialRoute(
    g.housing.state,
    id,
    housingPoint("living", 4),
    housingPoint("living", 8),
  );
  assert.ok(step.ok);
  const target = JSON.stringify({ roomId: "living", cell: 8 });
  const intent: SpatialIntent = {
    kind: "move",
    actorId: id,
    destination: housingPoint("living", 8),
  };
  const move = issueSpatialOrder(g.housing.state, intent);
  assert.ok(move.ok);
  g.housing.state = move.state;
  g.housing.state.actors[id].position = {
    kind: "transit",
    step: step.steps[0],
    remaining: 1,
  };
  g.actors[0].task = {
    kind: "home-move",
    target,
    label: "歩く",
    room: "living",
    remaining: 1,
    total: 1,
    from: g.home,
    mode: "direct",
    metric: "travel",
    reserved: {},
    spatial: { kind: "move", orderId: move.orderId },
  };
  assert.ok(isGame(g));
  checkReject(
    g,
    editHouse(g.house, { type: "tile", room: "living", cell: 8, tile: "wall" }),
    /着地|移動/,
  );
});
test("reserved furniture and interaction points stay fixed; unrelated edits preserve flags and actors", () => {
  const g = use();
  checkReject(
    g,
    editHouse(g.house, {
      type: "move",
      room: "living",
      id: "hearth-1",
      cell: 1,
    }),
    /予約|設備/,
  );
  checkReject(
    g,
    editHouse(g.house, { type: "tile", room: "living", cell: 2, tile: "wall" }),
    /予約|利用位置|設備/,
  );
  g.housing.controls.closedLinks = [housingLinkId("living", "bedroom")];
  rebuild(g);
  const next = editHouse(g.house, { type: "expand", room: "yard" });
  const result = applyHousingHouseEdit(g, next);
  assert.equal(result.error, undefined);
  assert.equal(
    result.game.wood,
    g.wood - (houseValue(next) - houseValue(g.house)),
  );
  assert.equal(result.game.time, g.time);
  assert.deepEqual(result.game.housing!.controls, g.housing.controls);
  assert.deepEqual(result.game.housing!.state.actors, g.housing.state.actors);
  assert.ok(isGame(result.game));
  g.wood = 0;
  checkReject(g, next, /木材/);
});
test("legacy equipment and room link dependencies survive upgrading", () => {
  const g = fresh(order(base(), id, "need", "energy"), "legacy");
  const reroute = structuredClone(g.house);
  reroute.links = [
    ["living", "yard"],
    ["bedroom", "yard"],
  ];
  checkReject(g, reroute, /作業|通路/);
  checkReject(
    g,
    editHouse(g.house, { type: "move", id: "mat-1", room: "bedroom", cell: 7 }),
    /設備|作業/,
  );
});
test("regional departure point survives saving and cannot be walled off or furnished", () => {
  const g = fresh(order(base(), id, "travel", "mill"), "legacy");
  const departure = g.housing.unlocated[id];
  departure.departurePoint = housingPoint("living", 4);
  assert.ok(isHousingRuntime(g.housing, g));
  const edit = editHouse(g.house, {
    type: "tile",
    room: "living",
    cell: 4,
    tile: "wall",
  });
  checkReject(g, edit, /出発|復帰/);
  checkReject(
    g,
    editHouse(g.house, { type: "build", room: "living", cell: 4, kind: "bed" }),
    /出発|復帰/,
  );
  const wrong = structuredClone(g);
  wrong.housing.unlocated[id].departurePoint = housingPoint("yard", 4);
  assert.equal(isGame(wrong), false);
  g.actors[0].task = null;
  assert.equal(isGame(g), false);
});

test("a door closure can block an active approach without reassigning its seat or erasing progress", () => {
  const g = fresh();
  g.house = editHouse(g.house, {
    type: "tile",
    room: "living",
    cell: 2,
    tile: "door",
  });
  rebuild(g);
  use(g);
  const { state, controls } = g.housing;
  const slotId = g.actors[0].task!.station!;
  const original = structuredClone(state.slots[slotId].point);
  controls.closedDoors = [housingDoorId("living", 2)];
  rebuild(g);
  assert.deepEqual(state.slots[slotId].point, original);
  g.housing.state = advanceSpatial(state, 1).state;
  g.time++;
  assert.equal(g.housing.state.actors[id].order?.waitReason, "physical-block");
  assert.deepEqual(g.housing.state.reservations, state.reservations);
  assert.ok(isGame(g));
});

test("an additive shortcut survives a mid-job save without unprotecting the legacy links or changing old work", () => {
  const old = base();
  old.house = editHouse(old.house, {
    type: "move",
    id: "hearth-1",
    room: "yard",
    cell: 6,
  });
  const queued = order(
    order(old, id, "need", "bladder"),
    other,
    "work",
    "cook",
  );
  const g = fresh(advance(queued, 1), "legacy");
  const tasks = structuredClone(g.actors.map((a) => a.task));
  assert.ok(tasks.every((t) => t?.room === "yard" && t.remaining < t.total));
  assert.deepEqual(tasks[1]!.reserved, { ingredients: 2 });
  const shortcut = editHouse(g.house, { type: "link", a: "living", b: "yard" });
  const edited = applyHousingHouseEdit(g, shortcut);
  assert.equal(edited.error, undefined);
  const resumed = JSON.parse(JSON.stringify(edited.game)) as Game;
  assert.ok(isGame(resumed));
  const originalPath = [
    housingLinkId("living", "bedroom"),
    housingLinkId("bedroom", "yard"),
  ];
  assert.deepEqual(resumed.housing!.legacyStationPaths, {
    [id]: originalPath,
    [other]: originalPath,
  });
  assert.deepEqual(
    resumed.actors.map((a) => a.task),
    tasks,
  );
  assert.equal(resumed.time, g.time);
  assert.equal(resumed.ingredients, g.ingredients);
  for (const [a, b] of [
    ["living", "bedroom"],
    ["bedroom", "yard"],
  ]) {
    checkReject(
      resumed,
      editHouse(resumed.house, { type: "link", a, b }),
      /作業|通路/,
    );
  }
  const removeShortcut = editHouse(resumed.house, {
    type: "link",
    a: "living",
    b: "yard",
  });
  assert.equal(applyHousingHouseEdit(resumed, removeShortcut).error, undefined);
});
test("legacy passage records match only real migrated station jobs and a continuous simple path", () => {
  const g = fresh(order(base(), id, "need", "bladder"), "legacy");
  assert.ok(isGame(g));
  const first = housingLinkId("living", "bedroom"),
    second = housingLinkId("bedroom", "yard");
  const mutations: ((next: typeof g) => void)[] = [
    (g) => {
      delete g.housing.legacyStationPaths[id];
    },
    (g) => {
      g.housing.legacyStationPaths.missing = [];
    },
    (g) => {
      g.housing.legacyStationPaths[other] = [];
    },
    (g) => {
      g.housing.legacyStationPaths[id] = [];
    },
    (g) => {
      g.housing.legacyStationPaths[id] = [second, first];
    },
    (g) => {
      g.housing.legacyStationPaths[id] = [first];
    },
    (g) => {
      g.housing.legacyStationPaths[id] = ["missing"];
    },
    (g) => {
      g.housing.legacyStationPaths[id] = [first, first, first, second];
    },
    (g) => {
      g.actors[0].task = null;
    },
    (g) => {
      g.actors[0].task!.kind = "wait";
    },
    (g) => {
      delete g.actors[0].task!.station;
    },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(g);
    mutate(next);
    assert.equal(isGame(next), false, String(mutate));
  }
  assert.deepEqual(Object.keys(fresh().housing.legacyStationPaths), []);
  const sameRoom = fresh(order(base(), id, "need", "hunger"), "legacy");
  assert.deepEqual(sameRoom.housing.legacyStationPaths[id], []);
  assert.ok(isGame(sameRoom));
});

test("a spatial seat cannot also be occupied by a legacy station, and cooking keeps the original ingredient reservation", () => {
  const g = use();
  const legacy = { ...g.actors[0].task!, station: "hearth-1" };
  delete legacy.spatial;
  g.actors[1].task = legacy;
  g.housing.legacyStationPaths[other] = [];
  assert.equal(isGame(g), false);
  g.actors[1].task = null;
  delete g.housing.legacyStationPaths[other];
  Object.assign(g.actors[0].task!, {
    kind: "work",
    target: "cook:hard",
    reserved: { ingredients: 3 },
  });
  assert.ok(isGame(g));
  g.actors[0].task!.reserved = { ingredients: 2 };
  assert.equal(isGame(g), false);
});
test("an H1-A actor carry order remains outside the playable housing format", () => {
  const g = fresh();
  const held = issueSpatialOrder(g.housing.state, {
    kind: "carry",
    actorId: id,
    payload: { kind: "actor", id: other },
    destination: housingPoint("bedroom", 0),
  });
  assert.ok(held.ok);
  g.housing.state = held.state;
  assert.equal(isGame(g), false);
});
test("full supported room IDs round-trip through the public move target encoding", () => {
  const g = fresh();
  const roomId = '"'.repeat(320);
  const room = g.house.rooms[1];
  room.id = roomId;
  g.house.links = [
    ["living", roomId],
    [roomId, "yard"],
  ];
  g.housing = createHousingRuntime(g, "new");
  const destination = housingPoint(roomId, 0);
  const move = issueSpatialOrder(g.housing.state, {
    kind: "move",
    actorId: id,
    destination,
  });
  assert.ok(move.ok);
  g.housing.state = move.state;
  g.actors[0].task = {
    kind: "home-move",
    target: JSON.stringify({ roomId, cell: 0 }),
    label: "歩く",
    total: 3,
    remaining: 3,
    from: g.home,
    mode: "direct",
    metric: "travel",
    reserved: {},
    spatial: { kind: "move", orderId: move.orderId },
  };
  assert.ok(isGame(g));
  g.actors[0].task!.target = JSON.stringify({ roomId: "yard", cell: 0 });
  assert.equal(isGame(g), false);
});
