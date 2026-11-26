// node --import tsx scripts/compare-gathering-guest.mts
import assert from "node:assert/strict";
import {
  createGame,
  enableHousing,
  inspectOrder,
  setHousingRoomAccess,
  advance,
  order,
  type Game,
} from "../src/reform/sim.ts";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import { setBedSleeper } from "../src/reform/housing/bedPreference.ts";
import {
  inspectHousingGathering,
  gatheringPresence,
  gatheringStatus,
  startHousingGathering,
  type GatheringRequest,
} from "../src/reform/housing/gathering.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";

const people = ["アオ", "ミドリ", "アカ"].map((name, i) => ({
  ...makePersona(i, 4 + i),
  name,
}));
const ids = people.map((p) => p.id);
const [A, B, C] = ids;
const idSet = [A, B];
function morning(room: string, spacious = false) {
  const original = spacious
    ? editHouse(initialHouse(), {
        type: "move",
        id: "bench-1",
        room: "living",
        cell: 8,
      })
    : initialHouse();
  const furnished = editHouse(
    editHouse(original, {
      type: "build",
      kind: "table",
      room,
      cell: spacious ? 5 : 6,
    }),
    { type: "build", kind: "shelf", room: "bedroom", cell: 11 },
  );
  assert.ok(
    furnished.rooms
      .find((r) => r.id === room)!
      .fixtures.some((f) => f.id === "fixture-1" && f.kind === "table"),
  );
  const g = enableHousing(
    createGame(
      people,
      generateWorld(defaultWorldConfig()),
      "forest",
      furnished,
    ),
    "new",
  );
  return setBedSleeper(setHousingRoomAccess(g, "bedroom", idSet), "mat-1", A);
}
function save(game: Game) {
  return exportSlot({ id: "h7", name: "H7検証", game, origin: base });
}
const base = morning("bedroom");
const req = (roomId: string, actorIds: string[]): GatheringRequest => ({
  kind: "meal",
  roomId,
  fixtureId: "fixture-1",
  actorIds,
});
function access(g: Game) {
  const check = (kind: string, target: string) =>
    !inspectOrder(g, C, kind, target).disabled;
  const visit = (roomId: string) =>
    check("home-move", JSON.stringify({ roomId, cell: 0 }));
  return {
    bedroom: visit("bedroom"),
    yard: visit("yard"),
    shelf: check("home-use", "fixture-2"),
    assignedMat: check("home-use", "mat-1"),
  };
}
function meals(g: Game) {
  return g.actors.map((a) =>
    a.memories
      .flatMap((m) =>
        m.gathering?.kind === "meal" ? [m.gathering.peerId] : [],
      )
      .sort(),
  );
}
function run(
  label: string,
  g: Game,
  room: string,
  who: string[],
  setting?: "immediate" | "atEnd" | "invite",
) {
  const request = req(room, who);
  if (setting === "invite") request.invitation = { hostId: A, guestId: C };
  const inspect = inspectHousingGathering(g, request);
  let start = startHousingGathering(g, request);
  if (!inspect.ok) {
    assert.equal(start, g);
    return {
      label,
      accepted: false,
      reason: inspect.disabled,
      food: g.food,
      seats: inspect.capacity,
      before: access(g),
    };
  }
  const original = start;
  const approvals = {
    pre: access(g),
    post: null as ReturnType<typeof access> | null,
  };
  if (setting === "immediate")
    start = setHousingRoomAccess(start, "bedroom", idSet);
  const afterIssue = access(start);
  const policyAtIssue = start.housing!.controls.roomAccess.bedroom;
  const seats = Object.keys(start.housing!.state.reservations).length;
  function finish(s: Game) {
    for (
      let i = 0;
      i < 120 && Object.keys(s.housing!.gatherings ?? {}).length;
      i++
    )
      s = advance(s, 1);
    assert.equal(Object.keys(s.housing!.gatherings ?? {}).length, 0);
    return s;
  }
  const fork = advance(start, 1);
  const done = finish(fork);
  assert.equal(save(finish(importSlot(save(fork)).game)), save(done));
  let end = done;
  if (setting === "atEnd") end = setHousingRoomAccess(end, "bedroom", idSet);
  approvals.post = access(importSlot(save(end)).game);
  let departed: { minutes: number; access: ReturnType<typeof access> } | null =
    null;
  if (setting === "atEnd" || setting === "invite") {
    const t = JSON.stringify({ roomId: "living", cell: 0 });
    const plan = inspectOrder(end, C, "home-move", t);
    assert.equal(plan.disabled, undefined);
    const left = advance(order(end, C, "home-move", t), plan.minutes);
    assert.equal(left.actors[2].room, "living");
    departed = { minutes: left.time - end.time, access: access(left) };
  }
  return {
    label,
    accepted: true,
    departed,
    estimated: inspect.minutes,
    assignedSlots: inspect.assignments.map((a) => a.slotId),
    policyAtIssue,
    afterIssue,
    maxTrip: inspect.arrivalMinutes,
    assignedMinutes: inspect.assignments.map((a) => a.minutes),
    seats,
    ready: original.food,
    endFood: end.food,
    elapsed: done.time - g.time,
    memories: meals(done),
    arrivalRooms: done.actors.map((a) => a.room),
    policy: end.housing!.controls.roomAccess.bedroom,
    approvals,
    positions: done.actors.map(
      (a) => done.housing!.state.actors[a.person.id]?.position,
    ),
  };
}
const opened = setHousingRoomAccess(base, "bedroom", null);
const rows = [
  run("private: three", base, "bedroom", ids),
  run("private: permitted pair", base, "bedroom", idSet),
  run("open permanently: three", opened, "bedroom", ids),
  run("open/meal/close: three", opened, "bedroom", ids, "atEnd"),
  run(
    "open/meal/close before departure: three",
    opened,
    "bedroom",
    ids,
    "immediate",
  ),
  run("crowded table in common room: three", morning("living"), "living", ids),
  run(
    "table with three accessible seats in common room",
    morning("living", true),
    "living",
    ids,
  ),
];
const busy = order(opened, C, "wait");
const busyRow = run("busy co-resident under open access", busy, "bedroom", ids);
const unknown = run(
  "named regional contact as participant",
  opened,
  "bedroom",
  [A, B, base.world.landmarks[0].npc],
);
const livingBench = inspectHousingGathering(base, {
  ...req("living", ids),
  fixtureId: "bench-1",
});
const direct = inspectOrder(base, A, "talk", C);
const borrowed = importSlot(save(setBedSleeper(base, "mat-1", B))).game;
const matStatus = (g: Game) =>
  ids.map((id) => !inspectOrder(g, id, "home-use", "mat-1").disabled);
