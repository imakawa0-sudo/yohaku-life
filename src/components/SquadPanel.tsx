import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { command } from "../game/engine";
import { getSelectionPresets, MAX_SELECTION_PRESET_NAME } from "../game/selection-presets";
import type { Command, GameState, SelectionPreset } from "../game/types";

const names = (game: GameState, ids: string[]) => ids
  .map(id => game.residents.find(person => person.id === id)?.name ?? "記録の住民")
  .join("・");
const sameOrder = (left: string[], right: string[]) => left.length === right.length
  && left.every((id, index) => id === right[index]);

/** Saved teams only recall the existing roster selection; no command runs on recall. */
export function SquadPanel({ game, selectedIds, onSelect, onFocus, onCommand, children }: {
  game: GameState;
  selectedIds: string[];
  onSelect: (residentIds: string[]) => void;
  onFocus: (residentId: string) => void;
  onCommand: (cmd: Command) => boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const presets = getSelectionPresets(game);
  const draftIds = editingId === undefined ? selectedIds : memberIds;
  const cmd: Command = {
    type: "save-selection-preset",
    ...(editingId === undefined ? {} : { presetId: editingId }),
    name,
    residentIds: [...draftIds],
  };
  const preview = open ? command(game, cmd) : undefined;
  const error = preview?.error;
  function fresh() {
    setEditingId(undefined);
    setName("");
    setMemberIds([]);
    setFeedback("");
  }
  function edit(preset: SelectionPreset) {
    setEditingId(preset.id);
    setName(preset.name);
    setMemberIds([...preset.residentIds]);
    setFeedback("");
  }
  return <section className="roster-squads">
    <div className="roster-heading">
      <div className="section-label">
        <span>この家の住民</span>
        <span>{selectedIds.length}人 選択中</span>
      </div>
      <p className="resident-selection-hint">選択・解除。最後に触れた人の場面。</p>
      <button className="squad-toggle" type="button" aria-expanded={open}
        aria-controls="squad-tools" aria-label={open ? "隊の保存と呼出を閉じる" : "隊の保存と呼出を開く"}
        onClick={() => setOpen(previous => !previous)}>
        <span>隊</span><ChevronDown size={12} />
      </button>
    </div>
    {children}
    {open && <div className="squad-tools" id="squad-tools">
      <p className="squad-guide">隊を呼ぶと、一覧の指示対象だけが切り替わります。場所・仕事・時計は変わりません。</p>
      {presets.length > 0 ? <ul className="squad-list">
        {presets.map(preset => <li key={preset.id}>
          <button type="button" className="squad-select" aria-label={`${preset.name}を選択`}
            aria-pressed={sameOrder(selectedIds, preset.residentIds)}
            onClick={() => {
              onSelect([...preset.residentIds]);
              setFeedback(`${preset.name}の${names(game, preset.residentIds)}を選びました。表示中の場面はそのままです。`);
            }}>
            <strong>{preset.name}</strong><span>{names(game, preset.residentIds)}</span>
          </button>
          <button type="button" className="squad-edit" aria-label={`${preset.name}を編集`}
            onClick={() => edit(preset)}>編集</button>
          <div className="squad-scenes"><span>場面：</span>{preset.residentIds.map(id => {
            const person = game.residents.find(resident => resident.id === id);
            return person ? <button type="button" key={id} className="squad-scene"
              aria-label={`${person.name}の場面を見る（${preset.name}）`}
              onClick={() => onFocus(person.id)}>{person.name}</button> : null;
          })}</div>
        </li>)}
      </ul> : <p className="squad-empty">よく選ぶ住民の組合せを、名前を付けて残せます。</p>}
      <form className="squad-editor" onSubmit={event => {
        event.preventDefault();
        if (!preview || error) return;
        if (onCommand(cmd)) {
          const saved = preview.state.selectionPresets?.entries.find(preset =>
            editingId === undefined ? !presets.some(previous => previous.id === preset.id) : preset.id === editingId);
          if (saved) edit(saved);
          setFeedback("隊を保存しました。選択・場所・仕事・時計は変わっていません。");
        }
      }}>
        <div className="squad-editor-heading"><h3>{editingId === undefined ? "新しい隊を保存" : "隊の編成を編集"}</h3>
          {editingId !== undefined && <button type="button" onClick={fresh}>新しい隊へ</button>}
        </div>
        <label>隊の名前<input name="squad-name" value={name} maxLength={MAX_SELECTION_PRESET_NAME} placeholder="外出組"
          onChange={event => { setName(event.target.value); setFeedback(""); }} /></label>
        <p className="squad-members">保存する住民：<strong>{names(game, draftIds) || "住民一覧で選んでください"}</strong></p>
        {editingId !== undefined && <div className="squad-members-change">
          <button type="button" onClick={() => { setMemberIds([...selectedIds]); setFeedback(""); }}>選択中の住民に変更</button>
          <small>現在の選択：{names(game, selectedIds) || "なし"}。一覧を選び直しただけでは、この隊の編成は変わりません。</small>
        </div>}
        {error && <p className="squad-error">{error}</p>}
        <button className="squad-save" type="submit" disabled={!!error}>{editingId === undefined ? "この組合せを保存" : "変更を保存"}</button>
        {editingId !== undefined && <button type="button" className="squad-delete" disabled={game.ended} onClick={() => {
          if (onCommand({ type: "delete-selection-preset", presetId: editingId })) {
            fresh();
            setFeedback("隊の保存だけを削除しました。選択中の住民と仕事はそのままです。");
          }
        }}>この隊を削除</button>}
      </form>
      {feedback && <p className="squad-feedback" role="status">{feedback}</p>}
    </div>}
  </section>;
}
