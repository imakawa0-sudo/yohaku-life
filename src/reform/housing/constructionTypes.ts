import { roomConstructionWood, type PlannedRoomHeight } from "../house";
import type { SpatialPoint } from "../spatial/types";
import type { Game } from "../sim";
export type ConstructionRequest = {
  name: string;
  neighborId: string;
  stagingCell: number;
  height?: PlannedRoomHeight;
};
export type ConstructionResult = {
  game: Game;
  error?: string;
  planId?: string;
};
export { roomConstructionWood };
export const constructionWood = roomConstructionWood();
export const constructionWorkMinutes = 30;
export type HaulDirection = "deliver" | "return";
export type ConstructionInspection = {
  ok: boolean;
  disabled?: string;
  minutes: number | null;
};
export type RoomConstruction = {
  kind?: "insulation";
  height?: 4;
  id: string;
  name: string;
  neighborId: string;
  source: SpatialPoint;
  staging: SpatialPoint;
  createdAt: number;
  requiredWood: number;
  workMinutes: typeof constructionWorkMinutes;
  workedMinutes: number;
  status: "planned" | "cancelled" | "completed";
  completedAt?: number;
  roomId?: string;
  cancelledAt?: number;
  material?: {
    itemId: string;
    quantity: number;
    state: "present" | "returned" | "consumed";
  };
  assignment?: { actorId: string; orderId: string } & (
    { kind: HaulDirection } | { kind: "build"; startedWorkMinutes: number }
  );
};
export type HousingConstruction = {
  version: 1;
  nextId: number;
  plans: Record<string, RoomConstruction>;
};

export function canReviseRoomConstruction(plan: RoomConstruction): boolean {
  return (
    plan.kind === undefined &&
    plan.status === "planned" &&
    !plan.material &&
    !plan.assignment &&
    plan.workedMinutes === 0
  );
}

export function constructionTitle(plan: RoomConstruction): string {
  const work = plan.kind === "insulation" ? "寒さ対策" : "増築";
  return `「${plan.name}」の${work}`;
}
