import { useState } from "react";
import { bedChoiceLabel, facilityLabel } from "./facilityLabel";
import { residentLabel } from "./displayNames";
import {
  getPreferredBed,
  setPreferredBed,
  getBedSleeper,
  setBedSleeper,
} from "./housing/bedPreference";
import type { Actor, Game } from "./sim";

function homeBeds(game: Game) {
  return game.house.rooms.flatMap((room) =>
    room.fixtures
      .filter((f) => f.kind === "bed" || f.kind === "mat")
      .map((fixture) => ({ room, fixture })),
  );
}

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

  const { id } = actor.person;
  const beds = homeBeds(game).map(({ room, fixture }) => (
    <option key={fixture.id} value={fixture.id}>
      {bedChoiceLabel(game, room, fixture)}
    </option>
  ));

  return (
    <div className="lf-policy lf-bed-policy">
      <label htmlFor="lf-bed-preference">
        {residentLabel(game, actor)}が優先する寝床
      </label>
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

function BedAccessForm({
  game,
  fixtureId,
  savedId,
  onGame,
}: {
  game: Game;
  fixtureId: string;
  savedId: string;
  onGame: (game: Game) => void;
}) {
  const [draftId, setDraftId] = useState(savedId);
  const sleeper = game.actors.find((actor) => actor.person.id === savedId);
  return (
    <form
      className="lf-bed-policy lf-policy"
      onSubmit={(event) => {
        event.preventDefault();
        if (draftId !== savedId)
          onGame(setBedSleeper(game, fixtureId, draftId || null));
      }}
    >
      <p className="lf-note" role="status">
        {"現在の設定　"}
        {sleeper ? residentLabel(game, sleeper) + "専用" : "全員で共用"}
      </p>
      <label htmlFor="lf-bed-sleeper">利用できる住人</label>
      <select
        id="lf-bed-sleeper"
        value={draftId}
        onChange={(event) => setDraftId(event.target.value)}
      >
        <option value="">全員で共用</option>
        {game.actors.map((actor) => (
          <option key={actor.person.id} value={actor.person.id}>
            {residentLabel(game, actor)}
          </option>
        ))}
      </select>
      <button
        className="lf-soft-button"
        type="submit"
        disabled={draftId === savedId}
      >
        利用設定を保存
      </button>
      <p className="lf-note">
        新たにこの寝床を使うときに適用します。予約中の住人は、そのまま休息を終えられます。
      </p>
    </form>
  );
}

export function BedAccessPolicy({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => void;
}) {
  const [chosenId, setChosenId] = useState("");
  const beds = homeBeds(game);
  const selected =
    beds.find(({ fixture }) => fixture.id === chosenId) ?? beds[0];
  if (!selected)
    return <p className="lf-note">寝床を置くと、利用できる住人を選べます。</p>;
  const id = selected.fixture.id;
  const savedId = getBedSleeper(game, id) ?? "";
  return (
    <>
      <label className="lf-policy">
        設定する寝床
        <select
          value={id}
          onChange={(event) => setChosenId(event.target.value)}
        >
          {beds.map(({ room, fixture }) => (
            <option key={fixture.id} value={fixture.id}>
              {facilityLabel(
                game.house.rooms,
                room,
                fixture.kind,
                fixture.cell,
              )}
            </option>
          ))}
        </select>
      </label>
      <BedAccessForm
        key={JSON.stringify([id, savedId])}
        game={game}
        fixtureId={id}
        savedId={savedId}
        onGame={onGame}
      />
    </>
  );
}
