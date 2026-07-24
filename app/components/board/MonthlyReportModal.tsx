"use client";

import type { RefObject } from "react";
import { useEffect } from "react";
import type { Label, MonthlyCompletion, Priority } from "../../board-model";

const priorityText: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

export function MonthlyReportModal({
  stats,
  labels,
  modalRef,
  onClose,
}: {
  stats: MonthlyCompletion[];
  labels: Label[];
  modalRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    modalRef.current?.focus();
  }, [modalRef]);

  const maxCount = stats.reduce((max, s) => Math.max(max, s.count), 0);
  const labelMap = new Map(labels.map((l) => [l.id, l]));

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        className="modal reportModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reportTitle"
        tabIndex={-1}
        ref={modalRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
      >
        <div className="reportContent">
          <div className="reportHeader">
            <h2 id="reportTitle">📊 每月完成報表</h2>
            <button type="button" className="iconOnly" onClick={onClose} aria-label="關閉">
              ×
            </button>
          </div>

          <div className="reportChart">
            {stats.length === 0 ? (
              <div className="reportEmpty">完成欄目前沒有任何卡片。</div>
            ) : (
              stats.map((s) => {
                const widthPercent = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                return (
                  <div key={s.month} className="reportChartRow">
                    <div className="reportMonthLabel">{s.monthLabel}</div>
                    <div className="reportBar">
                      <div
                        className="reportBarFill"
                        style={{ "--bar-width": `${widthPercent}%` } as React.CSSProperties}
                      />
                    </div>
                    <div className="reportCount">{s.count}</div>
                  </div>
                );
              })
            )}
          </div>

          <div className="reportList">
            {stats.map((s) => (
              <div key={s.month} className="reportSection">
                <h3 className="reportSectionTitle">
                  {s.monthLabel}（{s.count}）
                </h3>
                {s.cards.map((card) => (
                  <div key={card.id} className="reportCardRow">
                    <div className="reportCardTitle">{card.title}</div>
                    <div className={`reportPriority ${card.priority}`}>
                      {priorityText[card.priority]}
                    </div>
                    <div className="reportLabels">
                      {card.labelIds.map((labelId) => {
                        const label = labelMap.get(labelId);
                        if (!label) return null;
                        return (
                          <span
                            key={labelId}
                            className="reportLabel"
                            style={{ "--label": label.color } as React.CSSProperties}
                          >
                            {label.name}
                          </span>
                        );
                      })}
                    </div>
                    <div className="reportDate">
                      {formatCompletedDate(card.completedAt)}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCompletedDate(completedAt: string | null): string {
  if (!completedAt) {
    return "—";
  }
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
