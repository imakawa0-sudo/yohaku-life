export type SpatialPoint = { domainId: string; cell: number };
export type SpatialRef = { kind: "actor" | "item"; id: string };

export type SpatialStep = {
  kind: "walk" | "connection";
  id: string;
  from: SpatialPoint;
  to: SpatialPoint;
  minutes: number;
};

export type SpatialPosition =
  | { kind: "at"; point: SpatialPoint }
  | { kind: "transit"; step: SpatialStep; remaining: number }
  | { kind: "carried"; carrierId: string };

export type SpatialIntent =
  | { kind: "move"; actorId: string; destination: SpatialPoint }
  | { kind: "use"; actorId: string; slotId: string; useMinutes: number }
  | {
      kind: "carry";
      actorId: string;
      payload: SpatialRef;
      destination: SpatialPoint;
    };

export type SpatialReason =
  | "missing"
  | "physical-block"
  | "entry-denied"
  | "use-denied"
  | "handling-denied"
  | "reserved"
  | "actor-busy"
  | "payload-unavailable"
  | "occupied"
  | "invalid-input";

export type SpatialDomain = {
  id: string;
  width: number;
  height: number;
  blockedCells: number[];
  stepMinutes: number;
};

export type SpatialGate = {
  id: string;
  a: SpatialPoint;
  b: SpatialPoint;
  open: boolean;
};

export type SpatialConnection = SpatialGate & { minutes: number };
export type SpatialEntryRule = {
  point: SpatialPoint;
  allowedActorIds: string[];
};
export type SpatialSlot = {
  id: string;
  point: SpatialPoint;
  allowedActorIds: string[] | null;
};

export type SpatialActivePhase = "approach" | "move" | "use" | "carry";
export type SpatialOrder = {
  id: string;
  intent: SpatialIntent;
  phase: SpatialActivePhase | "waiting" | "exiting-after-cancel";
  useRemaining: number;
  resumePhase: SpatialActivePhase | null;
  waitReason: SpatialReason | null;
  pickupPoint: SpatialPoint | null;
};

export type SpatialItem = {
  id: string;
  position: SpatialPosition;
  carryAllowedActorIds: string[] | null;
};

export type SpatialActor = SpatialItem & { order: SpatialOrder | null };

export type SpatialReservation = {
  id: string;
  targetId: string;
  orderId: string;
  actorId: string;
} & ({ kind: "slot" } | { kind: "payload"; payloadKind: SpatialRef["kind"] });

export type SpatialState = {
  type: "housing-spatial-state";
  version: 1;
  time: number;
  nextOrderId: number;
  domains: Record<string, SpatialDomain>;
  connections: Record<string, SpatialConnection>;
  gates: Record<string, SpatialGate>;
  entryRules: SpatialEntryRule[];
  slots: Record<string, SpatialSlot>;
  actors: Record<string, SpatialActor>;
  items: Record<string, SpatialItem>;
  reservations: Record<string, SpatialReservation>;
};

export type SpatialEvent = {
  orderId: string;
  actorId: string;
  kind: "arrived" | "use-completed" | "picked-up" | "delivered" | "cancelled";
  atTime: number;
};

export type SpatialTransition = { state: SpatialState; events: SpatialEvent[] };
export type SpatialEntryResult =
  { ok: true } | { ok: false; reason: SpatialReason };
export type SpatialRouteResult =
  | { physical: true; ok: true; steps: SpatialStep[]; minutes: number }
  | { physical: boolean; ok: false; reason: SpatialReason };
