# Browser extension bundle

## Two ways to load the add-on

1. **Project root** (fewer steps): load unpacked from the repository root — the folder that contains `manifest.json` next to `index.html`. This is always the live app.

2. **`unpacked/` subfolder**: a **copy** of the same shippable files for teams that want a dedicated extension directory (zip this folder, CI artifacts, etc.).

## Refresh `extensions/unpacked/` after you change the app

From the **repository root**:

```bash
npm run sync:extension
```

That copies: `index.html`, `app.js`, `styles.css`, `theme-init.js`, `app-extra.css`, `manifest.json`, `background.js`, and the `icons/` folder into `extensions/unpacked/`.

Then in **Chrome / Edge**: `chrome://extensions` → **Load unpacked** → select **`extensions/unpacked`**.

In **Firefox**: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → choose **`extensions/unpacked/manifest.json`**.

> Run `npm run build:css` first if you changed Tailwind sources and `styles.css` is out of date.

See the **Browser extension** section in the root `README.md` for more context.
