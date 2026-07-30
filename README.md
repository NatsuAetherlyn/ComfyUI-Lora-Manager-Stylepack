# ComfyUI-Lora-Manager-Stylepack — 风格加载器

[ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) 的可选附属包，
形态类似 `ComfyUI-Impact-Subpack` 与 `ComfyUI-Impact-Pack` 的关系：主包不含本节点，
装上这个目录才会出现。

## 节点：风格加载器

内部类名 `Style Loader (LoraManager)`，菜单显示为**风格加载器**，
位于 `Lora Manager/loaders` 分类下。

默认行为与主包的「Lora 加载器」一致，额外提供一个可开关的文本框和预设功能。

### 端口

| 输出 | 类型 | 说明 |
|---|---|---|
| MODEL | MODEL | 已套用 LoRA 的模型 |
| CLIP | CLIP | 已套用 LoRA 的 CLIP |
| 触发词 | STRING | 所有已启用 LoRA 的触发词 |
| 已加载Lora | STRING | `<lora:name:strength>` 语法串 |
| **预设文本** | STRING | **文本框内容** |

输入：`model`（必需）、`clip`、`lora_stack`（可选）。LoRA 搜索框、LoRA 列表与
文本框都是前端组件。

### 文本框

- **默认关闭**，节点上常驻一行「预设文本」标题栏，右侧有开关；点标题或开关即可展开。
  （右键菜单里也有同样的开关，作为备用入口。）
- 关闭且内有文本时，标题栏会显示 `(N 字)` 提示，不会让内容藏得无声无息。
- 开启时节点会自动长高一次，不会出现文本框超出节点的情况。
- **放大节点只会拉长 LoRA 列表，文本框高度不变** —— 与 Lora 加载器的手感一致。
- 文本框只能通过它下方的拖动手柄改变高度。
- 开关状态与高度随工作流保存。

实现上刻意不使用 `max-height` / `getMaxHeight()`：主包的
`docs/comfyui-dual-mode-widgets.md` 明确指出那是「节点尺寸改完又自己弹回去」的根因。
Canvas 模式下文本框声明 `computeSize` 拿到固定高度，LoRA 列表不声明因而吸收所有富余
空间（所以不会留白）；Vue 模式下改用 `contain: layout size` 打断 ResizeObserver 回环。
`node.setSize()` 只在离散用户操作（开关、拖拽结束）时调用一次，渲染路径中完全不调用。

### 预设

预设**同时保存 LoRA 栈和文本框内容**，载入时两者一起恢复 —— 不会出现「存到后来只剩
文本」的情况。每条 LoRA 记录 `name / strength / clipStrength / active / expanded`。

节点内预设面板支持：保存（同名时询问是否覆盖）、展开查看内容、载入（覆盖前确认）、
重命名、删除。

存储位置为 LoRA Manager 设置目录下的 `style_presets.json`，与主包自身的预设文件互不
干扰。写入采用临时文件 + `os.replace` 的原子替换；文件损坏时会重命名为
`.corrupt` 保留而非直接丢弃。

API：

```
GET    /api/lm/style-presets
POST   /api/lm/style-presets           {name, text, loras, overwrite?}
PUT    /api/lm/style-presets/{id}      {name?, text?, loras?}
DELETE /api/lm/style-presets/{id}
```

## 与主包的关系

**Python**：`py/host_bridge.py` 在运行时定位已加载的主包，直接复用
`py/nodes/lora_loader.py` 的内部辅助函数，不复制 LoRA 加载逻辑 —— 主包升级后
Nunchaku 检测、clip 强度处理等行为自动跟随。主包缺失时节点仍会注册，并在执行时
给出明确错误，不会让 ComfyUI 启动失败。

**前端**：从 `/extensions/ComfyUI-Lora-Manager/` 动态导入主包的
`loras_widget.js` 等模块（同时探测小写前缀作为降级）。

**独立网页前端联动**：主包新增了通用扩展点 `registerLoraNodeClass()`，本包据此注册
自己。注册后独立网页 UI 的「发送到节点」列表会包含风格加载器，`lora_code_update`
消息也会被正确接受。

> 本包不修改主包的 Vue widget bundle。`AUTOCOMPLETE_TEXT_LORAS` 是按**输入类型**
> 注册的，所以声明该输入即可获得 LoRA 搜索框。

## 与官方未修改主包的兼容性

**兼容。** 本包只从主包导入官方就有的导出：`utils.js` 的
`collectActiveLorasFromChain` / `updateConnectedTriggerWords` / `chainCallback` /
`mergeLoras` / `getWidgetByName` / `getWidgetSerializedValue`、
`loras_widget.js` 的 `addLorasWidget`、`lora_syntax_utils.js` 的
`applyLoraValuesToText` / `debounce`、`trigger_word_highlight.js` 的
`applySelectionHighlight`、`lora_info.js` 的 `updateConnectedLoraInfoNodes`。

唯一的新增依赖是 `registerLoraNodeClass`，代码里做了 `typeof === "function"` 判断：
主包没有它时只打印一条警告，节点其余功能全部照常，仅「独立网页前端把 LoRA 发送到本节点」
不可用。

本包**不导入** `loras_widget_components.js` / `loras_widget_events.js`（即那套改在
loras widget 里的预设代码），也不使用 `/api/lm/presets` 端点。所以本包的预设与主包
（或你本地魔改）的预设是两套独立系统，可以共存 —— 节点上会同时看到本包的「预设」栏和
魔改版的 `PRESETS (n)` 栏。

## 依赖的主包改动

完整补丁见 `host-pack-changes.patch`（只含下列通用改动，不含任何预设魔改）。

| 文件 | 改动 |
|---|---|
| `web/comfyui/utils.js` | 新增共享 `LORA_NODE_CLASSES` 与 `registerLoraNodeClass()` / `isLoraNodeClass()` / `isTerminalLoraLoaderClass()` |
| `web/comfyui/workflow_registry.js` | 改用共享 registry |
| `web/comfyui/trigger_word_highlight.js` | 改用共享 registry（消除与 workflow_registry.js 的重复定义） |
| `web/comfyui/lora_loader.js` | 接受列表改用 registry |
| `py/utils/constants.py` | 新增 `NODE_TYPE_EXTENSION_LORA = 99` |
| `py/routes/handlers/misc_handlers.py` | 附属包节点回落到 type 99 |
| `static/js/utils/constants.js` | type 99 的图标 |

## 测试

本仓库没有安装 `node_modules` 或 `pytest`，因此测试文件全部零依赖、可直接运行：

```bash
node tests/frontend/sizing.test.mjs         # 56 项文本框尺寸与开关契约检查
node tests/frontend/serialization.test.mjs  # 14 项 widget 值序列化对齐检查
python tests/test_style_preset_service.py   # 19 项预设存储检查
```

`serialization.test.mjs` 守护一个容易复发的坑：LiteGraph 的 `serialize()` 按位置写
`widgets_values[n]`（跳过不序列化的 widget，留下空洞），而 `configure()` 是顺序读取并
跳过不序列化的 widget。两者只要中间夹了一个 `serialize = false` 的 widget 就会错位一格，
表现为**每次重新载入工作流后 LoRA 列表被清空**。因此本节点所有 widget 均保持序列化。
