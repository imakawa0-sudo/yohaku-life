import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { presetPeople } from "@reform/Setup";
import { defaultWorldConfig, generateWorld } from "@reform/world";
import { initialHouse, editHouse } from "@reform/house";
import {
  createGame,
  setBond,
  enableHousing,
  advance,
  order,
  inspectOrder,
  isGame,
} from "@reform/sim";
import { exportSlot, importSlot, branchSlot } from "@reform/library";
import { housingStatus } from "@reform/housing/presentation";
import { applyHousingHouseEdit } from "@reform/housing/runtime";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "@reform/housing/construction";

const residents = presetPeople(0);
const [kaya, sui] = residents.map((p) => p.id);
const g = enableHousing(
  setBond(
    createGame(
      residents,
      generateWorld(defaultWorldConfig()),
      "forest",
      initialHouse(),
    ),
    kaya,
    sui,
    "friend",
  ),
  "new",
);
const slot = {
  name: "カヤ・スイの暮らし",
  id: "origin",
  game: g,
  origin: structuredClone(g),
};
const stable = (x) => JSON.parse(JSON.stringify(x));
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const originHash = hash(g);
const planId = "construction-1";
const stock = (s) =>
  Object.fromEntries(
    ["wood", "food", "ingredients", "coins"].map((k) => [k, s[k]]),
  );
const actor = (s, id) => s.actors.find((a) => a.person.id === id);
const current = (s, id) => {
  const a = actor(s, id);
  return {
    position: s.housing.state.actors[id]?.position,
    task: a.task && {
      kind: a.task.kind,
      target: a.task.target,
      label: a.task.label,
      remaining: a.task.remaining,
      mode: a.task.mode,
      station: a.task.station ?? null,
    },
    needs: a.needs,
    metrics: a.metrics,
    xp: a.xp,
    skills: a.person.skills,
    injury: a.injury,
    memories: a.memories,
  };
};
const snap = (s) => ({
  time: s.time,
  stock: stock(s),
  kaya: current(s, kaya),
  sui: current(s, sui),
});
const result = (r) => {
  assert.equal(r.error, undefined);
  return r.game;
};
function issued(s, id, kind, target?) {
  const verdict = inspectOrder(s, id, kind, target);
  assert.ok(!verdict.disabled, verdict.disabled);
  return order(s, id, kind, target);
}
const shelf = (s, room, cell = 2) =>
  result(
    applyHousingHouseEdit(
      s,
      editHouse(s.house, { type: "build", kind: "shelf", room, cell }),
    ),
  );
