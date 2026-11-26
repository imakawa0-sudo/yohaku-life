// node --import tsx scripts/compare-rescue-recovery.mts
// Actual field travel, injuries, rescue, and treatment. The ordinary sleep
// controls reproduce the independent H9 baseline from da63748.
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import {
  createGame,
  enableHousing,
  advance,
  order,
  inspectOrder,
  setHousingRoomAccess,
  isGame,
  type Game,
} from "../src/reform/sim.ts";
import {
  getBedSleeper,
  setBedSleeper,
  setPreferredBed,
} from "../src/reform/housing/bedPreference.ts";
import {
  housingPoint,
  housingRoomId,
  housingSlotId,
} from "../src/reform/housing/topology.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
const patient = "person-1",
  helper = "person-2",
  near = "fixture-1",
  far = "mat-1";
const H = editHouse(initialHouse(), {
  type: "build",
  kind: "mat",
  room: "living",
  cell: 6,
});
const game = enableHousing(
  createGame(
    [makePersona(0, 4), makePersona(1, 27)],
    generateWorld(defaultWorldConfig()),
    "forest",
    H,
  ),
  "new",
);
const save = (g: Game) =>
  exportSlot({
    id: "field-housing",
    name: "検証専用・帰宅後の療養",
    origin: game,
    game: g,
  });
const load = (g: Game) => importSlot(save(g)).game;
const actor = (g: Game, id: string) =>
  g.actors.find((a) => a.person.id === id)!;
