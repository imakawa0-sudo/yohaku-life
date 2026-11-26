// node --import tsx scripts/compare-shared-bedroom.mts
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import {
  createGame,
  enableHousing,
  advance,
  order,
  inspectOrder,
  setHousingRoomAccess,
  isGame,
  type Game,
} from "../src/reform/sim.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import {
  getBedSleeper,
  setBedSleeper,
  setPreferredBed,
} from "../src/reform/housing/bedPreference.ts";
import { housingSlotId } from "../src/reform/housing/topology.ts";

const people = ["アオ", "ミドリ", "アカ"].map((name, i) => ({
  ...makePersona(i, 4 + i),
  name,
}));
const [A, B, C] = people.map((p) => p.id);
let house = editHouse(initialHouse(), {
  type: "move",
  id: "mat-1",
  room: "living",
  cell: 7,
});
house = editHouse(house, {
  type: "build",
  kind: "bed",
  room: "bedroom",
  cell: 10,
});
house = editHouse(house, {
  type: "build",
  kind: "shelf",
  room: "bedroom",
  cell: 11,
});
const bed = "fixture-1",
  shelf = "fixture-2",
  mat = "mat-1";
const base = enableHousing(
  createGame(people, generateWorld(defaultWorldConfig()), "forest", house),
  "new",
);
// All three prefer the same bed in every branch. The only policy changes are
// the room permissions and (in the dedicated-bed branches) the bed assignment.
let origin = base;
for (const id of [A, B, C]) origin = setPreferredBed(origin, id, bed);
origin.actors[0].needs.energy = 30;
const save = (game: Game) =>
  exportSlot({
    id: "test-three",
    name: "検証専用・共用と私室",
    origin: base,
    game,
  });
const morningSave = save(origin);
const destination = (roomId: string) => JSON.stringify({ roomId, cell: 0 });
function branch(
  name: string,
  rights: string[] | null,
  first: string | null,
  reader: string,
  exclusive = false,
) {
  let g = setHousingRoomAccess(importSlot(morningSave).game, "bedroom", rights);
  if (exclusive) {
    g = setBedSleeper(g, bed, A);
    g = importSlot(save(g)).game;
    assert.equal(getBedSleeper(g, bed), A);
  }
  assert.equal(g.time, 480);
  const options = people.map(({ id }) => {
    const roomAllowed = rights === null || rights.includes(id);
    const enter = !inspectOrder(g, id, "home-move", destination("bedroom"))
      .disabled;
    const yard = !inspectOrder(g, id, "home-move", destination("yard"))
      .disabled;
    const read = !inspectOrder(g, id, "home-use", shelf).disabled;
    const rest = !inspectOrder(g, id, "home-use", bed).disabled;
    assert.equal(enter, roomAllowed);
    assert.equal(yard, roomAllowed);
    assert.equal(read, roomAllowed);
    assert.equal(rest, roomAllowed && (!exclusive || id === A));
    return { id, enter, yard, read, bed: rest };
  });

  const firstRest = first
    ? inspectOrder(g, first, "need", "energy").facility
    : null;
  let booked = first ? order(g, first, "need", "energy") : g;
  const preferred = inspectOrder(booked, A, "need", "energy");
  const read = inspectOrder(booked, reader, "home-use", shelf);
  const canRead = !read.disabled;
  booked = canRead
    ? order(booked, reader, "home-use", shelf)
    : order(booked, reader, "wait");
  assert.ok(isGame(booked));
  const firstMinute = advance(booked, 1);
  const aBed = preferred.facility!;
  assert.equal(firstMinute.actors[0].task?.mode, "auto");
  assert.equal(
    firstMinute.actors[0].task?.station,
    housingSlotId(aBed.roomId, aBed.fixtureId, 0),
  );

  // When allowed, actually use the shared shelf, then walk through the room
  // to the yard during A's ongoing rest. Repeat the same commands after load.
  function finish(g: Game) {
    let yardArrival: number | null = null;
    if (canRead) {
      g = advance(g, booked.time + read.minutes! - g.time);
      assert.equal(g.actors.find((a) => a.person.id === reader)!.task, null);
      const move = inspectOrder(g, reader, "home-move", destination("yard"));
      assert.equal(move.disabled, undefined);
      g = advance(
        order(g, reader, "home-move", destination("yard")),
        move.minutes!,
      );
      yardArrival = g.time;
      assert.ok(g.actors[0].task);
      assert.equal(g.actors.find((a) => a.person.id === reader)!.room, "yard");
    }
    g = advance(g, booked.time + preferred.minutes! - g.time);
    assert.ok(isGame(g));
    assert.equal(g.actors[0].task, null);
    assert.equal(g.actors[0].room, aBed.roomId);
    return { g, yardArrival };
  }
  const completed = finish(firstMinute);
  const replay = finish(importSlot(save(firstMinute)).game);
  assert.equal(save(completed.g), save(replay.g));
  assert.equal(completed.yardArrival, replay.yardArrival);
  return {
    name,
    exclusive,
    first,
    reader,
    options,
    firstBed: firstRest?.fixtureId ?? null,
    firstPreference: firstRest?.bedPreference ?? null,
    preferredResidentBed: aBed.fixtureId,
    preference: aBed.bedPreference,
    arrival: aBed.moveMinutes,
    rest: aBed.useMinutes,
    finishClock: completed.g.time,
    readerFinish: canRead ? g.time + read.minutes! : null,
    readerYardArrival: completed.yardArrival,
  };
}

const runs = [
  branch("all", null, B, C),
  branch("A only", [A], B, C),
  branch("AC, B wants rest first", [A, C], B, C),
  branch("AC, C wants rest first", [A, C], C, B),
  branch("AB, B wants rest first", [A, B], B, C),
  branch("all, bed assigned to A; B rests first", null, B, C, true),
  branch("all, bed assigned to A; C rests first", null, C, B, true),
  branch("BC only, bed assigned to A; A needs rest", [B, C], null, B, true),
];
for (const r of runs.slice(5, 7)) {
  assert.equal(r.firstBed, mat);
  assert.equal(r.firstPreference?.outcome, "fallback");
  assert.equal(r.preferredResidentBed, bed);
  assert.equal(r.preference?.outcome, "preferred");
  assert.ok(
    r.readerYardArrival !== null && r.readerYardArrival < r.finishClock,
  );
}
assert.equal(runs[7].preferredResidentBed, mat);
assert.equal(runs[7].preference?.outcome, "fallback");
console.log(JSON.stringify({ bed, mat, shelf, runs }, null, 2));
