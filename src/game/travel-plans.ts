import type { GameState, TravelPlan } from "./types";

export const MAX_TRAVEL_PLAN_MINUTES = 14 * 1440;
export const MAX_TRAVEL_PLAN_PURPOSE = 80;

type PlanInput = { planId?: number; residentIds: string[]; purpose: string; returnAt: number };
type PlanResult = { error?: string; plan?: TravelPlan; changed: boolean };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const copy = (plan: TravelPlan): TravelPlan => ({ ...plan, residentIds: [...plan.residentIds] });
const failure = (error: string): PlanResult => ({ error, changed: false });

/** Read projections neither initialize old saves nor expose a writable plan. */
export function getOpenTravelPlans(s: GameState): readonly TravelPlan[] {
  if (!validTravelPlans(s) || !s.travelPlans) return [];
  return s.travelPlans.entries.filter((plan) => plan.closedAt === undefined).map(copy);
}

/** Current participants are intentions as of the latest revision, not eyewitnesses. */
function validMembership(s: GameState, plan: TravelPlan): boolean {
  for (const id of plan.residentIds) {
    const resident = s.residents.find((person) => person.id === id);
    if (!resident) return false;
    const joinedAt = resident.joinedAt ?? 0;
    if (!whole(joinedAt) || joinedAt > plan.updatedAt
      || (joinedAt > 0 && !whole(resident.joinedLogId, 1))) return false;
    if (resident.joinedLogId !== undefined && (!whole(resident.joinedLogId, 1)
      || resident.joinedLogId >= s.nextId
      || resident.joinedLogId >= plan.revisionId)) return false;
  }
  return true;
}

/** Collect allocated world identities, never clock-based merchant visit IDs. */
function worldIds(s: GameState): Set<number> | undefined {
  const ids = new Set<number>();
  const add = (value: unknown) => {
    if (!record(value) || !whole(value.id, 1)) return false;
    ids.add(value.id);
    return true;
  };
  const addArray = (values: unknown) => Array.isArray(values) && values.every(add);
  if (!Array.isArray(s.logs) || !addArray(s.logs)) return;
  for (const resident of s.residents) {
    for (const action of [resident.action, resident.suspended])
      if (action !== null && action !== undefined && !add(action)) return;
  }
  if (s.life !== undefined) {
    if (!record(s.life) || !addArray(s.life.crafts) || !addArray(s.life.events)
      || (s.life.upgrades !== undefined && !addArray(s.life.upgrades))) return;
  }
  if (s.trade !== undefined && (!record(s.trade) || !addArray(s.trade.receipts))) return;
  if (s.autonomy !== undefined) {
    if (!record(s.autonomy) || !record(s.autonomy.leisure)) return;
    for (const value of Object.values(s.autonomy.leisure)) {
      if (!record(value) || !whole(value.actionId, 1)) return;
      ids.add(value.actionId);
    }
  }
  return ids;
}

function validContext(s: GameState): boolean {
  if (!record(s) || !whole(s.minutes) || !whole(s.nextId, 1) || !Array.isArray(s.residents)
    || s.residents.some((resident) => !record(resident) || typeof resident.id !== "string")
    || new Set(s.residents.map((resident) => resident.id)).size !== s.residents.length) return false;
  const allocated = worldIds(s);
  return !!allocated && [...allocated].every((id) => id < s.nextId);
}

/** Validate this optional extension without creating historical travel facts. */
export function validTravelPlans(s: GameState): boolean {
  if (!record(s)) return false;
  if (s.travelPlans === undefined) return true;
  const state = s.travelPlans;
  if (!record(state) || Object.keys(state).some((key) => !["version", "entries"].includes(key))
    || state.version !== 1 || !Array.isArray(state.entries) || !validContext(s)) return false;
  const residents = new Set(s.residents.map((resident) => resident.id));
  if (residents.size !== s.residents.length) return false;
  const used = worldIds(s);
  if (!used) return false;
  const openMembers = new Set<string>();
  const keys = ["id", "revisionId", "createdAt", "updatedAt", "residentIds", "purpose", "returnAt", "remindedAt", "closedAt"];
  for (const plan of state.entries) {
    if (!record(plan) || Object.keys(plan).some((key) => !keys.includes(key))
      || !whole(plan.id, 1) || plan.id >= s.nextId || used.has(plan.id)
      || !whole(plan.revisionId, plan.id) || plan.revisionId >= s.nextId
      || (plan.revisionId !== plan.id && used.has(plan.revisionId))
      || !whole(plan.createdAt) || !whole(plan.updatedAt, plan.createdAt) || plan.updatedAt > s.minutes
      || (plan.revisionId === plan.id && plan.createdAt !== plan.updatedAt)
      || !whole(plan.returnAt) || plan.returnAt <= plan.createdAt
      || plan.returnAt - plan.updatedAt > MAX_TRAVEL_PLAN_MINUTES
      || typeof plan.purpose !== "string" || !plan.purpose.length || plan.purpose.length > MAX_TRAVEL_PLAN_PURPOSE
      || plan.purpose !== plan.purpose.trim()
      || !Array.isArray(plan.residentIds) || !plan.residentIds.length
      || plan.residentIds.some((id) => typeof id !== "string" || !residents.has(id))
      || new Set(plan.residentIds).size !== plan.residentIds.length
      || plan.residentIds.some((id, index) => index > 0 && plan.residentIds[index - 1] > id)
      || (plan.remindedAt !== undefined && (!whole(plan.remindedAt, plan.returnAt) || plan.remindedAt > s.minutes))
      || (plan.closedAt !== undefined && (!whole(plan.closedAt) || plan.closedAt !== plan.updatedAt
        || plan.revisionId === plan.id || (plan.remindedAt !== undefined && plan.remindedAt > plan.closedAt)))
      || !validMembership(s, plan as TravelPlan)) return false;
    if (plan.closedAt === undefined) {
      for (const id of plan.residentIds) {
        if (openMembers.has(id)) return false;
        openMembers.add(id);
      }
    }
    used.add(plan.id);
    used.add(plan.revisionId);
  }
  return true;
}

