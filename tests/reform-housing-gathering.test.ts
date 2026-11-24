import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse, type FixtureKind } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  nextCompletionMinutes,
  order,
  setHousingRoomAccess,
  setHousingPassage,
  type Game,
} from "../src/reform/sim";
import { generateWorld, defaultWorldConfig } from "../src/reform/world";
import {
  housingPoint,
  housingSlotId,
  housingLinkId,
} from "../src/reform/housing/topology";
import * as commands from "../src/reform/housing/gathering";

const [a, b, c] = ["person-1", "person-2", "person-3"];
const req = (kind: "talk" | "meal" = "meal", actorIds = [a, b]) => ({
  kind,
  actorIds,
  roomId: "living",
  fixtureId: "bench-1",
});
function base(n = 2, kind: FixtureKind = "bench", house = initialHouse()) {
  house.rooms[0].fixtures.find((fixture) => fixture.id === "bench-1")!.kind =
    kind;
  return createGame(
    Array.from({ length: n }, (_, i) => makePersona(i, 23 + i)),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}
function at(g: Game, id: string, room: string, cell: number) {
  g.housing!.state.actors[id].position = {
    kind: "at",
    point: housingPoint(room, cell),
  };
  g.actors.find((x) => x.person.id === id)!.room = room;
}
const seat = (n: number) => housingSlotId("living", "bench-1", n);

test("complete matching gives the resident already at seat zero that seat, independent of request order", () => {
  const g = enableHousing(base(3, "table"), "new");
  at(g, b, "living", 1);
  at(g, c, "living", 6);
  const request = req("meal", [a, b, c]);
  const saved = JSON.stringify(g);
  const inspected = commands.inspectHousingGathering(g, request);
  assert.deepEqual(inspected.assignments, [
    { actorId: a, slotId: seat(1), minutes: 1 },
    { actorId: b, slotId: seat(0), minutes: 0 },
    { actorId: c, slotId: seat(2), minutes: 0 },
  ]);
  assert.equal(inspected.minutes, 21);
  const next = commands.startHousingGathering(g, request);
  assert.deepEqual(
    next,
    commands.startHousingGathering(g, req("meal", [c, b, a])),
  );
  assert.equal(next.food, g.food - 3);
  assert.equal(next.time, g.time);
  assert.equal(next.rng, g.rng);
  assert.equal(
    new Set(next.actors.map((p) => p.task?.spatial?.orderId)).size,
    3,
  );
  for (const p of next.actors) {
    assert.deepEqual(p.task?.reserved, { food: 1 });
    assert.equal(p.task?.kind, "home-gather");
    assert.equal(p.task?.partner, undefined);
  }
  assert.equal(JSON.stringify(g), saved);
});
test("both activities accept all shared venues and reject a bed", () => {
  for (const kind of ["bench", "table", "kitchen", "bed"] as const)
    for (const activity of ["meal", "talk"] as const)
      assert.equal(
        commands.inspectHousingGathering(base(2, kind), req(activity)).ok,
        kind !== "bed",
      );
});
test("failed commands preserve all legacy positions, resources and counters", () => {
  const old = enableHousing(base(3), "legacy");
  for (const [game, request] of [
    [old, req("talk", [a, a])],
    [old, req("talk", [a])],
    [old, req("talk", [a, "missing"])],
    [old, req("talk", [a, b, c])],
    [order(old, b, "wait"), req()],
    [{ ...old, food: 1 }, req()],
    [setHousingRoomAccess(old, "living", [a]), req()],
  ] as const) {
    const before = JSON.stringify(game);
    assert.ok(commands.inspectHousingGathering(game, request).disabled);
    assert.equal(commands.startHousingGathering(game, request), game);
    assert.equal(JSON.stringify(game), before);
  }
  for (const change of [
    { danger: true },
    { injury: 70 },
    { location: "marsh" },
  ]) {
    const bad = structuredClone(old);
    Object.assign(bad.actors[1], change);
    assert.equal(commands.startHousingGathering(bad, req()), bad);
  }
  const next = commands.startHousingGathering(old, req());
  assert.deepEqual(Object.keys(next.housing!.unlocated), [c]);
  assert.equal(old.housing!.layoutVersion, undefined);
});
const group = (g: Game) => Object.values(g.housing!.gatherings!)[0];
const member = (g: Game, id: string) =>
  group(g).members.find((m) => m.actorId === id)!;
function split(kind: "meal" | "talk", n = 2) {
  const g = enableHousing(base(n, n === 3 ? "table" : "bench"), "new");
  at(g, a, "living", 1);
  at(g, b, "bedroom", 0);
  if (n === 3) at(g, c, "living", 6);
  return commands.startHousingGathering(
    g,
    req(kind, n === 3 ? [a, b, c] : [a, b]),
  );
}
test("early arrival waits four minutes, then both whole minutes accrue independent of actor order", () => {
  const g = split("talk");
  const almost = advance(g, 3);
  assert.equal(almost.actors[0].task?.remaining, 20);
  const arrived = advance(almost, 1);
  assert.equal(group(arrived).startedAt, 484);
  assert.equal(member(arrived, a).usedMinutes, 0);
  const used = advance(arrived, 1);
  assert.equal(member(used, a).usedMinutes, 1);
  assert.equal(used.actors[0].metrics.waiting, 4);
  assert.equal(used.actors[0].metrics.free, 1);
  assert.deepEqual(used, advance(g, 5));
  const reversed = { ...g, actors: [...g.actors].reverse() };
  const other = advance(reversed, 5);
  other.actors.reverse();
  assert.deepEqual(other, used);
});
test("ready-only meal keeps travel escrow until safe exit; talk needs two ready participants", () => {
  const talk = split("talk");
  assert.equal(
    commands.inspectStartReadyGathering(talk, group(talk).id).ok,
    false,
  );
  let g = advance(split("meal"), 1);
  const id = group(g).id,
    food = g.food;
  assert.deepEqual(commands.inspectStartReadyGathering(g, id).readyActorIds, [
    a,
  ]);
  g = commands.startReadyGathering(g, id);
  assert.equal(member(g, b).status, "withdrawing");
  assert.equal(member(g, a).usedMinutes, 0);
  assert.equal(g.food, food);
  g = advance(g, 2);
  assert.equal(g.food, food + 1);
  assert.equal(g.actors[1].task, null);
  assert.equal(member(g, a).usedMinutes, 2);
  assert.equal(member(g, a).togetherMinutes, 0);
});
test("at the deadline a blocked guest leaves and a ready diner begins; a lone talker is released", () => {
  for (const kind of ["meal", "talk"] as const) {
    let g = split(kind);
    g = setHousingPassage(g, "link", housingLinkId("living", "bedroom"), false);
    g = advance(g, 18);
    assert.equal(member(g, a).usedMinutes, 0);
    g = advance(g, 1);
    assert.equal(g.actors[1].task, null);
    if (kind === "talk") assert.equal(g.actors[0].task, null);
    else {
      assert.equal(group(g).startedAt, g.time);
      assert.equal(member(advance(g, 1), a).usedMinutes, 1);
    }
  }
});
test("even the one permitted talker times out after fifteen minutes without a partner; minute fifteen can resume use", () => {
  let g = advance(split("talk", 3), 4);
  g = setHousingRoomAccess(g, "living", [a]);
  const fourteen = advance(g, 14);
  assert.ok(fourteen.actors.every((p) => p.task?.remaining === 20));
  const recovered = advance(
    setHousingRoomAccess(fourteen, "living", [a, c]),
    1,
  );
  assert.equal(member(recovered, a).usedMinutes, 1);
  assert.equal(member(recovered, a).stoppedAt, null);
  assert.equal(member(recovered, b).status, "left");
  const expired = advance(fourteen, 1);
  assert.ok(expired.actors.every((p) => p.task === null));
});
function seated(kind: "talk" | "meal", n = 2) {
  const g = enableHousing(base(n, n === 3 ? "table" : "bench"), "new");
  for (const [i, id] of [a, b, c].slice(0, n).entries()) {
    at(g, id, "living", [1, 4, 6][i]);
    g.actors[i].needs.hunger = g.actors[i].needs.social = 20;
    g.actors[i].person.personality = "social";
  }
  g.actors[0].relations[b].kind = "rival";
  return commands.startHousingGathering(g, req(kind, [a, b, c].slice(0, n)));
}
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + " != " + expected);
}
for (const kind of ["talk", "meal"] as const) {
  test(
    kind +
      " rewards each whole minute, each pair once, and remembers each peer on their fifth overlapping minute",
    () => {
      const g = seated(kind, 3);
      const four = advance(g, 4);
      assert.equal(four.actors[0].memories.length, 0);
      const five = advance(four, 1);
      const p = five.actors[0];
      close(
        p.needs.hunger,
        20 + 5 * (kind === "meal" ? 2.8 - 0.12 * 0.3 : -0.12),
      );
      close(
        p.needs.social,
        20 +
          5 * (kind === "talk" ? 2 - 0.055 * 1.35 * 0.3 : 0.5 - 0.055 * 1.35),
      );
      for (const m of group(five).members) assert.equal(m.togetherMinutes, 5);
      assert.deepEqual(
        group(five).pairs.map((p) => p.minutes),
        [5, 5, 5],
      );
      assert.equal(p.relations[b].trust, -0.5);
      assert.equal(
        p.relations[b].affection,
        g.actors[0].relations[b].affection - 0.5,
      );
      assert.equal(five.actors[1].relations[a].trust, 0.5);
      assert.deepEqual(
        p.memories.map((m) => m.value).sort((x, y) => x - y),
        [-4, 4],
      );
      assert.ok(
        p.memories.every(
          (m) => m.until === five.time + (kind === "talk" ? 150 : 180),
        ),
      );
      const done = advance(five, 15);
      assert.ok(
        done.actors.every((p) => p.task === null && p.memories.length === 2),
      );
      close(
        done.actors[0].needs.hunger,
        20 + 20 * (kind === "meal" ? 2.8 - 0.12 * 0.3 : -0.12),
      );
      close(
        done.actors[0].needs.social,
        20 +
          20 * (kind === "talk" ? 2 - 0.055 * 1.35 * 0.3 : 0.5 - 0.055 * 1.35),
      );
      assert.deepEqual(done, advance(JSON.parse(JSON.stringify(four)), 16));
      assert.deepEqual(done, advance(JSON.parse(JSON.stringify(five)), 15));
    },
  );
}
test("only the current meal's actual diners count; partial food and relationship changes survive cancellation", () => {
  let g = advance(seated("meal"), 3);
  const trust = g.actors[0].relations[b].trust,
    food = g.food;
  g = order(g, a, "cancel");
  assert.equal(g.food, food);
  assert.equal(g.actors[0].relations[b].trust, trust);
  const p = g.actors[1];
  assert.deepEqual(commands.gatheringPresence(g, b), [b]);
  assert.deepEqual(commands.gatheringPresence(g, a), []);
  const after = advance(g, 1);
  close(after.actors[1].needs.social, p.needs.social - 0.055 * 1.35);
  assert.equal(member(after, b).togetherMinutes, 3);
  assert.equal(member(after, b).usedMinutes, 4);
  assert.equal(after.actors[0].relations[b].trust, trust);
});
test("next completion projects release, including the deadline, safe exit or unrelated earlier work, without changing inspections", () => {
  const g = split("meal");
  for (const [game, want] of [
    [g, 24],
    [
      setHousingPassage(g, "link", housingLinkId("living", "bedroom"), false),
      19,
    ],
    [commands.startReadyGathering(advance(g, 1), group(g).id), 2],
  ] as const) {
    const before = JSON.stringify(game);
    assert.equal(nextCompletionMinutes(game), want);
    const id = group(game).id;
    commands.inspectStartReadyGathering(game, id);
    commands.gatheringStatus(game, a);
    commands.gatheringPresence(game, a);
    assert.equal(JSON.stringify(game), before);
    const after = advance(game, want);
    assert.ok(after.actors.some((p) => p.task === null));
    assert.ok(advance(game, want - 1).actors.every((p) => p.task));
  }
  let earlier = enableHousing(base(3), "new");
  earlier = order(earlier, c, "wait");
  earlier = commands.startHousingGathering(earlier, req("talk"));
  assert.equal(nextCompletionMinutes(earlier), 5);
});
test("a synthetic long admitted segment keeps its reservation after the solo meal completes and its seat can be rebooked", () => {
  let g = advance(split("meal"), 1);
  // Current room links take three minutes. Exercise the ordering independently
  // of that map tuning by extending just the already admitted interval.
  const pos = g.housing!.state.actors[b].position;
  assert.equal(pos.kind, "transit");
  if (pos.kind === "transit") {
    pos.step.minutes = 27;
    pos.remaining = 26;
  }
  g = commands.startReadyGathering(g, group(g).id);
  assert.equal(nextCompletionMinutes(g), 20);
  const food = g.food;
  g = advance(g, 20);
  assert.equal(member(g, a).status, "completed");
  assert.equal(member(g, b).status, "withdrawing");
  assert.equal(g.food, food);
  g = order(g, a, "need", "social");
  const own = g.actors[0].task?.spatial?.orderId;
  assert.ok(own);
  assert.equal(nextCompletionMinutes(g), 6);
  g = advance(g, 6);
  assert.deepEqual(g.housing!.gatherings, {});
  assert.equal(g.actors[0].task?.spatial?.orderId, own);
  assert.equal(g.food, food + 1);
  assert.ok(isGame(g));
});
test("replacement checks roll back an invalid new job; a valid job replaces only the selected member", () => {
  const g = seated("talk", 3),
    before = JSON.stringify(g);
  const failure = order(g, a, "nonsense");
  assert.deepEqual(failure.housing, g.housing);
  assert.deepEqual(failure.actors, g.actors);
  assert.equal(failure.food, g.food);
  const replacement = order(g, a, "work", "cook");
  assert.equal(replacement.actors[0].task?.target, "cook");
  assert.equal(member(replacement, a).status, "left");
  assert.equal(member(advance(replacement, 2), b).usedMinutes, 2);
  assert.ok(isGame(replacement));
  assert.equal(JSON.stringify(g), before);
});
test("early arrivals and seated residents denied further use stay visible; neither presence alone nor a passerby grants experience", () => {
  const g = split("talk", 3);
  assert.deepEqual(commands.gatheringPresence(g, a), [a, c]);
  assert.deepEqual(commands.gatheringPresence(g, b), []);
  const first = advance(g, 1);
  assert.equal(member(first, a).togetherMinutes, 0);
  let paused = setHousingRoomAccess(advance(g, 4), "living", [a]);
  assert.deepEqual(commands.gatheringPresence(paused, b), [a, b, c]);
  assert.match(commands.gatheringStatus(paused, a)!.detail, /相手/);
  paused = advance(paused, 1);
  assert.equal(member(paused, a).usedMinutes, 0);
  const left = order(paused, c, "cancel");
  assert.deepEqual(commands.gatheringPresence(left, c), []);
  assert.deepEqual(commands.gatheringPresence(left, a), [a, b]);
});
test("a real three-minute link preserves the withdrawing member after the last diner leaves and returns their unused food only on exit", () => {
  let g = advance(split("meal"), 1);
  const food = g.food;
  g = commands.startReadyGathering(g, group(g).id);
  g = order(g, a, "cancel");
  assert.ok(isGame(g));
  assert.equal(g.food, food + 1);
  assert.equal(member(g, b).status, "withdrawing");
  assert.deepEqual(commands.gatheringPresence(g, b), []);
  assert.equal(nextCompletionMinutes(g), 2);
  g = advance(JSON.parse(JSON.stringify(g)), 1);
  assert.ok(isGame(g));
  assert.equal(g.food, food + 1);
  g = advance(g, 1);
  assert.ok(isGame(g));
  assert.equal(g.food, food + 2);
  assert.deepEqual(g.housing!.gatherings, {});
});
test("admission checks include an actually reserved full bench, a legacy upgrade conflict, and a closed route reopened mid-gathering", () => {
  const raw = base(3);
  const booked = order(order(raw, a, "need", "social"), b, "need", "social");
  const snapshot = JSON.stringify(booked);
  assert.match(
    commands.inspectHousingGathering(booked, req("talk", [a, c])).disabled!,
    /席を保てない/,
  );
  assert.equal(
    commands.startHousingGathering(booked, req("talk", [a, c])),
    booked,
  );
  assert.equal(JSON.stringify(booked), snapshot);
  const full = commands.startHousingGathering(raw, req("talk"));
  assert.equal(
    commands.inspectHousingGathering(full, req("talk", [a, c])).capacity,
    0,
  );
  const link = housingLinkId("living", "bedroom");
  const blocked = enableHousing(raw, "new");
  at(blocked, b, "bedroom", 0);
  const closed = setHousingPassage(blocked, "link", link, false);
  assert.equal(commands.startHousingGathering(closed, req()), closed);
  let trial = commands.startHousingGathering(blocked, req());
  trial = setHousingPassage(trial, "link", link, false);
  trial = advance(trial, 3);
  trial = setHousingPassage(trial, "link", link, true);
  trial = advance(trial, 5);
  assert.equal(member(trial, b).usedMinutes, 1);
  assert.ok(isGame(trial));
});
test("layout migration refusal leaves seat counts unmeasured even for a separate usable venue", () => {
  const house = initialHouse();
  house.rooms[0].fixtures.unshift({
    id: "kitchen-qa",
    kind: "kitchen",
    cell: 10,
  });
  const raw = base(3, "bench", house);
  const request = { ...req("meal", [a, c]), fixtureId: "kitchen-qa" };
  const available = commands.inspectHousingGathering(raw, request);
  assert.ok(available.ok);
  assert.equal(available.capacity, 2);
  const blocked = enableHousing(
    order(order(raw, a, "need", "social"), b, "need", "social"),
    "legacy",
  );
  assert.ok(isGame(blocked));
  const before = JSON.stringify(blocked);
  const inspection = commands.inspectHousingGathering(blocked, request);
  assert.match(inspection.disabled!, /長椅子の席を保てない/);
  assert.equal(inspection.capacity, null);
  assert.equal(inspection.physicalCapacity, null);
  assert.equal(commands.startHousingGathering(blocked, request), blocked);
  assert.equal(JSON.stringify(blocked), before);
});

