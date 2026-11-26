// node --import tsx scripts/compare-room-lodging.mts
import {
  acceptLodging,
  declineLodging,
  endLodging,
  offerLodging,
  setLodgingReturn,
  withdrawLodgingOffer,
} from "../src/reform/housing/lodging.ts";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology.ts";
import {
  createRoomInsulation,
  isRoomInsulated,
} from "../src/reform/housing/insulation.ts";
import {
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "../src/reform/housing/construction.ts";
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import {
  createGame,
  enableHousing,
  setHousingRoomAccess,
  setHousingPassage,
  inspectOrder,
  order,
  advance,
  type Game,
} from "../src/reform/sim.ts";
import {
  getBedSleeper,
  setBedSleeper,
  setPreferredBed,
} from "../src/reform/housing/bedPreference.ts";
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
const people = ["アオ", "ミドリ", "アカ"].map((name, i) => ({
  ...makePersona(i, 4 + i),
  name,
}));
const [A, B, C] = people.map((p) => p.id);
const mat = "mat-1",
  bed = "fixture-1";
let house = editHouse(initialHouse(), {
  type: "move",
  id: mat,
  room: "living",
  cell: 7,
});
house = editHouse(house, {
  type: "build",
  kind: "bed",
  room: "bedroom",
  cell: 10,
});
const base = enableHousing(
  createGame(people, generateWorld(defaultWorldConfig()), "forest", house),
  "new",
);
const data = (g: Game) =>
  exportSlot({ id: "residency", name: "居住実測", origin: base, game: g });
const who = (g: Game, id: string) => g.actors.find((a) => a.person.id === id)!;
const point = (g: Game, id: string) =>
  g.housing!.state.actors[id]?.position ?? null;
const room = (id: string, cell = 0) => JSON.stringify({ roomId: id, cell });
function advanceTo(g: Game, t: number) {
  while (g.time < t) {
    const n = advance(g, t - g.time);
    assert.ok(n.time > g.time);
    g = n;
  }
  return g;
}
function issue(g: Game, id: string, kind: string, target?: string) {
  const p = inspectOrder(g, id, kind, target);
  assert.equal(
    p.disabled,
    undefined,
    `${g.time} ${id} ${kind} ${target}: ${p.disabled}`,
  );
  const started = order(g, id, kind, target);
  const done = advanceTo(started, g.time + p.minutes!);
  assert.equal(
    who(done, id).task,
    null,
    `${g.time} ${kind} elapsed ${p.minutes}`,
  );
  return { done, p };
}
type Case = "shared" | "exclusive for B" | "private A+C" | "B only" | "B away";
function model(setting: Case) {
  let g = setPreferredBed(base, B, bed);
  if (setting === "exclusive for B") g = setBedSleeper(g, bed, B);
  if (setting === "B only")
    g = setBedSleeper(setHousingRoomAccess(g, "bedroom", [B]), bed, B);
  if (setting === "private A+C") g = setHousingRoomAccess(g, "bedroom", [A, C]);
  return g;
}
function ledger(g: Game) {
  return g
    .housing!.roomStay!.days.filter(
      (d) => d.from % 1440 === 0 && d.day === Math.floor(g.time / 1440),
    )
    .map((d) => ({
      day: d.day,
      minutes: Object.fromEntries(
        d.entries
          .filter((e) => e.actorId === B)
          .map((e) => [e.roomId, e.minutes]),
      ),
    }));
}
function simulate(setting: Case) {
  let g = importSlot(data(model(setting))).game;
  const days = [];
  for (let day = 1; day <= 3; day++) {
    const start = g.time;
    // Any active automatic order may be replaced; if actually crossing a doorway
    // allow its remaining edge to finish before taking a new regional order.
    while (g.housing!.state.actors[B]?.position.kind === "transit")
      g = advance(g, 1);
    let outbound: number | null = null;
    if (who(g, B).location === g.home) {
      const trip = issue(g, B, "travel", "village");
      g = trip.done;
      outbound = trip.p.minutes!;
    }
    assert.equal(who(g, B).location, "village");
    const other = inspectOrder(g, B, "talk", A).disabled ?? null;
    let arrival = null,
      inbound: number | null = null;
    if (setting !== "B away") {
      const back = issue(g, B, "return");
      g = back.done;
      inbound = back.p.minutes!;
      arrival = point(g, B);
      assert.deepEqual(arrival, {
        kind: "at",
        point: { domainId: '["room","living"]', cell: 0 },
      });
    }
    const slept = issue(g, B, "need", "energy");
    g = slept.done;
    const rest = {
      minutes: slept.p.minutes,
      fixture: slept.p.facility?.fixtureId ?? null,
      facility: slept.p.facility?.roomId ?? null,
      after: who(g, B).room,
      point: point(g, B),
    };
    g = advanceTo(g, start + 1440);
    const round = importSlot(data(g)).game;
    assert.equal(data(round), data(g));
    g = round;
    days.push({
      day,
      outbound,
      inbound,
      arrival,
      rest,
      other,
      locationAt8: who(g, B).location,
      lastWholeCalendarDay: ledger(g),
      stocks: { coins: g.coins, food: g.food, wood: g.wood },
      bWork: who(g, B).metrics.work,
      bTravel: who(g, B).metrics.travel,
    });
  }
  return {
    setting,
    days,
    duration: g.time - base.time,
    endRights: g.housing!.controls.roomAccess.bedroom,
    sleeper: getBedSleeper(g, bed) ?? null,
  };
}
const origin = model("exclusive for B");
let funds = issue(origin, B, "pack", "coins");
const held = who(funds.done, B).cargo.coins;
const inTown = issue(funds.done, B, "travel", "village").done;
const rehome = issue(inTown, B, "return").done;
const transfer = {
  initial: origin.coins,
  afterPack: funds.done.coins,
  cargoInTown: who(inTown, B).cargo.coins,
  returnStock: rehome.coins,
  cargoAfter: who(rehome, B).cargo.coins,
  arrival: point(rehome, B),
};
assert.ok(held > 0);
assert.equal(transfer.cargoAfter, 0);
const outside = issue(origin, A, "travel", "village").done;
const co = issue(outside, B, "travel", "village").done;
const company = {
  region: "village",
  withPartner: !inspectOrder(co, B, "talk", A).disabled,
  withRegionalName: inspectOrder(co, B, "talk", origin.world.landmarks[0].npc)
    .disabled,
  thirdAt: who(co, C).location,
};
function maintenance(rights: string[] | null, worker: string) {
  const entry = setHousingRoomAccess(base, "bedroom", rights);
  const project = createRoomInsulation(entry, {
    roomId: "bedroom",
    stagingCell: 2,
  });
  assert.equal(project.error, undefined);
  const id = project.planId!;
  const reserved = reserveConstructionMaterial(project.game, id);
  assert.equal(reserved.error, undefined);
  const assigned = assignConstructionHaul(reserved.game, id, worker, "deliver");
  const wood = entry.wood - reserved.game.wood;
  if (assigned.error)
    return {
      rights,
      worker,
      wood,
      success: false,
      reason: assigned.error,
      stockReserved: reserved.game.wood,
    };
  let g = assigned.game;
  while (
    g.housing!.construction!.plans[id].assignment &&
    g.time < entry.time + 90
  )
    g = advance(g, 1);
  const haul = g.time - entry.time;
  const built = assignConstructionBuild(g, id, worker);
  assert.equal(built.error, undefined);
  g = built.game;
  while (!isRoomInsulated(g, "bedroom") && g.time < entry.time + 90)
    g = advance(g, 1);
  assert.ok(isRoomInsulated(g, "bedroom"));
  return {
    rights,
    worker,
    wood,
    success: true,
    haul,
    build: g.time - entry.time - haul,
    completedAfter: g.time - entry.time,
  };
}
function twoActivities(maintainer: string) {
  const state = setHousingRoomAccess(
    base,
    "bedroom",
    maintainer === B ? [B] : [A, B],
  );
  const plan = createRoomInsulation(state, {
    roomId: "bedroom",
    stagingCell: 2,
  });
  assert.equal(plan.error, undefined);
  const id = plan.planId!;
  const assigned = assignConstructionHaul(
    reserveConstructionMaterial(plan.game, id).game,
    id,
    maintainer,
    "deliver",
  );
  assert.equal(assigned.error, undefined);
  let g = assigned.game;
  let jobIssue: number | null = null;
  let jobDue: number | null = null;
  let actuallyFinished: number | null = null;
  function tick() {
    const before = who(g, B).task;
    g = advance(g, 1);
    if (before?.mode === "direct" && before.kind === "work" && !who(g, B).task)
      actuallyFinished = g.time - base.time;
  }
  const startIndependentWork = () => {
    const p = inspectOrder(g, B, "work", "wood:easy");
    assert.equal(p.disabled, undefined);
    jobIssue = g.time - base.time;
    jobDue = jobIssue + p.minutes!;
    g = order(g, B, "work", "wood:easy");
  };
  if (maintainer === A) startIndependentWork();
  while (
    g.housing!.construction!.plans[id].assignment &&
    g.time < base.time + 90
  )
    tick();
  const build = assignConstructionBuild(g, id, maintainer);
  assert.equal(build.error, undefined);
  g = build.game;
  while (!isRoomInsulated(g, "bedroom") && g.time < base.time + 90) tick();
  const finished = g.time - base.time;
  const bDuring = who(g, B).task?.kind ?? null;
  if (maintainer === B) startIndependentWork();
  assert.notEqual(jobDue, null);
  while (g.time < base.time + jobDue!) tick();
  assert.equal(actuallyFinished, jobDue);
  return {
    maintainer,
    maintenanceComplete: finished,
    jobIssue,
    actuallyFinished,
    bAtMaintenanceEnd: bDuring,
    bWoodXp: who(g, B).xp.wood,
  };
}
// Three starting housemates. Hold A physically by the entrance in this isolated
// control, and actually complete B's normal two regional legs. A is explicitly
// released from waiting before checking co-location (a busy peer cannot talk).
function arrivalControl() {
  let g = model("B only");
  for (const kind of ["travel", "return"]) {
    const p = inspectOrder(
      g,
      B,
      kind,
      kind === "travel" ? "village" : undefined,
    );
    assert.equal(p.disabled, undefined);
    const deadline = g.time + p.minutes!;
    g = order(g, B, kind, kind === "travel" ? "village" : undefined);
    while (g.time < deadline) {
      g = order(g, A, "wait");
      g = advanceTo(g, Math.min(deadline, g.time + 5));
    }
    assert.equal(who(g, B).task, null);
  }
  g = order(g, A, "cancel");
  assert.deepEqual(point(g, B), point(g, A));
  const before = g;
  const local = issue(before, B, "home-move", room("bedroom", 0));
  // Record the actual completion (meal/sleep) from each alternate arrival.
  function choices(start: Game) {
    const rest = issue(start, B, "need", "energy");
    const gatherFood = issue(start, B, "home-use", "hearth-1");
    return {
      point: point(start, B),
      talkToA: !inspectOrder(start, B, "talk", A).disabled,
      sleepAfterReturn: rest.done.time - before.time,
      mealAfterReturn: gatherFood.done.time - before.time,
    };
  }
  return {
    regionalReturn: before.time - base.time,
    localWalk: local.p.minutes,
    common: choices(before),
    private: choices(local.done),
  };
}
const lodgingRoom = "bedroom";
const entrance = { kind: "at", point: housingPoint("living", 0) };
const threshold = { kind: "at", point: housingPoint(lodgingRoom, 0) };
const door = housingLinkId("living", lodgingRoom);
const privateBefore = setHousingRoomAccess(model("shared"), lodgingRoom, [A]);
const lodging = (g: Game) => g.housing!.lodging;
const replay = (g: Game) => importSlot(data(g)).game;
function accepted(result: { game: Game; error?: string }) {
  assert.equal(result.error, undefined);
  return result.game;
}
function baselineAccess(g: Game, actorId: string) {
  return {
    room: !inspectOrder(g, actorId, "home-move", room(lodgingRoom)).disabled,
    bed: !inspectOrder(g, actorId, "home-use", bed).disabled,
    throughToYard: !inspectOrder(g, actorId, "home-move", room("yard"))
      .disabled,
  };
}
const beforeRights = baselineAccess(privateBefore, B);
assert.deepEqual(beforeRights, {
  room: false,
  bed: false,
  throughToYard: false,
});
const proposed = accepted(offerLodging(privateBefore, A, B, lodgingRoom));
assert.deepEqual(point(proposed, B), entrance);
assert.equal(lodging(proposed)?.phase, "offered");
assert.deepEqual(baselineAccess(proposed, B), beforeRights);
assert.ok(acceptLodging(proposed, C).error);
assert.equal(lodging(accepted(declineLodging(proposed, B))), undefined);
assert.equal(lodging(accepted(withdrawLodgingOffer(proposed, A))), undefined);
const linkClosed = (g: Game) => setHousingPassage(g, "link", door, false);
const blockedAccept = acceptLodging(linkClosed(proposed), B);
assert.ok(blockedAccept.error);
assert.equal(lodging(blockedAccept.game)?.phase, "offered");

const moving = accepted(acceptLodging(replay(proposed), B));
assert.deepEqual(point(moving, B), entrance);
assert.equal(lodging(moving)?.phase, "arriving");
// Keep A at the common entrance for the later meeting comparison.
const firstMove = advance(order(moving, A, "wait"), 1);
function settleMove(g: Game, phase: "arriving" | "leaving") {
  const from = g.time;
  while (lodging(g)?.phase === phase && g.time - from < 20) g = advance(g, 1);
  assert.notEqual(lodging(g)?.phase, phase);
  return g;
}
const occupied = settleMove(firstMove, "arriving");
assert.equal(occupied.time - proposed.time, 3);
assert.deepEqual(point(occupied, B), threshold);
assert.equal(lodging(occupied)?.phase, "occupied");
assert.equal(data(settleMove(replay(firstMove), "arriving")), data(occupied));
assert.deepEqual(occupied.housing!.controls.roomAccess.bedroom, [A]);
assert.deepEqual(baselineAccess(occupied, B), {
  room: true,
  bed: true,
  throughToYard: true,
});
assert.deepEqual(baselineAccess(occupied, C), beforeRights);
assert.equal(getBedSleeper(occupied, bed), undefined);
const bookingOtherBed = setBedSleeper(occupied, bed, A);
assert.ok(inspectOrder(bookingOtherBed, B, "home-use", bed).disabled);
const cancelling = order(firstMove, B, "cancel");
const cancelled = advance(replay(cancelling), 2);
assert.deepEqual(point(cancelled, B), threshold);
assert.equal(lodging(cancelled), undefined);
assert.equal(baselineAccess(cancelled, B).bed, false);

function regionalLeg(g: Game, kind: "travel" | "return", target?: string) {
  const p = inspectOrder(g, B, kind, target);
  assert.equal(p.disabled, undefined);
  const stopAt = g.time + 38; // Clock for the normal road alone, before any local leg.
  g = order(g, B, kind, target);
  while (g.time < stopAt) {
    g = order(g, A, "wait");
    g = advanceTo(g, Math.min(stopAt, g.time + 5));
  }
  return g;
}
function dialRoutine(g: Game, route: "entrance" | "room") {
  return accepted(setLodgingReturn(g, B, route));
}
function homeOptions(g: Game, atRoadEnd: number) {
  const rest = issue(g, B, "need", "energy");
  const meal = issue(g, B, "home-use", "hearth-1");
  return {
    point: point(g, B),
    talkToA: !inspectOrder(g, B, "talk", A).disabled,
    sleepAfterReturn: rest.done.time - atRoadEnd,
    mealAfterReturn: meal.done.time - atRoadEnd,
    bed: rest.p.facility?.fixtureId ?? null,
  };
}
const away = regionalLeg(occupied, "travel", "village");
assert.equal(who(away, B).location, "village");
assert.equal(point(away, B), null);
function comeBack(
  start: Game,
  destination: "room" | "entrance",
  cmd: "return" | "travel",
  blocked = false,
) {
  const staged = dialRoutine(start, destination);
  const road = order(
    regionalLeg(
      blocked ? linkClosed(staged) : staged,
      cmd,
      cmd === "travel" ? staged.home : undefined,
    ),
    A,
    "wait",
  );
  assert.deepEqual(point(road, B), entrance);
  assert.equal(who(road, B).location, staged.home);
  let end = road;
  if (destination === "room" && !blocked) {
    for (
      let i = 0;
      i < 12 && JSON.stringify(point(end, B)) !== JSON.stringify(threshold);
      i++
    )
      end = advance(end, 1);
    assert.deepEqual(point(end, B), threshold);
    assert.equal(end.time - road.time, 3);
    const during = advance(road, 1);
    assert.equal(data(advanceTo(replay(during), end.time)), data(end));
  } else {
    assert.deepEqual(point(end, B), entrance);
    assert.equal(who(end, B).task, null);
  }
  // B's routine never needs A to be at the entrance. Release the waiting lead
  // for the direct talk control after the two possible arrivals.
  end = order(end, A, "cancel");
  assert.deepEqual(point(end, A), entrance);
  assert.equal(lodging(end)?.phase, "occupied");
  return {
    game: end,
    row: {
      cmd,
      destination,
      blocked,
      roadMinutes: road.time - start.time,
      roadEnd: point(road, B),
      localMinutes: end.time - road.time,
      regularACL: end.housing!.controls.roomAccess.bedroom,
      ...homeOptions(end, road.time),
    },
  };
}
const returns = [
  comeBack(away, "entrance", "return"),
  comeBack(away, "room", "return"),
  comeBack(away, "room", "travel"),
  comeBack(away, "room", "return", true),
];
assert.deepEqual(
  returns.map((r) => r.row.talkToA),
  [true, false, false, true],
);
assert.deepEqual(
  returns.map((r) => r.row.mealAfterReturn),
  [22, 28, 28, 22],
);
assert.deepEqual(
  returns.map((r) => r.row.sleepAfterReturn),
  [61, 61, 61, 88],
); // Bed beyond the blocked link.

const blockedMoveOut = endLodging(linkClosed(returns[1].game), B);
assert.ok(blockedMoveOut.error);
assert.equal(lodging(blockedMoveOut.game)?.phase, "occupied");
assert.deepEqual(point(blockedMoveOut.game, B), threshold);
const leaving = accepted(endLodging(returns[1].game, B));
assert.equal(lodging(leaving)?.phase, "leaving");
assert.deepEqual(point(leaving, B), threshold);
const leftStep = advance(leaving, 1);
const left = settleMove(leftStep, "leaving");
assert.equal(data(settleMove(replay(leftStep), "leaving")), data(left));
assert.equal(lodging(left), undefined);
assert.deepEqual(point(left, B), entrance);
assert.deepEqual(baselineAccess(left, B), beforeRights);
assert.deepEqual(left.housing!.controls.roomAccess.bedroom, [A]);
const endAway = accepted(endLodging(away, B));
assert.equal(lodging(endAway), undefined);
assert.equal(who(endAway, B).location, "village");
assert.equal(point(endAway, B), null);

// Repeat actual regional returns after three calendar advances. After each
// morning's imposed outing and rest, all three people run normal autonomy.
function occupiedDays(destination: "entrance" | "room") {
  let g = dialRoutine(occupied, destination);
  const start = g.time;
  const days = [];
  for (let day = 1; day <= 3; day++) {
    while (point(g, B)?.kind === "transit") g = advance(g, 1);
    g = issue(g, B, "travel", "village").done;
    const road = inspectOrder(g, B, "return");
    assert.equal(road.disabled, undefined);
    const endpoint = g.time + 38;
    g = advanceTo(order(g, B, "return"), endpoint);
    assert.deepEqual(point(g, B), entrance);
    if (destination === "room") {
      g = advance(g, 3);
      assert.deepEqual(point(g, B), threshold);
    }
    const stop = issue(g, B, "need", "energy");
    const rest = {
      room: stop.p.facility?.roomId ?? null,
      fixture: stop.p.facility?.fixtureId ?? null,
      localMinutes: g.time - endpoint,
      restMinutes: stop.p.minutes,
      restAfterRoad: stop.done.time - endpoint,
    };
    g = advanceTo(stop.done, start + day * 1440);
    const after = replay(g);
    assert.equal(data(after), data(g));
    assert.equal(lodging(after)?.returnTo, destination);
    assert.equal(lodging(after)?.phase, "occupied");
    g = after;
    days.push({
      day,
      ...rest,
      locationAtCheckpoint: who(g, B).location,
      completeCalendarDay: ledger(g),
    });
  }
  return { destination, elapsed: g.time - start, days };
}
const upkeep = [
  maintenance([B], A),
  maintenance([B], B),
  maintenance([A, B], A),
];
const rows = (
  ["shared", "exclusive for B", "private A+C", "B only", "B away"] as Case[]
).map(simulate);
assert.ok(rows.every((r) => r.duration === 4320));
assert.deepEqual(
  rows.map((r) => r.days.map((d) => d.rest.minutes)),
  [
    [61, 61, 61],
    [61, 61, 61],
    [88, 88, 88],
    [61, 61, 61],
    [90, 90, 90],
  ],
);
console.log(
  JSON.stringify(
    {
      baselineCommit: "fa8ffe8712ba05aa1531e0fa1ce6405e4cb3dce9",
      designSources: [
        "https://help.ea.com/en/articles/the-sims/the-sims-4/for-rent-residential-rentals-guide/",
        "https://lofigames.com/patch-notes/",
        "https://store.steampowered.com/app/233860/Kenshi/",
        "https://rimworldgame.com/",
      ],
      lodging: {
        offer: lodging(proposed),
        beforeRights,
        onOffer: baselineAccess(proposed, B),
        blockedAcceptance: blockedAccept.error,
        moveInMinutes: occupied.time - proposed.time,
        moveInAt: point(occupied, B),
        onArrival: baselineAccess(occupied, B),
        cancelledArrival: {
          cancelAtMinute: firstMove.time - proposed.time,
          edgeFinishedAtMinute: cancelled.time - proposed.time,
          phase: lodging(cancelled)?.phase ?? null,
          position: point(cancelled, B),
          bedStillUsable: baselineAccess(cancelled, B).bed,
        },
        blockedMoveOut: blockedMoveOut.error,
        returns: returns.map((r) => r.row),
        threeDays: [occupiedDays("entrance"), occupiedDays("room")],
        moveOutMinutes: left.time - leaving.time,
        moveOutAt: point(left, B),
        afterLeaving: baselineAccess(left, B),
        leftWhileAway: who(endAway, B).location,
      },
      rows,
      transfer,
      company,
      ordinaryRoomPermissionMaintenance: upkeep,
      ordinaryRoomPermissionWorkSplit: [twoActivities(B), twoActivities(A)],
      arrivalControl: arrivalControl(),
    },
    null,
    2,
  ),
);
