'use strict'
// One project window's match: the deals (lib/rules.js), the computer players (lib/bots.js), the score sheet, the Claude
// pause and the records, with no ctx and no timers in it (`rng` injected), so `test/controller.test.js` drives it step
// by step. dist/host.js wires it to ctx: page messages in, `snapshot()` out to every view, session lists and shown
// views in, records out to storage, and `step()` called on a timer whenever `nextStep()` asks for one.
//
// The computer players move only while some view shows the panel, the game is not paused and the score sheet is
// closed: hiding the panel unmounts its page, and a move made while nobody looks would be a move you never saw. Each
// one waits about 650 ms; a full trick stays on the table 900 ms, the last one 700 ms, and a deal everyone passed
// 1400 ms before the next deal, so you can follow them.

const R = require('./rules.js')
const bots = require('./bots.js')
const { createReadyWatch } = require('./pause.js')

const STEP_MS = 650
const TRICK_MS = 900
const LAST_MS = 700
const REDEAL_MS = 1400
const LEVEL_TEXT = Object.freeze({ easy: 'Easy', normal: 'Normal' })
const MODE_TEXT = Object.freeze({ 4: '4 in pairs', 3: '3 players' })
const BOT_PHASES = new Set(['bid1', 'bid2', 'play'])
const YOUR_PHASES = new Set(['bid1', 'bid2', 'swap', 'play'])
const OUTCOMES = Object.freeze(['won', 'lost'])

/** The title bar's muted text: the match score, `Us 120 : 86 Them · to 501` (or `120 : 86 : 40 · to 501`). */
const headerMeta = (mode, total) =>
  `${mode === 4 ? `Us ${total[0]} : ${total[1]} Them` : total.join(' : ')} · to ${R.TARGET}`

/** How a side's win reads: with four your side is you and Lena. */
const winners = (mode, side) => (mode === 4 && side === 0 ? 'You and Lena' : R.sideName(mode, side))
const winVerb = (mode, side) => (mode === 4 || side === 0 ? 'win' : 'wins')

/**
 * `deal(m, rng)` makes each deal of a match (rules.newDeal; tests give it stacked decks of their own) and `match(mode,
 * rng)` each match (rules.newMatch).
 */