function accept(g: Game, id: string, kind: string, target?: string) {
  const preview = inspectOrder(g, id, kind, target);
  assert.equal(
    preview.disabled,
    undefined,
    kind + " " + target + " " + preview.disabled,
  );
  const next = order(g, id, kind, target);
  assert.equal(next.time, g.time);
  return { g: next, minutes: preview.minutes! };
}
function issue(g: Game, id: string, kind: string, target?: string) {
  const cmd = accept(g, id, kind, target);
  const next = advance(cmd.g, cmd.minutes);
  assert.equal(next.time, g.time + cmd.minutes);
  assert.ok(isGame(next));
  return next;
}
const elapsed = (g: Game, base: Game) => g.time - base.time;
const snapshots: Game[] = [];
const field = accept(game, patient, "travel", "pass");
let out = advance(accept(field.g, helper, "travel", "pass").g, field.minutes);
assert.equal(actor(out, helper).location, "pass");
assert.equal(actor(out, patient).location, "pass");
let encounters = 0;
while (snapshots.length < 2) {
  assert.ok(encounters++ < 30);
  out = issue(out, patient, "explore");
  assert.equal(actor(out, patient).danger, true);
  out = issue(out, patient, "defend");
  if (actor(out, patient).injury > (snapshots.at(-1)?.actors[0].injury ?? 0))
    snapshots.push(load(out));
}
assert.deepEqual(
  snapshots.map((g) => actor(g, patient).injury),
  [38, 76],
);
function rescue(g: Game) {
  const start = accept(g, helper, "rescue", patient);
  const mid = advance(start.g, Math.floor(start.minutes / 2));
  const returned = advance(mid, start.minutes - (mid.time - g.time));
  assert.equal(
    save(returned),
    save(advance(load(mid), returned.time - mid.time)),
  );
  for (const id of [helper, patient]) {
    assert.equal(actor(returned, id).location, returned.home);
    assert.equal(actor(returned, id).task, null);
    assert.deepEqual(returned.housing!.state.actors[id].position, {
      kind: "at",
      point: housingPoint("living", 0),
    });
  }
  assert.equal(actor(g, patient).injury, actor(returned, patient).injury);
  return { minutes: start.minutes, at: returned.time, returned };
}
const repatriated = snapshots.map(rescue);
function location(g: Game, id: string) {
  const p = g.housing!.state.actors[id]?.position;
  return p?.kind === "at" ? p.point : null;
}
const bedrooms = { [near]: "living", [far]: "bedroom" };
function destination(g: Game, bed: string) {
  const point =
    g.housing!.state.slots[housingSlotId(bedrooms[bed], bed, 0)].point;
  return JSON.stringify({
    roomId: housingRoomId(point.domainId),
    cell: point.cell,
  });
}
type Mode = "in place" | "walk then recover" | "ordinary sleep";
type Peer = "work" | "sleep near" | "sleep far";
function study(
  start: Game,
  mode: Mode,
  bed: string,
  peer: Peer,
  rules: "shared" | "patient only" | "helper only" | "room closed" = "shared",
) {
  let g = load(start);
  if (rules === "patient only" || rules === "helper only")
    g = setBedSleeper(g, bed, rules === "patient only" ? patient : helper);
  g = setPreferredBed(g, patient, bed);
  if (rules === "room closed")
    g = setHousingRoomAccess(g, bedrooms[bed], [helper]);
  const ordinaryAuto = inspectOrder(g, patient, "need", "energy").facility;
  const preBed = inspectOrder(g, patient, "home-use", bed);
  const b =
    peer === "work"
      ? accept(g, helper, "work", "wood")
      : accept(g, helper, "home-use", peer === "sleep far" ? far : near);
  g = b.g;
  const afterPeer = inspectOrder(g, patient, "home-use", bed);
  const fallback = inspectOrder(g, patient, "need", "energy").facility;
  const moveTo = destination(g, bed);
  const move = inspectOrder(g, patient, "home-move", moveTo);
  const requested =
    mode === "in place"
      ? inspectOrder(g, patient, "recover")
      : mode === "walk then recover"
        ? move
        : afterPeer;
  const common = {
    severity: actor(start, patient).injury,
    mode,
    bed,
    peer,
    rules,
    peerMinutes: b.minutes,
    dedicated: getBedSleeper(g, bed) ?? null,
    bedInitiallyAvailable: !preBed.disabled,
    bedAfterPeer: !afterPeer.disabled,
    ordinaryAutoBefore: ordinaryAuto?.fixtureId,
    ordinaryAutoAfter: fallback?.fixtureId,
    ordinaryFallback: fallback?.bedPreference?.outcome,
  };
  if (requested.disabled) return { ...common, disabled: requested.disabled };
  let travel = 0,
    commands = 1;
  if (mode === "walk then recover") {
    g = issue(g, patient, "home-move", moveTo);
    travel = g.time - start.time;
    commands++;
  }
  const c =
    mode === "ordinary sleep"
      ? accept(g, patient, "home-use", bed)
      : accept(g, patient, "recover");
  const committed = c.g;
  const afterFive = advance(committed, 5);
  assert.equal(
    save(advance(load(afterFive), c.minutes - 5)),
    save(advance(committed, c.minutes)),
  );
  const done = advance(committed, c.minutes);
  assert.ok(isGame(done));
  assert.equal(actor(done, patient).task, null);
  assert.equal(
    actor(done, patient).injury,
    actor(start, patient).injury - (mode === "ordinary sleep" ? 2 : 12),
  );
  return {
    ...common,
    success: true,
    commands,
    travel,
    cost: elapsed(done, start),
    finalInjury: actor(done, patient).injury,
    energyAtEnd: Math.round(actor(done, patient).needs.energy * 10) / 10,
    reservedSlot: actor(committed, patient).task?.station ?? null,
    position: location(done, patient),
    sameFloorFiveMinutesIntoPatientAction:
      JSON.stringify(location(afterFive, patient)) ===
      JSON.stringify(location(afterFive, helper)),
    nextAid: inspectOrder(done, helper, "aid", patient).disabled ?? "available",
    peerTargetAtPatientFinish: actor(done, helper).task?.target ?? null,
    peerWorkingMinutes:
      actor(done, helper).metrics.work - actor(start, helper).metrics.work,
  };
}
const mod = repatriated[0].returned,
  severe = repatriated[1].returned;
