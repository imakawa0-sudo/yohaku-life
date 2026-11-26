import type { Game } from "../sim";
import { createConstructionPlan } from "./construction";
import type { ConstructionResult } from "./constructionTypes";
export {
  isIndoorHousingRoom,
  isRoomInsulated,
  homeColdProtection,
} from "./coldProtection";

export function createRoomInsulation(
  game: Game,
  request: { roomId: string; stagingCell: number },
): ConstructionResult {
  if (!request || typeof request !== "object")
    return { game, error: "寒さ対策をする屋内の部屋を選んでください。" };
  if ("height" in request || "width" in request)
    return { game, error: "寒さ対策では部屋の広さを指定できません。" };
  const room = game.house.rooms.find((room) => room.id === request.roomId);
  return createConstructionPlan(
    game,
    {
      name: room?.name.trim().slice(0, 24).trimEnd() ?? "",
      neighborId: request.roomId,
      stagingCell: request.stagingCell,
    },
    "insulation",
  );
}
