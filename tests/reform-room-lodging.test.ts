import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import { setBedSleeper } from "../src/reform/housing/bedPreference";
import {
  inspectHousingGathering,
  startHousingGathering,
} from "../src/reform/housing/gathering";
import {
  acceptLodging,
  declineLodging,
  endLodging,
  offerLodging,
  setLodgingReturn,
  withdrawLodgingOffer,
} from "../src/reform/housing/lodging";
import {
  housingLinkId,
  housingPoint,
  housingSlotId,
} from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [a, b, c] = people.map((p) => p.id);
const room = "bedroom";
const table = "fixture-1";
const link = housingLinkId("living", room);
const dest = (roomId: string, cell = 0) => JSON.stringify({ roomId, cell });
const at = (g: Game, roomId: string, cell = 0) =>
  assert.deepEqual(g.housing!.state.actors[b].position, {
    kind: "at",
    point: housingPoint(roomId, cell),
  });
const allowed = (g: Game) => g.housing!.controls.roomAccess[room];
function home() {
  const house = editHouse(initialHouse(), {
    type: "build",
    room,
    kind: "table",
    cell: 5,
  });
  const origin = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  const game = setHousingRoomAccess(enableHousing(origin, "new"), room, [a]);
  return { origin, game };
}
function ok(result: { game: Game; error?: string }) {
  assert.equal(result.error, undefined);
  return result.game;
}
function refuses(result: { game: Game; error?: string }, before: Game) {
  assert.ok(result.error);
  assert.equal(result.game, before);
}
function offered(g: Game) {
  return ok(offerLodging(g, a, b, room));
}
function occupied(g: Game) {
  return advance(ok(acceptLodging(offered(g), b)), 3);
}
function trip(g: Game, action: string, target?: string) {
  const p = inspectOrder(g, b, action, target);
  assert.equal(p.disabled, undefined);
  assert.ok(p.minutes);
  return advance(order(g, b, action, target), p.minutes!);
}
function read(g: Game, origin: Game) {
  assert.ok(
    isGame(g),
    `invalid save at ${g.time}, phase ${g.housing?.lodging?.phase}`,
  );
  const slot = importSlot(
    exportSlot({ id: "boarding", name: "間借り", origin, game: g }),
  );
  assert.deepEqual(slot.game, JSON.parse(JSON.stringify(g)));
  return slot.game;
}

test("a provider's unsigned offer cannot move an idle or busy housemate or grant room use; only the intended resident can accept or decline", () => {
  const { game, origin } = home();
  const waiting = order(game, b, "work", "care:hard");
  const offer = offered(waiting);
  assert.deepEqual(offer.actors, waiting.actors);
  assert.equal(offer.time, waiting.time);
  assert.deepEqual(allowed(offer), [a]);
  assert.ok(inspectOrder(offer, b, "home-use", "mat-1").disabled);
  refuses(acceptLodging(offer, b), offer);
  refuses(acceptLodging(offer, c), offer);
  refuses(withdrawLodgingOffer(offer, b), offer);
  refuses(declineLodging(offer, a), offer);
  const declined = ok(declineLodging(read(offer, origin), b));
  assert.equal(declined.housing!.lodging, undefined);
  assert.deepEqual(declined.actors, waiting.actors);
  const withdrawn = ok(withdrawLodgingOffer(offer, a));
  assert.equal(withdrawn.housing!.lodging, undefined);
  const afterPolicyEdit = setHousingRoomAccess(offer, room, [c]);
  assert.equal(afterPolicyEdit.housing!.lodging, undefined);
  for (const [provider, resident, venue] of [
    [b, c, room],
    [a, a, room],
    [a, "missing", room],
    [a, b, "living"],
    [a, b, "yard"],
    [a, b, "missing"],
  ]) {
    refuses(offerLodging(game, provider, resident, venue), game);
  }
  refuses(offerLodging(offer, a, c, room), offer);
  assert.equal(read(origin, origin).housing, undefined);
});

