# dsh-provider-mgoole

English | [简体中文](./README.zh-CN.md)

A DeepSeek Harness bundle plugin that adds the **芒果AI (MangoAI)** OpenAI-compatible
gateway as a model provider — and gives it the **native Models-page card** (API key
field, endpoint / protocol / model list, “获取可用模型”), with zero custom UI code.

Enabling the plugin registers the provider; disabling it removes the provider again.

| | |
|---|---|
| Route id | `mangoai-official` (fixed) |
| Default endpoint | `https://mgoole.com/v1` |
| Protocol | `openai-responses` |
| Credential reference | `MGOOLE_API_KEY` |
| Settings namespace | `llm-pi-ai` (the namespace the Models page renders natively) |

## Install

```bash
dsh plugin add github:sendya/dsh-provider-mgoole
```

Or from a local checkout:

```bash
dsh plugin add link:/path/to/dsh-provider-mgoole
```

Then enable it in **设置 → 插件** (Settings → Plugins). A provider named **芒果AI**
appears in **设置 → 模型** with the shipped editor; type your API key there and hit
**获取可用模型** to pull the live model list.

The key is written through the credentials service; it never enters this repository
or the patch file.

## What it actually does

Two moving parts:

```
cordis.patch.yml   insert one row:  id: mangoai-provider, name: @sendya/dsh-provider-mgoole
index.js           on enable  -> settings.mutate('llm-pi-ai', set  providers.mangoai-official)
                   on disable -> settings.mutate('llm-pi-ai', unset providers.mangoai-official)
```

`cordis.patch.yml` deliberately carries **no `config`**. Everything is written at
runtime through the settings service, which is what makes both requirements possible
at once:

1. **The native card.** `@deepseek-ai/dsh-client-ui-settings-models` chooses a
   provider editor by comparing the settings namespace literally:

   ```js
   function layoutOf(ns) {
     if (ns === "llm-deepseek") return "deepseek";
     if (ns === "llm-pi-ai")   return "pi-ai";
     return "unknown";   // fields render, but submitDisabled = ... || layout === "unknown"
   }
   ```

   and `@deepseek-ai/dsh-llm-pi-ai` derives its namespace from
   `ctx.fiber.entry.options.id`. Declaring the provider inside the `llm-pi-ai`
   namespace is therefore the only way to get the shipped card — the same trick
   `@deepseek-ai/dsh-llm-deepseek-api-key` uses by owning the `llm-deepseek` row.

2. **Editable config.** `@deepseek-ai/dsh-config-editor` rejects a write to a
   namespace that a higher patch layer also configures:

   ```
   settings/rejected: Configuration for "llm-pi-ai" is overridden by a home patch
                      or command-line overlay
   ```

   So a bundle that ships `config` for `llm-pi-ai` freezes the card (reads fine,
   saves fail, user-added models vanish on reload). Writing through
   `ctx.settings` instead keeps the profile document the single owner: the card
   stays editable **and** enable/disable really adds and removes the provider.

### The transaction trap

Config edits may not run inside a Loader transaction, and `apply()` / disposer both
run inside one:

```
Error: HMR transactions cannot be nested
```

Deferring with `setTimeout` does not help — it inherits the same `AsyncLocalStorage`
context. The plugin therefore escapes the context explicitly before writing:

```js
const als = ctx.get('hmr')?.executing          // the AsyncLocalStorage behind the guard
als.exit(() => void settings.mutate(...))      // write on its own turn
```

Removal on disable additionally needs a listener that outlives the plugin's own
context, so a `plugin-manager/changed` listener is attached to `ctx.root` and
unsubscribes itself after it has deleted the entry. `settings/document-updated`,
`connection/request`, and a short timer ladder act as fallbacks.

## Defaults written on first install

```yaml
providers.mangoai-official:
  displayName: 芒果AI
  apiKeyEnv: MGOOLE_API_KEY
  api: openai-responses
  baseURL: https://mgoole.com/v1
  models:
    - deepseek-v4-flash
    - deepseek-v4-pro
    - deepseek-v4.1-flash      # contextWindow 1000000, maxTokens 256000, text+image, reasoningEfforts
```

An existing `providers.mangoai-official` entry is never overwritten: the plugin only
fills in a missing one, so anything you change in the UI survives restarts, updates
and re-enables.

## Files

- `index.js` — the Host plugin (`inject: ['settings']`). No protocol code, no client half.
- `cordis.patch.yml` — one inserted row, no config.
- `icon.svg`, `locale/*.json` — display metadata for the plugin inventory.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` or newer (needs `settings.mutate`, `llm-pi-ai` as a
  configurable namespace, and the `llm-pi-ai` / `deepseek` layouts in the Models page).
- Node.js ≥ 20.

## Debugging

```bash
DSH_MANGOAI_DEBUG=1 dsh web     # traces install/uninstall decisions to /tmp/mangoai-plugin.log
```

## Uninstall

Disable the plugin in **设置 → 插件**: `providers.mangoai-official` is removed and the
route disappears. To drop it entirely:

```bash
dsh plugin remove @sendya/dsh-provider-mgoole
```

## License

MIT
