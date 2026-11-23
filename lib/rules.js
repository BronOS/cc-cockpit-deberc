'use strict'
// The Deberc game itself (the klaberjass family): a match to 501 for four players in two pairs (you and Lena across
// the table against Misha and Sasha) or three each for themselves. The 32-card deck, the deal, bidding for the trump
// (take the turned suit, or name another in a second round), the swap of the trump 7, the rest of the deal, following
// suit and trumping, melds (terz, 50, bella, deberc), the last trick, the taker falling, and the match's end. Pure (no
// ctx, no clock, no DOM; `rng` injected), so `test/rules.test.js` runs every rule under node and `test/fuzz.test.js`
// plays whole matches.
//
// The game lives in the host (lib/controller.js), one per project window; the page never sees the deck or the others'
// cards. What the page posts is untrusted: every move here checks what it gets, is a no-op that returns false when it
// does not apply, and says whether anything changed.
//
// A card is `{ s, r }`: suit `s` one of `s h c d`, rank `r` 7 to 14 (11 the jack, 14 the ace). Seat 0 is you; the
// others follow clockwise (with four: Misha on your left, Lena your partner across, Sasha on your right). A side is a
// pair with four (`seat % 2`: 0 is you and Lena) and a seat with three. A match `m` holds the totals and the score sheet;
// a deal `g` moves through phases:
//   bid1     the turned card's suit is offered: each in turn from the dealer's left takes it or passes (`turn`)
//   bid2     nobody took it: each in turn may name another suit or pass
//   redeal   everyone passed twice: the next deal comes on the next step
//   swap     you hold the trump 7 and may swap it for the turned card (`turn` is 0)
//   play     `turn` plays a card to the trick
//   trick    the trick is full: it is collected on the next step
//   last     the last trick is collected: the deal is scored on the next step
//   done     the deal is scored (`result`); the next deal waits for you
//   over     the match is over: a side reached 501, or a deberc won it on the spot (`m.winner`)

const SUITS = Object.freeze(['s', 'h', 'c', 'd'])
const SYMBOLS = Object.freeze({ s: '♠', h: '♥', d: '♦', c: '♣' })
const RANK_TEXT = Object.freeze({ 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })
const LOW = 7
const HIGH = 14
/** Strength in a plain suit (A 10 K Q J 9 8 7) and in trumps (J 9 A 10 K Q 8 7). */
const PLAIN = Object.freeze({ 7: 0, 8: 1, 9: 2, 11: 3, 12: 4, 13: 5, 10: 6, 14: 7 })
const TRUMP = Object.freeze({ 7: 0, 8: 1, 12: 2, 13: 3, 10: 4, 14: 5, 9: 6, 11: 7 })
/** Card points outside trumps; the jack of trumps is worth 20 and the nine 14. */
const BASE = Object.freeze({ 7: 0, 8: 0, 9: 0, 10: 10, 11: 2, 12: 3, 13: 4, 14: 11 })
const TARGET = 501
const LAST_TRICK = 10
const TERZ = 20
const FIFTY = 50
const BELLA = 20
/** Four players in pairs, or three each for themselves. */
const MODES = Object.freeze([4, 3])
const DEFAULT_MODE = 4
const NAMES = Object.freeze({ 4: Object.freeze(['You', 'Misha', 'Lena', 'Sasha']), 3: Object.freeze(['You', 'Misha', 'Sasha']) })
const YOU = 0

const isMode = (n) => n === 4 || n === 3
const isSuit = (s) => typeof s === 'string' && SUITS.includes(s)
const isRank = (r) => Number.isInteger(r) && r >= LOW && r <= HIGH
const isCard = (c) => !!c && typeof c === 'object' && isSuit(c.s) && isRank(c.r)
const cardName = (c) => `${RANK_TEXT[c.r]}${SYMBOLS[c.s]}`
const same = (a, b) => a.s === b.s && a.r === b.r

/** The 32 cards in a fixed order (suit by suit, 7 to ace). */
function freshDeck() {
  const deck = []
  for (const s of SUITS) for (let r = LOW; r <= HIGH; r++) deck.push({ s, r })
  return deck
}

