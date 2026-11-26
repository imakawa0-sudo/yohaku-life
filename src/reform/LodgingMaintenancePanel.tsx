import { residentLabel, roomLabel } from "./displayNames";
import { ConstructionAction } from "./ConstructionPanel";
import { housingInTransit } from "./housing/bridge";
import {
  constructionExitText,
  unresolvedConstruction,
} from "./housing/constructionTopology";
import { isRoomInsulated } from "./housing/insulation";
import {
  acceptLodgingMaintenance,
  requestLodgingMaintenance,
  withdrawLodgingMaintenance,
} from "./housing/lodgingMaintenance";
import type { RoomConstruction } from "./housing/constructionTypes";
import type { RoomLodging } from "./housing/types";
import type { Actor, Game } from "./sim";

export function maintenanceWithdrawalHint(game: Game, plan: RoomConstruction) {
  const assignment = plan.assignment;
  if (!assignment?.lodgingMaintenance) return "工事計画は残ります。";
  const h = game.housing!;
  if (housingInTransit(game, assignment.actorId))
    return constructionExitText(h, plan) + "工事計画は残ります。";
  if (assignment.kind === "build")
    return plan.workedMinutes
      ? `施工を中断します。木材は仮置き場に残り、施工済みの${plan.workedMinutes}分から再開できます。`
      : "施工担当を外します。木材は仮置き場に残ります。";
  const board = plan.material && h.state.items[plan.material.itemId];
  return board?.position.kind === "carried"
    ? "運搬担当を外し、木材を今いる床に下ろします。工事計画は残ります。"
    : "運搬担当を外します。木材は今ある床に残り、工事計画も残ります。";
}

export function LodgingMaintenancePanel({
  game,
  actor,
  stay,
  onGame,
  onSelect,
  onOpenInsulation,
}: {
  game: Game;
  actor: Actor;
  stay: RoomLodging;
  onGame: (g: Game) => void;
  onSelect: (id: string) => void;
  onOpenInsulation?: (roomId: string) => void;
}) {
  const resident = game.actors.find((a) => a.person.id === stay.residentId)!;
  const provider = game.actors.find((a) => a.person.id === stay.providerId)!;
  const isResident = actor.person.id === stay.residentId;
  const isProvider = actor.person.id === stay.providerId;
  const receipt = stay.maintenance;
  const room = game.house.rooms.find((r) => r.id === stay.roomId)!;
  const plan = Object.values(game.housing?.construction?.plans ?? {}).find(
    unresolvedConstruction,
  );
  const roomPlan =
    plan?.kind === "insulation" &&
    plan.status === "planned" &&
    plan.neighborId === stay.roomId
      ? plan
      : undefined;
  const insulated = game.insulated || isRoomInsulated(game, stay.roomId);
  if (!roomPlan && !onOpenInsulation) return null;
  const request =
    roomPlan && isResident && !receipt
      ? requestLodgingMaintenance(game, stay.residentId, roomPlan.id)
      : undefined;
  const accept =
    receipt?.phase === "requested" && isProvider
      ? acceptLodgingMaintenance(game, stay.providerId)
      : undefined;
  const nextActor = receipt?.phase === "requested" ? provider : resident;
  return (
    <section className="lf-lodging-maintenance" aria-label="居室の工事依頼">
      <h4>居室の工事依頼</h4>
      {!roomPlan ? (
        <p>
          {insulated
            ? "居室の寒さ対策は済んでいます。"
            : plan
              ? "先の工事と木材の回収が済むと、居室の寒さ対策を計画できます。"
              : "居室の寒さ対策を計画すると、入居者から提供者に搬入と施工を頼めます。"}
        </p>
      ) : (
        <>
          <p>
            {roomLabel(game.house.rooms, room)}の寒さ対策 · 木材
            {roomPlan.requiredWood} · 施工の残り
            {roomPlan.workMinutes - roomPlan.workedMinutes}分
          </p>
          <p>
            {receipt
              ? residentLabel(game, resident) +
                "から" +
                residentLabel(game, provider) +
                "への依頼 · " +
                (receipt.phase === "requested" ? "返答待ち" : "引受済み")
              : "入居者が自分で担当するか、提供者にこの計画の搬入と施工を頼めます。"}
          </p>
          <p className="lf-note">操作中　{residentLabel(game, actor)}</p>
          {request && (
            <ConstructionAction
              label="提供者に工事を依頼する"
              disabled={request.error}
              hint="提供者の返答を待ちます。"
              onClick={() => onGame(request.game)}
            />
          )}
          {accept && (
            <ConstructionAction
              label="依頼を引き受ける"
              disabled={accept.error}
              hint="引き受けた後、工事の搬入担当・施工担当を工程ごとに選びます。"
              onClick={() => onGame(accept.game)}
            />
          )}
          {receipt?.phase === "accepted" && (
            <p className="lf-note">
              引受者はこの工事の搬入と施工に入室できます。木材の取り置きと各工程の開始は、工事の欄で指示します。
            </p>
          )}
          {receipt && (isResident || isProvider) && (
            <ConstructionAction
              label={
                isResident
                  ? "依頼を取り下げる"
                  : receipt.phase === "requested"
                    ? "依頼を見送る"
                    : "引き受けを取りやめる"
              }
              hint={maintenanceWithdrawalHint(game, roomPlan)}
              onClick={() => {
                const result = withdrawLodgingMaintenance(
                  game,
                  actor.person.id,
                );
                if (!result.error) onGame(result.game);
              }}
            />
          )}
          {actor.person.id !== nextActor.person.id &&
            !(onOpenInsulation && nextActor === resident) && (
              <button
                className="lf-soft-button"
                type="button"
                onClick={() => onSelect(nextActor.person.id)}
              >
                {residentLabel(game, nextActor)}に切り替える
              </button>
            )}
          {receipt?.phase === "accepted" && !isProvider && (
            <button
              className="lf-soft-button"
              type="button"
              onClick={() => onSelect(stay.providerId)}
            >
              {residentLabel(game, provider)}に切り替える
            </button>
          )}
        </>
      )}
      {onOpenInsulation && !insulated && (
        <button
          className="lf-soft-button"
          type="button"
          onClick={() => onOpenInsulation(stay.roomId)}
        >
          住まいの寒さ対策を開く
        </button>
      )}
    </section>
  );
}
