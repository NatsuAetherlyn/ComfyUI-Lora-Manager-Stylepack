/**
 * Preset panel for the Style Loader node.
 *
 * A preset stores the LoRA stack *and* the text box contents together, so
 * loading one restores both. The panel is a fixed-height DOM widget: like the
 * text box, it declares `computeSize` in canvas mode so it never absorbs slack
 * when the node is enlarged — the LoRA list does that.
 */

import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} from "./style_preset_api.js";

const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 24;
const LORA_ROW_HEIGHT = 18;
const MESSAGE_HEIGHT = 30;
const MAX_LIST_HEIGHT = 260;

const ICON = {
  chevronDown:
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight:
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  save:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  rename:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  remove:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

/**
 * Add the preset panel widget to a node.
 *
 * @param {Object} node
 * @param {string} name - Widget name.
 * @param {Object} handlers
 * @param {Function} handlers.getLoras - Returns the current LoRA entry array.
 * @param {Function} handlers.getText - Returns the current text box contents.
 * @param {Function} handlers.applyPreset - Receives `{loras, text}` to load.
 * @param {Function} [handlers.notify] - `(message, severity)` toast callback.
 * @returns {{widget: Object, refresh: Function, isExpanded: Function,
 *            setExpanded: Function}}
 */
export function addStylePresetsWidget(node, name, handlers) {
  const notify = handlers.notify ?? ((message) => console.log(message));

  let expanded = false;
  let presets = [];
  let loadState = "idle"; // idle | loading | loaded | error
  let loadError = null;
  const expandedIds = new Set();

  const container = document.createElement("div");
  container.className = "lmsp-presets-container";

  const widget = node.addDOMWidget(name, "custom", container, {
    // Panel state is transient UI, not workflow data.
    getValue: () => null,
    setValue: () => {},
    hideOnZoom: true,
    selectOn: ["click"],
  });

  // NOTE: deliberately NOT setting `widget.serialize = false`.
  //
  // LiteGraph's serialize() writes `widgets_values[n]` at each widget's
  // positional index but *skips* non-serialized widgets, leaving a hole.
  // configure() reads back sequentially, skipping non-serialized widgets. Those
  // two conventions disagree whenever a non-serialized widget precedes a
  // serialized one — every later value is restored one slot off, which silently
  // destroyed the saved `loras` array on reload.
  //
  // Serialising a constant null costs one array slot and keeps the indices of
  // both conventions aligned.
  widget.serialize = true;

  /** Height the panel needs for its current contents. */
  const measureHeight = () => {
    if (!expanded) {
      return HEADER_HEIGHT;
    }
    let listHeight = 0;
    if (loadState === "loading" || loadState === "error" || presets.length === 0) {
      listHeight = MESSAGE_HEIGHT;
    } else {
      for (const preset of presets) {
        listHeight += ROW_HEIGHT;
        if (expandedIds.has(preset.id)) {
          listHeight += (preset.loras?.length ?? 0) * LORA_ROW_HEIGHT;
          if (preset.text) {
            listHeight += LORA_ROW_HEIGHT * 2;
          }
        }
      }
    }
    return HEADER_HEIGHT + Math.min(listHeight, MAX_LIST_HEIGHT);
  };

  const applyLayout = () => {
    const height = measureHeight();
    container.style.height = `${height}px`;

    // `computeLayoutSize` lives on DOMWidgetImpl.prototype, so it must be
    // shadowed by assignment — `delete` would leave the inherited method live
    // and the panel would compete with the LoRA list for slack.
    if (typeof LiteGraph !== "undefined" && LiteGraph.vueNodesMode) {
      container.classList.add("lmsp-vue-node");
      delete widget.computeSize;
      widget.computeLayoutSize = () => ({
        minHeight: height,
        maxHeight: height,
        minWidth: 0,
      });
      const row = container.closest('[data-testid="node-widget"]');
      if (row) {
        row.style.alignSelf = "start";
        row.style.height = `${height}px`;
      }
    } else {
      container.classList.remove("lmsp-vue-node");
      widget.computeLayoutSize = undefined;
      widget.computeSize = (width) => [width ?? 0, height];
    }
  };

  const resizeNode = () => {
    applyLayout();
    if (typeof node.computeSize === "function") {
      const computed = node.computeSize();
      const width = node.size?.[0] ?? computed[0];
      node.setSize([Math.max(width, computed[0]), computed[1]]);
    }
    node.setDirtyCanvas?.(true, true);
  };

  // ------------------------------------------------------------ rendering
  const button = (className, html, title, onClick) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.innerHTML = html;
    el.title = title;
    el.setAttribute("aria-label", title);
    el.tabIndex = -1;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return el;
  };

  const renderHeader = () => {
    const header = document.createElement("div");
    header.className = "lmsp-presets-header";

    const toggle = button(
      "lmsp-presets-toggle",
      expanded ? ICON.chevronDown : ICON.chevronRight,
      expanded ? "收起预设" : "展开预设",
      () => setExpanded(!expanded)
    );

    const label = document.createElement("span");
    label.className = "lmsp-presets-label";
    label.textContent =
      loadState === "loaded" ? `预设 (${presets.length})` : "预设";

    const left = document.createElement("div");
    left.className = "lmsp-presets-left";
    left.appendChild(toggle);
    left.appendChild(label);

    // Clicking the label area also toggles, which is the expected affordance.
    left.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      event.stopPropagation();
      setExpanded(!expanded);
    });

    const saveBtn = button(
      "lmsp-presets-save",
      `${ICON.save}<span>保存</span>`,
      "将当前 LoRA 与文本保存为预设",
      handleSave
    );

    header.appendChild(left);
    header.appendChild(saveBtn);
    return header;
  };

  const renderMessage = (text, modifier = "") => {
    const el = document.createElement("div");
    el.className = `lmsp-presets-message ${modifier}`.trim();
    el.textContent = text;
    return el;
  };

  const renderPresetRow = (preset) => {
    const isOpen = expandedIds.has(preset.id);
    const row = document.createElement("div");
    row.className = "lmsp-preset-row";

    const expandBtn = button(
      "lmsp-preset-expand",
      isOpen ? ICON.chevronDown : ICON.chevronRight,
      isOpen ? "收起内容" : "查看内容",
      () => {
        if (isOpen) {
          expandedIds.delete(preset.id);
        } else {
          expandedIds.add(preset.id);
        }
        render();
        resizeNode();
      }
    );

    const nameEl = document.createElement("span");
    nameEl.className = "lmsp-preset-name";
    nameEl.textContent = preset.name;
    const loraCount = preset.loras?.length ?? 0;
    nameEl.title = `${preset.name} — ${loraCount} 个 LoRA${
      preset.text ? "，含文本" : ""
    }`;

    const badge = document.createElement("span");
    badge.className = "lmsp-preset-badge";
    badge.textContent = String(loraCount);
    badge.title = `${loraCount} 个 LoRA`;

    const info = document.createElement("div");
    info.className = "lmsp-preset-info";
    info.appendChild(expandBtn);
    info.appendChild(nameEl);
    info.appendChild(badge);
    if (preset.text) {
      const textBadge = document.createElement("span");
      textBadge.className = "lmsp-preset-badge lmsp-preset-badge--text";
      textBadge.textContent = "文";
      textBadge.title = "包含预设文本";
      info.appendChild(textBadge);
    }

    const actions = document.createElement("div");
    actions.className = "lmsp-preset-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "lmsp-preset-load";
    loadBtn.textContent = "载入";
    loadBtn.title = "载入此预设（LoRA + 文本）";
    loadBtn.tabIndex = -1;
    loadBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleLoad(preset);
    });

    actions.appendChild(loadBtn);
    actions.appendChild(
      button("lmsp-preset-icon-btn", ICON.rename, "重命名", () =>
        handleRename(preset)
      )
    );
    actions.appendChild(
      button("lmsp-preset-icon-btn lmsp-preset-icon-btn--danger", ICON.remove, "删除", () =>
        handleDelete(preset)
      )
    );

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  };

  const renderPresetDetail = (preset) => {
    const fragment = document.createDocumentFragment();

    for (const lora of preset.loras ?? []) {
      const detail = document.createElement("div");
      detail.className = "lmsp-preset-detail";
      if (lora.active === false) {
        detail.classList.add("lmsp-preset-detail--inactive");
      }

      const detailName = document.createElement("span");
      detailName.className = "lmsp-preset-detail-name";
      detailName.textContent = lora.name;
      detailName.title = lora.name;

      const detailStrength = document.createElement("span");
      detailStrength.className = "lmsp-preset-detail-strength";
      const strength = Number(lora.strength ?? 0);
      const clip = Number(lora.clipStrength ?? strength);
      detailStrength.textContent =
        Math.abs(strength - clip) > 1e-6
          ? `${strength.toFixed(2)} / ${clip.toFixed(2)}`
          : strength.toFixed(2);

      detail.appendChild(detailName);
      detail.appendChild(detailStrength);
      fragment.appendChild(detail);
    }

    if (preset.text) {
      const textPreview = document.createElement("div");
      textPreview.className = "lmsp-preset-text-preview";
      textPreview.textContent = preset.text;
      textPreview.title = preset.text;
      fragment.appendChild(textPreview);
    }

    return fragment;
  };

  const render = () => {
    container.replaceChildren();
    container.appendChild(renderHeader());

    if (!expanded) {
      return;
    }

    const list = document.createElement("div");
    list.className = "lmsp-presets-list";

    if (loadState === "loading") {
      list.appendChild(renderMessage("正在载入预设…"));
    } else if (loadState === "error") {
      list.appendChild(
        renderMessage(loadError || "载入预设失败", "lmsp-presets-message--error")
      );
    } else if (presets.length === 0) {
      list.appendChild(renderMessage("还没有预设。点击「保存」创建第一个。"));
    } else {
      for (const preset of presets) {
        list.appendChild(renderPresetRow(preset));
        if (expandedIds.has(preset.id)) {
          list.appendChild(renderPresetDetail(preset));
        }
      }
    }

    container.appendChild(list);
  };

  // -------------------------------------------------------------- actions
  const refresh = async ({ silent = false } = {}) => {
    loadState = "loading";
    loadError = null;
    if (!silent) {
      render();
    }

    const result = await listPresets();
    if (result.ok) {
      presets = result.presets;
      loadState = "loaded";
      // Drop expansion state for presets that no longer exist.
      const ids = new Set(presets.map((preset) => preset.id));
      for (const id of Array.from(expandedIds)) {
        if (!ids.has(id)) {
          expandedIds.delete(id);
        }
      }
    } else {
      loadState = "error";
      loadError = result.error;
    }

    render();
    resizeNode();
    return result.ok;
  };

  const setExpanded = (value) => {
    const next = !!value;
    if (next === expanded) {
      return;
    }
    expanded = next;
    render();
    resizeNode();

    // Load lazily, the first time the panel is opened.
    if (expanded && loadState === "idle") {
      refresh({ silent: true });
    }
  };

  const handleSave = async () => {
    const loras = handlers.getLoras() ?? [];
    const text = handlers.getText() ?? "";

    if (loras.length === 0 && !text.trim()) {
      notify("没有可保存的内容：请先添加 LoRA 或填写文本", "warn");
      return;
    }

    const rawName = window.prompt("为这个预设命名：", "");
    if (rawName === null) {
      return;
    }
    const presetName = rawName.trim();
    if (!presetName) {
      notify("预设名称不能为空", "warn");
      return;
    }

    let result = await createPreset({ name: presetName, text, loras });

    if (!result.ok && result.conflict) {
      const overwrite = window.confirm(
        `已存在名为「${presetName}」的预设。要覆盖它吗？`
      );
      if (!overwrite) {
        return;
      }
      result = await createPreset({
        name: presetName,
        text,
        loras,
        overwrite: true,
      });
    }

    if (!result.ok) {
      notify(result.error || "保存预设失败", "error");
      return;
    }

    notify(`已保存预设「${presetName}」`, "success");
    if (!expanded) {
      expanded = true;
    }
    await refresh({ silent: true });
  };

  const handleLoad = async (preset) => {
    const currentLoras = handlers.getLoras() ?? [];
    const currentText = (handlers.getText() ?? "").trim();

    if (currentLoras.length > 0 || currentText) {
      const parts = [];
      if (currentLoras.length > 0) {
        parts.push(`${currentLoras.length} 个 LoRA`);
      }
      if (currentText) {
        parts.push("文本框内容");
      }
      const confirmed = window.confirm(
        `载入「${preset.name}」将替换当前的 ${parts.join(" 和 ")}。继续吗？`
      );
      if (!confirmed) {
        return;
      }
    }

    handlers.applyPreset({
      loras: preset.loras ?? [],
      text: preset.text ?? "",
    });
    notify(`已载入预设「${preset.name}」`, "success");
  };

  const handleRename = async (preset) => {
    const rawName = window.prompt("重命名预设：", preset.name);
    if (rawName === null) {
      return;
    }
    const nextName = rawName.trim();
    if (!nextName || nextName === preset.name) {
      return;
    }

    const result = await updatePreset(preset.id, { name: nextName });
    if (!result.ok) {
      notify(result.error || "重命名失败", "error");
      return;
    }
    notify(`已重命名为「${nextName}」`, "success");
    await refresh({ silent: true });
  };

  const handleDelete = async (preset) => {
    const confirmed = window.confirm(
      `删除预设「${preset.name}」？此操作无法撤销。`
    );
    if (!confirmed) {
      return;
    }

    const result = await deletePreset(preset.id);
    if (!result.ok) {
      notify(result.error || "删除失败", "error");
      return;
    }
    notify(`已删除预设「${preset.name}」`, "success");
    await refresh({ silent: true });
  };

  // The host bundle dispatches this on `document` with bubbles:false, so a
  // window listener would never fire.
  const onVueModeChange = () => applyLayout();
  document.addEventListener("lora-manager:vue-mode-change", onVueModeChange);

  const originalOnRemove = widget.onRemove?.bind(widget);
  widget.onRemove = () => {
    document.removeEventListener(
      "lora-manager:vue-mode-change",
      onVueModeChange
    );
    container.replaceChildren();
    originalOnRemove?.();
  };

  render();
  applyLayout();

  return {
    widget,
    element: container,
    refresh,
    isExpanded: () => expanded,
    setExpanded,
  };
}