/** Fisher-Yates in place; `rng` returns [0, 1). */
function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    const t = cards[i]
    cards[i] = cards[j]
    cards[j] = t
  }
  return cards
}

const sideOf = (mode, i) => (mode === 4 ? i % 2 : i)
const nSides = (mode) => (mode === 4 ? 2 : 3)
/** What the score calls a side: Us and Them with four, a player's name with three. */
const sideName = (mode, s) => (mode === 4 ? ['Us', 'Them'][s] : NAMES[3][s])
const who = (g, i) => (i === YOU ? 'You' : g.players[i].name)
/** `You pass.` / `Misha passes.` */
const verb = (g, i, v, vs) => `${who(g, i)} ${i === YOU ? v : vs}`
const nxt = (g, i) => (i + 1) % g.players.length
const hand = (g, i) => g.players[i].hand
const isTrump = (g, c) => !!g.trump && c.s === g.trump
const points = (g, c) => (isTrump(g, c) && c.r === 11 ? 20 : isTrump(g, c) && c.r === 9 ? 14 : BASE[c.r])
/** How strong `c` is in a trick led with suit `led`: any trump over the led suit, any other suit nothing. */
const power = (g, c, led) => (isTrump(g, c) ? 100 + TRUMP[c.r] : c.s === led ? PLAIN[c.r] : -1)

/** The card in `cards` with the suit and rank of `card`, or undefined (`card` is untrusted). */
function findIn(cards, card) {
  if (!isCard(card)) return undefined
  return cards.find((c) => same(c, card))
}

/** A new match: the totals at zero, an empty score sheet and a dealer picked at random. */
function newMatch(mode, rng = Math.random) {
  const n = isMode(mode) ? mode : DEFAULT_MODE
  return {
    mode: n,
    total: Array(nSides(n)).fill(0),
    dealer: Math.min(n - 1, Math.floor(rng() * n)),
    over: false,
    winner: null,
    history: [],
  }
}

/**
 * A new deal for match `m`: the deck shuffled (or `order` as given, 32 cards, dealt from its end: tests stack it), six
 * cards each one at a time from seat 0 round, then one card turned up: its suit is offered as trump, first to the
 * player on the dealer's left.
 */
function newDeal(m, rng = Math.random, order) {
  const mode = m.mode
  const deck = Array.isArray(order) && order.length === 32 ? order.map((c) => ({ s: c.s, r: c.r })) : shuffle(freshDeck(), rng)
  const players = NAMES[mode].map((name) => ({ name, hand: [] }))
  const g = {
    mode,
    dealer: m.dealer,
    deck,
    players,
    turned: null,
    trump: null,
    taker: null,
    phase: 'bid1',
    turn: -1,
    bids: 0,
    said: {},
    trick: [],
    played: [],
    pts: [0, 0, 0],
    meld: [0, 0, 0],
    bella: [0, 0, 0],
    melds: [],
    meldSide: null,
    bellaHolder: -1,
    bellaSeen: 0,
    tricks: 0,
    lastSide: null,
    handSize: 0,
    shownMelds: false,
    deberc: null,
    result: null,
    log: '',
  }
  for (let k = 0; k < 6; k++) for (const p of players) p.hand.push(deck.pop())
  g.turned = deck.pop()
  g.turn = nxt(g, m.dealer)
  g.log = `${verb(g, m.dealer, 'deal', 'deals')}. ${SYMBOLS[g.turned.s]} is offered as trump.`
  return g
}

/** The next deal of the match: the deal passes to the left. */
function nextDeal(m, rng = Math.random, order) {
  m.dealer = (m.dealer + 1) % m.mode
  return newDeal(m, rng, order)
}

// ---------- bidding ----------

/**
 * Seat `i` bids (its turn in `bid1` or `bid2`): `'pass'`, or a suit: in the first round only the turned card's suit,
 * in the second only another one. Two rounds of passes ask for a new deal (`redeal`).
 */