const useMat = inspectOrder(borrowed, B, "home-use", "mat-1");
assert.equal(useMat.disabled, undefined);
const scheduled = order(borrowed, B, "home-use", "mat-1");
const afterRest = advance(scheduled, useMat.minutes);
assert.equal(afterRest.actors[1].task, null);
const lending = {
  before: matStatus(base),
  afterReassignment: matStatus(borrowed),
  minutes: useMat.minutes,
  sleeperAfterRest: afterRest.housing?.bedSleepers?.["mat-1"],
};
assert.deepEqual(lending.before, [true, false, false]);
assert.deepEqual(lending.afterReassignment, [false, true, false]);
assert.equal(lending.sleeperAfterRest, B);
assert.deepEqual(
  rows.map((r) => r.accepted),
  [false, true, true, true, true, false, true],
);
assert.deepEqual(
  rows.map((r) => r.elapsed ?? null),
  [null, 25, 27, 27, 42, null, 23],
);
assert.deepEqual(
  rows.map((r) => r.endFood ?? null),
  [null, 8, 7, 7, 8, null, 7],
);
assert.deepEqual(rows[3].departed, {
  minutes: 7,
  access: { bedroom: false, yard: false, shelf: false, assignedMat: false },
});
assert.deepEqual(rows[4].memories, [[B], [A], []]);
assert.equal(unknown.accepted, false);
assert.equal(busyRow.accepted, false);
const denied = {
  bedroom: false,
  yard: false,
  shelf: false,
  assignedMat: false,
};
const invited = run(
  "one-time private table invitation",
  base,
  "bedroom",
  ids,
  "invite",
);
assert.ok(invited.accepted);
const broad = rows[2];
assert.deepEqual(invited.assignedSlots, broad.assignedSlots);
assert.deepEqual(invited.assignedMinutes, broad.assignedMinutes);
assert.deepEqual(invited.positions, broad.positions);
assert.deepEqual(invited.memories, broad.memories);
assert.equal(invited.seats, 3);
assert.equal(invited.ready, 7);
assert.equal(invited.endFood, 7);
assert.equal(invited.elapsed, 27);
assert.deepEqual(invited.policyAtIssue, idSet);
assert.deepEqual(invited.policy, idSet);
assert.deepEqual(invited.afterIssue, denied);
assert.deepEqual(invited.approvals?.post, {
  ...denied,
  bedroom: true,
  yard: true,
});
assert.deepEqual(invited.departed, rows[3].departed);
const invitation: GatheringRequest = {
  ...req("bedroom", ids),
  invitation: { hostId: A, guestId: C },
};

