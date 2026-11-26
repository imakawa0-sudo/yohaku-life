import { useState } from "react";
import { Wheat } from "lucide-react";
import { ConstructionAction } from "./ConstructionPanel";
import { cellName } from "./house";
import { constructionFloor } from "./housing/constructionTopology";
import {
  assignFoodHaul,
  createFoodBundle,
  inspectFoodHaul,
  inspectFoodReturn,
  returnFoodBundle,
  presentFood,
} from "./housing/food";
import { foodBundleStatus } from "./housing/foodPresentation";
import type { FoodResult } from "./housing/foodTypes";
import { housingPoint } from "./housing/topology";
import { housingStatus } from "./housing/presentation";
import { inspectOrder, order, type Game } from "./sim";
import { sameSpatialPoint } from "./spatial/route";

export function FoodLogisticsPanel({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => Promise<boolean> | void;
}) {
  const [roomId, setRoomId] = useState("");
  const [cell, setCell] = useState("");
  const [actorId, setActorId] = useState("");
  const [error, setError] = useState("");
  const h = game.housing;
  const status = foodBundleStatus(game);
  const bundle = presentFood(h);
  const room = game.house.rooms.find((r) => r.id === roomId);
  const floors =
    h && room
      ? Array.from({ length: room.width * room.height }, (_, i) => i).filter(
          (i) =>
            constructionFloor(h, housingPoint(room.id, i)) &&
            (room.id !== "living" || i !== 0),
        )
      : [];
  const floor = floors.find((i) => String(i) === cell);
  const createDisabled =
    game.ingredients < 2
      ? "共同備蓄に食材2が必要です。"
      : floor === undefined
        ? "供給口と異なる、歩ける保管床を選んでください。"
        : undefined;
  const worker = game.actors.find((a) => a.person.id === actorId);
  const assigned = game.actors.find(
    (a) => a.person.id === status?.assignedActorId,
  );
  const assignedStatus = assigned && housingStatus(game, assigned.person.id);
  const pos = bundle && h!.state.items[bundle.itemId].position;
  const atSource =
    bundle && pos?.kind === "at" && sameSpatialPoint(pos.point, bundle.source);
  const atStorage =
    bundle && pos?.kind === "at" && sameSpatialPoint(pos.point, bundle.storage);
  const run = async (result: FoodResult) => {
    setError(result.error ?? "");
    if (result.error) return false;
    if ((await onGame(result.game)) === false) {
      setError(
        "手帳に保存できませんでした。内容を確認してもう一度操作してください。",
      );
      return false;
    }
    return true;
  };
  function haul(direction: "store" | "return") {
    if (!bundle) return null;
    const preview = inspectFoodHaul(game, bundle.id, actorId, direction);
    const alreadyThere =
      pos?.kind === "at" &&
      sameSpatialPoint(
        pos.point,
        direction === "store" ? bundle.storage : bundle.source,
      );
    const disabled = alreadyThere
      ? "一束はすでに届け先にあります。"
      : !worker
        ? "担当者を選んでください。"
        : preview.disabled;
    return (
      <ConstructionAction
        label={direction === "store" ? "保管先へ運ぶ" : "供給口へ戻す"}
        disabled={disabled}
        hint={
          preview.minutes === null
            ? "完了までの時間を見積もれません。"
            : "完了までの目安 " + preview.minutes + "分"
        }
        onClick={() =>
          void run(assignFoodHaul(game, bundle.id, actorId, direction))
        }
      />
    );
  }

  return (
    <section
      className="lf-panel lf-construction lf-food-logistics"
      aria-label="食材の保管と運搬"
    >
      <div className="lf-section-title">
        <Wheat size={19} aria-hidden="true" />
        <h2>食材の保管と運搬</h2>
      </div>
      <p>
        共同備蓄の食材 <strong>{game.ingredients}</strong>（自由に使える数量）
      </p>
      <p>野菜の一束は食材2。取り分けた食材は共同備蓄の数量に含まれません。</p>
      {!h ? (
        <p>
          手帳で「住居の移動を使う暮らしに分岐」を選ぶと、食材を取り分けられます。
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="lf-construction-error">
              {error}
            </p>
          )}
          {bundle && status ? (
            <>
              <h3>野菜の一束（食材2）</h3>
              <dl className="lf-housing-status">
                <div>
                  <dt>現在地</dt>
                  <dd>
                    {atSource ? "供給口 · " : ""}
                    {status.location}
                  </dd>
                </div>
                <div>
                  <dt>保管先</dt>
                  <dd>{status.storage}</dd>
                </div>
                <div>
                  <dt>段階</dt>
                  <dd>{status.phase}</dd>
                </div>
                <div>
                  <dt>担当</dt>
                  <dd>{assigned?.person.name ?? "担当なし"}</dd>
                </div>
                {assigned && (
                  <div>
                    <dt>
                      {assignedStatus?.phase === "cancelling"
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
              {assigned && assignedStatus ? (
                <>
                  <p>{assignedStatus.detail}</p>
                  <ConstructionAction
                    label="担当を外す"
                    disabled={
                      assignedStatus.phase === "cancelling"
                        ? "今の区間を出ると担当を解除します。"
                        : inspectOrder(game, assigned.person.id, "cancel")
                            .disabled
                    }
                    hint="一束は床に残ります。通路途中なら区間の終点へ進みます。共同備蓄には戻りません。"
                    onClick={() =>
                      void run({
                        game: order(game, assigned.person.id, "cancel"),
                      })
                    }
                  />
                </>
              ) : (
                <div className="lf-construction-actions">
                  <label>
                    運搬担当
                    <select
                      value={actorId}
                      onChange={(e) => setActorId(e.target.value)}
                    >
                      <option value="">担当者を選ぶ</option>
                      {game.actors.map((a) => {
                        const store = inspectFoodHaul(
                          game,
                          bundle.id,
                          a.person.id,
                          "store",
                        );
                        const back = inspectFoodHaul(
                          game,
                          bundle.id,
                          a.person.id,
                          "return",
                        );
                        const allowed = store.ok || back.ok;
                        return (
                          <option
                            key={a.person.id}
                            value={a.person.id}
                          >
                            {a.person.name}
                            {allowed
                              ? ""
                              : "・" +
                                (a.task
                                  ? "進行中の予定があります"
                                  : (atStorage ? back : store).disabled)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {haul("store")}
                  {haul("return")}
                  <ConstructionAction
                    label="備蓄に戻す"
                    disabled={inspectFoodReturn(game, bundle.id).disabled}
                    hint="供給口の一束を共同備蓄の食材2へ戻します。"
                    onClick={() => void run(returnFoodBundle(game, bundle.id))}
                  />
                </div>
              )}
              <p className="lf-note">
                先に今ある一束を使うか、共同備蓄へ戻してください。
              </p>
            </>
          ) : (
            <>
              <p>
                現物の一束はありません。
                {status && "前回の一束：" + status.phase}
              </p>
              <div className="lf-construction-form">
                <label>
                  保管する部屋
                  <select
                    value={room?.id ?? ""}
                    onChange={(e) => {
                      setRoomId(e.target.value);
                      setCell("");
                    }}
                  >
                    <option value="">部屋を選ぶ</option>
                    {game.house.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  保管する床
                  <select
                    value={floor === undefined ? "" : String(floor)}
                    onChange={(e) => setCell(e.target.value)}
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
                  label="野菜の一束を取り分ける"
                  disabled={createDisabled}
                  hint="居間の入口の供給口に置きます。時計は進みません。"
                  onClick={() => {
                    if (room && floor !== undefined)
                      void run(
                        createFoodBundle(game, {
                          roomId: room.id,
                          storageCell: floor,
                        }),
                      );
                  }}
                />
              </div>
              <p className="lf-note">
                保管床の指定に費用はかかりません。収納家具ではなく、冷蔵などの効果もありません。
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
