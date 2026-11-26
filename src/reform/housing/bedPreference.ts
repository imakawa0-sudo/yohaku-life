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

type BedPolicy = "preferredBeds" | "bedSleepers";

function readSetting(
  game: Game,
  policy: BedPolicy,
  id: string,
): string | undefined {
  const settings = game.housing?.[policy];
  return settings && Object.hasOwn(settings, id) ? settings[id] : undefined;
}

export function getPreferredBed(
  game: Game,
  actorId: string,
): string | undefined {
  return readSetting(game, "preferredBeds", actorId);
}

export function getBedSleeper(
  game: Game,
  fixtureId: string,
): string | undefined {
  return readSetting(game, "bedSleepers", fixtureId);
}

function setBedPolicy(
  game: Game,
  policy: BedPolicy,
  id: string,
  value: string | null,
): Game {
  if (!game.housing || readSetting(game, policy, id) === (value ?? undefined))
    return game;
  const housing = { ...game.housing };
  const settings = {
    ...housing[policy],
    ...(value !== null && { [id]: value }),
  };
  if (value === null) delete settings[id];
  if (Object.keys(settings).length) housing[policy] = settings;
  else delete housing[policy];
  return { ...game, housing };
}

export function setPreferredBed(
  game: Game,
  actorId: string,
  fixtureId: string | null,
): Game {
  if (
    !isResident(game, actorId) ||
    (fixtureId !== null && !isBedFixture(game, fixtureId))
  )
    return game;
  return setBedPolicy(game, "preferredBeds", actorId, fixtureId);
}

export function setBedSleeper(
  game: Game,
  fixtureId: string,
  actorId: string | null,
): Game {
  if (
    !isBedFixture(game, fixtureId) ||
    (actorId !== null && !isResident(game, actorId))
  )
    return game;
  return setBedPolicy(game, "bedSleepers", fixtureId, actorId);
}

function validEntries(
  value: unknown,
  accepts: (key: string, id: string) => boolean,
): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const entry = Object.getOwnPropertyDescriptor(value, key);
    return (
      typeof key === "string" &&
      entry?.enumerable === true &&
      typeof entry.value === "string" &&
      accepts(key, entry.value)
    );
  });
}

export function isBedPreferences(
  value: unknown,
  game: Game,
): value is Record<string, string> {
  return validEntries(
    value,
    (actorId, fixtureId) =>
      isResident(game, actorId) && isBedFixture(game, fixtureId),
  );
}

export function isBedSleepers(
  value: unknown,
  game: Game,
): value is Record<string, string> {
  return (
    validEntries(
      value,
      (fixtureId, actorId) =>
        isBedFixture(game, fixtureId) && isResident(game, actorId),
    ) && Object.keys(value).length > 0
  );
}

/** Remove dangling bed references from an already cloned house edit. */
function pruneBedSettings(game: Game, policy: BedPolicy): void {
  const housing = game.housing;
  const settings = housing?.[policy];
  if (!housing || !settings) return;
  const stale = Object.keys(settings).filter(
    (key) => !isBedFixture(game, policy === "preferredBeds" ? settings[key] : key),
  );
  if (!stale.length) return;
  for (const key of stale) delete settings[key];
  if (!Object.keys(settings).length) delete housing[policy];
}

export function prunePreferredBeds(game: Game): void {
  pruneBedSettings(game, "preferredBeds");
}

export function pruneBedSleepers(game: Game): void {
  pruneBedSettings(game, "bedSleepers");
}
