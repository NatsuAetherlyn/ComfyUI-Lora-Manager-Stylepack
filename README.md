## 人类的话
不知道怎么提交 pr 喵，凑合着用喵，不建议更新本体喵，能用就行喵，除非我也更新了上游不然这个节点包一般不会更新喵，下面的都是 ds 写的喵，看不懂就让 ds 帮忙看喵，我也看不懂喵，后文会有一堆括号喵，里面有些是我手写的喵，反正你一看就知道喵
简单来说这就是个给 Lora Manager 这个节点里的 Lora 加载器加了个文本框以及预设功能的改造节点喵
顺带一提上游更新了以后那个垂直滚动条长得特别难看喵，和节点风格非常割裂喵，等上游修喵
还有一个 bug 喵，不过不影响使用喵，就是每切换一次工作流那个预设文件都要重新读喵，这意味着每次都要点一下那个预设列表才能在前端加载预设喵，但是考虑到你不点开也不能切换预设所以就懒得改了喵

# ComfyUI-Lora-Manager-Stylepack

[ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) 的可选附属包，为它补一个「风格加载器」节点。形态类似 Impact-Pack 与 Impact-Subpack 的关系：主包不用动，把本目录放进 `custom_nodes` 就会多出这个节点。

一句话概括它做的事：**给主包的 Lora 加载器加上预设功能**——可以把「LoRA 栈 + 一段文本」整体存成预设、一键恢复；文本框本身可开关，常用来填触发词或画师串。
（这里的提到的效果类似 WebUI 的预设！为了方便管理，我还压榨 AI 写了一个网页前端专门管理！当然这个是因为我秉承着主包内容能少修改一点是一点！才不是因为我不知道怎么修改主包的网页！）

自用节点，按个人需求开发，随缘更新。

## 为什么还需要一个文本框？

主包的 Lora 加载器本身有触发词输出端口，但它读的是 Civitai metadata——作者没填，这里就是空的。而且下面这些情况它也覆盖不了：

- 多合一 LoRA（比如一个角色带好几套衣服），想按套切换触发词；
- 某些 LoRA 你觉得不带触发词表现反而更好，想临时改一版；
- 直接粘一整段画师串。

当然，如果你主力用 Krea 2、Z-Image 这类基本吃自然语言描述的模型，这个文本框对你可能没什么用。

（当然啦，其实原节点包是有一个叫触发词管理器的东西的，也可以解决类似多服装人物 Lora 的触发词问题！但是我这个可以和预设功能结合起来！还能高度自定义，比如存储画师串！所以可以用我的这个！）

## 安装

1. 先装好 [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)；
2. 把本仓库克隆或解压到 `ComfyUI/custom_nodes/ComfyUI-Lora-Manager-Stylepack`；
3. **运行一次注册脚本**（给主包打上兼容补丁，详见下文「对主包本身的改动」）：
   - **Windows：双击 `register_with_host.bat` 即可**。它会自动找一个能用的 Python（系统安装的、或整合包自带的都行），跑完窗口会停住等你按键，不会一闪而过。
   - macOS / Linux / 命令行党：`python scripts/register_with_host.py`。
4. 重启 ComfyUI（浏览器端最好硬刷新一次，清掉旧的前端缓存）。
（其实不用刷新！因为我喜欢直接把原来的窗口关掉然后开一个新窗口！）

节点位于 `Lora Manager/loaders` 分类下，显示名**风格加载器**（内部类名 `Style Loader (LoraManager)`）。默认行为与主包的「Lora 加载器」完全一致，额外提供下述功能。

## 节点说明

### 端口

| 输出 | 类型 | 说明 |
|---|---|---|
| MODEL | MODEL | 已套用 LoRA 的模型 |
| CLIP | CLIP | 已套用 LoRA 的 CLIP |
| 触发词 | STRING | 所有已启用 LoRA 的触发词 |
| 已加载Lora | STRING | `<lora:name:strength>` 语法串 |
| **预设文本** | STRING | 文本框内容 |

输入：`model`（必需）、`clip`、`lora_stack`（可选）。LoRA 搜索框、LoRA 列表与文本框都是前端组件。

### 文本框

- 默认关闭。节点上常驻一行「预设文本」标题栏，点标题或右侧开关即可展开（右键菜单里也有同样的开关，作为备用入口）。
- 折叠但里面有内容时，标题栏会显示 `(N 字)` 提示，不会让内容无声无息地消失。
- 展开时节点会自动长高；**拖大节点只会拉长 LoRA 列表，文本框高度不受影响**——手感与主包的加载器一致。
- 文本框高度只能通过它下方的拖动手柄调整。
- 开关状态与高度都随工作流保存。

### 预设

- 预设**同时保存 LoRA 栈和文本框内容**，载入时两者一起恢复，不会只回来一半。
- 每条 LoRA 记录 `name / strength / clipStrength / active / expanded`。
- 面板支持：保存（同名时询问是否覆盖）、展开查看内容、载入（覆盖前确认）、重命名、删除。

## 存储与 API

