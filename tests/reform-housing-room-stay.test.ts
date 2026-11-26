import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InsulationPanel } from "../src/reform/InsulationPanel";
import { roomStayMinutes } from "../src/reform/housing/roomStay";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75)];
const [one, two] = people.map((person) => person.id);
function raw(time = 480, count = 1) {
  const game = createGame(
    people.slice(0, count),
    generateWorld(defaultWorldConfig()),
    "village",
  );
  game.time = time;
  return game;
}

function recordedDay(game: Game, number: number) {
  const day = game.housing?.roomStay?.days.find((d) => d.day === number);
  assert.ok(day, `missing day ${number}`);
  return day;
}
function reload(game: Game, origin: Game) {
  const result = importSlot(
    exportSlot({ id: "stays", name: "一室で過ごす", game, origin }),
  ).game;
  assert.deepEqual(result, structuredClone(game));
  return result;
}

test("a pre-ledger save begins at its first actual minute; queries, orders and saving alone add nothing", () => {
  const origin = enableHousing(raw(760), "new");
  delete origin.housing!.roomStay;
  const old = reload(origin, origin);
  const before = structuredClone(old);
  inspectOrder(old, one, "work", "wood");
  assert.deepEqual(old, before);
  const ordered = order(old, one, "work", "wood");
  assert.equal(ordered.housing!.roomStay, undefined);
  assert.equal(advance(ordered, 0).housing!.roomStay, undefined);
  const after = advance(ordered, 7);
  const today = recordedDay(after, 1);
  assert.equal(today.from, 760);
  assert.equal(roomStayMinutes(today, one, "living"), 7);
  assert.equal(roomStayMinutes(today, one, "bedroom"), 0);
  assert.equal(after.housing!.roomStay!.days.length, 1);
  assert.deepEqual(advance(reload(after, origin), 6), advance(ordered, 13));
  assert.deepEqual(old, before);

  const legacy = raw(760);
  const outsideHousing = advance(order(legacy, one, "work", "wood"), 4);
  assert.equal(outsideHousing.housing, undefined);
  reload(outsideHousing, legacy);
});

test("a doorway minute belongs to its departure room, even at arrival and across a saved transit", () => {
  const origin = enableHousing(raw(), "new");
  const destination = JSON.stringify({ roomId: "bedroom", cell: 0 });
  const walk = order(origin, one, "home-move", destination);
  assert.equal(inspectOrder(origin, one, "home-move", destination).minutes, 3);
  const transit = advance(walk, 1);
  assert.equal(transit.housing!.state.actors[one].position.kind, "transit");
  const arrived = advance(reload(transit, origin), 2);
  assert.equal(arrived.actors[0].room, "bedroom");
  assert.equal(roomStayMinutes(recordedDay(arrived, 1), one, "living"), 3);
  assert.equal(roomStayMinutes(recordedDay(arrived, 1), one, "bedroom"), 0);
  const stayed = advance(order(arrived, one, "work", "wood"), 4);
  assert.equal(roomStayMinutes(recordedDay(stayed, 1), one, "living"), 3);
  assert.equal(roomStayMinutes(recordedDay(stayed, 1), one, "bedroom"), 4);
  const yard = JSON.stringify({ roomId: "yard", cell: 0 });
  const yardWalk = inspectOrder(stayed, one, "home-move", yard).minutes!;
  const outsideRoom = advance(order(stayed, one, "home-move", yard), yardWalk);
  const workingOutside = advance(order(outsideRoom, one, "work", "wood"), 2);
  assert.equal(roomStayMinutes(recordedDay(workingOutside, 1), one, "yard"), 2);
});

test("old unknown positions, regional travel, and time spent outside never become minutes in an occupied room", () => {
  const legacy = enableHousing(order(raw(), one, "work", "wood"), "legacy");
  assert.equal(legacy.housing!.unlocated[one].reason, "legacy-unspecified");
  const unknown = advance(legacy, 4);
  assert.deepEqual(recordedDay(unknown, 1).entries, []);
  const oldHome = enableHousing(raw(480, 2), "new");
  const departing = order(
    order(oldHome, two, "work", "wood"),
    one,
    "travel",
    "landing",
  );
  const away = advance(departing, departing.actors[0].task!.remaining);
  assert.equal(away.actors[0].location, "landing");
  const tripDay = recordedDay(away, 1);
  assert.equal(tripDay.entries.filter((e) => e.actorId === one).length, 0);
  assert.ok(roomStayMinutes(tripDay, two, "living") > 0);
  const stayedAway = advance(order(away, one, "work", "wood"), 3);
  assert.equal(
    recordedDay(stayedAway, 1).entries.some((e) => e.actorId === one),
    false,
  );
  const returning = order(stayedAway, one, "return");
  const back = advance(returning, returning.actors[0].task!.remaining);
  assert.equal(back.actors[0].location, back.home);
  assert.equal(
    recordedDay(back, 1).entries.some((e) => e.actorId === one),
    false,
  );
  const backAtHome = advance(order(back, one, "work", "wood"), 2);
  assert.equal(roomStayMinutes(recordedDay(backAtHome, 1), one, "living"), 2);
});

