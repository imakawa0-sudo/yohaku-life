import type { Action, CraftPiece, GameState, Resident } from "./types";

const BASE = new Set(["home", "kitchen", "bedroom", "garden"]);

/** Recognising an object does not make anyone a witness to its history. */
export function knowsCraft(state: GameState, residentId: string, craftId: number): boolean {
  const craft = state.life?.crafts.find((piece) => piece.id === craftId);
  if (!craft || !state.residents.some((person) => person.id === residentId)) return false;
  return craft.authorId === residentId || !!state.life?.events.some((event) =>
    ((event.kind === "craft" || event.kind === "display" || event.kind === "village-art-feedback")
      && event.craftId === craftId && event.witnesses.includes(residentId))
    || (event.kind === "conversation" && event.topic?.kind === "craft"
      && event.topic.craftId === craftId && event.actors.includes(residentId)));
}

/** The reciprocal job may be in either visible slot while a scene is interrupted. */
export function getCraftConversationPeer(state: GameState, owner: Resident, action: Action):
  { resident: Resident; action: Action } | undefined {
  if (action.kind !== "socialize" || action.topic?.kind !== "craft") return undefined;
  const peer = state.residents.find((person) => person.id === action.target && person.id !== owner.id);
  const job = peer && [peer.action, peer.suspended].find((candidate) => candidate?.id === action.topic!.peerActionId);
  if (!peer || !job || job.kind !== "socialize" || job.target !== owner.id
    || job.topic?.kind !== "craft" || job.topic.peerActionId !== action.id
    || job.topic.craftId !== action.topic.craftId || job.origin !== action.origin
    || job.duration !== action.duration) return undefined;
  return { resident: peer, action: job };
}

/** Physical presence is checked now; historical scene locations are never moved. */
export function craftPresenceProblem(state: GameState, craft: CraftPiece, location: Resident["location"]): string | undefined {
  if (craft.displayedAt !== undefined) {
    if (craft.displayLocation !== location || state.life?.shelf?.location !== location)
      return "作品を展示している部屋で、二人を選んでください。";
  } else {
    const author = state.residents.find((person) => person.id === craft.authorId);
    if (author?.location !== location) return "作者が手元に持つ作品を、同じ部屋で紹介できます。";
  }
  return undefined;
}

export type CraftConversationStatus = { waiting: boolean; reason?: string };

/** The same pure gate drives progress and the displayed waiting reason. */
export function getCraftConversationStatus(state: GameState, residentId: string): CraftConversationStatus | undefined {
  const owner = state.residents.find((person) => person.id === residentId);
  const action = owner?.action;
  if (!owner || action?.topic?.kind !== "craft") return undefined;
  const peer = getCraftConversationPeer(state, owner, action);
  let reason: string | undefined;
  if (!peer) reason = "一緒に見る相手の行動を確認できません。";
  else if (peer.resident.action?.id !== peer.action.id) reason = `${peer.resident.name}の再開を待っています。`;
  else if (owner.hp <= 0 || peer.resident.hp <= 0) reason = "二人の意識が戻るのを待っています。";
  else if (action.progress !== peer.action.progress) reason = "二人の進行を確認できません。";
  else if (!action.origin || !BASE.has(action.origin)
    || owner.location !== action.origin || peer.resident.location !== action.origin)
    reason = "二人が紹介を始めた部屋へ戻るのを待っています。";
  else {
    const craft = state.life?.crafts.find((piece) => piece.id === action.topic!.craftId);
    if (!craft || ![owner.id, peer.resident.id].includes(craft.authorId)) reason = "紹介する作品を確認できません。";
    else reason = craftPresenceProblem(state, craft, action.origin);
  }
  return reason ? { waiting: true, reason } : { waiting: false };
}

/** Run after the individual jobs and life objects have passed save validation. */
export function validCraftConversationActions(state: GameState): boolean {
  for (const owner of state.residents) for (const action of [owner.action, owner.suspended]) {
    if (!action?.topic) continue;
    const peer = getCraftConversationPeer(state, owner, action);
    const craft = state.life?.crafts.find((piece) => piece.id === action.topic!.craftId);
    if (!peer || !craft || action.progress !== peer.action.progress
      || ![owner.id, peer.resident.id].includes(craft.authorId)
      || craft.id >= Math.min(action.id, peer.action.id) || craft.createdAt > state.minutes) return false;
  }
  return true;
}