test("admission and departure walk through real doors; private bed rules, other rooms and the base access list stay intact", () => {
  const { origin, game } = home();
  const restricted = setHousingRoomAccess(
    setBedSleeper(game, "mat-1", c),
    "yard",
    [a],
  );
  const before = offered(restricted);
  const arriving = ok(acceptLodging(before, b));
  assert.equal(arriving.time, before.time);
  at(arriving, "living");
  assert.equal(arriving.housing!.lodging?.phase, "arriving");
  const otherFloor = dest(room, 1);
  assert.ok(inspectOrder(arriving, b, "home-move", otherFloor).disabled);
  const denied = order(arriving, b, "home-move", otherFloor);
  assert.deepEqual(denied.housing, arriving.housing);
  assert.deepEqual(denied.actors, arriving.actors);
  assert.equal(
    arriving.housing!.state.slots[
      housingSlotId(room, "mat-1", 0)
    ].allowedActorIds?.includes(b),
    false,
  );
  const mid = advance(read(arriving, origin), 1);
  assert.equal(mid.housing!.state.actors[b].position.kind, "transit");
  const arrived = advance(read(mid, origin), 2);
  at(arrived, room);
  assert.equal(arrived.housing!.lodging?.phase, "occupied");
  assert.equal(arrived.actors[1].task, null);
  assert.deepEqual(allowed(arrived), [a]);
  assert.equal(inspectOrder(arrived, b, "home-use", table).disabled, undefined);
  assert.ok(inspectOrder(arrived, c, "home-use", table).disabled);
  assert.match(
    inspectOrder(arrived, b, "home-use", "mat-1").disabled ?? "",
    /専用/,
  );
  assert.ok(inspectOrder(arrived, b, "home-move", dest("yard")).disabled);
  const revoked = setHousingRoomAccess(arrived, room, []);
  assert.equal(revoked.housing!.lodging?.phase, "occupied");
  assert.deepEqual(allowed(revoked), []);
  assert.equal(inspectOrder(revoked, b, "home-use", table).disabled, undefined);
  const leaving = ok(endLodging(read(revoked, origin), b));
  assert.equal(leaving.housing!.lodging?.phase, "leaving");
  at(leaving, room);
  assert.equal(
    leaving.housing!.state.slots[
      housingSlotId(room, table, 0)
    ].allowedActorIds?.includes(b),
    false,
  );
  const onWay = advance(leaving, 1);
  assert.equal(onWay.housing!.state.actors[b].position.kind, "transit");
  const done = advance(read(onWay, origin), 2);
  at(done, "living");
  assert.equal(done.housing!.lodging, undefined);
  assert.ok(inspectOrder(done, b, "home-move", dest(room)).disabled);
  assert.deepEqual(allowed(done), []);
  assert.deepEqual(done.housing!.bedSleepers, restricted.housing!.bedSleepers);
  read(done, origin);
});

test("barred routes, interrupted crossings and revoked offers preserve location and omit an unearned occupancy grant", () => {
  const { game, origin } = home();
  const offer = offered(game);
  const closed = setHousingPassage(offer, "link", link, false);
  refuses(acceptLodging(closed, b), closed);
  const moving = ok(acceptLodging(offer, b));
  const waiting = advance(setHousingPassage(moving, "link", link, false), 5);
  at(waiting, "living");
  assert.equal(waiting.housing!.state.actors[b].order?.phase, "waiting");
  assert.equal(waiting.housing!.lodging?.phase, "arriving");
  const stopped = order(read(waiting, origin), b, "cancel");
  assert.equal(stopped.housing!.lodging, undefined);
  assert.ok(inspectOrder(stopped, b, "home-use", table).disabled);
  const continued = setHousingPassage(waiting, "link", link, true);
  const mid = advance(continued, 1);
  const cancel = order(mid, b, "cancel");
  assert.equal(
    cancel.housing!.state.actors[b].order?.phase,
    "exiting-after-cancel",
  );
  const end = advance(read(cancel, origin), 2);
  at(end, room);
  assert.equal(end.housing!.lodging, undefined);
  assert.ok(inspectOrder(end, b, "home-use", table).disabled);
  assert.equal(
    inspectOrder(end, b, "home-move", dest("living")).disabled,
    undefined,
  );
  const arrived = advance(continued, 3);
  const lockedIn = setHousingPassage(arrived, "link", link, false);
  refuses(endLodging(lockedIn, b), lockedIn);
  const leaving = ok(endLodging(arrived, b));
  const returning = order(advance(leaving, 1), b, "cancel");
  const restored = advance(read(returning, origin), 2);
  at(restored, "living");
  assert.equal(restored.housing!.lodging?.phase, "occupied");
  assert.equal(
    inspectOrder(restored, b, "home-use", table).disabled,
    undefined,
  );
});

