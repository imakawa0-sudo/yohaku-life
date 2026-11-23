import type {
  SpatialPoint,
  SpatialState,
} from "../../src/reform/spatial/types";

export function homePoint(cell: number): SpatialPoint {
  return { domainId: "home", cell };
}

export function otherPoint(cell: number): SpatialPoint {
  return { domainId: "other", cell };
}

export function createSpatialFixture(): SpatialState {
  return {
    type: "housing-spatial-state",
    version: 1,
    time: 0,
    nextOrderId: 1,
    domains: {
      home: {
        id: "home",
        width: 3,
        height: 2,
        blockedCells: [],
        stepMinutes: 1,
      },
      other: {
        id: "other",
        width: 2,
        height: 1,
        blockedCells: [],
        stepMinutes: 1,
      },
    },
    connections: {
      road: {
        id: "road",
        a: homePoint(0),
        b: otherPoint(0),
        minutes: 3,
        open: true,
      },
    },
    gates: {
      "private-door": {
        id: "private-door",
        a: homePoint(1),
        b: homePoint(2),
        open: true,
      },
    },
    entryRules: [],
    slots: {
      "desk-seat": {
        id: "desk-seat",
        point: homePoint(2),
        allowedActorIds: null,
      },
    },
    actors: {
      P: {
        id: "P",
        position: { kind: "at", point: homePoint(0) },
        carryAllowedActorIds: null,
        order: null,
      },
      Q: {
        id: "Q",
        position: { kind: "at", point: homePoint(0) },
        carryAllowedActorIds: null,
        order: null,
      },
    },
    items: {
      F: {
        id: "F",
        position: { kind: "at", point: otherPoint(1) },
        carryAllowedActorIds: null,
      },
    },
    reservations: {},
  };
}