function withdrawn(atMinute: number) {
  let state = startHousingGathering(base, invitation);
  assert.notEqual(state, base);
  if (atMinute) state = advance(state, atMinute);
  const activity = Object.values(state.housing!.gatherings!)[0];
  const guestSeat = activity.members.find((m) => m.actorId === C)!.slotId;
  const guestBooked = (g: Game) =>
    Object.values(g.housing!.state.reservations).some(
      (r) => r.targetId === guestSeat,
    );
  assert.ok(guestBooked(state));
  function follow(g: Game) {
    let ended = order(g, A, "cancel");
    assert.equal(save(importSlot(save(ended)).game), save(ended));
    let guestReleasedAt = guestBooked(ended) ? null : ended.time;
    const first = {
      food: ended.food,
      guestTask: ended.actors[2].task?.kind ?? null,
      guestBooked: guestBooked(ended),
    };
    // Some orders cancelled in physical transit must finish their current edge.
    for (
      let i = 0;
      i < 120 && Object.keys(ended.housing!.gatherings ?? {}).length;
      i++
    ) {
      ended = advance(ended, 1);
      if (guestReleasedAt === null && !guestBooked(ended))
        guestReleasedAt = ended.time;
    }
    assert.equal(Object.keys(ended.housing!.gatherings ?? {}).length, 0);
    assert.ok(guestReleasedAt !== null);
    assert.equal(guestBooked(ended), false);
    assert.deepEqual(ended.housing!.controls.roomAccess.bedroom, idSet);
    return { ended, first, guestReleasedAt };
  }
  const result = follow(state);
  const replay = follow(importSlot(save(state)).game);
  assert.equal(save(result.ended), save(replay.ended));
  const final = result.ended;
  const recordedMemories = meals(final);
  assert.equal(Boolean(recordedMemories[2].length), atMinute >= 12);
  return {
    cancelAt: atMinute,
    atCancel: result.first,
    guestSeatReleaseMinute: result.guestReleasedAt! - base.time,
    finishedAfter: final.time - base.time,
    food: final.food,
    memories: recordedMemories,
    guestPosition: final.housing!.state.actors[C].position,
    endAccess: access(final),
    regularAccess: final.housing!.controls.roomAccess.bedroom,
  };
}

// Start the host in the far yard using a real move. The guest can now reach
// the room four minutes ahead and share time only after a second arrival.
function earlyArrival() {
  const target = JSON.stringify({ roomId: "yard", cell: 7 });
  let staged = order(order(base, B, "wait"), C, "wait");
  const walk = inspectOrder(staged, A, "home-move", target);
  assert.equal(walk.disabled, undefined);
  staged = advance(order(staged, A, "home-move", target), walk.minutes);
  staged = order(staged, C, "cancel");
  const request = { ...invitation, actorIds: [A, C] };
  const forecast = inspectHousingGathering(staged, request);
  assert.equal(forecast.ok, true, forecast.disabled);
  const hostTrip = forecast.assignments.find((a) => a.actorId === A)!.minutes;
  const guestTrip = forecast.assignments.find((a) => a.actorId === C)!.minutes;
  assert.deepEqual([guestTrip, hostTrip], [5, 9]);
  const start = startHousingGathering(staged, request);
  const waiting = advance(start, guestTrip);
  assert.deepEqual(gatheringPresence(waiting, C), [C]);
  assert.equal(gatheringStatus(waiting, C)?.usedMinutes, 0);
  assert.deepEqual(meals(waiting), [[], [], []]);
  const origin = importSlot(save(waiting)).game;
  const duration = forecast.minutes!;
  const finish = advance(waiting, duration - guestTrip);
  assert.equal(save(advance(origin, duration - guestTrip)), save(finish));
  assert.deepEqual(meals(finish), [[C], [], [A]]);
  assert.equal(finish.time - staged.time, 29);
  const cancelled = order(waiting, A, "cancel");
  let closed = cancelled;
  for (
    let k = 0;
    k < 120 && Object.keys(closed.housing!.gatherings ?? {}).length;
    k++
  )
    closed = advance(closed, 1);
  assert.equal(Object.keys(closed.housing!.gatherings ?? {}).length, 0);
  assert.deepEqual(meals(closed), [[], [], []]);
  assert.equal(closed.food, staged.food);
  assert.equal(closed.time - staged.time, 7);
  assert.deepEqual(closed.housing!.controls.roomAccess.bedroom, idSet);
  return {
    setupWalk: walk.minutes,
    guestTrip,
    hostTrip,
    guestOnlyMinutes: hostTrip - guestTrip,
    whenGuestArrived: {
      position: waiting.housing!.state.actors[C].position,
      used: gatheringStatus(waiting, C)!.usedMinutes,
      memories: meals(waiting),
    },
    finishedAfter: finish.time - staged.time,
    memories: meals(finish),
    withdrawnBeforeArrival: {
      closedAfter: closed.time - staged.time,
      food: closed.food,
      memories: meals(closed),
      guestPosition: closed.housing!.state.actors[C].position,
      access: access(closed),
    },
  };
}

const withdrawals = [0, 2, 12].map(withdrawn);
assert.deepEqual(
  withdrawals.map(({ guestSeatReleaseMinute, food }) => [
    guestSeatReleaseMinute,
    food,
  ]),
  [
    [0, 9],
    [3, 9],
    [12, 7],
  ],
);
const busyInvitation = inspectHousingGathering(
  order(base, C, "wait"),
  invitation,
);
assert.equal(busyInvitation.ok, false);
console.log(
  JSON.stringify(
    {
      referenceBeforeInvitation: "56c97a6181d0c779354b029475153584ca4293bc",
      people: ids,
      start: base.time,
      startFood: base.food,
      rows,
      invited,
      withdrawals,
      earlyArrival: earlyArrival(),
      busyInvitation: busyInvitation.disabled,
      busyRow,
      unknown,
      livingBench,
      lending,
      direct: { allowed: !direct.disabled, minutes: direct.minutes },
    },
    null,
    2,
  ),
);
