import { getPresentEncounterAt } from "./encounters";
import { isKnownLocation, workSite } from "./types";
import type { Action, ActionKind, AutonomyReason, AutonomyState, GameState, LocationId, Resident, Resources } from "./types";
import { getLocalProjectEffects } from "./projects";
import { accessibleResources, canShareAtCurrentLocation } from "./inventory";
import { getRoutine } from "./routines";
import { DEFAULT_FOOD_PRODUCTION_TARGET, getFoodProductionTarget, needsFoodProduction } from "./food-production";

export type AutonomyDecision = {
  kind: ActionKind;
  target?: string;
  reason: AutonomyReason;
  leisure?: "help" | "social" | "quiet";
  nextKind?: "cook" | "gather" | "rest";
};
export const AUTONOMY_CODES: AutonomyReason["code"][] = ["food", "recovery", "cooking", "gathering", "return", "quiet", "help", "social"];
const BASE = new Set<LocationId>(["home", "kitchen", "bedroom", "garden"]);
const WORK: ActionKind[] = ["cook", "gather", "hobby", "decorate", "project"];
const awake = (r: Resident) => r.hp > 0 && r.action?.kind !== "sleep";
const ready = (r: Resident | undefined) => !!r && r.hp >= 45 && r.energy >= 28 && BASE.has(r.location) && !r.action && !r.suspended;
export const pairKey = (a: string, b: string) => [a, b].sort().join(":");
export function ensureAutonomy(s: GameState): AutonomyState {
  return s.autonomy ??= { version: 1, leisure: {}, manualStays: {}, conversations: {}, mealPairs: {} };
}
export function getAutonomyReason(action: Action | null): string | undefined { return action?.autonomyReason?.text; }
export function recordManualStay(s: GameState, r: Resident, source: "arrival" | "cancel") {
  if (r.id !== "aki") ensureAutonomy(s).manualStays[r.id] = { time: s.minutes, location: r.location, source };
}
export function recordAutonomyStart(s: GameState, r: Resident, action: Action, decision: AutonomyDecision) {
  if (decision.leisure) ensureAutonomy(s).leisure[r.id] = {
    day: Math.floor(s.minutes / 1440) + 1, startedAt: s.minutes, kind: decision.leisure, actionId: action.id,
  };
}
export function decideAutonomy(
  s: GameState, id: string, travel: (destination: LocationId) => number | undefined, free: Resources,
): AutonomyDecision | undefined {
  const r = s.residents.find((person) => person.id === id);
  if (!r || id === "aki" || s.ended || !awake(r) || r.action || r.suspended) return;
  const reason = (code: AutonomyReason["code"], text: string): AutonomyReason => ({ code, text, decidedAt: s.minutes });
  const choose = (kind: ActionKind, code: AutonomyReason["code"], text: string, target?: string): AutonomyDecision =>
    ({ kind, reason: reason(code, text), ...(target ? { target } : {}) });
  const routine = getRoutine(r);
  const recover = r.energy < 28 || r.hp < 45 || (r.policy === "rest" && (r.energy < 85 || r.hp < 90));
  if (!BASE.has(r.location)) {
    const beingCarried = s.residents.some((p) => p.id !== r.id && p.action?.kind === "rescue" && p.action.target === r.id);
    if (getPresentEncounterAt(s, r.location) || beingCarried) return;
    if (r.location === "lodge" && !canShareAtCurrentLocation(s, r.id)) return;
    if (r.hunger < 42 && free.food >= 1)
      return choose("eat", "food", "空腹なので、今いる場所で使える携行食をとる");
    // Settled work stays in this household. Its keeper never puts another
    // person's supplies, the cabinet, or the distant main store in the pot.
    if (r.location === "lodge") {
      if (recover) return choose("rest", "recovery", "舟宿の板間で体と活力を休める");
      const cooks = r.policy === "cook" || (r.policy === "balanced" && routine.workRole === "cook");
      const occupied = s.residents.some(p => [p.action, p.suspended].some(job => job?.kind === "cook" && job.origin === "lodge"));
      if (cooks && !occupied && needsFoodProduction(s, free))
        return choose("cook", "cooking", "舟宿で使える食事が少ないので、手持ちの食材を現地の鍋で煮る");
    }
    return;
  }
  const preferred: LocationId = routine.home;
  if (r.hunger < 42 && free.food > 0) return choose("eat", "food", "空腹なので、用意された食事をとる");
  if (recover) {
    const corner = s.life?.upgrades?.find((u) => u.recipeId === "rest-corner");
    if (corner && corner.location !== r.location && r.energy > 12 && r.hp >= 30 && (travel(corner.location) ?? Infinity) <= 10)
      return { ...choose("move", "recovery", "体調を整えるため、休憩場所へ向かう", corner.location), nextKind: "rest" };
    return choose("rest", "recovery", "体調と活力を整えるため、ひと息つく");
  }
  if (r.policy === "rest") return;
  // A passive listener retains their own control; ordinary autonomous work waits.
  if (s.residents.some((p) => p.action?.kind === "socialize" && p.action.target === id)) return;
  const claimed = (kind: "cook" | "gather") => s.residents.some((other) => other.id !== id && other.hp > 0
    && ((other.action?.kind === kind && (kind !== "cook" || workSite(other.action.origin) === workSite(r.location)))
      || (kind === "cook" && other.suspended?.kind === "cook" && workSite(other.suspended.origin) === workSite(r.location))
      || (other.action?.kind === "move" && other.action.automatic && other.action.autonomyNext === kind)));
  // Roles select the usual worker; a genuinely available substitute is chosen
  // by the relevant skill and ID, independently of roster order or identity.
  const worker = (kind: "cook" | "gather") => {
    const eligible = s.residents.filter((p) => p.id !== "aki" && ready(p)
      && (p.policy === kind || p.policy === "balanced")
      && (kind !== "cook" || accessibleResources(s, p.id).ingredients >= 2));
    const designated = eligible.filter((p) => p.policy === kind || getRoutine(p).workRole === kind);
    const skill = kind === "cook" ? "cooking" : "craft";
    return (designated.length ? designated : eligible)
      .sort((a, b) => b.skills[skill] - a.skills[skill] || a.id.localeCompare(b.id))[0]?.id;
  };
  if (needsFoodProduction(s, free) && !claimed("cook")
    && (r.policy === "cook" || (r.policy === "balanced" && worker("cook") === id))) {
    const target = getFoodProductionTarget(s);
    const tools = s.life?.upgrades?.find((u) => u.recipeId === "kitchen-tools");
    if (tools && tools.location !== r.location) {
      const base = Math.max(20, 40 - r.skills.cooking * 3) * (1 + r.wounds.arm * 0.25);
      const current = Math.ceil(base * getLocalProjectEffects(s, r.location).cookingMultiplier);
      const destination = Math.ceil(base * 0.75) + (travel(tools.location) ?? Infinity);
      if (destination <= current && r.hunger > 25)
        return { ...choose("move", "cooking", target === DEFAULT_FOOD_PRODUCTION_TARGET
          ? "食事が少ないため、料理道具のある場所で用意する"
          : `補充目安${target}食に届かないため、料理道具のある場所で用意する`, tools.location), nextKind: "cook" };
    }
    return choose("cook", "cooking", target === DEFAULT_FOOD_PRODUCTION_TARGET
      ? "食事の用意が少ないため、料理する" : `補充目安${target}食に届かないため、料理する`);
  }
  const gatheringNeeded = r.policy === "gather" ? free.ingredients < 12 : free.ingredients < 4;
  if (gatheringNeeded && !claimed("gather") && (r.policy === "gather" || (r.policy === "balanced" && worker("gather") === id))) {
    if (r.location !== "garden") return { ...choose("move", "gathering", "食材を補うため、裏庭へ向かう", "garden"), nextKind: "gather" };
    return choose("gather", "gathering", "食材を補うため、裏庭で集める");
  }
  if (r.policy !== "balanced") return;
  const stay = s.autonomy?.manualStays[id];
  if (stay && stay.location === r.location && s.minutes - stay.time < 60) return;
  if (r.location !== preferred) return choose("move", "return", "必要な仕事が落ち着いたので、生活の場所へ戻る", preferred);
  const day = Math.floor(s.minutes / 1440) + 1;
  const time = s.minutes % 1440;
  if (time < 480 || time >= 1200 || s.autonomy?.leisure[id]?.day === day) return;
  if (routine.leisure === "quiet") return { ...choose("rest", "quiet", "静かな場所で、自分の時間を過ごす"), leisure: "quiet" };
  const affinity = (p: Resident) => (r.relations[p.id]?.closeness ?? 0) + (r.relations[p.id]?.trust ?? 0);
  const peers = s.residents.filter((p) => p.id !== id && p.location === r.location && awake(p))
    .sort((a, b) => affinity(b) - affinity(a) || a.id.localeCompare(b.id));
  const helper = peers.find((p) => p.action && WORK.includes(p.action.kind) && p.action.duration - p.action.progress > 12);
  if (helper) return { ...choose("help", "help", `${helper.name}の進行中の仕事を手伝いたい`, helper.id), leisure: "help" };
  const peer = peers.find((p) => !p.action && !p.suspended && !s.residents.some((other) => other.action?.kind === "socialize" && other.action.target === p.id));
  if (peer) return { ...choose("socialize", "social", `${peer.name}と、少し話す時間を過ごしたい`, peer.id), leisure: "social" };
}

