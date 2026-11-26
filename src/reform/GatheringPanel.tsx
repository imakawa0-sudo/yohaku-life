import { useId, useState } from "react";
import { Users } from "lucide-react";
import { residentLabel, roomLabel } from "./displayNames";
import { facilityLabel } from "./facilityLabel";
import { furnishings, type Fixture, type Room } from "./house";
import {
  gatheringStatus,
  inspectHousingGathering,
  inspectStartReadyGathering,
  startHousingGathering,
  startReadyGathering,
} from "./housing/gathering";
import { housingInTransit } from "./housing/bridge";
import { housingSlotId } from "./housing/topology";
import {
  isGatheringVenue,
  type GatheringKind,
  type HousingGathering,
} from "./housing/types";
import { order, type Actor, type Game } from "./sim";

type Props = {
  game: Game;
  actorId: string;
  onGame: (game: Game) => void;
  invitationWithdrawal?: string;
};

export function invitationWithdrawalText(game: Game, actor: Actor) {
  const id = actor.task?.spatial?.gatheringId;
  const activity = id && game.housing?.gatherings?.[id];
  if (!activity || !activity.invitation) return;
  const { hostId, guestId } = activity.invitation;
  const who = actor.person.id;
  if (who !== hostId && who !== guestId) return;

  // The real cancellation also revokes the invitation and settles the remaining seats.
  const after = order(game, who, "cancel").housing?.gatherings?.[activity.id];
  const continuing =
    after?.members.filter((m) => m.status === "participating") ?? [];
  const leaving = activity.members.filter(
    (m) =>
      m.status === "participating" &&
      !continuing.some((c) => c.actorId === m.actorId),
  );
  const guest = game.actors.find((a) => a.person.id === guestId)!;
  const notes = [
    who === hostId
      ? `招待が終わり、${residentLabel(game, guest)}もこの集まりから離れます。`
      : "この集まりの招待はここで終わります。",
  ];
  const kind = activity.kind === "meal" ? "食事" : "会話";
  if (continuing.length > 0) {
    const remaining =
      continuing.length === 1
        ? residentLabel(
            game,
            game.actors.find((a) => a.person.id === continuing[0].actorId)!,
          )
        : `残る${continuing.length}人`;
    notes.push(`${remaining}の${kind}予定は続きます。`);
  } else {
    notes.push(`この${kind}は終了します。`);
  }
  if (leaving.some((m) => housingInTransit(game, m.actorId)))
    notes.push("通路を移動中の人は、今の区間を出てから離れます。");
  if (activity.kind === "meal") {
    const returned = leaving.reduce(
      (sum, m) =>
        sum +
        (game.actors.find((a) => a.person.id === m.actorId)?.task?.reserved
          .food ?? 0),
      0,
    );
    if (returned)
      notes.push(
        `離れる人の取り置き${returned}食は、離脱時に空きがある分から備蓄に戻ります。`,
      );
  }
  return notes.join("");
}

function seatLabel(room: Room, fixture: Fixture, slotId: string) {
  const item = furnishings[fixture.kind];
  const seat = Array.from({ length: item.seats }, (_, index) =>
    housingSlotId(room.id, fixture.id, index),
  ).indexOf(slotId);
  return room.name + "・" + item.name + "の席" + (seat + 1);
}

function unavailable(game: Game, actor: Actor) {
  if (actor.location !== game.home) return "自宅にいません。";
  if (actor.danger) return "危険に遭っています。";
  if (actor.injury >= 70) return "負傷が重く、参加できません。";
  if (housingInTransit(game, actor.person.id))
    return "移動中です。区間を出るまで参加できません。";
  if (actor.task) return "進行中の予定があります。";
}

