/**
 * 芒果AI provider (`mangoai-official`) installer for the `llm-pi-ai` row.
 *
 * Enabling this plugin writes one provider profile into the `llm-pi-ai`
 * settings namespace; disabling it removes that entry again. The route id is
 * fixed: `mangoai-official`.
 *
 * Why the settings service rather than a patch:
 *
 *  - the row id `llm-pi-ai` is the namespace `dsh-client-ui-settings-models`
 *    keys its native provider editor on (`layoutOf()` recognises only
 *    `llm-deepseek` and `llm-pi-ai`), so the entry renders as the shipped card
 *    (API key field, endpoint/protocol/model list, "获取可用模型") with no client
 *    code at all — the same trick @deepseek-ai/dsh-llm-deepseek-api-key uses by
 *    owning the `llm-deepseek` row;
 *  - only the profile document may own that namespace: `dsh-config-editor`
 *    re-composes the patch list and rejects a write with
 *      Configuration for "llm-pi-ai" is overridden by a home patch or
 *      command-line overlay
 *    whenever a bundle layer also supplies config for it. Writing through
 *    `ctx.settings` keeps the profile the single owner, so the card stays
 *    editable *and* enable/disable really adds and removes the provider.
 *
 * Config edits may not run inside a Loader transaction, and `apply`/dispose run
 * inside one. Every write below is therefore deferred onto the `hmr` service's
 * AsyncLocalStorage exit, and a `plugin-manager/changed` listener kept on the
 * root context finishes the removal after the disabling operation has settled.
 *
 * An entry the user already owns is never overwritten: install only fills in a
 * missing profile, so edits made on the Models page survive plugin restarts.
 */
import { appendFileSync } from 'node:fs'

const dbg = (message) => {
  if (process.env.DSH_MANGOAI_DEBUG === undefined) return
  try { appendFileSync('/tmp/mangoai-plugin.log', `${new Date().toISOString()} ${message}\n`) } catch {}
}

export const name = 'mangoai-provider'
export const inject = ['settings']

const SETTINGS_NS = 'llm-pi-ai'
const ROUTE = 'mangoai-official'

/** Defaults written on first install; the Models page owns them afterwards. */
const PROFILE = {
  displayName: '芒果AI',
  apiKeyEnv: 'MGOOLE_API_KEY',
  api: 'openai-responses',
  baseURL: 'https://mgoole.com/v1',
  models: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek-V4.1-Flash',
      contextWindow: 1000000,
      maxTokens: 256000,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    },
  ],
}

export function apply(ctx) {
  const settings = ctx.settings
  let disposed = false
  let busy = false

  const descriptor = () => settings.describe().find((entry) => entry.ns === SETTINGS_NS)
  const present = (entry) => entry?.user?.providers?.[ROUTE] !== undefined || entry?.value?.providers?.[ROUTE] !== undefined

  const install = async () => {
    if (disposed || busy) return
    const entry = descriptor()
    if (entry === undefined || present(entry)) return
    busy = true
    try {
      await settings.mutate(SETTINGS_NS, [{ op: 'set', path: ['providers', ROUTE], value: PROFILE }], entry.revision)
      dbg('installed')
    } finally {
      busy = false
    }
  }

  const uninstall = async () => {
    const entry = descriptor()
    if (entry === undefined || entry.value?.providers?.[ROUTE] === undefined) return
    await settings.mutate(SETTINGS_NS, [{ op: 'unset', path: ['providers', ROUTE] }], entry.revision)
    dbg('uninstalled')
  }

  // Escapes the Loader transaction that wraps apply()/dispose(); see the header.
  const als = ctx.get('hmr')?.executing
  dbg(`apply: als=${als === undefined ? 'missing' : 'ok'}`)
  const detached = (work) => {
    if (als?.exit !== undefined) als.exit(work)
    else work()
  }
  const later = (work, delay = 0) => {
    setTimeout(() => {
      try { detached(work) } catch (error) { dbg('detached threw: ' + (error?.message ?? error)) }
    }, delay)
  }

  const settle = () => later(() => void (disposed ? uninstall() : install()).catch((error) => {
    dbg(`${disposed ? 'uninstall' : 'install'} failed: ` + (error?.message ?? error))
  }))

  const offDocument = ctx.on('settings/document-updated', (ns) => {
    if (ns === SETTINGS_NS) settle()
  })
  const offManager = ctx.on('plugin-manager/changed', () => settle())
  // Any browser request runs outside a Loader transaction, so the very first
  // page load repairs a boot-time install that lost the race.
  const offRequest = ctx.on('connection/request', (request, response, next) => {
    settle()
    return next()
  })
  // Applied before disposal and kept on the root context so the removal still
  // runs once the disabling operation has left its transaction.
  const offRoot = ctx.root.on('plugin-manager/changed', () => {
    if (!disposed) return
    settle()
    offRoot()
  })

  for (const delay of [0, 100, 500, 1500, 4000]) later(() => void install().catch((error) => {
    dbg('install failed: ' + (error?.message ?? error))
  }), delay)

  ctx.effect(() => () => {
    disposed = true
    offDocument()
    offManager()
    offRequest()
    later(() => void uninstall().catch((error) => dbg('uninstall failed: ' + (error?.message ?? error))))
  })
}
