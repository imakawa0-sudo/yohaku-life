import test from "node:test";
import assert from "node:assert/strict";
import { decideAutonomy, validAutonomy } from "../src/game/autonomy.ts";
import { createGame } from "../src/game/engine.ts";
import { accessibleResources } from "../src/game/inventory.ts";
import { getRoutine, getWishKind, initializeResidentProfiles, validRoutine } from "../src/game/routines.ts";
import type { Action, GameState, Resident, ResidentRoutine } from "../src/game/types.ts";

const support: ResidentRoutine = { workRole: "support", home: "home", leisure: "quiet" };
const find = (s: GameState, id: string) => s.residents.find((r) => r.id === id)!;
const action = (kind: Action["kind"], extra: Partial<Action> = {}): Action =>
  ({ id: 1, kind, label: kind, duration: 40, progress: 0, ...extra });

function household(): GameState {
  const s = createGame(4521);
  s.resources.food = 12;
  s.resources.ingredients = 12;
  const originals = s.residents.slice(1);
  s.residents = [s.residents[0], ...originals.map((r, i): Resident => ({
    ...r, id: i ? "alpha" : "zulu", name: i ? "散歩好き" : "台所好き",
    location: "home", action: null, suspended: null, hunger: 100, energy: 100,
    routine: { ...support }, wishKind: "settle", relations: {},
  }))];
  return s;
}

const decision = (s: GameState, id: string) => decideAutonomy(s, id, () => 3, accessibleResources(s, id));
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

test("Profiles retain the legacy household defaults and unknown people receive an independent default", () => {
  const s = createGame();
  for (const r of s.residents) { delete r.routine; delete r.wishKind; }
  assert.deepEqual(getRoutine(find(s, "mio")), { workRole: "cook", home: "home", leisure: "social" });
  assert.deepEqual(getRoutine(find(s, "ren")), { workRole: "gather", home: "bedroom", leisure: "quiet" });
  assert.deepEqual(getRoutine(find(s, "aki")), support);
  assert.deepEqual(s.residents.map(getWishKind), ["display", "household-meal", "safe-return"]);
  const stranger = { ...s.residents[0], id: "someone" };
  assert.equal(getWishKind(stranger), "settle");
  const changed = getRoutine(stranger);
  changed.home = "garden";
  assert.deepEqual(getRoutine(stranger), support);
  assert.equal(stranger.routine, undefined);
  for (const id of ["toString", "constructor", "__proto__"]) {
    assert.deepEqual(getRoutine({ ...stranger, id }), support);
    assert.equal(getWishKind({ ...stranger, id }), "settle");
  }
});

test("Initialization only fills missing profile data without advancing time, randomness, or replacing explicit choices", () => {
  const s = household();
  delete find(s, "zulu").routine;
  delete find(s, "zulu").wishKind;
  const explicit = find(s, "alpha").routine!;
  const before = structuredClone(s);
  initializeResidentProfiles(s);
  const expected = structuredClone(before);
  find(expected, "aki").routine ??= { ...support };
  find(expected, "aki").wishKind ??= "display";
  find(expected, "zulu").routine = { ...support };
  find(expected, "zulu").wishKind = "settle";
  assert.deepEqual(s, expected);
  assert.equal(find(s, "alpha").routine, explicit);
  initializeResidentProfiles(s);
  assert.deepEqual(s, expected);
});

test("Routine validation accepts only the supported complete profile", () => {
  assert.equal(validRoutine(support), true);
  assert.equal(validRoutine({ workRole: "cook", home: "garden", leisure: "social" }), true);
  for (const bad of [null, [], {}, { ...support, workRole: "combat" }, { ...support, home: "village" },
    { ...support, leisure: "solo" }, { ...support, extra: true }, { workRole: "cook", home: "home" }])
    assert.equal(validRoutine(bad), false);
});

test("Generic residents take primary work from their profiles and respond to a later role change", () => {
  const s = household();
  find(s, "zulu").routine!.workRole = "cook";
  find(s, "alpha").routine!.workRole = "gather";
  find(s, "alpha").skills.cooking = 10;
  s.resources.food = 0;
  s.resources.ingredients = 2;
  assert.equal(decision(s, "zulu")?.kind, "cook", "The designated cook wins over a skilled substitute");
  assert.equal(decision(s, "alpha")?.reason.code, "gathering");
  find(s, "zulu").routine!.workRole = "gather";
  find(s, "alpha").routine!.workRole = "cook";
  assert.equal(decision(s, "alpha")?.kind, "cook");
  assert.equal(decision(s, "zulu")?.reason.code, "gathering");
  s.residents.reverse();
  assert.equal(decision(s, "alpha")?.kind, "cook", "Roster order does not choose the designated worker");
});

