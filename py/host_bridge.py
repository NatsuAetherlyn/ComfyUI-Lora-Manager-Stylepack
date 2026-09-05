"""Locate and reuse the host ComfyUI-Lora-Manager package.

The Style Loader deliberately does not copy the host pack's LoRA loading
logic. Instead it resolves the already-imported host package at runtime and
borrows the internal helpers from ``py.nodes.lora_loader``. That keeps LoRA
loading behaviour (Nunchaku detection, clip strength handling, trigger word
collection) in lockstep with the host pack as it is updated.

ComfyUI loads custom nodes via ``importlib.util.spec_from_file_location`` with
a mangled module name (``load_custom_node`` in nodes.py uses
``module_path.replace(".", "_x_")``), so the host package is *not* importable
by a predictable dotted name. Resolution therefore happens in three stages:

1. Scan ``sys.modules`` for an already-loaded module whose ``__file__`` is the
   host pack's ``__init__.py``. This is the normal path — the host pack sorts
   before this one alphabetically, so ComfyUI always loads it first.
2. Fall back to locating the sibling directory on disk and importing it under
   a private module name.
3. Give up, record the reason, and let the node surface a clear error at
   execution time rather than breaking ComfyUI startup.
"""

from __future__ import annotations

import importlib
import importlib.util
import logging
import os
import sys
from types import ModuleType
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

HOST_DIR_NAME = "ComfyUI-Lora-Manager"

# Private module name used only by the on-disk fallback import.
_FALLBACK_MODULE_NAME = "_lm_stylepack_host"

# Helpers borrowed from the host pack's lora_loader module. These are private
# (underscore-prefixed) upstream, so a rename is a realistic breakage. Each is
# validated at resolve time and a missing name degrades to a clear error
# instead of an AttributeError deep inside execution.
_REQUIRED_LOADER_HELPERS = (
    "_collect_stack_entries",
    "_collect_widget_entries",
    "_apply_entries",
    "_format_loaded_loras",
)


class HostBridgeError(RuntimeError):
    """Raised when the host LoRA Manager package cannot be used."""


class _HostBridge:
    """Lazily resolves the host package and caches the result."""

    def __init__(self) -> None:
        self._root: Optional[ModuleType] = None
        self._resolved = False
        self._error: Optional[str] = None

    # ---------------------------------------------------------------- resolve

    def _stylepack_dir(self) -> str:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def _expected_host_dir(self) -> str:
        return os.path.join(os.path.dirname(self._stylepack_dir()), HOST_DIR_NAME)

    def _find_in_sys_modules(self) -> Optional[ModuleType]:
        """Return the host package if ComfyUI already imported it."""
        host_init = os.path.normcase(
            os.path.join(self._expected_host_dir(), "__init__.py")
        )

        for module in list(sys.modules.values()):
            if module is None:
                continue
            module_file = getattr(module, "__file__", None)
            if not module_file:
                continue
            if os.path.normcase(os.path.abspath(module_file)) == host_init:
                return module
        return None

    def _import_from_disk(self) -> Optional[ModuleType]:
        """Import the host package directly as a last resort."""
        host_dir = self._expected_host_dir()
        init_path = os.path.join(host_dir, "__init__.py")
        if not os.path.isfile(init_path):
            return None

        existing = sys.modules.get(_FALLBACK_MODULE_NAME)
        if existing is not None:
            return existing

        # The host package uses relative imports, so its directory must be
        # importable as a package root for submodule resolution to work.
        parent_dir = os.path.dirname(host_dir)
        if parent_dir not in sys.path:
            sys.path.append(parent_dir)

        spec = importlib.util.spec_from_file_location(
            _FALLBACK_MODULE_NAME,
            init_path,
            submodule_search_locations=[host_dir],
        )
        if spec is None or spec.loader is None:
            return None

        module = importlib.util.module_from_spec(spec)
        sys.modules[_FALLBACK_MODULE_NAME] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(_FALLBACK_MODULE_NAME, None)
            raise
        return module

    def resolve(self) -> Optional[ModuleType]:
        """Resolve and cache the host package root module."""
        if self._resolved:
            return self._root

        self._resolved = True
        try:
            root = self._find_in_sys_modules()
            if root is None:
                logger.debug(
                    "[Style Loader] host pack not in sys.modules, trying disk import"
                )
                root = self._import_from_disk()

            if root is None:
                self._error = (
                    f"Could not locate the '{HOST_DIR_NAME}' package. Expected it at "
                    f"{self._expected_host_dir()}. The Style Loader requires "
                    "ComfyUI-Lora-Manager to be installed and enabled."
                )
                logger.warning("[Style Loader] %s", self._error)
                return None

            self._root = root
            return root
        except Exception as exc:  # pragma: no cover - defensive
            self._error = f"Failed to load the host LoRA Manager package: {exc}"
            # Only a debug-level traceback: the common cause is running outside
            # ComfyUI (no `server` module), which is expected and non-fatal.
            logger.warning("[Style Loader] %s", self._error)
            logger.debug("[Style Loader] host resolution traceback", exc_info=True)
            return None

    # ------------------------------------------------------------ submodules

    def import_submodule(self, relative_name: str) -> Optional[ModuleType]:
        """Import ``relative_name`` (e.g. ``py.nodes.lora_loader``) from the host."""
        root = self.resolve()
        if root is None:
            return None

        root_name = getattr(root, "__name__", None)
        if not root_name:
            return None

        try:
            return importlib.import_module(f"{root_name}.{relative_name}")
        except Exception as exc:
            self._error = (
                f"Host module '{relative_name}' could not be imported: {exc}"
            )
            logger.warning("[Style Loader] %s", self._error, exc_info=True)
            return None

    @property
    def error(self) -> Optional[str]:
        return self._error

    def set_error(self, message: str) -> None:
        self._error = message


