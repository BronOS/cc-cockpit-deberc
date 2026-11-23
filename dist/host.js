'use strict'
// Deberc for cc-cockpit: a match of Deberc (the klaberjass family) against computer players in a panel, to play while
// Claude works, four in pairs or three each for themselves. The match lives here in the host (lib/controller.js), one
// per project window, and so do the computer players: their moves run on a timer here, and the panel page only draws
// what it is sent and posts your moves. Closing, hiding or reopening the panel never loses or unpauses a match.
//
// Harmless by design: no exec, no network, no secrets, no overlays, and nothing is ever typed into or sent to a
// session. Its only calls on Claude tabs are reading the window's list (ctx.sessions.list / onChange) for the pause
// and `ctx.sessions.focus` for the person's own Go to the tab click.

const { createController, LEVEL_TEXT } = require('../lib/controller.js')
const { isMode } = require('../lib/rules.js')
const { isLevel } = require('../lib/bots.js')

const PANEL = 'deberc'
const MODE_KEY = 'players'
const LEVEL_KEY = 'level'
const KINDS = ['won', 'lost']
const MODES = [4, 3]
const STAT_KEY = (kind, mode) => `${kind}:${mode}`
const MODE_TITLE = { 4: '4 in pairs', 3: '3 each for themselves' }

let disposers = []