function createController({ rng = Math.random, mode, level, deal = R.newDeal, match = R.newMatch } = {}) {
  let n = R.isMode(mode) ? mode : R.DEFAULT_MODE
  let lvl = bots.isLevel(level) ? level : bots.DEFAULT_LEVEL
  let m = match(n, rng)
  let g = deal(m, rng)
  /** Counts deals, so the page knows a new deal from a move on the one it drew. */
  let gameNo = 1
  /** Counts changes of the game, so a timer armed for one state is not run on another. */
  let seq = 1
  /** The Claude tab the pause is about, `{ tabId, name }`, or null when the game is not paused. */
  let paused = null
  /** The score sheet is open: the game waits until it is closed. */
  let sheet = false
  let started = false // you made a move in this match
  let counted = false // this match's result went to the records
  /** view -> whether its page is on screen. A view is in it from its page's hello until the page is gone. */
  const shown = new Map()
  /** Per mode: your matches won and lost (app-wide, from storage and this window). */
  const stats = {}
  for (const k of R.MODES) stats[k] = { won: 0, lost: 0 }
  let four = false // the four-colour deck (an app setting)
  const watch = createReadyWatch()

  const anyShown = () => [...shown.values()].some(Boolean)
  const held = () => paused !== null || sheet
  const myTurn = () => !held() && !m.over && g.turn === R.YOU && YOUR_PHASES.has(g.phase)
  /** In play for the pause: you made a move, and the match is neither over nor waiting on your Next deal. */
  const inPlay = () => started && !m.over && g.phase !== 'done' && !sheet
  /** A step of the game the host runs on a timer: a computer player's move, a trick collected, a deal scored or dealt again. */
  const stepDue = () =>
    g.phase === 'trick' || g.phase === 'last' || g.phase === 'redeal' || (BOT_PHASES.has(g.phase) && g.turn >= 1)

  function newMatch() {
    m = match(n, rng)
    g = deal(m, rng)
    gameNo++
    seq++
    paused = null
    sheet = false
    started = false
    counted = false
  }

  /** The next deal of the match: the deal passes to the left. */
  function nextDeal() {
    m.dealer = (m.dealer + 1) % n
    g = deal(m, rng)
    gameNo++
    seq++
  }

  /** The match's result for you, once, when it was just decided (`{ kind, mode }`); the host stores it. */
  function withOutcome(result) {
    if (!m.over || counted) return result
    counted = true
    const kind = m.winner === 0 ? 'won' : 'lost'
    stats[n][kind]++
    return { ...result, outcome: { kind, mode: n } }
  }

  /** One of your moves: refused while paused or the sheet is open, and when it is not your turn for it. */
  function mine(fn) {
    if (held() || !fn()) return { changed: false }
    started = true
    seq++
    return withOutcome({ changed: true })
  }

  /** A seat's badges: dealer, partner, the taker or a pass, the melds that score (after the first trick), the bella. */
  function tagsOf(i) {
    const t = []
    if (i === g.dealer) t.push({ kind: 'dealer', text: 'D', title: 'Dealer' })
    if (n === 4 && i === 2) t.push({ kind: 'team', text: 'partner', title: 'Your partner' })
    if (g.taker === i) t.push({ kind: 'taker', text: `★ ${R.SYMBOLS[g.trump]}`, title: 'Took the trump' })
    else if (g.said[i] === 'pass' && (g.phase === 'bid1' || g.phase === 'bid2')) t.push({ kind: 'pass', text: 'pass', title: 'Passed' })
    if (g.shownMelds && g.meldSide !== null && R.sideOf(n, i) === g.meldSide) {
      for (const x of g.melds.filter((x) => x.p === i)) t.push({ kind: 'meld', text: x.len >= 4 ? '50' : 'terz', title: R.meldName(x) })
    }
    if (g.bellaSeen === 2 && i === g.bellaHolder) t.push({ kind: 'meld', text: 'bella', title: 'King and queen of trumps' })
    return t
  }

  /** Your hand as the page draws it, high to low from the left, each card with whether it may be played now. */
  function handView() {
    const playing = myTurn() && g.phase === 'play'
    const L = playing ? R.legal(g, R.YOU) : []
    return R.sortedHand(g, g.players[R.YOU].hand).map((c) => {
      const ok = L.some((x) => R.same(x, c))
      return { s: c.s, r: c.r, trump: R.isTrump(g, c), ok, dim: playing && !ok }
    })
  }

  const cardOut = (c) => (c ? { s: c.s, r: c.r, trump: R.isTrump(g, c) } : null)

  /** The cover's content once a deal is scored or the match is over: a title, a line and the deal's table. */
  function resultView() {
    if (g.phase !== 'done' && g.phase !== 'over') return null
    const k = R.nSides(n)
    const sides = [...Array(k).keys()]
    if (g.deberc) {
      const s = R.sideOf(n, g.deberc.p)
      return {
        kind: s === 0 ? 'won' : 'lost',
        title: `Deberc! ${g.deberc.p === R.YOU ? 'You hold' : `${R.who(g, g.deberc.p)} holds`} all eight ${R.SYMBOLS[g.deberc.s]} in a row.`,
        text: `${winners(n, s)} ${winVerb(n, s)} the game on the spot.`,
        table: null,
        next: 'new',
      }
    }
    if (!g.result) return null
    const { made, deal: dealPts, add, ts } = g.result
    const head = made
      ? `${R.who(g, g.taker)} made it with ${R.SYMBOLS[g.trump]}.`
      : `${R.who(g, g.taker)} ${g.taker === R.YOU ? 'fall' : 'falls'}: ${n === 4 && ts === 0 ? 'the other side takes' : 'the others take'} everything but the bella.`
    const blank = (v) => (v ? v : '')
    const table = {
      head: sides.map((s) => `${R.sideName(n, s)}${s === ts ? ' ★' : ''}`),
      rows: [
        { label: 'Cards', cells: sides.map((s) => g.pts[s] - (s === g.lastSide ? R.LAST_TRICK : 0)) },
        { label: 'Last trick', cells: sides.map((s) => (s === g.lastSide ? R.LAST_TRICK : '')) },
        { label: 'Melds', cells: sides.map((s) => blank(g.meld[s])) },
        { label: 'Bella', cells: sides.map((s) => blank(g.bella[s])) },
        { label: 'This deal', cells: dealPts.slice(), cls: 'sum' },
        { label: 'Scored', cells: add.map((v) => `+${v}`), cls: 'add' },
        { label: 'Game', cells: m.total.slice(), cls: 'sum' },
      ],
    }
    if (g.phase === 'over') {
      const win = m.winner
      const title =
        win === 0 ? (n === 4 ? 'You and Lena win!' : 'You win!') : `${R.sideName(n, win)} ${winVerb(n, win)}.`
      return { kind: win === 0 ? 'won' : 'lost', title: `${title} ${m.total.join(' : ')}`, text: head, table, next: 'new' }
    }
    return { kind: 'deal', title: head, text: '', table, next: 'next' }
  }

  return {
    /** The whole state the page draws: your cards, the others' counts, the trick; never the deck or another hand. */
    snapshot() {
      const due = stepDue()
      const k = R.nSides(n)
      const full = g.trick.length === g.players.length
      const wi = full ? R.winnerIdx(g) : -1
      const live = g.phase === 'play' || g.phase === 'trick' || g.phase === 'last' || g.result !== null
      return {
        game: gameNo,
        seq,
        mode: n,
        modeText: MODE_TEXT[n],
        level: lvl,
        levelText: LEVEL_TEXT[lvl],
        target: R.TARGET,
        phase: g.phase,
        turn: g.turn,
        dealer: g.dealer,
        trump: g.trump,
        taker: g.taker,
        turned: cardOut(g.turned),
        seats: g.players.map((p, i) => ({
          name: p.name,
          count: p.hand.length,
          turn: g.turn === i && !m.over,
          tags: tagsOf(i),
        })),
        trick: g.trick.map((t, j) => ({ p: t.p, card: cardOut(t.c), win: j === wi })),
        hand: handView(),
        myTurn: myTurn(),
        myMelds:
          g.phase === 'play' && g.tricks === 0 ? g.melds.filter((x) => x.p === R.YOU).map((x) => R.meldName(x)) : [],
        thinking: due && g.turn >= 1 && !held() ? g.players[g.turn].name : null,
        log: g.log,
        paused: paused ? { name: paused.name } : null,
        sheet,
        scores: {
          sides: [...Array(k).keys()].map((s) => ({
            name: R.sideName(n, s),
            total: m.total[s],
            live: live ? g.pts[s] + g.meld[s] + g.bella[s] : null,
            me: s === 0,
          })),
          deal: m.history.length + (g.result ? 0 : 1),
        },
        history: m.history.map((h, j) => ({
          label: `${j + 1}. ${R.who(g, h.taker)} ${R.SYMBOLS[h.trump]}${h.made ? '' : ' (fell)'}`,
          made: h.made,
          add: h.add.slice(),
          total: h.total.slice(),
        })),
        total: m.total.slice(),
        sideNames: [...Array(k).keys()].map((s) => R.sideName(n, s)),
        result: resultView(),
        four,
        stats: { ...stats[n] },
      }
    },

    /**
     * One page action, untrusted: `bid` `{ choice }` (`'pass'` or a suit), `swap` `{ yes }`, `play` `{ card }`, `next`
     * (the next deal once one is scored), `new`, `resume`, `sheet` `{ open }`. Your moves are refused while paused or
     * while the score sheet is open. Returns `{ changed, outcome? }`, `outcome` `{ kind, mode }` when the match's result
     * for you was just decided (a deberc can end it on your bid).
     */
    act(msg) {
      if (!msg || typeof msg !== 'object') return { changed: false }
      switch (msg.act) {
        case 'bid':
          return mine(() => myTurn() && R.bid(g, m, R.YOU, msg.choice))
        case 'swap':
          return mine(() => myTurn() && R.swap(g, m, R.YOU, msg.yes === true))
        case 'play':
          return mine(() => myTurn() && R.play(g, R.YOU, msg.card))
        case 'next':
          if (held() || g.phase !== 'done') return { changed: false }
          started = true
          nextDeal()
          return { changed: true }
        case 'new':
          newMatch()
          return { changed: true }
        case 'resume':
          if (!paused) return { changed: false }
          paused = null
          seq++
          return { changed: true }
        case 'sheet':
          if (msg.open === true) {
            if (held() || g.phase === 'done' || g.phase === 'over') return { changed: false }
            sheet = true
          } else {
            if (!sheet) return { changed: false }
            sheet = false
          }
          seq++
          return { changed: true }
        default:
          return { changed: false }
      }
    },

    /**
     * What the host should run next, `{ key, ms }`, or null: a computer player's move or a trick, a score or a new deal
     * is due, the game is not paused, the sheet is closed, and some view shows the panel. `key` names the state it is
     * for; the host keeps one timer.
     */
    nextStep() {
      if (held() || !anyShown() || !stepDue()) return null
      const ms = g.phase === 'trick' ? TRICK_MS : g.phase === 'last' ? LAST_MS : g.phase === 'redeal' ? REDEAL_MS : STEP_MS
      return { key: `${gameNo}:${seq}`, ms }
    },

    /**
     * Runs the step `nextStep` asked for (the host calls it when the timer fires). Returns `{ changed, outcome? }`, as
     * `act` does. Refused while paused or while the sheet is open.
     */
    step() {
      if (held() || !stepDue()) return { changed: false }
      let moved
      if (g.phase === 'trick') moved = R.collect(g)
      else if (g.phase === 'last') moved = R.endDeal(g, m)
      else if (g.phase === 'redeal') {
        nextDeal()
        return { changed: true }
      } else moved = bots.apply(g, m, bots.choose(g, lvl, rng))
      if (!moved) return { changed: false }
      seq++
      return withOutcome({ changed: true })
    },

    /**
     * The window's Claude tabs (every `ctx.sessions` list). A tab going from working to waiting pauses a match in
     * play; while paused, a later one only renames the cover to it (the latest wins). A match with no move of yours
     * yet, one that is over, a scored deal waiting on Next deal, or an open score sheet is never paused. Returns
     * whether the state changed.
     */
    sessions(list) {
      const ready = watch.observe(list)
      if (ready.length === 0) return false
      const latest = ready[ready.length - 1]
      if (paused) {
        if (paused.tabId === latest.tabId && paused.name === latest.name) return false
        paused = latest
        return true
      }
      if (!inPlay()) return false
      paused = latest
      seq++
      return true
    },

    /**
     * Whether `view`'s page is on screen: `true` / `false` from the page (its hello, its visibility), `undefined`
     * when the page is gone (the panel hidden or closed in that view). Returns whether the computer players may now
     * move where they could not before, or the other way round.
     */
    setShown(view, visible) {
      if (typeof view !== 'string') return false
      const before = anyShown()
      if (visible === undefined) shown.delete(view)
      else shown.set(view, visible === true)
      return anyShown() !== before
    },

    /** The tab the pause names, for Go to the tab; null when not paused. */
    pausedTab: () => (paused ? paused.tabId : null),

    /**
     * Records from storage for `mode`: `{ won, lost }`. A stored count only raises the one this window knows (storage
     * counts every window's matches). Returns whether anything changed.
     */
    setStats(forMode, stored) {
      if (!R.isMode(forMode) || !stored || typeof stored !== 'object') return false
      let changed = false
      for (const k of OUTCOMES) {
        const v = stored[k]
        if (typeof v === 'number' && Number.isFinite(v) && v > stats[forMode][k]) {
          stats[forMode][k] = Math.floor(v)
          changed = true
        }
      }
      return changed
    },

    /** Four in pairs or three each for themselves; a change starts a new match. Returns whether it changed. */
    setMode(next) {
      if (!R.isMode(next) || next === n) return false
      n = next
      newMatch()
      return true
    },

    /** Easy or Normal, from the computer players' next move on (the match goes on). Returns whether it changed. */
    setLevel(next) {
      if (!bots.isLevel(next) || next === lvl) return false
      lvl = next
      seq++
      return true
    },

    /** The four-colour deck on or off (the app setting); returns whether it changed. */
    setFour(on) {
      const next = on === true
      if (next === four) return false
      four = next
      return true
    },

    mode: () => n,
    level: () => lvl,
    meta: () => headerMeta(n, m.total),
    isPaused: () => paused !== null,
    isSheetOpen: () => sheet,
    /** No move of yours in this match yet. */
    untouched: () => !started,
    /** The deal and the match themselves, for tests. */
    game: () => g,
    match: () => m,
  }
}

module.exports = { createController, headerMeta, STEP_MS, TRICK_MS, LAST_MS, REDEAL_MS, LEVEL_TEXT, MODE_TEXT }
