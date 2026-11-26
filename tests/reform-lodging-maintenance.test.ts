import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import { rebuildHousingGeometry } from "../src/reform/housing/bridge";
import { startHousingGathering } from "../src/reform/housing/gathering";
import {
  assignConstructionBuild,
  assignConstructionHaul,
  cancelRoomConstruction,
  createRoomConstruction,
  inspectConstructionBuild,
  inspectConstructionHaul,
  releaseConstructionWorker,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import {
  createRoomInsulation,
  isRoomInsulated,
} from "../src/reform/housing/insulation";
import {
  acceptLodging,
  endLodging,
  offerLodging,
} from "../src/reform/housing/lodging";
import {
  acceptLodgingMaintenance,
  requestLodgingMaintenance,
  withdrawLodgingMaintenance,
} from "../src/reform/housing/lodgingMaintenance";
import {
  constructionSlotId,
  housingLinkId,
  housingPoint,
  housingSlotId,
} from "../src/reform/housing/topology";
import {
  housingStatus,
  nextCompletionMinutes,
} from "../src/reform/housing/presentation";
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

const people = [makePersona(0, 4), makePersona(1, 5), makePersona(2, 6)];
const [provider, resident, other] = people.map((p) => p.id);
const room = "bedroom";
const id = "construction-1";
const link = housingLinkId("living", room);
const house = editHouse(initialHouse(), {
  type: "build",
  kind: "table",
  room,
  cell: 5,
});
const origin = createGame(
  people,
  generateWorld(defaultWorldConfig()),
  "forest",
  house,
);
const plan = (g: Game) => g.housing!.construction!.plans[id];
const consent = (g: Game) => g.housing!.lodging?.maintenance;
const material = (g: Game) => g.housing!.state.items[plan(g).material!.itemId];
function ok(r: { game: Game; error?: string }) {
  assert.equal(r.error, undefined);
  return r.game;
}
function denied(r: { game: Game; error?: string }, g: Game) {
  assert.ok(r.error);
  assert.equal(r.game, g);
}
function occupied(allowProvider = false) {
  let g = setHousingRoomAccess(enableHousing(origin, "new"), room, [provider]);
  g = ok(offerLodging(g, provider, resident, room));
  g = order(order(g, provider, "recover"), other, "recover");
  const arrival = acceptLodging(g, resident);
  g = advance(ok(arrival), arrival.minutes!);
  g = order(g, provider, "cancel");
  return setHousingRoomAccess(
    g,
    room,
    allowProvider ? [provider, other] : [other],
  );
}
const planned = (g = occupied()) =>
  ok(createRoomInsulation(g, { roomId: room, stagingCell: 2 }));
const requested = (g: Game) => ok(requestLodgingMaintenance(g, resident, id));
const accepted = (g: Game) =>
  ok(acceptLodgingMaintenance(requested(g), provider));
const reserve = (g: Game) => ok(reserveConstructionMaterial(g, id));
const deliver = (g: Game, actor = provider) =>
  ok(assignConstructionHaul(g, id, actor, "deliver"));
const build = (g: Game, actor = provider) =>
  ok(assignConstructionBuild(g, id, actor));
function read(g: Game) {
  assert.ok(
    isGame(g),
    `invalid save at ${g.time}, ${JSON.stringify(consent(g))}`,
  );
  const slot = importSlot(
    exportSlot({ id: "maintenance", name: "一室の工事", origin, game: g }),
  );
  assert.deepEqual(slot.game, JSON.parse(JSON.stringify(g)));
  assert.deepEqual(slot.origin, JSON.parse(JSON.stringify(origin)));
  return slot.game;
}
function deniedFurniture(g: Game) {
  assert.deepEqual(g.housing!.controls.roomAccess[room], [other]);
  assert.ok(inspectOrder(g, provider, "home-use", "mat-1").disabled);
  assert.equal(
    g.housing!.state.slots[
      housingSlotId(room, "mat-1", 0)
    ].allowedActorIds?.includes(provider),
    false,
  );
}

test("the tenant chooses one unfinished insulation plan in their own room; the provider may decline or accept without spending wood, changing work, or opening the private room", () => {
  const g = planned();
  denied(requestLodgingMaintenance(g, other, id), g);
  denied(requestLodgingMaintenance(g, resident, "construction-99"), g);
  const external = ok(
    createRoomInsulation(occupied(), { roomId: "living", stagingCell: 2 }),
  );
  denied(requestLodgingMaintenance(external, resident, id), external);
  const extension = ok(
    createRoomConstruction(occupied(), {
      name: "別室",
      neighborId: room,
      stagingCell: 2,
    }),
  );
  denied(requestLodgingMaintenance(extension, resident, id), extension);
  const req = requested(g);
  assert.deepEqual(consent(req), { phase: "requested", planId: id });
  assert.deepEqual(req.actors, g.actors);
  assert.equal(req.time, g.time);
  assert.equal(req.wood, g.wood);
  denied(acceptLodgingMaintenance(req, resident), req);
  denied(withdrawLodgingMaintenance(req, other), req);
  const busy = order(req, provider, "recover");
  denied(acceptLodgingMaintenance(busy, provider), busy);
  const declined = ok(withdrawLodgingMaintenance(read(req), provider));
  assert.equal(consent(declined), undefined);
  assert.deepEqual(plan(declined), plan(g));
  const before = reserve(req);
  assert.equal(
    inspectConstructionHaul(before, id, provider, "deliver").ok,
    false,
  );
  const agreement = ok(acceptLodgingMaintenance(before, provider));
  assert.equal(agreement.time, before.time);
  assert.equal(agreement.wood, before.wood);
  assert.deepEqual(agreement.actors, before.actors);
  assert.deepEqual(agreement.housing!.state, before.housing!.state);
  deniedFurniture(agreement);
  assert.ok(
    inspectOrder(
      agreement,
      provider,
      "home-move",
      JSON.stringify({ roomId: room, cell: 2 }),
    ).disabled,
  );
  const noSupply = setHousingRoomAccess(agreement, "living", [resident]);
  assert.equal(
    inspectConstructionHaul(noSupply, id, provider, "deliver").ok,
    false,
  );
  const locked = setHousingPassage(agreement, "link", link, false);
  assert.equal(
    inspectConstructionHaul(locked, id, provider, "deliver").ok,
    false,
  );
});

test("every minute of delegated haul and construction round-trips without persisting its temporary entry, handling or work-seat permission", () => {
  const g = planned();
  const start = reserve(accepted(g));
  assert.equal(start.wood, g.wood - 1);
  const haul = inspectConstructionHaul(start, id, provider, "deliver");
  assert.equal(haul.minutes, 6);
  let working = deliver(start);
  assert.equal(plan(working).assignment?.lodgingMaintenance, true);
  const picked = advance(working, 1);
  const delayed = advance(setHousingPassage(picked, "link", link, false), 3);
  assert.equal(delayed.housing!.state.actors[provider].order?.phase, "waiting");
  assert.deepEqual(material(delayed).position, {
    kind: "carried",
    carrierId: provider,
  });
  const unblocked = setHousingPassage(read(delayed), "link", link, true);
  const landed = advance(unblocked, haul.minutes! - 1);
  assert.equal(plan(landed).assignment, undefined);
  assert.deepEqual(material(landed).position, {
    kind: "at",
    point: housingPoint(room, 2),
  });
  for (let i = 0; i < haul.minutes!; i++) {
    const m = material(working);
    assert.equal(m.carryAllowedActorIds?.includes(provider), false);
    assert.equal(
      working.housing!.state.slots[
        constructionSlotId(id)
      ].allowedActorIds?.includes(provider),
      false,
    );
    deniedFurniture(working);
    const next = advance(read(working), 1);
    assert.deepEqual(JSON.stringify(next), JSON.stringify(advance(working, 1)));
    working = next;
  }
  assert.deepEqual(material(working).position, {
    kind: "at",
    point: housingPoint(room, 2),
  });
  assert.equal(plan(working).assignment, undefined);
  assert.equal(consent(working)?.phase, "accepted");
  assert.equal(inspectConstructionBuild(working, id, provider).minutes, 30);
  let site = build(working);
  for (let i = 0; i < 30; i++) {
    assert.equal(plan(site).workedMinutes, i);
    assert.equal(housingStatus(site, provider).minutes, 30 - i);
    assert.doesNotMatch(
      housingStatus(site, provider).detail,
      /許可がありません/,
    );
    assert.equal(plan(site).assignment?.lodgingMaintenance, true);
    assert.equal(
      site.housing!.state.slots[
        constructionSlotId(id)
      ].allowedActorIds?.includes(provider),
      false,
    );
    site = advance(read(site), 1);
  }
  assert.ok(isRoomInsulated(site, room));
  assert.equal(consent(site), undefined);
  assert.equal(plan(site).material?.state, "consumed");
  assert.equal(site.wood, g.wood - 1);
  deniedFurniture(site);
  denied(requestLodgingMaintenance(site, resident, id), site);
  assert.deepEqual(read(site), JSON.parse(JSON.stringify(site)));
});

test("revoking consent during a crossing retires only at the real endpoint; cancelling move-out does not restore the permission or return the physical wood", () => {
  const g = reserve(accepted(planned()));
  let start = deliver(g);
  start = order(start, resident, "recover");
  const middle = advance(start, 2);
  assert.equal(middle.housing!.state.actors[provider].position.kind, "transit");
  const abandoned = ok(cancelRoomConstruction(middle, id));
  assert.equal(consent(abandoned), undefined);
  assert.equal(plan(abandoned).assignment?.lodgingMaintenance, undefined);
  assert.equal(
    abandoned.housing!.state.actors[provider].order?.phase,
    "exiting-after-cancel",
  );
  const dropped = advance(read(abandoned), 2);
  assert.equal(plan(dropped).status, "cancelled");
  assert.equal(plan(dropped).material?.state, "present");
  assert.deepEqual(material(dropped).position, {
    kind: "at",
    point: housingPoint(room, 0),
  });
  assert.equal(dropped.wood, g.wood);
  const guestIdle = order(middle, resident, "cancel");
  const closed = setHousingPassage(guestIdle, "link", link, false);
  denied(endLodging(closed, resident), closed);
  assert.equal(consent(closed)?.phase, "accepted");
  const leaving = ok(endLodging(guestIdle, resident));
  assert.equal(consent(leaving), undefined);
  assert.equal(plan(leaving).assignment?.lodgingMaintenance, undefined);
  assert.equal(
    leaving.housing!.state.actors[provider].order?.phase,
    "exiting-after-cancel",
  );
  const cancelExit = order(leaving, resident, "cancel");
  assert.equal(cancelExit.housing!.lodging?.phase, "occupied");
  const stopped = advance(order(read(cancelExit), resident, "recover"), 2);
  assert.equal(consent(stopped), undefined);
  assert.equal(plan(stopped).assignment, undefined);
  assert.deepEqual(material(stopped).position, {
    kind: "at",
    point: housingPoint(room, 0),
  });
  assert.equal(stopped.wood, g.wood);
  deniedFurniture(stopped);
  denied(assignConstructionHaul(stopped, id, provider, "deliver"), stopped);
  const cancelled = ok(cancelRoomConstruction(stopped, id));
  denied(assignConstructionHaul(cancelled, id, provider, "return"), cancelled);
  const ready = order(cancelled, resident, "cancel");
  const returned = ok(assignConstructionHaul(ready, id, resident, "return"));
  const n = inspectConstructionHaul(ready, id, resident, "return").minutes!;
  const home = advance(read(returned), n);
  assert.equal(plan(home).material?.state, "returned");
  assert.equal(home.wood, g.wood + 1);
});

test("releasing a worker keeps consent, withdrawing the request preserves completed work, and a new acceptance finishes only the remaining minutes", () => {
  const p = planned();
  let g = deliver(reserve(accepted(p)));
  g = order(g, resident, "recover");
  const buildStart = build(advance(g, 6));
  const seven = advance(buildStart, 7);
  const released = ok(releaseConstructionWorker(seven, id));
  assert.equal(consent(released)?.phase, "accepted");
  assert.equal(plan(released).workedMinutes, 7);
  const reassigned = build(released);
  const withdrawn = ok(withdrawLodgingMaintenance(reassigned, resident));
  assert.equal(consent(withdrawn), undefined);
  assert.equal(plan(withdrawn).assignment, undefined);
  assert.equal(plan(withdrawn).workedMinutes, 7);
  assert.equal(withdrawn.wood, p.wood - 1);
  assert.ok(inspectConstructionBuild(withdrawn, id, provider).disabled);
  const resumed = build(accepted(read(withdrawn)));
  assert.equal(housingStatus(resumed, provider).minutes, 23);
  assert.equal(nextCompletionMinutes(resumed), 23);
  const complete = advance(resumed, 23);
  assert.equal(plan(complete).workedMinutes, 30);
  assert.equal(complete.wood, p.wood - 1);
  assert.equal(isRoomInsulated(complete, room), true);
  read(complete);
});

test("ordinary work remains compatible with old saves and a request can be withdrawn without interrupting a different worker", () => {
  const ordinary = planned(occupied(true));
  const existing = deliver(reserve(ordinary));
  assert.equal(consent(existing), undefined);
  assert.equal(plan(existing).assignment?.lodgingMaintenance, undefined);
  denied(requestLodgingMaintenance(existing, resident, id), existing);
  read(existing);
  const pending = reserve(requested(ordinary));
  const independent = deliver(pending);
  assert.equal(plan(independent).assignment?.lodgingMaintenance, undefined);
  read(independent);
  const separate = ok(withdrawLodgingMaintenance(independent, resident));
  assert.deepEqual(separate.actors, independent.actors);
  assert.deepEqual(plan(separate), plan(independent));
  const hired = deliver(reserve(accepted(planned())), resident);
  assert.equal(plan(hired).assignment?.lodgingMaintenance, undefined);
  const withdrawn = ok(withdrawLodgingMaintenance(hired, provider));
  assert.deepEqual(plan(withdrawn), plan(hired));
  assert.deepEqual(withdrawn.housing!.state, hired.housing!.state);
  read(withdrawn);
  const bothAllowed = deliver(reserve(accepted(ordinary)));
  assert.equal(plan(bothAllowed).assignment?.lodgingMaintenance, true);
  const released = ok(withdrawLodgingMaintenance(bothAllowed, resident));
  assert.equal(plan(released).assignment, undefined);
  assert.ok(inspectConstructionHaul(released, id, provider, "deliver").ok);
});

test("both save positions reject a forged agreement, delegated job, loaned access or stale material and construction orders", () => {
  const p = planned();
  const req = requested(p);
  const agree = ok(acceptLodgingMaintenance(req, provider));
  const haul = deliver(reserve(agree));
  const makeSite = advance(haul, 6);
  const building = build(makeSite);
  function rejects(g: Game, corrupt: (raw: Game) => unknown) {
    const bad = structuredClone(g);
    corrupt(bad);
    assert.equal(isGame(bad), false, String(corrupt));
    for (const slot of [
      { game: bad, origin },
      { game: origin, origin: bad },
    ]) {
      assert.throws(
        () => importSlot(exportSlot({ ...slot, id: "bad", name: "依頼" })),
        String(corrupt),
      );
    }
  }
  for (const forged of [
    null,
    [],
    {},
    { planId: id },
    { phase: "accepted" },
    { phase: "done", planId: id },
    { phase: "accepted", planId: "construction-0" },
    { phase: "accepted", planId: "__proto__" },
    { phase: "accepted", planId: id, residentId: other },
    { phase: "accepted", planId: id, roomId: "living" },
    { phase: "accepted", planId: id, providerId: other },
    { phase: "accepted", planId: id, permission: true },
  ]) {
    rejects(req, (g) =>
      Object.assign(g.housing!.lodging!, { maintenance: forged }),
    );
  }
  const wrongRoom = ok(
    createRoomInsulation(occupied(), { roomId: "living", stagingCell: 2 }),
  );
  const extension = ok(
    createRoomConstruction(occupied(), {
      name: "別室",
      neighborId: room,
      stagingCell: 2,
    }),
  );
  const cancelled = ok(cancelRoomConstruction(req, id));
  const done = advance(building, 30);
  const base = ok(
    createRoomInsulation(enableHousing(origin, "new"), {
      roomId: room,
      stagingCell: 2,
    }),
  );
  const offer = ok(offerLodging(base, provider, resident, room));
  const moving = ok(acceptLodging(offer, resident));
  const movingOut = ok(endLodging(advance(moving, 3), resident));
  for (const g of [
    wrongRoom,
    extension,
    cancelled,
    done,
    offer,
    moving,
    movingOut,
  ]) {
    rejects(g, (bad) =>
      Object.assign(bad.housing!.lodging!, {
        maintenance: { phase: "accepted", planId: id },
      }),
    );
  }
  for (const g of [haul, building]) {
    rejects(g, (bad) => delete bad.housing!.lodging!.maintenance);
    rejects(g, (bad) => Object.assign(consent(bad)!, { phase: "requested" }));
    rejects(g, (bad) => delete plan(bad).assignment!.lodgingMaintenance);
    rejects(g, (bad) => {
      delete plan(bad).assignment!.lodgingMaintenance;
      delete bad.housing!.lodging!.maintenance;
    });
    rejects(g, (bad) =>
      Object.assign(plan(bad).assignment!, { actorId: other }),
    );
    rejects(g, (bad) =>
      Object.assign(plan(bad).assignment!, { orderId: "order-999" }),
    );
    rejects(g, (bad) =>
      Object.assign(plan(bad).assignment!, { lodgingMaintenance: 1 }),
    );
    rejects(g, (bad) =>
      Object.assign(plan(bad).assignment!, { lodgingMaintenance: false }),
    );
    rejects(g, (bad) =>
      Object.assign(bad.housing!.lodging!, { providerId: other }),
    );
    rejects(g, (bad) =>
      Object.assign(bad.actors[0].task!.spatial!, {
        constructionId: "construction-99",
      }),
    );
    rejects(g, (bad) =>
      Object.assign(material(bad), {
        carryAllowedActorIds: [provider, resident, other],
      }),
    );
    rejects(g, (bad) =>
      Object.assign(bad.housing!.state.slots[constructionSlotId(id)], {
        allowedActorIds: [provider, resident, other],
      }),
    );
  }
  rejects(haul, (bad) => {
    const r = bad.housing!.state.entryRules.find(
      (r) => r.point.domainId === housingPoint(room, 0).domainId,
    )!;
    r.allowedActorIds.push(provider);
  });
  const deniedSource = setHousingRoomAccess(haul, "living", [resident]);
  assert.equal(plan(deniedSource).assignment, undefined);
  rejects(haul, (bad) => {
    bad.housing!.controls.roomAccess.living = [resident];
    rebuildHousingGeometry(bad, bad.housing!);
  });
  const retiring = ok(releaseConstructionWorker(advance(haul, 2), id));
  assert.equal(consent(retiring)?.phase, "accepted");
  assert.equal(plan(retiring).assignment?.lodgingMaintenance, true);
  assert.equal(
    retiring.housing!.state.actors[provider].order?.phase,
    "exiting-after-cancel",
  );
  read(retiring);
  const leaving = ok(withdrawLodgingMaintenance(advance(haul, 2), resident));
  assert.equal(
    leaving.housing!.state.actors[provider].order?.phase,
    "exiting-after-cancel",
  );
  read(leaving);
  rejects(leaving, (bad) =>
    Object.assign(plan(bad).assignment!, { lodgingMaintenance: true }),
  );
  const cancelledAway = ok(cancelRoomConstruction(makeSite, id));
  const allowedBack = setHousingRoomAccess(cancelledAway, room, [
    provider,
    other,
  ]);
  const back = ok(assignConstructionHaul(allowedBack, id, provider, "return"));
  read(back);
  rejects(back, (bad) =>
    Object.assign(plan(bad).assignment!, { lodgingMaintenance: true }),
  );
});

test("a provider who physically entered for maintenance may leave or resume that job, without using an ordinary order to walk deeper into the room", () => {
  const target = (roomId: string, cell = 0) => JSON.stringify({ roomId, cell });
  const interior = target(room, 8);
  const ready = reserve(accepted(planned()));
  const start = order(deliver(ready), resident, "recover");
  assert.equal(start.housing!.maintenanceVisits, undefined);
  const middle = read(advance(start, 2));
  assert.deepEqual(middle.housing!.maintenanceVisits, { [provider]: id });
  const inside = read(advance(middle, 2));
  const staged = read(advance(inside, 2));
  const finished = read(advance(build(staged), 30));
  const movingOut = ok(endLodging(order(middle, resident, "cancel"), resident));
  const cancelledCrossing = read(advance(read(movingOut), 2));
  for (const g of [
    inside,
    staged,
    finished,
    cancelledCrossing,
    ok(withdrawLodgingMaintenance(middle, resident)),
    ok(withdrawLodgingMaintenance(staged, provider)),
  ]) {
    const stopped = order(read(g), provider, "cancel");
    const excluded =
      stopped.housing!.state.actors[provider].position.kind === "transit"
        ? advance(stopped, 2)
        : stopped;
    const before = read(excluded);
    assert.match(
      inspectOrder(before, provider, "home-move", interior).disabled ?? "",
      /工事/,
    );
    const denied = order(before, provider, "home-move", interior);
    assert.deepEqual(denied.housing, before.housing);
    assert.deepEqual(denied.actors, before.actors);
    deniedFurniture(before);
    assert.equal(
      inspectOrder(before, provider, "home-move", target(room)).disabled,
      undefined,
    );
    const outside = target("living");
    const duration = inspectOrder(
      before,
      provider,
      "home-move",
      outside,
    ).minutes!;
    const left = read(
      advance(order(before, provider, "home-move", outside), duration),
    );
    assert.equal(left.housing!.maintenanceVisits, undefined);
    assert.ok(inspectOrder(left, provider, "home-move", interior).disabled);
  }
  const rescinded = ok(withdrawLodgingMaintenance(staged, resident));
  const retry = ok(acceptLodgingMaintenance(requested(rescinded), provider));
  assert.ok(isRoomInsulated(advance(build(retry), 30), room));
  const ordinary = read(
    setHousingRoomAccess(rescinded, room, [provider, other]),
  );
  assert.equal(ordinary.housing!.maintenanceVisits, undefined);
  assert.ok(inspectOrder(ordinary, provider, "home-move", interior).minutes);
  assert.ok(inspectOrder(rescinded, other, "home-move", interior).minutes);
  const travel = read(order(rescinded, provider, "travel", "landing"));
  assert.deepEqual(travel.housing!.maintenanceVisits, { [provider]: id });
  const interrupted = read(order(travel, provider, "cancel"));
  assert.match(
    inspectOrder(interrupted, provider, "home-move", interior).disabled ?? "",
    /工事/,
  );
  const away = read(advance(travel, travel.actors[0].task!.remaining));
  assert.equal(away.housing!.maintenanceVisits, undefined);
});

test("work-visit saves reject an unknown actor, site, public room or obsolete location", () => {
  const inside = advance(
    order(deliver(reserve(accepted(planned()))), resident, "recover"),
    6,
  );
  for (const visits of [
    null,
    [],
    {},
    { [provider]: "missing" },
    { missing: id },
    { [other]: id },
    { [resident]: id },
  ]) {
    const bad = Object.assign(structuredClone(inside.housing!), {
      maintenanceVisits: visits,
    });
    const game = { ...inside, housing: bad };
    for (const data of [
      { game, origin },
      { game: origin, origin: game },
    ])
      assert.throws(() =>
        importSlot(exportSlot({ ...data, id: "bad", name: "工事の入室" })),
      );
  }
});

test("a guest already at a tenant's private meal keeps their own seat and movement when the maintenance worker withdraws", () => {
  const base = order(
    setHousingRoomAccess(reserve(accepted(planned())), room, []),
    other,
    "cancel",
  );
  const gathering = startHousingGathering(base, {
    kind: "meal",
    roomId: room,
    fixtureId: "fixture-1",
    actorIds: [resident, other],
    invitation: { hostId: resident, guestId: other },
  });
  assert.equal(gathering.actors[2].task?.kind, "home-gather");
  const withWork = read(advance(deliver(gathering), 8));
  const mealOnly = advance(order(gathering, provider, "recover"), 8);
  const withdrawn = read(ok(withdrawLodgingMaintenance(withWork, provider)));
  assert.deepEqual(withdrawn.housing!.gatherings, mealOnly.housing!.gatherings);
  assert.equal(withdrawn.food, mealOnly.food);
  assert.deepEqual(withdrawn.housing!.maintenanceVisits, { [provider]: id });
  const ownOrder = JSON.stringify({ roomId: room, cell: 8 });
  const leftMeal = order(withdrawn, other, "cancel");
  assert.ok(inspectOrder(leftMeal, other, "home-move", ownOrder).minutes);
  assert.ok(inspectOrder(leftMeal, provider, "home-move", ownOrder).disabled);
  assert.ok(inspectOrder(leftMeal, other, "home-use", "mat-1").disabled);
});

test("permission to leave a restricted intermediate room for wood does not authorize the return leg through it to the rented annex", () => {
  const layout = editHouse(house, {
    type: "room",
    name: "奥の居室",
    neighbor: room,
  });
  const annex = layout.rooms.at(-1)!.id;
  const initial = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "forest",
    layout,
  );
  let g = enableHousing(initial, "new");
  g = setHousingRoomAccess(
    setHousingRoomAccess(g, room, [provider, resident]),
    annex,
    [provider],
  );
  g = ok(offerLodging(g, provider, resident, annex));
  g = order(order(g, provider, "recover"), other, "recover");
  const admission = acceptLodging(g, resident);
  g = advance(ok(admission), admission.minutes!);
  g = order(g, resident, "recover");
  g = setHousingRoomAccess(order(g, provider, "cancel"), annex, [other]);
  const middle = JSON.stringify({ roomId: room, cell: 0 });
  const leg = inspectOrder(g, provider, "home-move", middle).minutes!;
  g = advance(order(g, provider, "home-move", middle), leg);
  g = setHousingRoomAccess(g, room, [resident]);
  const project = ok(
    createRoomInsulation(g, { roomId: annex, stagingCell: 2 }),
  );
  const ready = reserve(accepted(project));
  assert.deepEqual(ready.housing!.state.actors[provider].position, {
    kind: "at",
    point: housingPoint(room, 0),
  });
  const preview = inspectConstructionHaul(ready, id, provider, "deliver");
  assert.equal(preview.ok, false);
  assert.equal(preview.minutes, null);
  denied(assignConstructionHaul(ready, id, provider, "deliver"), ready);
  assert.equal(plan(ready).assignment, undefined);
  assert.deepEqual(material(ready).position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  const reopened = setHousingRoomAccess(ready, room, [provider, resident]);
  const restored = inspectConstructionHaul(reopened, id, provider, "deliver");
  assert.ok(restored.ok);
  const delivered = advance(deliver(reopened), restored.minutes!);
  assert.deepEqual(material(delivered).position, {
    kind: "at",
    point: housingPoint(annex, 2),
  });
  read(delivered);
});
