"use client";

import type { Card, Label } from "../../board-model";
import { type StyleWithVars, priorityText } from "./shared";
import type { KeyboardEvent } from "react";

export function CardItem({
  card,
  labels,
  today,
  movementDisabled,
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
  onOpen: () => void;
  onMove: (direction: "up" | "down" | "left" | "right") => void;
  onChecklistToggle: (itemId: string) => void;
  setRef: (node: HTMLButtonElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const doneCount = card.checklist.filter((item) => item.done).length;
  const isOverdue = card.dueDate && card.dueDate < today;
  const cardLabels = labels.filter((label) => card.labelIds.includes(label.id));

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!event.altKey) {
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
      className="card"
      draggable={!movementDisabled}
      onDragStart={(event) => {
        if (movementDisabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!movementDisabled) {
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
      </button>

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
        {card.dueDate && (
          <span className={isOverdue ? "overdueText" : ""}>到期：{card.dueDate}</span>
        )}
        {card.members.length > 0 && <span>成員：{card.members.join("、")}</span>}
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
                onChange={() => onChecklistToggle(item.id)}
              />
              <span>{item.text}</span>
            </label>
          ))}
        </div>
      )}

      <div className="moveControls" aria-label={`${card.title} 移動控制`}>
        <IconButton label="向上移動" text="↑" disabled={movementDisabled} onClick={() => onMove("up")} />
        <IconButton label="向下移動" text="↓" disabled={movementDisabled} onClick={() => onMove("down")} />
        <IconButton label="移到左欄" text="←" disabled={movementDisabled} onClick={() => onMove("left")} />
        <IconButton label="移到右欄" text="→" disabled={movementDisabled} onClick={() => onMove("right")} />
      </div>
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