function bid(g, m, i, choice) {
  if ((g.phase !== 'bid1' && g.phase !== 'bid2') || g.turn !== i) return false
  if (choice !== 'pass') {
    if (!isSuit(choice)) return false
    if (g.phase === 'bid1' && choice !== g.turned.s) return false
    if (g.phase === 'bid2' && choice === g.turned.s) return false
    takeTrump(g, m, i, choice)
    return true
  }
  g.said[i] = 'pass'
  g.bids++
  g.log = `${verb(g, i, 'pass', 'passes')}.`
  if (g.bids === g.players.length) {
    if (g.phase === 'bid1') {
      g.phase = 'bid2'
      g.bids = 0
      g.said = {}
      g.turn = nxt(g, g.dealer)
      g.log = `Nobody took ${SYMBOLS[g.turned.s]}. Second round: name another suit or pass.`
    } else {
      g.log = 'Everyone passed again: new deal.'
      g.phase = 'redeal'
      g.turn = -1
    }
  } else g.turn = nxt(g, i)
  return true
}

/** The seat holding the 7 of suit `s`, or -1. */
const sevenHolder = (g, s) => g.players.findIndex((p) => p.hand.some((c) => c.s === s && c.r === 7))

function takeTrump(g, m, i, s) {
  g.taker = i
  g.trump = s
  g.said = { [i]: 'takes' }
  g.turn = -1
  g.log = `${verb(g, i, 'take', 'takes')} ${SYMBOLS[s]}.`
  // Whoever holds the trump 7 may swap it for the turned card: you are asked, a computer player always does.
  if (s === g.turned.s && g.turned.r !== 7) {
    const h = sevenHolder(g, s)
    if (h === YOU) {
      g.phase = 'swap'
      g.turn = YOU
      return
    }
    if (h > 0) swapSeven(g, h)
  }
  dealRest(g, m)
}

function swapSeven(g, h) {
  const hh = hand(g, h)
  const k = hh.findIndex((c) => c.s === g.trump && c.r === 7)
  const seven = hh[k]
  hh[k] = g.turned
  g.log += ` ${verb(g, h, 'swap', 'swaps')} the 7 for ${cardName(g.turned)}.`
  g.turned = seven
}

/** Your answer in `swap`: `yes` swaps your trump 7 for the turned card; either way the rest is dealt. */
function swap(g, m, i, yes) {
  if (g.phase !== 'swap' || g.turn !== i || i !== YOU) return false
  if (yes === true) swapSeven(g, i)
  g.turn = -1
  dealRest(g, m)
  return true
}

/**
 * The rest of the deal: with four, two more each (the taker gets the turned card and one more); with three, three
 * more each, the turned card staying face up under the four left over. Then the melds are found (a deberc wins the
 * match on the spot) and the player on the dealer's left leads.
 */
function dealRest(g, m) {
  for (let i = 0; i < g.players.length; i++) {
    if (g.mode === 4) {
      if (i === g.taker) hand(g, i).push(g.turned, g.deck.pop())
      else hand(g, i).push(g.deck.pop(), g.deck.pop())
    } else hand(g, i).push(g.deck.pop(), g.deck.pop(), g.deck.pop())
  }
  if (g.mode === 4) g.turned = null
  g.handSize = hand(g, YOU).length
  g.melds = []
  g.players.forEach((p, i) => runs(p.hand).forEach((x) => g.melds.push({ ...x, p: i })))
  g.bellaHolder = g.players.findIndex(
    (p) => p.hand.some((c) => c.s === g.trump && c.r === 13) && p.hand.some((c) => c.s === g.trump && c.r === 12),
  )
  const deb = g.melds.find((x) => x.len === 8)
  if (deb) {
    g.deberc = { p: deb.p, s: deb.s }
    g.phase = 'over'
    g.turn = -1
    g.log = `Deberc! ${verb(g, deb.p, 'hold', 'holds')} all eight ${SYMBOLS[deb.s]} in a row.`
    m.over = true
    m.winner = sideOf(g.mode, deb.p)
    return
  }
  g.phase = 'play'
  g.turn = nxt(g, g.dealer)
}

// ---------- melds ----------

/** Runs of three or more in one suit, in the natural order 7 8 9 10 J Q K A: `{ s, len, top, value }`. */
function runs(cards) {
  const out = []
  for (const s of SUITS) {
    const rs = cards
      .filter((c) => c.s === s)
      .map((c) => c.r)
      .sort((a, b) => a - b)
    let start = 0
    for (let k = 1; k <= rs.length; k++) {
      if (k < rs.length && rs[k] === rs[k - 1] + 1) continue
      const len = k - start
      if (len >= 3) out.push({ s, len, top: rs[k - 1], value: len >= 4 ? FIFTY : TERZ })
      start = k
    }
  }
  return out
}

