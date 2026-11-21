import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  command,
  createGame,
  deserialize,
  getCombatants,
  serialize,
} from "../src/game/engine.ts";
import {
  advanceFromControls,
  advanceToNextBoundaryFromControls,
  advanceTimeShortcutFromControls,
  advanceToEveningFromControls,
  getTimeControls,
  previewTimeShortcut,
  sleepUntilMorningFromControls,
} from "../src/game/time-controls.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, cmd: Command) {
  const result = command(state, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function encounter(armor = false) {
  const prepared = armor
    ? act(createGame(2026), { type: "equip", residentId: "aki", armor: true })
    : createGame(2026);
  const walking = act(prepared, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "ruins",
  });
  const state = advanceFromControls(walking, 200);
  assert.equal(person(state).location, "ruins");
  assert.ok(state.pauseReason?.includes("遭遇"));
  return state;
}
function defendedEncounter() {
  return act(encounter(true), {
    type: "assign",
    residentIds: ["aki"],
    kind: "defend",
  });
}
function assertCombatControls(state: GameState) {
  const controls = getTimeControls(state);
  assert.equal(controls.combat, true);
  assert.deepEqual(controls.minuteSteps, [1, 5, 10]);
  assert.equal(controls.nextMinutes, 1);
  assert.equal(controls.canSleepUntilMorning, false);
}
function assertNormalControls(state: GameState) {
  const controls = getTimeControls(state);
  assert.equal(controls.combat, false);
  assert.deepEqual(controls.minuteSteps, [5, 30, 60]);
  const time = state.minutes % 1440;
  assert.equal(controls.canSleepUntilMorning, time < 480 || time >= 1080);
}

test("Reading peaceful time controls leaves the shared clock and seeded world unchanged", () => {
  const state = createGame(2026);
  const before = serialize(state);
  assertNormalControls(state);
  assert.equal(getTimeControls(state).nextMinutes, 30);
  assert.deepEqual(getCombatants(state), []);
  assert.equal(serialize(state), before);
});

test("The peaceful shortcut switches at 08:00 and 18:00 without changing the world", () => {
  for (const [minutes, kind, target] of [
    [1919, "morning", 1920],
    [1920, "evening", 2520],
    [1079, "evening", 1080],
    [1080, "morning", 1920],
    [1439, "morning", 1920],
    [1440, "morning", 1920],
  ] as const) {
    const state = createGame(20);
    state.minutes = minutes;
    const before = serialize(state);
    const shortcut = getTimeControls(state).shortcut;
    assert.equal(shortcut?.kind, kind);
    assert.equal(shortcut?.targetMinutes, target);
    assert.equal(shortcut?.minutes, target - minutes);
    const preview = previewTimeShortcut(
      state,
      kind === "morning" ? ["aki"] : [],
    );
    assert.equal(preview.error, undefined);
    assert.deepEqual(preview.shortcut, shortcut);
    assert.equal(serialize(state), before);
  }
});

test("The daytime shortcut needs no selection and advances current work without reserving sleep", () => {
  let state = createGame(55);
  state.minutes = 600;
  for (const resident of state.residents) resident.hunger = 100;
  state = act(state, { type: "assign", residentIds: ["mio"], kind: "cook" });
  state = advance(state, 3);
  state = act(state, { type: "pause", residentId: "mio" });
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  const suspended = structuredClone(person(state, "mio").suspended);
  const before = serialize(state);
  const preview = previewTimeShortcut(state, []);
  assert.equal(preview.error, undefined);
  assert.equal(preview.shortcut?.kind, "evening");
  assert.equal(serialize(state), before);
  const result = advanceTimeShortcutFromControls(state, []);
  assert.equal(result.error, undefined);
  assert.equal(result.state.minutes, 1080);
  assert.equal(result.state.flags.hobbyFinished, true);
  assert.deepEqual(person(result.state, "mio").suspended, suspended);
  assert.ok(
    result.state.residents.every(
      (resident) =>
        resident.action?.kind !== "sleep" &&
        resident.suspended?.kind !== "sleep",
    ),
  );
  assert.deepEqual(
    result.state,
    advanceFromControls(state, 1080 - state.minutes),
  );
  assert.deepEqual(advanceToEveningFromControls(state), result);
  assert.equal(serialize(state), before);
});

