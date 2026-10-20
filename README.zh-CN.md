# dsh-provider-mgoole

[English](./README.md) | 简体中文

一个 DeepSeek Harness 的 bundle 插件：把 **芒果AI（MangoAI）** 的 OpenAI 兼容网关接成模型供应商，并且使用**原生「设置 → 模型」卡片**（API 密钥输入框、自定义设置、获取可用模型）。

启用插件 = 供应商出现；停用插件 = 供应商消失。

| 项目 | 值 |
|---|---|
| 路由名 | `mangoai-official`（固定） |
| 默认地址 | `https://mgoole.com/v1` |
| 协议 | `openai-responses` |
| 凭证引用 | `MGOOLE_API_KEY` |
| 设置的命名空间 | `llm-pi-ai`（模型页会渲染成原生卡片的那一个） |

## 安装

```bash
dsh plugin add github:sendya/dsh-provider-mgoole
```

或从本地目录安装（改代码即时生效，适合开发）：

```bash
dsh plugin add link:/path/to/dsh-provider-mgoole
```

然后在 **设置 → 插件** 里启用它。打开 **设置 → 模型** 会看到名为 **芒果AI** 的供应商卡片，它用的就是出厂编辑器：直接在「API 密钥」里填 key，点「获取可用模型」即可拉取线上模型列表。

密钥通过 credentials 服务写入，**不会**进入本仓库，也不会进入任何 patch 文件。

## 它到底做了什么

只有两个参与方：

```
cordis.patch.yml   插入一行：  id: mangoai-provider, name: @sendya/dsh-provider-mgoole
index.js           启用时 -> settings.mutate('llm-pi-ai', set   providers.mangoai-official)
                   停用时 -> settings.mutate('llm-pi-ai', unset providers.mangoai-official)
```

`cordis.patch.yml` 里**刻意不写任何 `config`**。所有配置都在运行时通过 settings 服务写入，这正是能同时满足两个要求的关键：

### 一、为什么能拿到原生卡片

`@deepseek-ai/dsh-client-ui-settings-models` 是**逐字比较命名空间**来决定用哪个编辑器的：

```js
function layoutOf(ns) {
  if (ns === "llm-deepseek") return "deepseek";
  if (ns === "llm-pi-ai")   return "pi-ai";
  return "unknown";   // 字段照渲，但 submitDisabled = ... || layout === "unknown"
}
```

而 `@deepseek-ai/dsh-llm-pi-ai` 的命名空间取自 `ctx.fiber.entry.options.id`。因此把 provider 声明进 `llm-pi-ai` 命名空间，是拿到出厂卡片的唯一方式 —— 官方 `@deepseek-ai/dsh-llm-deepseek-api-key` 用的也是同一招，只不过它占的是 `llm-deepseek` 那一行。

### 二、为什么配置必须运行时写入

`@deepseek-ai/dsh-config-editor` 会拒绝写入「被更高层 patch 也配置过」的命名空间：

```
settings/rejected: Configuration for "llm-pi-ai" is overridden by a home patch
                   or command-line overlay
```

也就是说，bundle 一旦为该命名空间提供 `config`，卡片就会变成**只读**：能看、保存必失败、用户自己加的模型刷新后消失。改为通过 `ctx.settings` 写入后，profile 文档保持唯一所有者：卡片可编辑，同时启用/停用真的能增删供应商。

### 三、Loader 事务陷阱

配置写入不能在 Loader 事务里执行，而 `apply()` 与 disposer 都在事务内：

```
Error: HMR transactions cannot be nested
```

用 `setTimeout` 延迟也没用 —— 它会继承同一个 `AsyncLocalStorage` 上下文。所以插件先显式脱离上下文再写：

```js
const als = ctx.get('hmr')?.executing          // 守卫背后的 AsyncLocalStorage
als.exit(() => void settings.mutate(...))      // 在独立的一轮里写
```

停用时的删除还需要一个"比插件自身上下文活得更久"的监听器，因此额外在 `ctx.root` 上挂了一个 `plugin-manager/changed` 监听，删除完成后自行注销。此外还有 `settings/document-updated`、`connection/request` 以及一组短定时器作为兜底。

## 首次安装写入的默认值

```yaml
providers.mangoai-official:
  displayName: 芒果AI
  apiKeyEnv: MGOOLE_API_KEY
  api: openai-responses
  baseURL: https://mgoole.com/v1
  models:
    - deepseek-v4-flash
    - deepseek-v4-pro
    - deepseek-v4.1-flash      # contextWindow 1000000 / maxTokens 256000 / text+image / reasoningEfforts
```

**已存在的 `providers.mangoai-official` 永远不会被覆盖**：插件只补空缺，所以你在界面上做的任何修改都能扛过重启、升级与反复启停。

## 文件说明

- `index.js` —— Host 插件（`inject: ['settings']`）。不含协议实现，也没有客户端半边。
- `cordis.patch.yml` —— 只插入一行，无 config。
- `icon.svg`、`locale/*.json` —— 插件清单展示用的元信息。

## 环境要求

- DeepSeek Harness `0.2.1-rc.2` 或更新（需要 `settings.mutate`、把 `llm-pi-ai` 作为可配置命名空间、以及模型页里的 `llm-pi-ai` / `deepseek` 两种布局）。
- Node.js ≥ 20。

## 调试

```bash
DSH_MANGOAI_DEBUG=1 dsh web     # 把 install/uninstall 的决策过程写到 /tmp/mangoai-plugin.log
```

## 卸载

在 **设置 → 插件** 里停用：`providers.mangoai-official` 会被删除，路由随即消失。要彻底移除：

```bash
dsh plugin remove @sendya/dsh-provider-mgoole
```

## 已知限制

- 供应商档案写在 `llm-pi-ai` 这个共享命名空间里，**不要手动编辑 profile 的 `cordis.patch.yml` 中该段** —— 它由 settings 服务托管，手改会被内存中的文档重序列化覆盖，甚至可能连带丢掉其它 provider 条目。增删 provider 请走界面或 `settings.mutate`。
- 路由名固定为 `mangoai-official`，与其它指向同一网关的自建路由（例如自己手工加的 `mgoole-loc`）可以并存，互不影响。

## 许可证

MIT
