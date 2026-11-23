'use strict'
// Pure helpers of the Deberc page: what a card says, how big the cards are, how your hand overlaps to fit, where a
// card sits in the trick, a seat's badges, the trump box, the bid and swap buttons, the status line, the score rows,
// the covers (the pause, the score sheet, a deal's or the match's result), which key is which action, and whether a
// state is a new deal, a change or a resend. No DOM and no ccPanel, so `test/view.test.js` runs them under node; the
// page loads this file as a classic script (the CSP allows only the plugin's own files) and reads `DebercView`.
;(function (root) {
  const RANKS = { 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
  const RANK_NAMES = { 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }
  const SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' }
  const SUIT_NAMES = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }
  const SUITS = ['s', 'h', 'c', 'd']

  const has = (o, k) => (typeof k === 'string' || typeof k === 'number') && Object.prototype.hasOwnProperty.call(o, k)
  const isRed = (s) => s === 'h' || s === 'd'

  /**
   * One card as `{ rank, symbol, cls, label }`: the rank and the suit symbol are always both printed (in the corner,
   * and the symbol large), so no suit rests on its colour, and a trump carries a gold corner tab (a shape, not only a
   * shade). `cls` colours it: red or black, and `s-<suit>`, which the four-colour deck (a class on the felt) turns
   * blue for diamonds and green for clubs. Null for a junk card.
   */
  function face(card) {
    if (!card || !has(SYMBOLS, card.s) || !Number.isInteger(card.r) || !has(RANKS, card.r)) return null
    const trump = card.trump === true
    return {
      rank: RANKS[card.r],
      symbol: SYMBOLS[card.s],
      cls: `card ${isRed(card.s) ? 'red' : 'black'} s-${card.s}${trump ? ' trump' : ''}`,
      label: `${RANK_NAMES[card.r]} of ${SUIT_NAMES[card.s]}${trump ? ' (trump)' : ''}`,
    }
  }

  /** The short name of a card in text: `10♥`. */
  const short = (card) => (face(card) ? `${RANKS[card.r]}${SYMBOLS[card.s]}` : '')

  /** Card width bounds in px; the height is RATIO times the width. A huge panel stops at MAX_W rather than absurd cards. */
  const MIN_W = 30
  const MAX_W = 150
  const RATIO = 1.4
  /**
   * The felt's height the board needs, in card widths (the others' small backs, the trick's 2.3 card heights, your
   * hand, a lifted card included) plus the fixed rows (the scoreboard, names, status, buttons, your badges, gaps,
   * padding): the cards grow with the panel in both directions, and a short wide zone (the bottom one) gets smaller
   * cards rather than a hand cut off below.
   */
  const TALL = 5.4
  const FIXED_H = 290
  /** Across: about seven card widths, so eight or nine cards overlap a little. */
  const WIDE = 7.2

  /** The card width for a felt `width` by `height` px: the smaller of what the width and the height allow. */
  function cardWidth(width, height) {
    const w = Math.max(0, Number(width) || 0)
    const h = Math.max(0, Number(height) || 0)
    let cw = Math.floor(w / WIDE)
    if (h > 0) cw = Math.min(cw, Math.floor((h - FIXED_H) / TALL))
    return Math.max(MIN_W, Math.min(MAX_W, cw))
  }

  /**
   * How your `n` cards sit in `width` px at card width `cw`: `{ rows, step }`, `rows` the number of cards in each row,
   * `step` the px from one card's left edge to the next. They overlap to fit, at most a little apart; a panel so
   * narrow that a card would show less than its corner wraps to a second row.
   */
  function handLayout(n, width, cw) {
    const count = Math.max(0, Math.floor(Number(n) || 0))
    const w = Math.max(cw, Number(width) || 0)
    const minStep = Math.ceil(cw * 0.34)
    const stepFor = (k) => (k > 1 ? Math.min(cw + 4, (w - cw) / (k - 1)) : 0)
    let lines = 1
    while (lines < 3 && stepFor(Math.ceil(count / lines)) < minStep) lines++
    const per = Math.ceil(count / lines) || 0
    const rows = []
    for (let left = count; left > 0; left -= per) rows.push(Math.min(per, left))
    return { rows, step: Math.floor(stepFor(per) * 100) / 100 }
  }

  /** Where seat `p`'s card lies in the trick: with four, bottom, left, top, right; with three, bottom and the top two. */
  function trickPos(mode, p) {
    const pos = mode === 3 ? ['b', 'tl', 'tr'] : ['b', 'l', 't', 'r']
    return pos[p] || 'b'
  }

  const TAGS = { dealer: 'dealer', team: 'team', taker: 'taker', pass: 'pass', meld: 'meld' }
  /**
   * A seat's badges as `{ cls, text, title }`, the known kinds only. They read by shape and text, not shade: the dealer
   * a round D, the taker a bold ★ with the trump, a pass a dashed frame, a meld its name in a solid frame.
   */
  function tagsOf(seat) {
    const out = []
    for (const t of (seat && Array.isArray(seat.tags) ? seat.tags : [])) {
      if (!t || !has(TAGS, t.kind) || typeof t.text !== 'string') continue
      out.push({ cls: `tag ${TAGS[t.kind]}`, text: t.text, title: typeof t.title === 'string' ? t.title : '' })
    }
    return out
  }

  const takerName = (state) => (state.taker === 0 ? 'You' : (state.seats[state.taker] || {}).name || 'Someone')

  /**
   * The box beside the trick: while bidding the turned card and `offered` (first round) or `turned down` (second);
   * then the trump suit, who took it, and with three the turned card that stays face up over the four left over.
   */
  function trumpBox(state) {
    if (!state) return null
    if (!state.trump) {
      return { card: state.turned, lines: [state.phase === 'bid1' ? 'offered' : 'turned down'] }
    }
    const lines = ['trump', `${takerName(state)} took it`]
    const box = { suit: state.trump, red: isRed(state.trump), lines, extra: '' }
    if (state.turned && state.mode === 3 && state.phase !== 'swap') box.extra = `${short(state.turned)} + 4 face down`
    return box
  }

  /** The hint in an empty trick: your lead, or that the deal is still being bid. */
  function trickHint(state) {
    if (!state || state.trick.length > 0) return ''
    if (state.myTurn && state.phase === 'play') return 'Your lead: tap a card'
    if (state.phase === 'bid1' || state.phase === 'bid2' || state.phase === 'swap') return 'Bidding'
    return ''
  }

  /**
   * The buttons under the trick on your turn to bid or swap, as `{ label, msg, primary?, suit?, red? }`: Take the
   * offered suit or Pass; in the second round each other suit or Pass; Swap the trump 7 or Keep it.
   */
  function actsOf(state) {
    if (!state || !state.myTurn) return []
    if (state.phase === 'bid1' && state.turned) {
      return [
        { label: `Take ${SYMBOLS[state.turned.s]}`, msg: { act: 'bid', choice: state.turned.s }, primary: true },
        { label: 'Pass', msg: { act: 'bid', choice: 'pass' } },
      ]
    }
    if (state.phase === 'bid2' && state.turned) {
      const out = SUITS.filter((s) => s !== state.turned.s).map((s) => ({
        label: SYMBOLS[s],
        title: `Name ${SUIT_NAMES[s]} as trump`,
        msg: { act: 'bid', choice: s },
        suit: s,
        red: isRed(s),
      }))
      out.push({ label: 'Pass', msg: { act: 'bid', choice: 'pass' } })
      return out
    }
    if (state.phase === 'swap' && state.turned && state.trump) {
      return [
        { label: `Swap 7${SYMBOLS[state.trump]} for ${short(state.turned)}`, msg: { act: 'swap', yes: true }, primary: true },
        { label: 'Keep', msg: { act: 'swap', yes: false } },
      ]
    }
    return []
  }

  /**
   * The status line as parts `{ text, strong?, muted? }`: what just happened, then what you may do now (bold) with the
   * melds you hold before the first trick, or who is thinking (muted).
   */
  function statusOf(state) {
    if (!state) return []
    const parts = []
    if (state.log) parts.push({ text: state.log })
    if (state.myTurn) {
      if (state.phase === 'bid1' && state.turned) parts.push({ text: `Take ${SYMBOLS[state.turned.s]} as trump, or pass?`, strong: true })
      else if (state.phase === 'bid2') parts.push({ text: 'Name a trump suit, or pass.', strong: true })
      else if (state.phase === 'swap' && state.turned && state.trump) {
        parts.push({ text: `You hold the 7${SYMBOLS[state.trump]}: swap it for ${short(state.turned)}?`, strong: true })
      } else if (state.phase === 'play') {
        parts.push({ text: 'Your move.', strong: true })
        if (Array.isArray(state.myMelds) && state.myMelds.length > 0) parts.push({ text: `You hold ${state.myMelds.join(', ')}.`, muted: true })
      }
    } else if (state.thinking && !state.paused && !state.sheet) {
      parts.push({ text: `${state.thinking} is thinking…`, muted: true })
    }
    return parts
  }

  /**
   * The scoreboard: one row per side `{ name, total, pct, live, me }` (the bar toward the target, this deal's points
   * while it is played or just scored) and the line under it.
   */
  function scoreRows(state) {
    if (!state || !state.scores) return { rows: [], foot: '' }
    const target = state.target || 501
    const rows = state.scores.sides.map((s) => ({
      name: s.name,
      total: s.total,
      pct: Math.max(0, Math.min(100, (s.total / target) * 100)),
      live: typeof s.live === 'number' ? `this deal ${s.live}` : '',
      me: s.me === true,
    }))
    return { rows, foot: `to ${target} · deal ${state.scores.deal} · tap for the score sheet` }
  }

  /** The score sheet: every deal so far, like the paper one kept beside the table, and the totals. */
  function sheetTable(state) {
    const head = ['Deal', ...state.sideNames]
    const rows = state.history.map((h) => ({
      label: h.label,
      cells: h.add.map((v, s) => ({ main: `+${v}`, sub: String(h.total[s]) })),
      cls: h.made ? '' : 'fell',
    }))
    if (rows.length === 0) rows.push({ label: 'No deals finished yet.', cells: [], cls: 'none' })
    rows.push({ label: 'Total', cells: state.total.map(String), cls: 'sum' })
    return { head, rows }
  }

  /**
   * The cover over the board, or null for none: `{ kind, dot?, title, text?, table?, buttons: [{ label, msg, primary }] }`.
   * The pause wins, then the score sheet, then a deal's or the match's result.
   */
  function coverFor(state) {
    if (!state) return null
    if (state.paused) {
      return {
        kind: 'paused',
        dot: true,
        title: 'Claude is ready',
        text: `“${state.paused.name}” is waiting for you.`,
        buttons: [
          { label: 'Resume game', msg: { act: 'resume' }, primary: true },
          { label: 'Go to the tab', msg: { act: 'goto' }, primary: false },
        ],
      }
    }
    if (state.sheet) {
      return {
        kind: 'sheet',
        title: 'Score sheet',
        table: sheetTable(state),
        text: `First to ${state.target || 501} wins.`,
        buttons: [{ label: 'Back to the game', msg: { act: 'sheet', open: false }, primary: true }],
      }
    }
    const r = state.result
    if (r && (state.phase === 'done' || state.phase === 'over')) {
      const table = r.table ? { head: ['', ...r.table.head], rows: r.table.rows } : null
      return {
        kind: r.kind,
        title: r.title,
        text: r.text || '',
        table,
        buttons: [
          r.next === 'next'
            ? { label: 'Next deal', msg: { act: 'next' }, primary: true }
            : { label: 'New game', msg: { act: 'new' }, primary: true },
        ],
      }
    }
    return null
  }

  const KEYS = { n: 'new', N: 'new' }
  /** The action a key asks for while the board has focus (N), or null. */
  const actOfKey = (key) => (has(KEYS, key) ? KEYS[key] : null)

  /**
   * How a state relates to the one drawn (`shown`: `{ game, seq }` or null): `reset` for another deal, `change` for
   * a move, `same` for a resend (a hello's answer, a setting).
   */
  function changeOf(shown, state) {
    if (!shown || shown.game !== state.game) return 'reset'
    return shown.seq === state.seq ? 'same' : 'change'
  }

  /** A card's key, for elements that stay with a card across draws. */
  const keyOf = (card) => `${card.s}${card.r}`

  const api = {
    SYMBOLS,
    RATIO,
    MIN_W,
    MAX_W,
    face,
    short,
    cardWidth,
    handLayout,
    trickPos,
    tagsOf,
    trumpBox,
    trickHint,
    actsOf,
    statusOf,
    scoreRows,
    sheetTable,
    coverFor,
    actOfKey,
    changeOf,
    keyOf,
  }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.DebercView = api
})(globalThis)
