# Kanban Web App — MVP Product Plan

## 1. Product goal

Build a touch-friendly Kanban application inspired by Trello, with Kanban-method features that make work-in-progress visible and manageable. The first release is a responsive Progressive Web App (PWA) that works on desktop, iOS, and Android browsers and can be installed on the home screen.

The architecture must keep a clean path to native App Store and Google Play distribution through Capacitor after the web experience is stable.

## 2. Product assumptions

- Language: Traditional Chinese first.
- Audience: an individual or small team managing knowledge work.
- First-release persistence: device-local, offline-capable data with an obvious demo reset path.
- First-release scope: one primary board experience; accounts, cloud sync, and real-time collaboration are deliberately deferred.
- Mobile target: current Safari on iOS and Chrome on Android, with safe-area-aware layout and touch interactions.

## 3. MVP scope

### Board workflow

- Four useful starter columns: 待辦、進行中、審核中、完成.
- Create, edit, archive/delete, and restore or undo card actions where appropriate.
- Reorder cards within a column and move them across columns.
- Touch, pointer, and keyboard-friendly movement; provide explicit move controls when drag-and-drop is inconvenient.
- Add a card directly from a column.

### Card details

- Title and description.
- Priority and colored labels.
- Due date.
- Checklist with visible progress.
- Lightweight assignee/avatar representation.

### Kanban-method features

- Configurable work-in-progress (WIP) limit per active column.
- Clear warning when a column reaches or exceeds its WIP limit; do not silently block the user.
- Small board-level indicators for total work, active work, completed work, and overdue work.

### Finding and focusing

- Search cards by title or description.
- Filter by label, priority, and due/overdue state.
- Empty, no-results, and first-use states.

### Cross-platform experience

- Responsive desktop and mobile layouts.
- Mobile horizontal board navigation with comfortable touch targets.
- PWA manifest, installable metadata, icons, theme color, and offline app shell.
- Persistent local data that survives refresh and restart.
- Respect reduced-motion and safe-area insets.

## 4. Deferred scope

- Sign-in, organizations, invitations, permissions, and multiple workspaces.
- Cloud sync, multi-user real-time collaboration, presence, and comments.
- Attachments and object storage.
- Push/email notifications and calendar integrations.
- Native App Store / Play Store packaging and store submission.
- Advanced analytics such as cumulative-flow and cycle-time charts.

These are phase-two capabilities. The MVP data model and UI should not make them unnecessarily difficult to add.

## 5. Technical direction

- TypeScript and React-based responsive web application.
- Reuse the Sites project structure in this workspace.
- Accessible drag-and-drop or equivalent sortable interaction that supports mouse, touch, and keyboard.
- A small, explicit client-side state layer with versioned local persistence.
- PWA service worker and web app manifest.
- Semantic HTML, visible focus styles, accessible names, and at least WCAG AA color contrast for essential UI.
- No dependency on an OpenAI API key; ChatGPT models are used to build and review the product, not as a runtime requirement.

### Native path

After the PWA passes mobile acceptance, add Capacitor as a thin native container. Native-only work should focus on status-bar/safe-area treatment, splash/icons, deep links, share integration, push notifications, and store signing rather than rewriting the application.

## 6. UX direction

- Calm, modern workspace rather than a close visual copy of Trello.
- Dense enough for desktop planning, but with touch-friendly controls on mobile.
- Traditional Chinese microcopy throughout.
- Realistic seeded board content so all states and interactions are demonstrable immediately.
- Keep the board itself dominant; avoid generic dashboard chrome.

## 7. Acceptance criteria

### Defined behavior for risky edge cases

- Search or filters use AND semantics across filter groups. While any search or filter is active, drag/reorder controls are disabled and the UI explains that the view must be cleared before changing canonical order.
- WIP is computed from the complete, unfiltered card state. 待辦、進行中、審核中 can have limits; 完成 has no WIP limit. Reaching or exceeding a limit warns but does not block a move.
- Due dates remain date-only `YYYY-MM-DD` values and overdue status is calculated against the user's local calendar date, never by converting the value to a UTC instant.
- The MVP uses permanent card deletion with explicit confirmation. Demo-data reset also requires explicit confirmation; cancelling either operation changes nothing.
- Card movement and reorder must have explicit non-drag controls. Essential touch targets are at least 44 by 44 CSS pixels.
- The UI clearly states that data is stored only in this browser on this device and can be lost when site data is cleared. A persistence write failure must be visible and must not be presented as saved.

### Functional

- A user can add a card, edit its core fields, move it between columns, reorder it, complete checklist items, and remove it.
- Search and filters immediately change the visible cards and can be cleared.
- WIP status updates correctly after card moves.
- All user changes persist after a page reload.
- A reset/demo-data action works and is clearly guarded.

### Mobile and PWA

- Core workflows are usable at approximately 390 x 844 and 412 x 915 viewports without clipped primary controls.
- Touch targets are comfortable and the board can be navigated without relying only on precise dragging.
- iOS safe areas and standalone display mode are handled.
- The manifest and service worker are valid enough for supported browsers to offer installation.
- The manifest includes name, short name, start URL, scope, standalone display, theme/background colors, 192 px and 512 px icons, and a maskable icon declaration.
- After one successful online visit and service-worker activation, an installed/offline cold start supports the complete device-local card workflow, not only the visual shell.

### Accessibility and quality

- Primary flows are operable by keyboard, with visible focus and no keyboard trap.
- Buttons and form controls have accessible names; dialogs manage focus and close with Escape.
- Reduced-motion preferences are respected.
- Core status changes such as card moves, filter results, WIP warnings, and persistence failures have text or assistive-technology announcements and are not conveyed by color alone.
- Production build succeeds with no blocking type or compile errors.
- Automated tests cover the state operations most likely to corrupt board data.

### Data integrity

- Persisted state has an explicit schema version and a safe fallback for malformed data; malformed data must not crash the app.
- State invariants hold after rapid and repeated operations: card IDs are unique, every card belongs to exactly one column, and each column order contains no duplicate card IDs.
- A valid intentionally empty board is not mistaken for first launch and silently replaced with demo data.
- User-authored text is rendered as text and cannot execute stored HTML or JavaScript.

### Independent review

The gpt-5.6-sol reviewer must inspect the implementation independently, run the production build and tests, exercise desktop and mobile workflows, list findings by severity, and either approve the MVP or provide concrete required fixes. Required fixes are applied and rechecked before handoff.

## 8. Model workflow

1. Current planning task: define scope, architecture, and acceptance criteria.
2. `gpt-5.5` with high reasoning: implement the complete MVP in the shared project.
3. `gpt-5.6-sol` with high or stronger reasoning: perform an independent product, code, accessibility, and mobile/PWA acceptance review.
4. `gpt-5.5` (or the primary task for small integration fixes): address required findings.
5. `gpt-5.6-sol`: confirm all blocking findings are closed and issue the final acceptance result.
