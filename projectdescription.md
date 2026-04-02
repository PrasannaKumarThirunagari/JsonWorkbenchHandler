# JsonIntelligence — Project description

## Purpose

A single-page HTML experience for exploring, comparing, and searching JSON. The UI should feel clear and fast, with a tree-style view and tools for diffing and lookup.

## Tech stack

- **Tailwind CSS** for layout and styling
- Plain HTML (and JavaScript as needed for interactivity)

## Layout

### Header

A persistent header anchors the app: title/branding and primary navigation.

### Tab 1 — Compare files

- Navigation exposes **Compare** as the main entry for file diffing.
- Users can **upload two JSON files** (or pick files from the device).
- The view shows a **side-by-side or unified comparison** of structure and values, with clear indication of additions, removals, and changes.

### Tab 2 — Search & traverse

- **Search** across JSON **keys (node names)** and **values**.
- A **dropdown** (or similar control) lists **traversable paths** through the tree so users can jump to a node without manually expanding every branch.

## Shared JSON viewer behavior

These apply wherever JSON is shown (compare panes, single-file view, etc.):

1. **Collapse / expand** — Nodes can be folded and unfolded to manage depth and focus.
2. **Node name emphasis** — Object keys / node labels use **slightly stronger weight** (e.g. semibold) so structure reads quickly against values.

## Out of scope (for this doc)

Backend persistence, auth, and API design are not specified here; the target is a capable client-side HTML experience unless extended later.
