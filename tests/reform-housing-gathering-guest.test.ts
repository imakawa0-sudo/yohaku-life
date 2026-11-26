import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import {
  gatheringPresence,
  inspectHousingGathering,
  inspectStartReadyGathering,
  startReadyGathering,
  startHousingGathering,
  type GatheringRequest,
} from "../src/reform/housing/gathering";
import {
  housingLinkId,
  housingPoint,
  housingSlotId,
} from "../src/reform/housing/topology";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [host, guest, other] = people.map((p) => p.id);
const roomId = "bedroom";
const fixtureId = "fixture-1";
const link = housingLinkId("living", roomId);
const gatheringId = "gathering-1";
const invitation = { hostId: host, guestId: guest };
function request(
  kind: "talk" | "meal" = "talk",
  actorIds = [host, guest],
): GatheringRequest {
  return { kind, roomId, fixtureId, actorIds, invitation };
}
function home() {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: roomId,
    kind: "table",
    cell: 5,
  });
  const game = enableHousing(
    createGame(people, generateWorld(defaultWorldConfig()), "village", house),
    "new",
  );
  const dest = JSON.stringify({ roomId, cell: 1 });
  const walk = inspectOrder(game, host, "home-move", dest).minutes!;
  const occupied = order(
    order(game, guest, "work", "care"),
    other,
    "work",
    "care",
  );
  const atVenue = advance(order(occupied, host, "home-move", dest), walk);
  const free = order(order(atVenue, guest, "cancel"), other, "cancel");
  return setHousingRoomAccess(free, roomId, [host]);
}
function group(game: Game) {
  return game.housing!.gatherings?.[gatheringId];
}
function member(game: Game, id: string) {
  return group(game)?.members.find((m) => m.actorId === id);
}
function seated(game: Game, req = request()) {
  const preview = inspectHousingGathering(game, req);
  assert.ok(preview.ok, preview.disabled);
  let active = startHousingGathering(game, req);
  for (let i = 0; i < 25 && group(active)?.startedAt === null; i++)
    active = advance(active, 1);
  assert.equal(group(active)?.startedAt, active.time);
  return active;
}

test("one invitation admits exactly its guest to the reserved seat and produces social time only once the residents are physically present", () => {
  const origin = home();
  const before = JSON.stringify(origin);
  const req = request();
  const preview = inspectHousingGathering(origin, req);
  assert.ok(preview.ok, preview.disabled);
  assert.equal(JSON.stringify(origin), before);
  const usual = { ...req };
  delete usual.invitation;
  assert.equal(inspectHousingGathering(origin, usual).ok, false);
  const meal = order(origin, other, "home-use", "hearth-1");
  const started = startHousingGathering(meal, req);
  assert.equal(started.time, meal.time);
  assert.deepEqual(
    started.housing!.controls.roomAccess,
    meal.housing!.controls.roomAccess,
  );
  assert.deepEqual(started.actors[2].task, meal.actors[2].task);
  assert.equal(
    started.actors[2].task?.station,
    housingSlotId("living", "hearth-1", 0),
  );
  assert.equal(started.housing!.state.actors[guest].position.kind, "at");
  let current = started;
  for (let i = 0; i < 25 && group(current)?.startedAt === null; i++) {
    for (const who of [host, guest])
      assert.equal(member(current, who)?.usedMinutes, 0);
    assert.deepEqual(group(current)?.pairs, []);
    current = advance(current, 1);
  }
  assert.equal(group(current)?.startedAt, current.time);
  assert.deepEqual(
    gatheringPresence(current, guest).sort(),
    [host, guest].sort(),
  );
  for (const who of [host, guest])
    assert.equal(member(current, who)?.usedMinutes, 0);
  const actual = advance(current, 1);
  assert.equal(member(actual, guest)?.togetherMinutes, 1);
  assert.equal(member(actual, host)?.togetherMinutes, 1);
  assert.equal(group(actual)?.pairs[0].minutes, 1);
  assert.equal(actual.actors[1].room, roomId);
  for (const who of [guest, other]) {
    assert.ok(inspectOrder(actual, who, "home-use", "mat-1").disabled);
    assert.deepEqual(
      order(actual, who, "home-use", "mat-1").actors,
      actual.actors,
    );
  }
  assert.equal(JSON.stringify(origin), before);
});

