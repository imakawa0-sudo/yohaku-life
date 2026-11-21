import type { Action, GameState, LocationId, Resident } from "./types";

export type TogetherMovePreview = {
  error?: string;
  residents: { id: string; name: string; individualMinutes: number }[];
  minutes?: number;
  path?: LocationId[];
  origin?: LocationId;
};
type EdgeCost = (from: LocationId, to: LocationId, resident: Resident) => number;
type Pair = { residents: [Resident, Resident]; actions: [Action, Action] };
const samePath = (a: Action, b: Action) => Array.isArray(a.path) && Array.isArray(b.path)
  && a.path.length === b.path.length && a.path.every((p, i) => p === b.path![i]);
const endpoint = (a: Action) => a.segment ? a.path?.[a.segment - 1] : a.origin;
/** Called only at stable command/minute boundaries, never in the resident loop. */
function pairFor(s: GameState, resident: Resident): Pair | undefined {
  const a = resident.action;
  if (!a?.together || a.kind !== "move" || a.automatic !== false || resident.hp <= 0) return;
  const peer = s.residents.find(r => r.id === a.together!.peerResidentId), b = peer?.action;
  if (!peer || peer === resident || peer.hp <= 0 || !b?.together || b.kind !== "move" || b.automatic !== false
    || a.together.peerActionId !== b.id || b.together.peerResidentId !== resident.id || b.together.peerActionId !== a.id
    || !samePath(a, b) || a.target !== b.target || a.origin !== b.origin || a.segment !== b.segment
    || a.segmentProgress !== b.segmentProgress || a.segmentDuration !== b.segmentDuration
    || a.progress !== b.progress || a.duration !== b.duration || resident.location !== peer.location
    || resident.location !== endpoint(a)) return;
  return { residents: [resident, peer], actions: [a, b] };
}
function pairs(s: GameState): Pair[] {
  const seen = new Set<number>(), result: Pair[] = [];
  for (const resident of s.residents) {
    const pair = pairFor(s, resident);
    if (pair && !seen.has(pair.actions[0].id)) {
      pair.actions.forEach(a => seen.add(a.id)); result.push(pair);
    }
  }
  return result;
}
function tailCost(path: LocationId[], from: LocationId, residents: Resident[], edge: EdgeCost): number {
  return path.reduce((sum, to) => {
    const cost = Math.max(...residents.map(r => edge(from, to, r))); from = to; return sum + cost;
  }, 0);
}
function refreshIndividual(r: Resident, edge: EdgeCost) {
  const a = r.action;
  if (a?.kind !== "move" || !a.path || (a.segment ?? 0) >= a.path.length) return;
  const index = a.segment ?? 0;
  if ((a.segmentProgress ?? 0) === 0) a.segmentDuration = edge(r.location, a.path[index], r);
  a.duration = a.progress + a.segmentDuration! - (a.segmentProgress ?? 0)
    + tailCost(a.path.slice(index + 1), a.path[index], [r], edge);
}
/** Detaching changes only links and current travel estimates, never held work. */
export function normalizeTogetherMoves(s: GameState, edge: EdgeCost, unavailableIds: ReadonlySet<string> = new Set()): void {
  const valid = new Set(pairs(s).filter(pair => pair.residents.every(r => !unavailableIds.has(r.id)))
    .flatMap(pair => pair.actions.map(a => a.id)));
  for (const r of s.residents) {
    if (r.suspended?.together) delete r.suspended.together;
    if (r.action?.together && !valid.has(r.action.id)) {
      delete r.action.together;
      refreshIndividual(r, edge);
    }
  }
}
/** The roadwork phase may update a not-yet-started edge, never a begun one. */
export function refreshTogetherTravel(s: GameState, edge: EdgeCost): void {
  for (const { residents, actions } of pairs(s)) {
    const a = actions[0], index = a.segment!;
    const duration = (a.segmentProgress ?? 0) === 0
      ? Math.max(...residents.map(r => edge(r.location, a.path![index], r))) : a.segmentDuration!;
    const remaining = duration - a.segmentProgress!
      + tailCost(a.path!.slice(index + 1), a.path![index], residents, edge);
    for (const job of actions) { job.segmentDuration = duration; job.duration = job.progress + remaining; }
  }
}
export type TogetherStep = { segmentDuration?: number; duration: number };
/** Freeze from/to and personal costs before either location is changed. */
export function snapshotTogetherSteps(s: GameState, edge: EdgeCost): Map<number, TogetherStep> {
  const steps = new Map<number, TogetherStep>(), arrivals: { resident: Resident; location: LocationId }[] = [];
  for (const { residents, actions } of pairs(s)) {
    const a = actions[0];
    if (a.segmentProgress! + 1 < a.segmentDuration!) continue;
    const nextIndex = a.segment! + 1, location = a.path![a.segment!];
    const segmentDuration = nextIndex < a.path!.length
      ? Math.max(...residents.map(r => edge(location, a.path![nextIndex], r))) : undefined;
    const duration = a.progress + 1 + tailCost(a.path!.slice(nextIndex), location, residents, edge);
    for (let i = 0; i < 2; i++) {
      steps.set(actions[i].id, { segmentDuration, duration });
      arrivals.push({ resident: residents[i], location });
    }
  }
  for (const arrival of arrivals) arrival.resident.location = arrival.location;
  return steps;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
/** New metadata only. Old independent moves retain their old acceptance rules. */
export function validTogetherMoves(s: GameState, connected: (from: LocationId, to: LocationId) => boolean): boolean {
  for (const r of s.residents) for (const a of [r.action, r.suspended]) {
    if (!a || a.together === undefined) continue;
    const link = a.together;
    if (s.version !== 5 || !whole(s.nextId, 1) || a !== r.action || a.kind !== "move" || a.automatic !== false || r.hp <= 0
      || !record(link) || Object.keys(link).length !== 2 || !Object.hasOwn(link, "peerResidentId")
      || !Object.hasOwn(link, "peerActionId") || typeof link.peerResidentId !== "string"
      || !whole(link.peerActionId, 1) || link.peerActionId >= s.nextId || link.peerActionId === a.id
      || !whole(a.id, 1) || a.id >= s.nextId || !whole(a.progress) || !whole(a.duration, 1) || a.progress >= a.duration
      || !whole(a.segment) || !whole(a.segmentProgress) || !whole(a.segmentDuration, 1)
      || !a.path?.length || a.segment >= a.path.length || a.segmentProgress >= a.segmentDuration
      || a.progress < a.segmentProgress + a.segment
      || a.duration - a.progress < a.segmentDuration - a.segmentProgress + a.path.length - a.segment - 1
      || (a.segment === a.path.length - 1 && a.duration - a.progress !== a.segmentDuration - a.segmentProgress)
      || !a.origin || !pairFor(s, r)
      || Object.keys(a).some(k => !["id", "kind", "label", "progress", "duration", "target", "automatic", "path", "segment", "segmentProgress", "segmentDuration", "origin", "together"].includes(k))) return false;
    let from = a.origin;
    for (const to of a.path) { if (!connected(from, to)) return false; from = to; }
    if (s.residents.some(carrier => carrier.id !== r.id && carrier.hp > 0
      && [carrier.action, carrier.suspended].some(job => job?.kind === "rescue" && job.target === r.id))) return false;
  }
  return true;
}