预设集中存放在 `<ComfyUI>/user/lora_manager_stylepack/style_presets.json`，与主包自身的预设文件互不干扰，也不怕主包更新。写入采用「临时文件 + `os.replace`」的原子替换；文件万一损坏，会改名成 `.corrupt` 保留现场，不会直接丢数据。
（为什么这里有所谓的「主包自身的预设文件」？因为最开始我的想法是在主包本身修修补补加预设，但是发现更新以后修改就消失了！所以决定开发这个独立节点！但是 LLM 是笨蛋所以没意识到这一点！因此忽略掉就好！）

前端面板走的就是这几个接口，也可以自行调用：

```
GET    /api/lm/style-presets
POST   /api/lm/style-presets           {name, text, loras, overwrite?}
PUT    /api/lm/style-presets/{id}      {name?, text?, loras?}
DELETE /api/lm/style-presets/{id}
```

## 与主包的关系

- **Python**：`py/host_bridge.py` 在运行时定位主包，直接复用 `py/nodes/lora_loader.py` 的内部辅助函数，不复制 LoRA 加载逻辑——主包升级后 Nunchaku 检测、clip 强度处理等行为自动跟随。主包缺失时节点仍会注册，执行时给出明确错误，不会拖垮 ComfyUI 启动。
- **前端**：从 `/extensions/ComfyUI-Lora-Manager/` 动态导入主包的 `loras_widget.js` 等模块（同时探测小写前缀作为降级）。
- **独立网页前端**：通过主包官方的第三方 LoRA 节点 adapter API（`registerLoraNodeAdapter`，version 1）注册自己；注册后网页 UI 的「发送到节点」列表会包含风格加载器，`lora_code_update` 消息也能被正确接收，触发词也会自动同步。

### 与官方未修改主包的兼容性

**兼容，且无需改主包代码。** 功能性集成全部走主包公开的 adapter API——该接口由主包在 2026-11-13 引入（commit `Add third-party LoRA node adapter API`），专门给附属包用。

注册代码做了完整的存在性判断和版本检查（见 `web/comfyui/style_loader.js` 的 `registerLoraAdapter()`）：主包缺少该 API、版本不匹配或模块加载失败时只打印一条提示，节点本身照常加载运行，仅「网页前端把 LoRA 发送到本节点」和触发词自动同步不可用。

> 本包不修改主包的 Vue widget bundle。`AUTOCOMPLETE_TEXT_LORAS` 是按**输入类型**注册的，声明该输入即可获得 LoRA 搜索框。

### 对主包本身的改动

功能性集成不需要改主包任何代码。脚本 `scripts/register_with_host.py` 只补一个装饰性缺口：节点在独立网页的节点选择器里会显示通用「未知」图标，因为主包后端只按 `NODE_TYPES` 查 type id。

| 命令 | 作用 |
|---|---|
| 双击 `register_with_host.bat`（或 `python scripts/register_with_host.py`） | 打补丁（自动定位主包，或把主包路径作为参数传入） |
| `register_with_host.bat --check` | 只报告哪些文件还没打，不改动 |
| `register_with_host.bat --restore` | 从备份还原主包原文件 |

补丁只有 3 处，且**锚点对不上时只会警告并跳过该文件，不会中断，也不会把文件改一半**——功能不依赖它，跳过后节点照常可用，只是图标是通用的：

| 文件 | 改动 |
|---|---|
| `py/utils/constants.py` | 新增 `NODE_TYPE_EXTENSION_LORA = 99` |
| `py/routes/handlers/misc_handlers.py` | 附属包节点回落到 type 99 |
| `static/js/utils/constants.js` | type 99 的图标 |

> **历史说明**：早期版本需要给主包打 7 处补丁（往 `utils.js` 注入注册表，并改 `lora_loader.js` / `workflow_registry.js` / `trigger_word_highlight.js`）。主包加入 adapter API 后这些全部不再需要，`host-pack-changes.patch` 已删除。旧机制依赖的全局变量 `window.__LM_EXTRA_LORA_NODE_CLASSES` 现已不被主包读取。

## 测试

测试文件全部零依赖，有 Node（前端）和 Python 3.10+（后端）就能跑：

```bash
node tests/frontend/sizing.test.mjs          # 文本框尺寸与开关行为
node tests/frontend/presets_sizing.test.mjs  # 预设面板展开/收起不得重置用户调整过的节点尺寸
node tests/frontend/serialization.test.mjs   # widget 值序列化对齐
python tests/test_style_preset_service.py    # 预设存储
```

`serialization.test.mjs` 守护一个容易复发的坑：LiteGraph 的 `serialize()` 按位置写 `widgets_values[n]`（跳过不序列化的 widget 会留下空洞），而 `configure()` 是顺序读取并跳过同类 widget——中间只要夹了一个 `serialize = false` 的 widget，两边就会错位一格，表现为**每次重新载入工作流后 LoRA 列表被清空**。因此本节点所有 widget 均保持序列化。

## 其他

ds 娘完成了大部分的修缮工作喵！上面的安装步骤看不懂没关系喵！让 ds 帮你完成喵！ds 最懂 ds 喵！