test("one free seat can come from the floor plan or from an existing booking", () => {
  const house = initialHouse();
  const living = house.rooms[0];
  living.fixtures = [living.fixtures[1]];
  living.walls = [1, 2, 7, 9, 10];
  const oneSeat = enableHousing(base(3, "bench", house), "new");
  const oneBooked = order(enableHousing(base(3), "new"), c, "need", "social");
  for (const [g, physicalCapacity] of [
    [oneSeat, 1],
    [oneBooked, 2],
  ] as const) {
    assert.ok(isGame(g));
    const inspection = commands.inspectHousingGathering(g, req("talk"));
    assert.match(inspection.disabled!, /空いている席が足りません/);
    assert.equal(inspection.capacity, 1);
    assert.equal(inspection.physicalCapacity, physicalCapacity);
    assert.equal(commands.startHousingGathering(g, req("talk")), g);
  }
});

test("complete matching backtracks when a synthetic per-seat allowance leaves one resident only seat zero", () => {
  const g = enableHousing(base(), "new");
  // The spatial core supports slot-specific permissions. Today's house editor
  // applies a room's policy to all its slots, so isolate that future constraint.
  const setup = commands.startHousingGathering(g, req());
  const empty = order(order(setup, a, "cancel"), b, "cancel");
  empty.housing!.state.slots[seat(1)].allowedActorIds = [a];
  assert.deepEqual(
    commands
      .inspectHousingGathering(empty, req())
      .assignments.map((x) => x.slotId),
    [seat(1), seat(0)],
  );
});
test("the talkers present can start a three-person gathering early and keep talking while the traveller safely exits", () => {
  let g = advance(split("talk", 3), 1);
  const id = group(g).id;
  assert.deepEqual(commands.inspectStartReadyGathering(g, id).readyActorIds, [
    a,
    c,
  ]);
  const started = commands.startReadyGathering(g, id);
  assert.equal(started.time, g.time);
  assert.equal(member(started, b).status, "withdrawing");
  assert.ok(isGame(started));
  g = advance(started, 2);
  assert.equal(member(g, b).status, "left");
  assert.equal(member(g, a).usedMinutes, 2);
  assert.equal(member(g, c).togetherMinutes, 2);
});
test("a real door can hold a reserved seat unreachable until it reopens; no seat or order changes", () => {
  const raw = base();
  raw.house.rooms[0].doors = [4];
  const initial = enableHousing(raw, "new");
  at(initial, a, "living", 1);
  const booked = commands.startHousingGathering(initial, req("talk"));
  const orderId = member(booked, b).orderId;
  const door = JSON.stringify(["door", "living", 4]);
  let g = setHousingPassage(booked, "door", door, false);
  g = advance(g, 3);
  assert.equal(member(g, a).usedMinutes, 0);
  assert.equal(member(g, b).orderId, orderId);
  assert.match(commands.gatheringStatus(g, b)!.detail, /通路/);
  assert.ok(isGame(g));
  g = advance(setHousingPassage(g, "door", door, true), 2);
  assert.equal(member(g, b).orderId, orderId);
  assert.equal(member(g, a).usedMinutes, 1);
});
test("without advance, a second gathering cannot take a genuine in-transit traveller or leave any partial reservations", () => {
  const initial = enableHousing(base(3), "new");
  const travel = advance(
    order(
      initial,
      a,
      "home-move",
      JSON.stringify({ roomId: "bedroom", cell: 0 }),
    ),
    1,
  );
  const inspected = commands.inspectHousingGathering(
    travel,
    req("meal", [a, b]),
  );
  assert.match(inspected.disabled!, /区間/);
  assert.equal(
    commands.startHousingGathering(travel, req("meal", [a, b])),
    travel,
  );
});
test("when the link reopens one minute before the deadline, next completion includes the remaining two minutes of safe exit", () => {
  const link = housingLinkId("living", "bedroom");
  let g = setHousingPassage(split("meal"), "link", link, false);
  g = advance(g, 18);
  g = setHousingPassage(g, "link", link, true);
  assert.equal(nextCompletionMinutes(g), 3);
  g = advance(g, 1);
  assert.ok(isGame(g));
  assert.equal(group(g).startedAt, g.time);
  assert.equal(member(g, b).status, "withdrawing");
  assert.equal(nextCompletionMinutes(g), 2);
  const after = advance(g, 2);
  assert.equal(after.actors[1].task, null);
  assert.equal(member(after, a).usedMinutes, 2);
});
test("a recorded use denial preserves the fourteen-minute non-use clock across permission edits and reload", () => {
  const used = advance(seated("talk"), 2);
  const denied = setHousingRoomAccess(used, "living", []);
  assert.ok(isGame(denied));
  assert.equal(member(denied, a).stoppedAt, null);
  const fourteen = advance(denied, 14);
  assert.ok(isGame(fourteen));
  assert.equal(
    fourteen.housing!.state.actors[a].order?.waitReason,
    "use-denied",
  );
  const restored = setHousingRoomAccess(fourteen, "living", null);
  assert.ok(isGame(restored));
  const resumed = advance(JSON.parse(JSON.stringify(restored)), 1);
  assert.ok(isGame(resumed));
  assert.equal(member(resumed, a).usedMinutes, 3);
  assert.equal(member(resumed, a).stoppedAt, null);
  const untouched = advance(JSON.parse(JSON.stringify(fourteen)), 1);
  assert.ok(untouched.actors.every((p) => p.task === null));
  const erased = structuredClone(fourteen);
  for (const m of group(erased).members) m.stoppedAt = null;
  assert.equal(isGame(erased), false);
});

