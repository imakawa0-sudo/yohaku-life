import { facilityLabel } from "./facilityLabel";
import { bedProtectionLabel } from "./housing/coldProtection";
import { getPreferredBed, setPreferredBed } from "./housing/bedPreference";
import type { Actor, Game } from "./sim";

export function BedPreferencePolicy({
  game,
  actor,
  onGame,
}: {
  game: Game;
  actor: Actor;
  onGame: (game: Game) => void;
}) {
  if (!game.housing) return null;

  const { rooms } = game.house;
  const { id, name } = actor.person;
  const beds = rooms.flatMap((room) =>
    room.fixtures
      .filter((fixture) => fixture.kind === "mat" || fixture.kind === "bed")
      .map((fixture) => (
        <option key={fixture.id} value={fixture.id}>
          {facilityLabel(rooms, room, fixture.kind, fixture.cell)} ·{" "}
          {bedProtectionLabel(game, room.id)}
        </option>
      )),
  );

  return (
    <div className="lf-policy lf-bed-policy">
      <label htmlFor="lf-bed-preference">{name}が優先する寝床</label>
      <select
        id="lf-bed-preference"
        aria-describedby="lf-bed-preference-help"
        value={getPreferredBed(game, id) ?? ""}
        onChange={(event) =>
          onGame(setPreferredBed(game, id, event.target.value || null))
        }
      >
        <option value="">未設定（使える寝床から選ぶ）</option>
        {beds}
      </select>
      <p id="lf-bed-preference-help" className="lf-note">
        次の休息から優先します。使えない時は別の寝床を探します。今の予定は変わりません。
      </p>
    </div>
  );
}