export function validAutonomy(s: GameState): boolean {
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  const integer = (x: unknown, max = s.minutes) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
  const ids = new Set(s.residents.map((r) => r.id));
  const day = Math.floor(s.minutes / 1440) + 1;
  for (const r of s.residents) for (const a of [r.action, r.suspended]) if (a) {
    if (a.autonomyReason !== undefined && (!object(a.autonomyReason) || a.automatic !== true
      || !AUTONOMY_CODES.includes(a.autonomyReason.code) || typeof a.autonomyReason.text !== "string" || !integer(a.autonomyReason.decidedAt))) return false;
    if (a.autonomyReason) {
      if (r.id === "aki") return false;
      const code = a.autonomyReason.code;
      const matches = code === "food" ? a.kind === "eat"
        : code === "recovery" ? a.kind === "rest" || (a.kind === "move" && a.autonomyNext === "rest")
        : code === "cooking" ? a.kind === "cook" || (a.kind === "move" && a.autonomyNext === "cook")
        : code === "gathering" ? a.kind === "gather" || (a.kind === "move" && a.autonomyNext === "gather")
        : code === "return" ? a.kind === "move" && a.autonomyNext === undefined
        : code === "quiet" ? a.kind === "rest"
        : code === "help" ? a.kind === "help" : a.kind === "socialize";
      if (!matches) return false;
      if (["quiet", "help", "social"].includes(code)) {
        const usage = s.autonomy?.leisure?.[r.id];
        if (!object(usage) || usage.actionId !== a.id || usage.kind !== code
          || usage.startedAt !== a.autonomyReason.decidedAt
          || usage.day !== Math.floor(a.autonomyReason.decidedAt / 1440) + 1) return false;
      }
    }
    if (a.autonomyNext !== undefined && (a.kind !== "move" || a.automatic !== true
      || !["cook", "gather", "rest"].includes(a.autonomyNext) || !a.target || !BASE.has(a.target as LocationId) || !a.autonomyReason)) return false;
  }
  if (s.autonomy === undefined) return true;
  const v = s.autonomy;
  if (!object(v) || v.version !== 1 || !object(v.leisure) || !object(v.manualStays) || !object(v.conversations) || !object(v.mealPairs)) return false;
  for (const [id, x] of Object.entries(v.leisure)) if (!ids.has(id) || !object(x) || !integer(x.day, day) || x.day < 1
    || !integer(x.startedAt) || Math.floor(x.startedAt / 1440) + 1 !== x.day || !["help", "social", "quiet"].includes(x.kind)
    || !integer(x.actionId, s.nextId - 1) || x.actionId < 1) return false;
  for (const [id, x] of Object.entries(v.manualStays)) if (!ids.has(id) || !object(x) || !integer(x.time)
    || !BASE.has(x.location) || !["arrival", "cancel"].includes(x.source)) return false;
  const validPair = (key: string) => {
    const pair = key.split(":"); return pair.length === 2 && pair[0] !== pair[1] && pair.every((id) => ids.has(id)) && pairKey(pair[0], pair[1]) === key;
  };
  for (const [key, x] of Object.entries(v.conversations)) {
    if (!validPair(key) || !object(x) || !integer(x.day, day) || x.day < 1 || !integer(x.count, 100000) || x.count < 1
      || !integer(x.time) || Math.floor(x.time / 1440) + 1 !== x.day || !integer(x.eventId, s.nextId - 1)) return false;
    const event = s.life?.events.find((e) => e.id === x.eventId);
    if (!event || event.kind !== "conversation" || event.time !== x.time || !key.split(":").every((id) => event.actors.includes(id))) return false;
  }
  for (const [key, x] of Object.entries(v.mealPairs)) {
    if (!validPair(key) || !object(x) || !integer(x.time) || !isKnownLocation(x.location) || !integer(x.eventId, s.nextId - 1)) return false;
    const event = s.life?.events.find((e) => e.id === x.eventId);
    if (!event || event.kind !== "meal" || event.location !== x.location || event.time !== x.time || !key.split(":").every((id) => event.actors.includes(id))) return false;
  }
  return true;
}