/** Mutate only after every condition succeeds; the engine owns the outer clone. */
export function saveTravelPlan(s: GameState, input: PlanInput): PlanResult {
  if (!validContext(s) || !validTravelPlans(s)) return failure("旅の予定の保存内容を確認してください。");
  if (s.ended) return failure("この試行は終了しています。保存から再開してください。");
  if (!record(input) || !Array.isArray(input.residentIds) || !input.residentIds.length
    || input.residentIds.some((id) => typeof id !== "string" || !s.residents.some((resident) => resident.id === id)))
    return failure("旅の予定に入れる住民を、共通の一覧から選んでください。");
  if (typeof input.purpose !== "string") return failure("旅の目的を80文字以内で入力してください。");
  const purpose = input.purpose.trim();
  if (!purpose.length || purpose.length > MAX_TRAVEL_PLAN_PURPOSE)
    return failure("旅の目的を80文字以内で入力してください。");
  const residentIds = [...new Set(input.residentIds)].sort();
  if (input.planId !== undefined && !whole(input.planId, 1)) return failure("変更する旅の予定が見つかりません。");
  const existing = input.planId === undefined ? undefined : s.travelPlans?.entries.find((plan) => plan.id === input.planId);
  if (input.planId !== undefined && !existing) return failure("変更する旅の予定が見つかりません。");
  if (existing?.closedAt !== undefined) return failure("閉じた旅の予定は変更できません。新しい予定を作ってください。");
  if (!whole(input.returnAt) || ((!existing || input.returnAt !== existing.returnAt)
    && (input.returnAt <= s.minutes || input.returnAt - s.minutes > MAX_TRAVEL_PLAN_MINUTES)))
    return failure("帰還の目安は、現在より後から14日以内の時刻を選んでください。");
  if (s.travelPlans?.entries.some((plan) => plan.id !== existing?.id && plan.closedAt === undefined
    && plan.residentIds.some((id) => residentIds.includes(id))))
    return failure("選んだ住民には、まだ開いている旅の予定があります。先に変更するか閉じてください。");
  if (existing && purpose === existing.purpose && input.returnAt === existing.returnAt
    && residentIds.length === existing.residentIds.length && residentIds.every((id, index) => id === existing.residentIds[index]))
    return { plan: copy(existing), changed: false };
  if (s.nextId >= Number.MAX_SAFE_INTEGER) return failure("予定を記録できる番号がありません。");
  const plan: TravelPlan = {
    id: existing?.id ?? s.nextId,
    revisionId: s.nextId,
    createdAt: existing?.createdAt ?? s.minutes,
    updatedAt: s.minutes,
    residentIds, purpose, returnAt: input.returnAt,
    ...(existing?.remindedAt !== undefined && input.returnAt === existing.returnAt ? { remindedAt: existing.remindedAt } : {}),
  };
  if (!validMembership(s, plan)) return failure("住民が仲間に加わった後の時点で、旅の予定を記録してください。");
  const plans = s.travelPlans ??= { version: 1, entries: [] };
  if (existing) plans.entries[plans.entries.indexOf(existing)] = plan;
  else plans.entries.push(plan);
  s.nextId++;
  return { plan: copy(plan), changed: true };
}

export function closeTravelPlan(s: GameState, planId: number): PlanResult {
  if (!validContext(s) || !validTravelPlans(s))
    return failure("旅の予定の保存内容を確認してください。");
  if (s.ended) return failure("この試行は終了しています。保存から再開してください。");
  const existing = whole(planId, 1) ? s.travelPlans?.entries.find((plan) => plan.id === planId) : undefined;
  if (!existing) return failure("閉じる旅の予定が見つかりません。");
  if (existing.closedAt !== undefined) return { plan: copy(existing), changed: false };
  if (s.nextId >= Number.MAX_SAFE_INTEGER) return failure("予定を記録できる番号がありません。");
  const plan: TravelPlan = { ...existing, residentIds: [...existing.residentIds],
    revisionId: s.nextId, updatedAt: s.minutes, closedAt: s.minutes };
  if (!validMembership(s, plan)) return failure("住民が仲間に加わった後の時点で、旅の予定を記録してください。");
  s.travelPlans!.entries[s.travelPlans!.entries.indexOf(existing)] = plan;
  s.nextId++;
  return { plan: copy(plan), changed: true };
}

/** Only positive shared-clock advancement calls this; no journeys are executed. */
export function tickTravelPlanReminders(s: GameState): TravelPlan[] {
  if (!record(s) || s.ended || !whole(s.minutes) || !record(s.travelPlans)
    || !Array.isArray(s.travelPlans.entries)) return [];
  const due = s.travelPlans.entries.filter((plan) => record(plan) && plan.closedAt === undefined
    && plan.remindedAt === undefined && whole(plan.returnAt) && plan.returnAt <= s.minutes);
  if (!due.length || !validTravelPlans(s)) return [];
  for (const plan of due) plan.remindedAt = s.minutes;
  return due.map(copy);
}
