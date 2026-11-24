import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  enableHousing,
  isGame,
  order,
  type Game,
  setHousingRoomAccess,
} from "../src/reform/sim";
import { editHouse } from "../src/reform/house";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingPoint } from "../src/reform/housing/topology";
import { branchSlot, exportSlot, importSlot } from "../src/reform/library";
import {
  createRoomConstruction,
  cancelRoomConstruction,
  reclaimConstructionMaterial,
  releaseConstructionWorker,
  assignConstructionBuild,
  assignConstructionHaul,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import {
  constructionStatus,
  constructionTaskMinutes,
} from "../src/reform/housing/constructionPresentation";
import {
  base,
  bundle,
  staged,
  building,
  hauling,
  itemId,
  one,
  two,
  plan,
  planId,
  planned,
  reserved,
  request,
  ok,
} from "./helpers/construction";
const saved = (g: Game): Game => JSON.parse(JSON.stringify(g));

test("old games and origins remain byte-identical on display, load and construction commands", () => {
  for (const legacy of [false, true]) {
    const g = base();
    if (legacy) delete g.housing;
    const before = JSON.stringify(g);
    assert.ok(isGame(saved(g)));
    constructionStatus(g, planId);
    constructionTaskMinutes(g, one);
    const r = createRoomConstruction(g, request);
    if (legacy) {
      assert.match(r.error!, /住居の移動/);
      assert.equal(r.game, g);
    }
    assert.equal(JSON.stringify(g), before);
    const slot = {
      id: "old",
      name: "工事の前",
      origin: g,
      game: legacy ? g : r.game,
    };
    assert.deepEqual(importSlot(exportSlot(slot)).origin, saved(g));
  }
});
test("legacy cooking, its material and remaining time survive alongside an explicitly located constructor-ID handler", () => {
  const g = base("legacy", "constructor");
  delete g.housing;
  const cook = order(
    advance(order(g, two, "work", "cook"), 1),
    "constructor",
    "cancel",
  );
  const origin = enableHousing(cook, "legacy");
  const begun = hauling(reserved(origin), "constructor");
  assert.equal(
    Object.hasOwn(origin.housing!.state.actors, "constructor"),
    false,
  );
  assert.equal(Object.hasOwn(begun.housing!.state.actors, "constructor"), true);
  assert.equal(begun.ingredients, cook.ingredients);
  assert.deepEqual(begun.actors[1].task, cook.actors[1].task);
  assert.ok(isGame(saved(begun)));
  const slot = { id: "construction", name: "搬入中", origin, game: begun };
  const cloned = branchSlot(importSlot(exportSlot(slot)), false, "複製");
  assert.deepEqual(cloned.origin, saved(origin));
  assert.deepEqual(advance(cloned.game, 6), advance(begun, 6));
});
test("all delivery, safe exit, staged, return and refunded boundaries round-trip with identical continuation", () => {
  let g = hauling();
  const states = [planned(), reserved(), g];
  for (let i = 0; i < 6; i++) {
    g = advance(g, 1);
    states.push(g);
  }
  let back = ok(cancelRoomConstruction(g, planId));
  states.push(back);
  back = hauling(back, one, "return");
  states.push(back);
  for (let i = 0; i < 6; i++) {
    back = advance(back, 1);
    states.push(back);
  }
  let exiting = ok(cancelRoomConstruction(advance(hauling(), 2), planId));
  states.push(exiting);
  exiting = advance(exiting, 1);
  states.push(exiting);
  states.push(advance(exiting, 1));
  states.push(setHousingRoomAccess(advance(hauling(), 1), "living", []));
  for (const [index, state] of states.entries()) {
    const raw = JSON.stringify(state);
    assert.equal(isGame(state), true, "live boundary " + index);
    const loaded = saved(state);
    assert.equal(isGame(loaded), true, "saved boundary " + index);
    assert.deepEqual(
      advance(loaded, 1),
      advance(state, 1),
      "continuation " + index,
    );
    assert.equal(JSON.stringify(state), raw);
  }
});
test("untrusted saves must have one located bundle per present receipt and one matching assignment per carry", () => {
  const active = hauling();
  const corruptions: [string, (g: Game) => void][] = [
    [
      "extra item",
      (g) => {
        g.housing!.state.items.extra = { ...bundle(g), id: "extra" };
      },
    ],
    [
      "unknown worker",
      (g) => {
        plan(g).assignment!.actorId = "constructor";
      },
    ],
    [
      "wrong order",
      (g) => {
        plan(g).assignment!.orderId = "order-78";
      },
    ],
    [
      "wrong direction",
      (g) => {
        plan(g).assignment!.kind = "return";
      },
    ],
    [
      "wrong binding",
      (g) => {
        g.actors[0].task!.spatial!.constructionId = "construction-2";
      },
    ],
    [
      "wrong delivery endpoint",
      (g) => {
        const order = g.housing!.state.actors[one].order!;
        if (order.intent.kind === "carry") order.intent.destination.cell++;
      },
    ],
    [
      "pickup differs from item",
      (g) => {
        g.housing!.state.actors[one].order!.pickupPoint!.cell++;
      },
    ],
    [
      "forged escrow",
      (g) => {
        g.actors[0].task!.reserved.wood = 6;
      },
    ],
    [
      "wrong binding direction",
      (g) => {
        g.actors[0].task!.spatial!.direction = "return";
      },
    ],
    [
      "wrong Task type",
      (g) => {
        g.actors[0].task!.kind = "wait";
      },
    ],
    [
      "missing assignment",
      (g) => {
        delete plan(g).assignment;
      },
    ],
    [
      "returned but still present",
      (g) => {
        plan(g).material!.state = "returned";
      },
    ],
    [
      "missing bundle",
      (g) => {
        delete g.housing!.state.items[itemId];
      },
    ],
    [
      "receipt wrong ID",
      (g) => {
        plan(g).material!.itemId = "extra";
      },
    ],
    [
      "five wood",
      (g) => {
        Object.assign(plan(g).material!, { quantity: 5 });
      },
    ],
    [
      "seven wood",
      (g) => {
        Object.assign(plan(g).material!, { quantity: 7 });
      },
    ],
    [
      "reused numbering",
      (g) => {
        g.housing!.construction!.nextId = 1;
      },
    ],
    [
      "future creation",
      (g) => {
        plan(g).createdAt++;
      },
    ],
    [
      "terminal time while planned",
      (g) => {
        plan(g).cancelledAt = g.time;
      },
    ],
    [
      "unknown shape",
      (g) => {
        Object.assign(plan(g), { extra: 1 });
      },
    ],
    [
      "null assignment",
      (g) => {
        Object.assign(plan(g), { assignment: null });
      },
    ],
    [
      "forged item ACL",
      (g) => {
        bundle(g).carryAllowedActorIds = [];
      },
    ],
    [
      "duplicate plan with same physical bundle",
      (g) => {
        const ledger = g.housing!.construction!;
        ledger.nextId++;
        ledger.plans["construction-2"] = { ...plan(g), id: "construction-2" };
      },
    ],
    [
      "cancelled with ongoing delivery",
      (g) => {
        plan(g).status = "cancelled";
        plan(g).cancelledAt = g.time;
      },
    ],
  ];
  for (const [name, change] of corruptions) {
    const g = saved(active);
    change(g);
    assert.equal(isGame(g), false, name);
  }
  const buried = reserved();
  bundle(buried).position = {
    kind: "at",
    point: { ...plan(buried).source, cell: 3 },
  };
  assert.equal(isGame(buried), false, "material cannot be buried in a fixture");
  const forged = saved(active);
  delete forged.housing;
  delete forged.actors[0].task!.spatial;
  assert.equal(
    isGame(forged),
    false,
    "a housing-only job cannot run in a legacy slot",
  );
  const orphan = saved(active);
  delete orphan.housing!.construction;
  assert.equal(
    isGame(orphan),
    false,
    "orphan carried item and task without ledger",
  );
});
test("a missing room-access entry in a save with an active bundle returns invalid without throwing", () => {
  const g = hauling();
  delete g.housing!.controls.roomAccess.bedroom;
  assert.equal(isGame(g), false);
});

test("cancelling at a full supply stock retains exactly one bundle until an explicit retry has room", () => {
  const full = reserved();
  full.wood = 1_000_000_000;
  assert.ok(isGame(full));
  const pending = ok(cancelRoomConstruction(full, planId));
  assert.equal(pending.wood, 1_000_000_000);
  assert.equal(plan(pending).material?.state, "present");
  assert.deepEqual(bundle(pending).position, {
    kind: "at",
    point: plan(pending).source,
  });
  assert.equal(plan(pending).assignment, undefined);
  assert.ok(isGame(saved(pending)));
  assert.match(constructionStatus(pending, planId).detail, /空き/);
  assert.equal(reclaimConstructionMaterial(pending, planId).game, pending);
  assert.ok(createRoomConstruction(pending, request).error);
  // A controlled spend tests the receipt independently of furniture prices.
  const room = saved(pending);
  room.wood -= 6;
  assert.ok(isGame(room));
  const stillWaiting = advance(order(order(room, one, "wait"), two, "wait"), 1);
  assert.equal(plan(stillWaiting).material?.state, "present");
  assert.equal(stillWaiting.wood, room.wood);
  assert.match(constructionStatus(room, planId).detail, /備蓄に戻/);
  const returned = ok(reclaimConstructionMaterial(room, planId));
  assert.equal(returned.wood, 1_000_000_000);
  assert.equal(bundle(returned), undefined);
  assert.deepEqual(plan(returned).material, {
    itemId,
    quantity: 6,
    state: "returned",
  });
  assert.ok(isGame(saved(returned)));
  assert.equal(reclaimConstructionMaterial(returned, planId).game, returned);
  assert.equal(
    createRoomConstruction(returned, request).planId,
    "construction-2",
  );
});

test("a released outlet bundle competes for space only after ordinary unpacking in the same minute", () => {
  const origin = staged();
  origin.wood = 999_999_994;
  origin.actors[1].cargo.wood = 4;
  const returning = hauling(
    ok(cancelRoomConstruction(origin, planId)),
    one,
    "return",
  );
  const underway = advance(order(returning, two, "wait"), 3);
  const due = advance(order(underway, two, "unpack", "wood"), 2);
  const exiting = ok(releaseConstructionWorker(due, planId));
  assert.equal(
    exiting.housing!.state.actors[one].order?.phase,
    "exiting-after-cancel",
  );
  // Minute preparation cancels this carrier; the admitted segment still lands on the outlet.
  const unfit = saved(due);
  unfit.actors[0].injury = 70;
  for (const [label, before] of [
    ["arrival", due],
    ["exit", exiting],
    ["injury before landing", unfit],
  ] as const) {
    assert.ok(isGame(before), label);
    const exported = (game: Game) =>
      importSlot(exportSlot({ id: "stock", name: "木材の回収", origin, game }));
    assert.deepEqual(exported(before).game, saved(before), label);
    const next = advance(before, 1);
    assert.ok(isGame(next), label + " must remain saveable");
    assert.equal(next.wood, 999_999_998);
    assert.equal(next.actors[1].cargo.wood, 0);
    assert.equal(plan(next).assignment, undefined);
    assert.equal(plan(next).material?.state, "present");
    assert.deepEqual(bundle(next).position, {
      kind: "at",
      point: plan(next).source,
    });
    assert.equal(
      next.wood + plan(next).material!.quantity,
      before.wood + before.actors[1].cargo.wood + 6,
    );
    assert.deepEqual(exported(next).game, saved(next), label);
    assert.deepEqual(exported(next).origin, saved(origin));
  }
  const exactlyEnough = saved(due);
  exactlyEnough.wood -= 4;
  const merged = advance(exactlyEnough, 1);
  assert.ok(isGame(merged));
  assert.equal(merged.wood, 1_000_000_000);
  assert.equal(plan(merged).material?.state, "returned");
  assert.equal(bundle(merged), undefined);
});
test("a returning carrier releases the source-floor bundle even if all but five units of storage are occupied", () => {
  const atStaging = advance(hauling(), 6);
  let g = hauling(ok(cancelRoomConstruction(atStaging, planId)), one, "return");
  g.wood = 999_999_995;
  assert.ok(isGame(g));
  const end = advance(g, 6);
  assert.equal(end.actors[0].task, null);
  assert.equal(plan(end).assignment, undefined);
  assert.equal(end.wood, 999_999_995);
  assert.deepEqual(bundle(end).position, {
    kind: "at",
    point: plan(end).source,
  });
  assert.ok(isGame(saved(end)));
  assert.match(end.actors[0].reason, /供給口/);
  assert.ok(reclaimConstructionMaterial(end, planId).error);
  const remote = saved(end);
  remote.wood--;
  bundle(remote).position = { kind: "at", point: plan(remote).staging };
  assert.ok(isGame(remote));
  assert.equal(
    reclaimConstructionMaterial(remote, planId).game,
    remote,
    "wood on a distant floor still needs physical return",
  );
  const room = saved(end);
  room.wood--;
  assert.equal(
    ok(reclaimConstructionMaterial(room, planId)).wood,
    1_000_000_000,
  );
});

test("save and resume retain actual build work, a reassigned worker's remaining minutes, cancellation exits and a completed receipt", () => {
  const at = staged();
  const start = building(at, two);
  const partial = advance(start, 12);
  assert.equal(plan(partial).workedMinutes, 7);
  const off = ok(releaseConstructionWorker(partial, planId));
  const resume = building(order(off, one, "cancel"), one);
  const done = advance(start, 35);
  const abort = ok(cancelRoomConstruction(advance(start, 1), planId));
  const states = [
    start,
    advance(start, 1),
    advance(start, 5),
    partial,
    off,
    resume,
    advance(resume, 1),
    advance(start, 34),
    done,
    abort,
    advance(abort, 2),
    ok(cancelRoomConstruction(partial, planId)),
  ];
  for (const [i, state] of states.entries()) {
    const loaded = saved(state);
    assert.equal(isGame(loaded), true, "boundary " + i);
    const copy = branchSlot(
      importSlot(
        exportSlot({ id: "building", name: "施工", origin: at, game: state }),
      ),
      false,
      "複製",
    );
    assert.deepEqual(copy.origin, saved(at));
    assert.deepEqual(advance(copy.game, 1), advance(state, 1));
  }
});

test("reject tampered assignment, use clock, slot permission, unfinished material or terminal receipt", () => {
  const active = advance(building(), 7),
    stopped = ok(releaseConstructionWorker(active, planId));
  const done = advance(active, 23),
    cancelled = ok(cancelRoomConstruction(stopped, planId));
  const claimed = ok(createRoomConstruction(done, request));
  const corruptions: [string, Game, (g: Game) => void][] = [
    [
      "no wood for seven minutes",
      stopped,
      (g) => {
        delete g.housing!.state.items[itemId];
        delete plan(g).material;
      },
    ],
    [
      "work at the source",
      stopped,
      (g) => {
        bundle(g).position = { kind: "at", point: plan(g).source };
      },
    ],
    [
      "more work than elapsed",
      stopped,
      (g) => {
        plan(g).createdAt = g.time - 1;
      },
    ],
    [
      "cancel before completed labor",
      cancelled,
      (g) => {
        plan(g).cancelledAt = plan(g).createdAt + 1;
      },
    ],
    [
      "next plan predates completion",
      claimed,
      (g) => {
        g.housing!.construction!.plans["construction-2"].createdAt = g.time - 1;
      },
    ],
    [
      "faked start",
      active,
      (g) => {
        Object.assign(plan(g).assignment!, { startedWorkMinutes: 2 });
      },
    ],
    [
      "extra build binding field",
      active,
      (g) => {
        g.actors[0].task!.spatial!.direction = "deliver";
      },
    ],
    [
      "build without member",
      active,
      (g) => {
        delete plan(g).assignment;
      },
    ],
    [
      "wrong build ID",
      active,
      (g) => {
        g.actors[0].task!.spatial!.constructionId = "other";
      },
    ],
    [
      "task time",
      active,
      (g) => {
        g.actors[0].task!.remaining--;
      },
    ],
    [
      "order use time",
      active,
      (g) => {
        g.housing!.state.actors[one].order!.useRemaining--;
      },
    ],
    [
      "wrong slot allowed people",
      active,
      (g) => {
        g.housing!.state.slots[g.actors[0].task!.station!].allowedActorIds = [];
      },
    ],
    [
      "forged second construction reservation",
      active,
      (g) => {
        g.actors[0].task!.reserved = { wood: 6 };
      },
    ],
    [
      "too early terminal",
      done,
      (g) => {
        plan(g).completedAt = plan(g).createdAt + 1;
      },
    ],
    [
      "missing completed timestamp",
      done,
      (g) => {
        delete plan(g).completedAt;
      },
    ],
    [
      "future completed timestamp",
      done,
      (g) => {
        plan(g).completedAt = g.time + 1;
      },
    ],
    [
      "nonexistent completed room",
      done,
      (g) => {
        plan(g).roomId = "room-182";
      },
    ],
    [
      "nonissued room",
      done,
      (g) => {
        plan(g).roomId = "living";
      },
    ],
    [
      "incomplete labor",
      done,
      (g) => {
        plan(g).workedMinutes = 29;
      },
    ],
    [
      "status timestamp conflict",
      done,
      (g) => {
        plan(g).cancelledAt = g.time;
      },
    ],
    [
      "fake completed record",
      done,
      (g) => {
        delete plan(g).material;
      },
    ],
    [
      "consumed wood reappeared",
      done,
      (g) => {
        g.housing!.state.items[itemId] = structuredClone(bundle(stopped));
      },
    ],
    [
      "unknown terminal key",
      done,
      (g) => {
        Object.assign(plan(g), { finished: true });
      },
    ],
    [
      "completed room on cancelled record",
      cancelled,
      (g) => {
        plan(g).roomId = "room-1";
      },
    ],
  ];
  const accepted = [];
  for (const [label, state, change] of corruptions) {
    const g = saved(state);
    change(g);
    if (isGame(g)) accepted.push(label);
  }
  assert.deepEqual(accepted, []);
});

test("completed rooms keep their issuance order across intervening furniture purchases", () => {
  const home = base();
  home.wood = 14;
  const first = advance(building(staged(home)), 30);
  const furnished = ok(
    applyHousingHouseEdit(
      first,
      editHouse(first.house, {
        type: "build",
        room: "yard",
        kind: "basin",
        cell: 8,
      }),
    ),
  );
  const newPlan = ok(
      createRoomConstruction(furnished, { ...request, name: "書斎" }),
    ),
    id = "construction-2";
  const reserve = ok(reserveConstructionMaterial(newPlan, id));
  const hauling = ok(assignConstructionHaul(reserve, id, one, "deliver"));
  const atSite = advance(hauling, 10); // staging -> source -> staging (5 min each)
  const second = advance(ok(assignConstructionBuild(atSite, id, one)), 30);
  assert.ok(isGame(saved(second)));
  assert.equal(plan(second).roomId, "room-1");
  assert.equal(second.housing!.construction!.plans[id].roomId, "room-3");
  const corrupt = saved(second);
  corrupt.housing!.construction!.plans[id].roomId = plan(first).roomId;
  assert.equal(isGame(corrupt), false);
  const swapped = saved(second);
  const plans = swapped.housing!.construction!.plans;
  [plans[planId].roomId, plans[id].roomId] = [
    plans[id].roomId,
    plans[planId].roomId,
  ];
  assert.equal(
    isGame(swapped),
    false,
    "swapping two real completed room IDs must be rejected",
  );
});

test("a completion receipt cannot point to an older setup room across a furniture gap and two-digit room IDs", () => {
  const old = base();
  delete old.housing;
  old.house.nextId = 9;
  old.house = editHouse(old.house, {
    type: "room",
    name: "作業室",
    neighbor: "living",
  });
  old.house = editHouse(old.house, {
    type: "build",
    kind: "basin",
    room: "room-9",
    cell: 8,
  });
  const origin = enableHousing(old, "new");
  assert.ok(isGame(origin));
  const done = advance(building(staged(origin)), 30);
  assert.equal(plan(done).roomId, "room-11");
  assert.ok(isGame(saved(done)));
  const renamed = saved(done);
  renamed.house.rooms.find((r) => r.id === "room-11")!.name = "窓辺の小部屋";
  assert.ok(isGame(renamed));
  const redirected = saved(done);
  plan(redirected).roomId = "room-9";
  assert.equal(isGame(redirected), false);
  assert.throws(() =>
    importSlot(
      exportSlot({ id: "wrong", name: "工事", origin, game: redirected }),
    ),
  );
});

test("an unregistered construction neighbor returns false even when the name is inherited by the access dictionary", () => {
  const original = saved(planned());
  assert.ok(isGame(original));
  for (const neighbor of ["constructor", "toString", "__proto__"]) {
    const invalid = saved(original);
    plan(invalid).neighborId = neighbor;
    plan(invalid).staging = housingPoint(neighbor, 2);
    assert.doesNotThrow(() => assert.equal(isGame(invalid), false), neighbor);
  }
});