test("midnight closes the preceding minute, opens an empty current day, and drops records older than yesterday", () => {
  const origin = enableHousing(raw(1438), "new");
  const work = order(origin, one, "work", "wood");
  const midnight = advance(work, 2);
  const yesterday = recordedDay(midnight, 1);
  assert.equal(yesterday.from, 1438);
  assert.equal(roomStayMinutes(yesterday, one, "living"), 2);
  const today = recordedDay(midnight, 2);
  assert.equal(today.from, 1440);
  assert.deepEqual(today.entries, []);
  const next = advance(reload(midnight, origin), 3);
  assert.equal(roomStayMinutes(recordedDay(next, 2), one, "living"), 3);
  assert.deepEqual(recordedDay(next, 1), yesterday);
  const followingMidnight = advance(next, 1437);
  assert.equal(followingMidnight.time, 2880);
  assert.deepEqual(
    followingMidnight.housing!.roomStay!.days.map((d) => d.day),
    [2, 3],
  );
  assert.equal(recordedDay(followingMidnight, 2).from, 1440);
  assert.deepEqual(recordedDay(followingMidnight, 3).entries, []);
  reload(followingMidnight, origin);
});

test("save validation rejects bad identities, double counts, invalid spans, and broken daily ordering", () => {
  const origin = enableHousing(raw(1438), "new");
  const good = advance(order(origin, one, "work", "wood"), 5);
  const first = recordedDay(good, 1);
  const second = recordedDay(good, 2);
  const row = second.entries[0];
  const withEntries = (entries: typeof second.entries) => [
    first,
    { ...second, entries },
  ];
  const invalid = [
    [],
    [second, first],
    [first, second, second],
    [first, { ...second, day: 3 }],
    [first, { ...second, from: 1439 }],
    [first, { ...second, from: good.time + 1 }],
    withEntries([row, row]),
    withEntries([{ ...row, actorId: "missing" }]),
    withEntries([{ ...row, roomId: "missing" }]),
    withEntries([{ ...row, minutes: -1 }]),
    withEntries([{ ...row, minutes: 1.5 }]),
    withEntries([{ ...row, minutes: 4 }]),
    withEntries([
      { ...row, minutes: 2 },
      { ...row, roomId: "bedroom", minutes: 2 },
    ]),
  ];
  for (const days of invalid) {
    const forged = structuredClone(good);
    forged.housing!.roomStay!.days = days;
    assert.equal(isGame(forged), false, JSON.stringify(days));
    assert.throws(() =>
      importSlot(
        exportSlot({ id: "wrong", name: "破損", game: forged, origin }),
      ),
    );
  }
  const wrongVersion = structuredClone(good);
  Object.assign(wrongVersion.housing!.roomStay!, { version: 2 });
  assert.equal(isGame(wrongVersion), false);
  reload(good, origin);
});

test("insulation history labels a missing period separately from zero minutes and distinguishes duplicate names", () => {
  function renderHistory(game: Game) {
    const before = JSON.stringify(game);
    const html = renderToStaticMarkup(
      createElement(InsulationPanel, {
        game,
        onGame: () => assert.fail("displaying history must not issue an order"),
      }),
    );
    assert.equal(JSON.stringify(game), before);
    const history = html.match(
      /<details[^>]*><summary>部屋ごとの滞在時間<\/summary>.*?<\/details>/s,
    );
    assert.ok(history);
    return history[0];
  }
  const base = raw(1438, 2);
  base.actors[0].person.name = base.actors[1].person.name = "ユウ";
  base.house.rooms[0].name = base.house.rooms[1].name = "家";
  const origin = enableHousing(base, "new");
  const empty = renderHistory(origin);
  assert.match(empty, /<td>記録なし<\/td><td>記録なし<\/td>/);
  assert.doesNotMatch(empty, /<td>0分<\/td>/);
  assert.match(empty, /家（同名の1室目）/);
  assert.match(empty, /家（同名の2室目）/);
  assert.doesNotMatch(empty, /<option value="yard"/);

  const atHome = order(origin, one, "work", "wood");
  const separating = order(atHome, two, "travel", "landing");
  const midnight = advance(separating, 2);
  const oldDay = renderHistory(midnight);
  assert.match(oldDay, /1日目 23:58〜24:00/);
  assert.match(
    oldDay,
    /ユウ（同名の1人目）<\/th><td>2分<\/td><td>記録なし<\/td>/,
  );
  assert.match(
    oldDay,
    /ユウ（同名の2人目）<\/th><td>0分<\/td><td>記録なし<\/td>/,
  );
  const next = renderHistory(advance(midnight, 1));
  assert.match(next, /2日目 00:00〜00:01/);
  assert.match(next, /ユウ（同名の1人目）<\/th><td>2分<\/td><td>1分<\/td>/);
  assert.match(next, /ユウ（同名の2人目）<\/th><td>0分<\/td><td>0分<\/td>/);
});
