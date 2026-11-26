import { residentLabel } from "./displayNames";
import { getBedSleeper } from "./housing/bedPreference";
import { bedProtectionLabel } from "./housing/coldProtection";
import type { Game } from "./sim";
import {
  cellName,
  furnishings,
  type Fixture,
  type FixtureKind,
  type Room,
} from "./house";

export function facilityLabel(
  rooms: Room[],
  room: Room,
  kind: FixtureKind,
  cell: number,
): string {
  const sameName = rooms.filter((other) => other.name === room.name);
  const ordinal =
    sameName.length > 1 ? `、同名の${sameName.indexOf(room) + 1}室目` : "";
  return `${room.name}・${furnishings[kind].name}（${cellName(room, cell)}${ordinal}）`;
}

export function bedChoiceLabel(
  game: Game,
  room: Room,
  fixture: Fixture,
): string {
  const label = facilityLabel(
    game.house.rooms,
    room,
    fixture.kind,
    fixture.cell,
  );
  const sleeperId = getBedSleeper(game, fixture.id);
  const sleeper =
    sleeperId && game.actors.find((actor) => actor.person.id === sleeperId);
  const access = sleeper ? ` · ${residentLabel(game, sleeper)}専用` : "";
  return `${label} · ${bedProtectionLabel(game, room.id)}${access}`;
}
