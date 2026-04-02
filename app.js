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
      if (jumpHighlight) row.classList.add("ring-2", "ring-emerald-500", "ring-offset-2", "ring-offset-white", "rounded");

      const head = document.createElement("div");
      head.className = "flex cursor-pointer items-start gap-1 py-0.5 hover:bg-zinc-200/80 rounded";
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
      if (jumpHighlight) row.classList.add("ring-2", "ring-emerald-500", "ring-offset-2", "ring-offset-white", "rounded");

      const head = document.createElement("div");
      head.className = "flex cursor-pointer items-start gap-1 py-0.5 hover:bg-zinc-200/80 rounded";
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
    span.className = "text-zinc-800 break-words";
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
  let compareLeft = null;
  let compareRight = null;
  let compareDiff = null;
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
        '<p class="py-6 text-center text-sm text-zinc-500">Add valid JSON in both editors, then click <span class="font-medium text-emerald-700">Compare JSON</span>. The comparison will appear here.</p>';
      return;
    }
    const opts = getCompareFilterOptions();
    const fullPruned = pruneDiff(compareDiff);
    if (!fullPruned) {
      body.innerHTML =
        '<p class="py-6 text-center text-sm text-zinc-500">No differences — documents are equal.</p>';
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
        '<p class="py-6 text-center text-sm text-zinc-500">No differences match the current filters. Try enabling both options or adjust your selection.</p>';
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
    const comparePanel = $("panel-compare");
    const explorePanel = $("panel-explore");
    const isCompare = which === "compare";
    compareBtn.setAttribute("aria-selected", String(isCompare));
    exploreBtn.setAttribute("aria-selected", String(!isCompare));
    comparePanel.classList.toggle("hidden", !isCompare);
    explorePanel.classList.toggle("hidden", isCompare);
  }

  function rerenderExplore() {
    const root = $("tree-explore");
    root.innerHTML = "";
    if (exploreData == null) {
      root.innerHTML =
        '<p class="text-zinc-500 text-sm p-4">Load a JSON file or paste JSON and click <span class="font-medium text-emerald-700">Parse pasted</span>.</p>';
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
    const sel = $("path-select");
    const keep = sel.value;
    sel.innerHTML = '<option value="">— Select path —</option>';
    const paths = enumeratePaths(data);
    for (const p of paths) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    }
    if (paths.includes(keep)) sel.value = keep;
  }

  function rerenderCompare() {
    rerenderInlineDiffs();
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

  $("tab-compare").addEventListener("click", () => setTab("compare"));
  $("tab-explore").addEventListener("click", () => setTab("explore"));

  $("file-explore").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    showError($("explore-error"), "");
    try {
      const text = await readFileAsText(f);
      const data = tryParseJson(text, $("explore-error"));
      if (!data) return;
      exploreData = data;
      exploreCollapsed = new Set();
      fillPathSelect(data);
      rerenderExplore();
    } catch (err) {
      showError($("explore-error"), String(err.message || err));
    }
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

  $("path-select").addEventListener("change", () => {
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
  });

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
      else statusEl.textContent = "Ready. Click Compare JSON.";
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

  $("modal-preview-close").addEventListener("click", () => closePreviewModal());
  $("modal-preview-backdrop").addEventListener("click", () => closePreviewModal());

  // Upload file parsing into drafts + show in textarea
  $("file-left").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    showError($("compare-error"), "");
    try {
      const text = await readFileAsText(f);
      $("paste-compare-left").value = text;
      compareDiff = null;
      const parsed = parseJsonDetailed(text.trim());
      if (parsed.error) {
        compareLeft = null;
        setValidate("left", false, "❌ " + parsed.error);
      } else {
        compareLeft = parsed.value;
        setValidate("left", true, "✔ Valid JSON");
      }
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    } catch (err) {
      setValidate("left", false, "❌ " + String(err.message || err));
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    }
    input.value = "";
  });

  $("file-right").addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) {
      input.value = "";
      return;
    }
    showError($("compare-error"), "");
    try {
      const text = await readFileAsText(f);
      $("paste-compare-right").value = text;
      compareDiff = null;
      const parsed = parseJsonDetailed(text.trim());
      if (parsed.error) {
        compareRight = null;
        setValidate("right", false, "❌ " + parsed.error);
      } else {
        compareRight = parsed.value;
        setValidate("right", true, "✔ Valid JSON");
      }
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    } catch (err) {
      setValidate("right", false, "❌ " + String(err.message || err));
      updateCompareCTA();
      rerenderCompare();
      refreshCompareLineGutters();
    }
    input.value = "";
  });

  setTab("compare");
  rerenderCompare();
  rerenderExplore();

  bindEditorGutter("paste-compare-left", "gutter-compare-left");
  bindEditorGutter("paste-compare-right", "gutter-compare-right");
  refreshCompareLineGutters();
})();