test("a lone permitted talker cannot erase fourteen stopped minutes while all previous partners were idle last minute", () => {
  const two = advance(seated("talk", 3), 2);
  const bc = advance(setHousingRoomAccess(two, "living", [b, c]), 13);
  const stopped = advance(setHousingRoomAccess(bc, "living", [a]), 1);
  assert.ok(isGame(stopped));
  assert.deepEqual(
    group(stopped).members.map((m) => stopped.time - m.stoppedAt!),
    [14, 1, 1],
  );
  assert.equal(stopped.housing!.state.actors[a].order!.phase, "use");
  const expired = advance(JSON.parse(JSON.stringify(stopped)), 1);
  assert.equal(member(expired, a).status, "left");
  const restored = setHousingRoomAccess(stopped, "living", null);
  assert.ok(isGame(restored));
  assert.equal(member(advance(restored, 1), a).usedMinutes, 3);
  const forged = structuredClone(stopped);
  member(forged, a).stoppedAt = null;
  assert.equal(isGame(forged), false);
});

test("last-minute talk partners may have just completed or been cancelled at that boundary", () => {
  const twelve = advance(seated("talk", 3), 12);
  const nineteen = advance(setHousingRoomAccess(twelve, "living", [a, b]), 7);
  const left = order(nineteen, b, "cancel");
  assert.equal(member(left, b).status, "left");
  assert.equal(member(left, a).stoppedAt, null);
  assert.ok(isGame(left));
  const completed = advance(
    setHousingRoomAccess(nineteen, "living", [b, c]),
    1,
  );
  assert.equal(member(completed, b).status, "completed");
  assert.equal(member(completed, c).stoppedAt, null);
  assert.ok(isGame(completed));
});

