/**
 * Preset panel for the Style Loader node.
 *
 * A preset stores the LoRA stack *and* the text box contents together, so
 * loading one restores both. The panel is a fixed-height DOM widget: like the
 * text box, it declares `computeSize` in canvas mode so it never absorbs slack
 * when the node is enlarged — the LoRA list does that.
 * 
 * Version 2: Added hover preview tooltip support (similar to Lora Manager).
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
const GROUP_HEADER_HEIGHT = 28;
const PREVIEW_DELAY_MS = 400; // Delay before showing preview on hover

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
  edit:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  grip:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
};

/**
 * Lightweight preview tooltip for preset preview images.
 * Similar to Lora Manager's PreviewTooltip but simplified for presets.
 */
class PresetPreviewTooltip {
  constructor() {
    this.element = document.createElement("div");
    this.element.className = "lmsp-preview-tooltip";
    document.body.appendChild(this.element);
    this.hideTimeout = null;
    this.currentPresetId = null;

    // Hide on scroll
    this.globalScrollHandler = () => this.hide();
    document.addEventListener("scroll", this.globalScrollHandler, true);
  }

  async show(preset, x, y) {
    try {
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }

      // If already showing the same preset, just reposition
      if (
        this.element.style.display === "block" &&
        this.currentPresetId === preset.id
      ) {
        this.position(x, y);
        return;
      }

      // No preview image available
      if (!preset.preview) {
        return;
      }

      this.currentPresetId = preset.id;

      // Clear previous content
      while (this.element.firstChild) {
        this.element.removeChild(this.element.firstChild);
      }

      // Create media container
      const mediaContainer = document.createElement("div");
      mediaContainer.className = "lmsp-preview-tooltip__media-container";

      // Create image element
      const img = document.createElement("img");
      img.className = "lmsp-preview-tooltip__media";
      img.src = preset.preview;

      // Create name label
      const nameLabel = document.createElement("div");
      nameLabel.textContent = preset.name;
      nameLabel.className = "lmsp-preview-tooltip__label";

      // Add badges
      const badges = document.createElement("div");
      badges.className = "lmsp-preview-tooltip__badges";
      
      const loraCount = preset.loras?.length || 0;
      const loraBadge = document.createElement("span");
      loraBadge.className = "lmsp-preview-tooltip__badge";
      loraBadge.textContent = `${loraCount} LoRAs`;
      badges.appendChild(loraBadge);

      if (preset.text) {
        const textBadge = document.createElement("span");
        textBadge.className = "lmsp-preview-tooltip__badge lmsp-preview-tooltip__badge--text";
        textBadge.textContent = "含文本";
        badges.appendChild(textBadge);
      }

      mediaContainer.appendChild(img);
      mediaContainer.appendChild(nameLabel);
      mediaContainer.appendChild(badges);
      this.element.appendChild(mediaContainer);

      // Show with fade-in
      this.element.style.opacity = "0";
      this.element.style.display = "block";

      // Wait for image to load
      const waitForLoad = () =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
          } else {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }
          setTimeout(resolve, 1000); // Timeout fallback
        });

      await waitForLoad();

      // Position and fade in
      requestAnimationFrame(() => {
        this.position(x, y);
        this.element.style.transition = "opacity 0.15s ease";
        this.element.style.opacity = "1";
      });
    } catch (error) {
      console.warn("Failed to show preset preview:", error);
    }
  }

  position(x, y) {
    const rect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x + 10;
    let top = y + 10;

    // Flip to left if would overflow right edge
    if (left + rect.width > viewportWidth) {
      left = x - rect.width - 10;
    }

    // Flip to top if would overflow bottom edge
    if (top + rect.height > viewportHeight) {
      top = y - rect.height - 10;
    }

    // Clamp to viewport
    left = Math.max(10, Math.min(left, viewportWidth - rect.width - 10));
    top = Math.max(10, Math.min(top, viewportHeight - rect.height - 10));

    Object.assign(this.element.style, {
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  hide() {
    if (this.element.style.display === "block") {
      this.element.style.opacity = "0";
      this.hideTimeout = setTimeout(() => {
        this.element.style.display = "none";
        this.currentPresetId = null;
        this.hideTimeout = null;
      }, 150);
    }
  }

  cleanup() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    document.removeEventListener("scroll", this.globalScrollHandler, true);
    this.element.remove();
  }
}

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
  const collapsedGroups = new Set(); // Track collapsed groups
  
  // Drag and drop state
  let draggedPreset = null;
  let draggedIndex = -1;
  let dropTargetIndex = -1;

  // Preview tooltip
  const previewTooltip = new PresetPreviewTooltip();
  let previewTimer = null;

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
      // Group presets
      const groups = new Map();
      for (const preset of presets) {
        const group = preset.group || "";
        if (!groups.has(group)) {
          groups.set(group, []);
        }
        groups.get(group).push(preset);
      }

      // Calculate height for each group
      for (const [group, groupPresets] of groups) {
        // Group header
        if (group) {
          listHeight += GROUP_HEADER_HEIGHT;
        }
        
        // Skip presets if group is collapsed
        if (group && collapsedGroups.has(group)) {
          continue;
        }

        // Add preset rows
        for (const preset of groupPresets) {
          listHeight += ROW_HEIGHT;
          if (expandedIds.has(preset.id)) {
            listHeight += (preset.loras?.length ?? 0) * LORA_ROW_HEIGHT;
            if (preset.text) {
              listHeight += LORA_ROW_HEIGHT * 2;
            }
          }
        }
        
        // Add drop zone height
        listHeight += 20;
      }
    }
    return HEADER_HEIGHT + Math.min(listHeight, MAX_LIST_HEIGHT);
  };

  // Height this widget last reported to LiteGraph. Callers mutate panel state
  // (expanded / presets / loadState) *before* calling resizeNode, so measuring
  // twice around applyLayout would always yield a zero delta. Tracking the last
  // applied value is what makes the delta meaningful.
  let appliedHeight = measureHeight();

  const applyLayout = () => {
    const height = measureHeight();
    appliedHeight = height;
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

  /**
   * Re-layout, then grow/shrink the node by exactly this panel's height change.
   *
   * Deliberately *not* `node.setSize(node.computeSize())`: computeSize() reports
   * the node's *minimum* height, so snapping to it would throw away the extra
   * space the user dragged out — expanding the preset list would collapse the
   * node back to its default size. A delta keeps the user's sizing intact.
   */
  const resizeNode = () => {
    const before = appliedHeight;
    applyLayout();
    const delta = appliedHeight - before;

    if (delta && typeof node.setSize === "function") {
      const width = node.size?.[0] ?? 0;
      const currentHeight = node.size?.[1] ?? 0;
      let nextHeight = currentHeight + delta;

      // Respect the node minimum so shrinking cannot clip other widgets.
      if (typeof node.computeSize === "function") {
        const minHeight = node.computeSize()[1];
        if (nextHeight < minHeight) {
          nextHeight = minHeight;
        }
      }
      if (nextHeight !== currentHeight) {
        node.setSize([width, nextHeight]);
      }
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

  const renderGroupHeader = (groupName, presetCount) => {
    const isCollapsed = collapsedGroups.has(groupName);
    const header = document.createElement("div");
    header.className = "lmsp-group-header";

    const toggleBtn = button(
      "lmsp-group-toggle",
      isCollapsed ? ICON.chevronRight : ICON.chevronDown,
      isCollapsed ? "展开分组" : "收起分组",
      () => {
        if (isCollapsed) {
          collapsedGroups.delete(groupName);
        } else {
          collapsedGroups.add(groupName);
        }
        render();
        resizeNode();
      }
    );

    const label = document.createElement("span");
    label.className = "lmsp-group-label";
    label.textContent = `${groupName} (${presetCount})`;

    header.appendChild(toggleBtn);
    header.appendChild(label);
    return header;
  };

  const renderPresetRow = (preset) => {
    const isOpen = expandedIds.has(preset.id);
    const row = document.createElement("div");
    row.className = "lmsp-preset-row";
    row.dataset.presetId = preset.id;

    // Drag handle
    const dragHandle = document.createElement("span");
    dragHandle.className = "lmsp-preset-drag-handle";
    dragHandle.innerHTML = ICON.grip;
    dragHandle.title = "拖动排序";
    dragHandle.draggable = true;

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

    // Add preview tooltip on hover (similar to Lora Manager)
    if (preset.preview) {
      nameEl.addEventListener("mouseenter", (e) => {
        if (previewTimer) {
          clearTimeout(previewTimer);
        }
        previewTimer = setTimeout(async () => {
          previewTimer = null;
          const rect = nameEl.getBoundingClientRect();
          await previewTooltip.show(preset, rect.right, rect.top);
        }, PREVIEW_DELAY_MS);
      });

      nameEl.addEventListener("mouseleave", () => {
        if (previewTimer) {
          clearTimeout(previewTimer);
          previewTimer = null;
        }
        previewTooltip.hide();
      });

      // Also add a visual indicator that preview is available
      nameEl.classList.add("lmsp-preset-name--has-preview");
    }

    const badge = document.createElement("span");
    badge.className = "lmsp-preset-badge";
    badge.textContent = String(loraCount);
    badge.title = `${loraCount} 个 LoRA`;

    const info = document.createElement("div");
    info.className = "lmsp-preset-info";
    info.appendChild(dragHandle);
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
      button("lmsp-preset-icon-btn", ICON.edit, "编辑分组/排序", () =>
        handleEdit(preset)
      )
    );
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

    // Drag and drop event handlers - only on the drag handle
    dragHandle.addEventListener("dragstart", (e) => {
      draggedPreset = preset;
      draggedIndex = presets.indexOf(preset);
      row.classList.add("lmsp-preset-row--dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", preset.id);
    });

    dragHandle.addEventListener("dragend", () => {
      row.classList.remove("lmsp-preset-row--dragging");
      draggedPreset = null;
      draggedIndex = -1;
      dropTargetIndex = -1;
      // Remove all drop indicators
      document.querySelectorAll(".lmsp-preset-row--drop-before, .lmsp-preset-row--drop-after")
        .forEach(el => el.classList.remove("lmsp-preset-row--drop-before", "lmsp-preset-row--drop-after"));
    });

    row.addEventListener("dragover", (e) => {
      if (!draggedPreset || draggedPreset.id === preset.id) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const targetIndex = presets.indexOf(preset);
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      
      // Remove previous indicators
      document.querySelectorAll(".lmsp-preset-row--drop-before, .lmsp-preset-row--drop-after")
        .forEach(el => el.classList.remove("lmsp-preset-row--drop-before", "lmsp-preset-row--drop-after"));

      if (e.clientY < midpoint) {
        row.classList.add("lmsp-preset-row--drop-before");
        dropTargetIndex = targetIndex;
      } else {
        row.classList.add("lmsp-preset-row--drop-after");
        dropTargetIndex = targetIndex + 1;
      }
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!draggedPreset || draggedPreset.id === preset.id) {
        return;
      }

      // Calculate new order based on drop position
      await handleReorder(draggedPreset, dropTargetIndex);
      
      // Clean up
      document.querySelectorAll(".lmsp-preset-row--drop-before, .lmsp-preset-row--drop-after")
        .forEach(el => el.classList.remove("lmsp-preset-row--drop-before", "lmsp-preset-row--drop-after"));
    });

    // Prevent default drag behavior on the entire row except the handle
    row.addEventListener("dragstart", (e) => {
      if (e.target !== dragHandle && !dragHandle.contains(e.target)) {
        e.preventDefault();
      }
    });

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
      // Group presets
      const groups = new Map();
      for (const preset of presets) {
        const group = preset.group || "";
        if (!groups.has(group)) {
          groups.set(group, []);
        }
        groups.get(group).push(preset);
      }

      // Render each group
      for (const [group, groupPresets] of groups) {
        const groupContainer = document.createElement("div");
        groupContainer.className = "lmsp-group-container";
        groupContainer.dataset.group = group;
        
        // Render group header if group name exists
        if (group) {
          groupContainer.appendChild(renderGroupHeader(group, groupPresets.length));
        }

        // Render presets if group is not collapsed (or no group name)
        if (!group || !collapsedGroups.has(group)) {
          for (const preset of groupPresets) {
            groupContainer.appendChild(renderPresetRow(preset));
            if (expandedIds.has(preset.id)) {
              groupContainer.appendChild(renderPresetDetail(preset));
            }
          }
          
          // Add drop zone at the end of group
          const dropZone = document.createElement("div");
          dropZone.className = "lmsp-preset-drop-zone";
          dropZone.dataset.group = group;
          
          dropZone.addEventListener("dragover", (e) => {
            if (!draggedPreset) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            dropZone.classList.add("lmsp-preset-drop-zone--active");
          });
          
          dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("lmsp-preset-drop-zone--active");
          });
          
          dropZone.addEventListener("drop", async (e) => {
            e.preventDefault();
            dropZone.classList.remove("lmsp-preset-drop-zone--active");
            
            if (!draggedPreset) return;
            
            // Move to end of this group
            const targetGroupPresets = presets.filter(p => (p.group || "") === group);
            const lastInGroup = targetGroupPresets[targetGroupPresets.length - 1];
            const newOrder = lastInGroup ? lastInGroup.order + 1 : 0;
            
            const result = await updatePreset(draggedPreset.id, { order: newOrder });
            if (!result.ok) {
              notify(result.error || "调整顺序失败", "error");
              return;
            }
            
            await refresh({ silent: true });
          });
          
          groupContainer.appendChild(dropZone);
        }
        
        list.appendChild(groupContainer);
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

    // Get all existing groups
    const existingGroups = [...new Set(presets.map(p => p.group || "").filter(g => g))];
    
    // Show unified save dialog
    const result = await showSaveDialog(existingGroups);
    if (!result) {
      return; // User cancelled
    }

    const { name: presetName, group: presetGroup } = result;

    // Auto-assign order as the last in the group
    const groupPresets = presets.filter(p => (p.group || "") === presetGroup);
    const maxOrder = groupPresets.length > 0 
      ? Math.max(...groupPresets.map(p => p.order || 0))
      : -1;
    const presetOrder = maxOrder + 1;

    let apiResult = await createPreset({ 
      name: presetName, 
      text, 
      loras,
      group: presetGroup,
      order: presetOrder
    });

    if (!apiResult.ok && apiResult.conflict) {
      const overwrite = window.confirm(
        `已存在名为「${presetName}」的预设。要覆盖它吗？`
      );
      if (!overwrite) {
        return;
      }
      apiResult = await createPreset({
        name: presetName,
        text,
        loras,
        group: presetGroup,
        order: presetOrder,
        overwrite: true,
      });
    }

    if (!apiResult.ok) {
      notify(apiResult.error || "保存预设失败", "error");
      return;
    }

    notify(`已保存预设「${presetName}」`, "success");
    if (!expanded) {
      expanded = true;
    }
    await refresh({ silent: true });
  };

  const showSaveDialog = (existingGroups) => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lmsp-dialog-overlay";
      
      const dialog = document.createElement("div");
      dialog.className = "lmsp-dialog";
      
      const title = document.createElement("div");
      title.className = "lmsp-dialog-title";
      title.textContent = "保存预设";
      
      // Name input
      const nameLabel = document.createElement("label");
      nameLabel.className = "lmsp-dialog-label";
      nameLabel.textContent = "预设名称";
      
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "lmsp-dialog-input";
      nameInput.placeholder = "输入预设名称";
      
      // Group input
      const groupLabel = document.createElement("label");
      groupLabel.className = "lmsp-dialog-label";
      groupLabel.textContent = "分组（可选）";
      
      const groupInput = document.createElement("input");
      groupInput.type = "text";
      groupInput.className = "lmsp-dialog-input";
      groupInput.placeholder = "留空表示不分组";
      
      // Existing groups
      let groupList;
      if (existingGroups.length > 0) {
        groupList = document.createElement("div");
        groupList.className = "lmsp-dialog-group-list";
        
        for (const group of existingGroups) {
          const groupBtn = document.createElement("button");
          groupBtn.className = "lmsp-dialog-group-btn";
          groupBtn.textContent = group;
          groupBtn.addEventListener("click", () => {
            groupInput.value = group;
          });
          groupList.appendChild(groupBtn);
        }
      }
      
      const buttons = document.createElement("div");
      buttons.className = "lmsp-dialog-buttons";
      
      const okBtn = document.createElement("button");
      okBtn.className = "lmsp-dialog-btn lmsp-dialog-btn--primary";
      okBtn.textContent = "保存";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "lmsp-dialog-btn";
      cancelBtn.textContent = "取消";
      
      buttons.appendChild(okBtn);
      buttons.appendChild(cancelBtn);
      
      dialog.appendChild(title);
      dialog.appendChild(nameLabel);
      dialog.appendChild(nameInput);
      dialog.appendChild(groupLabel);
      dialog.appendChild(groupInput);
      if (groupList) {
        dialog.appendChild(groupList);
      }
      dialog.appendChild(buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Focus name input
      setTimeout(() => nameInput.focus(), 50);
      
      const cleanup = () => {
        document.body.removeChild(overlay);
      };
      
      const submit = () => {
        const name = nameInput.value.trim();
        if (!name) {
          notify("预设名称不能为空", "warn");
          nameInput.focus();
          return;
        }
        cleanup();
        resolve({ name, group: groupInput.value.trim() });
      };
      
      okBtn.addEventListener("click", submit);
      
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          groupInput.focus();
        } else if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      });
      
      groupInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          submit();
        } else if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      });
      
      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(null);
        }
      });
    });
  };

  const showGroupSelectionDialog = (existingGroups, currentValue = "") => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lmsp-dialog-overlay";
      
      const dialog = document.createElement("div");
      dialog.className = "lmsp-dialog";
      
      const title = document.createElement("div");
      title.className = "lmsp-dialog-title";
      title.textContent = "选择分组";
      
      const message = document.createElement("div");
      message.className = "lmsp-dialog-message";
      message.textContent = existingGroups.length > 0 
        ? "从现有分组中选择，或输入新的分组名："
        : "输入新的分组名（可选）：";
      
      const inputContainer = document.createElement("div");
      inputContainer.className = "lmsp-dialog-input-container";
      
      const input = document.createElement("input");
      input.type = "text";
      input.className = "lmsp-dialog-input";
      input.placeholder = "留空表示不分组";
      input.value = currentValue;
      
      inputContainer.appendChild(input);
      
      // Existing groups
      let groupList;
      if (existingGroups.length > 0) {
        groupList = document.createElement("div");
        groupList.className = "lmsp-dialog-group-list";
        
        for (const group of existingGroups) {
          const groupBtn = document.createElement("button");
          groupBtn.className = "lmsp-dialog-group-btn";
          groupBtn.textContent = group;
          groupBtn.addEventListener("click", () => {
            input.value = group;
          });
          groupList.appendChild(groupBtn);
        }
      }
      
      const buttons = document.createElement("div");
      buttons.className = "lmsp-dialog-buttons";
      
      const okBtn = document.createElement("button");
      okBtn.className = "lmsp-dialog-btn lmsp-dialog-btn--primary";
      okBtn.textContent = "确定";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "lmsp-dialog-btn";
      cancelBtn.textContent = "取消";
      
      buttons.appendChild(okBtn);
      buttons.appendChild(cancelBtn);
      
      dialog.appendChild(title);
      dialog.appendChild(message);
      dialog.appendChild(inputContainer);
      if (groupList) {
        dialog.appendChild(groupList);
      }
      dialog.appendChild(buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Focus input
      setTimeout(() => input.focus(), 50);
      
      const cleanup = () => {
        document.body.removeChild(overlay);
      };
      
      const submit = () => {
        cleanup();
        resolve(input.value.trim());
      };
      
      okBtn.addEventListener("click", submit);
      
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          submit();
        } else if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      });
      
      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(null);
        }
      });
    });
  };

  const handleLoad = async (preset) => {
    const currentLoras = handlers.getLoras() ?? [];
    const currentText = (handlers.getText() ?? "").trim();

    // Show a custom dialog for mode selection
    const mode = await showLoadModeDialog(preset.name, currentLoras.length > 0 || !!currentText);
    
    if (mode === null) {
      return; // User cancelled
    }

    const isAppend = mode === "append";

    if (!isAppend && (currentLoras.length > 0 || currentText)) {
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

    if (isAppend) {
      // Append mode: merge loras and text
      const presetLoras = preset.loras ?? [];
      const mergedLoras = [...currentLoras];
      
      // Add preset loras that don't already exist
      const existingNames = new Set(currentLoras.map(l => l.name));
      for (const lora of presetLoras) {
        if (!existingNames.has(lora.name)) {
          mergedLoras.push(lora);
        }
      }

      const mergedText = currentText
        ? `${currentText}\n${preset.text ?? ""}`
        : (preset.text ?? "");

      handlers.applyPreset({
        loras: mergedLoras,
        text: mergedText,
      });
      notify(`已追加预设「${preset.name}」`, "success");
    } else {
      // Replace mode: overwrite everything
      handlers.applyPreset({
        loras: preset.loras ?? [],
        text: preset.text ?? "",
      });
      notify(`已载入预设「${preset.name}」`, "success");
    }
  };

  const showLoadModeDialog = (presetName, hasContent) => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lmsp-dialog-overlay";
      
      const dialog = document.createElement("div");
      dialog.className = "lmsp-dialog";
      
      const title = document.createElement("div");
      title.className = "lmsp-dialog-title";
      title.textContent = `载入预设「${presetName}」`;
      
      const message = document.createElement("div");
      message.className = "lmsp-dialog-message";
      message.textContent = hasContent 
        ? "您当前已有 LoRA 或文本，请选择载入模式："
        : "请选择载入模式：";
      
      const buttons = document.createElement("div");
      buttons.className = "lmsp-dialog-buttons";
      
      const replaceBtn = document.createElement("button");
      replaceBtn.className = "lmsp-dialog-btn lmsp-dialog-btn--primary";
      replaceBtn.textContent = "覆盖";
      replaceBtn.title = "替换当前所有 LoRA 和文本";
      
      const appendBtn = document.createElement("button");
      appendBtn.className = "lmsp-dialog-btn lmsp-dialog-btn--secondary";
      appendBtn.textContent = "追加";
      appendBtn.title = "在当前基础上添加";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "lmsp-dialog-btn";
      cancelBtn.textContent = "取消";
      
      buttons.appendChild(replaceBtn);
      buttons.appendChild(appendBtn);
      buttons.appendChild(cancelBtn);
      
      dialog.appendChild(title);
      dialog.appendChild(message);
      dialog.appendChild(buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      const cleanup = () => {
        document.body.removeChild(overlay);
      };
      
      replaceBtn.addEventListener("click", () => {
        cleanup();
        resolve("replace");
      });
      
      appendBtn.addEventListener("click", () => {
        cleanup();
        resolve("append");
      });
      
      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(null);
        }
      });
    });
  };

  const handleRename = async (preset) => {
    // Use simple prompt dialog instead of opening WebUI
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

  const handleEdit = async (preset) => {
    const existingGroups = [...new Set(presets.map(p => p.group || "").filter(g => g))];
    
    const nextGroup = await showGroupSelectionDialog(existingGroups, preset.group || "");
    
    if (nextGroup === null) {
      return; // User cancelled
    }
    
    const currentGroup = preset.group || "";
    if (nextGroup === currentGroup) {
      notify("分组未变化", "info");
      return;
    }

    const result = await updatePreset(preset.id, { group: nextGroup });
    if (!result.ok) {
      notify(result.error || "更新分组失败", "error");
      return;
    }
    notify(
      nextGroup 
        ? `已移动到分组「${nextGroup}」` 
        : "已移除分组",
      "success"
    );
    await refresh({ silent: true });
  };

  const handleReorder = async (preset, targetIndex) => {
    if (targetIndex < 0 || targetIndex > presets.length) {
      return;
    }

    // Calculate new order value
    let newOrder;
    if (targetIndex === 0) {
      // Move to top
      const firstOrder = presets[0]?.order ?? 0;
      newOrder = firstOrder - 1;
    } else if (targetIndex >= presets.length) {
      // Move to bottom
      const lastOrder = presets[presets.length - 1]?.order ?? 0;
      newOrder = lastOrder + 1;
    } else {
      // Insert between two presets
      const prevOrder = presets[targetIndex - 1]?.order ?? 0;
      const nextOrder = presets[targetIndex]?.order ?? prevOrder + 2;
      newOrder = Math.floor((prevOrder + nextOrder) / 2);
      
      // If orders are consecutive, renumber the entire group
      if (newOrder === prevOrder || newOrder === nextOrder) {
        await renumberGroup(preset.group || "");
        // After renumbering, calculate new position again
        await refresh({ silent: true });
        return;
      }
    }

    const result = await updatePreset(preset.id, { order: newOrder });
    if (!result.ok) {
      notify(result.error || "调整顺序失败", "error");
      return;
    }
    
    await refresh({ silent: true });
  };

  const renumberGroup = async (groupName) => {
    // Renumber all presets in the group with gaps
    const groupPresets = presets.filter(p => (p.group || "") === groupName);
    const updates = groupPresets.map((p, index) => 
      updatePreset(p.id, { order: index * 10 })
    );
    
    await Promise.all(updates);
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
    previewTooltip.cleanup(); // Clean up preview tooltip
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
