import { useId } from "react";
import { Footprints } from "lucide-react";
import { cellName, roomName } from "./house";
import { residentLabel, roomLabel } from "./displayNames";
import { GatheringPanel } from "./GatheringPanel";
import { housingPointLabel } from "./housing/presentation";
import { foodBundleStatus } from "./housing/foodPresentation";
import { constructionStatus } from "./housing/constructionPresentation";
import {
  housingPoint,
  housingDoorId,
  housingLinkId,
  housingRoomId,
} from "./housing/topology";
import type { HousingStatus } from "./housing/types";
import {
  inspectOrder,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Actor,
  type Game,
} from "./sim";

export const housingStageNames: Record<HousingStatus["phase"], string> = {
  idle: "手が空いている",
  unlocated: "位置は未確定",
  move: "移動中",
  use: "設備を利用中",
  waiting: "待機中",
  cancelling: "取り消し中",
  legacy: "従来の時間で進行",
  outside: "屋外・地域で行動",
};

export function HousingUpgrade({
  game,
  onUpgrade,
}: {
  game: Game;
  onUpgrade: () => void;
}) {
  if (game.housing) return null;
  return (
    <div className="rf-housing-upgrade">
      <button onClick={onUpgrade}>住居の移動を使う暮らしに分岐</button>
      <p className="rf-hint">
        元の暮らしは手帳に残ります。始めていた行動は、そのままの残り時間で続きます。次に家の中で新しい指示を受けたとき、今いる部屋の入口から始めます。
      </p>
    </div>
  );
}