const meldName = (x) => `${x.len >= 4 ? `${x.len} in a row` : 'terz'} to ${RANK_TEXT[x.top]}${SYMBOLS[x.s]}`

/**
 * The best meld: 50 over terz, then the longer run, the higher top card, trumps, and the player who plays first
 * (from the dealer's left). Pure: `g` gives the trump, the dealer and the seats.
 */
function bestMeld(g, melds = g.melds) {
  if (melds.length === 0) return null
  const lead = nxt(g, g.dealer)
  const order = (p) => (p - lead + g.players.length) % g.players.length
  const key = (x) => [x.value, x.len, x.top, x.s === g.trump ? 1 : 0, -order(x.p)]
  return melds.slice().sort((a, b) => {
    const x = key(a)
    const y = key(b)
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k]
    return 0
  })[0]
}

/** After the first trick: only the side with the best meld scores its melds. Returns the log's text for it. */
function resolveMelds(g) {
  g.shownMelds = true
  const best = bestMeld(g)
  if (!best) return ''
  g.meldSide = sideOf(g.mode, best.p)
  g.meld[g.meldSide] = g.melds.filter((x) => sideOf(g.mode, x.p) === g.meldSide).reduce((n, x) => n + x.value, 0)
  return ` Melds: ${verb(g, best.p, 'have', 'has')} the best, ${meldName(best)}: +${g.meld[g.meldSide]} for ${sideName(g.mode, g.meldSide)}.`
}

// ---------- play ----------

/** The index in `trick` of the card winning it so far. */
function winnerIdx(g, trick = g.trick) {
  const led = trick[0].c.s
  let w = 0
  trick.forEach((t, k) => {
    if (power(g, t.c, led) > power(g, trick[w].c, led)) w = k
  })
  return w
}

/**
 * The cards seat `i` may play now. Follow suit. On a trump lead, go higher than the trumps in the trick if you can.
 * Unable to follow a plain suit: you must trump, over the trick's highest trump if you can, unless (with four) your
 * partner is winning the trick. Holding none of those: anything.
 */
function legal(g, i) {
  const h = hand(g, i)
  if (g.trick.length === 0) return h.slice()
  const led = g.trick[0].c.s
  const follow = h.filter((c) => c.s === led)
  const best = g.trick[winnerIdx(g)]
  const topTrump = g.trick.filter((t) => isTrump(g, t.c)).reduce((x, t) => Math.max(x, TRUMP[t.c.r]), -1)
  if (led === g.trump) {
    if (follow.length === 0) return h.slice()
    const higher = follow.filter((c) => TRUMP[c.r] > topTrump)
    return higher.length > 0 ? higher : follow
  }
  if (follow.length > 0) return follow
  const trumps = h.filter((c) => isTrump(g, c))
  if (trumps.length === 0) return h.slice()
  if (g.mode === 4 && sideOf(g.mode, best.p) === sideOf(g.mode, i)) return h.slice()
  const over = trumps.filter((c) => TRUMP[c.r] > topTrump)
  return over.length > 0 ? over : trumps
}

/**
 * Seat `i` plays `card` (its turn in `play`, a legal card). The second of the bella holder's king and queen of trumps
 * scores the bella. A full trick waits for the next step (`trick`).
 */
function play(g, i, card) {
  if (g.phase !== 'play' || g.turn !== i) return false
  const c = findIn(legal(g, i), card)
  if (!c) return false
  const h = hand(g, i)
  h.splice(h.indexOf(c), 1)
  g.trick.push({ p: i, c })
  g.played.push(c)
  let note = ''
  if (i === g.bellaHolder && isTrump(g, c) && (c.r === 12 || c.r === 13) && ++g.bellaSeen === 2) {
    g.bella[sideOf(g.mode, i)] += BELLA
    note = ` Bella! +${BELLA}`
  }
  g.log = `${verb(g, i, 'play', 'plays')} ${cardName(c)}.${note}`
  if (g.trick.length === g.players.length) {
    g.phase = 'trick'
    g.turn = -1
  } else g.turn = nxt(g, i)
  return true
}