test("a tenant uses the private table, can host one guest there, and leaves the permanent member list and the guest's other fixture rights intact", () => {
  const { game, origin } = home();
  const lease = occupied(order(order(game, a, "recover"), c, "recover"));
  const idle = order(order(lease, a, "cancel"), c, "cancel");
  const request = {
    actorIds: [a, b],
    fixtureId: table,
    roomId: room,
    kind: "talk" as const,
  };
  assert.ok(inspectHousingGathering(idle, request).ok);
  refuses(offerLodging(idle, b, c, room), idle);
  const privateTalk = { ...request, actorIds: [b, c] };
  assert.equal(inspectHousingGathering(idle, privateTalk).ok, false);
  // B already has access as the tenant and has no use for A's guest privilege.
  assert.equal(
    inspectHousingGathering(idle, {
      ...request,
      invitation: { hostId: a, guestId: b },
    }).ok,
    false,
  );
  const invited = { ...privateTalk, invitation: { hostId: b, guestId: c } };
  const group = startHousingGathering(idle, invited);
  assert.notEqual(group, idle);
  assert.deepEqual(allowed(group), [a]);
  assert.ok(inspectOrder(group, c, "home-use", "mat-1").disabled);
  const inUse = advance(group, 8);
  assert.equal(inUse.housing!.lodging?.phase, "occupied");
  assert.ok(inUse.housing!.gatherings!["gathering-1"].pairs[0].minutes > 0);
  refuses(endLodging(inUse, b), inUse);
  assert.deepEqual(advance(read(inUse, origin), 5), advance(inUse, 5));
  const providerExcluded = setHousingRoomAccess(inUse, room, []);
  assert.deepEqual(
    providerExcluded.housing!.gatherings!["gathering-1"].invitation,
    { hostId: b, guestId: c },
  );
  read(providerExcluded, origin);
  const guestAuthorized = setHousingRoomAccess(providerExcluded, room, [c]);
  assert.equal(
    guestAuthorized.housing!.gatherings!["gathering-1"].invitation,
    undefined,
  );
  assert.equal(guestAuthorized.actors[2].task?.kind, "home-gather");
  read(guestAuthorized, origin);
  const stopped = order(inUse, b, "cancel");
  assert.equal(stopped.housing!.gatherings!["gathering-1"], undefined);
  assert.ok(inspectOrder(stopped, c, "home-use", table).disabled);
  const vacated = advance(
    ok(endLodging(stopped, b)),
    inspectOrder(stopped, b, "home-move", dest("living")).minutes!,
  );
  assert.equal(vacated.housing!.lodging, undefined);
  assert.ok(inspectOrder(vacated, b, "home-use", table).disabled);
  assert.ok(inspectOrder(vacated, c, "home-use", table).disabled);
  assert.deepEqual(allowed(vacated), [a]);
  read(vacated, origin);
});

test("normal regional homecoming returns cargo once at the common entrance before any optional walk; a blocked route leaves the tenant there", () => {
  const { game, origin } = home();
  const lease = occupied(order(order(game, a, "recover"), c, "recover"));
  const coins = lease.coins;
  const packed = trip(lease, "pack", "coins");
  assert.equal(packed.actors[1].cargo.coins, 4);
  const away = trip(packed, "travel", "landing");
  assert.equal(away.housing!.lodging?.phase, "occupied");
  assert.equal(away.actors[1].location, "landing");
  const entrance = trip(read(away, origin), "return");
  at(entrance, "living");
  assert.equal(entrance.actors[1].task, null);
  assert.equal(entrance.coins, coins);
  assert.equal(entrance.actors[1].cargo.coins, 0);
  const preference = ok(setLodgingReturn(away, b, "room"));
  const returning = trip(preference, "travel", game.home);
  at(returning, "living");
  assert.equal(returning.coins, coins);
  assert.equal(returning.actors[1].cargo.coins, 0);
  assert.equal(returning.actors[1].task?.kind, "home-move");
  assert.equal(returning.actors[1].task?.mode, "auto");
  const finish = advance(read(returning, origin), 3);
  at(finish, room);
  assert.equal(finish.coins, coins);
  const blocked = trip(
    setHousingPassage(preference, "link", link, false),
    "return",
  );
  at(blocked, "living");
  assert.equal(blocked.coins, coins);
  assert.equal(blocked.actors[1].cargo.coins, 0);
  assert.equal(blocked.actors[1].task, null);
  assert.equal(blocked.housing!.lodging?.phase, "occupied");
  read(blocked, origin);
});

