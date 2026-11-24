import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse } from "../src/reform/house";
import { startHousingGathering } from "../src/reform/housing/gathering";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import {
  branchSlot,
  exportSlot,
  importSlot,
  parseLibrary,
  writeLocal,
} from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  createGame,
  advance,
  enableHousing,
  order,
  isGame,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const ids = ["person-1", "person-2", "person-3"];
function setup(onlyTable = false) {
  const house = initialHouse();
  house.rooms[0].fixtures[1].kind = "table";
  if (onlyTable) house.rooms[0].fixtures = house.rooms[0].fixtures.slice(1, 2);
  const origin = createGame(
    ids.map((_, i) => makePersona(i, 23 + i)),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  const g = enableHousing(origin, "new");
  const game = startHousingGathering(g, {
    kind: "meal",
    actorIds: ids,
    roomId: "living",
    fixtureId: "bench-1",
  });
  return { origin, game };
}
function activity(g: Game) {
  return Object.values(g.housing!.gatherings!)[0];
}
test("new gathering and old origin survive a whole-library round trip, export/import and both kinds of fork", () => {
  const { origin, game } = setup();
  const slot = { id: "mixed", name: "食卓", origin, game: advance(game, 9) };
  const old = { id: "old", name: "元の家", origin, game: origin };
  const loaded = parseLibrary(
    JSON.stringify({ format: 2, activeId: "mixed", slots: [old, slot] }),
  );
  assert.deepEqual(loaded.slots[1], slot);
  const imported = importSlot(exportSlot(slot));
  assert.deepEqual(imported.game, slot.game);
  assert.deepEqual(branchSlot(imported, false, "続き").game, slot.game);
  assert.deepEqual(branchSlot(imported, true, "朝").game, origin);
  assert.deepEqual(advance(imported.game, 10), advance(slot.game, 10));
  assert.equal(origin.housing, undefined);
});
test("invalid crossed references, counters, phase, history and food are refused in both game and origin", (t) => {
  const { game, origin } = setup();
  const partial = advance(game, 9);
  assert.ok(isGame(partial));
  const good = {
    format: 2 as const,
    activeId: "mix",
    slots: [{ id: "mix", name: "途中", origin, game: partial }],
  };
  const raw = JSON.stringify(good);
  let writes = 0;
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key.endsWith("-v2") ? raw : null),
      setItem: () => {
        writes++;
      },
    },
  });
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const bad: ((g: Game) => void)[] = [
    (g) => {
      activity(g).pairs[0].minutes--;
    },
    (g) => {
      delete g.housing!.gatherings;
    },
    (g) => {
      g.housing!.nextGatheringId = 1;
    },
    (g) => {
      activity(g).id = "gathering-01";
    },
    (g) => {
      activity(g).startedAt = g.time + 1;
    },
    (g) => {
      activity(g).startedAt = null;
    },
    (g) => {
      activity(g).deadline = activity(g).createdAt;
    },
    (g) => {
      activity(g).members[0].usedMinutes--;
    },
    (g) => {
      activity(g).members[0].togetherMinutes = 0;
    },
    (g) => {
      activity(g).members[0].slotId = activity(g).members[1].slotId;
    },
    (g) => {
      activity(g).members[0].stoppedAt = g.time + 3;
    },
    (g) => {
      activity(g).members[0].status = "withdrawing";
    },
    (g) => {
      activity(g).pairs[0].minutes = 18;
    },
    (g) => {
      activity(g).pairs[0].actorIds[1] = ids[0];
    },
    (g) => {
      activity(g).members.pop();
    },
    (g) => {
      Object.assign(activity(g).members[0], { refunded: true });
    },
    (g) => {
      g.actors[0].task!.reserved = { food: 1 };
    },
    (g) => {
      g.actors[0].task!.partner = ids[1];
    },
    (g) => {
      g.actors[0].task!.spatial!.gatheringId = "gathering-999";
    },
    (g) => {
      delete g.actors[0].task!.spatial!.gatheringId;
    },
    (g) => {
      const copy = structuredClone(activity(g));
      copy.id = "gathering-2";
      g.housing!.gatherings![copy.id] = copy;
      g.housing!.nextGatheringId = 3;
    },
  ];
  for (const corrupt of bad) {
    const broken = structuredClone(partial);
    corrupt(broken);
    assert.equal(isGame(broken), false, String(corrupt));
    const slot = { id: "mix", name: "途中", origin, game: partial };
    for (const key of ["origin", "game"] as const) {
      const library = {
        format: 2 as const,
        activeId: "mix",
        slots: [{ ...slot, [key]: broken }],
      };
      assert.throws(
        () => parseLibrary(JSON.stringify(library)),
        String(corrupt),
      );
      assert.equal(writeLocal(library, raw).status, "invalid");
      assert.equal(writes, 0);
    }
  }
});
test("an occupied seat protects the fixture; a departed member's canonical seat can disappear after they move away", () => {
  const { game } = setup(true);
  let g = advance(game, 5);
  const changed = structuredClone(g.house);
  changed.rooms[0].walls.push(6, 9);
  assert.ok(applyHousingHouseEdit(g, changed).error);
  g = order(g, ids[2], "cancel");
  g = order(
    g,
    ids[2],
    "home-move",
    JSON.stringify({ roomId: "living", cell: 2 }),
  );
  g = advance(g, 1);
  const edited = applyHousingHouseEdit(g, changed);
  assert.equal(edited.error, undefined);
  assert.ok(isGame(edited.game));
  const hist = activity(edited.game).members[2];
  assert.equal(edited.game.housing!.state.slots[hist.slotId], undefined);
  for (const invalid of [
    hist.slotId + " ",
    '["slot","elsewhere","bench-1",2]',
    '["slot","living","bench-1",99]',
  ]) {
    const broken = structuredClone(edited.game);
    activity(broken).members[2].slotId = invalid;
    assert.equal(isGame(broken), false);
  }
});
test("a saved meal cannot erase a pair's unavoidable overlap and repeat its fifth-minute memory", () => {
  const { origin } = setup();
  const members = ids.slice(0, 2);
  const booked = startHousingGathering(enableHousing(origin, "new"), {
    kind: "meal",
    roomId: "living",
    fixtureId: "bench-1",
    actorIds: members,
  });
  const five = advance(booked, 6); // One minute to the seats and five actually eating.
  assert.deepEqual(activity(five).pairs, [{ actorIds: members, minutes: 5 }]);
  assert.ok(isGame(five));
  const slot = { id: "meal", name: "食卓", origin, game: five };
  const next = advance(importSlot(exportSlot(slot)).game, 5);
  assert.ok(next.actors.slice(0, 2).every((p) => p.memories.length === 1));
  for (const recorded of [0, 4]) {
    const broken = structuredClone(five);
    const group = activity(broken);
    group.pairs = recorded
      ? [{ actorIds: [members[0], members[1]], minutes: recorded }]
      : [];
    for (const m of group.members) m.togetherMinutes = recorded;
    assert.equal(isGame(broken), false);
    assert.throws(() => importSlot(exportSlot({ ...slot, game: broken })));
  }
});

