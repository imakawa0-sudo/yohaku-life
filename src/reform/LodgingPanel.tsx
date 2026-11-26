import { useId, useState } from "react";
import { residentLabel, roomLabel } from "./displayNames";
import {
  acceptLodging,
  declineLodging,
  endLodging,
  offerLodging,
  setLodgingReturn,
  withdrawLodgingOffer,
} from "./housing/lodging";
import { housingInTransit } from "./housing/bridge";
import { housingStatus } from "./housing/presentation";
import type { RoomLodging } from "./housing/types";
import { order, type Actor, type Game } from "./sim";

type Props = {
  game: Game;
  actor: Actor;
  onGame: (game: Game) => void;
  onSelect: (id: string) => void;
};

const phases: Record<RoomLodging["phase"], string> = {
  offered: "申し出中（返答待ち）",
  arriving: "入居のため移動中",
  occupied: "入居中",
  leaving: "退居のため移動中",
};
const returns: Record<RoomLodging["returnTo"], string> = {
  entrance: "共用の玄関で止まる",
  room: "玄関から居室まで歩く",
};

function isReturningToRoom(stay: RoomLodging, resident: Actor) {
  return (
    stay.phase === "occupied" &&
    resident.task?.kind === "home-move" &&
    resident.task.mode === "auto" &&
    resident.task.room === stay.roomId
  );
}

export function lodgingWalkCancelText(game: Game, actor: Actor) {
  const stay = game.housing?.lodging;
  if (!stay || stay.residentId !== actor.person.id) return;
  const linked =
    !!stay.orderId && stay.orderId === actor.task?.spatial?.orderId;
  if (!linked && !isReturningToRoom(stay, actor)) return;
  const exit = housingInTransit(game, actor.person.id)
    ? "今の区間の終点まで進みます。"
    : "";
  return (
    exit +
    (stay.phase === "arriving"
      ? "入居の申し出は終了します。"
      : "この部屋での入居を続けます。")
  );
}

function LodgingCommand({
  label,
  result,
  note,
  onGame,
}: {
  label: string;
  result: ReturnType<typeof offerLodging>;
  note?: string;
  onGame: Props["onGame"];
}) {
  const id = useId();
  const hint = result.error ?? note;
  return (
    <div className="lf-command">
      <button
        type="button"
        disabled={!!result.error}
        aria-describedby={hint ? id : undefined}
        onClick={() => {
          if (!result.error) onGame(result.game);
        }}
      >
        {label}
      </button>
      {hint && <small id={id}>{hint}</small>}
    </div>
  );
}

function OfferForm({ game, actor, onGame }: Props) {
  const prefix = useId();
  const rooms = game.house.rooms.filter(
    (room) => room.id !== "living" && room.id !== "yard",
  );
  const others = game.actors.filter(
    (other) => other.person.id !== actor.person.id,
  );
  const [roomId, setRoomId] = useState("");
  const [personId, setPersonId] = useState("");
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const other = others.find((a) => a.person.id === personId) ?? others[0];
  if (!room || !other)
    return (
      <p className="lf-note">
        {!room
          ? "提供できる居室がありません。"
          : "同じ世帯にもう一人いると、入居を申し出られます。"}
      </p>
    );
  const offer = offerLodging(game, actor.person.id, other.person.id, room.id);
  return (
    <div className="lf-policy lf-lodging-body">
      <label htmlFor={prefix + "-room"}>提供する部屋</label>
      <select
        id={prefix + "-room"}
        value={room.id}
        onChange={(event) => setRoomId(event.target.value)}
      >
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {roomLabel(game.house.rooms, r)}
          </option>
        ))}
      </select>
      <label htmlFor={prefix + "-resident"}>入居を申し出る相手</label>
      <select
        id={prefix + "-resident"}
        value={other.person.id}
        onChange={(event) => setPersonId(event.target.value)}
      >
        {others.map((a) => (
          <option key={a.person.id} value={a.person.id}>
            {residentLabel(game, a)}
          </option>
        ))}
      </select>
      <LodgingCommand
        label="入居を申し出る"
        result={offer}
        onGame={onGame}
        note={
          residentLabel(game, actor) +
          "が同じ世帯の住人に一室を提供します。相手が申し出を受け、部屋の入口に着くと入居します。"
        }
      />
    </div>
  );
}

function ReturnForm({
  game,
  stay,
  onGame,
}: Pick<Props, "game" | "onGame"> & { stay: RoomLodging }) {
  const id = useId();
  const [choice, setChoice] = useState(stay.returnTo);
  return (
    <form
      className="lf-policy lf-lodging-body"
      onSubmit={(event) => {
        event.preventDefault();
        const result = setLodgingReturn(game, stay.residentId, choice);
        if (choice !== stay.returnTo && !result.error) onGame(result.game);
      }}
    >
      <label htmlFor={id}>帰宅後の行き先</label>
      <select
        id={id}
        value={choice}
        onChange={(event) =>
          setChoice(event.target.value as RoomLodging["returnTo"])
        }
      >
        <option value="entrance">{returns.entrance}</option>
        <option value="room">{returns.room}</option>
      </select>
      <button
        className="lf-soft-button"
        type="submit"
        disabled={choice === stay.returnTo}
      >
        帰宅先を保存
      </button>
      <p className="lf-note">
        次の通常の帰宅に使います。居室を選ぶと、玄関に着いてから歩く時間がかかります。
      </p>
    </form>
  );
}

