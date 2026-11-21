import { getPresentEncounterAt, SECOND_ENCOUNTER_RULE } from "./encounters";
import {
  command,
  getCombatants,
  LOCATIONS,
} from "./engine";
import { accessibleResources } from "./inventory";
import type { GameLog, GameState, LocationId, Resources } from "./types";

/** Preserve the distinction between a positive vital and an actual zero. */
export function formatVitalValue(value: number): string {
  return value > 0 && value < 1 ? "<1" : String(Math.round(value));
}

export type AttentionItem = {
  id: string;
  kind: "combat" | "rescue" | "recovery" | "treatment" | "hunger" | "fatigue";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  residentId: string;
  location: LocationId;
};

const woundNames = { arm: "腕", leg: "脚", body: "体幹" } as const;
const resourceNames = {
  food: ["食事", "食"],
  ingredients: ["食材", "個"],
  medicine: ["手当用品", "個"],
  scrap: ["資材", "個"],
} as const;

/** Current problems come from current facts, rather than a previous pause message. */
export function deriveAttention(state: GameState): AttentionItem[] {
  const attention: AttentionItem[] = [];
  for (const resident of getCombatants(state)) {
    const encounter = getPresentEncounterAt(state, resident.location);
    const opponentName = encounter?.id === SECOND_ENCOUNTER_RULE.id ? encounter.name : "流れ者";
    attention.push({
      id: `combat:${resident.id}`,
      kind: "combat",
      severity: "critical",
      title: `${resident.name}が${opponentName}と対峙しています`,
      detail: `${LOCATIONS[resident.location].name}で敵と同じ区域にいます。攻撃・援護・帰り道を確認してください。`,
      residentId: resident.id,
      location: resident.location,
    });
  }
  for (const resident of state.residents) {
    const atBase = LOCATIONS[resident.location].kind === "base";
    const locationName = LOCATIONS[resident.location].name;
    const carrier = !atBase
      ? state.residents.find(
          (other) =>
            other.hp > 0 && other.location === resident.location && resident.hp <= 35 &&
            other.action?.kind === "rescue" &&
            other.action.target === resident.id,
        )
      : undefined;
    const pausedCarrier = !atBase
      ? state.residents.find(
          (other) =>
            other.hp > 0 && other.location === resident.location && resident.hp <= 35 &&
            other.suspended?.kind === "rescue" &&
            other.suspended.target === resident.id,
        )
      : undefined;
    if (resident.hp <= 0 || carrier || pausedCarrier) {
      attention.push({
        id: `${atBase ? "recovery" : "rescue"}:${resident.id}`,
        kind: atBase ? "recovery" : "rescue",
        severity: "critical",
        title: atBase
          ? resident.hp <= 0
            ? `${resident.name}は拠点で意識を失っています`
            : `${resident.name}の回復を確認してください`
          : carrier
            ? `${resident.name}を救助・運搬しています`
            : `${resident.name}の救助が必要です`,
        detail: state.ended
          ? "この試行は終了しています。保存から再開するか、同じ開始条件でやり直せます。"
          : atBase
            ? `${locationName}にいます。すでに拠点内なので、意識の回復を確認し、手当や休息を選んでください。`
            : carrier
              ? `${carrier.name}が救助しています。現在地：${locationName}。新しい救助を重ねず、運搬と帰還を確認してください。`
              : pausedCarrier
                ? `${locationName}にいます。${pausedCarrier.name}の救助が中断中です。再開か取消を確認してください。`
                : `${locationName}で意識がありません。動ける仲間を同じ場所へ移動させ、救助を指示できます。`,
        residentId: resident.id,
        location: resident.location,
      });
      continue;
    }
    const wounds = (Object.keys(woundNames) as (keyof typeof woundNames)[])
      .filter((part) => resident.wounds[part] > 0)
      .map((part) => `${woundNames[part]} ${resident.wounds[part]}`);
    if (resident.hp < 100 || wounds.length) {
      const impacts = [
        resident.wounds.arm > 0 ? "腕の傷で手仕事と攻撃に負担があります" : "",
        resident.wounds.leg > 0 ? "脚の傷で移動と運搬に時間がかかります" : "",
      ].filter(Boolean);
      attention.push({
        id: `treatment:${resident.id}`,
        kind: "treatment",
        severity: resident.hp <= 35 ? "critical" : "warning",
        title: wounds.length
          ? `${resident.name}に傷が残っています`
          : `${resident.name}の体力が低下しています`,
        detail: `身体 ${formatVitalValue(resident.hp)} / 100${wounds.length ? `。負傷：${wounds.join("・")}` : ""}。${impacts.length ? `${impacts.join("。")}。` : ""}${
          atBase
            ? "拠点で手当や休息を選べます。"
            : resident.location === "lodge"
              ? "舟宿で手当用品を使って手当するか、短い休息を選べます。"
              : resident.hp <= 35
              ? "帰還して手当をするか、同じ場所の仲間に救助を頼めます。"
              : "帰還後の手当と休養を考えてください。"
        }`,
        residentId: resident.id,
        location: resident.location,
      });
    }
    if (resident.hunger <= 20) {
      const unsafe = (getPresentEncounterAt(state, resident.location)?.hp ?? 0) > 0;
      const eating = resident.action?.kind === "eat" && !unsafe;
      const food = accessibleResources(state, resident.id).food;
      const foodDetail = food >= 1
        ? `${atBase ? "拠点" : "今いる場所の携行食"}で食事を選べます。利用できる食事は${food}食です。`
        : `${atBase ? "拠点で使える食事" : "この場所で使える携行食"}は${food}食です。1食分に届かないため、${atBase || resident.location === "lodge" ? "調理や物資" : "持ち物や補給、帰還"}を確認してください。`;
      attention.push({
        id: `hunger:${resident.id}`,
        kind: "hunger",
        severity: resident.hunger <= 5 ? "critical" : "warning",
        title: eating
          ? `${resident.name}は食事をとっています`
          : `${resident.name}のおなかが空いています`,
        detail: unsafe
          ? `ここでは交戦の危険があります。携行食は安全な場所で使い、先に退路を確認してください。`
          : eating
          ? "食事の完了で満腹度が戻ります。時間を少しずつ進められます。"
          : `${foodDetail}睡眠や仕事の中断状況を確認して、食事を選んでください。`,
        residentId: resident.id,
        location: resident.location,
      });
    }
    if (
      resident.energy <= 12 &&
      !["rest", "sleep"].includes(resident.action?.kind ?? "")
    ) {
      attention.push({
        id: `fatigue:${resident.id}`,
        kind: "fatigue",
        severity: resident.energy <= 2 ? "critical" : "warning",
        title: `${resident.name}に休息が必要です`,
        detail: atBase || resident.location === "lodge"
          ? "短い休息で活力を戻せます。仕事の進捗や材料は中断中も保持します。"
          : "帰還後の休息を考えてください。限界まで疲れると、選べる仕事が減ります。",
        residentId: resident.id,
        location: resident.location,
      });
    }
  }
  const order = {
    rescue: 0,
    recovery: 1,
    combat: 2,
    treatment: 3,
    hunger: 4,
    fatigue: 5,
  } as const;
  return attention.sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical") ||
      order[a.kind] - order[b.kind],
  );
}