test("Night shortcuts reject hunger and an unfinished meal before changing any selected person's work", () => {
  let state = createGame(71);
  state.minutes = 1320;
  state = act(state, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  state = act(state, { type: "assign", residentIds: ["mio"], kind: "cook" });
  person(state, "mio").hunger = 34.99;
  const before = serialize(state);
  const hungry = advanceTimeShortcutFromControls(state, ["aki", "mio"]);
  assert.match(hungry.error ?? "", /ミオ.*空腹/);
  assert.strictEqual(hungry.state, state);
  assert.equal(serialize(state), before);
  assert.match(
    previewTimeShortcut(state, ["aki", "mio"]).error ?? "",
    /ミオ.*空腹/,
  );
  person(state, "mio").hunger = 35;
  assert.equal(previewTimeShortcut(state, ["aki", "mio"]).error, undefined);
  person(state, "ren").hunger = 10;
  assert.equal(
    previewTimeShortcut(state, ["aki"]).error,
    undefined,
    "An unselected hungry person does not invalidate the selected sleeper's reservation",
  );

  const eating = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "eat",
  });
  const eatingBefore = serialize(eating);
  const rejected = sleepUntilMorningFromControls(eating, ["aki", "mio"]);
  assert.match(rejected.error ?? "", /ミオ.*食事中/);
  assert.strictEqual(rejected.state, eating);
  assert.equal(serialize(eating), eatingBefore);
});

test("Repeated night shortcuts continue active or interrupted sleep instead of duplicating jobs", () => {
  for (const paused of [false, true]) {
    let state = createGame(80);
    state.minutes = 1320;
    for (const resident of state.residents) resident.hunger = 100;
    state = act(state, { type: "assign", residentIds: ["aki"], kind: "sleep" });
    state = advance(state, 10);
    const sleepId = person(state).action!.id;
    if (paused) state = act(state, { type: "pause", residentId: "aki" });
    // A real new warning stops the shortcut immediately, exposing the retained
    // action ID/progress without requiring a special test-only preparation API.
    person(state, "ren").location = "road";
    person(state, "ren").hunger = 20.01;
    const result = advanceTimeShortcutFromControls(state, ["aki"]);
    assert.equal(result.error, undefined);
    assert.equal(result.state.minutes, state.minutes + 1);
    assert.equal(person(result.state).action?.id, sleepId);
    assert.equal(person(result.state).action?.progress, 11);
    assert.equal(person(result.state).suspended, null);
    assert.deepEqual(deserialize(serialize(result.state)), result.state);
  }
});

test("The normal next interval uses the earliest remaining action and a newly reserved sleep is at most eight hours", () => {
  let state = act(createGame(2026), {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  state = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  state = advance(state, 5);
  const remaining = Math.ceil(
    Math.min(
      ...state.residents
        .filter((resident) => resident.action)
        .map(
          (resident) => resident.action!.duration - resident.action!.progress,
        ),
    ),
  );
  assert.equal(getTimeControls(state).nextMinutes, remaining);
  assert.ok(remaining < 30);
  const sleeping = act(createGame(2026), {
    type: "assign",
    residentIds: ["aki"],
    kind: "sleep",
  });
  assert.equal(person(sleeping).action!.duration, 480);
  assert.equal(getTimeControls(sleeping).nextMinutes, 480);
});

test("A long normal advance stops on contact before a hit and immediately derives combat intervals", () => {
  let state = act(createGame(2026), {
    type: "assign",
    residentIds: ["mio"],
    kind: "hobby",
  });
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "ruins",
  });
  assertNormalControls(state);
  const started = state.minutes;
  state = advanceFromControls(state, 200);
  assert.equal(state.minutes - started, 23);
  assert.equal(
    person(state).hp,
    100,
    "Arrival must stop before the first guard hit",
  );
  assert.equal(person(state, "mio").location, "home");
  assert.equal(person(state, "mio").action?.progress, state.minutes - started);
  assert.deepEqual(
    getCombatants(state).map((resident) => resident.id),
    ["aki"],
  );
  assertCombatControls(state);
});

test("Combat permits one, five and ten minutes but caps longer UI requests at ten, even with companions still at base", () => {
  const state = defendedEncounter();
  const before = serialize(state);
  for (const requested of [1, 5, 10, 30, 60, 480]) {
    const interval = Math.min(10, requested);
    const expected = advance(state, interval);
    const next = advanceFromControls(state, requested);
    assert.equal(next.minutes, state.minutes + interval);
    assert.deepEqual(
      next,
      expected,
      `UI request ${requested} must resolve exactly ${interval} combat ticks`,
    );
    assert.ok(person(next).hp > 0 && person(next).hp < 100);
    assert.equal(person(next, "mio").location, "home");
    assertCombatControls(next);
  }
  assert.equal(
    serialize(state),
    before,
    "Capped progress must not mutate the previous world",
  );
});

