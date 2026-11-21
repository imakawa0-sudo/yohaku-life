import { advance, command, getCombatants } from "./engine";
import type { GameState } from "./types";
import { getCraftConversationStatus } from "./craft-conversation";
import { inspectSleep } from "./overnight";

export type TimeControls = {
  combat: boolean;
  minuteSteps: number[];
  nextMinutes: number;
  canSleepUntilMorning: boolean;
  shortcut: TimeShortcut | null;
};
export type TimeShortcut = {
  kind: "evening" | "morning";
  label: string;
  targetMinutes: number;
  minutes: number;
};

function peacefulShortcut(state: GameState): TimeShortcut {
  const timeOfDay = state.minutes % 1440;
  const dayStart = Math.floor(state.minutes / 1440) * 1440;
  const daytime = timeOfDay >= 480 && timeOfDay < 1080;
  const targetMinutes = daytime
    ? dayStart + 1080
    : dayStart + (timeOfDay < 480 ? 480 : 1440 + 480);
  return {
    kind: daytime ? "evening" : "morning",
    label: daytime ? "夕方まで" : "翌朝まで",
    targetMinutes,
    minutes: targetMinutes - state.minutes,
  };
}

/** Derive every time control from the whole world, never from the viewed resident. */
export function getTimeControls(state: GameState): TimeControls {
  if (getCombatants(state).length) {
    return {
      combat: true,
      minuteSteps: [1, 5, 10],
      nextMinutes: 1,
      canSleepUntilMorning: false,
      shortcut: null,
    };
  }
  const remaining = state.residents
    .filter((resident) => !getCraftConversationStatus(state, resident.id)?.waiting)
    .filter((resident) => resident.action?.kind !== "sleep" || !inspectSleep(state, resident.id).error)
    .map((resident) => resident.action)
    .filter((action) => action !== null)
    .map((action) => action.duration - action.progress)
    .filter((minutes) => minutes > 0);
  const shortcut = state.ended ? null : peacefulShortcut(state);
  return {
    combat: false,
    minuteSteps: [5, 30, 60],
    nextMinutes: remaining.length
      ? Math.min(480, Math.max(1, Math.ceil(Math.min(...remaining))))
      : 30,
    canSleepUntilMorning: shortcut?.kind === "morning",
    shortcut,
  };
}

/** Keep UI shortcuts subject to the same ten-minute battle limit. */
export function advanceFromControls(
  state: GameState,
  minutes: number,
): GameState {
  // A positive request always includes at least the smallest playable interval.
  const requested =
    Number.isFinite(minutes) && minutes > 0
      ? Math.max(1, Math.ceil(minutes))
      : 0;
  return advance(
    state,
    getCombatants(state).length ? Math.min(10, requested) : requested,
  );
}

/** Return after the first real completion, including work begun during this step. */
export function advanceToNextBoundaryFromControls(state: GameState): GameState {
  return advance(state, getTimeControls(state).nextMinutes, {
    stopAtActionEnd: true,
  });
}

function prepareNightSleep(
  state: GameState,
  residentIds: string[],
): { state: GameState; error?: string } {
  if (getCombatants(state).length) {
    return {
      state,
      error:
        "交戦中の仲間がいます。戦闘・撤退を確認し、1分・5分・10分のいずれかで時間を進めてください。翌朝までは進められません。",
    };
  }
  if (state.ended)
    return {
      state,
      error: "この試行は終了しています。保存から再開してください。",
    };
  if (peacefulShortcut(state).kind !== "morning")
    return {
      state,
      error: "日中は「夕方まで」で、睡眠を予約せずに時間を進められます。",
    };
  if (!residentIds.length)
    return { state, error: "眠る住民を、ホームの一覧から選んでください。" };
  const ids = [...new Set(residentIds)];
  for (const id of ids) {
    const resident = state.residents.find((r) => r.id === id);
    if (!resident) return { state, error: "眠る住民が見つかりません。" };
    if (resident.action?.kind === "eat")
      return {
        state,
        error: `${resident.name}は食事中です。食事を終えてから、眠る時間を選んでください。`,
      };
    if (resident.hp <= 0)
      return {
        state,
        error: `${resident.name}は意識を失っています。先に救助と手当を確認してください。`,
      };
    const sleeping = inspectSleep(state, id);
    if (sleeping.error) return { state, error: sleeping.error };
    if (resident.hunger < 35)
      return {
        state,
        error: `${resident.name}は空腹です。先に食事をとってから、朝までの時間を選んでください。`,
      };
  }
  let planned = state;
  for (const id of ids) {
    const resident = planned.residents.find((r) => r.id === id)!;
    // Repeated clicks continue the same sleep; they never stack old sleep jobs.
    if (resident.action?.kind === "sleep") continue;
    const result =
      resident.action === null && resident.suspended?.kind === "sleep"
        ? command(planned, { type: "resume", residentId: id })
        : command(planned, {
            type: "assign",
            residentIds: [id],
            kind: "sleep",
          });
    if (result.error) return { state, error: result.error };
    planned = result.state;
  }
  return { state: planned };
}

/** A read-only preview of the exact shortcut's preconditions. */
export function previewTimeShortcut(
  state: GameState,
  residentIds: string[],
): {
  shortcut: TimeShortcut | null;
  error?: string;
} {
  const controls = getTimeControls(state);
  if (controls.combat)
    return {
      shortcut: null,
      error: "交戦中の仲間がいます。1分・5分・10分で時間を進めてください。",
    };
  if (!controls.shortcut)
    return { shortcut: null, error: "この試行は終了しています。" };
  if (controls.shortcut.kind === "evening")
    return { shortcut: controls.shortcut };
  const result = prepareNightSleep(state, residentIds);
  return {
    shortcut: controls.shortcut,
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Daytime advances the shared world without issuing sleep or changing selection. */
export function advanceToEveningFromControls(state: GameState): {
  state: GameState;
  error?: string;
} {
  const controls = getTimeControls(state);
  if (controls.combat)
    return { state, error: "交戦中の仲間がいます。夕方までは進められません。" };
  if (controls.shortcut?.kind !== "evening")
    return { state, error: "今は夜の時間です。「翌朝まで」を使えます。" };
  return { state: advanceFromControls(state, controls.shortcut.minutes) };
}

/** Reserve sleep atomically, then let the shared clock stop at real changes. */
export function sleepUntilMorningFromControls(
  state: GameState,
  residentIds: string[],
): {
  state: GameState;
  error?: string;
} {
  const result = prepareNightSleep(state, residentIds);
  if (result.error) return result;
  return {
    state: advanceFromControls(result.state, peacefulShortcut(state).minutes),
  };
}

export function advanceTimeShortcutFromControls(
  state: GameState,
  residentIds: string[],
): {
  state: GameState;
  error?: string;
} {
  const shortcut = getTimeControls(state).shortcut;
  if (!shortcut)
    return {
      state,
      error: getCombatants(state).length
        ? "交戦中の仲間がいます。1分・5分・10分で時間を進めてください。"
        : "この試行は終了しています。",
    };
  return shortcut.kind === "evening"
    ? advanceToEveningFromControls(state)
    : sleepUntilMorningFromControls(state, residentIds);
}
