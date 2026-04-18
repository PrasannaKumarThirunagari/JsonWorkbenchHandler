(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function parsePath(pathStr) {
    if (!pathStr || pathStr === "$") return [];
    const s = pathStr.startsWith("$") ? pathStr.slice(1) : pathStr;
    const parts = [];
    let i = 0;
    while (i < s.length) {
      if (s[i] === ".") {
        i++;
        continue;
      }
      if (s[i] === "[") {
        const end = s.indexOf("]", i);
        if (end === -1) break;
        parts.push(Number(s.slice(i + 1, end)));
        i = end + 1;
      } else {
        let j = i;
        while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
        const key = s.slice(i, j);
        if (key) parts.push(key);
        i = j;
      }
    }
    return parts;
  }

  function pathPrefixes(fullPath) {
    const parts = parsePath(fullPath);
    const out = ["$"];
    let acc = "$";
    for (const p of parts) {
      acc += typeof p === "number" ? `[${p}]` : "." + p;
      out.push(acc);
    }
    return out;
  }

  function getAt(obj, parts) {
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function enumeratePaths(value, prefix = "$") {
    const paths = [prefix];
    if (isPlainObject(value)) {
      for (const k of Object.keys(value).sort()) {
        const child = prefix + "." + k;
        // enumeratePaths(child, ...) already includes `child` as its first element,
        // so we must not push `child` again to avoid duplicate dropdown entries.
        paths.push(...enumeratePaths(value[k], child));
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const child = prefix + "[" + i + "]";
        // Avoid pushing `child` twice; recurse result already starts with `child`.
        paths.push(...enumeratePaths(item, child));
      });
    }
    return paths;
  }

  function jsonEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  /** @returns {object} diff node */
  function diffValue(left, right) {
    if (left === undefined && right === undefined) return { kind: "same", value: undefined };
    if (left === undefined) return { kind: "added", right };
    if (right === undefined) return { kind: "removed", left };

    const lObj = typeof left === "object" && left !== null;
    const rObj = typeof right === "object" && right !== null;
    if (!lObj || !rObj) {
      if (jsonEqual(left, right)) return { kind: "same", value: left };
      return { kind: "changed", left, right };
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const n = Math.max(left.length, right.length);
      const items = [];
      for (let i = 0; i < n; i++) items.push(diffValue(left[i], right[i]));
      return { kind: "array", items };
    }
    if (!Array.isArray(left) && !Array.isArray(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      return {
        kind: "object",
        keys: keys.map((key) => ({ key, child: diffValue(left[key], right[key]) })),
      };
    }
    return { kind: "changed", left, right };
  }

  /** Last path segment for compact diff UI (tooltip carries full path). */
  function diffPathTail(fullPath) {
    if (fullPath == null || fullPath === "" || fullPath === "$") return "$";
    const br = /\[(\d+)\]$/.exec(fullPath);
    if (br) return "[" + br[1] + "]";
    const dot = fullPath.lastIndexOf(".");
    if (dot > 0 && fullPath[0] === "$") return fullPath.slice(dot + 1);
    return fullPath.replace(/^\$\.?/, "") || "$";
  }

  function flattenUnified(node, basePath, out) {
    if (node.kind === "same") return;
    if (node.kind === "added") {
      out.push({ path: basePath || "$", type: "added", left: undefined, right: node.right });
      return;
    }
    if (node.kind === "removed") {
      out.push({ path: basePath || "$", type: "removed", left: node.left, right: undefined });
      return;
    }
    if (node.kind === "changed") {
      out.push({ path: basePath || "$", type: "changed", left: node.left, right: node.right });
      return;
    }
    if (node.kind === "object") {
      for (const { key, child } of node.keys) {
        const p = basePath === "" || basePath === "$" ? "$." + key : basePath + "." + key;
        flattenUnified(child, p, out);
      }
      return;
    }
    if (node.kind === "array") {
      node.items.forEach((child, i) => {
        const p = basePath + "[" + i + "]";
        flattenUnified(child, p, out);
      });
    }
  }

  function formatValue(v) {
    if (v === undefined) return "—";
    if (typeof v === "string") return JSON.stringify(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  /**
   * @param {{ keyChanges: boolean, valueChanges: boolean }} opts
   * Key/property: added & removed nodes (properties or array slots only on one side).
   * Value: leaf "changed" nodes (different scalars, nulls, or mismatched types).
   */
  function filterCompareDiff(node, opts) {
    if (!node || node.kind === "same") return null;
    const keyChanges = !!opts.keyChanges;
    const valueChanges = !!opts.valueChanges;

    if (node.kind === "added" || node.kind === "removed") {
      return keyChanges ? node : null;
    }
    if (node.kind === "changed") {
      return valueChanges ? node : null;
    }
    if (node.kind === "object") {
      const keys = [];
      for (const { key, child } of node.keys) {
        const f = filterCompareDiff(child, opts);
        if (f) keys.push({ key, child: f });
      }
      if (keys.length === 0) return null;
      return { kind: "object", keys };
    }
    if (node.kind === "array") {
      const dense = [];
      for (let i = 0; i < node.items.length; i++) {
        const f = filterCompareDiff(node.items[i], opts);
        dense.push(f != null ? f : { kind: "same", value: undefined });
      }
      if (!dense.some((ch) => ch.kind !== "same")) return null;
      return { kind: "array", items: dense };
    }
    return null;
  }

  function getCompareFilterOptions() {
    const keyEl = $("compare-opt-keys");
    const valEl = $("compare-opt-values");
    return {
      keyChanges: !keyEl || keyEl.checked,
      valueChanges: !valEl || valEl.checked,
    };
  }

  function summarizeDiffCounts(node) {
    const flat = [];
    if (node) flattenUnified(node, "$", flat);
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const item of flat) {
      if (item.type === "added") added++;
      else if (item.type === "removed") removed++;
      else if (item.type === "changed") changed++;
    }
    return { added, removed, changed, total: added + removed + changed };
  }

  function formatChangeBreakdown(counts) {
    return (
      counts.added +
      " added, " +
      counts.removed +
      " removed, " +
      counts.changed +
      " value edits"
    );
  }

  function pruneDiff(node) {
    if (!node) return null;
    if (node.kind === "same") return null;
    if (node.kind === "added" || node.kind === "removed" || node.kind === "changed") return node;
    if (node.kind === "object") {
      const keys = [];
      for (const { key, child } of node.keys) {
        const p = pruneDiff(child);
        if (p) keys.push({ key, child: p });
      }
      if (keys.length === 0) return null;
      return { kind: "object", keys };
    }
    if (node.kind === "array") {
      const entries = [];
      node.items.forEach((child, i) => {
        const p = pruneDiff(child);
        if (p) entries.push({ index: i, child: p });
      });
      if (entries.length === 0) return null;
      return { kind: "array", entries };
    }
    return null;
  }

  function subtreeMatches(query, key, value) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (key != null && String(key).toLowerCase().includes(q)) return true;
    if (!isPlainObject(value) && !Array.isArray(value)) {
      if (value == null) return false;
      return String(value).toLowerCase().includes(q) || formatValue(value).toLowerCase().includes(q);
    }
    if (Array.isArray(value)) {
      return value.some((item, i) => subtreeMatches(query, String(i), item));
    }
    if (isPlainObject(value)) {
      return Object.keys(value).some((k) => subtreeMatches(query, k, value[k]));
    }
    return false;
  }

  function renderExploreValue(container, value, path, state) {
    const q = state.searchQuery;
    const collapsed = state.collapsed.has(path);
    const jumpHighlight = state.jumpPath && path === state.jumpPath;

    if (isPlainObject(value)) {
      const keys = Object.keys(value).sort();
      const row = document.createElement("div");
      row.className = "select-text";
      row.dataset.path = path;
      if (jumpHighlight) row.classList.add("ring-2", "ring-emerald-500", "rounded");

      const head = document.createElement("div");
      head.className =
        "flex cursor-pointer items-start gap-1 py-0.5 rounded hover:bg-zinc-200/80 dark:hover:bg-zinc-800/70";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-800 w-4 text-center text-[13px] leading-none";
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", (!collapsed).toString());
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.collapsed.has(path)) state.collapsed.delete(path);
        else state.collapsed.add(path);
        state.rerender();
      });
      const brace = document.createElement("span");
      brace.className = "text-zinc-400";
      brace.textContent = "{";
      head.appendChild(toggle);
      head.appendChild(brace);
      row.appendChild(head);

      const kids = document.createElement("div");
      kids.className = collapsed ? "hidden" : "ml-0.5 border-l border-zinc-200/70 pl-1.5";
      let any = false;
      for (const k of keys) {
        const childPath = path + "." + k;
        if (q && !subtreeMatches(q, k, value[k])) continue;
        any = true;
        const line = document.createElement("div");
        line.className = "flex flex-wrap items-baseline gap-x-1 gap-y-0.5 py-[1px]";
        const keySpan = document.createElement("span");
        keySpan.className = "font-semibold text-sky-800";
        keySpan.textContent = escapeHtml(k);
        const colon = document.createElement("span");
        colon.className = "text-zinc-400";
        colon.textContent = ":";
        line.appendChild(keySpan);
        line.appendChild(colon);
        const valWrap = document.createElement("div");
        valWrap.className = "inline min-w-0 flex-1";
        renderExploreValue(valWrap, value[k], childPath, state);
        line.appendChild(valWrap);
        kids.appendChild(line);
      }
      if (!any && q) {
        const empty = document.createElement("div");
        empty.className = "text-zinc-500 text-xs pl-1";
        empty.textContent = "(no matching children)";
        kids.appendChild(empty);
      }
      row.appendChild(kids);
      const close = document.createElement("div");
      close.className = "text-zinc-400 pl-1";
      close.textContent = "}";
      if (!collapsed) row.appendChild(close);
      container.appendChild(row);
      return;
    }

    if (Array.isArray(value)) {
      const row = document.createElement("div");
      row.className = "select-text";
      row.dataset.path = path;
      if (jumpHighlight) row.classList.add("ring-2", "ring-emerald-500", "rounded");

      const head = document.createElement("div");
      head.className =
        "flex cursor-pointer items-start gap-1 py-0.5 rounded hover:bg-zinc-200/80 dark:hover:bg-zinc-800/70";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-800 w-4 text-center text-[13px] leading-none";
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.collapsed.has(path)) state.collapsed.delete(path);
        else state.collapsed.add(path);
        state.rerender();
      });
      const br = document.createElement("span");
      br.className = "text-zinc-400";
      br.textContent = "[";
      head.appendChild(toggle);
      head.appendChild(br);
      row.appendChild(head);

      const kids = document.createElement("div");
      kids.className = collapsed ? "hidden" : "ml-0.5 border-l border-zinc-200/70 pl-1.5";
      let any = false;
      value.forEach((item, i) => {
        const childPath = path + "[" + i + "]";
        if (q && !subtreeMatches(q, String(i), item)) return;
        any = true;
        const line = document.createElement("div");
        line.className = "flex flex-wrap items-baseline gap-x-1 gap-y-0.5 py-[1px]";
        const idx = document.createElement("span");
        idx.className = "font-semibold text-violet-800 tabular-nums";
        idx.textContent = String(i);
        const colon = document.createElement("span");
        colon.className = "text-zinc-400";
        colon.textContent = ":";
        line.appendChild(idx);
        line.appendChild(colon);
        const valWrap = document.createElement("div");
        valWrap.className = "inline min-w-0 flex-1";
        renderExploreValue(valWrap, item, childPath, state);
        line.appendChild(valWrap);
        kids.appendChild(line);
      });
      if (!any && q) {
        const empty = document.createElement("div");
        empty.className = "text-zinc-500 text-xs pl-1";
        empty.textContent = "(no matching children)";
        kids.appendChild(empty);
      }
      row.appendChild(kids);
      const close = document.createElement("div");
      close.className = "text-zinc-400 pl-1";
      close.textContent = "]";
      if (!collapsed) row.appendChild(close);
      container.appendChild(row);
      return;
    }

    const span = document.createElement("span");
    span.dataset.path = path;
    // Prefer natural wrapping over breaking inside long tokens.
    span.className = "break-words text-zinc-800 dark:text-zinc-200";
    if (jumpHighlight) span.classList.add("rounded", "bg-emerald-100", "px-1");
    let text = formatValue(value);
    if (q && text.toLowerCase().includes(q.toLowerCase())) {
      span.classList.add("bg-amber-100");
    }
    span.innerHTML = escapeHtml(text);
    container.appendChild(span);
  }

  let exploreData = null;
  let exploreCollapsed = new Set();
  /** Paths for Jump to path combobox (from last parsed explore JSON). */
  let explorePathList = [];
  let pathSelectActiveIndex = -1;
  let compareLeft = null;
  let compareRight = null;
  let compareDiff = null;
  let textCompareDiff = null;
  const popupCollapsed = new Set();
  /** Pretty-print indent for Format and preview (spaces). */
  const FORMAT_JSON_INDENT = 2;

  function renderPrunedDiffNode(container, node, path) {
    if (node.kind === "added") {
      // "Added" means "missing in left". User requested: treat missing-in-one-side as "Removed".
      const el = document.createElement("div");
      el.className = "mb-2 rounded-md border border-red-200/90 bg-red-50/30 px-2.5 py-2";
      const pathLine = document.createElement("div");
      pathLine.className = "mb-1 font-mono text-xs font-semibold text-red-900";
      pathLine.textContent = diffPathTail(path);
      pathLine.title = path;
      el.appendChild(pathLine);

      const labelRow = document.createElement("div");
      labelRow.className = "break-words text-red-900";
      labelRow.innerHTML = '<span class="font-semibold text-red-700">Removed</span>';
      el.appendChild(labelRow);

      if (isPlainObject(node.right) || Array.isArray(node.right)) {
        const inner = document.createElement("div");
        inner.className = "mt-1";
        renderExploreValue(inner, node.right, path, {
          collapsed: popupCollapsed,
          searchQuery: "",
          jumpPath: null,
          rerender: rerenderInlineDiffs,
        });
        el.appendChild(inner);
      } else {
        const valueRow = document.createElement("div");
        valueRow.className = "break-words text-red-900 mt-1";
        valueRow.textContent = String(formatValue(node.right));
        el.appendChild(valueRow);
      }

      container.appendChild(el);
      return;
    }
    if (node.kind === "removed") {
      const el = document.createElement("div");
      el.className = "mb-2 rounded-md border border-red-200/90 bg-red-50/30 px-2.5 py-2";
      const pathLine = document.createElement("div");
      pathLine.className = "mb-1 font-mono text-xs font-semibold text-red-900";
      pathLine.textContent = diffPathTail(path);
      pathLine.title = path;
      el.appendChild(pathLine);

      const labelRow = document.createElement("div");
      labelRow.className = "break-words text-red-900";
      labelRow.innerHTML =
        '<span class="font-semibold text-red-700">Removed</span>';
      el.appendChild(labelRow);

      if (isPlainObject(node.left) || Array.isArray(node.left)) {
        const inner = document.createElement("div");
        inner.className = "mt-1";
        renderExploreValue(inner, node.left, path, {
          collapsed: popupCollapsed,
          searchQuery: "",
          jumpPath: null,
          rerender: rerenderInlineDiffs,
        });
        el.appendChild(inner);
      } else {
        const valueRow = document.createElement("div");
        valueRow.className = "break-words text-red-900 mt-1";
        valueRow.textContent = String(formatValue(node.left));
        el.appendChild(valueRow);
      }

      container.appendChild(el);
      return;
    }
    if (node.kind === "changed") {
      const el = document.createElement("div");
      el.className = "mb-2 rounded-md border border-amber-200/90 bg-amber-50/25 px-2.5 py-2";
      const pathLine = document.createElement("div");
      pathLine.className = "mb-1 font-mono text-xs font-semibold text-amber-900";
      pathLine.textContent = diffPathTail(path);
      pathLine.title = path;
      el.appendChild(pathLine);
      const valRow = document.createElement("div");
      valRow.className = "break-words text-sm text-amber-950";
      valRow.innerHTML =
        '<span class="font-semibold text-amber-800">Changed</span> ' +
        escapeHtml(formatValue(node.left)) +
        ' <span class="text-zinc-500">→</span> ' +
        escapeHtml(formatValue(node.right));
      el.appendChild(valRow);
      container.appendChild(el);
      return;
    }
    if (node.kind === "object") {
      const isCollapsed = popupCollapsed.has(path);
      const isRoot = path === "$";
      const wrap = document.createElement("div");
      wrap.className = isRoot ? "mb-1" : "mb-2 ml-0 border-l-2 border-zinc-200 pl-3";

      const head = document.createElement("div");
      head.className =
        "flex cursor-pointer items-center gap-1.5 rounded py-1 text-xs text-zinc-700 hover:bg-zinc-100/60";
      head.title = path;
      const t = document.createElement("button");
      t.type = "button";
      t.className = "w-5 shrink-0 text-center text-zinc-500 hover:text-zinc-900";
      t.setAttribute("aria-expanded", (!isCollapsed).toString());
      t.textContent = isCollapsed ? "▸" : "▾";
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popupCollapsed.has(path)) popupCollapsed.delete(path);
        else popupCollapsed.add(path);
        rerenderInlineDiffs();
      });
      head.addEventListener("click", (e) => {
        if (e.target === t) return;
        if (popupCollapsed.has(path)) popupCollapsed.delete(path);
        else popupCollapsed.add(path);
        rerenderInlineDiffs();
      });
      const title = document.createElement("span");
      title.className = "min-w-0 font-mono font-semibold text-zinc-800";
      title.textContent = (isRoot ? "$" : diffPathTail(path)) + " ";
      const kind = document.createElement("span");
      kind.className = "font-normal text-zinc-500";
      kind.textContent = isCollapsed ? "{ … }" : "{";
      head.appendChild(t);
      head.appendChild(title);
      head.appendChild(kind);
      wrap.appendChild(head);

      const kids = document.createElement("div");
      kids.className = isCollapsed ? "hidden" : "mt-1 space-y-2";
      for (const { key, child } of node.keys) {
        const cp = path === "$" ? "$." + key : path + "." + key;
        const row = document.createElement("div");
        row.className = "min-w-0";
        renderPrunedDiffNode(row, child, cp);
        kids.appendChild(row);
      }
      wrap.appendChild(kids);
      const objFoot = document.createElement("div");
      objFoot.className = "mt-1 pl-6 font-mono text-xs text-zinc-400";
      objFoot.textContent = "}";
      if (isCollapsed) objFoot.classList.add("hidden");
      wrap.appendChild(objFoot);
      container.appendChild(wrap);
      return;
    }
    if (node.kind === "array") {
      const isCollapsed = popupCollapsed.has(path);
      const isRoot = path === "$";
      const wrap = document.createElement("div");
      wrap.className = isRoot ? "mb-1" : "mb-2 ml-0 border-l-2 border-violet-200/80 pl-3";

      const head = document.createElement("div");
      head.className =
        "flex cursor-pointer items-center gap-1.5 rounded py-1 text-xs text-zinc-700 hover:bg-zinc-100/60";
      head.title = path;
      const t = document.createElement("button");
      t.type = "button";
      t.className = "w-5 shrink-0 text-center text-zinc-500 hover:text-zinc-900";
      t.setAttribute("aria-expanded", (!isCollapsed).toString());
      t.textContent = isCollapsed ? "▸" : "▾";
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popupCollapsed.has(path)) popupCollapsed.delete(path);
        else popupCollapsed.add(path);
        rerenderInlineDiffs();
      });
      head.addEventListener("click", (e) => {
        if (e.target === t) return;
        if (popupCollapsed.has(path)) popupCollapsed.delete(path);
        else popupCollapsed.add(path);
        rerenderInlineDiffs();
      });
      const title = document.createElement("span");
      title.className = "min-w-0 font-mono font-semibold text-zinc-800";
      title.textContent = (isRoot ? "$" : diffPathTail(path)) + " ";
      const kind = document.createElement("span");
      kind.className = "font-normal text-zinc-500";
      kind.textContent = isCollapsed ? "[ … ]" : "[";
      head.appendChild(t);
      head.appendChild(title);
      head.appendChild(kind);
      wrap.appendChild(head);

      const kids = document.createElement("div");
      kids.className = isCollapsed ? "hidden" : "mt-1 space-y-2";
      const arrayRows =
        node.entries ||
        (Array.isArray(node.items)
          ? node.items.map((child, index) => ({ index, child }))
          : []);
      arrayRows.forEach(({ index, child }) => {
        const cp = path + "[" + index + "]";
        const row = document.createElement("div");
        row.className = "min-w-0";
        renderPrunedDiffNode(row, child, cp);
        kids.appendChild(row);
      });
      wrap.appendChild(kids);
      const arrFoot = document.createElement("div");
      arrFoot.className = "mt-1 pl-6 font-mono text-xs text-zinc-400";
      arrFoot.textContent = "]";
      if (isCollapsed) arrFoot.classList.add("hidden");
      wrap.appendChild(arrFoot);
      container.appendChild(wrap);
    }
  }

  function rerenderInlineDiffs() {
    const body = $("compare-diffs-inline-body");
    if (!body) return;
    body.innerHTML = "";
    if (compareDiff === null) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Add valid JSON on both sides, then <span class="font-semibold text-emerald-600 dark:text-emerald-400">run comparison</span>. Results appear here.</p>';
      return;
    }
    const opts = getCompareFilterOptions();
    const fullPruned = pruneDiff(compareDiff);
    if (!fullPruned) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No differences — documents are equal.</p>';
      return;
    }
    if (!opts.keyChanges && !opts.valueChanges) {
      body.innerHTML =
        '<p class="py-6 text-center text-sm text-amber-800">Select <span class="font-medium">Key / property changes</span> and/or <span class="font-medium">Value changes</span> above to view results.</p>';
      return;
    }
    const filtered = filterCompareDiff(compareDiff, opts);
    const pruned = filtered ? pruneDiff(filtered) : null;
    if (!pruned) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No differences match the current filters. Try enabling both options or adjust your selection.</p>';
      return;
    }
    renderPrunedDiffNode(body, pruned, "$");
  }

  function showError(el, msg) {
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = msg;
  }

  function setTab(which) {
    const compareBtn = $("tab-compare");
    const exploreBtn = $("tab-explore");
    const textCompareBtn = $("tab-text-compare");
    const comparePanel = $("panel-compare");
    const explorePanel = $("panel-explore");
    const textComparePanel = $("panel-text-compare");
    const isCompare = which === "compare";
    const isExplore = which === "explore";
    const isTextCompare = which === "text-compare";
    compareBtn.setAttribute("aria-selected", String(isCompare));
    exploreBtn.setAttribute("aria-selected", String(isExplore));
    textCompareBtn.setAttribute("aria-selected", String(isTextCompare));
    comparePanel.classList.toggle("hidden", !isCompare);
    explorePanel.classList.toggle("hidden", !isExplore);
    textComparePanel.classList.toggle("hidden", !isTextCompare);
  }

  function rerenderExplore() {
    const root = $("tree-explore");
    root.innerHTML = "";
    if (exploreData == null) {
      root.innerHTML =
        '<p class="p-6 text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Load a file or paste JSON, then <span class="font-semibold text-emerald-600 dark:text-emerald-400">parse</span> to browse the tree.</p>';
      return;
    }
    const q = $("search-explore").value;
    const jumpPath = $("path-select").value || null;
    const state = {
      collapsed: exploreCollapsed,
      searchQuery: q,
      jumpPath,
      rerender: rerenderExplore,
    };
    renderExploreValue(root, exploreData, "$", state);
  }

  function fillPathSelect(data) {
    explorePathList = data == null ? [] : enumeratePaths(data);
    const hidden = $("path-select");
    const input = $("path-select-input");
    const keep = hidden && hidden.value ? hidden.value : "";
    if (!keep || !explorePathList.includes(keep)) {
      if (hidden) hidden.value = "";
    } else if (hidden) {
      hidden.value = keep;
    }
    if (input) input.value = (hidden && hidden.value) || "";
    closePathListbox();
  }

  function getFilteredPaths(query) {
    const q = query.trim().toLowerCase();
    if (!q) return explorePathList.slice();
    return explorePathList.filter((p) => p.toLowerCase().includes(q));
  }

  function closePathListbox() {
    const list = $("path-select-listbox");
    const input = $("path-select-input");
    if (list) {
      list.classList.add("hidden");
      list.innerHTML = "";
    }
    if (input) input.setAttribute("aria-expanded", "false");
    pathSelectActiveIndex = -1;
  }

  function openPathListbox() {
    const list = $("path-select-listbox");
    const input = $("path-select-input");
    if (!list || !input || explorePathList.length === 0) return;
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function updatePathListHighlight(items) {
    if (!items || !items.length) return;
    items.forEach((el, i) => {
      const on = i === pathSelectActiveIndex;
      el.classList.toggle("bg-emerald-50", on);
      el.classList.toggle("dark:bg-emerald-950/50", on);
      el.classList.toggle("font-medium", on);
      el.classList.toggle("text-emerald-900", on);
      el.classList.toggle("dark:text-emerald-300", on);
      el.classList.toggle("text-zinc-700", !on);
      el.classList.toggle("dark:text-zinc-300", !on);
      el.setAttribute("aria-selected", String(on));
    });
  }

  function renderPathListOptions(filtered) {
    const list = $("path-select-listbox");
    if (!list) return;
    list.innerHTML = "";
    pathSelectActiveIndex = filtered.length ? 0 : -1;
    filtered.forEach((p, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === pathSelectActiveIndex));
      li.dataset.path = p;
      li.className =
        "cursor-pointer rounded-lg px-3 py-2 font-mono text-xs leading-snug text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 " +
        (i === pathSelectActiveIndex
          ? "bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "");
      li.textContent = p;
      li.addEventListener("mouseenter", () => {
        pathSelectActiveIndex = i;
        updatePathListHighlight(list.querySelectorAll("[role='option']"));
      });
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commitJumpPath(p);
      });
      list.appendChild(li);
    });
  }

  function applyJumpPathFromSelect() {
    const v = $("path-select").value;
    if (!v) {
      rerenderExplore();
      return;
    }
    const prefixes = pathPrefixes(v);
    prefixes.forEach((p) => exploreCollapsed.delete(p));
    rerenderExplore();
    requestAnimationFrame(() => {
      const root = $("tree-explore");
      const esc =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(v)
          : v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const target = root.querySelector("[data-path=\"" + esc + "\"]");
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function commitJumpPath(path) {
    const hidden = $("path-select");
    const input = $("path-select-input");
    if (hidden) hidden.value = path;
    if (input) input.value = path;
    closePathListbox();
    applyJumpPathFromSelect();
  }

  function initPathSelectCombo() {
    const wrap = $("path-select-wrap");
    const input = $("path-select-input");
    const list = $("path-select-listbox");
    if (!wrap || !input || !list) return;

    const refreshListFromInput = () => {
      const filtered = getFilteredPaths(input.value);
      renderPathListOptions(filtered);
      if (filtered.length) openPathListbox();
      else closePathListbox();
    };

    input.addEventListener("input", () => {
      refreshListFromInput();
    });

    input.addEventListener("focus", () => {
      if (explorePathList.length === 0) return;
      const filtered = getFilteredPaths(input.value);
      renderPathListOptions(filtered);
      if (filtered.length) openPathListbox();
    });

    input.addEventListener("keydown", (e) => {
      const items = list.querySelectorAll("[role='option']");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.classList.contains("hidden")) {
          refreshListFromInput();
          return;
        }
        if (!items.length) return;
        pathSelectActiveIndex = Math.min(pathSelectActiveIndex + 1, items.length - 1);
        updatePathListHighlight(items);
        items[pathSelectActiveIndex].scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (list.classList.contains("hidden")) {
          refreshListFromInput();
          return;
        }
        if (!items.length) return;
        pathSelectActiveIndex = Math.max(pathSelectActiveIndex - 1, 0);
        updatePathListHighlight(items);
        items[pathSelectActiveIndex].scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        if (!list.classList.contains("hidden") && items.length && pathSelectActiveIndex >= 0) {
          e.preventDefault();
          const p = items[pathSelectActiveIndex].dataset.path;
          if (p) commitJumpPath(p);
        }
        return;
      }
      if (e.key === "Escape") {
        if (!list.classList.contains("hidden")) {
          e.preventDefault();
          closePathListbox();
          input.value = $("path-select").value || "";
        }
      }
    });

    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!wrap.contains(document.activeElement)) {
          const hidden = $("path-select");
          const q = input.value.trim();
          if (!q) {
            if (hidden) hidden.value = "";
            applyJumpPathFromSelect();
            return;
          }
          if (explorePathList.includes(q)) {
            if (hidden) hidden.value = q;
            applyJumpPathFromSelect();
            return;
          }
          const exactCi = explorePathList.find((p) => p.toLowerCase() === q.toLowerCase());
          if (exactCi) {
            if (hidden) hidden.value = exactCi;
            input.value = exactCi;
            applyJumpPathFromSelect();
            return;
          }
          input.value = hidden.value || "";
        }
      }, 120);
    });

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) closePathListbox();
    });
  }

  function rerenderCompare() {
    rerenderInlineDiffs();
  }

  function getTextCompareOptions() {
    const caseSensitiveEl = $("text-compare-case-sensitive");
    const ignoreWhitespaceEl = $("text-compare-ignore-whitespace");
    return {
      caseSensitive: !caseSensitiveEl || caseSensitiveEl.checked,
      ignoreWhitespace: !!(ignoreWhitespaceEl && ignoreWhitespaceEl.checked),
    };
  }

  function getTextCompareDiffOnly() {
    const el = $("text-compare-diff-only");
    return !el || el.checked;
  }

  function normalizeTextCompareLine(line, opts) {
    let out = String(line);
    if (opts.ignoreWhitespace) out = out.replace(/\s+/g, "");
    if (!opts.caseSensitive) out = out.toLowerCase();
    return out;
  }

  function splitTextCompareLines(text) {
    const normalized = String(text || "").replace(/\r\n?/g, "\n");
    return normalized === "" ? [] : normalized.split("\n");
  }

  function flushTextCompareRuns(out, removedRun, addedRun) {
    const pairCount = Math.min(removedRun.length, addedRun.length);
    for (let i = 0; i < pairCount; i++) {
      out.push({
        type: "changed",
        left: removedRun[i].left,
        right: addedRun[i].right,
        leftLine: removedRun[i].leftLine,
        rightLine: addedRun[i].rightLine,
      });
    }
    for (let i = pairCount; i < removedRun.length; i++) out.push(removedRun[i]);
    for (let i = pairCount; i < addedRun.length; i++) out.push(addedRun[i]);
  }

  function computeTextCompareDiff(leftText, rightText, opts) {
    const leftLines = splitTextCompareLines(leftText);
    const rightLines = splitTextCompareLines(rightText);
    const leftNorm = leftLines.map((line) => normalizeTextCompareLine(line, opts));
    const rightNorm = rightLines.map((line) => normalizeTextCompareLine(line, opts));
    const m = leftNorm.length;
    const n = rightNorm.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (leftNorm[i] === rightNorm[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const rawRows = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (leftNorm[i] === rightNorm[j]) {
        rawRows.push({
          type: "same",
          left: leftLines[i],
          right: rightLines[j],
          leftLine: i + 1,
          rightLine: j + 1,
        });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        rawRows.push({
          type: "removed",
          left: leftLines[i],
          right: "",
          leftLine: i + 1,
          rightLine: null,
        });
        i++;
      } else {
        rawRows.push({
          type: "added",
          left: "",
          right: rightLines[j],
          leftLine: null,
          rightLine: j + 1,
        });
        j++;
      }
    }
    while (i < m) {
      rawRows.push({
        type: "removed",
        left: leftLines[i],
        right: "",
        leftLine: i + 1,
        rightLine: null,
      });
      i++;
    }
    while (j < n) {
      rawRows.push({
        type: "added",
        left: "",
        right: rightLines[j],
        leftLine: null,
        rightLine: j + 1,
      });
      j++;
    }

    const rows = [];
    let removedRun = [];
    let addedRun = [];
    for (const row of rawRows) {
      if (row.type === "removed") {
        removedRun.push(row);
        continue;
      }
      if (row.type === "added") {
        addedRun.push(row);
        continue;
      }
      if (removedRun.length || addedRun.length) {
        flushTextCompareRuns(rows, removedRun, addedRun);
        removedRun = [];
        addedRun = [];
      }
      rows.push(row);
    }
    if (removedRun.length || addedRun.length) {
      flushTextCompareRuns(rows, removedRun, addedRun);
    }

    const summary = { same: 0, changed: 0, added: 0, removed: 0, total: rows.length };
    for (const row of rows) {
      if (row.type === "same") summary.same++;
      else if (row.type === "changed") summary.changed++;
      else if (row.type === "added") summary.added++;
      else if (row.type === "removed") summary.removed++;
    }

    return { rows, summary, leftCount: leftLines.length, rightCount: rightLines.length, opts };
  }

  function updateTextCompareCTA() {
    const btn = $("btn-text-compare-now");
    const leftEl = $("paste-text-left");
    const rightEl = $("paste-text-right");
    const leftText = leftEl ? leftEl.value : "";
    const rightText = rightEl ? rightEl.value : "";
    const ready = leftText.trim() !== "" && rightText.trim() !== "";
    if (btn) btn.disabled = !ready;
    const statusEl = $("text-compare-status");
    if (!statusEl) return;
    if (!leftText.trim() && !rightText.trim()) statusEl.textContent = "Paste or upload text on both sides to begin.";
    else if (!leftText.trim()) statusEl.textContent = "Left text is empty.";
    else if (!rightText.trim()) statusEl.textContent = "Right text is empty.";
    else if (!textCompareDiff) statusEl.textContent = "Ready to compare.";
  }

  function renderTextCompareResults() {
    const body = $("text-compare-results");
    if (!body) return;
    if (!textCompareDiff) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Run a text comparison to see line-by-line differences.</p>';
      return;
    }
    if (!textCompareDiff.rows.some((row) => row.type !== "same")) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm text-emerald-700 dark:text-emerald-300">The files match with the current options.</p>';
      return;
    }

    const diffOnly = getTextCompareDiffOnly();
    const rowsToRender = diffOnly
      ? textCompareDiff.rows.filter((row) => row.type !== "same")
      : textCompareDiff.rows;
    if (rowsToRender.length === 0) {
      body.innerHTML =
        '<p class="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Nothing to show for this view.</p>';
      return;
    }

    body.innerHTML = rowsToRender
      .map((row) => {
        const tone =
          row.type === "same"
            ? "bg-white dark:bg-transparent"
            : row.type === "changed"
              ? "bg-amber-50/80 dark:bg-amber-950/20"
              : row.type === "added"
                ? "bg-emerald-50/70 dark:bg-emerald-950/20"
                : "bg-red-50/70 dark:bg-red-950/20";
        const leftText =
          row.leftLine == null
            ? '<span class="text-zinc-400">∅</span>'
            : escapeHtml(row.left === "" ? " " : row.left);
        const rightText =
          row.rightLine == null
            ? '<span class="text-zinc-400">∅</span>'
            : escapeHtml(row.right === "" ? " " : row.right);
        const badge =
          row.type === "changed"
            ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">Changed</span>'
            : row.type === "added"
              ? '<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">Added</span>'
              : row.type === "removed"
                ? '<span class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/70 dark:text-red-300">Removed</span>'
                : '<span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Same</span>';
        return (
          '<div class="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-zinc-200/70 px-3 py-2 last:border-b-0 dark:border-zinc-800 ' +
          tone +
          '">' +
          '<div class="w-10 text-right text-xs text-zinc-400">' +
          (row.leftLine == null ? "" : row.leftLine) +
          "</div>" +
          '<pre class="min-w-0 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-100">' +
          leftText +
          "</pre>" +
          '<div class="w-10 text-right text-xs text-zinc-400">' +
          (row.rightLine == null ? "" : row.rightLine) +
          "</div>" +
          '<pre class="min-w-0 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-100">' +
          rightText +
          "</pre>" +
          '<div class="justify-self-end">' +
          badge +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function rerenderTextCompare() {
    renderTextCompareResults();
  }

  function compareTextNow() {
    const leftText = $("paste-text-left").value;
    const rightText = $("paste-text-right").value;
    if (!leftText.trim() || !rightText.trim()) {
      textCompareDiff = null;
      updateTextCompareCTA();
      rerenderTextCompare();
      return;
    }
    textCompareDiff = computeTextCompareDiff(leftText, rightText, getTextCompareOptions());
    rerenderTextCompare();
    const statusEl = $("text-compare-status");
    if (!statusEl) return;
    const s = textCompareDiff.summary;
    if (s.changed === 0 && s.added === 0 && s.removed === 0) {
      statusEl.textContent = "No differences found with the current options.";
      return;
    }
    statusEl.textContent =
      s.changed +
      " changed, " +
      s.added +
      " added, " +
      s.removed +
      " removed across " +
      Math.max(textCompareDiff.leftCount, textCompareDiff.rightCount) +
      " lines.";
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function tryParseJson(text, errEl) {
    try {
      showError(errEl, "");
      return JSON.parse(text);
    } catch (e) {
      showError(errEl, e.message || "Invalid JSON");
      return null;
    }
  }

  function bindJsonDropZone(el, onDropFile) {
    if (!el) return;
    el.addEventListener("dragenter", (e) => {
      e.preventDefault();
      el.classList.add("drop-zone-active");
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drop-zone-active");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drop-zone-active");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onDropFile(f);
    });
  }

  async function ingestCompareSideFromFile(side, file) {
    if (!file) return;
    showError($("compare-error"), "");
    try {
      const text = await readFileAsText(file);
      const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
      ta.value = text;
      compareDiff = null;
      const parsed = parseJsonDetailed(text.trim());
      if (parsed.error) {
        if (side === "left") {
          compareLeft = null;
          setValidate("left", false, "❌ " + parsed.error);
        } else {
          compareRight = null;
          setValidate("right", false, "❌ " + parsed.error);
        }
      } else {
        if (side === "left") {
          compareLeft = parsed.value;
          setValidate("left", true, "✔ Valid JSON");
        } else {
          compareRight = parsed.value;
          setValidate("right", true, "✔ Valid JSON");
        }
      }
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    } catch (err) {
      setValidate(side, false, "❌ " + String(err.message || err));
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    }
  }

  async function ingestExploreFromFile(file) {
    if (!file) return;
    showError($("explore-error"), "");
    try {
      const text = await readFileAsText(file);
      const data = tryParseJson(text, $("explore-error"));
      if (!data) return;
      exploreData = data;
      exploreCollapsed = new Set();
      fillPathSelect(data);
      $("paste-explore").value = text;
      rerenderExplore();
    } catch (err) {
      showError($("explore-error"), String(err.message || err));
    }
  }

  function initThemeToggle() {
    const btn = $("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const root = document.documentElement;
      const next = !root.classList.contains("dark");
      root.classList.toggle("dark", next);
      try {
        localStorage.setItem("ji-theme", next ? "dark" : "light");
      } catch (e) {}
    });
  }

  $("tab-compare").addEventListener("click", () => setTab("compare"));
  $("tab-explore").addEventListener("click", () => setTab("explore"));
  $("tab-text-compare").addEventListener("click", () => setTab("text-compare"));

  $("file-explore").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    await ingestExploreFromFile(f);
    input.value = "";
  });

  $("btn-parse-paste").addEventListener("click", () => {
    const text = $("paste-explore").value.trim();
    if (!text) {
      showError($("explore-error"), "Paste JSON first.");
      return;
    }
    const data = tryParseJson(text, $("explore-error"));
    if (!data) return;
    exploreData = data;
    exploreCollapsed = new Set();
    fillPathSelect(data);
    rerenderExplore();
  });

  $("search-explore").addEventListener("input", () => rerenderExplore());

  initPathSelectCombo();

  function posToLineCol(text, pos) {
    let line = 1;
    let col = 1;
    const upto = Math.max(0, Math.min(pos, text.length));
    for (let i = 0; i < upto; i++) {
      if (text[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, col };
  }

  function parseJsonDetailed(text) {
    try {
      return { value: JSON.parse(text), error: null };
    } catch (e) {
      const msg = e && e.message ? e.message : "Invalid JSON";
      // V8-style: "... at position 123"
      const m = msg.match(/position\s+(\d+)/i) || msg.match(/at\s+position\s+(\d+)/i) || msg.match(/char\s+(\d+)/i);
      if (m) {
        const pos = Number(m[1]);
        if (Number.isFinite(pos)) {
          const { line, col } = posToLineCol(text, pos);
          const cleaned = msg
            .replace(/at\s+position\s+\d+/i, "")
            .replace(/position\s+\d+/i, "")
            .trim();
          const base = cleaned || "Invalid JSON";
          return { value: null, error: base + " (line " + line + ", col " + col + ")" };
        }
      }
      return { value: null, error: msg };
    }
  }

  function refreshLineGutter(ta, gutter) {
    if (!ta || !gutter) return;
    const raw = ta.value || "";
    const n = raw === "" ? 1 : raw.split("\n").length;
    const lines = [];
    for (let i = 1; i <= n; i++) lines.push(String(i));
    gutter.textContent = lines.join("\n");
  }

  function refreshCompareLineGutters() {
    refreshLineGutter($("paste-compare-left"), $("gutter-compare-left"));
    refreshLineGutter($("paste-compare-right"), $("gutter-compare-right"));
  }

  function bindEditorGutter(taId, gutterId) {
    const ta = $(taId);
    const gutter = $(gutterId);
    if (!ta || !gutter) return;
    const onScroll = () => {
      gutter.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("scroll", onScroll, { passive: true });
    ta.addEventListener("input", () => refreshLineGutter(ta, gutter));
    refreshLineGutter(ta, gutter);
  }

  function applyFormatCompareSide(side) {
    const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
    const text = (ta.value || "").trim();
    if (!text) return;
    const parsed = parseJsonDetailed(text);
    if (parsed.error) return setValidate(side, false, "❌ " + parsed.error);
    ta.value = JSON.stringify(parsed.value, null, FORMAT_JSON_INDENT);
    if (side === "left") compareLeft = parsed.value;
    else compareRight = parsed.value;
    compareDiff = null;
    setValidate(side, true, "✔ Valid JSON");
    updateCompareCTA();
    rerenderCompare();
    refreshCompareLineGutters();
  }

  function copyCompareTextarea(side) {
    const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
    const t = ta.value || "";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch(() => {});
    }
  }

  async function pasteIntoCompare(side) {
    const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
    if (!ta || !navigator.clipboard || !navigator.clipboard.readText) {
      showError($("compare-error"), "Clipboard paste is not available.");
      return;
    }
    showError($("compare-error"), "");
    try {
      const clip = await navigator.clipboard.readText();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + clip + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + clip.length;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (err) {
      showError(
        $("compare-error"),
        String(err && err.message ? err.message : "Could not paste from clipboard."),
      );
    }
  }

  function cutFromCompare(side) {
    const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const slice = ta.value.slice(start, end);
    if (!slice) return;
    showError($("compare-error"), "");
    const apply = () => {
      ta.value = ta.value.slice(0, start) + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(slice).then(apply).catch(apply);
    } else {
      apply();
    }
  }

  function openPreviewRight() {
    const overlay = $("modal-preview-overlay");
    const body = $("modal-preview-body");
    if (!overlay || !body) return;
    const ta = $("paste-compare-right");
    const text = ta && ta.value ? ta.value.trim() : "";
    if (!text) {
      body.textContent = "(empty editor)";
    } else {
      const parsed = parseJsonDetailed(text);
      if (parsed.error) {
        body.textContent = parsed.error;
      } else {
        body.textContent = JSON.stringify(parsed.value, null, FORMAT_JSON_INDENT);
      }
    }
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closePreviewModal() {
    const overlay = $("modal-preview-overlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  const jsonTreeModalCollapsed = new Set();
  const SVG_NS = "http://www.w3.org/2000/svg";

  function renderScalarValueHtml(v) {
    if (v === null) return '<span class="text-zinc-500">null</span>';
    if (typeof v === "boolean")
      return '<span class="font-medium text-sky-700">' + escapeHtml(String(v)) + "</span>";
    if (typeof v === "number")
      return '<span class="font-medium text-red-600">' + escapeHtml(String(v)) + "</span>";
    return '<span class="text-zinc-900">' + escapeHtml(JSON.stringify(v)) + "</span>";
  }

  function partitionObject(obj) {
    const scalars = [];
    const nested = [];
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (v !== null && typeof v === "object") nested.push([k, v]);
      else scalars.push([k, v]);
    }
    return { scalars, nested };
  }

  function renderJsonGraphArray(container, arr, path, state) {
    if (arr.length === 0) {
      const el = document.createElement("div");
      el.className =
        "g-leaf shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-500 shadow-sm";
      el.textContent = "[ ]";
      container.appendChild(el);
      return;
    }
    arr.forEach((item, i) => {
      const cp = path + "[" + i + "]";
      const wrap = document.createElement("div");
      wrap.className = "g-array-item flex flex-row items-stretch gap-0";
      renderJsonGraph(wrap, item, cp, state);
      container.appendChild(wrap);
    });
  }

  function renderJsonGraphObject(container, obj, path, state) {
    const { scalars, nested } = partitionObject(obj);
    const row = document.createElement("div");
    row.className = "g-row flex flex-row items-stretch gap-0";

    const left = document.createElement("div");
    left.className = "g-left flex shrink-0 flex-col justify-center";
    const objBox = document.createElement("div");
    objBox.className =
      "g-object max-w-[min(100vw-6rem,22rem)] rounded border border-zinc-400 bg-white px-2.5 py-2 text-left text-xs shadow-sm sm:text-sm";
    if (scalars.length === 0) {
      objBox.innerHTML = '<span class="text-zinc-400">{ }</span>';
    } else {
      objBox.innerHTML = scalars
        .map(
          ([k, v]) =>
            '<div class="leading-snug"><span class="font-semibold text-indigo-800">' +
            escapeHtml(k) +
            '</span><span class="text-zinc-400">:</span> ' +
            renderScalarValueHtml(v) +
            "</div>",
        )
        .join("");
    }
    left.appendChild(objBox);
    row.appendChild(left);

    if (nested.length === 0) {
      container.appendChild(row);
      return;
    }

    const bridge = document.createElement("div");
    bridge.className = "g-bridge relative w-12 shrink-0 self-stretch min-h-[2rem] sm:w-14";
    bridge.dataset.graphBridge = "1";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "graph-svg pointer-events-none absolute inset-0 h-full w-full overflow-visible");
    bridge.appendChild(svg);
    row.appendChild(bridge);

    const right = document.createElement("div");
    right.className = "g-right flex flex-col justify-center gap-6 py-1";
    for (const [k, v] of nested) {
      const nr = document.createElement("div");
      nr.className = "g-nested-row flex flex-row items-stretch gap-0";
      const juncCell = document.createElement("div");
      juncCell.className = "g-junction-cell flex shrink-0 flex-col justify-center py-1";
      const childPath = path === "$" ? "$." + k : path + "." + k;
      const collapsed = state.collapsed.has(childPath);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "g-junction flex max-w-[10rem] items-center gap-1 rounded border border-zinc-500 bg-zinc-200/95 px-2 py-1 text-left text-xs font-semibold text-zinc-900 shadow-sm hover:bg-zinc-300/90";
      btn.setAttribute("aria-expanded", (!collapsed).toString());
      btn.innerHTML =
        "<span class='min-w-0 truncate'>" +
        escapeHtml(k) +
        "</span><svg class='h-3.5 w-3.5 shrink-0 text-zinc-600' fill='none' stroke='currentColor' viewBox='0 0 24 24' aria-hidden='true'><path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'/></svg>";
      btn.addEventListener("click", () => {
        if (state.collapsed.has(childPath)) state.collapsed.delete(childPath);
        else state.collapsed.add(childPath);
        state.rerender();
      });
      juncCell.appendChild(btn);
      nr.appendChild(juncCell);

      if (!collapsed) {
        const b2 = document.createElement("div");
        b2.className = "g-bridge relative w-10 shrink-0 self-stretch min-h-[2rem] sm:w-12";
        b2.dataset.graphBridge = "1";
        const svg2 = document.createElementNS(SVG_NS, "svg");
        svg2.setAttribute(
          "class",
          "graph-svg pointer-events-none absolute inset-0 h-full w-full overflow-visible",
        );
        b2.appendChild(svg2);
        nr.appendChild(b2);
        const sub = document.createElement("div");
        sub.className = "g-subtree flex min-w-0 flex-1 flex-col gap-3";
        renderJsonGraph(sub, v, childPath, state);
        nr.appendChild(sub);
      }
      right.appendChild(nr);
    }
    row.appendChild(right);
    container.appendChild(row);
  }

  function renderJsonGraph(container, value, path, state) {
    if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        renderJsonGraphArray(container, value, path, state);
        return;
      }
      renderJsonGraphObject(container, value, path, state);
      return;
    }
    const leaf = document.createElement("div");
    leaf.className =
      "g-leaf shrink-0 rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs shadow-sm sm:text-sm";
    leaf.innerHTML = renderScalarValueHtml(value);
    container.appendChild(leaf);
  }

  function drawGraphBridges(scroller) {
    if (!scroller) return;
    scroller.querySelectorAll("[data-graph-bridge]").forEach((bridge) => {
      const svg = bridge.querySelector(".graph-svg");
      if (!svg) return;
      const left = bridge.previousElementSibling;
      const right = bridge.nextElementSibling;
      if (!left || !right) {
        svg.innerHTML = "";
        return;
      }

      const br = bridge.getBoundingClientRect();
      let w = Math.max(br.width, 40);
      let h = Math.max(br.height, 24);
      bridge.style.width = w + "px";
      const br2 = bridge.getBoundingClientRect();
      w = Math.max(br2.width, 40);
      h = Math.max(br2.height, 24);

      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      svg.innerHTML = "";

      const stroke = "#94a3b8";
      const sw = 1.75;

      function addCurve(x0, y0, x1, y1) {
        const c1x = x0 + (x1 - x0) * 0.45;
        const c2x = x0 + (x1 - x0) * 0.55;
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute(
          "d",
          "M " + x0 + " " + y0 + " C " + c1x + " " + y0 + " " + c2x + " " + y1 + " " + x1 + " " + y1,
        );
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", stroke);
        p.setAttribute("stroke-width", String(sw));
        p.setAttribute("stroke-linecap", "round");
        svg.appendChild(p);
      }

      const brFinal = bridge.getBoundingClientRect();

      let sourceEl = left.querySelector(".g-object, .g-junction");
      if (!sourceEl) sourceEl = left;

      const collectTargets = () => {
        const out = [];
        if (right.classList.contains("g-right")) {
          right.querySelectorAll(":scope > .g-nested-row").forEach((nr) => {
            const j = nr.querySelector(":scope > .g-junction-cell .g-junction");
            if (j) out.push(j);
          });
          return out;
        }
        if (right.classList.contains("g-subtree")) {
          right.querySelectorAll(":scope > .g-array-item").forEach((ai) => {
            const t = ai.querySelector(".g-object, .g-leaf, .g-row");
            if (t) out.push(t);
          });
          const direct = right.querySelectorAll(":scope > .g-leaf, :scope > .g-row");
          direct.forEach((el) => out.push(el));
          return out;
        }
        if (right.classList.contains("g-leaf") || right.classList.contains("g-row")) {
          out.push(right);
        }
        return out;
      };

      const targets = collectTargets();
      if (targets.length === 0) {
        const rr = right.getBoundingClientRect();
        const sx = 0;
        const sy = Math.max(
          0,
          Math.min(h, sourceEl.getBoundingClientRect().top + sourceEl.getBoundingClientRect().height / 2 - brFinal.top),
        );
        const ex = w;
        const ey = Math.max(0, Math.min(h, rr.top + rr.height / 2 - brFinal.top));
        addCurve(sx, sy, ex, ey);
        return;
      }

      const sr = sourceEl.getBoundingClientRect();
      const sx = 0;
      const sy = Math.max(
        0,
        Math.min(h, sr.top + sr.height / 2 - brFinal.top),
      );
      targets.forEach((te) => {
        const tr = te.getBoundingClientRect();
        const ex = w;
        const ey = Math.max(0, Math.min(h, tr.top + tr.height / 2 - brFinal.top));
        addCurve(sx, sy, ex, ey);
      });
    });
  }

  let jsonGraphResizeObserver = null;
  let jsonGraphScrollCleanup = null;
  let jsonGraphTransform = { scale: 1, rotate: 0 };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function updateJsonGraphControlsUI() {
    const label = $("graph-zoom-label");
    if (!label) return;
    label.textContent = Math.round(jsonGraphTransform.scale * 100) + "%";
  }

  function applyJsonGraphTransform(stage, inner) {
    if (!stage || !inner) return;
    const s = clamp(jsonGraphTransform.scale, 0.5, 2.5);
    const rot = ((jsonGraphTransform.rotate % 360) + 360) % 360;
    jsonGraphTransform = { scale: s, rotate: rot };

    const sw = Math.max(1, inner.scrollWidth);
    const sh = Math.max(1, inner.scrollHeight);

    let tx = 0;
    let ty = 0;
    if (rot === 90) tx = sh * s;
    else if (rot === 180) {
      tx = sw * s;
      ty = sh * s;
    } else if (rot === 270) ty = sw * s;

    inner.style.transformOrigin = "top left";
    inner.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${s})`;

    const w = (rot === 90 || rot === 270 ? sh : sw) * s;
    const h = (rot === 90 || rot === 270 ? sw : sh) * s;
    stage.style.width = Math.ceil(w) + "px";
    stage.style.height = Math.ceil(h) + "px";

    updateJsonGraphControlsUI();
  }

  function renderJsonTreeModalContent(data) {
    const body = $("modal-json-tree-body");
    if (!body || data == null) return;
    if (jsonGraphResizeObserver) {
      jsonGraphResizeObserver.disconnect();
      jsonGraphResizeObserver = null;
    }
    if (jsonGraphScrollCleanup) {
      jsonGraphScrollCleanup();
      jsonGraphScrollCleanup = null;
    }
    body.innerHTML = "";
    const stage = document.createElement("div");
    stage.id = "json-graph-stage";
    stage.className = "relative inline-block min-w-min";
    body.appendChild(stage);
    const inner = document.createElement("div");
    inner.className = "json-graph-root flex min-w-min flex-col gap-3 p-1";
    stage.appendChild(inner);
    const state = {
      collapsed: jsonTreeModalCollapsed,
      rerender: () => {
        renderJsonTreeModalContent(data);
      },
    };
    renderJsonGraph(inner, data, "$", state);
    applyJsonGraphTransform(stage, inner);
    const runDraw = () => drawGraphBridges(body);
    requestAnimationFrame(() => {
      runDraw();
      requestAnimationFrame(runDraw);
    });
    jsonGraphResizeObserver = new ResizeObserver(runDraw);
    jsonGraphResizeObserver.observe(body);
    jsonGraphResizeObserver.observe(inner);
    const onScroll = () => runDraw();
    body.addEventListener("scroll", onScroll, { passive: true });
    jsonGraphScrollCleanup = () => body.removeEventListener("scroll", onScroll);
  }

  function onJsonTreeModalEscape(e) {
    if (e.key === "Escape") closeJsonTreeModal();
  }

  function openJsonTreeModal(data, titleText) {
    const overlay = $("modal-json-tree-overlay");
    const titleEl = $("modal-json-tree-title");
    if (!overlay || !titleEl) return;
    titleEl.textContent = titleText;
    jsonTreeModalCollapsed.clear();
    jsonGraphTransform = { scale: 1, rotate: 0 };
    updateJsonGraphControlsUI();
    renderJsonTreeModalContent(data);
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    const closeBtn = $("modal-json-tree-close");
    if (closeBtn) closeBtn.focus();
    document.addEventListener("keydown", onJsonTreeModalEscape);
  }

  function closeJsonTreeModal() {
    const overlay = $("modal-json-tree-overlay");
    if (!overlay) return;
    if (jsonGraphResizeObserver) {
      jsonGraphResizeObserver.disconnect();
      jsonGraphResizeObserver = null;
    }
    if (jsonGraphScrollCleanup) {
      jsonGraphScrollCleanup();
      jsonGraphScrollCleanup = null;
    }
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onJsonTreeModalEscape);
  }

  function withJsonGraphStage(cb) {
    const body = $("modal-json-tree-body");
    if (!body) return;
    const stage = $("json-graph-stage") || body.querySelector("#json-graph-stage");
    const inner = stage ? stage.querySelector(".json-graph-root") : null;
    if (!stage || !inner) return;
    cb(stage, inner, body);
  }

  function graphZoomBy(delta) {
    withJsonGraphStage((stage, inner, body) => {
      const next = clamp(Math.round((jsonGraphTransform.scale + delta) * 10) / 10, 0.5, 2.5);
      jsonGraphTransform.scale = next;
      applyJsonGraphTransform(stage, inner);
      drawGraphBridges(body);
    });
  }

  function graphRotateBy(deltaDeg) {
    withJsonGraphStage((stage, inner, body) => {
      jsonGraphTransform.rotate = (((jsonGraphTransform.rotate + deltaDeg) % 360) + 360) % 360;
      applyJsonGraphTransform(stage, inner);
      drawGraphBridges(body);
    });
  }

  function graphResetView() {
    withJsonGraphStage((stage, inner, body) => {
      jsonGraphTransform = { scale: 1, rotate: 0 };
      applyJsonGraphTransform(stage, inner);
      drawGraphBridges(body);
    });
  }

  function openCompareJsonTreeViewer(side) {
    const data = side === "left" ? compareLeft : compareRight;
    if (data == null) {
      showError(
        $("compare-error"),
        (side === "left" ? "Left" : "Right") + " JSON must be valid before opening the graph viewer.",
      );
      return;
    }
    showError($("compare-error"), "");
    openJsonTreeModal(
      data,
      side === "left" ? "Graph map — First JSON (Left)" : "Graph map — Second JSON (Right)",
    );
  }

  function openExploreJsonTreeViewer() {
    if (exploreData == null) {
      showError($("explore-error"), "Load or parse JSON first to open the graph viewer.");
      return;
    }
    showError($("explore-error"), "");
    openJsonTreeModal(exploreData, "Graph map — Search & traverse");
  }

  function downloadCompareRight() {
    const ta = $("paste-compare-right");
    const text = ta && ta.value ? ta.value : "";
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "json-intelligence-right.json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function setValidate(side, ok, message) {
    const elId = side === "left" ? "validate-compare-left" : "validate-compare-right";
    const el = $(elId);
    if (!el) return;
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.classList.toggle("text-red-700", !ok);
    el.classList.toggle("text-emerald-700", !!ok);
    el.textContent = message;
  }

  function updateCompareCTA() {
    const btn = $("btn-compare-now");
    if (!btn) return;
    const ready = compareLeft != null && compareRight != null;
    btn.disabled = !ready;
    const statusEl = $("compare-status");
    if (statusEl) {
      if (!compareLeft && !compareRight) statusEl.textContent = "Paste or upload JSON on both sides to begin.";
      else if (!compareLeft) statusEl.textContent = "Left JSON needs fixing.";
      else if (!compareRight) statusEl.textContent = "Right JSON needs fixing.";
      else statusEl.textContent = "Ready — run comparison.";
    }
  }

  function compareNow() {
    showError($("compare-error"), "");
    if (compareLeft == null || compareRight == null) {
      showError($("compare-error"), "Both Left and Right must be valid JSON.");
      return;
    }
    compareDiff = diffValue(compareLeft, compareRight);
    popupCollapsed.clear();
    rerenderCompare();

    const statusEl = $("compare-status");
    if (statusEl) {
      const full = summarizeDiffCounts(compareDiff);
      const opts = getCompareFilterOptions();
      if (full.total === 0) {
        statusEl.textContent = "No differences found.";
      } else if (!opts.keyChanges && !opts.valueChanges) {
        statusEl.textContent =
          full.total +
          " changes in document — enable Key and/or Value filters below to view them.";
      } else {
        const filtered = filterCompareDiff(compareDiff, opts);
        const shown = summarizeDiffCounts(filtered);
        if (shown.total === 0) {
          statusEl.textContent =
            full.total +
            " changes in document — none match the current filters.";
        } else if (shown.total === full.total) {
          statusEl.textContent =
            shown.total + " changes found — " + formatChangeBreakdown(shown) + ".";
        } else {
          statusEl.textContent =
            shown.total +
            " of " +
            full.total +
            " shown — " +
            formatChangeBreakdown(shown) +
            ".";
        }
      }
    }
  }

  $("btn-compare-now").addEventListener("click", () => compareNow());
  $("btn-text-compare-now").addEventListener("click", () => compareTextNow());

  function onCompareFilterChange() {
    if (compareDiff === null) return;
    rerenderInlineDiffs();
    const statusEl = $("compare-status");
    if (!statusEl) return;
    const full = summarizeDiffCounts(compareDiff);
    const opts = getCompareFilterOptions();
    if (full.total === 0) {
      statusEl.textContent = "No differences found.";
      return;
    }
    if (!opts.keyChanges && !opts.valueChanges) {
      statusEl.textContent =
        full.total +
        " changes in document — enable Key and/or Value filters below to view them.";
      return;
    }
    const filtered = filterCompareDiff(compareDiff, opts);
    const shown = summarizeDiffCounts(filtered);
    if (shown.total === 0) {
      statusEl.textContent =
        full.total + " changes in document — none match the current filters.";
    } else if (shown.total === full.total) {
      statusEl.textContent =
        shown.total + " changes found — " + formatChangeBreakdown(shown) + ".";
    } else {
      statusEl.textContent =
        shown.total +
        " of " +
        full.total +
        " shown — " +
        formatChangeBreakdown(shown) +
        ".";
    }
  }

  const optKeys = $("compare-opt-keys");
  const optVals = $("compare-opt-values");
  if (optKeys) optKeys.addEventListener("change", onCompareFilterChange);
  if (optVals) optVals.addEventListener("change", onCompareFilterChange);

  // Parse textarea input into drafts + show validation. Compare happens only on CTA.
  let pasteParseTimer = { left: null, right: null };
  function schedulePasteParse(side) {
    const ta = side === "left" ? $("paste-compare-left") : $("paste-compare-right");
    const timerKey = side;
    if (pasteParseTimer[timerKey]) clearTimeout(pasteParseTimer[timerKey]);
    pasteParseTimer[timerKey] = setTimeout(() => {
      const text = (ta.value || "").trim();
      compareDiff = null;

      if (!text) {
        if (side === "left") compareLeft = null;
        else compareRight = null;
        setValidate(side, false, "");
        updateCompareCTA();
        rerenderCompare();
        return;
      }

      const parsed = parseJsonDetailed(text);
      if (parsed.error) {
        if (side === "left") compareLeft = null;
        else compareRight = null;
        setValidate(side, false, "❌ " + parsed.error);
        updateCompareCTA();
        rerenderCompare();
        return;
      }

      if (side === "left") compareLeft = parsed.value;
      else compareRight = parsed.value;
      setValidate(side, true, "✔ Valid JSON");
      updateCompareCTA();
      rerenderCompare();
    }, 350);
  }

  $("paste-compare-left").addEventListener("input", () => schedulePasteParse("left"));
  $("paste-compare-right").addEventListener("input", () => schedulePasteParse("right"));

  // Format/Clear
  $("btn-format-compare-left").addEventListener("click", () => applyFormatCompareSide("left"));
  $("btn-clear-compare-left").addEventListener("click", () => {
    $("paste-compare-left").value = "";
    compareLeft = null;
    compareDiff = null;
    setValidate("left", false, "");
    updateCompareCTA();
    rerenderCompare();
    refreshCompareLineGutters();
  });

  $("btn-format-compare-right").addEventListener("click", () => applyFormatCompareSide("right"));
  $("btn-clear-compare-right").addEventListener("click", () => {
    $("paste-compare-right").value = "";
    compareRight = null;
    compareDiff = null;
    setValidate("right", false, "");
    updateCompareCTA();
    rerenderCompare();
    refreshCompareLineGutters();
  });

  function pickCompareFile(inputId) {
    const el = $(inputId);
    if (!el) return;
    el.value = "";
    el.click();
  }
  $("btn-cmp-left-upload").addEventListener("click", () => pickCompareFile("file-left"));
  $("btn-cmp-right-upload").addEventListener("click", () => pickCompareFile("file-right"));
  $("btn-cmp-left-copy").addEventListener("click", () => copyCompareTextarea("left"));
  $("btn-cmp-right-copy").addEventListener("click", () => copyCompareTextarea("right"));
  $("btn-cmp-left-paste").addEventListener("click", () => pasteIntoCompare("left"));
  $("btn-cmp-left-cut").addEventListener("click", () => cutFromCompare("left"));
  $("btn-cmp-left-delete").addEventListener("click", () => $("btn-clear-compare-left").click());
  $("btn-cmp-right-download").addEventListener("click", () => downloadCompareRight());
  $("btn-cmp-right-view").addEventListener("click", () => openPreviewRight());
  $("btn-cmp-left-json-viewer").addEventListener("click", () => openCompareJsonTreeViewer("left"));
  $("btn-cmp-right-json-viewer").addEventListener("click", () => openCompareJsonTreeViewer("right"));
  $("btn-explore-json-viewer").addEventListener("click", () => openExploreJsonTreeViewer());
  const btnTl = $("btn-toolbar-graph-left");
  const btnTr = $("btn-toolbar-graph-right");
  if (btnTl) btnTl.addEventListener("click", () => openCompareJsonTreeViewer("left"));
  if (btnTr) btnTr.addEventListener("click", () => openCompareJsonTreeViewer("right"));

  $("modal-preview-close").addEventListener("click", () => closePreviewModal());
  $("modal-preview-backdrop").addEventListener("click", () => closePreviewModal());
  $("modal-json-tree-close").addEventListener("click", () => closeJsonTreeModal());
  $("modal-json-tree-backdrop").addEventListener("click", () => closeJsonTreeModal());
  const gzi = $("btn-graph-zoom-in");
  const gzo = $("btn-graph-zoom-out");
  const grl = $("btn-graph-rotate-left");
  const grr = $("btn-graph-rotate-right");
  const grs = $("btn-graph-reset");
  if (gzi) gzi.addEventListener("click", () => graphZoomBy(0.1));
  if (gzo) gzo.addEventListener("click", () => graphZoomBy(-0.1));
  if (grl) grl.addEventListener("click", () => graphRotateBy(-90));
  if (grr) grr.addEventListener("click", () => graphRotateBy(90));
  if (grs) grs.addEventListener("click", () => graphResetView());

  // Upload file parsing into drafts + show in textarea
  $("file-left").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    await ingestCompareSideFromFile("left", f);
    input.value = "";
  });

  $("file-right").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    await ingestCompareSideFromFile("right", f);
    input.value = "";
  });

  bindJsonDropZone($("drop-zone-compare-left"), (f) => ingestCompareSideFromFile("left", f));
  bindJsonDropZone($("drop-zone-compare-right"), (f) => ingestCompareSideFromFile("right", f));
  bindJsonDropZone($("drop-zone-explore"), (f) => ingestExploreFromFile(f));

  function pickTextCompareFile(inputId) {
    const el = $(inputId);
    if (!el) return;
    el.value = "";
    el.click();
  }

  async function ingestTextCompareSideFromFile(side, file) {
    if (!file) return;
    const text = await readFileAsText(file);
    const ta = side === "left" ? $("paste-text-left") : $("paste-text-right");
    if (!ta) return;
    ta.value = text;
    textCompareDiff = null;
    updateTextCompareCTA();
    rerenderTextCompare();
  }

  $("btn-text-left-upload").addEventListener("click", () => pickTextCompareFile("file-text-left"));
  $("btn-text-right-upload").addEventListener("click", () => pickTextCompareFile("file-text-right"));
  $("btn-text-left-clear").addEventListener("click", () => {
    $("paste-text-left").value = "";
    textCompareDiff = null;
    updateTextCompareCTA();
    rerenderTextCompare();
  });
  $("btn-text-right-clear").addEventListener("click", () => {
    $("paste-text-right").value = "";
    textCompareDiff = null;
    updateTextCompareCTA();
    rerenderTextCompare();
  });
  $("paste-text-left").addEventListener("input", () => {
    textCompareDiff = null;
    updateTextCompareCTA();
    rerenderTextCompare();
  });
  $("paste-text-right").addEventListener("input", () => {
    textCompareDiff = null;
    updateTextCompareCTA();
    rerenderTextCompare();
  });
  $("text-compare-case-sensitive").addEventListener("change", () => {
    if (textCompareDiff) compareTextNow();
    else updateTextCompareCTA();
  });
  $("text-compare-ignore-whitespace").addEventListener("change", () => {
    if (textCompareDiff) compareTextNow();
    else updateTextCompareCTA();
  });
  $("text-compare-diff-only").addEventListener("change", () => {
    if (textCompareDiff) rerenderTextCompare();
  });

  $("file-text-left").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    await ingestTextCompareSideFromFile("left", f);
    input.value = "";
  });

  $("file-text-right").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    await ingestTextCompareSideFromFile("right", f);
    input.value = "";
  });

  initThemeToggle();

  setTab("compare");
  rerenderCompare();
  rerenderExplore();
  rerenderTextCompare();
  updateTextCompareCTA();

  bindEditorGutter("paste-compare-left", "gutter-compare-left");
  bindEditorGutter("paste-compare-right", "gutter-compare-right");
  refreshCompareLineGutters();
})();