test("unauthorized roles, a closed route or a second uninvited guest reject the full meal without allocating seats or food", () => {
  const origin = home();
  const req = request("meal");
  const farTable = applyHousingHouseEdit(
    origin,
    editHouse(origin.house, {
      type: "move",
      id: fixtureId,
      room: "yard",
      cell: 6,
    }),
  );
  assert.equal(farTable.error, undefined);
  const behindPrivateRoom = setHousingRoomAccess(farTable.game, "yard", [host]);
  const invalid: [Game, GatheringRequest][] = [
    [behindPrivateRoom, { ...req, roomId: "yard" }],
    [setHousingPassage(origin, "link", link, false), req],
    [setHousingRoomAccess(origin, roomId, [other]), req],
    [origin, request("meal", [host, guest, other])],
    [origin, { ...req, invitation: { hostId: host, guestId: host } }],
    [origin, { ...req, invitation: { hostId: "missing", guestId: guest } }],
    [origin, { ...req, invitation: { hostId: host, guestId: other } }],
    [origin, { ...req, invitation: { hostId: guest, guestId: host } }],
  ];
  for (const [game, invalidRequest] of invalid) {
    const before = JSON.stringify(game);
    assert.equal(inspectHousingGathering(game, invalidRequest).ok, false);
    assert.equal(startHousingGathering(game, invalidRequest), game);
    assert.equal(JSON.stringify(game), before);
  }
});

test("an impassable route holds the party until reopening, or refunds a meal for a guest still outside at the deadline", () => {
  const origin = order(home(), other, "work", "care:hard");
  const req = request("meal");
  const started = startHousingGathering(origin, req);
  assert.equal(started.food, origin.food - 2);
  const closed = setHousingPassage(started, "link", link, false);
  const held = advance(closed, 3);
  assert.equal(group(held)?.startedAt, null);
  assert.equal(member(held, guest)?.usedMinutes, 0);
  assert.equal(held.actors[1].room, "living");
  const opened = setHousingPassage(held, "link", link, true);
  let resumed = opened;
  for (let i = 0; i < 25 && !member(resumed, guest)?.usedMinutes; i++)
    resumed = advance(resumed, 1);
  assert.equal(member(resumed, guest)?.usedMinutes, 1);
  assert.equal(resumed.food, origin.food - 2);

  const expired = advance(held, group(held)!.deadline - held.time);
  assert.equal(group(expired)?.invitation, undefined);
  assert.equal(member(expired, guest)?.status, "left");
  assert.equal(expired.actors[1].task, null);
  assert.equal(expired.food, origin.food - 1);
  assert.deepEqual(expired.housing!.controls.roomAccess[roomId], [host]);
});

test("once a private meeting ends, its guest can walk out but cannot book the bed or return uninvited", () => {
  const origin = order(home(), other, "work", "care:hard");
  const atTable = seated(origin);
  const finished = advance(atTable, 20);
  assert.equal(group(finished), undefined);
  assert.equal(finished.actors[1].room, roomId);
  assert.ok(inspectOrder(finished, guest, "home-use", "mat-1").disabled);
  const leave = JSON.stringify({ roomId: "living", cell: 0 });
  const egress = inspectOrder(finished, guest, "home-move", leave);
  assert.equal(egress.disabled, undefined);
  const outside = advance(
    order(finished, guest, "home-move", leave),
    egress.minutes!,
  );
  assert.equal(outside.actors[1].room, "living");
  assert.ok(
    inspectOrder(
      outside,
      guest,
      "home-move",
      JSON.stringify({ roomId, cell: 1 }),
    ).disabled,
  );
});

test("ordinary room membership replaces the invitation without stopping the gathering; revoking the host's rights drops the guest", () => {
  const origin = order(home(), other, "work", "care:hard");
  const req = request("meal");
  const waiting = startHousingGathering(origin, req);
  for (const rights of [[host, guest], null]) {
    const granted = setHousingRoomAccess(waiting, roomId, rights);
    assert.equal(group(granted)?.invitation, undefined);
    assert.equal(granted.actors[0].task?.kind, "home-gather");
    assert.equal(granted.actors[1].task?.kind, "home-gather");
    const continuing = advance(granted, 10);
    assert.ok((member(continuing, guest)?.usedMinutes ?? 0) > 0);
    assert.ok((member(continuing, host)?.usedMinutes ?? 0) > 0);
    assert.equal(continuing.food, origin.food - 2);
  }
  const revoked = setHousingRoomAccess(waiting, roomId, [other]);
  assert.equal(group(revoked)?.invitation, undefined);
  assert.notEqual(revoked.actors[1].task?.kind, "home-gather");
  assert.equal(revoked.housing!.state.actors[guest].position.kind, "at");
  assert.deepEqual(revoked.housing!.controls.roomAccess[roomId], [other]);
});

