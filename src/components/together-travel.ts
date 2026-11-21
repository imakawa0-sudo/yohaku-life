import type { GameState, LocationId, Resident } from "../game/types";

/** Display selection never fills missing/stale ids from the viewed person. */
export function getTogetherTravelSelection(game: GameState, selectedIds: readonly string[]): readonly [Resident, Resident] | undefined {
  if (selectedIds.length !== 2 || new Set(selectedIds).size !== 2) return;
  const first = game.residents.find(person => person.id === selectedIds[0]);
  const second = game.residents.find(person => person.id === selectedIds[1]);
  if (!first || !second || first.location !== second.location) return;
  return [first, second];
}

/** A draft belongs to this selection, physical origin and loaded world only. */
export function getTogetherTravelScope(game: GameState, selectedIds: readonly string[], worldSession = 0): string {
  return JSON.stringify([worldSession, selectedIds.map(id => [id, game.residents.find(person => person.id === id)?.location ?? null])]);
}

export type TogetherRouteRequest = {
  scope: string;
  target: LocationId;
  via?: LocationId[];
};

/** Only reciprocal current move facts are displayed as an active companion. */
export function getTogetherMoveInfo(game: GameState, residentId: string) {
  const actor = game.residents.find(person => person.id === residentId);
  const job = actor?.action;
  if (!actor || job?.kind !== "move" || !job.together) return;
  const peer = game.residents.find(person => person.id === job.together!.peerResidentId);
  const other = peer?.action;
  if (!peer || other?.kind !== "move" || other.id !== job.together.peerActionId
    || other.together?.peerResidentId !== actor.id || other.together.peerActionId !== job.id) return;
  return { peerId: peer.id, peerName: peer.name, target: job.target as LocationId,
    remaining: Math.ceil(Math.max(0, job.duration - job.progress)) };
}