exports.activate = (ctx) => {
  // Records, the players and the level are app-wide (every project window plays the same records); an app without
  // ctx.appStorage keeps them per project instead.
  const store = typeof ctx.appStorage === 'object' && ctx.appStorage !== null ? ctx.appStorage : ctx.storage
  const controller = createController()
  const fourOf = (settings) => !!(settings && settings.app && settings.app.fourColour === true)
  controller.setFour(fourOf(ctx.settings))

  // The title bar: New game, Players and Level as icon buttons (the header takes no dropdown, so each one cycles), the
  // match score as its muted text.
  let headerKey = ''
  function header() {
    const mode = controller.mode()
    const level = controller.level()
    const meta = controller.meta()
    const key = `${meta}|${mode}|${level}`
    if (key === headerKey) return
    headerKey = key
    const otherMode = mode === 4 ? 3 : 4
    const otherLevel = level === 'normal' ? 'easy' : 'normal'
    try {
      ctx.panels.header(PANEL, {
        meta,
        actions: [
          { id: 'new', icon: 'refresh', title: 'New game (N)' },
          {
            id: 'players',
            icon: 'icons/players.svg',
            title: `Players: ${MODE_TITLE[mode]}. Switch to ${MODE_TITLE[otherMode]} (starts a new game)`,
          },
          {
            id: 'level',
            icon: 'icons/level.svg',
            title: `Computer players: ${LEVEL_TEXT[level]}. Switch to ${LEVEL_TEXT[otherLevel]}`,
          },
        ],
      })
    } catch (err) {
      ctx.log.warn(`could not set the panel header: ${err && err.message}`)
    }
  }

  // One timer for the computer players: armed for the state `nextStep` names, dropped when that state is gone (a
  // move, a new deal), the game paused, the score sheet open, or no view shows the panel.
  let timer = null
  let timerKey = null
  function stopTimer() {
    clearTimeout(timer)
    timer = null
    timerKey = null
  }
  function schedule() {
    const next = controller.nextStep()
    if (!next) return stopTimer()
    if (timer && timerKey === next.key) return
    stopTimer()
    timerKey = next.key
    timer = setTimeout(() => {
      timer = null
      timerKey = null
      handle(controller.step())
    }, next.ms)
  }
  disposers.push(stopTimer)

  /** A step's or a move's result: the new state to every view, and a match's end to the records. */
  function handle(result) {
    if (result.changed) push()
    else schedule()
    if (result.outcome) saveOutcome(result.outcome)
  }

  function push() {
    header()
    ctx.panels.post(PANEL, { state: controller.snapshot() })
    schedule()
  }
  header()
  /** To the one page that asked (`from.view`), or to every view when the app gave none. */
  const answer = (message, from) =>
    from && typeof from.view === 'string' ? ctx.panels.post(PANEL, message, { view: from.view }) : ctx.panels.post(PANEL, message)
  const viewOf = (from) => (from && typeof from.view === 'string' ? from.view : 'desktop')
  let pickedMode = false // the person chose before the stored value was read: theirs wins
  let pickedLevel = false

  async function load() {
    for (const k of MODES) {
      const stored = {}
      for (const kind of KINDS) stored[kind] = await store.get(STAT_KEY(kind, k))
      controller.setStats(k, stored)
    }
    const mode = await store.get(MODE_KEY)
    // Only a match you have not touched yet is swapped for the stored players.
    if (!pickedMode && isMode(mode) && controller.untouched()) controller.setMode(mode)
    const level = await store.get(LEVEL_KEY)
    if (!pickedLevel && isLevel(level)) controller.setLevel(level)
    header()
  }
  // activate's return value is ignored, so messages can come before the store answered: each waits for it.
  const loaded = load().catch((err) => ctx.log.warn(`could not read the records: ${err && err.message}`))

  // A result counts in storage with `increment` (atomic across windows), one save at a time, in order; the stored
  // total then raises this window's count (other windows' matches included).
  let saving = Promise.resolve()
  function saveOutcome({ kind, mode }) {
    saving = saving.then(async () => {
      try {
        const key = STAT_KEY(kind, mode)
        const total = typeof store.increment === 'function' ? await store.increment(key) : await bump(key)
        if (controller.setStats(mode, { [kind]: total })) push()
      } catch (err) {
        ctx.log.warn(`could not save the records: ${err && err.message}`)
      }
    })
    return saving
  }
  /** `increment` for a store without it (ctx.storage has one writer, the project's host). */
  async function bump(key) {
    const v = await store.get(key)
    const next = (typeof v === 'number' && Number.isFinite(v) ? v : 0) + 1
    await store.set(key, next)
    return next
  }
  const remember = (key, value) => store.set(key, value).catch((err) => ctx.log.warn(`could not save ${key}: ${err && err.message}`))

  if (typeof ctx.panels.onAction === 'function') {
    disposers.push(
      ctx.panels.onAction(PANEL, async (id) => {
        await loaded
        if (id === 'new') {
          handle(controller.act({ act: 'new' }))
        } else if (id === 'players') {
          const next = controller.mode() === 4 ? 3 : 4
          pickedMode = true
          remember(MODE_KEY, next)
          if (controller.setMode(next)) push()
        } else if (id === 'level') {
          const next = controller.level() === 'normal' ? 'easy' : 'normal'
          pickedLevel = true
          remember(LEVEL_KEY, next)
          if (controller.setLevel(next)) push()
        }
      }),
    )
  }

  disposers.push(
    ctx.panels.onMessage(PANEL, async (msg, from) => {
      await loaded
      if (!msg || typeof msg !== 'object') return
      if (msg.hello) {
        controller.setShown(viewOf(from), msg.visible !== false)
        // Every view hears it: the computer players may have started moving for all of them.
        push()
        return
      }
      if (msg.act === 'seen') {
        if (controller.setShown(viewOf(from), msg.visible === true)) push()
        return
      }
      if (msg.act === 'goto') {
        // Returned (awaited) from the listener, so the focus acts in the view the click came from.
        const tabId = controller.pausedTab()
        if (!tabId) return
        const ok = await ctx.sessions.focus(tabId).catch(() => false)
        if (!ok) answer({ notice: 'That Claude tab is closed.' }, from)
        return
      }
      const result = controller.act(msg)
      if (result.changed) handle(result)
    }),
  )

  // A page gone (the panel hidden or closed in that view) stops the computer players unless another view still shows
  // it. The page cannot say so itself: it is unmounted. An app without ctx.views only has the page's visibility.
  if (typeof ctx.views === 'object' && ctx.views !== null && typeof ctx.views.onChange === 'function') {
    disposers.push(
      ctx.views.onChange(({ view, access }) => {
        if (access === undefined && controller.setShown(view, undefined)) push()
      }),
    )
  }

  if (typeof ctx.onSettingsChange === 'function') {
    disposers.push(
      ctx.onSettingsChange((settings) => {
        if (controller.setFour(fourOf(settings))) push()
      }),
    )
  }

  // The pause: every change of this window's Claude tabs (statuses included) comes as the whole list. The first list
  // is read once at start so a tab already working then is known when it turns to waiting; an onChange that came
  // first is newer, so the start list is dropped then.
  let changeSeen = false
  disposers.push(
    ctx.sessions.onChange((list) => {
      changeSeen = true
      if (controller.sessions(list)) push()
    }),
  )
  ctx.sessions
    .list()
    .then((list) => {
      if (!changeSeen) controller.sessions(list)
    })
    .catch((err) => ctx.log.warn(`could not list the Claude tabs: ${err && err.message}`))
}

exports.deactivate = () => {
  for (const dispose of disposers) {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      // the host is stopping anyway
    }
  }
  disposers = []
}
