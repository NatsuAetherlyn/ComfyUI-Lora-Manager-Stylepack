/**
 * Toggleable, manually resizable text box for the Style Loader node.
 *
 * ## Sizing contract
 *
 * This widget owns a *fixed* height. It never grows or shrinks in response to
 * node resizing — enlarging the node lengthens the LoRA list instead, exactly
 * like the stock Lora Loader. Only the drag handle at the bottom of the text
 * box changes its height.
 *
 * Implementation, per the host pack's docs/comfyui-dual-mode-widgets.md:
 *
 * - Canvas mode: define `computeSize()` and delete `computeLayoutSize`.
 *   The host doc notes "widgets with computeSize get fixed height" while
 *   widgets exposing `computeLayoutSize` participate in `distributeSpace()`.
 *   Since the LoRA widget keeps `computeLayoutSize`, it absorbs all slack —
 *   so no blank space can appear at the bottom of the node.
 *
 * - Vue mode: the parent is a CSS grid; pin our row to `min-content` and use
 *   `contain: layout size` so the ResizeObserver feedback loop cannot fire.
 *
 * - We never set `max-height` or `getMaxHeight()`. The host doc is explicit
 *   that those are what cause a node's size to spring back after a resize.
 *
 * - `node.setSize()` is called *only* from discrete user actions (toggling the
 *   box, finishing a drag). Nothing in the render path resizes the node, which
 *   is what prevents the "size reverts a moment later" failure mode.
 */

/** Always-visible header row carrying the show/hide toggle. */
export const HEADER_HEIGHT = 26;
export const DEFAULT_TEXT_HEIGHT = 96;
export const MIN_TEXT_HEIGHT = 48;
export const MAX_TEXT_HEIGHT = 600;
const RESIZE_HANDLE_HEIGHT = 8;

/**
 * True when ComfyUI is rendering nodes through the Vue "Nodes 2.0" path.
 * @returns {boolean}
 */
export function isVueNodesMode() {
  return typeof LiteGraph !== "undefined" && !!LiteGraph.vueNodesMode;
}

/**
 * Clamp a requested text box height into the allowed range.
 * @param {number} value
 * @returns {number}
 */
export function clampTextHeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_TEXT_HEIGHT;
  }
  return Math.min(MAX_TEXT_HEIGHT, Math.max(MIN_TEXT_HEIGHT, Math.round(numeric)));
}

/**
 * Total widget height for a given state, including the drag handle.
 * @param {boolean} enabled
 * @param {number} textHeight
 * @returns {number}
 */
export function computeWidgetHeight(enabled, textHeight) {
  // The header stays visible when collapsed so the toggle is always reachable
  // on the node itself, not only through the context menu.
  if (!enabled) {
    return HEADER_HEIGHT;
  }
  return HEADER_HEIGHT + clampTextHeight(textHeight) + RESIZE_HANDLE_HEIGHT;
}

/**
 * Add the style text widget to a node.
 *
 * @param {Object} node - LiteGraph node instance.
 * @param {string} name - Widget name (serialised into the workflow).
 * @param {Object} [opts]
 * @param {string} [opts.value] - Initial text.
 * @param {boolean} [opts.enabled] - Initial visibility. Defaults to false.
 * @param {number} [opts.height] - Initial text box height in px.
 * @param {string} [opts.placeholder]
 * @param {Function} [opts.onChange] - Called with the text on every edit.
 * @returns {{widget: Object, setEnabled: Function, isEnabled: Function,
 *            getText: Function, setText: Function, setTextHeight: Function,
 *            getTextHeight: Function, applyLayoutMode: Function}}
 */
