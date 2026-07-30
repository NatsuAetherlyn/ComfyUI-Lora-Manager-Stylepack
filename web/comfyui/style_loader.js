/**
 * 风格加载器 (Style Loader) — ComfyUI frontend registration.
 *
 * Assembles four widgets into one node:
 *   1. `text`        — the host pack's Vue LoRA autocomplete (from the
 *                      AUTOCOMPLETE_TEXT_LORAS input type, no bundle changes)
 *   2. `style_text`  — a toggleable, manually resizable text box
 *   3. `presets`     — the preset panel (LoRA stack + text together)
 *   4. `loras`       — the host pack's LoRA list widget
 *
 * The host pack's modules are imported at runtime from its ComfyUI extension
 * URL. ComfyUI registers a static route per web directory keyed on the module
 * name, so we probe the known prefixes and fall back gracefully.
 */

import { app } from "../../scripts/app.js";

export const STYLE_LOADER_CLASS = "Style Loader (LoraManager)";
const STYLE_TEXT_WIDGET = "style_text";
const STYLE_STATE_WIDGET = "style_state";

// Announce ourselves before the host pack's utils.js evaluates, in case
// ComfyUI loads our script first. `registerLoraNodeClass` picks this up.
// `terminal: true` marks us as applying LoRAs to a model (like Lora Loader)
// rather than forwarding a LORA_STACK.
if (!Array.isArray(window.__LM_EXTRA_LORA_NODE_CLASSES)) {
  window.__LM_EXTRA_LORA_NODE_CLASSES = [];
}
window.__LM_EXTRA_LORA_NODE_CLASSES.push({
  name: STYLE_LOADER_CLASS,
  terminal: true,
});

// ComfyUI mounts each pack's web dir at /extensions/<name>/. Both the
// pyproject project name and the directory name get registered, and their
// casing differs, so try each.
const HOST_URL_PREFIXES = [
  "/extensions/ComfyUI-Lora-Manager/",
  "/extensions/comfyui-lora-manager/",
];

/**
 * Import a module from the host pack, trying each known URL prefix.
 * @param {string} relativePath - e.g. "utils.js"
 * @returns {Promise<Object>}
 */
async function importFromHost(relativePath) {
  const errors = [];
  for (const prefix of HOST_URL_PREFIXES) {
    try {
      return await import(`${prefix}${relativePath}`);
    } catch (error) {
      errors.push(`${prefix}${relativePath}: ${error?.message ?? error}`);
    }
  }
  throw new Error(
    `无法从主包加载 ${relativePath}。请确认 ComfyUI-Lora-Manager 已安装并启用。\n${errors.join(
      "\n"
    )}`
  );
}

/** Cache the resolved host modules; the node may be created many times. */
let hostModulesPromise = null;

function loadHostModules() {
  if (!hostModulesPromise) {
    hostModulesPromise = Promise.all([
      importFromHost("utils.js"),
      importFromHost("loras_widget.js"),
      importFromHost("lora_syntax_utils.js"),
      importFromHost("trigger_word_highlight.js"),
      importFromHost("lora_info.js"),
    ])
      .then(([utils, lorasWidget, syntaxUtils, highlight, loraInfo]) => ({
        utils,
        lorasWidget,
        syntaxUtils,
        highlight,
        loraInfo,
      }));
    // Deliberately not resetting the promise on failure: beforeRegisterNodeDef
    // runs once per session, so a retry could never be triggered anyway, and
    // caching the rejection keeps the error message stable for later callers.
  }
  return hostModulesPromise;
}

/**
 * Local copy of the host's chainCallback, for the error path where the host
 * modules could not be loaded at all.
 * @param {Object} target
 * @param {string} property
 * @param {Function} callback
 */
function chainCallbackFallback(target, property, callback) {
  const original = target[property];
  if (original) {
    target[property] = function () {
      const result = original.apply(this, arguments);
      callback.apply(this, arguments);
      return result;
    };
  } else {
    target[property] = callback;
  }
}

