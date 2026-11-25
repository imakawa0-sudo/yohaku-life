import { cellName, furnishings, type FixtureKind, type Room } from "./house";

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
