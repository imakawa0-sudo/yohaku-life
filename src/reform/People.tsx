import { useState } from "react";
import { ChevronDown, Dices, Plus, UserRound, X } from "lucide-react";
import {
  appearanceOptions,
  backgroundNames,
  bodyNames,
  freshSeed,
  makePersona,
  personalityNames,
  skillKeys,
  skillNames,
  startingSkills,
} from "./peopleModel";
import type { Appearance, Persona, Skill } from "./peopleModel";
import { Portrait, StandingFigure } from "./PixelArt";
import "./people.css";

const lookLabels: Record<keyof Appearance, string> = {
  face: "顔の輪郭",
  skin: "肌の色",
  hair: "髪形",
  hairColor: "髪色",
  age: "年代",
  build: "体格",
  eyes: "目元",
  mark: "顔の特徴",
  clothing: "服装",
  dye: "服の色",
};
type Section = "name" | "appearance" | "character" | "training";
const sections: Record<Section, string> = {
  name: "名前",
  appearance: "外見",
  character: "性格・体質・好み",
  training: "経歴・技能",
};
const skillHints: Record<Skill, string> = {
  wood: "制作と修繕",
  cook: "調理と食料",
  trade: "売買と交渉",
  care: "手当てと回復",
};

function Choice<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="yp-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {Object.entries<string>(choices).map(([key, title]) => (
          <option key={key} value={key}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionLock({
  locked,
  onToggle,
  label,
}: {
  locked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="yp-lock">
      <input
        type="checkbox"
        checked={locked}
        onChange={onToggle}
        aria-label={`${label}を固定`}
      />
      固定
    </label>
  );
}

