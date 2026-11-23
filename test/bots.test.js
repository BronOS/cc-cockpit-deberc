'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const bots = require('../lib/bots.js')
const { c, stack, setup } = require('./helpers.js')

const never = () => {
  throw new Error('rng not expected')
}
const matchOf = (mode = 4, dealer = mode - 1) => {
  const m = R.newMatch(mode, () => 0)
  m.dealer = dealer
  return m
}

test('a hand’s value as trump: points + 4 per trump, 10 per other ace, 5 per ten beside its ace, 30 off with fewer than two trumps', () => {
  // Misha: Js 9s As + Ah 10h Kd; with four the turned 7s counts in.
  const order = stack(['8h 8d 8c 9h 9d 9c', 'Js 9s As Ah 10h Kd', 'Jh Jd Jc Qh Qd Qc', '10s Ks Qs 10d 10c Kh'], '7s')
  const m = matchOf(4, 0)
  const g = R.newDeal(m, Math.random, order)
  assert.equal(bots.bidValue(g, 1, 's'), 24 + 18 + 15 + 4 + 10 + 5)
  assert.equal(bots.bidValue(g, 1, 'd'), 4 + 4 + 10 + 10 + 5 - 30, 'one trump: 30 off')
  assert.equal(g.turn, 1)
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'bid', choice: 's' }, '76 ≥ 52: takes')
  assert.ok(bots.apply(g, m, bots.choose(g, 'normal', never)))
  assert.equal(g.taker, 1)
  assert.equal(bots.NEED[4], 52)
  assert.equal(bots.NEED[3], 58)
})

test('bidding: a weak hand passes; the second round names the best other suit over the line', () => {
  const order = stack(['8h 8d 8c 9h 9d 9c', '7s 8s Ah 7d Kd 7c', 'Jh Jd Jc Qh Qd Qc', '10s Ks Qs 10d 10c Kh'], 'Js')
  const m = matchOf(4, 0)
  const g = R.newDeal(m, Math.random, order)
  assert.deepEqual(bots.choose(g, 'easy', never), { act: 'bid', choice: 'pass' })
  g.phase = 'bid2'
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'bid', choice: 'pass' }, 'no other suit is worth it')
  g.players[1].hand = [c('Jd'), c('9d'), c('Ad'), c('10d'), c('Ah'), c('7c')]
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'bid', choice: 'd' })
})

test('Easy plays a random legal card', () => {
  const { g } = setup({ trump: 's', hands: ['', 'Ah 7h Ks 8d', '', ''], trick: [[0, 'Kh']], dealer: 3 })
  assert.deepEqual(bots.choose(g, 'easy', () => 0), { act: 'play', card: c('Ah') })
  assert.deepEqual(bots.choose(g, 'easy', () => 0.99), { act: 'play', card: c('7h') }, 'only hearts are legal')
})

test('Normal leading: the taker’s side draws trumps with the jack, then the nine once the jack is gone', () => {
  const { g } = setup({ trump: 's', taker: 1, hands: ['', 'Js 9s Ah 7d', '', ''], dealer: 0 })
  assert.equal(g.turn, 1)
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('Js') })
  g.players[1].hand = [c('9s'), c('Ah'), c('7d')]
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('Ah') }, 'the jack is still out: an ace instead')
  g.played = [c('Js')]
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('9s') })
})

test('Normal leading against the taker: an ace, a ten whose ace is gone, else the cheapest plain card', () => {
  const { g } = setup({ trump: 's', taker: 0, hands: ['', 'Ah 10d 7c Ks', '', ''], dealer: 0 })
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('Ah') })
  g.players[1].hand = [c('10d'), c('7c'), c('Ks')]
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('7c') }, 'a ten is kept while its ace is out')
  g.played = [c('Ad')]
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('10d') })
})

test('Normal following: its partner safely winning gets points; an opponent winning is beaten when it can be', () => {
  // Misha led the A♥ (untrumped): Sasha, his partner, gives the 10♥ (the most points of the legal ones).
  const { g } = setup({ trump: 's', hands: ['', '', '', '10h 7h Ks'], trick: [[1, 'Ah'], [2, '8h']], dealer: 0 })
  assert.equal(g.turn, 3)
  assert.deepEqual(bots.choose(g, 'normal', never), { act: 'play', card: c('10h') })
  // Lena (an opponent of Misha) led the K♥: Misha wins with his highest heart, the ace.
  const b = setup({ trump: 's', hands: ['', 'Ah 10h 7h', '', ''], trick: [[0, '9h'], [3, 'Kh']], dealer: 2, turn: 1 }).g
  b.trick = [{ p: 0, c: c('Kh') }]
  assert.deepEqual(bots.choose(b, 'normal', never), { act: 'play', card: c('Ah') })
  // Playing last: the cheapest card that wins.
  b.trick = [{ p: 2, c: c('Kh') }, { p: 3, c: c('Qh') }, { p: 0, c: c('Jh') }]
  assert.deepEqual(bots.choose(b, 'normal', never), { act: 'play', card: c('10h') })
  // Nothing wins: the cheapest.
  b.trick = [{ p: 0, c: c('7s') }]
  b.players[1].hand = [c('Ah'), c('7h'), c('Kd')]
  assert.deepEqual(bots.choose(b, 'normal', never), { act: 'play', card: c('7h') })
})

test('no move on your turn or outside bidding and play', () => {
  const { g, m } = setup({ trump: 's', hands: ['Ah', '7h', 'Kh', '8h'], dealer: 3 })
  assert.equal(g.turn, 0)
  assert.equal(bots.choose(g, 'normal', never), null)
  g.phase = 'trick'
  g.turn = 1
  assert.equal(bots.choose(g, 'normal', never), null)
  assert.equal(bots.apply(g, m, null), false)
  assert.equal(bots.isLevel('easy'), true)
  assert.equal(bots.isLevel('hard'), false)
})
