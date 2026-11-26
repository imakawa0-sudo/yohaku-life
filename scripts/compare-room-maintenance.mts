// node --import tsx scripts/compare-room-maintenance.mts
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import {
  acceptLodging,
  endLodging,
  offerLodging,
} from "../src/reform/housing/lodging.ts";
import {
  acceptLodgingMaintenance,
  requestLodgingMaintenance,
  withdrawLodgingMaintenance,
} from "../src/reform/housing/lodgingMaintenance.ts";
import {
  createRoomInsulation,
  isRoomInsulated,
} from "../src/reform/housing/insulation.ts";
import {
  assignConstructionBuild,
  assignConstructionHaul,
  cancelRoomConstruction,
  reclaimConstructionMaterial,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction.ts";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim.ts";
import { defaultWorldConfig, generateWorld } from "../src/reform/world.ts";

const people = ["アオ", "ミドリ", "アカ"].map((name, i) => ({
  ...makePersona(i, 4 + i),
  name,
}));
const [A, B, C] = people.map((p) => p.id);
const bedroom = "bedroom";
const link = housingLinkId("living", bedroom);
const house = editHouse(initialHouse(), {
  type: "build",
  room: bedroom,
  kind: "table",
  cell: 5,
});
const world = generateWorld(defaultWorldConfig());
const start = enableHousing(createGame(people, world, "forest", house), "new");
function ok(result: { game: Game; error?: string }) {
  assert.equal(result.error, undefined);
  return result.game;
}
function reload(game: Game) {
  const encode = (g: Game) =>
    exportSlot({
      game: g,
      origin: start,
      id: "maintenance",
      name: "居室の断熱",
    });
  const read = importSlot(encode(game)).game;
  assert.equal(encode(read), encode(game));
  return read;
}
const actor = (g: Game, id: string) =>
  g.actors.find((a) => a.person.id === id)!;
const position = (g: Game, id: string) => g.housing!.state.actors[id].position;
const permission = (g: Game) => g.housing!.lodging?.maintenance ?? null;
const plan = (g: Game, id: string) => g.housing!.construction!.plans[id];
const mat = (g: Game) => !inspectOrder(g, A, "home-use", "mat-1").disabled;
const to = (r: string, cell = 0) => JSON.stringify({ roomId: r, cell });
function material(g: Game, id: string) {
  const item = plan(g, id).material;
  return item?.state === "present"
    ? g.housing!.state.items[item.itemId].position
    : (item?.state ?? null);
}
function setup(extraRoom = false) {
  const home = extraRoom
    ? editHouse(house, { type: "room", name: "奥の居室", neighbor: bedroom })
    : house;
  const roomId = extraRoom ? home.rooms.at(-1)!.id : bedroom;
  let g = extraRoom
    ? enableHousing(createGame(people, world, "forest", home), "new")
    : start;
  if (extraRoom) g = setHousingRoomAccess(g, bedroom, [A, B]);
  g = setHousingRoomAccess(g, roomId, [A]);
  g = ok(offerLodging(g, A, B, roomId));
  const arrival = acceptLodging(g, B);
  const at = g.time + arrival.minutes!;
  g = ok(arrival);
  // Both comparison workers begin at known physical points. No positions are injected.
  while (g.time < at) {
    g = order(order(g, A, "wait"), C, "wait");
    g = advance(g, Math.min(5, at - g.time));
  }
  assert.equal(g.housing!.lodging!.phase, "occupied");
  assert.deepEqual(position(g, A), {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.deepEqual(position(g, B), {
    kind: "at",
    point: housingPoint(roomId, 0),
  });
  g = order(g, A, "cancel");
  // The regular room list becomes empty. B remains its resident. No ordinary
  // use of this room is available to either A or C in the private controls.
  g = setHousingRoomAccess(g, roomId, []);
  const proposal = createRoomInsulation(g, { roomId, stagingCell: 2 });
  return { g: reload(ok(proposal)), id: proposal.planId!, roomId };
}
const initial = setup();
const id = initial.id;
const privateRoom = initial.g;
const request = (g: Game, p = id) => ok(requestLodgingMaintenance(g, B, p));
const accept = (g: Game) => ok(acceptLodgingMaintenance(g, A));
const withdraw = (g: Game, who: string) =>
  ok(withdrawLodgingMaintenance(g, who));
const reserve = (g: Game, p = id) => ok(reserveConstructionMaterial(g, p));
const assign = (g: Game, who: string, p = id) =>
  assignConstructionHaul(g, p, who, "deliver");
function finishAssignment(g: Game, p = id) {
  const initialTime = g.time;
  while (plan(g, p).assignment && g.time - initialTime < 100)
    g = reload(advance(g, 1));
  assert.equal(plan(g, p).assignment, undefined);
  return g;
}

const asked = reload(request(privateRoom));
const consent = reload(accept(asked));
for (const g of [asked, consent]) {
  assert.equal(g.time, privateRoom.time);
  assert.equal(g.wood, privateRoom.wood);
  assert.deepEqual(
    g.actors.map((a) => a.task),
    privateRoom.actors.map((a) => a.task),
  );
  assert.deepEqual(g.housing!.controls.roomAccess.bedroom, []);
  assert.equal(mat(g), false);
  assert.ok(inspectOrder(g, A, "home-move", to(bedroom, 1)).disabled);
}
assert.ok(acceptLodgingMaintenance(asked, C).error);
assert.ok(requestLodgingMaintenance(privateRoom, A, id).error);
const ordinary = setHousingRoomAccess(privateRoom, bedroom, [A]);
const declined = withdraw(asked, A);
function denied(label: string, g: Game) {
  const reserved = reserve(g);
  const issue = assign(reserved, A);
  assert.ok(issue.error);
  assert.equal(issue.game, reserved);
  return {
    label,
    stockReserved: g.wood - reserved.wood,
    material: material(reserved, id),
    time: g.time - privateRoom.time,
    reason: issue.error,
    maintenance: permission(g)?.phase ?? null,
  };
}
const refusals = [
  denied("no request", privateRoom),
  denied("requested only", asked),
  denied("declined", declined),
];
function complete(label: string, g: Game, worker: string) {
  const clock = g.time;
  const ready = reserve(g);
  assert.equal(g.wood - ready.wood, 1);
  let active = reload(ok(assign(ready, worker)));
  if (worker === A) active = order(active, B, "work", "wood:easy");
  const from = material(active, id);
  let delivered = active;
  let pickupMinute: number | null = null;
  while (plan(delivered, id).assignment && delivered.time - clock < 100) {
    delivered = reload(advance(delivered, 1));
    const item = material(delivered, id);
    if (
      typeof item === "object" &&
      item?.kind === "carried" &&
      pickupMinute === null
    ) {
      assert.equal(item.carrierId, worker);
      pickupMinute = delivered.time - clock;
    }
  }
  assert.ok(pickupMinute !== null);
  const to = material(delivered, id);
  let work = reload(ok(assignConstructionBuild(delivered, id, worker)));
  let bFinished: number | null = null;
  function tick() {
    const b = actor(work, B).task;
    work = reload(advance(work, 1));
    if (b?.mode === "direct" && b.kind === "work" && !actor(work, B).task)
      bFinished = work.time - clock;
  }
  while (plan(work, id).assignment && work.time - clock < 100) tick();
  assert.ok(isRoomInsulated(work, bedroom));
  const doneAt = work.time - clock,
    after = material(work, id),
    bedAfter = mat(work);
  assert.equal(after, "consumed");
  assert.equal(permission(work), null);
  if (worker === B) work = order(work, B, "work", "wood:easy");
  while (bFinished === null && work.time - clock < 120) tick();
  assert.notEqual(bFinished, null);
  return {
    label,
    worker,
    woodReserved: g.wood - ready.wood,
    haul: delivered.time - clock,
    build: doneAt - (delivered.time - clock),
    doneAt,
    bFinished,
    bWoodXP: actor(work, B).xp.wood,
    providerBed: bedAfter,
    from,
    pickupMinute,
    staged: to,
    after,
    regular: g.housing!.controls.roomAccess.bedroom,
  };
}
const routes = [
  complete("resident's own room", privateRoom, B),
  complete("provider with standing access", ordinary, A),
  complete("provider with this job only", consent, A),
];
// Keep B at the room entrance so the move-out control can be issued mid-haul.
assert.deepEqual(
  routes.map((r) => [
    r.haul,
    r.build,
    r.doneAt,
    r.bFinished,
    r.bWoodXP,
    r.providerBed,
  ]),
  [
    [8, 30, 38, 71, 19.5, false],
    [6, 30, 36, 33, 19.5, true],
    [6, 30, 36, 33, 19.5, false],
  ],
);
const prepared = order(reserve(consent), B, "wait");
const starting = ok(assign(prepared, A));
assert.equal(mat(starting), false);
const closed = (g: Game, open: boolean) =>
  setHousingPassage(g, "link", link, open);
const closedBefore = assign(closed(prepared, false), A);
assert.ok(closedBefore.error);
const noSupply = assign(setHousingRoomAccess(prepared, "living", [B, C]), A);
assert.ok(noSupply.error);
const held = reload(advance(closed(advance(starting, 1), false), 3));
assert.equal(plan(held, id).workedMinutes, 0);
const resumed = finishAssignment(closed(held, true));
const mid = reload(advance(starting, 2));
assert.equal(position(mid, A).kind, "transit");
const movingOut = ok(endLodging(order(mid, B, "cancel"), B));
assert.equal(permission(movingOut), null);
const dropped = finishAssignment(movingOut);
assert.equal(dropped.wood, prepared.wood);
assert.equal(isRoomInsulated(dropped, bedroom), false);
const sourceCancelled = ok(cancelRoomConstruction(prepared, id));
assert.equal(sourceCancelled.wood, prepared.wood + 1);
assert.equal(permission(sourceCancelled), null);
assert.equal(material(sourceCancelled, id), "returned");
const staged = finishAssignment(starting);
const seven = reload(advance(ok(assignConstructionBuild(staged, id, A)), 7));
const stopped = reload(withdraw(seven, B));
assert.equal(plan(stopped, id).workedMinutes, 7);
assert.equal(plan(stopped, id).assignment, undefined);
assert.ok(assignConstructionBuild(stopped, id, A).error);
assert.equal(mat(stopped), false);
const exit = inspectOrder(stopped, A, "home-move", to("living"));
assert.equal(exit.disabled, undefined);
const out = advance(
  order(stopped, A, "home-move", to("living")),
  exit.minutes!,
);
assert.deepEqual(position(out, A), {
  kind: "at",
  point: housingPoint("living", 0),
});
const restored = accept(request(stopped));
const finished = finishAssignment(ok(assignConstructionBuild(restored, id, A)));
assert.equal(finished.time - restored.time, 23);
assert.equal(material(finished, id), "consumed");
assert.equal(permission(finished), null);
const cancelled = ok(cancelRoomConstruction(stopped, id));
assert.equal(cancelled.wood, stopped.wood);
assert.ok(assignConstructionHaul(cancelled, id, A, "return").error);
let collect = order(cancelled, B, "cancel");
while (actor(collect, B).task && collect.time - cancelled.time < 8)
  collect = advance(collect, 1);
const returnHaul = finishAssignment(
  ok(assignConstructionHaul(collect, id, B, "return")),
);
assert.equal(material(returnHaul, id), "returned");
assert.equal(returnHaul.wood - collect.wood, 1);
assert.ok(reclaimConstructionMaterial(returnHaul, id).error);
const extra = setup(true);
let remote = setHousingRoomAccess(extra.g, bedroom, [B]);
remote = reserve(accept(request(remote, extra.id)), extra.id);
const blockedByNeighbor = assign(remote, A, extra.id);
assert.ok(blockedByNeighbor.error);
assert.equal(blockedByNeighbor.game, remote);
const through = setHousingRoomAccess(remote, bedroom, [A, B]);
const afterOpening = finishAssignment(
  ok(assign(through, A, extra.id)),
  extra.id,
);

console.log(
  JSON.stringify(
    {
      startedAt: privateRoom.time,
      workersAtStart: {
        provider: position(privateRoom, A),
        resident: position(privateRoom, B),
      },
      requestExtendedOnlyTo: permission(consent),
      routes,
      refusals,
      blocked: {
        before: closedBefore.error,
        supply: noSupply.error,
        neighbor: blockedByNeighbor.error,
        actualHaulAfterOpeningNeighbor: afterOpening.time - remote.time,
        holding: material(held, id),
        wait: 3,
        actualHaulAfterReopening: resumed.time - held.time,
      },
      endedDuringCarry: {
        remainingSafeEdge: dropped.time - mid.time,
        material: material(dropped, id),
        credited: dropped.wood - movingOut.wood,
        provider: position(dropped, A),
        phase: permission(dropped)?.phase ?? null,
      },
      stoppedDuringBuild: {
        savedMinutes: plan(stopped, id).workedMinutes,
        material: material(stopped, id),
        ordinaryBed: mat(stopped),
        exitMinutes: out.time - stopped.time,
        remaining: finished.time - restored.time,
      },
      cancelAtSource: {
        state: material(sourceCancelled, id),
        credit: sourceCancelled.wood - prepared.wood,
      },
      cancelAtStaging: {
        state: material(cancelled, id),
        credit: cancelled.wood - stopped.wood,
        returnedByResidentMinutes: returnHaul.time - collect.time,
        stockAfterPhysicalReturn: returnHaul.wood - collect.wood,
      },
    },
    null,
    2,
  ),
);
