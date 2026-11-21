import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  command,
  createGame,
  deserialize,
  serialize,
} from "../src/game/engine.ts";
import {
  deriveAttention,
  getInterruptedActionSummary,
  getLogFocusResident,
} from "../src/game/presentation.ts";
import type { Command, GameLog, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command) {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function pausedCooking() {
  let state = act(createGame(2026), {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  state = advance(state, 5);
  return act(state, { type: "pause", residentId: "mio" });
}

test("A peaceful world has no outstanding attention even if an old notification names danger or injury", () => {
  const state = createGame(2026);
  state.enemy.alerted = true;
  state.pauseReason = "アキが倒れました。戦闘・救助・手当が必要です。";
  assert.deepEqual(deriveAttention(state), []);
});

test("Unresolved hunger and fatigue remain visible without recreating an old pause notification", () => {
  const state = createGame(2026);
  person(state).hunger = 18;
  person(state).energy = 10;
  const before = serialize(state);
  const attention = deriveAttention(state);
  assert.deepEqual(
    attention.map((item) => item.kind),
    ["hunger", "fatigue"],
  );
  assert.match(attention[0].detail, /利用できる食事は6食/);
  assert.match(attention[1].detail, /進捗や材料/);
  assert.equal(serialize(state), before);
  const eating = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "eat",
  });
  assert.match(
    deriveAttention(eating).find((item) => item.kind === "hunger")!.title,
    /食事をとっています/,
  );
  person(eating).hp = 0;
  assert.ok(
    !deriveAttention(eating).some(
      (item) => item.kind === "hunger" || item.kind === "fatigue",
    ),
  );
});

test("Attention keeps simultaneous combat, a downed resident and injuries attached to their actual people and locations", () => {
  const state = createGame(2026);
  person(state).location = "ruins";
  person(state).hp = 0;
  person(state, "mio").location = "ruins";
  person(state, "mio").hp = 72;
  person(state, "mio").wounds.arm = 1;
  person(state, "ren").location = "garden";
  person(state, "ren").hp = 90;
  const before = serialize(state);
  const attention = deriveAttention(state);
  assert.deepEqual(
    new Set(attention.map((item) => item.id)),
    new Set(["rescue:aki", "combat:mio", "treatment:mio", "treatment:ren"]),
  );
  assert.equal(attention[0].kind, "rescue");
  assert.equal(
    attention.find((item) => item.id === "rescue:aki")?.location,
    "ruins",
  );
  assert.equal(
    attention.find((item) => item.id === "treatment:ren")?.location,
    "garden",
  );
  assert.ok(
    attention
      .find((item) => item.id === "treatment:mio")
      ?.detail.includes("腕 1"),
  );
  assert.equal(
    serialize(state),
    before,
    "Deriving the display must not advance or mutate the shared world",
  );
});

test("A downed person already at base gets recovery guidance rather than a new rescue journey", () => {
  const state = createGame(2026);
  person(state).hp = 0;
  person(state).location = "bedroom";
  const attention = deriveAttention(state);
  assert.equal(attention.length, 1);
  assert.equal(attention[0].kind, "recovery");
  assert.equal(attention[0].location, "bedroom");
  assert.ok(attention[0].detail.includes("すでに拠点内"));
  assert.ok(attention[0].detail.includes("手当や休息"));
});

test("Rescue attention names an existing carrier, including a paused rescue, instead of encouraging a second carrier", () => {
  let state = createGame(2026);
  person(state).hp = 0;
  person(state).location = "road";
  person(state, "ren").location = "road";
  state = act(state, {
    type: "assign",
    residentIds: ["ren"],
    kind: "rescue",
    target: "aki",
  });
  const active = deriveAttention(state).find(
    (item) => item.residentId === "aki",
  )!;
  assert.equal(active.kind, "rescue");
  assert.ok(active.title.includes("運搬"));
  assert.ok(active.detail.includes("レン"));
  state = act(state, { type: "pause", residentId: "ren" });
  const paused = deriveAttention(state).find(
    (item) => item.residentId === "aki",
  )!;
  assert.ok(paused.detail.includes("レン"));
  assert.ok(paused.detail.includes("中断中"));
  state = act(state, { type: "resume", residentId: "ren" });
  const remaining = person(state, "ren").action!.duration - person(state, "ren").action!.progress;
  assert.ok(remaining > 25, "Carrying a person uses the actual path and transport load");
  state = advance(state, remaining);
  const returned = deriveAttention(state).find(
    (item) => item.residentId === "aki",
  )!;
  assert.equal(person(state).location, "home");
  assert.equal(returned.kind, "recovery");
});

test("A conscious heavy casualty being carried is described as transport, not unconscious or a new rescue target", () => {
  let state = createGame(2026);
  person(state).hp = 20;
  person(state).location = "road";
  person(state, "ren").location = "road";
  state = act(state, {
    type: "assign",
    residentIds: ["ren"],
    kind: "rescue",
    target: "aki",
  });
  const attention = deriveAttention(state).filter(
    (item) => item.residentId === "aki",
  );
  assert.equal(attention.length, 1);
  assert.equal(attention[0].kind, "rescue");
  assert.ok(attention[0].title.includes("運搬"));
  assert.ok(!attention[0].detail.includes("意識がありません"));
});

test("Treatment reflects recorded wounds even at full health and avoids inventing a wound for health loss alone", () => {
  const state = createGame(2026);
  person(state).wounds.leg = 2;
  person(state, "mio").hp = 98;
  const attention = deriveAttention(state);
  assert.ok(
    attention
      .find((item) => item.residentId === "aki")
      ?.detail.includes("脚 2"),
  );
  const lowered = attention.find((item) => item.residentId === "mio")!;
  assert.ok(lowered.title.includes("体力"));
  assert.ok(!lowered.detail.includes("負傷"));
  assert.ok(lowered.detail.includes("98 / 100"));
});

test("Resolving a condition removes its attention without erasing the old journal or relying on pause text", () => {
  let state = createGame(2026);
  person(state).location = "ruins";
  person(state).hp = 70;
  person(state).wounds.body = 1;
  assert.ok(deriveAttention(state).some((item) => item.kind === "combat"));
  state.enemy.defeated = true;
  state.enemy.alerted = true;
  assert.ok(!deriveAttention(state).some((item) => item.kind === "combat"));
  assert.ok(deriveAttention(state).some((item) => item.kind === "treatment"));
  person(state).location = "home";
  person(state).hp = 100;
  person(state).wounds.body = 0;
  const journal = serialize(state.logs);
  state.pauseReason = "古い危険の通知";
  assert.deepEqual(deriveAttention(state), []);
  assert.equal(serialize(state.logs), journal);
});

test("An escaped resident no longer has combat attention while actual remaining injuries stay visible", () => {
  let state = createGame(2026);
  person(state).location = "ruins";
  state.enemy.alerted = true;
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "road",
  });
  state = advance(state, 1);
  assert.ok(deriveAttention(state).some((item) => item.kind === "combat"));
  state = advance(state, 1);
  assert.ok(!deriveAttention(state).some((item) => item.kind === "combat"));
  assert.ok(deriveAttention(state).some((item) => item.kind === "treatment"));
});

