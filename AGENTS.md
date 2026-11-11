# Instructions for AI coding agents (Codex, Claude, etc.)

This is the 88 Hotspring Resort IRMS. Every business rule comes from the IRMS Visual System Design Companion (PDF) and is already implemented and tested. **The current task is a visual redesign only.**

## You may change

- `client/src/styles.css`: colours, fonts, spacing, shadows, layout. Start with the CSS variables in `:root`.
- The markup, classes and layout of the screens in `client/src/pages/*.jsx` and `client/src/components/ui.jsx`. Examples: arranging panels, icons, spacing, responsive layout, nicer tables and cards.
- New purely presentational components.

## You must NOT change

- Anything in `server/`. All business rules, money calculations, approvals and audit live there.
- `client/src/api.js` and `client/src/auth.jsx`.
- API calls, request bodies or response fields used by the pages: `api.get/post/put(...)` URLs and payloads.
- **Gate conditions** that lock or unlock actions. Do not remove, weaken or bypass them. They include:
  - Confirm Check-in: four checks, which are ID verified, signed form, balance or approved exception, and room ready.
  - Confirm Transfer: locked while approval is PENDING or while a paid upgrade is unpaid.
  - Continue to Locker Assignment: locked until entry charges are paid.
  - Check Out Group: locked until all charges are settled and all keys are returned or cleared.
  - Over-collection blocks in `TenderEntry`.
- Money handling. Amounts are integer **centavos**: use `peso()` to display and `toCents()` to read input. Never use floats for money.
- Status names (e.g. `Active / Booked`, `Checked In`, `Key Returned - Unsettled`, `Under Repair / Blocked`). The server uses these exact strings.
- Labels that cite the PDF: `PROPOSED`, `TO CONFIRM`, and open-decision IDs like `OD-13`, `RT-01`, `RM-05`. Keep them visible.
- Role and permission checks (`can('...')`).

## Design rules from the PDF (Part 2, "Wireframe conventions"). Keep their meaning.

| Element | Meaning |
|---|---|
| Gold numbered circle | Marks a panel. The number matches the PDF's reference table. Keep the numbers. |
| Grey filled box | Read-only field filled by the system. |
| White box | Field the user types or selects. |
| Gold-outlined box (`.watch`) | Computed value the cashier must watch, e.g. the outstanding balance. |
| Teal button | Action that changes data. Outlined teal is a secondary action. |
| Gold button | The main next step. |
| Dashed gold button (`.locked` / disabled) | Action that is locked until its conditions are met. |
| Amber text with an OD number | Open decision: the field exists, the rule does not yet. |

The receipt and charge slip (`Receipt.jsx`, `ChargeSlip.jsx`, the `.receipt` CSS) are 80 mm thermal layouts of about 42 characters per line. Keep them monospace, black on white and printable.

The palette comes from the company documents: navy `#172b49`, teal `#148a80`, gold `#d4a64a`. Keep light-on-dark contrast readable.

## Before you finish

```bash
npm test          # all business-rule tests must still pass
npm run build     # the client must build
```

Then open every page in the sidebar and check that nothing is broken. Check these flows in particular:
- Room Check-in
- Change Room: Request Approval, then approve on the Approvals page
- Day Tour Group Check-in, then Lockers, then Settlement
- Department Sales & Charges
- Receipt printing

Commit on a separate branch, not on `main`.
