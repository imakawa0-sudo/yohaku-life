import type { SpatialPoint } from "../spatial/types";
import type { Game } from "../sim";
export type ConstructionRequest = {
  name: string;
  neighborId: string;
  stagingCell: number;
};
export type ConstructionResult = {
  game: Game;
  error?: string;
  planId?: string;
};
export const constructionWood = 6;
export const constructionWorkMinutes = 30;
export type HaulDirection = "deliver" | "return";
export type ConstructionInspection = {
  ok: boolean;
  disabled?: string;
  minutes: number | null;
};
export type RoomConstruction = {
  id: string;
  name: string;
  neighborId: string;
  source: SpatialPoint;
  staging: SpatialPoint;
  createdAt: number;
  requiredWood: typeof constructionWood;
  workMinutes: typeof constructionWorkMinutes;
  workedMinutes: number;
  status: "planned" | "cancelled" | "completed";
  completedAt?: number;
  roomId?: string;
  cancelledAt?: number;
  material?: {
    itemId: string;
    quantity: typeof constructionWood;
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
