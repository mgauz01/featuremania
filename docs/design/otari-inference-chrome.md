# Otari inference chrome

**Reading this as:** dashboard control language for a local Kanban, zinc/gold product chrome. Only actions that spend Otari should look expensive.

**Dials (this control only):** variance 3 / motion 3 / density 8.

## Decision

A raised zinc button with a gold rim means “this calls Otari.” Gold fill stays on score badges. Local actions stay flat.

| Control | Calls Otari? | Treatment |
|---|---|---|
| Load board | Yes | `btn-inference` |
| Refresh | Yes | `btn-inference` |
| Consolidate | Yes | `btn-inference` |
| Deconstruct, Select all, Deselect, Save name, Confirm, Cancel | No | Flat |

Card `issue.summary` is the Otari comment. Restyle it with a gold rail. Do not add a second field.

## Out of scope

Board redesign, gold-fill or glass buttons, cost meter, GitHub writes, new summary API.

## Weakest dimension

Light-mode bevel next to the gold badge. Next bottleneck is a fourth Otari verb (per-card rescore), not button CSS.