/** Follow actual actors only; a witness or a name in prose is not the actor. */
export function getLogFocusResident(
  state: GameState,
  log: GameLog,
): string | null {
  return (
    log.actors.find((id) =>
      state.residents.some((resident) => resident.id === id),
    ) ?? null
  );
}

export type HomeHistoryItem =
  | { kind: "log"; key: string; log: GameLog }
  | {
      kind: "movement-summary";
      key: string;
      time: number;
      actorIds: readonly string[];
      sourceLogs: readonly GameLog[];
    };

/** Group display rows only; keep every original journal entry and actor intact. */
export function getHomeHistoryItems(
  logs: readonly GameLog[],
  limit = 3,
): HomeHistoryItem[] {
  const count = Math.floor(limit);
  if (!(count > 0)) return [];
  const items: HomeHistoryItem[] = [];
  let movement: GameLog[] = [];
  const single = (log: GameLog) => {
    items.push({ kind: "log", key: `log:${log.id}`, log });
  };
  const flushMovement = () => {
    if (movement.length === 1) single(movement[0]);
    else if (movement.length > 1)
      items.push({
        kind: "movement-summary",
        key: `movement:${movement.map((log) => log.id).join(":")}`,
        time: movement[0].time,
        actorIds: movement.map((log) => log.actors[0]),
        sourceLogs: movement.slice(),
      });
    movement = [];
  };
  for (const log of logs) {
    const actorId = log.actors.length === 1 ? log.actors[0] : undefined;
    const candidate =
      log.type === "explore" &&
      log.title === "移動を終えて" &&
      Number.isFinite(log.time) &&
      typeof actorId === "string" &&
      actorId.length > 0;
    if (!candidate) {
      flushMovement();
      single(log);
      continue;
    }
    if (
      movement.length &&
      (movement[0].time !== log.time ||
        movement.some((entry) => entry.actors[0] === actorId))
    )
      flushMovement();
    movement.push(log);
  }
  flushMovement();
  return items.slice(-count).reverse();
}