_bridge = _HostBridge()


def get_host_error() -> Optional[str]:
    """Return the reason the host pack is unusable, or None if it is fine."""
    return _bridge.error


def require(message: Optional[str] = None) -> None:
    """Raise :class:`HostBridgeError` if the host pack is not usable."""
    detail = message or _bridge.error or "Host LoRA Manager package unavailable."
    raise HostBridgeError(detail)


# --------------------------------------------------------------------- API


def get_loader_helpers() -> dict[str, Callable[..., Any]]:
    """Return the LoRA loading helpers borrowed from the host pack.

    Raises:
        HostBridgeError: if the host pack or any required helper is missing.
    """
    module = _bridge.import_submodule("py.nodes.lora_loader")
    if module is None:
        require()

    helpers: dict[str, Callable[..., Any]] = {}
    missing: list[str] = []
    for name in _REQUIRED_LOADER_HELPERS:
        func = getattr(module, name, None)
        if callable(func):
            helpers[name] = func
        else:
            missing.append(name)

    if missing:
        message = (
            "The installed ComfyUI-Lora-Manager is missing expected internals "
            f"({', '.join(missing)}) in py/nodes/lora_loader.py. The Style Loader "
            "may need an update to match this host version."
        )
        _bridge.set_error(message)
        require(message)

    return helpers


def get_node_utils() -> ModuleType:
    """Return the host pack's ``py.nodes.utils`` module."""
    module = _bridge.import_submodule("py.nodes.utils")
    if module is None:
        require()
    return module


def get_settings_dir() -> str:
    """Return the Stylepack preset directory inside the ComfyUI user folder.

    Presets are deliberately kept in ``<ComfyUI>/user/lora_manager_stylepack``
    rather than the host pack's settings directory so they survive host
    updates and live under the ComfyUI root alongside the rest of the install.
    """
    try:
        import folder_paths  # type: ignore

        target = os.path.join(
            folder_paths.get_user_directory(), "lora_manager_stylepack"
        )
    except ImportError:
        # Running outside ComfyUI (e.g. under pytest) — stay local.
        target = os.path.join(_bridge._stylepack_dir(), "data")

    os.makedirs(target, exist_ok=True)
    return target


def register_metadata_extractor(class_name: str) -> bool:
    """Register the Style Loader with the host's metadata collector.

    The host stores extractors keyed by python class name and looks them up via
    ``NODE_EXTRACTORS.get(class_type, GenericNodeExtractor)``. Reusing
    ``LoraLoaderManagerExtractor`` means saved images record Style Loader LoRAs
    exactly as they would for the stock Lora Loader.

    Returns:
        True when the extractor was registered.
    """
    module = _bridge.import_submodule("py.metadata_collector.node_extractors")
    if module is None:
        return False

    registry = getattr(module, "NODE_EXTRACTORS", None)
    extractor = getattr(module, "LoraLoaderManagerExtractor", None)
    if not isinstance(registry, dict) or extractor is None:
        logger.warning(
            "[Style Loader] host metadata collector layout changed; "
            "LoRA metadata will not be recorded for %s",
            class_name,
        )
        return False

    registry.setdefault(class_name, extractor)
    logger.debug("[Style Loader] registered metadata extractor for %s", class_name)
    return True


def get_flexible_optional_input_type() -> Any:
    """Return an instance of the host's ``FlexibleOptionalInputType``.

    This is what lets the JS-only ``loras`` / ``style_text`` widgets reach
    python without declaring matching inputs.
    """
    utils = get_node_utils()
    flexible = getattr(utils, "FlexibleOptionalInputType", None)
    any_type = getattr(utils, "any_type", None)
    if flexible is None or any_type is None:
        message = (
            "Host py/nodes/utils.py is missing FlexibleOptionalInputType/any_type."
        )
        _bridge.set_error(message)
        require(message)
    return flexible(any_type)
