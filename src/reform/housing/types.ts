import type { HousingConstruction, HaulDirection } from "./constructionTypes";
import type { FixtureKind } from "../house";
import type {
  SpatialPoint,
  SpatialReason,
  SpatialState,
} from "../spatial/types";

export type HousingControls = {
  closedLinks: string[];
  closedDoors: string[];
  roomAccess: Record<string, string[] | null>;
};

export type HousingTaskBinding = {
  orderId: string;
  kind: "move" | "use" | "carry";
  constructionId?: string;
  direction?: HaulDirection;
  gatheringId?: string;
  mealPartners?: Record<string, number>;
  socialCompany?: true;
};

export type HousingRuntime = {
  version: 1;
  layoutVersion?: 2;
  construction?: HousingConstruction;
  gatherings?: Record<string, HousingGathering>;
  nextGatheringId?: number;
  state: SpatialState;
  unlocated: Record<
    string,
    {
      location: string;
      room: string;
      reason: "legacy-unspecified" | "outside" | "regional-travel";
      departurePoint?: SpatialPoint;
    }
  >;
  controls: HousingControls;
  legacyStationPaths: Record<string, string[]>;
};

export type HousingSlot = {
  id: string;
  fixtureId: string;
  roomId: string;
  kind: FixtureKind;
  seat: number;
  point: SpatialPoint;
};

export type HousingTopology = {
  geometry: Pick<
    SpatialState,
    "domains" | "connections" | "gates" | "entryRules" | "slots"
  >;
  slots: Record<string, HousingSlot>;
  controls: HousingControls;
};

export type HousingStatus = {
  location: string;
  destination: string | null;
  phase:
    | "legacy"
    | "unlocated"
    | "idle"
    | "move"
    | "use"
    | "waiting"
    | "cancelling"
    | "outside";
  detail: string;
  minutes: number | null;
  useRemaining: number | null;
  waitReason?: SpatialReason;
};

export type GatheringKind = "talk" | "meal";
export type GatheringMember = {
  actorId: string;
  slotId: string;
  orderId: string;
  status: "participating" | "withdrawing" | "left" | "completed";
  usedMinutes: number;
  togetherMinutes: number;
  stoppedAt: number | null;
};
export type HousingGathering = {
  id: string;
  kind: GatheringKind;
  roomId: string;
  fixtureId: string;
  createdAt: number;
  deadline: number;
  startedAt: number | null;
  useMinutes: number;
  members: GatheringMember[];
  pairs: { actorIds: [string, string]; minutes: number }[];
};

export const gatheringUseMinutes = 20;
export const gatheringWaitMinutes = 15;

export function isGatheringVenue(kind: string) {
  return kind === "bench" || kind === "table" || kind === "kitchen";
}
