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
  kind: "move" | "use";
  mealPartners?: Record<string, number>;
  socialCompany?: true;
};

export type HousingRuntime = {
  version: 1;
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