/** Load our stylesheet once. */
let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) {
    return;
  }
  stylesInjected = true;
  const id = "lmsp-style-loader-styles";
  if (document.getElementById(id)) {
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = new URL("./style_loader.css", import.meta.url).href;
  document.head.appendChild(link);
}

/**
 * Show a toast through ComfyUI, falling back to the console.
 * @param {string} message
 * @param {"success"|"info"|"warn"|"error"} severity
 */
function notify(message, severity = "info") {
  const toast = app?.extensionManager?.toast;
  if (toast?.add) {
    toast.add({
      severity,
      summary: "风格加载器",
      detail: message,
      life: severity === "error" ? 5000 : 3000,
    });
    return;
  }
  const level = severity === "error" ? "error" : "log";
  console[level](`[风格加载器] ${message}`);
}

/**
 * Add a hidden widget that persists our UI state in the workflow.
 *
 * Uses the host pack's convention for invisible widgets: `computeSize` returning
 * a negative height so LiteGraph allocates no row for it.
 *
 * @param {Object} node
 * @returns {Object} the widget
 */
function addStateWidget(node) {
  const widget = node.addWidget("text", STYLE_STATE_WIDGET, "", () => {});
  // `hidden` is what LiteGraph's isWidgetVisible/getLayoutWidgets check; the
  // negative computeSize height additionally keeps it out of canvas layout.
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  // Must stay serialized: a non-serialized widget positioned before a
  // serialized one desynchronises LiteGraph's serialize()/configure() index
  // conventions and corrupts every later widget value.
  widget.serialize = true;
  return widget;
}

/**
 * Serialise UI state into the hidden widget.
 * @param {Object} node
 */
function saveState(node) {
  const stateWidget = node.__lmspStateWidget;
  if (!stateWidget || !node.__lmspText) {
    return;
  }
  try {
    stateWidget.value = JSON.stringify({
      v: 1,
      enabled: node.__lmspText.isEnabled(),
      height: node.__lmspText.getTextHeight(),
    });
  } catch (error) {
    console.warn("[风格加载器] 无法保存状态", error);
  }
}

/**
 * Parse persisted UI state.
 * @param {*} raw
 * @returns {{enabled: boolean, height: number|undefined}}
 */
function parseState(raw) {
  if (typeof raw !== "string" || !raw) {
    return { enabled: false, height: undefined };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed?.enabled,
      height: Number.isFinite(Number(parsed?.height))
        ? Number(parsed.height)
        : undefined,
    };
  } catch {
    return { enabled: false, height: undefined };
  }
}

