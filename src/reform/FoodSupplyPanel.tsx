import { useState } from "react";
import { ConstructionAction } from "./ConstructionPanel";
import { cellName } from "./house";
import { residentLabel, roomLabel } from "./displayNames";
import { constructionFloor } from "./housing/constructionTopology";
import {
  clearFoodSupply,
  inspectFoodSupply,
  setFoodSupply,
  setFoodSupplyEnabled,
} from "./housing/foodSupply";
import type { FoodResult } from "./housing/foodTypes";
import { housingPointLabel } from "./housing/presentation";
import { housingPoint, housingRoomId } from "./housing/topology";
import type { Game } from "./sim";

export function FoodSupplyPanel({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => Promise<boolean> | void;
}) {
  // Null follows the persisted policy; a draft is independent of its status.
  const [draftActor, setDraftActor] = useState<string | null>(null);
  const [draftRoom, setDraftRoom] = useState<string | null>(null);
  const [draftCell, setDraftCell] = useState<string | null>(null);
  const [error, setError] = useState("");
  const h = game.housing;
  if (!h) return null;
  const policy = h.foodSupply;
  const status = inspectFoodSupply(game);
  const actorId = draftActor ?? policy?.actorId ?? "";
  const roomId =
    draftRoom ?? (policy ? housingRoomId(policy.storage.domainId) : "");
  const cell = draftCell ?? (policy ? String(policy.storage.cell) : "");
  const room = game.house.rooms.find((r) => r.id === roomId);
  const worker = game.actors.find((a) => a.person.id === actorId);
  const floors = room
    ? Array.from({ length: room.width * room.height }, (_, i) => i).filter(
        (i) =>
          constructionFloor(h, housingPoint(room.id, i)) &&
          (room.id !== "living" || i !== 0),
      )
    : [];
  const floor = floors.find((i) => String(i) === cell);
  const disabled = !worker
    ? "補充を任せる住人を選んでください。"
    : floor === undefined
      ? "供給口と異なる、歩ける補充先の床を選んでください。"
      : undefined;
  const assigned = game.actors.find((a) => a.person.id === policy?.actorId);

  async function run(result: FoodResult, resetDraft = false) {
    setError(result.error ?? "");
    if (result.error) return;
    if ((await onGame(result.game)) === false) {
      setError(
        "手帳に保存できませんでした。内容を確認してもう一度操作してください。",
      );
      return;
    }
    if (resetDraft) {
      setDraftActor(null);
      setDraftRoom(null);
      setDraftCell(null);
    }
  }

  return (
    <section className="lf-construction-card" aria-label="一束の補充を任せる">
      <h3>一束の補充を任せる</h3>
      <p>
        時計を進めると、生活や通路などの条件が整ったときに担当者が食材2を一束にして指定の床へ運びます。一束が使われるまで次の補充は待ちます。料理はこれまで通り指示できます。
      </p>
      {policy && (
        <dl className="lf-housing-status">
          <div>
            <dt>設定中の担当</dt>
            <dd>{assigned ? residentLabel(game, assigned) : "担当不明"}</dd>
          </div>
          <div>
            <dt>補充先</dt>
            <dd>{housingPointLabel(game, policy.storage)}</dd>
          </div>
          <div>
            <dt>補充方針</dt>
            <dd>{policy.enabled ? "継続中" : "一時停止"}</dd>
          </div>
        </dl>
      )}
      <p>{status.detail}</p>
      {status.minutes !== null && <p>完了までの目安 {status.minutes}分</p>}
      {error && (
        <p role="alert" className="lf-construction-error">
          {error}
        </p>
      )}
      <div className="lf-construction-form">
        <label>
          補充担当
          <select
            value={worker?.person.id ?? ""}
            onChange={(e) => setDraftActor(e.target.value)}
          >
            <option value="">担当者を選ぶ</option>
            {game.actors.map((a) => (
              <option key={a.person.id} value={a.person.id}>
                {residentLabel(game, a)}
                {a.location !== game.home
                  ? "・外出中"
                  : a.task
                    ? "・行動中"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          補充先の部屋
          <select
            value={room?.id ?? ""}
            onChange={(e) => {
              setDraftRoom(e.target.value);
              setDraftCell("");
            }}
          >
            <option value="">部屋を選ぶ</option>
            {game.house.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {roomLabel(game.house.rooms, r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          補充先の床
          <select
            value={floor === undefined ? "" : String(floor)}
            onChange={(e) => setDraftCell(e.target.value)}
          >
            <option value="">床を選ぶ</option>
            {room &&
              floors.map((i) => (
                <option key={i} value={i}>
                  {i === 0 ? "入口" : cellName(room, i)}
                </option>
              ))}
          </select>
        </label>
        <ConstructionAction
          label="この担当で補充する"
          disabled={disabled}
          hint="設定しても時計は進まず、すぐには食材を動かしません。一時停止中の設定を確定すると再開します。"
          onClick={() => {
            if (worker && room && floor !== undefined)
              void run(
                setFoodSupply(game, {
                  actorId,
                  roomId: room.id,
                  storageCell: floor,
                }),
                true,
              );
          }}
        />
      </div>
      {policy && (
        <div className="lf-construction-actions">
          <ConstructionAction
            label={policy.enabled ? "補充を一時停止" : "補充を再開"}
            onClick={() =>
              void run(setFoodSupplyEnabled(game, !policy.enabled))
            }
          />
          <ConstructionAction
            label="補充担当を解除"
            onClick={() => void run(clearFoodSupply(game), true)}
          />
        </div>
      )}
      <p>
        一時停止や担当の解除をしても進行中の運搬は終えます。運搬自体を止めたいときは、一束の欄で運搬を取り消してください。
      </p>
    </section>
  );
}