export function addStyleTextWidget(node, name, opts = {}) {
  let enabled = !!opts.enabled;
  let textHeight = clampTextHeight(opts.height ?? DEFAULT_TEXT_HEIGHT);

  // ---------------------------------------------------------------- DOM
  const container = document.createElement("div");
  container.className = "lmsp-text-container";

  // Always-visible header with the show/hide toggle. Without this the only way
  // to reveal the box was the right-click menu, which is not discoverable.
  const header = document.createElement("div");
  header.className = "lmsp-text-header";

  const chevron = document.createElement("span");
  chevron.className = "lmsp-text-chevron";

  const headerLabel = document.createElement("span");
  headerLabel.className = "lmsp-text-header-label";
  headerLabel.textContent = "预设文本";

  const headerHint = document.createElement("span");
  headerHint.className = "lmsp-text-header-hint";

  const headerLeft = document.createElement("div");
  headerLeft.className = "lmsp-text-header-left";
  headerLeft.appendChild(chevron);
  headerLeft.appendChild(headerLabel);
  headerLeft.appendChild(headerHint);

  const toggleSwitch = document.createElement("button");
  toggleSwitch.type = "button";
  toggleSwitch.className = "lmsp-text-switch";
  toggleSwitch.tabIndex = -1;

  const toggleKnob = document.createElement("span");
  toggleKnob.className = "lmsp-text-switch-knob";
  toggleSwitch.appendChild(toggleKnob);

  header.appendChild(headerLeft);
  header.appendChild(toggleSwitch);

  const textarea = document.createElement("textarea");
  textarea.className = "lmsp-textarea";
  textarea.placeholder =
    opts.placeholder ?? "输入触发词、画师串等文本，将从「预设文本」端口输出";
  textarea.spellcheck = false;
  textarea.value = typeof opts.value === "string" ? opts.value : "";
  // Let the textarea scroll internally, and keep ComfyUI's canvas zoom handler
  // from stealing the wheel while the caret is inside.
  textarea.dataset.captureWheel = "true";

  const handle = document.createElement("div");
  handle.className = "lmsp-text-resize-handle";
  handle.title = "拖动调整文本框高度";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", "调整文本框高度");
  handle.tabIndex = -1;

  const body = document.createElement("div");
  body.className = "lmsp-text-body";
  body.appendChild(textarea);
  body.appendChild(handle);

  container.appendChild(header);
  container.appendChild(body);

  // -------------------------------------------------------------- widget
  const widget = node.addDOMWidget(name, "custom", container, {
    getValue: () => textarea.value,
    setValue: (value) => {
      textarea.value = typeof value === "string" ? value : "";
    },
    hideOnZoom: true,
    selectOn: ["click", "focus"],
  });

  widget.serialize = true;

  /**
   * Reapply the layout strategy for the current render mode.
   *
   * Called on creation, whenever the height or enabled state changes, and when
   * the host pack broadcasts a Vue-mode switch (the host rewrites the node's
   * grid-template-rows at that point, so our row pin must be restored).
   */
  const applyLayoutMode = () => {
    const height = computeWidgetHeight(enabled, textHeight);

    // The container (and its header) is always shown; only the body collapses.
    container.style.height = `${height}px`;
    body.style.display = enabled ? "flex" : "none";
    textarea.style.height = `${clampTextHeight(textHeight)}px`;

    // Reflect state on the toggle and give a hint when there is hidden content.
    toggleSwitch.classList.toggle("lmsp-text-switch--on", enabled);
    toggleSwitch.title = enabled ? "隐藏文本输入框" : "显示文本输入框";
    toggleSwitch.setAttribute("aria-label", toggleSwitch.title);
    toggleSwitch.setAttribute("role", "switch");
    toggleSwitch.setAttribute("aria-checked", enabled ? "true" : "false");
    chevron.textContent = enabled ? "▾" : "▸";

    const charCount = textarea.value.length;
    headerHint.textContent = !enabled && charCount > 0 ? `(${charCount} 字)` : "";

    // `computeLayoutSize` is a method on DOMWidgetImpl.prototype, so `delete`
    // would be a no-op and the widget would keep competing for slack. Assign
    // undefined to shadow it instead — the same technique the host bundle's
    // applyAutocompleteTextLayoutFix uses.
    if (isVueNodesMode()) {
      // Vue mode measures DOM to size grid rows. `contain: layout size` (from
      // the stylesheet) plus an explicit pixel height keeps that measurement
      // constant, so the observer loop settles immediately.
      container.classList.add("lmsp-vue-node");
      delete widget.computeSize;
      widget.computeLayoutSize = () => ({
        minHeight: height,
        maxHeight: height,
        minWidth: 0,
      });
      pinVueGridRow();
    } else {
      container.classList.remove("lmsp-vue-node");
      // Canvas mode: LiteGraph checks computeSize first and gives such widgets
      // exactly that height, excluding them from slack distribution.
      widget.computeLayoutSize = undefined;
      widget.computeSize = (width) => [width ?? 0, height];
    }
  };

  /**
   * Keep this widget's grid row from stretching in Vue mode.
   *
   * The host bundle rewrites the node's `grid-template-rows` on mode switch,
   * assigning `auto` to rows it does not recognise — ours included. An `auto`
   * row would let the box stretch as the node grows, so pin our row's own
   * track and stop the child from filling it.
   */
  const pinVueGridRow = () => {
    const row = container.closest('[data-testid="node-widget"]');
    if (!row) {
      return;
    }
    row.style.alignSelf = "start";
    row.style.height = `${computeWidgetHeight(enabled, textHeight)}px`;
  };

  // ------------------------------------------------------------ resizing
  /**
   * Grow or shrink the node by exactly how much this widget's height changed.
   *
   * Deliberately *not* `node.setSize(node.computeSize())`: computeSize() returns
   * the node's *minimum* height, so snapping to it would discard whatever extra
   * space the user had dragged out — the node would collapse to its default on
   * every toggle. Applying a delta keeps the LoRA list exactly as tall as the
   * user left it.
   *
   * @param {number} delta - Change in this widget's height, in pixels.
   */
  const growNodeBy = (delta) => {
    if (!delta || typeof node.setSize !== "function") {
      return;
    }

    const currentWidth = node.size?.[0] ?? 0;
    const currentHeight = node.size?.[1] ?? 0;
    let nextHeight = currentHeight + delta;

    // Still respect the node's minimum so shrinking cannot clip other widgets.
    if (typeof node.computeSize === "function") {
      const minHeight = node.computeSize()[1];
      if (nextHeight < minHeight) {
        nextHeight = minHeight;
      }
    }

    if (nextHeight !== currentHeight) {
      node.setSize([currentWidth, nextHeight]);
    }
    node.setDirtyCanvas?.(true, true);
  };

  const setTextHeight = (value, { resize = true } = {}) => {
    const next = clampTextHeight(value);
    if (next === textHeight) {
      return textHeight;
    }
    const before = computeWidgetHeight(enabled, textHeight);
    textHeight = next;
    applyLayoutMode();
    if (resize) {
      growNodeBy(computeWidgetHeight(enabled, textHeight) - before);
    }
    return textHeight;
  };

  const setEnabled = (value, { resize = true } = {}) => {
    const next = !!value;
    if (next === enabled) {
      return enabled;
    }
    const before = computeWidgetHeight(enabled, textHeight);
    enabled = next;
    applyLayoutMode();
    if (resize) {
      growNodeBy(computeWidgetHeight(enabled, textHeight) - before);
    }
    return enabled;
  };

  // Drag handle: pointer capture so the drag survives fast movement and the
  // pointer leaving the element.
  let dragPointerId = null;
  let dragStartY = 0;
  let dragStartHeight = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = textHeight;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("lmsp-text-resize-handle--active");
    document.body.classList.add("lmsp-text-resizing");
  });

  handle.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    // Scale the delta by canvas zoom so dragging tracks the cursor 1:1.
    const scale = node.graph?.canvas?.ds?.scale ?? window.app?.canvas?.ds?.scale ?? 1;
    const divisor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const delta = (event.clientY - dragStartY) / divisor;

    // Update the DOM live but defer the single node.setSize to pointerup, so
    // the drag cannot fight LiteGraph's own layout pass.
    textHeight = clampTextHeight(dragStartHeight + delta);
    applyLayoutMode();
  });

  const endDrag = (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    dragPointerId = null;
    handle.classList.remove("lmsp-text-resize-handle--active");
    document.body.classList.remove("lmsp-text-resizing");

    // pointermove mutated textHeight directly (to keep the DOM live without
    // resizing the node mid-drag), so settle up with a single delta here.
    if (enabled) {
      growNodeBy(
        computeWidgetHeight(enabled, textHeight) -
          computeWidgetHeight(enabled, dragStartHeight)
      );
    }
    opts.onHeightChange?.(textHeight);
  };

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  // ------------------------------------------------------------- events
  const handleToggleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEnabled(!enabled);
    opts.onToggle?.(enabled);
  };

  toggleSwitch.addEventListener("click", handleToggleClick);
  // Clicking the label area toggles too — the whole header is the affordance.
  headerLeft.addEventListener("click", handleToggleClick);

  textarea.addEventListener("input", () => {
    // Keeps the collapsed-state character hint accurate.
    const charCount = textarea.value.length;
    headerHint.textContent = !enabled && charCount > 0 ? `(${charCount} 字)` : "";
    opts.onChange?.(textarea.value);
  });

  // Keep typing from reaching the canvas as shortcuts (delete, arrows, etc).
  textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });

  // Re-apply layout when the host bundle switches render mode; it rewrites the
  // node's grid rows at that moment. The host dispatches this on `document`
  // with bubbles:false, so it must be observed there — a window listener never
  // fires.
  const onVueModeChange = () => applyLayoutMode();
  document.addEventListener("lora-manager:vue-mode-change", onVueModeChange);

  const originalOnRemove = widget.onRemove?.bind(widget);
  widget.onRemove = () => {
    document.removeEventListener(
      "lora-manager:vue-mode-change",
      onVueModeChange
    );
    originalOnRemove?.();
  };

  applyLayoutMode();

  return {
    widget,
    element: container,
    textarea,
    setEnabled,
    isEnabled: () => enabled,
    getText: () => textarea.value,
    setText: (value) => {
      textarea.value = typeof value === "string" ? value : "";
      opts.onChange?.(textarea.value);
    },
    getTextHeight: () => textHeight,
    setTextHeight,
    applyLayoutMode,
  };
}
