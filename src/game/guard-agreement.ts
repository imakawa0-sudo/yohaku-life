import type { GameState, LocationId } from "./types";
import { canShareAtCurrentLocation, ownFreeResources } from "./inventory";
import { actionEncounterId } from "./encounters";

export const GUARD_AGREEMENT_RULE = Object.freeze({
  id: "ruins-provisions-v1",
  counterpartId: "ruins-guard",
  counterpartName: "置き場の守り手",
  location: "ruins",
  cost: Object.freeze({ food: 3 }),
} as const);
export type GuardAgreementFact = { ruleId: typeof GUARD_AGREEMENT_RULE.id; location: typeof GUARD_AGREEMENT_RULE.location };
export type GuardAgreementState = GuardAgreementFact & { version: 1; actorId: string; agreedAt: number; logId: number };
export type GuardAgreementPreview = {
  rule: typeof GUARD_AGREEMENT_RULE;
  actorId?: string;
  actorName?: string;
  freeFood?: number;
  foodAfter?: number;
  completed?: GuardAgreementState;
  error?: string;
};

/** Absence has two causes; a negotiated departure is never a combat defeat. */
export const isGuardPresent = (s: GameState): boolean => !s.enemy.defeated && !s.guardAgreement;
export const isGuardPresentAt = (s: GameState, location: LocationId): boolean => isGuardPresent(s) && s.enemy.location === location;

/** The selected person pays locally; neither reading nor failure changes jobs. */
export function inspectGuardAgreement(s: GameState, residentIds: readonly string[]): GuardAgreementPreview {
  const result: GuardAgreementPreview = { rule: GUARD_AGREEMENT_RULE,
    ...(s.guardAgreement ? { completed: { ...s.guardAgreement } } : {}) };
  const fail = (error: string): GuardAgreementPreview => ({ ...result, error });
  if (!Array.isArray(residentIds) || residentIds.length !== 1 || typeof residentIds[0] !== "string")
    return fail("食事を渡す住民を、住民一覧で一人だけ選んでください。");
  const actor = s.residents.find(r => r.id === residentIds[0]);
  if (!actor) return fail("選択した住民が見つかりません。");
  result.actorId = actor.id;
  result.actorName = actor.name;
  result.freeFood = ownFreeResources(s, actor.id).food;
  result.foodAfter = result.freeFood - GUARD_AGREEMENT_RULE.cost.food;
  if (s.ended) return fail("この試行は終了しています。保存から再開してください。");
  if (!Number.isSafeInteger(s.nextId) || s.nextId >= Number.MAX_SAFE_INTEGER)
    return fail("合意を記録する番号を確保できません。食事や指示は変更していません。");
  if (s.guardAgreement) return fail("置き場はすでに譲り受けています。相手は立ち去りました。");
  if (!isGuardPresent(s) || s.enemy.location !== GUARD_AGREEMENT_RULE.location || s.enemy.hp <= 18)
    return fail("今は置き場を譲る話のできる相手がいません。");
  if (actor.location !== GUARD_AGREEMENT_RULE.location)
    return fail(`${actor.name}が資材置き場に着いてから、食事を渡せます。`);
  if (actor.hp <= 0 || actor.action?.kind === "sleep") return fail(`${actor.name}が起きて動けるようになってから、食事を渡せます。`);
  if (!canShareAtCurrentLocation(s, actor.id)) return fail("移動や救助・運搬が終わってから、食事を渡せます。");
  const ordered = s.residents.find(r => [r.action, r.suspended].some(a => a && !a.automatic && ["attack", "defend"].includes(a.kind) && actionEncounterId(a) === "ruins-guard"));
  if (ordered) return fail(`${ordered.name}に攻撃・防御の指示が残っています。終えるか、明示して取り消してから話してください。`);
  if (result.freeFood < GUARD_AGREEMENT_RULE.cost.food)
    return fail("本人の未予約の携行食が3食必要です。倉庫や仲間の食事は、そのまま渡せません。");
  return result;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));

/** An optional past agreement and its one social fact must name each other. */
export function validGuardAgreement(s: GameState): boolean {
  if (!Array.isArray(s.logs)) return false;
  const marked = s.logs.filter(l => record(l) && "guardAgreement" in l);
  if (s.guardAgreement === undefined) return marked.length === 0;
  const entry = s.guardAgreement;
  if (!record(entry) || !exact(entry, ["version", "ruleId", "actorId", "location", "agreedAt", "logId"])
    || entry.version !== 1 || entry.ruleId !== GUARD_AGREEMENT_RULE.id || entry.location !== GUARD_AGREEMENT_RULE.location
    || typeof entry.actorId !== "string" || !whole(entry.agreedAt) || entry.agreedAt > s.minutes
    || !whole(entry.logId, 1) || entry.logId >= s.nextId
    || s.enemy.defeated || s.enemy.location !== entry.location || s.enemy.hp <= 18) return false;
  if (s.residents.some(r => [r.action, r.suspended].some(a => a
    && ((["attack", "defend"].includes(a.kind) && actionEncounterId(a) === "ruins-guard") || a.id === entry.logId || a.targetActionId === entry.logId || a.topic?.peerActionId === entry.logId)))
    || Object.values(s.autonomy?.leisure ?? {}).some(usage => usage.actionId === entry.logId)
    || [...(s.life?.crafts ?? []), ...(s.life?.events ?? []), ...(s.life?.upgrades ?? []), ...(s.trade?.receipts ?? [])].some(item => item.id === entry.logId)
    || (s.travelPlans?.entries ?? []).some(plan => plan.id === entry.logId || plan.revisionId === entry.logId)) return false;
  const matches = s.logs.filter(l => l.id === entry.logId), log = matches[0];
  const ids = new Set(s.residents.map(r => r.id)), guardId = GUARD_AGREEMENT_RULE.counterpartId;
  if (!ids.has(entry.actorId) || matches.length !== 1 || marked.length !== 1 || marked[0] !== log
    || log.type !== "social" || log.time !== entry.agreedAt || "coinTrade" in log || "coinTransfer" in log || "routeWork" in log || "encounter" in log
    || !Array.isArray(log.actors) || log.actors.length !== 2 || !log.actors.includes(entry.actorId) || !log.actors.includes(guardId)
    || !Array.isArray(log.witnesses) || !log.witnesses.includes(entry.actorId) || !log.witnesses.includes(guardId)
    || new Set(log.witnesses).size !== log.witnesses.length || log.witnesses.some(id => id !== guardId && !ids.has(id))
    || !record(log.guardAgreement) || !exact(log.guardAgreement, ["ruleId", "location"])
    || log.guardAgreement.ruleId !== entry.ruleId || log.guardAgreement.location !== entry.location) return false;
  for (const id of new Set([...log.actors, ...log.witnesses])) {
    if (id === guardId) continue;
    const r = s.residents.find(person => person.id === id)!;
    if (r.joinedAt !== undefined && (entry.agreedAt < r.joinedAt
      || (r.joinedLogId !== undefined && entry.logId <= r.joinedLogId))) return false;
  }
  return true;
}
