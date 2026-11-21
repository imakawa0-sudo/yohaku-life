import type { CraftPiece, GameState, LifeExperience, LocationId } from "./types";
import { getCraftTitle } from "./projects";
import { isSceneryLocation, sceneryName } from "./scenery";

export type CraftSubjectChoice = {
  eventId: number;
  time: number;
  location: LocationId;
  label: string;
};

function isSubjectEvent(value: unknown): value is LifeExperience {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "number" && Number.isSafeInteger(event.id) && event.id > 0
    && event.kind === "quiet" && typeof event.location === "string"
    && isSceneryLocation(event.location as LocationId)
    && typeof event.time === "number" && Number.isSafeInteger(event.time) && event.time >= 0
    && Array.isArray(event.actors) && Array.isArray(event.witnesses);
}

function subjectEvent(state: GameState, eventId: unknown): LifeExperience | undefined {
  if (typeof eventId !== "number" || !Number.isSafeInteger(eventId) || eventId < 1
    || !Array.isArray(state.life?.events)) return undefined;
  return state.life.events.find((event) => isSubjectEvent(event) && event.id === eventId);
}

/** Safe also while an untrusted save is being validated, before life validation. */
export function validCraftSubjectReference(
  state: GameState,
  authorId: string,
  eventId: unknown,
  beforeId: number,
  atTime: number,
): boolean {
  const event = subjectEvent(state, eventId);
  return !!event && Number.isSafeInteger(beforeId) && event.id < beforeId && event.time <= atTime
    && event.actors.includes(authorId) && event.witnesses.includes(authorId);
}

function choice(state: GameState, event: LifeExperience): CraftSubjectChoice {
  const time = event.time % 1440;
  const clock = `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
  const people = event.actors.map((id) => state.residents.find((resident) => resident.id === id)?.name ?? id).join("・");
  return { eventId: event.id, time: event.time, location: event.location,
    label: `第${Math.floor(event.time / 1440) + 1}日 ${clock} · ${sceneryName(event.location)} · ${people}` };
}

/** Available subjects are facts the selected author actually participated in. */
export function getCraftSubjectChoices(state: GameState, authorId: string): CraftSubjectChoice[] {
  if (!Number.isSafeInteger(state.nextId) || !state.residents.some((resident) => resident.id === authorId)) return [];
  return (Array.isArray(state.life?.events) ? state.life.events : [])
    .filter((event) => isSubjectEvent(event) && event.id < state.nextId && event.time <= state.minutes
      && event.actors.includes(authorId) && event.witnesses.includes(authorId))
    .map((event) => choice(state, event))
    .sort((first, second) => second.time - first.time || second.eventId - first.eventId);
}

export function getCraftSubject(
  state: GameState,
  piece: Pick<CraftPiece, "subjectEventId">,
): CraftSubjectChoice | undefined {
  const event = subjectEvent(state, piece.subjectEventId);
  return event ? choice(state, event) : undefined;
}

/** Keep short design names separate from the explicitly selected subject. */
export function getCraftDisplayTitle(state: GameState, piece: CraftPiece): string {
  const subject = getCraftSubject(state, piece);
  return subject
    ? `${sceneryName(subject.location)}の景色を題材にした${getCraftTitle(piece)}`
    : getCraftTitle(piece);
}

export function getCraftSubjectText(state: GameState, piece: CraftPiece): string | undefined {
  const subject = getCraftSubject(state, piece);
  return subject ? `題材：${subject.label}` : undefined;
}
