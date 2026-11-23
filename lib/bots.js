'use strict'
// The computer players' choices: one move for the seat whose turn it is, at the Easy or Normal level. Pure (`rng`
// injected); lib/controller.js applies the move through the same rules (lib/rules.js) your own moves go through, on
// a timer in the host, so you see each one.
//
// Bidding is the same at both levels: a hand is valued as if the suit were trump (with four, the turned card counted
// in, as the taker gets it); it takes at 52 or more with four, 58 with three, and in the second round names its best
// other suit over that line. A computer player holding the trump 7 always swaps it for the turned card.
//
// Easy plays a random legal card. Normal:
//   - leading: the taker's side draws trumps with the jack (the nine once the jack is gone) while others are out; else
//     an ace, a ten whose ace is gone, else the cheapest plain card;
//   - its partner winning: gives the most points it can when the trick is safe (the last to play, a high trump or an
//     untrumped ace winning), else the cheapest card;
//   - else wins the trick when it can (the cheapest winner when it plays last, the highest of the led suit, the lowest
//     trump that wins), and when it cannot, plays the cheapest card.

const R = require('./rules.js')

const LEVELS = Object.freeze(['easy', 'normal'])
const DEFAULT_LEVEL = 'normal'
const isLevel = (level) => level === 'easy' || level === 'normal'
/** What a hand must be worth to take the trump: four players, three players. */
const NEED = Object.freeze({ 4: 52, 3: 58 })

/** What seat `i`'s hand is worth with `s` as trump. */
function bidValue(g, i, s) {
  const h = g.players[i].hand.slice()
  if (g.mode === 4) h.push(g.turned)
  let v = 0
  let nt = 0
  for (const c of h) {
    if (c.s === s) {
      nt++
      v += (c.r === 11 ? 20 : c.r === 9 ? 14 : R.BASE[c.r]) + 4
    } else if (c.r === 14) v += 10
    else if (c.r === 10 && h.some((x) => x.s === c.s && x.r === 14)) v += 5
  }
  if (nt < 2) v -= 30
  return v
}

function chooseBid(g) {
  const i = g.turn
  const need = NEED[g.mode]
  if (g.phase === 'bid1') return bidValue(g, i, g.turned.s) >= need ? g.turned.s : 'pass'
  let best = 'pass'
  let bv = need - 1
  for (const s of R.SUITS) {
    if (s === g.turned.s) continue
    const v = bidValue(g, i, s)
    if (v > bv) {
      bv = v
      best = s
    }
  }
  return best
}

/** What a card costs to give away: its points first, then its strength. */
const cost = (g, c) => R.points(g, c) * 10 + (R.isTrump(g, c) ? 100 + R.TRUMP[c.r] : R.PLAIN[c.r])
const cheapest = (g, L) => L.slice().sort((a, b) => cost(g, a) - cost(g, b))[0]

/** Normal's card from the legal ones `L`. */
function chooseCard(g, i, L) {
  const playedOf = (s, r) => g.played.some((c) => c.s === s && c.r === r)
  const isT = (c) => R.isTrump(g, c)
  if (g.trick.length === 0) {
    const mineT = L.filter(isT)
    const outT = 8 - g.played.filter(isT).length - mineT.length
    if (R.sideOf(g.mode, i) === R.sideOf(g.mode, g.taker) && outT > 0) {
      const j = mineT.find((c) => c.r === 11)
      if (j) return j
      const nine = mineT.find((c) => c.r === 9)
      if (nine && playedOf(g.trump, 11)) return nine
    }
    const ace = L.find((c) => !isT(c) && c.r === 14)
    if (ace) return ace
    const ten = L.find((c) => !isT(c) && c.r === 10 && playedOf(c.s, 14))
    if (ten) return ten
    const plain = L.filter((c) => !isT(c) && c.r !== 10)
    return cheapest(g, plain.length > 0 ? plain : L)
  }
  const led = g.trick[0].c.s
  const w = g.trick[R.winnerIdx(g)]
  const last = g.trick.length === g.players.length - 1
  const partner = g.mode === 4 && R.sideOf(g.mode, w.p) === R.sideOf(g.mode, i)
  if (partner) {
    const safe = last || (isT(w.c) ? R.TRUMP[w.c.r] >= 6 : w.c.r === 14 && !g.trick.some((t) => isT(t.c)))
    if (safe) {
      const give = L.filter((c) => !isT(c)).sort((a, b) => R.points(g, b) - R.points(g, a))[0]
      if (give) return give
    }
    return cheapest(g, L)
  }
  const wins = L.filter((c) => R.power(g, c, led) > R.power(g, w.c, led))
  if (wins.length > 0) {
    if (last) return cheapest(g, wins)
    const inSuit = wins.filter((c) => c.s === led && !isT(c))
    if (inSuit.length > 0) return inSuit.sort((a, b) => R.PLAIN[b.r] - R.PLAIN[a.r])[0]
    return wins.slice().sort((a, b) => R.power(g, a, led) - R.power(g, b, led))[0]
  }
  return cheapest(g, L)
}

/** The move of the computer player whose turn it is, or null when it is nobody's (or your) turn. */
function choose(g, level, rng = Math.random) {
  const lv = isLevel(level) ? level : DEFAULT_LEVEL
  if (g.turn < 1 || g.turn >= g.players.length) return null
  if (g.phase === 'bid1' || g.phase === 'bid2') return { act: 'bid', choice: chooseBid(g) }
  if (g.phase === 'play') {
    const L = R.legal(g, g.turn)
    if (L.length === 0) return null
    const card = lv === 'easy' ? L[Math.min(L.length - 1, Math.floor(rng() * L.length))] : chooseCard(g, g.turn, L)
    return { act: 'play', card }
  }
  return null
}

/** Plays a move `choose` gave for the seat in turn; returns whether the game changed. */
function apply(g, m, move) {
  if (!move) return false
  if (move.act === 'bid') return R.bid(g, m, g.turn, move.choice)
  if (move.act === 'play') return R.play(g, g.turn, move.card)
  return false
}

module.exports = { LEVELS, DEFAULT_LEVEL, NEED, isLevel, bidValue, chooseBid, chooseCard, choose, apply }