/** The full trick goes to its winner, who leads next; the first one shows the melds, the last one is worth 10. */
function collect(g) {
  if (g.phase !== 'trick') return false
  const w = g.trick[winnerIdx(g)].p
  const s = sideOf(g.mode, w)
  const got = g.trick.reduce((n, t) => n + points(g, t.c), 0)
  g.pts[s] += got
  g.tricks++
  g.trick = []
  g.log = `${verb(g, w, 'take', 'takes')} the trick (+${got}).`
  if (g.tricks === 1) g.log += resolveMelds(g)
  if (g.tricks === g.handSize) {
    g.pts[s] += LAST_TRICK
    g.lastSide = s
    g.log += ` Last trick +${LAST_TRICK}.`
    g.phase = 'last'
    g.turn = -1
    return true
  }
  g.phase = 'play'
  g.turn = w
  return true
}

/**
 * The deal is scored. The taker's side must score more than the other side (with three: more than each of the others).
 * If it does not, it falls: it keeps only its bella, and the opponents take everything else (with three, the taker's
 * cards and melds are split between the other two). The score sheet gets a row; a side at 501 or more ends the match.
 */
function endDeal(g, m) {
  if (g.phase !== 'last') return false
  const n = nSides(g.mode)
  const ts = sideOf(g.mode, g.taker)
  const deal = [...Array(n)].map((_, s) => g.pts[s] + g.meld[s] + g.bella[s])
  const others = [...Array(n).keys()].filter((s) => s !== ts)
  const made = others.every((s) => deal[ts] > deal[s])
  let add = deal.slice()
  if (!made) {
    add = Array(n).fill(0)
    add[ts] = g.bella[ts]
    if (g.mode === 4) add[others[0]] = g.pts[0] + g.pts[1] + g.meld[0] + g.meld[1] + g.bella[others[0]]
    else {
      // The mock-up's split: each other player gets half the pot, rounded (an odd pot gives one point twice).
      const pot = g.pts[ts] + g.meld[ts]
      for (const s of others) add[s] = deal[s] + Math.round(pot / 2)
    }
  }
  add.forEach((v, s) => {
    m.total[s] += v
  })
  m.history.push({ taker: g.taker, trump: g.trump, made, add: add.slice(), total: m.total.slice() })
  g.result = { made, deal, add, ts }
  g.turn = -1
  const top = Math.max(...m.total)
  if (top >= TARGET) {
    m.over = true
    m.winner = m.total.indexOf(top)
    g.phase = 'over'
  } else g.phase = 'done'
  return true
}

/** Every card of the deal, wherever it is: the hands, the deck, the turned card, the cards played (the trick too). */
function cardCount(g) {
  return g.players.reduce((n, p) => n + p.hand.length, 0) + g.deck.length + (g.turned ? 1 : 0) + g.played.length
}

/** Your hand, high to low from the left: trumps first (J 9 A 10 K Q 8 7), then each suit A K Q J 10 9 8 7. */
function sortedHand(g, cards) {
  const order = g.trump ? [g.trump, ...SUITS.filter((s) => s !== g.trump)] : SUITS
  return cards
    .slice()
    .sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || (isTrump(g, a) ? TRUMP[b.r] - TRUMP[a.r] : b.r - a.r))
}

module.exports = {
  SUITS,
  SYMBOLS,
  RANK_TEXT,
  PLAIN,
  TRUMP,
  BASE,
  TARGET,
  LAST_TRICK,
  MODES,
  DEFAULT_MODE,
  NAMES,
  YOU,
  isMode,
  isSuit,
  isCard,
  cardName,
  same,
  freshDeck,
  shuffle,
  sideOf,
  nSides,
  sideName,
  who,
  nxt,
  isTrump,
  points,
  power,
  findIn,
  newMatch,
  newDeal,
  nextDeal,
  bid,
  swap,
  runs,
  meldName,
  bestMeld,
  winnerIdx,
  legal,
  play,
  collect,
  endDeal,
  cardCount,
  sortedHand,
}