test("the host leaving withdraws the invited guest while a third authorized diner continues its own portion", () => {
  const origin = setHousingRoomAccess(home(), roomId, [host, other]);
  const atTable = seated(origin, request("meal", [host, guest, other]));
  const first = advance(atTable, 1);
  assert.equal(first.food, origin.food - 3);
  assert.equal(member(first, other)?.usedMinutes, 1);
  const stopped = order(first, host, "cancel");
  assert.equal(group(stopped)?.invitation, undefined);
  assert.equal(stopped.actors[0].task, null);
  assert.equal(stopped.actors[1].task, null);
  assert.equal(stopped.actors[2].task?.kind, "home-gather");
  assert.equal(stopped.food, origin.food - 3);
  const continued = advance(stopped, 1);
  assert.equal(member(continued, other)?.usedMinutes, 2);
  assert.equal(member(continued, other)?.togetherMinutes, 1);
  assert.deepEqual(
    continued.housing!.controls.roomAccess[roomId],
    [host, other].sort(),
  );
});

test("an invited guest can arrive before the host and waits at its seat without gaining joint minutes or spending the reserved meal", () => {
  const prep = order(
    order(home(), guest, "work", "care:hard"),
    other,
    "work",
    "care:hard",
  );
  const farAway = JSON.stringify({ roomId: "yard", cell: 10 });
  const walk = inspectOrder(prep, host, "home-move", farAway);
  assert.equal(walk.disabled, undefined);
  const far = order(
    advance(order(prep, host, "home-move", farAway), walk.minutes!),
    guest,
    "cancel",
  );
  const origin = setHousingRoomAccess(far, roomId, [host]);
  const req = request("meal");
  const preview = inspectHousingGathering(origin, req);
  assert.ok(preview.ok, preview.disabled);
  const assignments = preview.assignments;
  const guestMinutes = assignments.find((m) => m.actorId === guest)!.minutes;
  const hostMinutes = assignments.find((m) => m.actorId === host)!.minutes;
  assert.ok(guestMinutes < hostMinutes);
  const early = advance(startHousingGathering(origin, req), guestMinutes);
  assert.equal(group(early)?.startedAt, null);
  assert.equal(early.actors[1].room, roomId);
  assert.deepEqual(gatheringPresence(early, guest), [guest]);
  assert.equal(member(early, guest)?.usedMinutes, 0);
  assert.equal(member(early, guest)?.togetherMinutes, 0);
  assert.deepEqual(early.actors[1].task?.reserved, { food: 1 });
  assert.ok(early.actors[1].memories.every((m) => !m.gathering));
  const ability = inspectStartReadyGathering(early, gatheringId);
  const advanced = startReadyGathering(early, gatheringId);
  assert.equal(ability.ok, false);
  assert.equal(advanced, early);
  const joined = advance(early, hostMinutes - guestMinutes + 1);
  assert.equal(member(joined, guest)?.togetherMinutes, 1);
  assert.equal(member(joined, host)?.togetherMinutes, 1);
});

test("cancelling while the guest is crossing admits only safe exit, then returns the unused portion once", () => {
  const prep = order(home(), other, "work", "care:hard");
  const active = startHousingGathering(prep, request("meal"));
  const crossing = advance(active, 1);
  const position = crossing.housing!.state.actors[guest].position;
  assert.equal(position.kind, "transit");
  const cancelled = order(crossing, guest, "cancel");
  assert.equal(group(cancelled)?.invitation, undefined);
  assert.equal(cancelled.food, prep.food - 2);
  assert.equal(
    cancelled.housing!.state.actors[guest].order?.phase,
    "exiting-after-cancel",
  );
  assert.deepEqual(cancelled.housing!.state.actors[guest].position, position);
  let safe = cancelled;
  for (let i = 0; i < 4 && safe.actors[1].task; i++) safe = advance(safe, 1);
  assert.equal(safe.actors[1].task, null);
  assert.equal(safe.actors[1].room, roomId);
  assert.equal(safe.food, prep.food - 1);
  assert.equal(order(safe, guest, "cancel").food, safe.food);
  assert.ok(inspectOrder(safe, guest, "home-use", "mat-1").disabled);
});