test("The next-interval shortcut stays at one combat minute even though five and ten are also available", () => {
  let state = encounter();
  state = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  const controls = getTimeControls(state);
  assert.equal(
    controls.nextMinutes,
    1,
    "An unexposed cook must not select the global time interval",
  );
  const next = advanceFromControls(state, controls.nextMinutes);
  assert.equal(next.minutes, state.minutes + 1);
  assert.equal(person(next, "mio").action?.progress, 1);
  assert.ok(person(next).hp < person(state).hp);
});

test("Overnight progress is rejected before reserving sleep or interrupting a selected cook when someone else is in combat", () => {
  let state = encounter();
  state = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  const before = serialize(state);
  const result = sleepUntilMorningFromControls(state, ["mio"]);
  assert.ok(result.error?.includes("交戦中"));
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
  assert.equal(person(result.state, "mio").action?.kind, "cook");
  assert.equal(person(result.state, "mio").suspended, null);
  assert.equal(result.state.minutes, state.minutes);
  assert.equal(result.state.seed, state.seed);
});

test("Safe overnight progress sleeps only the selected resident and reaches the coming 08:00 after midnight", () => {
  let state = createGame(2026);
  state.minutes = 1440 + 150;
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  const before = serialize(state);
  const result = sleepUntilMorningFromControls(state, ["mio"]);
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.state.minutes, 1440 + 480);
  assert.equal(
    result.state.flags.hobbyFinished,
    true,
    "The unselected protagonist's existing job should finish, not be replaced by sleep",
  );
  assert.equal(person(result.state).suspended, null);
  const waking = result.state.logs.filter((log) => log.title === "新しい朝");
  assert.equal(waking.length, 1);
  assert.deepEqual(waking[0].actors, ["mio"]);
  assert.equal(person(result.state, "mio").action, null);
  assert.equal(result.state.seed, state.seed);
  assert.equal(serialize(state), before);
});

test("Overnight progress that starts safely still stops if an unselected traveler encounters the guard", () => {
  const evening = createGame(2026);
  evening.minutes = 1080;
  const walking = act(evening, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "ruins",
  });
  const result = sleepUntilMorningFromControls(walking, ["mio"]);
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.state.minutes, walking.minutes + 23);
  assert.ok(result.state.pauseReason?.includes("遭遇"));
  assert.equal(person(result.state).hp, 100);
  assert.equal(person(result.state, "mio").location, "home");
  assert.equal(person(result.state, "mio").action?.kind, "sleep");
  assertCombatControls(result.state);
});

test("Driving off the guard restores normal controls without resetting the world or requiring a scene switch", () => {
  let state = createGame(2026);
  person(state).location = "ruins";
  person(state, "ren").location = "ruins";
  state.enemy.alerted = true;
  state = act(state, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "attack",
  });
  const started = state.minutes;
  assertCombatControls(state);
  state = advanceFromControls(state, 60);
  assert.equal(state.enemy.defeated, true);
  assert.ok(state.minutes > started && state.minutes - started < 10);
  assert.ok(state.pauseReason?.includes("退き"));
  assert.equal(state.enemy.alerted, true);
  assert.deepEqual(getCombatants(state), []);
  assertNormalControls(state);
});

test("A ten-minute combat advance still stops immediately when an unarmoured resident falls", () => {
  const state = encounter();
  const next = advanceFromControls(state, 60);
  assert.equal(person(next).hp, 0);
  assert.ok(next.minutes > state.minutes && next.minutes - state.minutes <= 10);
  assert.ok(next.pauseReason?.includes("倒れ"));
  assert.equal(
    next.ended,
    false,
    "Unexposed companions must remain controllable",
  );
  assert.equal(person(next, "mio").hp, 100);
  assertNormalControls(next);
});

test("Moving out of exposure restores normal controls even while the historical alerted flag remains set", () => {
  let state = act(encounter(), {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "road",
  });
  assertCombatControls(state);
  state = advanceFromControls(state, 1);
  assert.equal(person(state).action?.segmentProgress, 1);
  assertCombatControls(state);
  const hpAfterFirstMinute = person(state).hp;
  state = advanceFromControls(state, 1);
  assert.equal(
    person(state).location,
    "ruins",
    "The exposure rule applies before reaching the next map location",
  );
  assert.equal(person(state).action?.segmentProgress, 2);
  assert.equal(person(state).hp, hpAfterFirstMinute);
  assert.equal(state.enemy.alerted, true);
  assert.deepEqual(getCombatants(state), []);
  assertNormalControls(state);
});