test("Journal focus uses actual actor IDs and never guesses from witnesses or narrative names", () => {
  const state = createGame(2026);
  const log: GameLog = {
    id: 77,
    time: state.minutes,
    type: "combat",
    title: "アキのこと",
    text: "アキがいるとミオは思った。",
    actors: ["ren", "aki"],
    witnesses: ["mio"],
  };
  assert.equal(getLogFocusResident(state, log), "ren");
  assert.equal(getLogFocusResident(state, { ...log, actors: [] }), null);
  assert.equal(
    getLogFocusResident(state, { ...log, actors: ["missing", "mio"] }),
    "mio",
  );
  assert.equal(
    getLogFocusResident(state, { ...log, actors: ["missing"] }),
    null,
  );
});

test("Interrupted cooking presents its real progress, place and protected materials across save/load without changing them", () => {
  const state = pausedCooking();
  const before = serialize(state);
  const action = person(state, "mio").suspended!;
  const summary = getInterruptedActionSummary(state, "mio")!;
  assert.equal(summary.progress, 5);
  assert.equal(summary.duration, action.duration);
  assert.equal(summary.remaining, action.duration - 5);
  assert.equal(summary.percent, Math.round((5 / action.duration) * 100));
  assert.equal(summary.continuous, false);
  assert.equal(summary.location, "home");
  assert.deepEqual(summary.reserved, { ingredients: 2 });
  assert.ok(summary.reservationText.includes("食材 2個"));
  assert.deepEqual(
    getInterruptedActionSummary(deserialize(before), "mio"),
    summary,
  );
  summary.reserved.ingredients = 99;
  assert.equal(
    person(state, "mio").suspended!.reserved!.ingredients,
    2,
    "Presentation must not expose mutable reservation state",
  );
  assert.equal(serialize(state), before);
});

test("An interrupted job retains its starting place while the resident moves elsewhere, without inventing an interruption cause", () => {
  let state = pausedCooking();
  state = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "move",
    target: "garden",
  });
  const underway = getInterruptedActionSummary(state, "mio")!;
  assert.ok(underway.detail.includes(person(state, "mio").action!.label));
  state = advance(state, 3);
  const moved = getInterruptedActionSummary(state, "mio")!;
  assert.equal(person(state, "mio").location, "garden");
  assert.equal(moved.location, "home");
  assert.ok(moved.detail.includes("戻ってから再開"));
  assert.ok(!moved.detail.includes("救助のため"));
});

test("A paused continuous attack does not claim to finish after its two-minute progress cycle", () => {
  let state = createGame(2026);
  person(state).location = "ruins";
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "attack" });
  state = act(state, { type: "pause", residentId: "aki" });
  const summary = getInterruptedActionSummary(state, "aki")!;
  assert.equal(summary.continuous, true);
  assert.equal(summary.remaining, null);
  assert.equal(summary.percent, null);
  assert.ok(summary.detail.includes("継続指示"));
  assert.ok(!summary.detail.includes("残り"));
});

test("No suspended job means no interrupted summary, including unknown resident IDs", () => {
  const state = createGame(2026);
  assert.equal(getInterruptedActionSummary(state, "aki"), null);
  assert.equal(getInterruptedActionSummary(state, "missing"), null);
});
