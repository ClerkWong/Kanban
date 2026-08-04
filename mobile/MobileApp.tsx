import { useEffect, useRef, useState } from "react";
import { PrivacyContent } from "../app/components/legal/PrivacyContent";
import { SupportContent } from "../app/components/legal/SupportContent";
import { ProjectApp } from "../app/components/projects/ProjectApp";

type InfoPanel = "privacy" | "support";

export function MobileApp() {
  const [panel, setPanel] = useState<InfoPanel | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!panel) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panel]);

  return (
    <>
      <ProjectApp />
      <button
        aria-expanded={panel !== null}
        aria-haspopup="dialog"
        className="mobileInfoButton"
        onClick={() => setPanel("support")}
        type="button"
      >
        說明
      </button>
      {panel ? (
        <div
          className="modalBackdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPanel(null);
          }}
        >
          <section
            aria-labelledby="mobile-info-title"
            aria-modal="true"
            className="modal mobileInfoModal"
            role="dialog"
          >
            <header className="modalHeader">
              <div>
                <p className="eyebrow">定恆人工智能 · 1.1.0</p>
                <h2 id="mobile-info-title">
                  {panel === "privacy" ? "隱私說明" : "支援"}
                </h2>
              </div>
              <button
                className="secondaryButton"
                onClick={() => setPanel(null)}
                ref={closeButtonRef}
                type="button"
              >
                關閉
              </button>
            </header>
            <nav aria-label="說明頁面" className="mobileInfoTabs">
              <button
                aria-current={panel === "support" ? "page" : undefined}
                className={panel === "support" ? "primaryButton" : "secondaryButton"}
                onClick={() => setPanel("support")}
                type="button"
              >
                支援
              </button>
              <button
                aria-current={panel === "privacy" ? "page" : undefined}
                className={panel === "privacy" ? "primaryButton" : "secondaryButton"}
                onClick={() => setPanel("privacy")}
                type="button"
              >
                隱私
              </button>
            </nav>
            <div className="mobileInfoContent">
              {panel === "privacy" ? <PrivacyContent /> : <SupportContent />}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
