# JsonWorkbenchHandler · JsonIntelligence

<p align="center">
  <strong>Compare, search, and traverse JSON — entirely in your browser.</strong>
</p>

<p align="center">
  <a href="https://github.com/PrasannaKumarThirunagari/JsonWorkbenchHandler">Repository</a>
  ·
  <a href="https://github.com/PrasannaKumarThirunagari">@PrasannaKumarThirunagari</a>
</p>

---

## Overview

**JsonIntelligence** is a calm, fast single-page app for working with JSON: diff two documents side by side, then drill into one file with search, path jumping, and a compact tree. No server, no build step — open `index.html` and go.

---

## Features

### Compare JSON

- Two editors with **line-number gutters**, **upload**, **copy / paste / cut / clear**, and **format** (2-space pretty-print).
- **Compare JSON** builds a structural diff; results render in the **same card** below the editors (no pop-out diff window).
- **Show** filters: toggle **key / property changes** (added & removed) and **value changes** independently; status text reflects what’s visible vs total.
- **Deep nesting** is supported in the diff model and viewer (including arrays).
- Optional **preview** and **download** on the right editor.

### Search & traverse

- Load JSON via **file** or **paste**, then **Parse pasted**.
- **Search** filters the tree by key or value text.
- **Jump to path** jumps and expands the tree to a chosen JSON path.
- **Tight tree indentation** for readable deep structures; collapse / expand per node.

---

## Quick start

```bash
git clone https://github.com/PrasannaKumarThirunagari/JsonWorkbenchHandler.git
cd JsonWorkbenchHandler
```

Then open **`index.html`** in a modern browser (Chrome, Edge, Firefox, Safari).

> **Tip:** For clipboard paste in Compare, the page should be served over **HTTPS** or **localhost** so the Clipboard API is allowed. Opening the file via `file://` may restrict paste in some browsers.

### Optional: local static server

```bash
# Python 3
python -m http.server 8080

# Node (npx)
npx serve .
```

Visit `http://localhost:8080` and open `index.html` if the server lists the directory.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Markup | HTML5 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (CDN) |
| Logic | Plain JavaScript (`app.js`), no bundler |

---

## Project layout

```
JsonWorkbenchHandler/
├── index.html          # App shell, tabs, compare + explore UI
├── app.js              # Tree render, diff, search, paths, compare filters
├── projectdescription.md
├── README.md
├── .gitignore
├── json files/         # Sample JSON (optional)
└── MockFiles/          # UI reference assets
```

---

## Roadmap ideas

- GitHub **Pages** one-click deploy from `main`.
- Export diff summary as JSON or Markdown.
- Theme toggle (light / dark).

---

## License

This project is provided as-is for learning and reuse. Add a `LICENSE` file if you need a formal terms (e.g. MIT).

---

<p align="center">
  Built with care · <a href="https://github.com/PrasannaKumarThirunagari/JsonWorkbenchHandler">Star the repo</a> if it helps your workflow.
</p>
