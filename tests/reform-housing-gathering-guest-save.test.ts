import assert from "node:assert/strict";
import test from "node:test";
import { initialHouse } from "../src/reform/house";
import {
  inspectHousingGathering,
  startHousingGathering,
} from "../src/reform/housing/gathering";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
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

const [hostId, guestId, thirdId] = ["person-1", "person-2", "person-3"];
const invitation = { hostId, guestId };
const roomId = "living";
const fixtureId = "bench-1";

function originHome() {
  const house = initialHouse();
  house.rooms[0].fixtures.find((f) => f.id === fixtureId)!.kind = "table";
  return createGame(
    [hostId, guestId, thirdId].map((_, i) => makePersona(i, 23 + i)),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}
function setup(thirdParticipant = false) {
  const origin = originHome();
  const base = enableHousing(origin, "new");
  base.actors[1].room = "bedroom";
  base.housing!.state.actors[guestId].position = {
    kind: "at",
    point: housingPoint("bedroom", 0),
  };
  const restricted = setHousingRoomAccess(base, roomId, [hostId, thirdId]);
  const request = {
    kind: "meal" as const,
    roomId,
    fixtureId,
    actorIds: thirdParticipant ? [hostId, guestId, thirdId] : [hostId, guestId],
    invitation,
  };
  const preview = inspectHousingGathering(restricted, request);
  assert.equal(preview.ok, true, preview.disabled);
  const game = startHousingGathering(restricted, request);
  assert.deepEqual(group(game).invitation, invitation);
  return { origin, game, arrival: preview.arrivalMinutes! };
}
function group(game: Game) {
  return game.housing!.gatherings!["gathering-1"];
}
function reload(game: Game, origin: Game) {
  assert.ok(isGame(game), `expected a valid save at minute ${game.time}`);
  const slot = { id: "house", name: "招いた食卓", game, origin };
  const imported = importSlot(exportSlot(slot));
  assert.deepEqual(imported.game, JSON.parse(JSON.stringify(game)));
  assert.deepEqual(imported.origin, JSON.parse(JSON.stringify(origin)));
  return imported.game;
}

test("invited meal resumes with the same seats, food and shared minutes through the doorway, closed link, active use and completion", () => {
  const { origin, game, arrival } = setup();
  const link = housingLinkId("living", "bedroom");
  const closed = advance(setHousingPassage(game, "link", link, false), 6);
  assert.equal(closed.housing!.state.actors[guestId].order?.phase, "waiting");
  assert.equal(group(closed).startedAt, null);
  const opened = setHousingPassage(closed, "link", link, true);
  const walk = advance(opened, 1);
  assert.equal(walk.housing!.state.actors[guestId].position.kind, "transit");
  const seated = advance(opened, arrival);
  assert.equal(group(seated).startedAt, seated.time);
  const used = advance(seated, 5);
  assert.deepEqual(group(used).pairs, [
    { actorIds: [hostId, guestId], minutes: 5 },
  ]);
  const finished = advance(seated, 20);
  assert.equal(group(finished), undefined);
  for (const state of [game, closed, walk, seated, used, finished]) {
    const loaded = reload(state, origin);
    assert.deepEqual(advance(loaded, 9), advance(state, 9));
    assert.deepEqual(loaded.housing!.controls.roomAccess[roomId], [
      hostId,
      thirdId,
    ]);
  }
  const resumed = advance(
    setHousingPassage(reload(closed, origin), "link", link, true),
    arrival + 20,
  );
  assert.deepEqual(resumed, finished);
});

test("invitation-free legacy and authorized meal saves remain readable, including a partially withdrawn guest", () => {
  const { origin, game } = setup();
  const publicGame = setHousingRoomAccess(game, roomId, null);
  assert.ok(!Object.hasOwn(group(publicGame), "invitation"));
  assert.deepEqual(
    advance(reload(publicGame, origin), 10),
    advance(publicGame, 10),
  );
  const cancelled = order(advance(game, 1), hostId, "cancel");
  assert.ok(!Object.hasOwn(group(cancelled), "invitation"));
  assert.equal(
    group(cancelled).members.find((m) => m.actorId === guestId)?.status,
    "withdrawing",
  );
  const exited = advance(reload(cancelled, origin), 2);
  assert.equal(group(exited), undefined);
  assert.deepEqual(exited, advance(cancelled, 2));
  assert.equal(exited.food, origin.food);
  assert.equal(reload(origin, origin).housing, undefined);
});

test("import rejects forged invitations and access granted beyond the guest's own gathering seat", () => {
  const { origin, game } = setup();
  function refused(broken: Game) {
    for (const slot of [
      { game: broken, origin },
      { game: origin, origin: broken },
    ]) {
      assert.equal(isGame(broken), false);
      assert.throws(() =>
        importSlot(exportSlot({ ...slot, id: "bad", name: "招待" })),
      );
    }
  }
  for (const invalid of [
    null,
    0,
    [],
    {},
    { hostId },
    { guestId },
    { hostId, guestId, permanent: true },
    { hostId, guestId: hostId },
    { hostId: guestId, guestId: hostId },
    { hostId: thirdId, guestId },
    { hostId, guestId: thirdId },
    { hostId: ["person-1"], guestId },
    { hostId, guestId: "unknown" },
  ]) {
    const forged = structuredClone(game);
    Object.assign(group(forged), { invitation: invalid });
    refused(forged);
  }
  const changed: ((g: Game) => void)[] = [
    (g) => {
      delete group(g).invitation;
    },
    (g) => {
      g.housing!.controls.roomAccess[roomId] = [hostId, guestId, thirdId];
    },
    (g) => {
      g.housing!.controls.roomAccess[roomId] = [thirdId];
    },
    (g) => {
      g.housing!.controls.roomAccess[roomId] = null;
    },
    (g) => {
      const otherSeat = group(g).members.find(
        (m) => m.actorId === hostId,
      )!.slotId;
      g.housing!.state.slots[otherSeat].allowedActorIds!.push(guestId);
    },
    (g) => {
      const seat = group(g).members.find((m) => m.actorId === guestId)!.slotId;
      g.housing!.state.slots[seat].allowedActorIds = [hostId, thirdId];
    },
    (g) => {
      const rule = g.housing!.state.entryRules.find(
        (r) => r.point.domainId === housingPoint(roomId, 0).domainId,
      )!;
      rule.allowedActorIds = rule.allowedActorIds.filter(
        (id) => id !== guestId,
      );
    },
    (g) => {
      Object.assign(g.housing!.gatherings!, { "gathering-1": null });
    },
  ];
  for (const corrupt of changed) {
    const broken = structuredClone(game);
    corrupt(broken);
    refused(broken);
  }
  const three = setup(true).game;
  const guestLeft = order(three, guestId, "cancel");
  assert.deepEqual(
    group(guestLeft).members.map((m) => m.status),
    ["participating", "left", "participating"],
  );
  assert.ok(isGame(guestLeft));
  Object.assign(group(guestLeft), { invitation });
  refused(guestLeft);
});

test("two gatherings on one table resume independently and the earlier diner's receipt never grants the invited guest an extra seat", () => {
  const origin = originHome();
  const restricted = setHousingRoomAccess(
    enableHousing(origin, "new"),
    roomId,
    [hostId, thirdId],
  );
  const first = startHousingGathering(restricted, {
    kind: "meal",
    roomId,
    fixtureId,
    actorIds: [hostId, thirdId],
  });
  const diner = order(first, hostId, "cancel");
  const second = startHousingGathering(diner, {
    kind: "talk",
    roomId,
    fixtureId,
    actorIds: [hostId, guestId],
    invitation,
  });
  assert.notEqual(second, diner);
  const groups = second.housing!.gatherings!;
  assert.deepEqual(Object.keys(groups), ["gathering-1", "gathering-2"]);
  const oldSlot = groups["gathering-1"].members.find(
    (m) => m.actorId === thirdId,
  )!.slotId;
  assert.equal(
    second.housing!.state.slots[oldSlot].allowedActorIds?.includes(guestId),
    false,
  );
  assert.equal(second.food, restricted.food - 1);
  const continuing = advance(second, 6);
  const receipts = continuing.housing!.gatherings!;
  assert.deepEqual(receipts["gathering-1"].pairs, []);
  assert.ok(receipts["gathering-2"].pairs.some((pair) => pair.minutes > 0));
  const loaded = reload(continuing, origin);
  assert.deepEqual(advance(loaded, 20), advance(continuing, 20));
  const stopped = order(loaded, guestId, "cancel");
  assert.equal(stopped.housing!.gatherings!["gathering-2"], undefined);
  assert.deepEqual(group(stopped), group(continuing));
  assert.deepEqual(
    stopped.housing!.state.actors[thirdId],
    continuing.housing!.state.actors[thirdId],
  );
  reload(stopped, origin);
});
