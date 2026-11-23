'use strict'
// Many whole matches, seeded, in both modes and at both levels: your seat played at random, the computer players by
// lib/bots.js. After every step: the 32 cards are all there once (hands, deck, the turned card, the cards played),
// nobody holds more than a hand, and every card played was legal for its player at that moment. Every deal of four
// scores exactly 162 in cards and the last trick (with three, 162 less the five cards nobody got). Nothing gets stuck:
// in every state someone may move or a step is due. Every match ends with a side at 501 or a deberc.
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const bots = require('../lib/bots.js')
const { seeded, key, playMine } = require('./helpers.js')

const MATCHES = Number(process.env.FUZZ_MATCHES) || 500
const MAX_STEPS = 40000

function check(g, where) {
  assert.equal(R.cardCount(g), 32, `${where}: 32 cards`)
  const all = [...g.players.flatMap((p) => p.hand), ...g.deck, ...(g.turned ? [g.turned] : []), ...g.played]
  assert.equal(new Set(all.map(key)).size, all.length, `${where}: no card twice`)
  const most = g.mode === 4 ? 8 : 9
  for (const p of g.players) assert.ok(p.hand.length <= most, `${where}: a hand of ${p.hand.length}`)
  if (g.phase === 'play') {
    assert.ok(g.turn >= 0 && g.turn < g.players.length, `${where}: whose turn`)
    assert.ok(R.legal(g, g.turn).length > 0, `${where}: the player in turn has no legal card`)
  }
}

/** The points the deal holds: every card counted with this trump, plus the last trick. */
const pointsOf = (g, cards) => cards.reduce((n, x) => n + R.points(g, x), 0)

function playMatch(mode, level, seed) {
  const rng = seeded(seed)
  const m = R.newMatch(mode, rng)
  let g = R.newDeal(m, rng)
  check(g, `seed ${seed} deal`)
  let steps = 0
  let deals = 0
  let redeals = 0
  let falls = 0
  while (!m.over && steps < MAX_STEPS) {
    steps++
    const where = `seed ${seed} step ${steps} (${g.phase})`
    let moved
    if (g.phase === 'trick') moved = R.collect(g)
    else if (g.phase === 'last') {
      const sum = g.pts.reduce((a, b) => a + b, 0)
      const unplayed = [...g.deck, ...(g.turned ? [g.turned] : [])]
      if (mode === 4) assert.equal(sum, 162, `${where}: a deal of four is worth 162`)
      assert.equal(sum + pointsOf(g, unplayed), 162, `${where}: the cards played and the ones nobody got make 162`)
      moved = R.endDeal(g, m)
      deals++
      if (!g.result.made) falls++
      if (!m.over) {
        assert.equal(g.phase, 'done')
        g = R.nextDeal(m, rng)
      }
    } else if (g.phase === 'redeal') {
      redeals++
      g = R.nextDeal(m, rng)
      moved = true
    } else if (g.turn === R.YOU) {
      if (g.phase === 'play') {
        const before = R.legal(g, R.YOU).map(key)
        const n = g.played.length
        moved = playMine(g, m, rng)
        assert.ok(before.includes(key(g.played[n])), `${where}: your card was legal`)
      } else moved = playMine(g, m, rng)
    } else {
      const move = bots.choose(g, level, rng)
      assert.ok(move, `${where}: no move for seat ${g.turn}`)
      if (move.act === 'play') {
        assert.ok(R.legal(g, g.turn).some((x) => R.same(x, move.card)), `${where}: ${g.players[g.turn].name}'s card was legal`)
      }
      moved = bots.apply(g, m, move)
    }
    assert.ok(moved, `${where}: nobody could move (turn ${g.turn})`)
    check(g, where)
  }
  assert.ok(m.over, `seed ${seed}: the match never ended`)
  assert.equal(g.phase, 'over')
  assert.ok(m.winner >= 0 && m.winner < R.nSides(mode), `seed ${seed}: winner ${m.winner}`)
  if (!g.deberc) {
    assert.ok(Math.max(...m.total) >= R.TARGET, `seed ${seed}: over before 501`)
    assert.equal(m.total[m.winner], Math.max(...m.total))
  }
  assert.equal(m.history.length, deals)
  for (const h of m.history) assert.equal(h.total.length, R.nSides(mode))
  return { won: m.winner === 0, deals, redeals, falls, deberc: !!g.deberc }
}

for (const mode of [4, 3]) {
  test(`${MATCHES} matches with ${mode} players: invariants hold, deals add up and every match ends`, () => {
    const tally = { won: 0, lost: 0, deals: 0, redeals: 0, falls: 0 }
    for (let k = 0; k < MATCHES; k++) {
      const level = k % 2 === 0 ? 'normal' : 'easy'
      const r = playMatch(mode, level, mode * 100000 + k)
      tally[r.won ? 'won' : 'lost']++
      tally.deals += r.deals
      tally.redeals += r.redeals
      tally.falls += r.falls
    }
    // A random player against the bots: every kind of end happens.
    assert.ok(tally.won > 0, 'you sometimes win')
    assert.ok(tally.lost > 0, 'you sometimes lose')
    assert.ok(tally.redeals > 0, 'everyone passing twice happens')
    assert.ok(tally.falls > 0, 'takers sometimes fall')
    assert.ok(tally.deals > tally.falls, 'takers mostly make it')
  })
}