function step(s) {
  const n = advance(s, 1);
  assert.equal(n.time, s.time + 1);
  return n;
}
function run(s, n) {
  const r = advance(s, n);
  assert.equal(r.time, s.time + n);
  assert.ok(isGame(r));
  return r;
}
function delta(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((k) => [k, after[k] - before[k]]),
  );
}
function trial(expand) {
  const runSlot = branchSlot(slot, true, expand ? "増築" : "既存");
  let s = runSlot.game;
  const events = [];
  const note = (label) => events.push({ label, ...snap(s) });
  let dest = "living";
  if (expand) {
    s = result(
      createRoomConstruction(s, {
        name: "読書室",
        neighborId: "bedroom",
        stagingCell: 2,
      }),
    );
    note("plan");
    s = result(reserveConstructionMaterial(s, planId));
    note("reserve");
    s = result(assignConstructionHaul(s, planId, sui, "deliver"));
    note("haul order");
  } else {
    s = shelf(s, dest);
    s = issued(s, sui, "work", "wood");
    note("existing shelf, Sui starts wood");
  }
  s = issued(s, kaya, "work", "wood:hard");
  note("Kaya starts common wood");
  const ticks = [];
  while (s.time < 516) {
    if (!actor(s, kaya).task) {
      s = issued(s, kaya, "work", "wood:hard");
      note("Kaya repeats common wood");
    }
    const was = s;
    s = step(s);
    if (
      expand &&
      was.housing.construction.plans[planId].assignment?.kind === "deliver"
    ) {
      ticks.push({
        time: s.time,
        delta: delta(actor(was, sui).metrics, actor(s, sui).metrics),
        phase: was.housing.state.actors[sui].order?.phase,
        from: was.housing.state.actors[sui].position,
        to: s.housing.state.actors[sui].position,
        itemAfter: Object.values(s.housing.state.items)[0]?.position,
      });
      if (!s.housing.construction.plans[planId].assignment) {
        note("delivery arrived");
        s = result(assignConstructionBuild(s, planId, sui));
        note("build order");
      }
    }
    if (was.actors[1].task?.kind === "work" && !s.actors[1].task)
      note("Sui wood job done");
  }
  if (expand) {
    assert.equal(s.housing.construction.plans[planId].status, "completed");
    dest = s.housing.construction.plans[planId].roomId;
    note("built");
    s = shelf(s, dest);
    note("new shelf");
  }
  // Sui continues freely in both branches and Kaya receives a direct rest instruction from the same place and time.
  const beforeRead = s;
  const preview = inspectOrder(s, kaya, "need", "fun");
  s = issued(s, kaya, "need", "fun");
  note("ordered reading");
  const selected = housingStatus(s, kaya);
  assert.match(selected.destination, /本棚と読書椅子/);
  const useBudget = actor(s, kaya).task.total;
  while (actor(s, kaya).task.remaining === useBudget) s = step(s);
  s = run(s, 3);
  const checkpoint = s;
  const payload = exportSlot({ ...runSlot, game: checkpoint });
  const imported = importSlot(payload);
  assert.deepEqual(stable(imported.game), stable(checkpoint));
  assert.deepEqual(stable(imported.origin), stable(g));
  const left = actor(checkpoint, kaya).task.remaining;
  const beforeDone = run(s, left - 1);
  s = step(beforeDone);
  assert.equal(actor(s, kaya).task, null);
  assert.deepEqual(stable(run(imported.game, left)), stable(s));
  const readDone = s;
  note("reading done");
  const finish = run(s, 1920 - s.time);
  note("autonomy begins after reading");
  assert.ok(isGame(finish));
  assert.deepEqual(stable(g), stable(slot.origin));
  return {
    events,
    ticks,
    beforeRead: snap(beforeRead),
    preview,
    selected,
    useBudget,
    reading: {
      elapsed: readDone.time - beforeRead.time,
      kaya: delta(
        actor(beforeRead, kaya).metrics,
        actor(readDone, kaya).metrics,
      ),
      sui: delta(actor(beforeRead, sui).metrics, actor(readDone, sui).metrics),
      funAtStart: actor(beforeRead, kaya).needs.fun,
      funBeforeLast: actor(beforeDone, kaya).needs.fun,
      funDone: actor(readDone, kaya).needs.fun,
      quietMemory: actor(readDone, kaya).memories.filter(
        (m) => m.label === "静かな自由時間",
      ),
      doneAt: readDone.time,
    },
    checkpoint: {
      time: checkpoint.time,
      left,
      station: actor(checkpoint, kaya).task.station,
      reservations: checkpoint.housing.state.reservations,
      stock: stock(checkpoint),
      originHash: hash(imported.origin),
      matchedThroughCompletion: true,
    },
    morning: snap(finish),
    beforeReadState: beforeRead,
  };
}
const A = trial(true),
  B = trial(false);
assert.deepEqual(A.beforeRead.kaya.position, B.beforeRead.kaya.position);
assert.equal(A.beforeRead.time, B.beforeRead.time);
assert.deepEqual(A.beforeRead.kaya.metrics, B.beforeRead.kaya.metrics);
const extra = shelf(A.beforeReadState, "living", 2);
const alternative = issued(extra, kaya, "need", "fun");
const more = {
  multipleShelves: extra.house.rooms.flatMap((r) =>
    r.fixtures
      .filter((f) => f.kind === "shelf")
      .map((f) => ({ room: r.id, id: f.id, cell: f.cell })),
  ),
  selected: housingStatus(alternative, kaya),
  preview: inspectOrder(extra, kaya, "need", "fun"),
};
const earlyB = shelf(g, "living");
const earlyBOrder = issued(earlyB, kaya, "need", "fun");
const earliestB = housingStatus(earlyBOrder, kaya);
const workshop = {};
for (const target of ["wood", "wood:hard", "wood:master", "cook"]) {
  const issuedWork = issued(g, kaya, "work", target);
  workshop[target] = current(issuedWork, kaya).task;
}
delete A.beforeReadState;
delete B.beforeReadState;
console.log(
  JSON.stringify(
    {
      originHash,
      origin: snap(g),
      control:
        "Both branches use original 08:00 public UI preset with friendships, 4x3 rooms, furniture cell 2, open passages. Kaya works same hard wood orders until 08:36 then uses fun from living threshold. A Sui hauls then builds, B Sui works wood once. After 08:36 Sui acts autonomously, after reading both act autonomously until 08:00 next day.",
      A,
      B,
      earliestB,
      more,
      workshop,
    },
    null,
    2,
  ),
);
