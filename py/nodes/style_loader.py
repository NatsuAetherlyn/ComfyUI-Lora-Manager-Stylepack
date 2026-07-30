"""Style Loader node — LoRA loading plus a preset-backed text output.

Behaves like the host pack's ``Lora Loader (LoraManager)`` (same widgets, same
MODEL/CLIP handling, same trigger word collection) and adds a fifth output that
emits the contents of the node's text box. Combined with the preset panel, this
lets a single saved preset restore both a LoRA stack and its accompanying
trigger words / artist string.

LoRA loading itself is delegated to the host pack's helpers via
``host_bridge`` rather than reimplemented, so behaviour stays in sync upstream.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from ..host_bridge import HostBridgeError, get_loader_helpers, get_node_utils

logger = logging.getLogger(__name__)

# Widget name for the multiline text box. Declared only on the frontend and
# delivered through FlexibleOptionalInputType, matching how `loras` works.
STYLE_TEXT_WIDGET = "style_text"


def _read_widget_value(kwargs: Dict[str, Any], key: str) -> Any:
    """Read a DOM widget value, unwrapping the newer ``__value__`` envelope.

    Newer ComfyUI frontends serialise DOM widget values as
    ``{"__value__": ...}`` while older ones send the bare value. The host pack
    handles both in ``get_loras_list``; do the same for our text widget.
    """
    if key not in kwargs:
        return None
    value = kwargs[key]
    if isinstance(value, dict) and "__value__" in value:
        return value["__value__"]
    return value


def _extract_style_text(kwargs: Dict[str, Any]) -> str:
    """Return the text box contents as a plain string."""
    value = _read_widget_value(kwargs, STYLE_TEXT_WIDGET)

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        # Defensive: some frontend versions wrap single widget values in a list.
        return "\n".join(str(item) for item in value if item is not None)
    return str(value)


class StyleLoaderLM:
    """Load LoRAs and emit an associated preset text string."""

    # ASCII class identifier. The Chinese label is supplied through
    # NODE_DISPLAY_NAME_MAPPINGS so saved workflows stay portable and the host
    # pack's metadata collector (which keys on the python class name) works.
    NAME = "Style Loader (LoraManager)"
    CATEGORY = "Lora Manager/loaders"
    DESCRIPTION = (
        "Load LoRAs like the standard Lora Loader, plus a toggleable text box. "
        "Presets save the LoRA stack and the text together."
    )

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        # Import lazily: INPUT_TYPES runs on every /object_info request, and a
        # missing host pack must not raise here or the node list breaks.
        try:
            utils = get_node_utils()
            optional: Any = utils.FlexibleOptionalInputType(utils.any_type)
        except (HostBridgeError, AttributeError) as exc:
            logger.warning(
                "[Style Loader] host utils unavailable (%s); falling back to "
                "static optional inputs",
                exc,
            )
            optional = {
                "clip": ("CLIP",),
                "lora_stack": ("LORA_STACK",),
            }

        return {
            "required": {
                "model": ("MODEL",),
                # Reusing the host pack's registered input type gives us its
                # Vue LoRA autocomplete widget with no bundle changes. The
                # widget name must be "text" — the host factory hardcodes it.
                "text": (
                    "AUTOCOMPLETE_TEXT_LORAS",
                    {
                        "placeholder": "Search LoRAs to add...",
                        "tooltip": (
                            "Format: <lora:lora_name:strength> separated by "
                            "spaces or punctuation"
                        ),
                    },
                ),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "触发词", "已加载Lora", "预设文本")
    FUNCTION = "load_style"

    def load_style(
        self, model: Any, text: str, **kwargs: Any
    ) -> Tuple[Any, Any, str, str, str]:
        """Apply LoRAs to the model/clip and return the preset text."""
        # `text` is the LoRA search box. Like the host loader, it is a UI
        # affordance only — the authoritative LoRA list is the `loras` widget.
        del text

        style_text = _extract_style_text(kwargs)
        clip = kwargs.get("clip", None)

        helpers = get_loader_helpers()
        collect_stack = helpers["_collect_stack_entries"]
        collect_widgets = helpers["_collect_widget_entries"]
        apply_entries = helpers["_apply_entries"]
        format_loaded = helpers["_format_loaded_loras"]

        lora_entries: List[Dict[str, Any]] = collect_stack(kwargs.get("lora_stack"))
        lora_entries.extend(collect_widgets(kwargs))

        nunchaku_kind = self._detect_nunchaku_kind(model)

        model, clip, loaded_loras, trigger_words = apply_entries(
            model, clip, lora_entries, nunchaku_kind
        )

        trigger_words_text = ",, ".join(trigger_words) if trigger_words else ""
        loaded_loras_text = format_loaded(loaded_loras)

        return (model, clip, trigger_words_text, loaded_loras_text, style_text)

    @staticmethod
    def _detect_nunchaku_kind(model: Any) -> Any:
        """Detect Nunchaku model variants, mirroring the host loader."""
        try:
            utils = get_node_utils()
            detect = getattr(utils, "detect_nunchaku_model_kind", None)
            if callable(detect):
                kind = detect(model)
                if kind == "flux":
                    logger.info("[Style Loader] detected Nunchaku Flux model")
                elif kind == "qwen_image":
                    logger.info("[Style Loader] detected Nunchaku Qwen-Image model")
                return kind
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("[Style Loader] Nunchaku detection skipped: %s", exc)
        return None
