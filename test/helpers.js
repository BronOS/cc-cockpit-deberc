'use strict'
// Shared test helpers: a seeded RNG, cards by name, a stacked deck that deals the hands a test wants, a deal set up in
// the middle of play, and a random player for your seat.

const R = require('../lib/rules.js')

/** mulberry32: the same games every run for a seed. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RANKS = { 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 }
/** `c('10h')`, `c('As')`: rank then suit letter. */
function c(name) {
  const s = name.slice(-1)
  const r = RANKS[name.slice(0, -1)]
  if (!R.SUITS.includes(s) || !r) throw new Error(`bad card ${name}`)
  return { s, r }
}
const cs = (names) => (names.trim() === '' ? [] : names.trim().split(/\s+/).map(c))
const key = (x) => `${x.s}${x.r}`

/**
 * A 32-card order for `rules.newDeal` that deals `hands` (one string of six names per seat), turns `turned` up, and
 * then hands out `after` in the order the rest of the deal draws them (with four: seat 0's two, seat 1's two, ...,
 * the taker drawing one; with three: three each). Every other card sits below, in a fixed order.
 */
function stack(hands, turned, after = '') {
  const used = new Set()
  const take = (x) => {
    if (used.has(key(x))) throw new Error(`card twice: ${key(x)}`)
    used.add(key(x))
    return x
  }
  const dealt = hands.map((h) => cs(h).map(take))
  const pops = []
  for (let k = 0; k < 6; k++) for (const h of dealt) pops.push(h[k])
  pops.push(take(c(turned)))
  for (const x of cs(after)) pops.push(take(x))
  const rest = R.freshDeck().filter((x) => !used.has(key(x)))
  return [...rest, ...pops.reverse()]
}

/**
 * A deal in the middle of play, for a rule test: `hands` one string per seat (seat 0 you), `trump`, `taker`, the
 * `dealer` (the lead goes to the dealer's left unless `turn` says), and the cards already on the trick as
 * `[[seat, 'name'], ...]`.
 */
function setup({ mode = 4, trump = 's', taker = 0, dealer, hands, turn, trick = [] }) {
  const m = R.newMatch(mode, () => 0)
  if (dealer !== undefined) m.dealer = dealer
  const g = R.newDeal(m, () => 0)
  g.trump = trump
  g.taker = taker
  g.turned = null
  g.deck = []
  g.players.forEach((p, i) => {
    p.hand = hands[i] ? cs(hands[i]) : []
  })
  g.handSize = g.players[0].hand.length + trick.length
  g.melds = []
  g.players.forEach((p, i) => R.runs(p.hand).forEach((x) => g.melds.push({ ...x, p: i })))
  g.bellaHolder = g.players.findIndex(
    (p) => p.hand.some((x) => x.s === trump && x.r === 13) && p.hand.some((x) => x.s === trump && x.r === 12),
  )
  g.phase = 'play'
  g.said = {}
  g.trick = trick.map(([p, name]) => ({ p, c: c(name) }))
  g.played = g.trick.map((t) => t.c)
  g.turn = turn !== undefined ? turn : trick.length > 0 ? (trick[trick.length - 1][0] + 1) % g.players.length : R.nxt(g, g.dealer)
  g.log = ''
  return { g, m }
}

/** A move for your seat, at random: take or name a trump now and then, swap at random, play any legal card. */
function playMine(g, m, rng) {
  if (g.turn !== R.YOU) return false
  if (g.phase === 'bid1') return R.bid(g, m, R.YOU, rng() < 0.3 ? g.turned.s : 'pass')
  if (g.phase === 'bid2') {
    const others = R.SUITS.filter((s) => s !== g.turned.s)
    return R.bid(g, m, R.YOU, rng() < 0.3 ? others[Math.floor(rng() * others.length)] : 'pass')
  }
  if (g.phase === 'swap') return R.swap(g, m, R.YOU, rng() < 0.5)
  if (g.phase === 'play') {
    const L = R.legal(g, R.YOU)
    return R.play(g, R.YOU, L[Math.floor(rng() * L.length)])
  }
  return false
}

module.exports = { seeded, c, cs, key, stack, setup, playMine }
