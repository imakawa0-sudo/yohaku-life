import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/game/engine.ts";
import { getSleepSite, inspectSleep, SLEEP_SITES } from "../src/game/overnight.ts";
import type { Action, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((resident) => resident.id === id)!;
const job = (kind: Action["kind"], extra: Partial<Action> = {}): Action => ({
  id: 21, kind, label: kind, duration: 30, progress: 0, ...extra,
});
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) freeze(entry);
  Object.freeze(value);
}

test("Sleep site profiles keep all four base rates and provide sheltered travelling places and the upstream bunk", () => {
  assert.equal(SLEEP_SITES.length, 7);
  for (const location of ["home", "kitchen", "bedroom", "garden"] as const) {
    const site = getSleepSite(location)!;
    assert.equal(site.location, location);
    assert.equal(site.kind, "base");
    assert.equal(site.energyPerMinute, 0.2);
    assert.equal(site.hpPerMinute, 0.04);
    assert.equal(site.healsWounds, true);
  }
  for (const [location, id, name] of [
    ["village", "village-rest", "集落の休み所"],
    ["shelter", "woodland-rest", "木陰の雨よけ"],
  ] as const) {
    const site = getSleepSite(location)!;
    assert.equal(site.id, id); assert.equal(site.name, name);
    assert.equal(site.location, location); assert.equal(site.kind, "travel");
    assert.equal(site.energyPerMinute, 0.16); assert.equal(site.hpPerMinute, 0.02);
    assert.equal(site.healsWounds, false);
    assert.match(site.description, /食事と手当用品.*持ち込/);
  }
  for (const location of ["road", "ruins", "meadow", "ridge", "unknown"])
    assert.equal(getSleepSite(location as LocationId), undefined);
});

test("Sleep projections are pure even on a frozen legacy save without optional inventory or regional state", () => {
  const s = createGame(914);
  s.version = 1;
  delete s.inventory; delete s.region; delete s.autonomy;
  person(s).location = "village";
  person(s).hunger = 0;
  s.minutes = 600;
  const before = JSON.stringify(s);
  freeze(s);
  assert.equal(inspectSleep(s, "aki").error, undefined, "hunger and time belong to the clock controls");
  assert.equal(inspectSleep(s, "aki").site?.kind, "travel");
  assert.equal(JSON.stringify(s), before);
  const copy = getSleepSite("village")!;
  copy.energyPerMinute = 99; copy.name = "別の名前";
  assert.equal(getSleepSite("village")!.energyPerMinute, 0.16);
  assert.equal(getSleepSite("village")!.name, "集落の休み所");
  assert.ok(Object.isFrozen(SLEEP_SITES));
  assert.ok(SLEEP_SITES.every(Object.isFrozen));
});

test("A present conscious resident can sleep at either travelling shelter without using remote warehouse supplies", () => {
  for (const location of ["village", "shelter"] as const) {
    const s = createGame(321);
    person(s).location = location;
    s.resources = { food: 100, ingredients: 100, medicine: 100, scrap: 100 };
    const before = JSON.stringify(s);
    const status = inspectSleep(s, "aki");
    assert.equal(status.error, undefined);
    assert.equal(status.site?.location, location);
    assert.equal(JSON.stringify(s), before, "availability cannot make meals, reserve stock or charge shelter fees");
    assert.deepEqual(s.inventory!.packs.aki, { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
  }
});

test("Missing people, unconsciousness, an ended world and unsafe or unsheltered places have explicit reasons", () => {
  const s = createGame();
  assert.match(inspectSleep(s, "missing").error!, /見つかりません/);
  for (const location of ["road", "ruins", "meadow", "ridge"] as const) {
    person(s).location = location;
    assert.match(inspectSleep(s, "aki").error!, /眠れる雨よけがありません/);
  }
  for (const location of ["home", "village", "shelter"] as const) {
    person(s).location = location;
    person(s).hp = 0;
    assert.match(inspectSleep(s, "aki").error!, /意識を失って/);
    person(s).hp = 100;
    s.enemy.location = location; s.enemy.hp = 80; s.enemy.defeated = false;
    assert.match(inspectSleep(s, "aki").error!, /交戦の危険/);
    s.enemy.defeated = true;
    assert.equal(inspectSleep(s, "aki").error, undefined);
    s.enemy.defeated = false; s.enemy.hp = 0;
    assert.equal(inspectSleep(s, "aki").error, undefined, "a nonliving guard is not a present threat");
  }
  s.ended = true;
  assert.match(inspectSleep(s, "aki").error!, /終了しています/);
});

test("Travellers finish or cancel active and held movement, rescue and battle orders before sleeping", () => {
  for (const location of ["village", "shelter"] as const) {
    for (const kind of ["move", "rescue", "attack", "defend"] as const) {
      for (const slot of ["action", "suspended"] as const) {
        for (const progress of [0, 1, 7]) {
          const s = createGame(); person(s).location = location;
          person(s)[slot] = job(kind, { progress, ...(kind === "move" ? { segmentProgress: progress, segmentDuration: 20 } : {}) });
          const before = JSON.stringify(s);
          assert.match(inspectSleep(s, "aki").error!, /指示.*終えるか取り消し/);
          assert.equal(JSON.stringify(s), before);
        }
      }
    }
  }
});

test("Active sleep and ordinary held work do not create a new travel blocker, and base jobs retain old eligibility", () => {
  for (const location of ["village", "shelter"] as const) {
    const s = createGame(); person(s).location = location;
    person(s).action = job("sleep", { origin: location });
    person(s).suspended = job("hobby", { id: 20, origin: "home" });
    assert.equal(inspectSleep(s, "aki").error, undefined);
  }
  for (const kind of ["move", "rescue", "attack", "defend"] as const) {
    const s = createGame();
    person(s).action = job(kind);
    person(s).suspended = job(kind, { id: 20 });
    assert.equal(inspectSleep(s, "aki").error, undefined, "the travelling restriction must not alter base job replacement");
  }
});

test("A conscious patient cannot lie down while an active or held same-place rescue is carrying them", () => {
  for (const location of ["village", "shelter"] as const) {
    for (const slot of ["action", "suspended"] as const) {
      const s = createGame();
      person(s).location = person(s, "mio").location = location;
      person(s).hp = 35;
      person(s, "mio")[slot] = job("rescue", { target: "aki" });
      const before = JSON.stringify(s);
      assert.match(inspectSleep(s, "aki").error!, /救助・運搬中/);
      assert.equal(JSON.stringify(s), before);
      person(s).hp = 35.01;
      assert.equal(inspectSleep(s, "aki").error, undefined, "a no-longer-valid rescue is not carrying a recovered person");
      person(s).hp = 35; person(s, "mio").location = "home";
      assert.equal(inspectSleep(s, "aki").error, undefined, "an old remote claim cannot carry this person");
      person(s, "mio").location = location; person(s, "mio").hp = 0;
      assert.equal(inspectSleep(s, "aki").error, undefined, "an unconscious carrier cannot continue transport");
    }
  }
});