test("four restarted talks refresh one peer memory and give the same mood and relationship as twenty continuous minutes", () => {
  const start = seated("talk");
  const continuous = advance(start, 20);
  let repeated = start;
  for (let i = 0; i < 4; i++) {
    if (i) {
      repeated = order(repeated, a, "cancel");
      repeated = commands.startHousingGathering(repeated, req("talk"));
    }
    repeated = advance(repeated, 5);
    assert.ok(isGame(repeated));
    repeated = JSON.parse(JSON.stringify(repeated));
  }
  assert.equal(repeated.time, continuous.time);
  for (const [i, person] of repeated.actors.entries()) {
    const expected = continuous.actors[i];
    assert.deepEqual(person.needs, expected.needs);
    assert.deepEqual(person.relations, expected.relations);
    assert.equal(person.memories.length, 1);
    assert.equal(person.mood, expected.mood);
    assert.equal(person.memories[0].value, expected.memories[0].value);
    assert.equal(person.memories[0].until, repeated.time + 150);
    assert.equal(expected.memories[0].until, continuous.time - 15 + 150);
  }
});

test("gathering memories distinguish same-name peers and kinds across partial departure and preserve old labels", () => {
  let g = seated("talk", 3);
  g.actors[1].person.name = g.actors[2].person.name = "スイ";
  const old = { label: "スイと交わした会話", value: 2, until: g.time + 90 };
  g.actors[0].memories = [{ ...old }];
  g = advance(g, 5);
  const atFive = g.actors[0].memories;
  assert.deepEqual(
    atFive.map((m) => m.gathering?.peerId),
    [undefined, b, c],
  );
  g = order(g, c, "cancel");
  g = advance(g, 2);
  assert.deepEqual(g.actors[0].memories, atFive);
  g = order(g, a, "cancel");
  g = advance(commands.startHousingGathering(g, req("meal")), 5);
  g = order(order(g, a, "cancel"), b, "cancel");
  g.actors[0].relations[b].kind = "friend";
  g = advance(commands.startHousingGathering(g, req("talk")), 5);
  assert.ok(isGame(g));
  const [legacy, talkB, talkC, mealB] = g.actors[0].memories;
  assert.deepEqual(legacy, old);
  assert.equal(g.actors[0].memories.length, 4);
  assert.deepEqual(talkB.gathering, { kind: "talk", peerId: b });
  assert.equal(talkB.value, 4);
  assert.equal(talkB.until, g.time + 150);
  assert.deepEqual(talkC, atFive[2]);
  assert.deepEqual(mealB.gathering, { kind: "meal", peerId: b });
  assert.equal(mealB.value, -4);
  assert.equal(mealB.until, g.time - 5 + 180);
});

