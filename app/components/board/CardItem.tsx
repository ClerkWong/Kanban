"use client";

import type { BoardSettings, Card, Label } from "../../board-model";
import { getAgingLevel, getCardAgingDays } from "../../board-model";
import { type StyleWithVars, priorityText, serviceClassText } from "./shared";
import type { KeyboardEvent } from "react";

export function CardItem({
  card,
  labels,
  today,
  movementDisabled,
  assigneeNames,
  readOnly = false,
  settings,
  isDoneColumn,
  onOpen,
  onMove,
  onChecklistToggle,
  setRef,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  card: Card;
  labels: Label[];
  today: string;
  movementDisabled: boolean;
  /** Undefined for legacy boards; Project boards provide the current member directory. */
  assigneeNames?: Record<string, string>;
  readOnly?: boolean;
  settings: BoardSettings;
  isDoneColumn: boolean;
  onOpen: () => void;
  onMove: (direction: "up" | "down" | "left" | "right") => void;
  onChecklistToggle: (itemId: string) => void;
  setRef: (node: HTMLButtonElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const doneCount = card.checklist.filter((item) => item.done).length;
  const agingDays = isDoneColumn ? 0 : getCardAgingDays(card, today);
  const agingLevel = isDoneColumn ? "normal" : getAgingLevel(agingDays, settings);
  const isOverdue = card.dueDate && card.dueDate < today;
  const cardLabels = labels.filter((label) => card.labelIds.includes(label.id));
  const assignees = assigneeNames === undefined
    ? []
    : card.assigneeUserIds.map(
        (userId) => assigneeNames[userId] ?? `已離開 (${userId.slice(0, 8)})`,
      );

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (readOnly || !event.altKey) {
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove("up");
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove("down");
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onMove("left");
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onMove("right");
    }
  }

  return (
    <article
      className={`card${card.serviceClass === "expedite" ? " expedite" : ""}`}
      draggable={!movementDisabled && !readOnly}
      onDragStart={(event) => {
        if (movementDisabled || readOnly) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!movementDisabled && !readOnly) {
          event.preventDefault();
        }
      }}
      onDrop={onDropBefore}
      onKeyDown={handleKeyDown}
      aria-describedby={`card-${card.id}-meta`}
    >
      <button ref={setRef} type="button" className="cardOpen" onClick={onOpen}>
        <span className={`priorityDot ${card.priority}`} aria-hidden="true" />
        <span>{card.title}</span>
        {card.serviceClass !== "standard" && (
          <span className={`serviceBadge ${card.serviceClass}`}>
            {serviceClassText[card.serviceClass]}
          </span>
        )}
      </button>

      {card.blocked && (
        <div className="blockedBanner">
          <strong>卡住</strong>
          <span>{card.blockedReason}</span>
        </div>
      )}

      {card.description && <p className="cardDescription">{card.description}</p>}

      <div className="labelRow" aria-label="標籤">
        {cardLabels.map((label) => (
          <span
            key={label.id}
            className="labelPill"
            style={{ "--label": label.color } as StyleWithVars}
          >
            {label.name}
          </span>
        ))}
      </div>

      <div id={`card-${card.id}-meta`} className="cardMeta">
        <span>優先級：{priorityText[card.priority]}</span>
        {!isDoneColumn && (
          <span className={`agingNote ${agingLevel}`}>
            此欄 {agingDays} 天{agingLevel !== "normal" ? " · 停留過久" : ""}
          </span>
        )}
        {card.dueDate && (
          <span className={isOverdue ? "overdueText" : ""}>到期：{card.dueDate}</span>
        )}
        {assigneeNames === undefined && card.members.length > 0 && (
          <span>成員：{card.members.join("、")}</span>
        )}
        {assignees.length > 0 && <span>負責人：{assignees.join("、")}</span>}
        {card.blockedAt && (
          <span className="blockedSince">
            卡住時間：{new Date(card.blockedAt).toLocaleString("zh-TW")}
          </span>
        )}
        {assigneeNames !== undefined && card.members.length > 0 && (
          <span>舊版成員：{card.members.join("、")}</span>
        )}
        {card.attachments.length > 0 && <span>附件：{card.attachments.length}</span>}
      </div>

      {card.checklist.length > 0 && (
        <div className="checkPreview">
          <div className="progressLine">
            <span>清單 {doneCount}/{card.checklist.length}</span>
            <span
              className="progressBar"
              style={
                { "--progress": `${(doneCount / card.checklist.length) * 100}%` } as StyleWithVars
              }
              aria-hidden="true"
            />
          </div>
          {card.checklist.slice(0, 3).map((item) => (
            <label key={item.id} className="miniCheck">
              <input
                type="checkbox"
                checked={item.done}
                disabled={readOnly}
                onChange={() => onChecklistToggle(item.id)}
              />
              <span>{item.text}</span>
            </label>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="moveControls" aria-label={`${card.title} 移動控制`}>
          <IconButton label="向上移動" text="↑" disabled={movementDisabled} onClick={() => onMove("up")} />
          <IconButton label="向下移動" text="↓" disabled={movementDisabled} onClick={() => onMove("down")} />
          <IconButton label="移到左欄" text="←" disabled={movementDisabled} onClick={() => onMove("left")} />
          <IconButton label="移到右欄" text="→" disabled={movementDisabled} onClick={() => onMove("right")} />
        </div>
      )}
    </article>
  );
}

function IconButton({
  label,
  text,
  disabled,
  onClick,
}: {
  label: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="iconMove" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}
