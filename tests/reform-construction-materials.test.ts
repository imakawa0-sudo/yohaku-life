import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  enableHousing,
  isGame,
  order,
  setHousingRoomAccess,
  setHousingPassage,
} from "../src/reform/sim";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import {
  cancelRoomConstruction,
  releaseConstructionWorker,
  inspectConstructionHaul,
  assignConstructionHaul,
  createRoomConstruction,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import {
  base,
  ok,
  bundle,
  hauling,
  itemId,
  one,
  plan,
  planId,
  planned,
  request,
  reserved,
  two,
} from "./helpers/construction";
import {
  constructionStatus,
  constructionTaskMinutes,
} from "../src/reform/housing/constructionPresentation";
import { housingStatus } from "../src/reform/housing/presentation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { editHouse } from "../src/reform/house";

test("planning leaves house, clock and stocks untouched even when wood is unavailable", () => {
  const g = base();
  g.wood = 0;
  const snapshot = JSON.stringify(g);
  const r = createRoomConstruction(g, request);
  assert.equal(r.planId, "construction-1");
  assert.equal(plan(r.game).name, "作業室");
  assert.equal(plan(r.game).createdAt, g.time);
  assert.equal(r.game.wood, 0);
  assert.equal(r.game.time, g.time);
  assert.deepEqual(r.game.house, g.house);
  assert.equal(plan(r.game).workedMinutes, 0);
  assert.equal(plan(r.game).material, undefined);
  assert.equal(reserveConstructionMaterial(r.game, planId).game, r.game);
  assert.equal(createRoomConstruction(r.game, request).game, r.game);
  assert.equal(JSON.stringify(g), snapshot);
});
test("planning rejects an empty/overlong name, missing room, blocked floor and supply point", () => {
  const g = base();
  for (const patch of [
    { name: " " },
    { name: "花".repeat(25) },
    { neighborId: "missing" },
    { stagingCell: 10 },
    { stagingCell: 12 },
    { stagingCell: -1 },
    { neighborId: "living", stagingCell: 0 },
  ]) {
    const r = createRoomConstruction(g, { ...request, ...patch });
    assert.ok(r.error);
    assert.equal(r.game, g);
  }
});
test("reservation debits exactly six wood and creates a single located bundle without advancing time", () => {
  const g = planned();
  const r = reserveConstructionMaterial(g, planId);
  assert.equal(r.game.wood, 0);
  assert.equal(r.game.time, g.time);
  assert.deepEqual(plan(r.game).material, {
    itemId,
    quantity: 6,
    state: "present",
  });
  assert.deepEqual(bundle(r.game).position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.deepEqual(Object.keys(r.game.housing!.state.items), [itemId]);
  assert.equal(reserveConstructionMaterial(r.game, planId).game, r.game);
});
test("pickup reserves the physical bundle until the delivery floor is reached", () => {
  const g = hauling();
  const orderId = plan(g).assignment!.orderId;
  assert.deepEqual(g.actors[0].task?.reserved, {});
  assert.deepEqual(g.actors[0].task?.spatial, {
    kind: "carry",
    orderId,
    constructionId: planId,
    direction: "deliver",
  });
  assert.deepEqual(
    Object.values(g.housing!.state.reservations).map((r) => [
      r.kind,
      r.actorId,
      r.targetId,
      r.orderId,
    ]),
    [["payload", one, itemId, orderId]],
  );
  assert.deepEqual(bundle(g).position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  const picked = advance(g, 1);
  assert.deepEqual(bundle(picked).position, {
    kind: "carried",
    carrierId: one,
  });
  assert.equal(picked.actors[0].task!.remaining, 1);
  assert.equal(plan(picked).assignment!.actorId, one);
  assert.equal(picked.actors[0].cargo.wood, 0);
  const delivered = advance(picked, 5);
  assert.deepEqual(bundle(delivered).position, {
    kind: "at",
    point: housingPoint("bedroom", 2),
  });
  assert.equal(delivered.actors[0].task, null);
  assert.deepEqual(
    Object.values(delivered.housing!.state.reservations).filter(
      (r) => r.kind === "payload",
    ),
    [],
  );
  assert.equal(plan(delivered).assignment, undefined);
  assert.equal(delivered.wood, 0);
});
test("failed assignments preserve the original including legacy locations and order IDs", () => {
  const g = reserved(base("legacy"));
  const busy = order(g, two, "wait");
  for (const [state, actor] of [
    [busy, two],
    [g, "missing"],
    [hauling(g), two],
  ] as const) {
    const before = JSON.stringify(state);
    const r = assignConstructionHaul(state, planId, actor, "deliver");
    assert.ok(r.error);
    assert.equal(r.game, state);
    assert.equal(JSON.stringify(state), before);
  }
});

test("cancelling a plan on the supply floor refunds exactly once and frees the next plan number", () => {
  for (const g of [planned(), reserved(), hauling(), advance(hauling(), 1)]) {
    const cancelled = ok(cancelRoomConstruction(g, planId));
    assert.equal(plan(cancelled).status, "cancelled");
    assert.equal(plan(cancelled).cancelledAt, g.time);
    assert.equal(cancelled.time, g.time);
    assert.equal(cancelled.wood, 6);
    assert.equal(
      plan(cancelled).material?.state,
      plan(g).material ? "returned" : undefined,
    );
    assert.equal(bundle(cancelled), undefined);
    assert.equal(cancelRoomConstruction(cancelled, planId).game.wood, 6);
    assert.equal(
      createRoomConstruction(cancelled, request).planId,
      "construction-2",
    );
  }
});
test("cancelling mid-approach keeps the bundle until the handler exits the admitted link", () => {
  let g = reserved();
  g = advance(
    order(g, one, "home-move", JSON.stringify({ roomId: "bedroom", cell: 0 })),
    3,
  );
  g = advance(hauling(g), 1);
  g = ok(cancelRoomConstruction(g, planId));
  assert.equal(plan(g).status, "cancelled");
  assert.deepEqual(bundle(g).position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.equal(g.wood, 0);
  assert.equal(plan(g).assignment?.actorId, one);
  const mid = advance(g, 1);
  assert.equal(mid.wood, 0);
  assert.ok(plan(mid).assignment);
  const done = advance(mid, 1);
  assert.equal(done.wood, 6);
  assert.equal(done.actors[0].task, null);
  assert.equal(bundle(done), undefined);
});
test("safe exit drops the same cargo for another resident; cancelling a return permits a fresh recovery", () => {
  let g = advance(order(hauling(), two, "wait"), 2);
  g = ok(cancelRoomConstruction(g, planId));
  assert.deepEqual(bundle(g).position, { kind: "carried", carrierId: one });
  assert.equal(
    g.housing!.state.actors[one].order?.phase,
    "exiting-after-cancel",
  );
  assert.ok(createRoomConstruction(g, request).error);
  g = advance(g, 2);
  assert.deepEqual(bundle(g).position, {
    kind: "at",
    point: housingPoint("bedroom", 0),
  });
  assert.equal(plan(g).assignment, undefined);
  assert.equal(g.wood, 0);
  g = order(g, two, "cancel");
  g = order(hauling(g, two, "return"), one, "wait");
  g = advance(g, 3);
  assert.deepEqual(bundle(g).position, { kind: "carried", carrierId: two });
  g = ok(releaseConstructionWorker(g, planId));
  assert.deepEqual(bundle(g).position, {
    kind: "at",
    point: housingPoint("bedroom", 0),
  });
  assert.equal(g.wood, 0);
  g = hauling(order(g, one, "cancel"), one, "return");
  g = advance(g, 4);
  assert.equal(plan(g).material!.state, "returned");
  assert.equal(bundle(g), undefined);
  assert.equal(g.wood, 6);
  assert.equal(plan(g).assignment, undefined);
});
test("life-screen cancel releases a worker on the floor without cancelling the construction plan", () => {
  const picked = advance(hauling(), 1),
    g = order(picked, one, "cancel");
  assert.equal(plan(g).assignment, undefined);
  assert.equal(plan(g).status, "planned");
  assert.equal(g.wood, 0);
  assert.equal(g.actors[0].task, null);
  assert.deepEqual(bundle(g).position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
});

test("occupants can exit a restricted room but cannot pick up with egress authority", () => {
  const g = setHousingRoomAccess(reserved(), "living", []);
  assert.deepEqual(bundle(g).carryAllowedActorIds, []);
  assert.equal(assignConstructionHaul(g, planId, one, "deliver").game, g);
  const inspect = inspectConstructionHaul(g, planId, one, "deliver");
  assert.equal(inspect.ok, false);
  assert.equal(inspect.minutes, null);
  assert.match(inspect.disabled!, /許可/);
  assert.ok(
    order(g, one, "home-move", JSON.stringify({ roomId: "bedroom", cell: 0 }))
      .actors[0].task,
  );
});
test("revoking pickup or delivery access on the floor releases the bundle immediately and restoration needs reassignment", () => {
  for (const room of ["living", "bedroom"]) {
    const carrying = advance(hauling(), 1);
    const g = setHousingRoomAccess(carrying, room, [two]);
    assert.equal(constructionTaskMinutes(g, one), null);
    const restored = setHousingRoomAccess(g, room, null);
    for (const state of [g, restored]) {
      assert.equal(state.time, carrying.time);
      assert.equal(state.rng, carrying.rng);
      assert.equal(state.housing!.state.time, carrying.housing!.state.time);
      assert.equal(plan(state).assignment, undefined);
      assert.equal(state.actors[0].task, null);
      assert.deepEqual(bundle(state).position, {
        kind: "at",
        point: plan(state).source,
      });
      assert.ok(isGame(state));
    }
    assert.deepEqual(bundle(carrying).position, {
      kind: "carried",
      carrierId: one,
    });
    assert.equal(plan(advance(restored, 1)).assignment, undefined);
    assert.deepEqual(bundle(advance(hauling(restored), 6)).position, {
      kind: "at",
      point: plan(restored).staging,
    });
  }
});
test("restoring hauling access before the next tick still exits only the admitted link and then permits a new handler", () => {
  const active = advance(order(hauling(), two, "wait"), 2);
  const off = setHousingRoomAccess(active, "bedroom", [two]);
  const restored = setHousingRoomAccess(off, "bedroom", null);
  for (const state of [off, restored]) {
    assert.equal(
      state.housing!.state.actors[one].order?.phase,
      "exiting-after-cancel",
    );
    assert.deepEqual(
      state.housing!.state.actors[one].position,
      active.housing!.state.actors[one].position,
    );
    assert.equal(state.time, active.time);
    assert.equal(state.rng, active.rng);
    assert.equal(plan(state).workedMinutes, 0);
    assert.ok(isGame(state));
  }
  assert.deepEqual(bundle(advance(restored, 1)).position, {
    kind: "carried",
    carrierId: one,
  });
  const out = advance(restored, 2);
  assert.equal(plan(out).assignment, undefined);
  assert.equal(out.actors[0].task, null);
  assert.deepEqual(bundle(out).position, {
    kind: "at",
    point: housingPoint("bedroom", 0),
  });
  const reassigned = hauling(order(out, two, "cancel"), two);
  assert.equal(plan(reassigned).assignment?.actorId, two);
  assert.deepEqual(bundle(advance(reassigned, 5)).position, {
    kind: "at",
    point: plan(out).staging,
  });
});
test("restricting a room used only for passage keeps the construction assignment and its load", () => {
  const old = base();
  delete old.housing;
  old.house = editHouse(old.house, {
    type: "room",
    name: "奥の部屋",
    neighbor: "bedroom",
  });
  const g = ok(
    createRoomConstruction(enableHousing(old, "new"), {
      ...request,
      neighborId: "room-1",
    }),
  );
  const active = advance(
    hauling(ok(reserveConstructionMaterial(g, planId))),
    1,
  );
  const denied = setHousingRoomAccess(active, "bedroom", []);
  const held = advance(denied, 1);
  assert.equal(held.housing!.state.actors[one].order?.phase, "waiting");
  assert.deepEqual(plan(held).assignment, plan(active).assignment);
  assert.deepEqual(bundle(held).position, { kind: "carried", carrierId: one });
  const restored = setHousingRoomAccess(held, "bedroom", null);
  const delivered = advance(restored, constructionTaskMinutes(restored, one)!);
  assert.deepEqual(bundle(delivered).position, {
    kind: "at",
    point: plan(g).staging,
  });
});
test("injury 70 or danger bars assignment; a newly unfit carrier exits the admitted segment with their bundle", () => {
  const g = reserved();
  g.actors[0].injury = 69;
  assert.equal(
    assignConstructionHaul(g, planId, one, "deliver").error,
    undefined,
  );
  g.actors[0].injury = 70;
  assert.ok(assignConstructionHaul(g, planId, one, "deliver").error);
  g.actors[0].injury = 0;
  g.actors[0].danger = true;
  assert.ok(assignConstructionHaul(g, planId, one, "deliver").error);
  for (const cause of ["danger", "injury", "permission"]) {
    let transit = advance(hauling(), 2);
    if (cause === "danger") transit.actors[0].danger = true;
    if (cause === "injury") transit.actors[0].injury = 70;
    if (cause === "permission")
      transit = setHousingRoomAccess(transit, "living", []);
    const inside = advance(transit, 1);
    assert.equal(
      inside.housing!.state.actors[one].order?.phase,
      "exiting-after-cancel",
    );
    assert.equal(bundle(inside).position.kind, "carried");
    const end = advance(inside, 1);
    assert.deepEqual(bundle(end).position, {
      kind: "at",
      point: housingPoint("bedroom", 0),
    });
    assert.equal(plan(end).assignment, undefined);
    assert.equal(end.wood, 0);
  }
});
test("closed passages preserve carrier and reservation; estimates resume with the same clock as delivery", () => {
  let g = advance(hauling(), 1);
  const id = housingLinkId("living", "bedroom");
  const assignment = plan(g).assignment;
  g = setHousingPassage(g, "link", id, false);
  assert.equal(constructionTaskMinutes(g, one), null);
  g = advance(g, 2);
  assert.equal(housingStatus(g, one).minutes, null);
  assert.equal(housingStatus(g, one).phase, "waiting");
  assert.deepEqual(plan(g).assignment, assignment);
  assert.deepEqual(bundle(g).position, { kind: "carried", carrierId: one });
  assert.ok(
    Object.values(g.housing!.state.reservations).some(
      (r) => r.targetId === itemId,
    ),
  );
  g = setHousingPassage(g, "link", id, true);
  assert.equal(constructionTaskMinutes(g, one), 5);
  assert.equal(plan(advance(g, 5)).assignment, undefined);
});
test("forecast charges pickup at the supply floor or on arrival from a distant room; previews are pure", () => {
  const reservedGame = reserved();
  const remote = advance(
    order(
      reservedGame,
      one,
      "home-move",
      JSON.stringify({ roomId: "bedroom", cell: 0 }),
    ),
    3,
  );
  for (const [g, minutes] of [
    [reservedGame, 6],
    [remote, 8],
  ] as const) {
    const before = JSON.stringify(g);
    assert.equal(
      inspectConstructionHaul(g, planId, one, "deliver").minutes,
      minutes,
    );
    const active = hauling(g),
      copy = JSON.stringify(active);
    assert.equal(constructionTaskMinutes(active, one), minutes);
    assert.equal(housingStatus(active, one).minutes, minutes);
    assert.match(constructionStatus(active, planId).material, /居間/);
    assert.equal(JSON.stringify(active), copy);
    assert.equal(plan(advance(active, minutes)).assignment, undefined);
    assert.equal(JSON.stringify(g), before);
  }
});
test("housing edits preserve staging floor and dropped wood until cancellation has settled", () => {
  let g = planned();
  g.wood = 30;
  for (const tile of ["wall", "bench"]) {
    const house = editHouse(
      g.house,
      tile === "wall"
        ? { type: "tile", tile: "wall", room: "bedroom", cell: 2 }
        : { type: "build", kind: "bench", room: "bedroom", cell: 2 },
    );
    assert.ok(applyHousingHouseEdit(g, house).error);
    const closed = ok(cancelRoomConstruction(g, planId));
    assert.equal(applyHousingHouseEdit(closed, house).error, undefined);
  }
  g = ok(releaseConstructionWorker(advance(hauling(), 5), planId));
  g = advance(
    order(g, one, "home-move", JSON.stringify({ roomId: "bedroom", cell: 0 })),
    1,
  );
  g = ok(cancelRoomConstruction(g, planId));
  g.wood = 30;
  const blocked = editHouse(g.house, {
    type: "tile",
    tile: "wall",
    room: "bedroom",
    cell: 1,
  });
  assert.ok(applyHousingHouseEdit(g, blocked).error);
});
test("an unsuccessful spatial trial keeps the legacy handler unlocated; an allowed trial settles that same person", () => {
  const legacy = setHousingRoomAccess(reserved(base("legacy")), "living", [
    two,
  ]);
  const raw = JSON.stringify(legacy);
  const denied = assignConstructionHaul(legacy, planId, one, "deliver");
  assert.equal(denied.game, legacy);
  assert.match(denied.error!, /許可/);
  assert.equal(JSON.stringify(legacy), raw);
  assert.equal(Object.hasOwn(legacy.housing!.state.actors, one), false);
  const permitted = hauling(legacy, two);
  assert.deepEqual(permitted.housing!.state.actors[two].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.deepEqual(bundle(permitted).carryAllowedActorIds, [two]);
});
test("the construction card locates carried wood on a link and life-screen cancellation identifies the drop", () => {
  const g = advance(hauling(), 2);
  const status = constructionStatus(g, planId);
  assert.equal(status.worker, g.actors[0].person.name);
  assert.match(status.material, /居間/);
  assert.match(status.material, /寝室/);
  const stopped = order(g, one, "cancel");
  assert.match(stopped.actors[0].reason, /木材/);
  assert.match(housingStatus(stopped, one).detail, /下ろ/);
});