export function HousingPanel({
  game,
  actor,
  status,
  onGame,
  invitationWithdrawal,
}: {
  game: Game;
  actor: Actor;
  status: HousingStatus;
  onGame: (g: Game) => void;
  invitationWithdrawal?: string;
}) {
  const prefix = useId();
  const h = game.housing!;
  const id = actor.person.id;
  const gathering = !!actor.task?.spatial?.gatheringId;
  const planId = actor.task?.spatial?.constructionId;
  const construction = planId ? constructionStatus(game, planId) : null;
  const food = actor.task?.spatial?.foodBundleId
    ? foodBundleStatus(game)
    : null;
  const people = game.actors.map((a) => a.person.id);
  function moveButton(
    label: string,
    roomId: string,
    cell: number,
    key: string,
  ) {
    const target = JSON.stringify({ roomId, cell });
    const preview = inspectOrder(game, id, "home-move", target);
    const hint = prefix + key;
    return (
      <div className="lf-command" key={key}>
        <button
          type="button"
          disabled={!!preview.disabled}
          aria-describedby={hint}
          onClick={() => onGame(order(game, id, "home-move", target))}
        >
          {label}
        </button>
        <small id={hint}>
          {status.phase === "cancelling"
            ? "取り消し中です。今の区間を出てから新しい指示を選べます。"
            : (preview.disabled ??
              housingPointLabel(game, housingPoint(roomId, cell)) +
                "　" +
                preview.minutes +
                "分")}
        </small>
      </div>
    );
  }
  const nearby = game.actors.flatMap((a) => {
    const pos = h.state.actors[a.person.id]?.position;
    if (a === actor || pos?.kind !== "at") return [];
    return [
      moveButton(
        a.person.name + "の近くへ移動",
        housingRoomId(pos.point.domainId)!,
        pos.point.cell,
        "person-" + a.person.id,
      ),
    ];
  });
  function passage(kind: "door" | "link", passageId: string, label: string) {
    const closed = (
      kind === "door" ? h.controls.closedDoors : h.controls.closedLinks
    ).includes(passageId);
    return (
      <div key={passageId} className="lf-passage">
        <span>
          {label} <small>{closed ? "閉まっている" : "開いている"}</small>
        </span>
        <button
          className="lf-soft-button"
          type="button"
          aria-label={label + "を" + (closed ? "開ける" : "閉める")}
          onClick={() =>
            onGame(setHousingPassage(game, kind, passageId, closed))
          }
        >
          {closed ? "開ける" : "閉める"}
        </button>
      </div>
    );
  }
  const unknown =
    h.unlocated[id]?.reason === "legacy-unspecified" &&
    actor.location === game.home;
  return (
    <section className="lf-panel lf-housing" aria-label="家の中の移動と設定">
      <div className="lf-section-title">
        <Footprints size={20} />
        <h3>{actor.person.name}への移動指示</h3>
      </div>
      <dl className="lf-housing-status">
        <div>
          <dt>現在地</dt>
          <dd>{status.location}</dd>
        </div>
        {!gathering && (
          <div>
            <dt>段階</dt>
            <dd>
              {food?.phase ??
                construction?.phase ??
                housingStageNames[status.phase]}
            </dd>
          </div>
        )}
        {status.destination && (
          <div>
            <dt>行き先</dt>
            <dd>{status.destination}</dd>
          </div>
        )}
        {!gathering && status.useRemaining !== null && (
          <div>
            <dt>
              {food
                ? "料理の残り"
                : construction
                  ? "施工の残り"
                  : "設備の利用残り"}
            </dt>
            <dd>{status.useRemaining}分</dd>
          </div>
        )}
        {actor.task && (!gathering || status.phase === "cancelling") && (
          <div>
            <dt>
              {status.phase === "cancelling"
                ? "区間を出るまで"
                : "完了までの目安"}
            </dt>
            <dd>
              {status.minutes === null
                ? "見積もれません"
                : status.minutes + "分"}
            </dd>
          </div>
        )}
      </dl>
      {!gathering && <p className="lf-note">{status.detail}</p>}
      {unknown && actor.task && (
        <p className="lf-note">
          次に自宅で新しい指示が決まると、この部屋の入口から始めます。
        </p>
      )}
      {!gathering && status.phase === "waiting" && status.minutes === null && (
        <p className="lf-note">
          設定や間取りを見直して時計を進めると、同じ予定を続けられるか確かめます。
        </p>
      )}
      <GatheringPanel
        key={id}
        game={game}
        actorId={id}
        onGame={onGame}
        invitationWithdrawal={invitationWithdrawal}
      />
      <details open>
        <summary>部屋へ移動</summary>
        <div className="lf-command-list">
          {game.house.rooms.map((r) =>
            moveButton(r.name + "の入口へ移動", r.id, 0, "room-" + r.id),
          )}
        </div>
      </details>
      <details>
        <summary>住民の近くへ移動</summary>
        {nearby.length ? (
          <>
            <p className="lf-note">相手が今いる地点へ向かいます。</p>
            <div className="lf-command-list">{nearby}</div>
          </>
        ) : (
          <p className="lf-note">近くへ移動できる住民はいません。</p>
        )}
      </details>
      <details>
        <summary>通路と扉</summary>
        {game.house.links.map(([a, b]) =>
          passage(
            "link",
            housingLinkId(a, b),
            roomName(game.house, a) + "と" + roomName(game.house, b) + "の通路",
          ),
        )}
        {game.house.rooms.flatMap((r) =>
          r.doors.map((cell) =>
            passage(
              "door",
              housingDoorId(r.id, cell),
              r.name + "の扉（" + cellName(r, cell) + "）",
            ),
          ),
        )}
      </details>
      <details>
        <summary>部屋を利用できる住民</summary>
        <p className="lf-note">
          許可を外しても、中にいる住民はその部屋から出られます。
        </p>
        {game.house.rooms.map((r) => {
          const allowed = h.controls.roomAccess[r.id] ?? people;
          return (
            <fieldset key={r.id}>
              <legend>{roomLabel(game.house.rooms, r)}</legend>
              {game.actors.map((a) => (
                <label key={a.person.id}>
                  <input
                    type="checkbox"
                    checked={allowed.includes(a.person.id)}
                    onChange={(e) => {
                      const ids = people.filter((person) =>
                        person === a.person.id
                          ? e.target.checked
                          : allowed.includes(person),
                      );
                      onGame(
                        setHousingRoomAccess(
                          game,
                          r.id,
                          ids.length === people.length ? null : ids,
                        ),
                      );
                    }}
                  />
                  {residentLabel(game, a)}
                </label>
              ))}
            </fieldset>
          );
        })}
      </details>
    </section>
  );
}
