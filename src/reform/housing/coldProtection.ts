import type { Actor, Game } from "../sim";
import { places } from "../world";
import { physicalHomeRoom } from "./roomStay";

export function isIndoorHousingRoom(game: Game, roomId: string): boolean {
  return (
    roomId !== "yard" && game.house.rooms.some((room) => room.id === roomId)
  );
}

export function isRoomInsulated(game: Game, roomId: string): boolean {
  return Object.values(game.housing?.construction?.plans ?? {}).some(
    (plan) =>
      plan.kind === "insulation" &&
      plan.status === "completed" &&
      plan.roomId === roomId,
  );
}

export function destinationColdProtection(
  game: Game,
  roomId: string | null,
): "whole-home" | "room" | null {
  if (game.insulated) return "whole-home";
  return roomId && isRoomInsulated(game, roomId) ? "room" : null;
}

export function bedProtectionLabel(game: Game, roomId: string): string {
  switch (destinationColdProtection(game, roomId)) {
    case "whole-home":
      return "家全体で対策済み";
    case "room":
      return "一室対策済み";
    default:
      return roomId === "yard" ? "屋外・未対策" : "未対策";
  }
}

export function bedProtectionPreview(game: Game, roomId: string): string {
  const frost = places(game.world).find(
    (place) => place.id === game.home,
  )!.frost;
  const beforeFrost = Math.floor(game.time / 1440) + 1 < frost;
  const when = beforeFrost ? `初霜（${frost}日目）から` : "初霜を迎えたため、";
  const effect = destinationColdProtection(game, roomId)
    ? "この寝床では寒さによる休息の追加消耗を防げます。"
    : "この寝床では寒さで休息の消耗が増えます。";
  return `休息先の寒さ対策　${bedProtectionLabel(game, roomId)}。${when}${effect}`;
}

export function homeColdProtection(
  game: Game,
  actor: Actor,
): "whole-home" | "room" | null {
  const housing = game.housing;
  const id = actor.person.id;
  if (
    actor.location !== game.home ||
    housing?.unlocated[id]?.reason === "regional-travel"
  )
    return null;
  return destinationColdProtection(game, physicalHomeRoom(game, actor));
}