test("slot validation rejects forged parties, phase, route binding and extra access in both current and origin while unmodified legacy saves still load", () => {
  const { origin, game } = home();
  const offer = offered(game);
  const moving = ok(acceptLodging(offer, b));
  const active = advance(moving, 3);
  const departing = ok(endLodging(active, b));
  for (const valid of [game, offer, moving, active, departing]) {
    const loaded = read(valid, origin);
    assert.deepEqual(advance(loaded, 4), advance(valid, 4));
  }
  function rejected(sample: Game, corrupt: (g: Game) => unknown) {
    const bad = structuredClone(sample);
    corrupt(bad);
    assert.equal(isGame(bad), false, String(corrupt));
    for (const slot of [
      { game: bad, origin },
      { game, origin: bad },
    ]) {
      assert.throws(() =>
        importSlot(exportSlot({ ...slot, id: "bad", name: "破損した入居" })),
      );
    }
  }
  for (const value of [null, []])
    rejected(offer, (g) => Object.assign(g.housing!, { lodging: value }));
  for (const fields of [
    { providerId: b },
    { providerId: c },
    { residentId: "missing" },
    { roomId: "living" },
    { roomId: "yard" },
    { roomId: "none" },
    { version: 2 },
    { returnTo: "room" },
    { orderId: "order-1" },
    { phase: "occupied" },
    { accepted: true },
  ])
    rejected(offer, (g) => Object.assign(g.housing!.lodging!, fields));
  for (const fields of [
    { orderId: "order-999" },
    { phase: "leaving" },
    { returnTo: "room" },
  ]) {
    rejected(moving, (g) => Object.assign(g.housing!.lodging!, fields));
  }
  for (const fields of [
    { mode: "auto" },
    { metric: "care" },
    { remaining: 1 },
    { reserved: { food: 1 } },
    { target: dest("living") },
  ]) {
    rejected(moving, (g) => Object.assign(g.actors[1].task!, fields));
  }
  rejected(moving, (g) => delete g.housing!.lodging!.orderId);
  rejected(moving, (g) =>
    Object.assign(g.actors[1].task!.spatial!, { mealPartners: { [c]: 1 } }),
  );
  rejected(active, (g) => delete g.housing!.lodging);
  rejected(active, (g) => delete g.housing!.controls.roomAccess[room]);
  for (const fields of [{ orderId: "order-1" }, { returnTo: "bed" }])
    rejected(active, (g) => Object.assign(g.housing!.lodging!, fields));
  rejected(active, (g) =>
    Object.assign(g.housing!.state.slots[housingSlotId(room, table, 0)], {
      allowedActorIds: [a, b, c],
    }),
  );
  rejected(departing, (g) =>
    Object.assign(g.housing!.lodging!, { phase: "arriving" }),
  );
});

test("an unknown location or severe injury cannot start a new walk; actual presence at the door allows immediate occupancy and an absent tenant can release the room", () => {
  const { origin, game } = home();
  const old = offered(
    setHousingRoomAccess(enableHousing(origin, "legacy"), room, [a]),
  );
  refuses(acceptLodging(old, b), old);
  const unable = offered(game);
  unable.actors[1].injury = 70;
  refuses(acceptLodging(unable, b), unable);
  const walk = trip(
    setHousingRoomAccess(game, room, [a, b]),
    "home-move",
    dest(room),
  );
  const signed = ok(
    acceptLodging(offered(setHousingRoomAccess(walk, room, [a])), b),
  );
  at(signed, room);
  assert.equal(signed.time, walk.time);
  assert.equal(signed.housing!.lodging?.phase, "occupied");
  assert.equal(signed.actors[1].task, null);
  const away = trip(signed, "travel", "landing");
  const ended = ok(endLodging(away, b));
  assert.equal(ended.housing!.lodging, undefined);
  assert.equal(ended.actors[1].location, "landing");
  assert.equal(ended.time, away.time);
  read(ended, origin);
  const pref = ok(setLodgingReturn(away, b, "room"));
  const minutes = inspectOrder(pref, b, "return").minutes!;
  const homeward = order(pref, b, "return");
  homeward.actors[1].injury = 70;
  const safe = advance(read(homeward, origin), minutes);
  at(safe, "living");
  assert.equal(safe.actors[1].task, null);
  assert.equal(safe.housing!.lodging?.returnTo, "room");
});