function ActiveLodging({
  game,
  actor,
  onGame,
  onSelect,
  stay,
}: Props & { stay: RoomLodging }) {
  const room = game.house.rooms.find((r) => r.id === stay.roomId)!;
  const provider = game.actors.find((a) => a.person.id === stay.providerId)!;
  const resident = game.actors.find((a) => a.person.id === stay.residentId)!;
  const isProvider = actor.person.id === stay.providerId;
  const isResident = actor.person.id === stay.residentId;
  const name = residentLabel(game, resident);
  const accepting =
    isResident && stay.phase === "offered"
      ? acceptLodging(game, stay.residentId)
      : null;
  const ending =
    isResident && stay.phase === "occupied"
      ? endLodging(game, stay.residentId)
      : null;
  const walking = stay.phase === "arriving" || stay.phase === "leaving";
  const homecoming = isReturningToRoom(stay, resident);
  const walk =
    walking || homecoming ? housingStatus(game, stay.residentId) : null;
  const cancelling = walk?.phase === "cancelling";
  const cancelHintId = useId();
  return (
    <div className="lf-lodging-body">
      <dl className="lf-housing-status">
        <div>
          <dt>居室</dt>
          <dd>{roomLabel(game.house.rooms, room)}</dd>
        </div>
        <div>
          <dt>提供する人</dt>
          <dd>{residentLabel(game, provider)}</dd>
        </div>
        <div>
          <dt>{stay.phase === "offered" ? "申し出の相手" : "入居する人"}</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>状況</dt>
          <dd>
            {homecoming ? "入居中 · 帰宅後に居室へ移動中" : phases[stay.phase]}
          </dd>
        </div>
        {stay.phase === "occupied" && (
          <div>
            <dt>通常の帰宅</dt>
            <dd>{returns[stay.returnTo]}</dd>
          </div>
        )}
      </dl>
      {walk && (
        <p className="lf-note">
          {name}は{walk.location}。
          {walk.destination && "行き先は" + walk.destination + "。"}
          {cancelling && walking
            ? lodgingWalkCancelText(game, resident)
            : walk.detail}
          {walk.minutes !== null && "あと" + walk.minutes + "分。"}
        </p>
      )}
      {accepting && (
        <LodgingCommand
          label="受けて入居する"
          onGame={onGame}
          result={accepting}
          note={
            accepting.minutes
              ? "居室の入口まで" +
                accepting.minutes +
                "分歩きます。到着すると入居します。"
              : "居室の入口にいるため、ここで入居します。"
          }
        />
      )}
      {isResident && stay.phase === "offered" && (
        <LodgingCommand
          label="入居を見送る"
          onGame={onGame}
          result={declineLodging(game, stay.residentId)}
        />
      )}
      {isProvider && stay.phase === "offered" && (
        <LodgingCommand
          label="申し出を取り下げる"
          result={withdrawLodgingOffer(game, stay.providerId)}
          onGame={onGame}
        />
      )}
      {!isResident && (
        <button
          type="button"
          className="lf-soft-button"
          onClick={() => onSelect(stay.residentId)}
        >
          {name}に切り替える
        </button>
      )}
      {isResident && walking && (
        <div className="lf-command">
          <button
            type="button"
            disabled={cancelling}
            aria-describedby={cancelHintId}
            onClick={() => onGame(order(game, stay.residentId, "cancel"))}
          >
            {stay.phase === "arriving"
              ? "入居の移動を取り消す"
              : "退居の移動を取り消す"}
          </button>
          <small id={cancelHintId}>
            {lodgingWalkCancelText(game, resident)}
          </small>
        </div>
      )}
      {stay.phase === "occupied" && (
        <p className="lf-note">
          {name}
          は入居中、この部屋に入れます。寝床の優先・専用設定は個別の設定に従います。家計は世帯で共用します。
        </p>
      )}
      {ending && (
        <>
          <ReturnForm
            key={stay.residentId + "/" + stay.returnTo}
            game={game}
            onGame={onGame}
            stay={stay}
          />
          <LodgingCommand
            label="退居する"
            result={ending}
            onGame={onGame}
            note={
              (ending.minutes
                ? "共用の玄関まで" +
                  ending.minutes +
                  "分歩き、居室を引き渡します。"
                : "今いる場所で居室を引き渡します。") +
              "退居後も同じ世帯で暮らします。"
            }
          />
        </>
      )}
    </div>
  );
}

export function LodgingPanel(props: Props) {
  const [expanded, setExpanded] = useState(false);
  const stay = props.game.housing?.lodging;
  const hintId = useId();
  return (
    <details
      className="lf-lodging"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary
        aria-label="一室の間借り"
        aria-describedby={stay ? hintId : undefined}
      >
        一室の間借り{stay && <small id={hintId}> · {phases[stay.phase]}</small>}
      </summary>
      {expanded &&
        (stay ? (
          <ActiveLodging {...props} stay={stay} />
        ) : (
          <OfferForm key={props.actor.person.id} {...props} />
        ))}
    </details>
  );
}
