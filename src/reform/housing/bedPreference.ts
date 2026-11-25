import type { Game } from "../sim";

function isResident(game: Game, actorId: string): boolean {
  return game.actors.some((actor) => actor.person.id === actorId);
}

function isBedFixture(game: Game, fixtureId: string): boolean {
  return game.house.rooms.some((room) =>
    room.fixtures.some(
      (fixture) =>
        fixture.id === fixtureId &&
        (fixture.kind === "mat" || fixture.kind === "bed"),
    ),
  );
}

export function getPreferredBed(
  game: Game,
  actorId: string,
): string | undefined {
  const preferences = game.housing?.preferredBeds;
  return preferences && Object.hasOwn(preferences, actorId)
    ? preferences[actorId]
    : undefined;
}

export function setPreferredBed(
  game: Game,
  actorId: string,
  fixtureId: string | null,
): Game {
  if (
    !game.housing ||
    !isResident(game, actorId) ||
    (fixtureId !== null && !isBedFixture(game, fixtureId)) ||
    getPreferredBed(game, actorId) === (fixtureId ?? undefined)
  )
    return game;

  const housing = { ...game.housing };
  const preferences = {
    ...housing.preferredBeds,
    ...(fixtureId !== null && { [actorId]: fixtureId }),
  };
  if (fixtureId === null) delete preferences[actorId];
  if (Object.keys(preferences).length) housing.preferredBeds = preferences;
  else delete housing.preferredBeds;
  return { ...game, housing };
}

export function isBedPreferences(
  value: unknown,
  game: Game,
): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((actorId) => {
    const entry = Object.getOwnPropertyDescriptor(value, actorId);
    return (
      typeof actorId === "string" &&
      entry?.enumerable === true &&
      typeof entry.value === "string" &&
      isResident(game, actorId) &&
      isBedFixture(game, entry.value)
    );
  });
}

/** Remove dangling bed references from an already cloned house edit. */
export function prunePreferredBeds(game: Game): void {
  const housing = game.housing;
  const preferences = housing?.preferredBeds;
  if (!housing || !preferences) return;
  const staleActorIds = Object.keys(preferences).filter(
    (actorId) => !isBedFixture(game, preferences[actorId]),
  );
  if (!staleActorIds.length) return;
  for (const actorId of staleActorIds) delete preferences[actorId];
  if (!Object.keys(preferences).length) delete housing.preferredBeds;
}