test("stopped meal time cannot disguise erased overlap on import or prewrite", (t) => {
  const { origin } = setup();
  const members = ids.slice(0, 2);
  const booked = startHousingGathering(enableHousing(origin, "new"), {
    kind: "meal",
    roomId: "living",
    fixtureId: "bench-1",
    actorIds: members,
  });
  const five = advance(booked, 6);
  const stopped = advance(setHousingRoomAccess(five, "living", []), 5);
  const slot = { id: "meal", name: "食卓", origin, game: stopped };
  const library = { format: 2 as const, activeId: slot.id, slots: [slot] };
  const raw = JSON.stringify(library);
  const writes: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => raw,
      setItem: (_key: string, data: string) => writes.push(data),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const resume = (g: Game) =>
    advance(setHousingRoomAccess(g, "living", null), 5);
  const loaded = importSlot(exportSlot(slot));
  assert.deepEqual(resume(loaded.game), resume(stopped));
  assert.ok(
    resume(loaded.game)
      .actors.slice(0, 2)
      .every((p) => p.memories.length === 1),
  );
  const broken = structuredClone(stopped);
  for (const m of activity(broken).members) {
    assert.equal(m.stoppedAt, five.time);
    assert.equal(m.usedMinutes, 5);
    m.togetherMinutes = 0;
  }
  activity(broken).pairs = [];
  assert.equal(isGame(broken), false);
  assert.throws(() => importSlot(exportSlot({ ...slot, game: broken })));
  assert.equal(
    writeLocal({ ...library, slots: [{ ...slot, game: broken }] }, raw).status,
    "invalid",
  );
  assert.deepEqual(writes, []);
});

test("invalid gathering memory identities are rejected while untagged legacy memories stay readable", () => {
  const { origin, game } = setup();
  const partial = advance(game, 10);
  const [first, peer] = ids;
  const invalid = [
    null,
    [],
    {},
    { kind: "talk" },
    { kind: "talk", peerId: first },
    { kind: "meal", peerId: "missing" },
    { kind: "new", peerId: peer },
    { kind: "talk", peerId: peer, extra: 1 },
  ];
  const old = { label: "同じ表示", value: 4, until: partial.time + 50 };
  for (const provenance of invalid) {
    const bad = structuredClone(partial);
    bad.actors[0].memories = [
      Object.assign({ ...old }, { gathering: provenance }),
    ];
    assert.equal(isGame(bad), false, JSON.stringify(provenance));
    assert.throws(() =>
      importSlot(exportSlot({ id: "m", name: "記憶", origin, game: bad })),
    );
  }
  const tagged = { ...old, gathering: { kind: "talk" as const, peerId: peer } };
  partial.actors[0].memories = [old, tagged];
  assert.ok(isGame(partial));
  partial.actors[0].memories.push({ ...tagged, label: "別の表示" });
  assert.equal(isGame(partial), false);
});