app.registerExtension({
  name: "LoraManagerStylepack.StyleLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeType.comfyClass !== STYLE_LOADER_CLASS) {
      return;
    }

    ensureStyles();

    let host;
    try {
      host = await loadHostModules();
    } catch (error) {
      // ComfyUI awaits this hook but still registers the node type afterwards.
      // Without the host modules the node cannot build its LoRA widget, so make
      // the failure visible on the node itself rather than leaving a node that
      // silently does nothing.
      console.error("[风格加载器]", error);
      notify(error.message, "error");

      chainCallbackFallback(nodeType.prototype, "onNodeCreated", function () {
        this.bgcolor = "#533";
        this.title = "风格加载器（主包未就绪）";
        const widget = this.addWidget(
          "text",
          "错误",
          "需要 ComfyUI-Lora-Manager",
          () => {}
        );
        widget.disabled = true;
      });
      return;
    }

    const {
      utils: {
        collectActiveLorasFromChain,
        updateConnectedTriggerWords,
        chainCallback,
        mergeLoras,
        getWidgetByName,
        getWidgetSerializedValue,
        registerLoraNodeClass,
      },
      lorasWidget: { addLorasWidget },
      syntaxUtils: { applyLoraValuesToText, debounce },
      highlight: { applySelectionHighlight },
      loraInfo: { updateConnectedLoraInfoNodes },
    } = host;

    // Register with the host pack so the standalone web UI lists this node as
    // a LoRA target and `lora_code_update` messages are accepted for it.
    if (typeof registerLoraNodeClass === "function") {
      registerLoraNodeClass(STYLE_LOADER_CLASS, { terminal: true });
    } else {
      console.warn(
        "[风格加载器] 主包版本较旧，缺少 registerLoraNodeClass；" +
          "独立网页前端的「发送到节点」可能不会列出本节点。"
      );
    }

    const [{ addStyleTextWidget, DEFAULT_TEXT_HEIGHT }, { addStylePresetsWidget }] =
      await Promise.all([
        import("./style_text_widget.js"),
        import("./style_presets_widget.js"),
      ]);

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      this.serialize_widgets = true;

      this.addInput("clip", "CLIP", { shape: 7 });
      this.addInput("lora_stack", "LORA_STACK", { shape: 7 });

      // Guards against the text↔loras sync callbacks re-entering each other.
      let isUpdating = false;
      let isSyncingInput = false;

      // Mirror the host loader: intercept mode changes so muting/bypassing the
      // node updates downstream trigger word toggles.
      const self = this;
      let currentMode = this.mode;
      Object.defineProperty(this, "mode", {
        get() {
          return currentMode;
        },
        set(value) {
          const previous = currentMode;
          currentMode = value;
          // Only react to real transitions. configure() assigns every
          // serialized property during graph load, and firing then would query
          // a chain whose links do not exist yet.
          if (previous !== value) {
            self.onModeChange?.(value, previous);
          }
        },
        configurable: true,
        enumerable: true,
      });

      this.onModeChange = function () {
        updateConnectedTriggerWords(self, collectActiveLorasFromChain(self));
      };

      const inputWidget = getWidgetByName(this, "text");
      if (!inputWidget) {
        console.warn("[风格加载器] 未找到 text 组件，LoRA 搜索框不可用");
        return;
      }
      this.inputWidget = inputWidget;

      // ---------------------------------------------------- text box widget
      const stateWidget = addStateWidget(this);
      this.__lmspStateWidget = stateWidget;

      const styleText = addStyleTextWidget(this, STYLE_TEXT_WIDGET, {
        enabled: false,
        onHeightChange: () => saveState(this),
      });
      this.__lmspText = styleText;

      // -------------------------------------------------- presets widget
      const presets = addStylePresetsWidget(this, "presets", {
        getLoras: () => this.lorasWidget?.value ?? [],
        getText: () => styleText.getText(),
        applyPreset: ({ loras, text }) => {
          isUpdating = true;
          try {
            const restored = (loras ?? []).map((lora) => ({
              name: lora.name,
              strength: Number(lora.strength ?? 1),
              clipStrength: Number(lora.clipStrength ?? lora.strength ?? 1),
              active: lora.active !== false,
              expanded: !!lora.expanded,
            }));

            this.lorasWidget.value = restored;

            // Rewrite the search box so its LoRA syntax matches the new stack.
            inputWidget.value = applyLoraValuesToText("", restored);

            // Loading a preset with text implies the box should be visible.
            styleText.setText(text ?? "");
            if (text && !styleText.isEnabled()) {
              styleText.setEnabled(true);
              saveState(this);
            }

            updateConnectedTriggerWords(this, collectActiveLorasFromChain(this));
          } finally {
            isUpdating = false;
          }
          this.setDirtyCanvas?.(true, true);
        },
        notify,
      });
      this.__lmspPresets = presets;

      // ------------------------------------------------------ loras widget
      // Added last so it is the bottom widget: in canvas mode it is the only
      // one without `computeSize`, so it absorbs all slack when the node grows.
      const scheduleInputSync = debounce((lorasValue) => {
        if (isSyncingInput) {
          return;
        }
        isSyncingInput = true;
        isUpdating = true;
        try {
          const nextText = applyLoraValuesToText(inputWidget.value, lorasValue);
          if (inputWidget.value !== nextText) {
            inputWidget.value = nextText;
          }
        } finally {
          isUpdating = false;
          isSyncingInput = false;
        }
      });

      this.lorasWidget = addLorasWidget(
        this,
        "loras",
        {
          onSelectionChange: (selection) => {
            applySelectionHighlight(this, selection);
            updateConnectedLoraInfoNodes(this, selection);
          },
        },
        (value) => {
          if (isUpdating) {
            return;
          }
          isUpdating = true;
          try {
            updateConnectedTriggerWords(this, collectActiveLorasFromChain(this));
          } finally {
            isUpdating = false;
          }
          scheduleInputSync(value);
        }
      ).widget;

      inputWidget.callback = (value) => {
        if (isUpdating) {
          return;
        }
        isUpdating = true;
        try {
          const merged = mergeLoras(value, this.lorasWidget.value || []);
          this.lorasWidget.value = merged;
          updateConnectedTriggerWords(this, collectActiveLorasFromChain(this));
        } finally {
          isUpdating = false;
        }
      };
    });

    // -------------------------------------------------------- context menu
    // Not using chainCallback here: LiteGraph reads the *return value* of
    // getExtraMenuOptions and prepends it to the menu
    // (`Array.isArray(n) && n.length > 0 && (n.push(null), t = n.concat(t))`).
    // chainCallback returns the original callback's value and discards ours,
    // and ComfyUI's own handler already returns [], so chaining would drop our
    // entries. Wrap manually and merge both return values instead.
    const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const inherited = originalGetExtraMenuOptions?.apply(this, arguments);
      const extra = Array.isArray(inherited) ? [...inherited] : [];

      const styleText = this.__lmspText;
      if (!styleText) {
        return extra;
      }

      const enabled = styleText.isEnabled();
      extra.push(
        {
          content: enabled ? "隐藏文本输入框" : "显示文本输入框",
          callback: () => {
            styleText.setEnabled(!enabled);
            saveState(this);
          },
        },
        {
          content: "重置文本框高度",
          disabled: !enabled,
          callback: () => {
            styleText.setTextHeight(DEFAULT_TEXT_HEIGHT);
            saveState(this);
          },
        },
        {
          content: "刷新预设列表",
          callback: () => {
            this.__lmspPresets?.refresh();
          },
        }
      );

      return extra;
    };
  },

  async loadedGraphNode(node) {
    if (node.comfyClass !== STYLE_LOADER_CLASS) {
      return;
    }

    const styleText = node.__lmspText;
    const stateWidget = node.__lmspStateWidget;

    // Restore the text box's visibility and height before touching the LoRA
    // list, so only one resize happens.
    if (styleText) {
      const { enabled, height } = parseState(stateWidget?.value);
      if (height !== undefined) {
        styleText.setTextHeight(height, { resize: false });
      }
      // Never leave restored text invisible with no way to discover it: a
      // workflow saved before the state widget existed has no `enabled` flag.
      const shouldEnable = enabled || !!styleText.getText().trim();
      styleText.setEnabled(shouldEnable, { resize: false });
      styleText.applyLayoutMode();
      if (shouldEnable !== enabled) {
        saveState(node);
      }
    }

    // Reconcile the saved LoRA array with the search box text, exactly as the
    // host loader does on load.
    try {
      const host = await loadHostModules();
      const { mergeLoras, getWidgetByName, getWidgetSerializedValue } = host.utils;

      let existingLoras = [];
      if (node.widgets_values && node.widgets_values.length > 0) {
        existingLoras = getWidgetSerializedValue(node, "loras") || [];
      }

      const inputWidget = node.inputWidget || getWidgetByName(node, "text");
      if (inputWidget && node.lorasWidget) {
        node.lorasWidget.value = mergeLoras(inputWidget.value, existingLoras);
      }
    } catch (error) {
      console.warn("[风格加载器] 恢复 LoRA 列表失败", error);
    }

    if (typeof node.computeSize === "function") {
      const computed = node.computeSize();
      const width = node.size?.[0] ?? computed[0];
      node.setSize([Math.max(width, computed[0]), Math.max(node.size?.[1] ?? 0, computed[1])]);
    }
    node.setDirtyCanvas?.(true, true);
  },
});
