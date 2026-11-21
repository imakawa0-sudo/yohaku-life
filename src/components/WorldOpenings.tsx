import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { OPENINGS, type WorldOrigin } from "../game/origins";
import { formatTime } from "../game/engine";
import type { GameState } from "../game/types";

const PREFIX = "yohaku-opening-backup-";

function backupKeys(storage: Storage) {
  return Object.keys(storage).filter(key => key.startsWith(PREFIX)).sort().reverse();
}

/** Keep a departure checkpoint before replacing the autosave. Writes may throw on quota limits. */
export function preserveBeforeSwitch(storage: Storage, current: string): void {
  if (backupKeys(storage).some(key => storage.getItem(key) === current)) return;
  let serial = Date.now();
  while (storage.getItem(PREFIX + serial) !== null) serial++;
  storage.setItem(PREFIX + serial, current);
}

export function OpeningPicker({ current, onStart, onCancel }: {
  current: WorldOrigin;
  onStart: (origin: WorldOrigin) => void;
  onCancel: () => void;
}) {
  const [choice, choose] = useState(current);
  return <>
    <h2 id="modal-title">暮らしの始め方</h2>
    <fieldset className="opening-options">
      <legend>初日の過ごし方を選ぶ</legend>
      {(Object.keys(OPENINGS) as WorldOrigin[]).map(origin =>
        <label key={origin}>
          <input type="radio" name="world-origin" aria-label={OPENINGS[origin].name}
            value={origin} checked={choice === origin} onChange={() => choose(origin)} />
          <span><strong>{OPENINGS[origin].name}</strong><small>{OPENINGS[origin].description}</small></span>
        </label>
      )}
    </fieldset>
    <p className="save-note">始める前の暮らしは「保存」からいつでも再開できます。</p>
    <button className="primary-button full-width" onClick={() => onStart(choice)}>
      {choice === current ? "同じ開始条件で、はじめる" : "この条件ではじめる"} <ArrowRight size={16} />
    </button>
    <button className="secondary-button full-width" onClick={onCancel}>いまの暮らしを続ける</button>
  </>;
}

export function PreviousOpenings({ onLoad }: { onLoad: (raw: string) => void }) {
  const [entries] = useState(() => {
    try {
      const results: { key: string; label: string }[] = [];
      for (const key of backupKeys(localStorage)) {
        const state: GameState = JSON.parse(localStorage.getItem(key)!);
        const name = OPENINGS[state.origin ?? "household"]?.name ?? "以前の暮らし";
        results.push({ key, label: `${name} · ${Math.floor(state.minutes / 1440) + 1}日目 ${formatTime(state.minutes)} · ${state.residents.length}人` });
      }
      return results;
    } catch {
      return [];
    }
  });
  if (!entries.length) return null;
  return <details className="opening-backups">
    <summary>開始前の暮らしに戻る</summary>
    <ul>{entries.map(entry => <li key={entry.key}>
      <button className="secondary-button" onClick={() => {
        const raw = localStorage.getItem(entry.key);
        if (raw) onLoad(raw);
      }}>{entry.label} を再開</button>
    </li>)}</ul>
  </details>;
}