test("An unconscious resident alone does not keep combat controls active but another conscious resident does", () => {
  const state = encounter();
  person(state).hp = 0;
  assert.deepEqual(getCombatants(state), []);
  assertNormalControls(state);
  person(state, "ren").location = "ruins";
  assert.deepEqual(
    getCombatants(state).map((resident) => resident.id),
    ["ren"],
  );
  assertCombatControls(state);
  person(state, "ren").hp = 0;
  assertNormalControls(state);
});

test("Combat policy is derived again after loading and preserves the same next seeded combat result", () => {
  const state = defendedEncounter();
  const restored = deserialize(serialize(state));
  assert.deepEqual(getTimeControls(restored), getTimeControls(state));
  assert.deepEqual(
    getCombatants(restored).map((resident) => resident.id),
    ["aki"],
  );
  assert.deepEqual(
    advanceFromControls(restored, 60),
    advanceFromControls(state, 10),
  );
  const escaping = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "road",
  });
  const safe = advanceFromControls(advanceFromControls(escaping, 1), 1);
  assertNormalControls(deserialize(serialize(safe)));
});

test("The UI combat cap leaves the engine's deterministic batched advancement available", () => {
  const state = defendedEncounter();
  const capped = advanceFromControls(state, 100);
  const batched = advance(state, 15);
  assert.equal(capped.minutes, state.minutes + 10);
  assert.equal(batched.minutes, state.minutes + 15);
  let split = state;
  for (let minute = 0; minute < 15; minute++) split = advance(split, 1);
  assert.deepEqual(batched, split);
  assert.ok(person(batched).hp < person(capped).hp);
});

test("Next boundary follows new NPC movement and help, while a fixed step keeps its requested duration", () => {
  const initial = act(createGame(), {
    type: "assign",
    residentIds: ["aki"],
    kind: "hobby",
  });
  const before = serialize(initial);
  const first = advanceToNextBoundaryFromControls(initial);
  assert.equal(serialize(initial), before);
  assert.equal(first.minutes, 483);
  assert.equal(person(first).action?.progress, 3);
  assert.equal(person(first, "mio").action?.progress, 3);
  assert.equal(person(first, "ren").location, "bedroom");
  assert.equal(person(first, "ren").action, null);
  const second = advanceToNextBoundaryFromControls(first);
  assert.equal(second.minutes, 490);
  assert.equal(person(second).action?.progress, 22);
  assert.equal(person(second, "mio").action, null);
  assert.deepEqual(
    second,
    advanceToNextBoundaryFromControls(deserialize(serialize(first))),
  );
  const third = advanceToNextBoundaryFromControls(second);
  assert.equal(third.minutes, 513);
  assert.equal(person(third).action, null);
  assert.equal(person(third, "ren").action, null);
  assert.equal(third.life?.crafts[0].authorId, "aki");
  assert.equal(third.life?.crafts[0].createdAt, 513);
  const fixed = advanceFromControls(initial, 45);
  assert.equal(fixed.minutes, 525);
  assert.equal(fixed.life?.crafts[0].createdAt, 513);
});

test("A movement boundary returns before a newly reserved cooking task gains any progress", () => {
  let state = createGame();
  for (const id of ["mio", "ren"])
    state = act(state, { type: "policy", residentId: id, policy: "rest" });
  state = act(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "project",
    target: "kitchen-tools",
  });
  state = advance(state, person(state).action!.duration);
  state = act(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "move",
    target: "garden",
  });
  state = advance(state, person(state, "mio").action!.duration);
  state = act(state, { type: "policy", residentId: "mio", policy: "balanced" });
  state.resources.food = 0; // Controlled shortage; equipment and travel use actual commands.
  const before = serialize(state);
  const next = advanceToNextBoundaryFromControls(state);
  assert.equal(serialize(state), before);
  assert.equal(next.minutes, state.minutes + 3);
  assert.equal(person(next, "mio").location, "home");
  assert.equal(person(next, "mio").action?.kind, "cook");
  assert.equal(person(next, "mio").action?.progress, 0);
  assert.equal(person(next, "mio").action?.duration, 17);
  assert.deepEqual(person(next, "mio").action?.reserved, { ingredients: 2 });
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Next boundary keeps the global one-minute battle step and a bounded idle wait", () => {
  const fighting = defendedEncounter();
  const next = advanceToNextBoundaryFromControls(fighting);
  assert.equal(next.minutes, fighting.minutes + 1);
  assert.deepEqual(getTimeControls(next).minuteSteps, [1, 5, 10]);
  let idle = createGame();
  for (const id of ["mio", "ren"])
    idle = act(idle, { type: "policy", residentId: id, policy: "rest" });
  const waited = advanceToNextBoundaryFromControls(idle);
  assert.equal(waited.minutes, idle.minutes + 30);
  assert.ok(waited.residents.every((r) => r.action === null));
});
