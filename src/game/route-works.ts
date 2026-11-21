import { getPresentEncounterAt } from "./encounters";
import type { Action, GameState, LocationId, Resident } from "./types";
import { ownFreeResources } from "./inventory";

export const RIVER_PATH_RULE = Object.freeze({
  id: "river-path-v1",
  title: "川沿いの道を整える",
  location: "meadow",
  edge: Object.freeze(["meadow", "village"] as const),
  cost: Object.freeze({ scrap: 2 }),
  baseMinutes: 40,
  beforeMinutes: 18,
  afterMinutes: 14,
} as const);
export type RouteWorkFact = { ruleId: typeof RIVER_PATH_RULE.id; location: typeof RIVER_PATH_RULE.location };
export type RouteWorkCompletion = RouteWorkFact & { actorId: string; completedAt: number; logId: number };
export type RouteWorksState = { version: 1; riverPath: RouteWorkCompletion };
export type RouteWorkSummary = {
  rule: typeof RIVER_PATH_RULE;
  completed?: RouteWorkCompletion;
  working?: { residentId: string; paused: boolean; blockedReason?: string };
};

export function getRouteWorkSummary(s: GameState): RouteWorkSummary {
  const result: RouteWorkSummary = { rule: RIVER_PATH_RULE };
  if (s.routeWorks) result.completed = s.routeWorks.riverPath;
  for (const r of s.residents) for (const [a, paused] of [[r.action, false], [r.suspended, true]] as const) {
    if (a?.kind === "repair-route") {
      const blockedReason = getRouteWorkProblem(s, r, a);
      result.working = { residentId: r.id, paused, ...(blockedReason ? { blockedReason } : {}) };
    }
  }
  return result;
}
export function getRouteWorkDuration(s: GameState, residentId: string): number | undefined {
  const r = s.residents.find(person => person.id === residentId);
  return r ? Math.ceil(RIVER_PATH_RULE.baseMinutes * (1 + r.wounds.arm * 0.25)) : undefined;
}
export function getRouteWorkEdgeMinutes(s: GameState, from: LocationId, to: LocationId): number | undefined {
  return s.routeWorks?.riverPath && ((from === "meadow" && to === "village") || (from === "village" && to === "meadow"))
    ? RIVER_PATH_RULE.afterMinutes : undefined;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));

export function validRouteWorkAction(a: Action, allowComplete = false): boolean {
  return whole(a.id, 1) && a.kind === "repair-route" && a.target === RIVER_PATH_RULE.id && a.origin === RIVER_PATH_RULE.location
    && a.automatic === false && whole(a.duration, 40) && a.duration <= 70 && whole(a.progress) && (allowComplete ? a.progress <= a.duration : a.progress < a.duration)
    && a.reservationSource === "pack" && record(a.reserved) && exact(a.reserved, ["scrap"]) && a.reserved.scrap === RIVER_PATH_RULE.cost.scrap
    && Object.keys(a).every(k => ["id", "kind", "label", "progress", "duration", "target", "reserved", "reservationSource", "automatic", "origin"].includes(k));
}

/** The same local conditions govern preview, resumption, each tick and completion. */
export function getRouteWorkProblem(s: GameState, r: Resident, a?: Action): string | undefined {
  if (r.hp <= 0) return "意識が戻るまで道の整備を進められません。";
  if (r.location !== RIVER_PATH_RULE.location || (a && a.origin !== r.location))
    return "道の整備は川沿いの採集地で行います。現場へ戻ってから再開してください。";
  if (getPresentEncounterAt(s, r.location))
    return "ここではまだ交戦の危険があります。整備より先に周囲の安全と退路を確認してください。";
  if (s.residents.some(carrier => carrier.id !== r.id && carrier.hp > 0 && carrier.location === r.location && r.hp <= 35
    && [carrier.action, carrier.suspended].some(job => job?.kind === "rescue" && job.target === r.id)))
    return "救助・運搬中です。運搬を終えてから現場を確認してください。";
  if (s.routeWorks) return "川沿いの道はもう整っています。";
  if (s.residents.some(other => [other.action, other.suspended].some(job => job?.kind === "repair-route" && job.id !== a?.id)))
    return "道を整備中、または中断中の住民がいます。完了か取消を待ってください。";
  if (a && (!validRouteWorkAction(a, true) || (s.inventory?.packs[r.id]?.scrap ?? 0) < RIVER_PATH_RULE.cost.scrap
    || ownFreeResources(s, r.id).scrap < 0)) return "整備に確保した本人の資材を確認できません。材料は使わずに作業を止めています。";
  return undefined;
}

/** New facts are paired with the actual work log; old saves receive no extension. */
export function validRouteWorks(s: GameState): boolean {
  const jobs = s.residents.flatMap(r => [r.action, r.suspended]).filter(a => a?.kind === "repair-route");
  if (jobs.length > 1 || (jobs.length > 0 && s.routeWorks !== undefined)) return false;
  if (!Array.isArray(s.logs)) return false;
  const marked = s.logs.filter(l => record(l) && "routeWork" in l);
  if (s.routeWorks === undefined) return marked.length === 0;
  if (!record(s.routeWorks) || !exact(s.routeWorks, ["version", "riverPath"]) || s.routeWorks.version !== 1) return false;
  const entry = s.routeWorks.riverPath;
  if (!record(entry) || !exact(entry, ["ruleId", "actorId", "location", "completedAt", "logId"])
    || entry.ruleId !== RIVER_PATH_RULE.id || entry.location !== RIVER_PATH_RULE.location
    || typeof entry.actorId !== "string" || !whole(entry.completedAt) || entry.completedAt > s.minutes
    || !whole(entry.logId, 1) || entry.logId >= s.nextId) return false;
  // This is a log identity, never an extant or retained action identity.
  if (s.residents.some(r => [r.action, r.suspended].some(a => a
    && (a.id === entry.logId || a.targetActionId === entry.logId || a.topic?.peerActionId === entry.logId)))
    || Object.values(s.autonomy?.leisure ?? {}).some(usage => usage.actionId === entry.logId)) return false;
  const matches = s.logs.filter(l => l.id === entry.logId), log = matches[0];
  const ids = new Set(s.residents.map(r => r.id));
  if (!ids.has(entry.actorId) || matches.length !== 1 || marked.length !== 1 || marked[0] !== log
    || log.type !== "work" || log.time !== entry.completedAt || "coinTrade" in log || "coinTransfer" in log
    || !Array.isArray(log.actors) || log.actors.length !== 1 || log.actors[0] !== entry.actorId
    || !Array.isArray(log.witnesses) || !log.witnesses.includes(entry.actorId)
    || new Set(log.witnesses).size !== log.witnesses.length || log.witnesses.some(id => !ids.has(id))
    || !record(log.routeWork) || !exact(log.routeWork, ["ruleId", "location"])
    || log.routeWork.ruleId !== entry.ruleId || log.routeWork.location !== entry.location) return false;
  for (const id of new Set([...log.actors, ...log.witnesses])) {
    const r = s.residents.find(person => person.id === id)!;
    if (r.joinedAt !== undefined && (entry.completedAt < r.joinedAt
      || (r.joinedLogId !== undefined && entry.logId <= r.joinedLogId))) return false;
  }
  return true;
}
