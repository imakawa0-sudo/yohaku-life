import type { Room } from "../house";
import type { Slot } from "../library";
import { isGame, type Game } from "../sim";

type LegacyActorPosition = {
  kind: "legacy-unspecified";
  location: string;
  room: string;
};

type LegacyEntrance = { room: string; cell: 0 };

/** A detached description of a saved house and its residents. */
export type LegacySpatialView = {
  rooms: Record<string, Room>;
  fixtures: Record<string, { room: string; cell: number }>;
  actors: Record<string, LegacyActorPosition>;
  links: { a: LegacyEntrance; b: LegacyEntrance; minutes: 3 }[];
};

export type LegacySlotProjection = {
  source: Slot;
  game: LegacySpatialView;
  origin: LegacySpatialView;
};

function isSlot(value: unknown): value is Slot {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const slot = value as Record<string, unknown>;
  return (
    typeof slot.id === "string" &&
    slot.id.length > 0 &&
    typeof slot.name === "string" &&
    slot.name.trim().length > 0 &&
    isGame(slot.game) &&
    isGame(slot.origin)
  );
}

function projectGame(game: Game): LegacySpatialView {
  const rooms: LegacySpatialView["rooms"] = Object.create(null);
  const fixtures: LegacySpatialView["fixtures"] = Object.create(null);
  const actors: LegacySpatialView["actors"] = Object.create(null);

  for (const room of game.house.rooms) {
    rooms[room.id] = structuredClone(room);
    for (const fixture of room.fixtures) {
      fixtures[fixture.id] = { room: room.id, cell: fixture.cell };
    }
  }
  for (const { person, location, room } of game.actors) {
    actors[person.id] = { kind: "legacy-unspecified", location, room };
  }
  const links: LegacySpatialView["links"] = game.house.links.map(([a, b]) => ({
    a: { room: a, cell: 0 },
    b: { room: b, cell: 0 },
    minutes: 3,
  }));
  return { rooms, fixtures, actors, links };
}

export function projectLegacyHousing(slot: unknown): LegacySlotProjection {
  const source = structuredClone(slot);
  if (!isSlot(source)) throw new Error("旧保存の形式を確認できませんでした。");

  // A caller may share objects between the two snapshots in memory.
  source.origin = structuredClone(source.origin);
  return {
    source,
    game: projectGame(source.game),
    origin: projectGame(source.origin),
  };
}