export type InterruptedActionSummary = {
  residentId: string;
  label: string;
  progress: number;
  duration: number;
  remaining: number | null;
  percent: number | null;
  continuous: boolean;
  location: LocationId;
  locationName: string;
  reserved: Partial<Resources>;
  reservationText: string;
  resumeError?: string;
  detail: string;
};

/** Describe saved progress without guessing why an action was interrupted. */
export function getInterruptedActionSummary(
  state: GameState,
  residentId: string,
): InterruptedActionSummary | null {
  const resident = state.residents.find((person) => person.id === residentId);
  const action = resident?.suspended;
  if (!resident || !action) return null;
  const location = action.origin ?? resident.location;
  const locationName = action.origin === undefined ? "開始場所の記録なし" : LOCATIONS[location].name;
  const reserved = { ...action.reserved };
  const reservationText = (Object.keys(resourceNames) as (keyof Resources)[])
    .filter((key) => (reserved[key] ?? 0) > 0)
    .map(
      (key) =>
        `${resourceNames[key][0]} ${reserved[key]}${resourceNames[key][1]}`,
    )
    .join("・");
  const continuous = action.kind === "attack";
  const remaining = continuous
    ? null
    : Math.max(0, Math.ceil(action.duration - action.progress));
  const resumeError = command(state, { type: "resume", residentId }).error;
  return {
    residentId,
    label: action.label,
    progress: Math.floor(action.progress),
    duration: Math.ceil(action.duration),
    remaining,
    continuous,
    percent: continuous
      ? null
      : Math.max(
          0,
          Math.min(100, Math.round((action.progress / action.duration) * 100)),
        ),
    location,
    locationName,
    reserved,
    reservationText: reservationText || "予約中の物資はありません",
    resumeError,
    detail: `${action.origin === undefined ? "開始場所の記録がない" : `${locationName}で始めた`}${continuous ? "攻撃の継続指示" : "行動"}を中断中です。${continuous ? "" : `残り ${remaining} 分。`}${
      resident.action
        ? `現在の指示は「${resident.action.label}」です。`
        : ""
    }${
      resumeError ??
      (continuous
        ? "再開すると攻撃を続けます。取消も選べます。"
        : "再開または取消を選べます。")
    }${reservationText ? `物資の予約は保持されています（${reservationText}）。` : ""}`,
  };
}