const cases = [
  study(mod, "in place", near, "work"),
  study(mod, "in place", near, "sleep near"),
  study(mod, "walk then recover", near, "work"),
  study(mod, "walk then recover", far, "work", "patient only"),
  study(mod, "walk then recover", near, "sleep near"),
  study(mod, "walk then recover", far, "sleep far"),
  study(mod, "walk then recover", far, "work", "helper only"),
  study(mod, "walk then recover", far, "work", "room closed"),
  study(mod, "ordinary sleep", near, "work"),
  study(severe, "in place", far, "work"),
  study(severe, "walk then recover", far, "work"),
  study(severe, "ordinary sleep", far, "work", "patient only"),
];
function resourceContrast() {
  const g = setPreferredBed(load(mod), helper, near);
  const without = inspectOrder(
    accept(g, patient, "recover").g,
    helper,
    "need",
    "energy",
  );
  // Measured ordinary sleeping policy as a seat-contention PROXY. This is not
  // a bed-based recovery feature. Only the peer's first bed and duration transfer.
  const booked = accept(g, patient, "home-use", near).g;
  const withSeat = inspectOrder(booked, helper, "need", "energy");
  const scheduled = accept(booked, helper, "need", "energy");
  const end = advance(scheduled.g, scheduled.minutes);
  assert.equal(actor(end, helper).task, null);
  return {
    withoutReservedBed: {
      bed: without.facility?.fixtureId,
      minutes: without.minutes,
    },
    withOrdinarySleeper: {
      bed: withSeat.facility?.fixtureId,
      minutes: withSeat.minutes,
    },
    projectedOnly: {
      bed: near,
      walk: inspectOrder(g, patient, "home-use", near).facility!.moveMinutes,
      fixedRecovery: 65,
      injuryChange: -12,
    },
  };
}
const fieldChecks = snapshots.map((g) => {
  const v = issue(g, patient, "recover");
  return {
    oldInjury: actor(g, patient).injury,
    newInjury: actor(v, patient).injury,
    site: actor(v, patient).location,
    duration: v.time - g.time,
    bedUse: inspectOrder(g, patient, "home-use", near).disabled,
  };
});
// Preserve both residents' actual end positions until they can meet for aid.
// Waiting is explicit and kept separate from the recovery and sleep durations.
function waitForPeer(g: Game, minutes: number) {
  const finish = g.time + minutes;
  while (g.time < finish) {
    if (!actor(g, patient).task) g = accept(g, patient, "wait").g;
    assert.equal(actor(g, patient).task?.kind, "wait");
    g = advance(
      g,
      Math.min(actor(g, patient).task!.remaining, finish - g.time),
    );
  }
  return actor(g, patient).task ? order(g, patient, "cancel") : g;
}
function reserved(g: Game, station: string) {
  return Object.values(g.housing!.state.reservations).some(
    (r) => r.kind === "slot" && r.targetId === station && r.actorId === patient,
  );
}
function bookedStudy(selected: string | null, assigned = false) {
  let g = setPreferredBed(load(mod), helper, near);
  if (selected && assigned) g = setBedSleeper(g, selected, patient);
  const select = selected ? { fixtureId: selected } : undefined;
  const forecast = inspectOrder(g, patient, "recover", undefined, select);
  assert.equal(forecast.disabled, undefined);
  const station = selected
    ? housingSlotId(bedrooms[selected], selected, 0)
    : null;
  const initialInjury = actor(g, patient).injury;
  let booked = order(g, patient, "recover", undefined, select);
  assert.equal(booked.time, g.time);
  assert.equal(actor(booked, patient).task?.kind, "recover");
  assert.equal(actor(booked, patient).task?.station ?? null, station);
  const peer = inspectOrder(booked, helper, "need", "energy");
  assert.ok(peer.facility);
  booked = accept(booked, helper, "need", "energy").g;
  const walk = forecast.facility?.moveMinutes ?? 0,
    arrival = walk ? advance(booked, walk) : booked;
  const mid = advance(arrival, 25),
    last = advance(mid, 39),
    done = advance(last, 1);
  assert.equal(actor(done, patient).task, null);
  assert.equal(done.time - booked.time, forecast.minutes);
  assert.equal(forecast.minutes, walk + 65);
  if (selected) assert.equal(forecast.facility!.useMinutes, 65);
  for (const check of [booked, arrival, mid, last]) {
    assert.ok(isGame(check));
    if (station) assert.ok(reserved(check, station));
    assert.equal(actor(check, patient).injury, initialInjury);
    const resumed = advance(load(check), done.time - check.time);
    assert.equal(save(resumed), save(done));
  }
  if (station) assert.ok(!reserved(done, station));
  assert.equal(actor(done, patient).injury, initialInjury - 12);
  const patientSite = location(done, patient)!;
  const helperDone = waitForPeer(done, peer.minutes! - (done.time - g.time));
  assert.equal(actor(helperDone, helper).task, null);
  const helperSite = location(helperDone, helper)!;
  const beforeMeeting = inspectOrder(helperDone, helper, "aid", patient);
  let together = helperDone;
  if (beforeMeeting.disabled) {
    const target = JSON.stringify({
      roomId: housingRoomId(patientSite.domainId),
      cell: patientSite.cell,
    });
    const walkToPatient = accept(helperDone, helper, "home-move", target);
    together = waitForPeer(walkToPatient.g, walkToPatient.minutes);
  }
  assert.deepEqual(location(together, helper), location(together, patient));
  const aided = issue(together, helper, "aid", patient);
  assert.ok(actor(aided, patient).injury < actor(done, patient).injury);
  return {
    selected,
    assigned,
    initialInjury,
    walk,
    recovery: 65,
    completion: done.time - g.time,
    injuryAfter: actor(done, patient).injury,
    patientSite,
    helperBed: peer.facility.fixtureId,
    helperSleepFinished: helperDone.time - g.time,
    helperSite,
    aidAvailableAtHelperFinish: !beforeMeeting.disabled,
    helperWalkToPatient: together.time - helperDone.time,
    aidDone: aided.time - g.time,
    afterAid: actor(aided, patient).injury,
    savedCheckpoints: 4,
    heldUntilFinish: !!station,
  };
}
function selectionCheck(
  name: string,
  g: Game,
  fixtureId: string,
  shouldSucceed = false,
) {
  const select = { fixtureId };
  const preview = inspectOrder(g, patient, "recover", undefined, select);
  const candidate = order(g, patient, "recover", undefined, select);
  assert.equal(candidate.time, g.time);
  if (!shouldSucceed) {
    assert.ok(preview.disabled);
    assert.deepEqual(candidate.actors, g.actors);
    assert.deepEqual(candidate.housing, g.housing);
    return {
      name,
      refused: preview.disabled,
      inPlace: inspectOrder(g, patient, "recover").disabled ?? "available",
    };
  }
  assert.equal(preview.disabled, undefined);
  const finish = advance(candidate, preview.minutes!);
  assert.equal(actor(finish, patient).injury, actor(g, patient).injury - 12);
  assert.equal(
    save(finish),
    save(advance(load(advance(candidate, 1)), preview.minutes! - 1)),
  );
  return {
    name,
    walk: preview.facility!.moveMinutes,
    duration: preview.minutes,
    oldInjury: actor(g, patient).injury,
    newInjury: actor(finish, patient).injury,
  };
}
const otherSleeping = accept(load(mod), helper, "home-use", near).g;
const severelyInBed = issue(severe, patient, "home-use", far);
const actualCases = [
  bookedStudy(null),
  bookedStudy(near),
  bookedStudy(far),
  bookedStudy(far, true),
];
const ordinarySeatControl = resourceContrast();
const [here, nearest, bedroom, dedicated] = actualCases;
assert.equal(here.helperBed, ordinarySeatControl.withoutReservedBed.bed);
assert.equal(
  here.helperSleepFinished,
  ordinarySeatControl.withoutReservedBed.minutes,
);
assert.equal(nearest.helperBed, ordinarySeatControl.withOrdinarySleeper.bed);
assert.equal(
  nearest.helperSleepFinished,
  ordinarySeatControl.withOrdinarySleeper.minutes,
);
assert.equal(
  nearest.completion,
  ordinarySeatControl.projectedOnly.walk +
    ordinarySeatControl.projectedOnly.fixedRecovery,
);
assert.equal(bedroom.helperBed, near);
assert.equal(dedicated.completion, bedroom.completion);
assert.equal(dedicated.helperSleepFinished, bedroom.helperSleepFinished);
const admissionChecks = [
  selectionCheck("missing", mod, "missing-bed"),
  selectionCheck("non-bed", mod, "hearth-1"),
  selectionCheck("already reserved by helper", otherSleeping, near),
  selectionCheck("dedicated to helper", setBedSleeper(mod, far, helper), far),
  selectionCheck(
    "room denied",
    setHousingRoomAccess(mod, "bedroom", [helper]),
    far,
  ),
  selectionCheck("in field", snapshots[0], near),
  selectionCheck("severely injured outside", snapshots[1], near),
  selectionCheck("severely injured at entrance", severe, far),
  selectionCheck("severely injured on use floor", severelyInBed, far, true),
];
console.log(
  JSON.stringify(
    {
      encounters,
      travelToPass: field.minutes,
      rescues: repatriated.map(({ returned, ...rest }) => ({
        ...rest,
        injury: actor(returned, patient).injury,
      })),
      fieldChecks,
      cases,
      historicalSleepProxy: ordinarySeatControl,
      measuredBedRecovery: actualCases,
      admissionChecks,
    },
    null,
    2,
  ),
);