test("an expiring peer memory disappears before the next fifth minute creates a fresh memory", () => {
  const start = seated("talk");
  const old = {
    label: "以前の表示",
    value: 4,
    until: start.time + 3,
    gathering: { kind: "talk" as const, peerId: b },
  };
  start.actors[0].memories = [old];
  const four = advance(start, 4);
  assert.deepEqual(four.actors[0].memories, []);
  const five = advance(four, 1);
  assert.deepEqual(five.actors[0].memories, [
    {
      label: start.actors[1].person.name + "と交わした会話",
      value: -4,
      until: five.time + 150,
      gathering: old.gathering,
    },
  ]);
});

test("unequal stop times keep legitimate solo meal minutes in the pair window", () => {
  const shared = advance(seated("meal"), 2);
  const solo = advance(setHousingRoomAccess(shared, "living", [b]), 3);
  const stopped = advance(setHousingRoomAccess(solo, "living", []), 1);
  assert.deepEqual(
    group(stopped).members.map((m) => m.usedMinutes),
    [2, 5],
  );
  assert.equal(group(stopped).pairs[0].minutes, 2);
  assert.ok(isGame(stopped));
});

test("a past three-way conversation cannot stand in for a last-minute pair while the third was stopped", () => {
  const shared = advance(seated("talk", 3), 2);
  const paused = advance(setHousingRoomAccess(shared, "living", [a]), 1);
  const left = order(paused, b, "cancel");
  assert.ok(isGame(left));
  assert.equal(member(left, b).status, "left");
  assert.equal(member(left, c).stoppedAt, left.time - 1);
  member(left, a).stoppedAt = null;
  assert.equal(isGame(left), false);
});
