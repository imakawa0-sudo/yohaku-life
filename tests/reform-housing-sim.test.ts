import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  nextCompletionMinutes,
  options,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  setPriority,
  type Game,
} from "../src/reform/sim";
import { exportSlot, importSlot } from "../src/reform/library";
import { housingStatus } from "../src/reform/housing/presentation";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import { initialHouse } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [one, two] = people.map((p) => p.id);
const move = (roomId: string, cell: number) => JSON.stringify({ roomId, cell });
function base(n = 1, kitchen = false) {
  const house = initialHouse();
  if (kitchen) house.rooms[0].fixtures[0].kind = "kitchen";
  return createGame(
    people.slice(0, n),
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}
function check(g: Game) {
  assert.ok(isGame(g), "live state is valid");
  const loaded = JSON.parse(JSON.stringify(g));
  assert.ok(isGame(loaded), "saved state is valid");
  if (g.housing) assert.equal(g.time, g.housing.state.time);
  return loaded as Game;
}
function cmd(g: Game, id: string, kind: string, target?: string) {
  const next = order(g, id, kind, target);
  check(next);
  return next;
}
function step(g: Game, n = 1) {
  const next = advance(g, n);
  check(next);
  return next;
}
const pos = (g: Game, id = one) => g.housing!.state.actors[id]?.position;
const task = (g: Game, id = one) =>
  g.actors.find((a) => a.person.id === id)!.task;
test("actual route and use budget run once per global minute; previews and reservations are pure", () => {
  const g = enableHousing(base(), "new");
  const before = JSON.stringify(g);
  assert.equal(inspectOrder(g, one, "need", "bladder").minutes, 23);
  assert.equal(
    options(g, one).find((x) => x.kind === "need" && x.target === "bladder")!
      .minutes,
    23,
  );
  assert.equal(JSON.stringify(g), before);
  const active = cmd(g, one, "need", "bladder");
  assert.equal(task(active)!.remaining, 15);
  assert.equal(active.time, g.time);
  assert.equal(active.rng, g.rng);
  assert.equal(nextCompletionMinutes(active), 23);
  const arrived = step(active, 8);
  assert.equal(task(arrived)!.remaining, 15);
  assert.equal(housingStatus(arrived, one).phase, "use");
  assert.equal(arrived.actors[0].metrics.travel, 8);
  assert.ok(
    Math.abs(
      arrived.actors[0].needs.bladder - (g.actors[0].needs.bladder - 8 * 0.16),
    ) < 1e-8,
  );
  const last = step(arrived, 14);
  assert.equal(task(last)!.remaining, 1);
  assert.ok(last.actors[0].needs.bladder < g.actors[0].needs.bladder);
  const done = step(last);
  assert.equal(task(done), null);
  assert.ok(done.actors[0].needs.bladder > 95);
  assert.deepEqual(done, step(active, 23));
  assert.deepEqual(done, step(check(last)));
});
test("cooking reserves once and uses skill-adjusted minutes plus fixture time excluding travel", () => {
  const g = enableHousing(base(), "new");
  const a = g.actors[0];
  const expected =
    Math.ceil(32 * (1 - a.person.skills.cook * 0.035 - a.mood * 0.001)) + 10;
  const before = g.food;
  const active = cmd(g, one, "work", "cook");
  assert.equal(task(active)!.total, expected);
  assert.equal(active.ingredients, g.ingredients - 2);
  assert.equal(nextCompletionMinutes(active), expected + 2);
  const last = step(active, expected + 1);
  assert.equal(last.food, before);
  assert.ok(step(last).food > before);
  assert.equal(step(last).ingredients, active.ingredients);
});
test("a closed link pauses both clock estimate and job progress; reopening resumes same booking", () => {
  let g = enableHousing(base(), "new");
  g = cmd(g, one, "need", "bladder");
  const id = task(g)!.spatial!.orderId;
  const link = housingLinkId("bedroom", "yard");
  g = setHousingPassage(g, "link", link, false);
  check(g);
  const start = g.time;
  g = step(g, 4);
  assert.equal(housingStatus(g, one).waitReason, "physical-block");
  assert.equal(nextCompletionMinutes(g), null);
  assert.equal(task(g)!.remaining, 15);
  assert.equal(g.actors[0].metrics.waiting, 4);
  const again = setHousingPassage(check(g), "link", link, true);
  check(again);
  assert.equal(again.time, start + 4);
  assert.equal(task(again)!.spatial!.orderId, id);
  assert.equal(nextCompletionMinutes(again), 23);
  assert.equal(task(step(again, 23)), null);
});
test("mid-link cancel survives reload then exits just that segment, refunding exactly once; another actor keeps working", () => {
  const raw = base(2);
  raw.house.rooms[2].fixtures.push(raw.house.rooms[0].fixtures.shift()!);
  raw.house.rooms[2].fixtures.at(-1)!.cell = 6;
  let g = enableHousing(raw, "new");
  g = cmd(g, one, "work", "cook");
  g = cmd(g, two, "need", "energy");
  g = step(g);
  const otherId = task(g, two)!.spatial!.orderId;
  assert.equal(pos(g)!.kind, "transit");
  assert.match(inspectOrder(g, one, "leisure").disabled!, /区間/);
  const rejected = cmd(g, one, "leisure");
  assert.deepEqual(task(rejected), task(g));
  assert.deepEqual(rejected.housing, g.housing);
  const cancelling = cmd(g, one, "cancel");
  assert.equal(housingStatus(cancelling, one).phase, "cancelling");
  assert.equal(nextCompletionMinutes(cancelling), 2);
  const mid = step(check(cancelling));
  assert.equal(mid.ingredients, raw.ingredients - 2);
  g = step(cmd(mid, one, "cancel"));
  assert.equal(task(g), null);
  assert.equal(task(g, two)!.spatial!.orderId, otherId);
  assert.equal(g.ingredients, raw.ingredients);
  assert.equal(g.food, raw.food);
  assert.deepEqual(pos(g), { kind: "at", point: housingPoint("bedroom", 0) });
  assert.equal(cmd(g, one, "cancel").ingredients, raw.ingredients);
});
test("legacy task retains exact clock and material, cleans protected links only upon terminal or successful replacement", () => {
  const raw = step(cmd(base(), one, "work", "cook"), 2);
  const g = enableHousing(raw, "legacy");
  check(g);
  const original = task(raw)!;
  assert.deepEqual(task(g), original);
  const rejected = cmd(g, one, "home-move", move("living", 3));
  assert.deepEqual(task(rejected), original);
  assert.equal(pos(rejected), undefined);
  assert.deepEqual(check(rejected).housing!.legacyStationPaths[one], []);
  assert.equal(rejected.ingredients, raw.ingredients);
  const done = step(check(g), original.remaining);
  assert.equal(done.food, advance(raw, original.remaining).food);
  assert.equal(pos(done), undefined);
  assert.equal(done.housing!.legacyStationPaths[one], undefined);
  const replacement = cmd(g, one, "home-move", move("living", 2));
  assert.deepEqual(pos(replacement), {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.equal(replacement.ingredients, g.ingredients + 2);
  assert.equal(replacement.housing!.legacyStationPaths[one], undefined);
  assert.equal(
    cmd(g, one, "cancel").housing!.legacyStationPaths[one],
    undefined,
  );
});
test("known regional departure restores exact point on cancel and actual return sets living threshold; unknown stays unknown", () => {
  let g = enableHousing(base(), "new");
  g = step(cmd(g, one, "home-move", move("living", 2)), 2);
  const outbound = step(cmd(g, one, "travel", "landing"));
  assert.deepEqual(
    outbound.housing!.unlocated[one].departurePoint,
    housingPoint("living", 2),
  );
  assert.deepEqual(pos(cmd(check(outbound), one, "cancel")), pos(g));
  const outside = step(outbound, task(outbound)!.remaining);
  assert.equal(outside.housing!.unlocated[one].reason, "outside");
  const returning = cmd(outside, one, "return");
  assert.deepEqual(pos(step(returning, task(returning)!.remaining)), {
    kind: "at",
    point: housingPoint("living", 0),
  });
  const unknown = enableHousing(
    cmd(base(), one, "travel", "landing"),
    "legacy",
  );
  const cancelled = cmd(check(unknown), one, "cancel");
  assert.equal(pos(cancelled), undefined);
  assert.equal(cancelled.housing!.unlocated[one].reason, "legacy-unspecified");
});
test("pair actions need two stopped, known and coincident points; the partner is never relocated", () => {
  let g = enableHousing(base(2), "new");
  g = cmd(g, two, "leisure");
  g = step(cmd(g, one, "home-move", move("living", 1)));
  g = cmd(g, two, "cancel");
  assert.match(inspectOrder(g, one, "talk", two).disabled!, /同じ地点/);
  assert.deepEqual(pos(cmd(g, one, "talk", two), two), pos(g, two));
  g = cmd(g, two, "leisure");
  g = step(cmd(g, one, "home-move", move("living", 0)));
  g = cmd(g, two, "cancel");
  assert.equal(task(cmd(g, one, "talk", two))!.kind, "talk");
  const legacy = enableHousing(base(2), "legacy");
  assert.match(inspectOrder(legacy, one, "talk", two).disabled!, /同じ地点/);
});
test("overlap means actual simultaneous use; separate seats and staggered completion award each diner once", () => {
  const start = enableHousing(base(2, true), "new");
  let g = cmd(cmd(start, one, "need", "hunger"), two, "leisure");
  g = step(g, 3);
  g = cmd(g, two, "need", "hunger");
  assert.notEqual(task(g)!.station, task(g, two)!.station);
  g = step(g, 2);
  assert.deepEqual(task(g)!.spatial!.mealPartners ?? {}, {});
  assert.deepEqual(task(g, two)!.spatial!.mealPartners ?? {}, {});
  g = step(g);
  assert.equal(task(g)!.spatial!.mealPartners![two], 1);
  assert.equal(task(g, two)!.spatial!.mealPartners![one], 1);
  const together = step(check(g), task(g)!.remaining);
  const meals = (g: Game) =>
    g.actors.map(
      (a) => a.memories.filter((m) => m.label.includes("囲んだ食卓")).length,
    );
  assert.deepEqual(meals(together), [1, 0]);
  assert.deepEqual(
    meals(step(together, task(together, two)!.remaining)),
    [1, 1],
  );
  const legacy = enableHousing(
    cmd(cmd(base(2, true), one, "need", "hunger"), two, "need", "hunger"),
    "legacy",
  );
  assert.deepEqual(meals(step(legacy, task(legacy)!.remaining)), [0, 0]);
});
test("permission changes stop use without losing stock or progress and let the occupant leave", () => {
  const g = enableHousing(base(), "new");
  let denied = setHousingRoomAccess(
    step(cmd(g, one, "need", "hunger"), 3),
    "living",
    [],
  );
  const before = task(denied)!.remaining;
  denied = step(denied, 4);
  assert.equal(housingStatus(denied, one).waitReason, "use-denied");
  assert.equal(nextCompletionMinutes(denied), null);
  assert.equal(task(denied)!.remaining, before);
  assert.equal(denied.food, g.food - 1);
  assert.match(inspectOrder(denied, one, "need", "hunger").disabled!, /許可/);
  const resumed = setHousingRoomAccess(denied, "living", [one]);
  check(resumed);
  assert.equal(nextCompletionMinutes(resumed), before);
  assert.equal(task(step(resumed, before)), null);
  const moved = cmd(denied, one, "home-move", move("bedroom", 0));
  const away = step(moved, nextCompletionMinutes(moved)!);
  assert.match(
    inspectOrder(away, one, "home-move", move("living", 0)).disabled!,
    /入室/,
  );
});

test("rejected replacement at a standstill keeps order ID, partial use and stock; the approved command refunds and switches", () => {
  let g = enableHousing(base(), "new");
  g = step(cmd(g, one, "need", "hunger"), 3);
  const before = JSON.stringify(g);
  const verdict = inspectOrder(g, one, "home-move", move("living", 3));
  assert.match(verdict.disabled!, /通路/);
  assert.equal(JSON.stringify(g), before);
  const rejected = cmd(g, one, "home-move", move("living", 3));
  assert.deepEqual(rejected.housing, g.housing);
  assert.deepEqual(task(rejected), task(g));
  assert.equal(rejected.food, g.food);
  const newJob = cmd(rejected, one, "work", "cook");
  assert.equal(newJob.food, g.food + 1);
  assert.equal(newJob.ingredients, g.ingredients - 2);
  assert.equal(task(newJob)!.kind, "work");
});
test("an ordinary new home command establishes the legacy resident's current room entrance, and a same-point move takes one tick", () => {
  const raw = step(cmd(base(), one, "need", "bladder"), 1);
  let g = enableHousing(raw, "legacy");
  g = step(g, task(g)!.remaining);
  assert.equal(g.actors[0].room, "yard");
  assert.equal(pos(g), undefined);
  assert.equal(inspectOrder(g, one, "leisure").disabled, undefined);
  assert.equal(pos(g), undefined);
  g = cmd(g, one, "leisure");
  assert.deepEqual(pos(g), { kind: "at", point: housingPoint("yard", 0) });
  g = cmd(g, one, "home-move", move("yard", 0));
  assert.equal(nextCompletionMinutes(g), 1);
  assert.equal(task(step(g)), null);
});
test("two meals in the same room at different use points have no shared bonus", () => {
  const raw = base(2);
  raw.house.rooms[0].fixtures.push({
    id: "another-hearth",
    kind: "hearth",
    cell: 9,
  });
  let g = cmd(
    cmd(enableHousing(raw, "new"), one, "need", "hunger"),
    two,
    "need",
    "hunger",
  );
  g = step(g, 10);
  assert.equal(housingStatus(g, one).phase, "use");
  assert.equal(housingStatus(g, two).phase, "use");
  assert.notDeepEqual(pos(g), pos(g, two));
  assert.deepEqual(task(g)!.spatial!.mealPartners ?? {}, {});
  assert.deepEqual(task(g, two)!.spatial!.mealPartners ?? {}, {});
  g = step(g, Math.max(task(g)!.remaining, task(g, two)!.remaining));
  assert.ok(
    g.actors.every(
      (a) => !a.memories.some((m) => m.label.includes("囲んだ食卓")),
    ),
  );
});
test("after a traveller leaves a revoked room the remaining route estimate cannot count on re-entry", () => {
  const raw = base();
  raw.house.links.push(["living", "yard"]);
  let g = enableHousing(raw, "new");
  const direct = housingLinkId("living", "yard");
  g = setHousingPassage(g, "link", direct, false);
  g = step(cmd(g, one, "home-move", move("yard", 0)));
  g = setHousingPassage(g, "link", direct, true);
  g = setHousingPassage(g, "link", housingLinkId("bedroom", "yard"), false);
  g = setHousingRoomAccess(g, "living", []);
  assert.equal(nextCompletionMinutes(g), null);
  g = step(g, 3);
  assert.equal(housingStatus(g, one).waitReason, "entry-denied");
  assert.equal(g.actors[0].room, "bedroom");
});
test("automatic exhaustion during a multi-minute segment honors the same deferred cancellation", () => {
  const raw = base();
  raw.house.rooms[2].fixtures.push({
    ...raw.house.rooms[0].fixtures.shift()!,
    cell: 6,
  });
  let g = cmd(enableHousing(raw, "new"), one, "work", "cook");
  const t = task(g)!;
  t.mode = "auto";
  g.actors[0].memories.push({ label: "疲れ", value: -90, until: g.time + 100 });
  check(g);
  g = step(g);
  assert.equal(housingStatus(g, one).phase, "cancelling");
  assert.equal(g.ingredients, raw.ingredients - 2);
  g = step(check(g), 2);
  assert.equal(task(g), null);
  assert.equal(g.ingredients, raw.ingredients);
  assert.deepEqual(pos(g), { kind: "at", point: housingPoint("bedroom", 0) });
});
test("new and migrated diners cannot claim the same seat; a legacy diner contributes no overlap", () => {
  const raw = cmd(base(2, true), one, "need", "hunger");
  let g = enableHousing(raw, "legacy");
  assert.match(inspectOrder(g, two, "work", "cook").disabled!, /予約/);
  g = cmd(g, two, "need", "hunger");
  assert.equal(
    task(g, two)!.station,
    JSON.stringify(["slot", "living", "hearth-1", 1]),
  );
  g = step(g, 12);
  assert.ok(
    g.actors.every(
      (a) => !a.memories.some((m) => m.label.includes("囲んだ食卓")),
    ),
  );
});
test("two travellers keep their outside partition through rescue cancel and both get a new home position on arrival", () => {
  let g = enableHousing(base(2), "new");
  g = cmd(cmd(g, one, "travel", "pass"), two, "travel", "pass");
  g = step(g, Math.max(task(g)!.remaining, task(g, two)!.remaining));
  g.actors[0].injury = 80;
  g = cmd(g, two, "rescue", one);
  assert.equal(g.housing!.unlocated[one].reason, "regional-travel");
  assert.equal(g.housing!.unlocated[two].reason, "regional-travel");
  const canceled = cmd(check(step(g)), one, "cancel");
  assert.equal(canceled.housing!.unlocated[one].reason, "outside");
  assert.equal(canceled.housing!.unlocated[two].reason, "outside");
  g = step(check(g), task(g)!.remaining);
  assert.deepEqual(pos(g), { kind: "at", point: housingPoint("living", 0) });
  assert.deepEqual(pos(g), pos(g, two));
});
test("household meals in the field have no known shared equipment-use minutes", () => {
  let g = enableHousing(base(2), "new");
  g = step(cmd(cmd(g, one, "pack", "food"), two, "pack", "food"), 3);
  g = cmd(cmd(g, one, "travel", "landing"), two, "travel", "landing");
  g = step(g, Math.max(task(g)!.remaining, task(g, two)!.remaining));
  g = cmd(cmd(g, one, "need", "hunger"), two, "need", "hunger");
  g = step(g, 13);
  assert.ok(
    g.actors.every(
      (a) => !a.memories.some((m) => m.label.includes("囲んだ食卓")),
    ),
  );
});
test("home mentoring starts with a colocated learner and awards teaching only to someone actually there at completion", () => {
  const raw = base(2);
  raw.actors[0].person.skills.care = 6;
  let g = cmd(enableHousing(raw, "new"), one, "work", "care:master");
  assert.equal(task(g)!.target, "care:master");
  assert.equal(task(g, two), null);
  g = step(cmd(g, two, "home-move", move("living", 1)));
  g = cmd(g, two, "leisure");
  assert.match(
    inspectOrder(g, one, "work", "care:master").disabled!,
    /同じ地点/,
  );
  const xp = g.actors[1].xp.care;
  g = step(g, task(g)!.remaining);
  assert.equal(g.actors[1].xp.care, xp);
});
test("the public door control closes all adjoining paths without ticking time; two actors resume deterministically", () => {
  const raw = base(2, true);
  raw.house.rooms[0].doors = [1];
  raw.house.rooms[0].walls = [4];
  const entry = enableHousing(raw, "new");
  const g = cmd(cmd(entry, one, "need", "hunger"), two, "need", "hunger");
  const door = JSON.stringify(["door", "living", 1]);
  const closed = setHousingPassage(g, "door", door, false);
  check(closed);
  assert.equal(closed.time, g.time);
  const stalled = step(closed, 2);
  assert.equal(housingStatus(stalled, two).waitReason, "physical-block");
  const open = setHousingPassage(check(stalled), "door", door, true);
  const last = step(open, 11);
  assert.equal(task(last)!.remaining, 1);
  assert.equal(task(last, two)!.remaining, 1);
  assert.deepEqual(step(open, 12), step(check(last)));
  assert.deepEqual(step(open, 80), step(check(step(open, 37)), 43));
});

test("valid legacy room IDs round-trip even when longer than a legacy description field", () => {
  const raw = base();
  const roomId = "裏庭".repeat(175);
  raw.house.rooms[2].id = roomId;
  raw.house.links[1][1] = roomId;
  check(raw);
  const g = cmd(enableHousing(raw, "new"), one, "home-move", move(roomId, 1));
  const arrived = step(g, nextCompletionMinutes(g)!);
  assert.equal(arrived.actors[0].room, roomId);
});
test("resident dictionary keys that resemble standard object members remain ordinary IDs after JSON reload", () => {
  const raw = base();
  const id = "constructor";
  raw.actors[0].person.id = id;
  check(raw);
  const g = check(enableHousing(raw, "new"));
  assert.equal(housingStatus(g, id).phase, "idle");
  const moved = step(cmd(g, id, "home-move", move("living", 1)));
  assert.deepEqual(pos(moved, id), {
    kind: "at",
    point: housingPoint("living", 1),
  });
  const trip = cmd(moved, id, "travel", "landing");
  assert.deepEqual(pos(cmd(check(trip), id, "cancel"), id), pos(moved, id));
});

test("an unlocated legacy resident named constructor can preview options and issue a first order after reload", () => {
  const raw = base();
  const id = "constructor";
  raw.actors[0].person.id = id;
  const migrated = check(enableHousing(raw, "legacy"));
  const prior = JSON.stringify(migrated);
  assert.equal(Object.hasOwn(migrated.housing!.state.actors, id), false);
  assert.equal(inspectOrder(migrated, id, "need", "bladder").minutes, 23);
  assert.equal(
    options(migrated, id).find(
      (o) => o.kind === "need" && o.target === "bladder",
    )?.minutes,
    23,
  );
  assert.equal(JSON.stringify(migrated), prior);
  const started = cmd(migrated, id, "need", "bladder");
  assert.equal(task(started, id)!.target, "bladder");
  assert.deepEqual(pos(started, id), {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.equal(Object.hasOwn(started.housing!.unlocated, id), false);
});

test("a migrated master-care lesson completes the accepted teaching effect once after reload", () => {
  const raw = base(2);
  raw.actors[0].person.skills.care = 6;
  const teaching = step(
    cmd(cmd(raw, two, "recover"), one, "work", "care:master"),
  );
  const fork = check(enableHousing(teaching, "legacy"));
  assert.equal(fork.housing!.unlocated[one].reason, "legacy-unspecified");
  const remaining = task(teaching)!.remaining;
  const before = step(fork, remaining - 1);
  assert.equal(before.actors[1].xp.care, teaching.actors[1].xp.care);
  const expected = step(teaching, remaining);
  const done = step(check(before));
  assert.ok(expected.actors[1].xp.care > teaching.actors[1].xp.care);
  assert.equal(done.actors[1].xp.care, expected.actors[1].xp.care);
  assert.equal(done.actors[0].reason, expected.actors[0].reason);
  assert.equal(task(done), null);
  assert.equal(task(done, two)!.kind, "recover");
  assert.equal(done.housing!.unlocated[one].reason, "legacy-unspecified");
  assert.equal(step(check(done)).actors[1].xp.care, done.actors[1].xp.care);
});

const voice = "人の声に元気づけられた";
function socialVisit() {
  const raw = base(2);
  raw.actors[0].person.personality = "social";
  let g = cmd(enableHousing(raw, "new"), one, "home-move", move("bedroom", 0));
  g = step(cmd(g, two, "home-move", move("living", 1)));
  return step(cmd(g, two, "leisure"), 2);
}
function finishSocial(g: Game) {
  return step(g, housingStatus(g, one).minutes!);
}
test("a visitor who leaves before use earns neither conversation nor voice memory in either command order", () => {
  const start = socialVisit();
  const visitFirst = cmd(
    cmd(start, one, "need", "social"),
    two,
    "travel",
    "landing",
  );
  const departFirst = cmd(
    cmd(start, two, "travel", "landing"),
    one,
    "need",
    "social",
  );
  assert.doesNotMatch(task(visitFirst)!.label, /語らう/);
  const results = [visitFirst, departFirst].map((g) => {
    // A snapshot from the previous housing build can contain the older planning label.
    const saved = check(g);
    task(saved)!.label = "長椅子で語らう";
    return finishSocial(saved);
  });
  for (const g of results) {
    assert.match(g.actors[0].reason, /便り/);
    assert.ok(!g.actors[0].memories.some((m) => m.label === voice));
    assert.equal(g.actors[0].needs.social, 85);
  }
  assert.equal(results[0].time, results[1].time);
});
test("one later full minute of company survives export, departure and reload; cancellation grants no reward", () => {
  const raw = base(2);
  raw.actors[0].person.personality = "social";
  let g = cmd(enableHousing(raw, "new"), two, "leisure");
  g = step(cmd(g, one, "need", "social"), 3);
  assert.equal(task(g)!.spatial!.socialCompany, undefined);
  g = step(cmd(g, two, "home-move", move("living", 1)));
  assert.deepEqual(pos(g, two), pos(g));
  assert.equal(
    task(g)!.spatial!.socialCompany,
    undefined,
    "arrival alone is not a shared use minute",
  );
  g = step(cmd(g, two, "leisure"));
  assert.equal(task(g)!.spatial!.socialCompany, true);
  g = cmd(g, two, "travel", "landing");
  const restored = importSlot(
    exportSlot({ id: "visit", name: "長椅子", origin: raw, game: g }),
  ).game;
  const cancelled = cmd(restored, one, "cancel");
  assert.equal(
    cancelled.actors[0].needs.social,
    restored.actors[0].needs.social,
  );
  assert.ok(!cancelled.actors[0].memories.some((m) => m.label === voice));
  task(restored)!.label = "便りを書いて過ごす";
  const done = finishSocial(restored);
  assert.match(done.actors[0].reason, /語ら/);
  assert.equal(done.actors[0].needs.social, 100);
  const voices = done.actors[0].memories.filter((m) => m.label === voice);
  assert.equal(voices.length, 1);
  const after = step(cmd(check(done), one, "leisure"));
  assert.deepEqual(
    after.actors[0].memories.filter((m) => m.label === voice),
    voices,
  );
  assert.ok(after.actors[0].needs.social < done.actors[0].needs.social);
});

test("saved social observations require a social use, a consumed minute, another resident and a true marker", () => {
  const initial = cmd(enableHousing(base(2), "new"), two, "leisure");
  const social = cmd(initial, one, "need", "social");
  const malformed = (g: Game, value: unknown) => {
    const saved = JSON.parse(JSON.stringify(g));
    saved.actors[0].task.spatial.socialCompany = value;
    return isGame(saved);
  };
  assert.equal(malformed(social, true), false);
  const progress = step(social, 3);
  assert.equal(malformed(progress, true), true);
  for (const value of [false, 1, null, {}])
    assert.equal(malformed(progress, value), false);
  assert.equal(
    malformed(
      step(cmd(enableHousing(base(), "new"), one, "need", "social"), 3),
      true,
    ),
    false,
  );
  assert.equal(
    malformed(step(cmd(initial, one, "need", "hunger"), 4), true),
    false,
  );
  assert.equal(
    malformed(cmd(initial, one, "home-move", move("bedroom", 0)), true),
    false,
  );
});

test("legacy solo social work keeps its accepted result and voice memory through housing conversion", () => {
  const raw = base();
  raw.actors[0].person.personality = "social";
  const old = cmd(raw, one, "need", "social");
  for (const start of [old, enableHousing(old, "legacy")]) {
    const done = step(start, task(start)!.remaining);
    assert.match(done.actors[0].reason, /便り/);
    assert.ok(done.actors[0].memories.some((m) => m.label === voice));
  }
});

for (const kind of ["aid", "talk"] as const) {
  test(
    "autonomous " +
      kind +
      " reaches the eligible third resident in stable order",
    () => {
      const raw = base(3);
      raw.actors[0].person.personality = "social";
      const three = raw.actors[2].person.id;
      let g = cmd(
        cmd(enableHousing(raw, "new"), one, "leisure"),
        three,
        "leisure",
      );
      g = step(cmd(g, two, "home-move", move("bedroom", 0)), 3);
      g = cmd(cmd(g, one, "cancel"), three, "cancel");
      if (kind === "aid") {
        g.actors[1].injury = g.actors[2].injury = 20;
        g = setPriority(g, one, "care");
      } else {
        for (const id of [two, three]) g.actors[0].relations[id].trust = 1;
      }
      for (const swapped of [false, true]) {
        const trial = structuredClone(g);
        if (swapped)
          [trial.actors[1], trial.actors[2]] = [
            trial.actors[2],
            trial.actors[1],
          ];
        const started = step(trial);
        assert.equal(task(started)!.kind, kind);
        assert.equal(task(started)!.target, three);
        assert.equal(task(started, three)!.partner, one);
      }
    },
  );
}

test("a peer already at the use point through waiting and leaving before the next use minute earns no company", () => {
  let g = cmd(
    cmd(enableHousing(base(2), "new"), two, "home-move", move("living", 1)),
    one,
    "need",
    "social",
  );
  g = step(g);
  g = cmd(g, two, "leisure");
  const remaining = task(g)!.remaining;
  g = step(setHousingRoomAccess(g, "living", []), 3);
  assert.deepEqual(pos(g), pos(g, two));
  assert.equal(task(g)!.remaining, remaining);
  assert.equal(task(g)!.spatial!.socialCompany, undefined);
  g = cmd(
    setHousingRoomAccess(g, "living", null),
    two,
    "home-move",
    move("living", 0),
  );
  g = step(g);
  assert.equal(task(g)!.remaining, remaining - 1);
  assert.equal(task(g)!.spatial!.socialCompany, undefined);
});

test("the last social use minute can be the first observed, after a reload", () => {
  const raw = base(2);
  raw.actors[0].person.personality = "social";
  let g = cmd(
    cmd(enableHousing(raw, "new"), one, "need", "social"),
    two,
    "leisure",
  );
  g = step(g, housingStatus(g, one).minutes! - 2);
  g = step(cmd(g, two, "home-move", move("living", 1)));
  assert.equal(task(g)!.remaining, 1);
  assert.equal(task(g)!.spatial!.socialCompany, undefined);
  g = step(cmd(check(g), two, "leisure"));
  assert.match(g.actors[0].reason, /語ら/);
  assert.ok(g.actors[0].memories.some((m) => m.label === voice));
});

test("autonomous pairing keeps the first of two eligible partners in old, outdoor and home housing modes", () => {
  for (const kind of ["aid", "talk"]) {
    const raw = base(3);
    raw.actors[0].person.personality = "social";
    const field = structuredClone(raw);
    for (const a of field.actors) {
      a.location = "landing";
      a.room = "outdoors";
    }
    for (let g of [
      raw,
      enableHousing(field, "new"),
      enableHousing(raw, "new"),
    ]) {
      if (kind === "aid") {
        g.actors[1].injury = g.actors[2].injury = 20;
        g = setPriority(g, one, "care");
      } else {
        for (const peer of g.actors.slice(1))
          g.actors[0].relations[peer.person.id].trust = 1;
      }
      for (const peers of [g.actors.slice(1), g.actors.slice(1).reverse()]) {
        const done = step({ ...g, actors: [g.actors[0], ...peers] });
        assert.equal(task(done)!.kind, kind);
        assert.equal(task(done)!.partner, peers[0].person.id);
      }
    }
  }
});