export function PeopleEditor({
  people,
  onChange,
}: {
  people: Persona[];
  onChange: (people: Persona[]) => void;
}) {
  const [selected, selectPerson] = useState(people[0]?.id ?? "");
  const [locks, setLocks] = useState<
    Record<string, Partial<Record<Section, boolean>>>
  >({});
  const [message, setMessage] = useState("");
  const person =
    people.find((candidate) => candidate.id === selected) ?? people[0];
  if (!person)
    return (
      <button
        type="button"
        onClick={() => onChange([makePersona(0, freshSeed())])}
      >
        最初の住人をつくる
      </button>
    );
  const locked = locks[person.id] ?? {};
  const update = (patch: Partial<Persona>) =>
    onChange(
      people.map((other) =>
        other.id === person.id ? { ...other, ...patch } : other,
      ),
    );
  const toggle = (section: Section) =>
    setLocks((previous) => ({
      ...previous,
      [person.id]: {
        ...previous[person.id],
        [section]: !previous[person.id]?.[section],
      },
    }));
  function choose(id: string) {
    selectPerson(id);
    setMessage("");
  }
  function add() {
    if (people.length >= 3) return;
    let index = 0;
    while (people.some((other) => other.id === `person-${index + 1}`)) index++;
    const newPerson = makePersona(index, freshSeed());
    onChange([...people, newPerson]);
    choose(newPerson.id);
  }
  function roll() {
    const generated = makePersona(
      people.findIndex((other) => other.id === person.id),
      freshSeed(),
    );
    const next: Partial<Persona> = {};
    if (!locked.name) next.name = generated.name;
    if (!locked.appearance) next.appearance = generated.appearance;
    if (!locked.character) {
      next.personality = generated.personality;
      next.likes = generated.likes;
      next.dislikes = generated.dislikes;
      next.body = generated.body;
    }
    if (!locked.training) {
      next.skills = generated.skills;
      next.talent = generated.talent;
      next.background = generated.background;
    }
    update(next);
    setMessage(
      `抽選した項目　${(Object.keys(sections) as Section[])
        .filter((section) => !locked[section])
        .map((section) => sections[section])
        .join("・")}`,
    );
  }
  function look<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    update({ appearance: { ...person.appearance, [key]: value } });
  }
  function lookField<K extends keyof Appearance>(key: K) {
    return (
      <Choice
        key={key}
        label={lookLabels[key]}
        value={person.appearance[key] as string}
        choices={appearanceOptions[key]}
        onChange={(value) => look(key, value as Appearance[K])}
      />
    );
  }
  const header = (section: Section) => (
    <div className="yp-section-heading">
      <h4>{sections[section]}</h4>
      <SectionLock
        label={sections[section]}
        locked={!!locked[section]}
        onToggle={() => toggle(section)}
      />
    </div>
  );
  return (
    <div className="yp-editor">
      <div className="yp-roster" aria-label="作成する世帯の住人">
        {people.map((other) => (
          <button
            type="button"
            key={other.id}
            className={other.id === person.id ? "is-selected" : ""}
            onClick={() => choose(other.id)}
            aria-pressed={other.id === person.id}
          >
            <span className="yp-mini" aria-hidden="true">
              <Portrait person={other} />
            </span>
            <span>{other.name || "名前を入力"}</span>
          </button>
        ))}
        {people.length < 3 && (
          <button type="button" className="yp-add" onClick={add}>
            <Plus size={16} />
            住人を追加
          </button>
        )}
      </div>
      <div className="yp-sheet" key={person.id}>
        <div className="yp-intro">
          <div className="yp-cover">
            <Portrait person={person} />
          </div>
          <div className="yp-namebox">
            <div className="yp-section-heading">
              <label htmlFor={"yp-name-" + person.id}>名前</label>
              <SectionLock
                label={sections.name}
                locked={!!locked.name}
                onToggle={() => toggle("name")}
              />
            </div>
            <input
              id={"yp-name-" + person.id}
              value={person.name}
              maxLength={32}
              placeholder="住人の名前"
              onChange={(event) => update({ name: event.target.value })}
              onBlur={() => {
                if (!person.name.trim()) update({ name: "名なしの住人" });
              }}
            />
            <p>
              {personalityNames[person.personality]}。{skillNames[person.likes]}
              を好む。
            </p>
            <div className="yp-tools">
              <button
                type="button"
                disabled={
                  Object.values(sections).length ===
                  Object.values(locked).filter(Boolean).length
                }
                onClick={roll}
              >
                <Dices size={16} />
                固定以外をおまかせ
              </button>
              {people.length > 1 && (
                <button
                  type="button"
                  className="yp-remove"
                  onClick={() => {
                    const remaining = people.filter(
                      (other) => other.id !== person.id,
                    );
                    onChange(remaining);
                    choose(remaining[0].id);
                    setLocks((previous) => {
                      const next = { ...previous };
                      delete next[person.id];
                      return next;
                    });
                  }}
                  aria-label={`${person.name}を世帯から外す`}
                >
                  <X size={15} />
                  外す
                </button>
              )}
            </div>
          </div>
        </div>
        {message && (
          <p className="yp-feedback" role="status">
            {message}
          </p>
        )}
        <details className="yp-customize">
          <summary>
            <UserRound size={16} />
            住人を詳しくつくる
            <ChevronDown size={16} />
          </summary>
          <section>
            {header("appearance")}
            <div className="yp-appearance">
              <div className="yp-standing-preview">
                <StandingFigure person={person} />
              </div>
              <div className="yp-look">
                {(Object.keys(lookLabels) as (keyof Appearance)[]).map(
                  lookField,
                )}
              </div>
            </div>
          </section>
          <section>
            {header("character")}
            <div className="yp-look">
              <Choice
                label="性格"
                value={person.personality}
                choices={personalityNames}
                onChange={(personality) => update({ personality })}
              />
              <Choice
                label="身体特性"
                value={person.body}
                choices={bodyNames}
                onChange={(body) => update({ body })}
              />
              <Choice
                label="好きな活動"
                value={person.likes}
                choices={skillNames}
                onChange={(likes) =>
                  update({
                    likes,
                    dislikes:
                      person.dislikes === likes ? null : person.dislikes,
                  })
                }
              />
              <Choice<string>
                label="苦手な活動"
                value={person.dislikes ?? ""}
                choices={{
                  "": "特になし",
                  ...Object.fromEntries(
                    skillKeys
                      .filter((k) => k !== person.likes)
                      .map((k) => [k, skillNames[k]]),
                  ),
                }}
                onChange={(value) =>
                  update({ dislikes: value ? (value as Skill) : null })
                }
              />
            </div>
          </section>
          <section>
            {header("training")}
            <div className="yp-look">
              <Choice
                label="経歴"
                value={person.background}
                choices={backgroundNames}
                onChange={(background) => update({ background })}
              />
              <Choice
                label="伸びやすい技能"
                value={person.talent}
                choices={skillNames}
                onChange={(talent) => update({ talent })}
              />
            </div>
            <div className="yp-skillhead">
              <strong>初期技能</strong>
              <button
                type="button"
                onClick={() =>
                  update({ skills: { ...startingSkills[person.background] } })
                }
              >
                経歴に合わせる
              </button>
            </div>
            <div className="yp-skills">
              {skillKeys.map((skill) => (
                <label key={skill}>
                  <span>
                    {skillNames[skill]}
                    <small>{skillHints[skill]}</small>
                  </span>
                  <select
                    aria-label={`${skillNames[skill]}の初期レベル`}
                    value={person.skills[skill]}
                    onChange={(event) =>
                      update({
                        skills: {
                          ...person.skills,
                          [skill]: Number(event.target.value),
                        },
                      })
                    }
                  >
                    {Array.from({ length: 11 }, (_, level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        </details>
      </div>
    </div>
  );
}