test("Unavailable primary work admits an eligible substitute while explicit policy overrides a support role", () => {
  const s = household();
  const primary = find(s, "zulu");
  const substitute = find(s, "alpha");
  primary.routine!.workRole = "cook";
  s.resources.food = 0;
  primary.location = "village";
  assert.equal(decision(s, "alpha")?.kind, "cook");
  primary.location = "home";
  primary.action = action("hobby");
  assert.equal(decision(s, "alpha")?.kind, "cook");
  primary.action = null;
  primary.policy = "rest";
  assert.equal(decision(s, "alpha")?.kind, "cook");
  primary.policy = "balanced";
  substitute.policy = "cook";
  assert.equal(decision(s, "alpha")?.kind, "cook");
  substitute.policy = "gather";
  s.resources.ingredients = 8;
  assert.equal(decision(s, "alpha")?.reason.code, "gathering");
});

test("Fallback work ranks cooking or craft skill then stable identity independently of roster order", () => {
  const s = household();
  const alpha = find(s, "alpha"), zulu = find(s, "zulu");
  s.resources.food = 0;
  alpha.skills.cooking = 7;
  zulu.skills.cooking = 2;
  assert.equal(decision(s, "alpha")?.kind, "cook");
  assert.notEqual(decision(s, "zulu")?.kind, "cook");
  zulu.skills.cooking = 7;
  assert.equal(decision(s, "alpha")?.kind, "cook");
  s.residents.reverse();
  assert.equal(decision(s, "alpha")?.kind, "cook");
  s.resources.ingredients = 0;
  zulu.skills.craft = 8;
  alpha.skills.craft = 1;
  assert.equal(decision(s, "zulu")?.reason.code, "gathering");
  assert.notEqual(decision(s, "alpha")?.reason.code, "gathering");
});

test("An unavailable ingredient owner cannot block another person's locally possible cooking", () => {
  const s = household();
  s.resources.food = 0;
  s.resources.ingredients = 0;
  find(s, "zulu").routine!.workRole = "cook";
  s.inventory!.packs.alpha = { food: 0, ingredients: 2, medicine: 0, scrap: 0 };
  assert.equal(decision(s, "alpha")?.kind, "cook");
});

test("Direct and suspended instructions and existing claims remain authoritative for generic residents", () => {
  const s = household();
  const alpha = find(s, "alpha"), zulu = find(s, "zulu");
  s.resources.food = 0;
  alpha.action = action("hobby");
  assert.equal(decision(s, "alpha"), undefined);
  alpha.action = null;
  alpha.suspended = action("gather");
  assert.equal(decision(s, "alpha"), undefined);
  alpha.suspended = null;
  zulu.suspended = action("cook", { reserved: { ingredients: 2 } });
  assert.notEqual(decision(s, "alpha")?.kind, "cook");
  zulu.suspended = null;
  zulu.action = action("move", { target: "kitchen", automatic: true, autonomyNext: "cook" });
  assert.notEqual(decision(s, "alpha")?.kind, "cook");
  zulu.action = action("gather");
  s.resources.ingredients = 0;
  assert.notEqual(decision(s, "alpha")?.reason.code, "gathering");
});

test("Home and quiet or social leisure come from profiles while manual stays and daily limits remain", () => {
  const s = household();
  const alpha = find(s, "alpha");
  alpha.routine = { workRole: "support", home: "kitchen", leisure: "quiet" };
  assert.equal(decision(s, "alpha")?.target, "kitchen");
  s.autonomy = { version: 1, leisure: {}, manualStays: { alpha: { time: s.minutes, location: "home", source: "arrival" } }, conversations: {}, mealPairs: {} };
  assert.equal(decision(s, "alpha"), undefined);
  s.minutes += 60;
  assert.equal(decision(s, "alpha")?.target, "kitchen");
  alpha.location = "kitchen";
  assert.equal(decision(s, "alpha")?.leisure, "quiet");
  s.autonomy.leisure.alpha = { day: Math.floor(s.minutes / 1440) + 1, startedAt: s.minutes, kind: "quiet", actionId: 1 };
  assert.equal(decision(s, "alpha"), undefined);
  delete s.autonomy.leisure.alpha;
  alpha.routine = { ...support, leisure: "social" };
  alpha.location = "home";
  find(s, "zulu").action = action("hobby");
  assert.equal(decision(s, "alpha")?.leisure, "help");
  find(s, "zulu").action = null;
  assert.equal(decision(s, "alpha")?.leisure, "social");
});

test("Projection and decisions accept frozen saves and the protagonist remains manual regardless of profile", () => {
  const s = household();
  find(s, "aki").routine = { workRole: "cook", home: "garden", leisure: "social" };
  s.resources.food = 0;
  const before = JSON.stringify(s);
  freeze(s);
  for (const r of s.residents) { getRoutine(r); getWishKind(r); decision(s, r.id); }
  assert.equal(decision(s, "aki"), undefined);
  assert.equal(JSON.stringify(s), before);
  const invalid = structuredClone(s);
  find(invalid, "aki").action = action("cook", {
    automatic: true, autonomyReason: { code: "cooking", text: "料理する", decidedAt: invalid.minutes },
  });
  assert.equal(validAutonomy(invalid), false);
});
