import type { Action, EncounterId, GameState, LocationId } from "./types";

export const SECOND_ENCOUNTER_RULE = Object.freeze({
  id: "ridge-watch", location: "ridge", name: "尾根の見張り",
  maxHp: 60, approachMinutes: 20, retreatHp: 18, damageBase: 10, damageRange: 5,
} as const);
export type EncounterView = {
  id: EncounterId; name: string; location: LocationId; hp: number; maxHp: number;
  defeated: boolean; present: boolean; absenceReason?: "defeated" | "agreement";
};
/** Explicit first-target commands keep the same saved shape as older jobs. */
export const actionEncounterId = (action: Pick<Action, "encounterId">): EncounterId => action.encounterId ?? "ruins-guard";
export function getEncounter(s: GameState, id: EncounterId): EncounterView | undefined {
  if (id === "ruins-guard") return {
    id, name: "物資を守る流れ者", location: s.enemy.location, hp: s.enemy.hp, maxHp: 80,
    defeated: s.enemy.defeated, present: !s.enemy.defeated && !s.guardAgreement,
    ...(s.enemy.defeated ? { absenceReason: "defeated" as const }
      : s.guardAgreement ? { absenceReason: "agreement" as const } : {}),
  };
  if (id !== SECOND_ENCOUNTER_RULE.id || !s.secondaryEncounter) return;
  return { id, name: SECOND_ENCOUNTER_RULE.name, location: SECOND_ENCOUNTER_RULE.location,
    hp: s.secondaryEncounter.hp, maxHp: SECOND_ENCOUNTER_RULE.maxHp,
    defeated: s.secondaryEncounter.defeated, present: !s.secondaryEncounter.defeated,
    ...(s.secondaryEncounter.defeated ? { absenceReason: "defeated" as const } : {}) };
}
export function getEncounters(s: GameState): EncounterView[] {
  return [getEncounter(s, "ruins-guard")!, ...(s.secondaryEncounter ? [getEncounter(s, "ridge-watch")!] : [])];
}
export function getPresentEncounterAt(s: GameState, location: LocationId): EncounterView | undefined {
  return getEncounters(s).find(e => e.present && e.location === location);
}
export function getLocalEncounter(s: GameState, location: LocationId): EncounterView | undefined {
  return getPresentEncounterAt(s, location)
    ?? (location === SECOND_ENCOUNTER_RULE.location ? getEncounter(s, "ridge-watch") : undefined)
    ?? (s.enemy.location === location ? getEncounter(s, "ruins-guard") : undefined);
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const exact = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
export function validRidgeApproachAction(a: Action): boolean {
  return whole(a.id, 1) && a.kind === "approach-ridge" && a.origin === "ridge" && a.automatic === false
    && a.duration === SECOND_ENCOUNTER_RULE.approachMinutes && whole(a.progress) && a.progress < a.duration
    && Object.keys(a).every(k => ["id", "kind", "label", "duration", "progress", "automatic", "origin"].includes(k));
}
/** These are new second-target jobs only; old missing-target jobs keep their old validation. */
export function validSecondCombatAction(s: GameState, a: Action): boolean {
  return (s.version === 4 || s.version === 5) && !!s.secondaryEncounter && a.encounterId === "ridge-watch"
    && ["attack", "defend"].includes(a.kind) && whole(a.id, 1) && a.id > s.secondaryEncounter.logId
    && a.origin === "ridge" && typeof a.automatic === "boolean"
    && a.duration === (a.kind === "attack" ? 2 : 60) && whole(a.progress) && a.progress < a.duration
    && Object.keys(a).every(k => ["id", "kind", "label", "duration", "progress", "automatic", "origin", "encounterId"].includes(k));
}
/** Version4 requires its explicit introduction; version5 also permits no second encounter. */
export function validSecondaryEncounter(s: GameState): boolean {
  const marked = s.logs.filter(log => record(log) && "encounter" in log);
  const jobs = s.residents.flatMap(r => [r.action, r.suspended]).filter(a => a?.kind === "approach-ridge");
  if (jobs.length > 1) return false;
  if (s.secondaryEncounter === undefined) return s.version !== 4 && marked.length === 0;
  const entry = s.secondaryEncounter;
  if ((s.version !== 4 && s.version !== 5) || !record(entry)
    || !exact(entry, ["version", "hp", "defeated", "introducedAt", "actorId", "logId"], ["alerted"])
    || entry.version !== 1 || typeof entry.hp !== "number" || !Number.isFinite(entry.hp) || entry.hp < 0 || entry.hp > SECOND_ENCOUNTER_RULE.maxHp
    || typeof entry.defeated !== "boolean" || entry.defeated !== (entry.hp <= SECOND_ENCOUNTER_RULE.retreatHp)
    || (entry.alerted !== undefined && typeof entry.alerted !== "boolean")
    || !whole(entry.introducedAt) || entry.introducedAt > s.minutes || typeof entry.actorId !== "string"
    || !whole(entry.logId, 1) || !whole(s.nextId, 1) || entry.logId >= s.nextId || jobs.length > 0) return false;
  if (!entry.defeated && !s.enemy.defeated && !s.guardAgreement && s.enemy.location === "ridge") return false;
  const ids = new Set(s.residents.map(r => r.id));
  const introLogs = s.logs.filter(log => log.id === entry.logId), intro = introLogs[0];
  if (!ids.has(entry.actorId) || introLogs.length !== 1 || !intro || intro.type !== "explore"
    || intro.time !== entry.introducedAt || intro.actors.length !== 1 || intro.actors[0] !== entry.actorId
    || !intro.witnesses.includes(entry.actorId) || !intro.encounter) return false;
  const identityInUse = (id: number): boolean => s.residents.some(r => [r.action, r.suspended].some(a => a
    && (a.id === id || a.targetActionId === id || a.topic?.peerActionId === id)))
    || Object.values(s.autonomy?.leisure ?? {}).some(usage => usage.actionId === id)
    || [...(s.life?.crafts ?? []), ...(s.life?.events ?? []), ...(s.life?.upgrades ?? []), ...(s.trade?.receipts ?? [])].some(item => item.id === id)
    || (s.travelPlans?.entries ?? []).some(plan => plan.id === id || plan.revisionId === id)
    || (s.currency?.transfers ?? []).some(item => item.logId === id)
    || (s.region?.receipts ?? []).some(item => item.logId === id)
    || (s.region?.recruitments ?? []).some(item => item.logId === id)
    || s.guardAgreement?.logId === id || s.routeWorks?.riverPath.logId === id;
  if (identityInUse(entry.logId)) return false;
  for (const log of marked) {
    if (!record(log.encounter) || !exact(log.encounter, ["id", "location"])
      || log.encounter.id !== "ridge-watch" || log.encounter.location !== "ridge"
      || !["explore", "combat"].includes(log.type) || !whole(log.id, 1) || log.id < entry.logId || log.id >= s.nextId
      || s.logs.filter(other => other.id === log.id).length !== 1 || identityInUse(log.id)
      || !whole(log.time) || log.time < entry.introducedAt
      || "coinTrade" in log || "coinTransfer" in log || "routeWork" in log || "guardAgreement" in log
      || new Set(log.actors).size !== log.actors.length || new Set(log.witnesses).size !== log.witnesses.length
      || [...log.actors, ...log.witnesses].some(id => !ids.has(id))) return false;
    for (const id of new Set([...log.actors, ...log.witnesses])) {
      const resident = s.residents.find(r => r.id === id)!;
      if (resident.joinedAt !== undefined && (log.time < resident.joinedAt
        || (resident.joinedLogId !== undefined && log.id <= resident.joinedLogId))) return false;
    }
  }
  return true;
}