function GatheringSetup({ game, actorId, onGame }: Props) {
  const prefix = useId();
  const venues = game.house.rooms.flatMap((room) =>
    room.fixtures
      .filter((fixture) => isGatheringVenue(fixture.kind))
      .map((fixture) => ({
        room,
        fixture,
        id: housingSlotId(room.id, fixture.id, 0),
      })),
  );
  const [kind, setKind] = useState<GatheringKind>("talk");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [pairId, setPairId] = useState("");
  const venue = venues.find((item) => item.id === venueId);
  const actorIds = [actorId, ...selected];
  const entry = venue && game.housing?.controls.roomAccess[venue.room.id];
  const participants = game.actors.filter((actor) =>
    actorIds.includes(actor.person.id),
  );
  const excluded = entry
    ? participants.filter((actor) => !entry.includes(actor.person.id))
    : [];
  const hosts = entry
    ? participants.filter((actor) => entry.includes(actor.person.id))
    : [];
  const guest = excluded.length === 1 ? excluded[0] : undefined;
  const pairs = guest
    ? hosts.map((host) => ({
        id: JSON.stringify([host.person.id, guest.person.id]),
        label: residentLabel(game, host) + " → " + residentLabel(game, guest),
        invitation: { hostId: host.person.id, guestId: guest.person.id },
      }))
    : [];
  const pair = pairs.find((p) => p.id === pairId);
  const request = venue
    ? {
        kind,
        roomId: venue.room.id,
        fixtureId: venue.fixture.id,
        actorIds,
        ...(pair && { invitation: pair.invitation }),
      }
    : null;
  const preview = request ? inspectHousingGathering(game, request) : null;
  const physicalCapacity = preview?.physicalCapacity ?? null;
  const capacity = preview?.capacity ?? null;
  const nominalCapacity = venue ? furnishings[venue.fixture.kind].seats : 0;
  const bookedSeats =
    physicalCapacity === null || capacity === null
      ? 0
      : physicalCapacity - capacity;
  const note = preview
    ? preview.disabled
    : venues.length
      ? "会場を選んでください。"
      : "長椅子・丸卓・台所と食卓があると、会場を選べます。";

  return (
    <form
      className="lf-gathering-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!request || !preview?.ok) return;
        const next = startHousingGathering(game, request);
        if (next !== game) onGame(next);
      }}
    >
      <div className="lf-segment" role="group" aria-label="集まりの種類">
        <button
          type="button"
          aria-pressed={kind === "talk"}
          onClick={() => {
            if (kind !== "talk") setPairId("");
            setKind("talk");
          }}
        >
          会話
        </button>
        <button
          type="button"
          aria-pressed={kind === "meal"}
          onClick={() => {
            if (kind !== "meal") setPairId("");
            setKind("meal");
          }}
        >
          食事
        </button>
      </div>
      <label className="lf-gathering-venue" htmlFor={prefix + "-venue"}>
        会場
      </label>
      <select
        id={prefix + "-venue"}
        value={venue?.id ?? ""}
        onChange={(event) => {
          setVenueId(event.target.value);
          setPairId("");
        }}
        disabled={!venues.length}
      >
        <option value="" disabled>
          会場を選ぶ
        </option>
        {venues.map(({ id, room, fixture }) => (
          <option key={id} value={id}>
            {facilityLabel(game.house.rooms, room, fixture.kind, fixture.cell)}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>参加する住民</legend>
        {game.actors.map((actor) => {
          const { id } = actor.person;
          const name = residentLabel(game, actor);
          const current = id === actorId;
          const checked = current || selected.includes(id);
          const reason = unavailable(game, actor);
          const hint = reason ?? (current ? "操作中の住民" : undefined);
          const hintId = prefix + "-" + id;
          return (
            <label className="lf-gathering-choice" key={id}>
              <input
                type="checkbox"
                aria-label={name}
                aria-describedby={hint ? hintId : undefined}
                checked={checked}
                disabled={current || (!!reason && !checked)}
                onChange={(event) => {
                  const include = event.target.checked;
                  if (
                    !include &&
                    (!pair ||
                      pair.invitation.hostId === id ||
                      pair.invitation.guestId === id)
                  )
                    setPairId("");
                  setSelected((ids) =>
                    include
                      ? [...ids, id]
                      : ids.filter((choice) => choice !== id),
                  );
                }}
              />
              <span>
                {name}
                {hint && <small id={hintId}>{hint}</small>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {pairs.length > 0 ? (
        <>
          <label
            className="lf-gathering-venue"
            htmlFor={prefix + "-invitation"}
          >
            この集まりだけの招待
          </label>
          <select
            id={prefix + "-invitation"}
            aria-describedby={prefix + "-invite-help"}
            value={pair?.id ?? ""}
            onChange={(event) => setPairId(event.target.value)}
          >
            <option value="">招待しない</option>
            {pairs.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <p className="lf-note" id={prefix + "-invite-help"}>
            入室できる参加者 →
            招く相手の順です。二人がこの集まりに参加している間だけ、相手が会場に入れます。
          </p>
        </>
      ) : (
        excluded.length > 0 && (
          <p className="lf-note">
            {entry?.length === 0
              ? "この会場に入室を許可された住人がいません。"
              : excluded.length > 1
                ? "ふだん会場に入れない参加者を招けるのは一人までです。"
                : "ふだん会場に入れる住人を参加者に加えると、一人を招けます。"}
          </p>
        )
      )}
      <dl className="lf-housing-status">
        {preview && (
          <>
            <div>
              <dt>間取りで確保できる席</dt>
              <dd>
                {physicalCapacity === null
                  ? "確認できません"
                  : physicalCapacity + "席"}
              </dd>
            </div>
            <div>
              <dt>会場の空き席</dt>
              <dd>{capacity === null ? "確認できません" : capacity + "席"}</dd>
            </div>
          </>
        )}
        <div>
          <dt>選んだ人数</dt>
          <dd>{actorIds.length}人</dd>
        </div>
        {kind === "meal" && (
          <>
            <div>
              <dt>必要な完成食</dt>
              <dd>{preview?.food ?? actorIds.length}食</dd>
            </div>
            <div>
              <dt>共有備蓄の食事</dt>
              <dd>{game.food}食</dd>
            </div>
          </>
        )}
        {preview?.ok && (
          <>
            <div>
              <dt>全員の到着まで</dt>
              <dd>{preview.arrivalMinutes}分</dd>
            </div>
            <div>
              <dt>到着後の利用</dt>
              <dd>{preview.useMinutes}分</dd>
            </div>
            <div>
              <dt>所要時間の目安</dt>
              <dd>{preview.minutes}分</dd>
            </div>
          </>
        )}
      </dl>
      {physicalCapacity !== null && physicalCapacity < nominalCapacity && (
        <p className="lf-note">
          家具の定員は{nominalCapacity}席です。隣に使える床が足りません。
        </p>
      )}
      {bookedSeats > 0 && (
        <p className="lf-note">{bookedSeats}席は予約済みです。</p>
      )}
      {kind === "meal" && (
        <p className="lf-note">
          共有備蓄から一人一食を取り置きし、食べ始めた時点で使います。
        </p>
      )}
      {venue && !!preview?.assignments.length && (
        <ul className="lf-gathering-people" aria-label="席と到着の見込み">
          {preview.assignments.map(({ actorId, slotId, minutes }) => (
            <li key={actorId}>
              <strong>
                {residentLabel(
                  game,
                  game.actors.find((actor) => actor.person.id === actorId)!,
                )}
              </strong>
              <span>{seatLabel(venue.room, venue.fixture, slotId)}</span>
              <span>
                {minutes ? "到着まで" + minutes + "分" : "すでに席に到着"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="lf-command">
        <button
          type="submit"
          disabled={!preview?.ok}
          aria-describedby={note ? prefix + "-start" : undefined}
        >
          集まりを指示する
        </button>
        {note && <small id={prefix + "-start"}>{note}</small>}
      </div>
    </form>
  );
}

function GatheringActivity({
  game,
  actorId,
  onGame,
  activity,
  invitationWithdrawal,
}: Props & { activity: HousingGathering }) {
  const prefix = useId();
  const room = game.house.rooms.find((item) => item.id === activity.roomId)!;
  const fixture = room.fixtures.find((item) => item.id === activity.fixtureId)!;
  const invitation = activity.invitation;
  const host =
    invitation &&
    game.actors.find((actor) => actor.person.id === invitation.hostId);
  const guest =
    invitation &&
    game.actors.find((actor) => actor.person.id === invitation.guestId);
  const assembling = activity.startedAt === null;
  const ready = assembling
    ? inspectStartReadyGathering(game, activity.id)
    : null;
  const withdrawing = activity.members.some(
    (member) => member.actorId === actorId && member.status === "withdrawing",
  );
  const endsTalk =
    activity.kind === "talk" &&
    activity.members.filter((member) => member.status === "participating")
      .length === 2;
  const readyNote =
    ready?.disabled ??
    (ready &&
      "利用できる席に着いた" +
        ready.readyActorIds.length +
        "人で始め、ほかの人の参加予定を取り消します。");

  return (
    <div className="lf-gathering-activity">
      <h4>
        {activity.kind === "talk" ? "会話" : "食事"} ·{" "}
        {roomLabel(game.house.rooms, room)}・{furnishings[fixture.kind].name}
      </h4>
      <p>
        {assembling
          ? "集合期限まであと" +
            Math.max(0, activity.deadline - game.time) +
            "分"
          : "利用開始済み"}
      </p>
      {host && guest && (
        <dl className="lf-housing-status">
          <div>
            <dt>この集まりの招待</dt>
            <dd>
              {residentLabel(game, host)} → {residentLabel(game, guest)}
              <br />
              二人がこの{activity.kind === "talk" ? "会話" : "食事"}
              に参加している間だけ有効です。
            </dd>
          </div>
        </dl>
      )}
      <ul className="lf-gathering-people" aria-label="住民ごとの席と状況">
        {activity.members.map((member) => {
          const name = residentLabel(
            game,
            game.actors.find((actor) => actor.person.id === member.actorId)!,
          );
          const live =
            member.status === "participating" ||
            member.status === "withdrawing";
          const status = live ? gatheringStatus(game, member.actorId) : null;
          return (
            <li key={member.actorId}>
              <strong>{name}</strong>
              <span>
                {status?.seatLabel ?? seatLabel(room, fixture, member.slotId)}
              </span>
              <span>
                {status?.detail ??
                  (member.status === "completed" ? "完了" : "離脱済み")}
              </span>
              <small>
                利用した時間 {member.usedMinutes}分／{activity.useMinutes}分
              </small>
              <small>一緒に過ごした時間 {member.togetherMinutes}分</small>
            </li>
          );
        })}
      </ul>
      <div className="lf-command-list">
        {ready && (
          <div className="lf-command">
            <button
              type="button"
              disabled={!ready.ok}
              aria-describedby={prefix + "-ready"}
              onClick={() => {
                const next = startReadyGathering(game, activity.id);
                if (next !== game) onGame(next);
              }}
            >
              揃った人で始める
            </button>
            <small id={prefix + "-ready"}>{readyNote}</small>
          </div>
        )}
        <div className="lf-command">
          <button
            type="button"
            disabled={withdrawing}
            aria-describedby={prefix + "-leave"}
            onClick={() => onGame(order(game, actorId, "cancel"))}
          >
            この集まりから離れる
          </button>
          <small id={prefix + "-leave"}>
            {invitationWithdrawal ??
              (withdrawing
                ? "今の区間を出てから離れます。"
                : endsTalk
                  ? "残り一人になるため、この会話は終了します。"
                  : "操作中の住民の参加予定を取り消します。")}
          </small>
        </div>
      </div>
    </div>
  );
}

export function GatheringPanel(props: Props) {
  const { game, actorId } = props;
  const activityId = game.actors.find((actor) => actor.person.id === actorId)
    ?.task?.spatial?.gatheringId;
  const activity = activityId
    ? game.housing?.gatherings?.[activityId]
    : undefined;
  return (
    <section className="lf-gathering" aria-label="一緒に過ごす">
      <div className="lf-section-title">
        <Users size={20} />
        <h3>一緒に過ごす</h3>
      </div>
      {activity ? (
        <GatheringActivity {...props} activity={activity} />
      ) : (
        <GatheringSetup {...props} />
      )}
    </section>
  );
}
