"""ComfyUI-Lora-Manager-Stylepack — the 风格加载器 (Style Loader) subnode.

An optional companion pack for ComfyUI-Lora-Manager, in the same spirit as
ComfyUI-Impact-Subpack. It adds one node that behaves like the host pack's
Lora Loader while also carrying a text box and saving both to named presets.

Startup is intentionally forgiving: if the host pack is missing or its
internals have moved, the node still registers and reports a clear error at
execution time instead of breaking ComfyUI's node list.
"""

import logging

logging.getLogger(__name__)
logger = logging.getLogger("lora_manager_stylepack")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web/comfyui"

try:
    from .py.nodes.style_loader import StyleLoaderLM

    NODE_CLASS_MAPPINGS[StyleLoaderLM.NAME] = StyleLoaderLM
    NODE_DISPLAY_NAME_MAPPINGS[StyleLoaderLM.NAME] = "风格加载器"

    # Record LoRA metadata for saved images by reusing the host pack's
    # extractor. Keyed on the python class name, which is how the host's
    # metadata registry resolves extractors.
    try:
        from .py.host_bridge import register_metadata_extractor

        register_metadata_extractor(StyleLoaderLM.__name__)
    except Exception as exc:  # pragma: no cover - non-fatal
        logger.warning(
            "[Style Loader] metadata collector integration unavailable: %s", exc
        )

    # Register the preset API on ComfyUI's aiohttp app. The host pack has
    # already installed its JSON error middleware by this point, so our
    # /api/* routes inherit consistent error responses.
    try:
        from server import PromptServer  # type: ignore

        from .py.routes.style_preset_routes import StylePresetRoutes

        if PromptServer.instance is not None:
            StylePresetRoutes.setup_routes(PromptServer.instance.app)
        else:  # pragma: no cover - defensive
            logger.warning(
                "[Style Loader] PromptServer not ready; preset API not registered"
            )
    except ImportError as exc:
        # Running outside ComfyUI (e.g. under pytest) — nodes still import.
        logger.debug("[Style Loader] server unavailable, skipping routes: %s", exc)
    except Exception as exc:
        logger.error("[Style Loader] failed to register preset routes: %s", exc)

    logger.info("[Style Loader] 风格加载器 registered")

except Exception as exc:  # pragma: no cover - keep ComfyUI booting
    logger.error("[Style Loader] failed to load: %s", exc, exc_info=True)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
