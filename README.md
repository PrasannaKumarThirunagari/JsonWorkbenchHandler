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

**JsonIntelligence** is a calm, fast single-page app for working with JSON: diff two documents side by side, then drill into one file with search, path jumping, and a compact tree. Styling is shipped as built **Tailwind CSS** (`styles.css`); run `npm run build:css` after you change layout classes if you need to regenerate it.

---

## Features

### Compare JSON

- Two editors with **line-number gutters**, **upload**, **copy / paste / cut / clear**, and **format** (2-space pretty-print).
- **Compare JSON** builds a structural diff; results render in the **same card** below the editors (no pop-out diff window).
- **Show** filters: toggle **key / property changes** (added & removed) and **value changes** independently; status text reflects what’s visible vs total.
- **Deep nesting** is supported in the diff model and viewer (including arrays).
- Optional **preview** and **download** on the right editor.

### Text compare

- Two panes with **upload** or paste, **case sensitive** and **ignore whitespace** options, and **Diff only** vs **show all lines** for the line diff output.

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

Then open **`index.html`** in a modern browser (Chrome, Edge, Firefox, Safari). The repo includes a prebuilt **`styles.css`**; if it is missing, run `npm install` once, then `npm run build:css` from the project root.

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

## Browser extension (Chrome & Firefox)

The **same** `index.html` and assets work as a static site and as an **unpacked** / **temporary** extension:

1. Ensure `styles.css` exists (run `npm run build:css` from the project root if needed).
2. **Chrome / Edge:** `chrome://extensions` → Developer mode → **Load unpacked** → select this project folder (where `manifest.json` lives).
3. **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → choose `manifest.json` in this folder.

Click the toolbar button to open the app in a new tab. For Firefox signing or a permanent add-on id, change `browser_specific_settings.gecko.id` in `manifest.json` to your own id before publishing.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Markup | HTML5 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (built to `styles.css`; see `tailwind.config.js`) |
| Logic | Plain JavaScript (`app.js`), no bundler |

---

## Project layout

```
JsonWorkbenchHandler/
├── index.html          # App shell, tabs, compare + explore + text compare UI
├── app.js              # Tree render, diff, search, paths, compare filters
├── styles.css          # Built Tailwind (run npm run build:css to regenerate)
├── theme-init.js       # Theme before paint (web + extension)
├── app-extra.css       # Small rules (drop zone, path listbox)
├── manifest.json       # MV3 manifest (Chrome + Firefox gecko block)
├── background.js       # Opens index.html in a new tab from toolbar
├── icons/              # Extension toolbar icons
├── package.json        # DevDependency: tailwindcss; script build:css
├── tailwind.config.js
├── tailwind-input.css
├── projectdescription.md
├── README.md
├── .gitignore
├── json files/         # Sample JSON (optional)
└── extensions/         # Note only; load unpacked from repo root
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
