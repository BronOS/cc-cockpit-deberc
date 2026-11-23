'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const { c, cs, key, stack, setup } = require('./helpers.js')

const names = (cards) => cards.map(R.cardName).join(' ')
/** A match whose dealer is `dealer` (seat 3 by default with four, so you bid first). */
const matchOf = (mode = 4, dealer = mode - 1) => {
  const m = R.newMatch(mode, () => 0)
  m.dealer = dealer
  return m
}

test('the deck: 32 cards, 7 to ace in four suits; points J 20 and 9 14 in trumps, A 11, 10 10, K 4, Q 3, plain J 2', () => {
  const deck = R.freshDeck()
  assert.equal(deck.length, 32)
  assert.equal(new Set(deck.map(key)).size, 32)
  const g = { trump: 's' }
  assert.deepEqual(['Js', '9s', 'As', '10s', 'Ks', 'Qs', '8s', '7s'].map((n) => R.points(g, c(n))), [20, 14, 11, 10, 4, 3, 0, 0])
  assert.deepEqual(['Jh', '9h', 'Ah', '10h', 'Kh', 'Qh', '8h', '7h'].map((n) => R.points(g, c(n))), [2, 0, 11, 10, 4, 3, 0, 0])
  const all = deck.reduce((n, x) => n + R.points(g, x), 0)
  assert.equal(all + R.LAST_TRICK, 162, 'a deal is worth 162')
})

test('a deal: six each, one card turned up and offered to the dealer’s left', () => {
  const m = matchOf(4, 1)
  const g = R.newDeal(m, Math.random)
  assert.equal(g.players.length, 4)
  assert.deepEqual(g.players.map((p) => p.name), ['You', 'Misha', 'Lena', 'Sasha'])
  for (const p of g.players) assert.equal(p.hand.length, 6)
  assert.ok(g.turned)
  assert.equal(g.deck.length, 32 - 24 - 1)
  assert.equal(R.cardCount(g), 32)
  assert.equal(g.phase, 'bid1')
  assert.equal(g.turn, 2, 'the dealer’s left')
  assert.equal(g.trump, null)
  assert.match(g.log, /^Misha deals\. . is offered as trump\.$/)
  const three = R.newDeal(matchOf(3, 2), Math.random)
  assert.deepEqual(three.players.map((p) => p.name), ['You', 'Misha', 'Sasha'])
  assert.equal(three.deck.length, 32 - 18 - 1)
  assert.equal(three.turn, 0)
})

test('bidding: the first round takes the turned suit or passes; the second names another suit; two rounds of passes deal again', () => {
  const m = matchOf(4, 3)
  const g = R.newDeal(m, () => 0.5)
  const offered = g.turned.s
  const other = R.SUITS.find((s) => s !== offered)
  assert.equal(R.bid(g, m, 1, 'pass'), false, 'not Misha’s turn')
  assert.equal(R.bid(g, m, 0, other), false, 'the first round offers only the turned suit')
  assert.equal(R.bid(g, m, 0, 'x'), false)
  assert.equal(R.bid(g, m, 0, { s: 'h' }), false)
  for (let i = 0; i < 4; i++) assert.ok(R.bid(g, m, i, 'pass'))
  assert.equal(g.phase, 'bid2')
  assert.equal(g.turn, 0)
  assert.match(g.log, /Second round: name another suit or pass\./)
  assert.equal(R.bid(g, m, 0, offered), false, 'the second round may not name the turned suit')
  for (let i = 0; i < 4; i++) assert.ok(R.bid(g, m, i, 'pass'))
  assert.equal(g.phase, 'redeal')
  assert.equal(g.turn, -1)
  assert.equal(g.log, 'Everyone passed again: new deal.')
  assert.equal(R.bid(g, m, 0, 'pass'), false)
  const next = R.nextDeal(m, () => 0.5)
  assert.equal(m.dealer, 0, 'the deal passes to the left')
  assert.equal(next.turn, 1)
  assert.equal(next.phase, 'bid1')
})

test('taking with four: the taker gets the turned card and one more, everyone else two; 8 each, the deck empty', () => {
  // You are first to bid (dealer Sasha); Kh is turned. Nobody holds the 7h yet (it is dealt later): no swap.
  const order = stack(['As Ad Ac Jh 9h 10s', 'Ks Kd Kc Qs Qd Qc', 'Js Jd Jc 9s 9d 9c', '8s 8d 8c 8h 7s 7d'], 'Kh', '10h 10d 7h 7c Ah 10c Qh')
  const m = matchOf(4, 3)
  const g = R.newDeal(m, Math.random, order)
  assert.deepEqual(g.turned, c('Kh'))
  assert.ok(R.bid(g, m, 0, 'h'))
  assert.equal(g.trump, 'h')
  assert.equal(g.taker, 0)
  assert.equal(g.phase, 'play')
  assert.equal(g.turned, null, 'it went to the taker')
  for (const p of g.players) assert.equal(p.hand.length, 8)
  assert.ok(g.players[0].hand.some((x) => R.same(x, c('Kh'))))
  assert.ok(g.players[0].hand.some((x) => R.same(x, c('10h'))), 'and one more')
  assert.equal(g.deck.length, 0)
  assert.equal(g.turn, 0, 'the dealer’s left leads')
  assert.equal(g.log, 'You take ♥.')
  assert.equal(R.cardCount(g), 32)
})

test('taking with three: three more each, the turned card stays face up over the four left', () => {
  const m = matchOf(3, 2)
  const g = R.newDeal(m, () => 0.3)
  const turned = g.turned
  const holder = g.players.findIndex((p) => p.hand.some((x) => x.s === turned.s && x.r === 7))
  assert.ok(R.bid(g, m, 0, turned.s))
  if (g.phase === 'swap') assert.ok(R.swap(g, m, 0, false))
  for (const p of g.players) assert.equal(p.hand.length, 9)
  assert.equal(g.deck.length, 4)
  assert.ok(g.turned)
  if (holder <= 0) assert.deepEqual(g.turned, turned)
  assert.equal(R.cardCount(g), 32)
})

test('the trump 7: you are asked to swap it; a computer player always does; not for a turned 7 or a named suit', () => {
  // You hold the 7h; Misha takes the turned Ah.
  let order = stack(['7h 8s 9s 10d Jd Qd', 'Ks Kd Kc Qs Jh Qc', 'Js 10h Jc 9h 9d 9c', '8h 8d 8c As 7s 7d'], 'Ah')
  let m = matchOf(4, 3)
  let g = R.newDeal(m, Math.random, order)
  assert.ok(R.bid(g, m, 0, 'pass'))
  assert.ok(R.bid(g, m, 1, 'h'))
  assert.equal(g.phase, 'swap')
  assert.equal(g.turn, 0)
  assert.equal(R.swap(g, m, 1, true), false, 'yours to answer')
  assert.ok(R.swap(g, m, 0, true))
  assert.ok(g.players[0].hand.some((x) => R.same(x, c('Ah'))), 'you hold the ace now')
  assert.ok(g.players[1].hand.some((x) => R.same(x, c('7h'))), 'the taker got the 7')
  assert.match(g.log, /You swap the 7 for A♥\./)
  assert.equal(g.phase, 'play')

  g = R.newDeal((m = matchOf(4, 3)), Math.random, order)
  R.bid(g, m, 0, 'pass')
  R.bid(g, m, 1, 'h')
  assert.ok(R.swap(g, m, 0, false))
  assert.ok(g.players[0].hand.some((x) => R.same(x, c('7h'))), 'kept')
  assert.ok(g.players[1].hand.some((x) => R.same(x, c('Ah'))))

  // Lena holds the 7h and you take: she swaps.
  order = stack(['8h 8s 9s 10d Jd Qd', 'Ks Kd Kc Qs Jh Qc', 'Js 7h Jc 9h 9d 9c', '10h 8d 8c As 7s 7d'], 'Ah')
  g = R.newDeal((m = matchOf(4, 3)), Math.random, order)
  assert.ok(R.bid(g, m, 0, 'h'))
  assert.equal(g.phase, 'play')
  assert.ok(g.players[2].hand.some((x) => R.same(x, c('Ah'))))
  assert.ok(g.players[0].hand.some((x) => R.same(x, c('7h'))))
  assert.match(g.log, /Lena swaps the 7 for A♥\./)

  // A turned 7 is not swapped; nor is anything when the trump was named in the second round.
  order = stack(['8h 8s 9s 10d Jd Qd', 'Ks Kd Kc Qs Jh Qc', 'Js 10h Jc 9h 9d 9c', 'Ah 8d 8c As 7s 7d'], '7h')
  g = R.newDeal((m = matchOf(4, 3)), Math.random, order)
  assert.ok(R.bid(g, m, 0, 'h'))
  assert.equal(g.phase, 'play')
  order = stack(['7s 8s 9s 10d Jd Qd', 'Ks Kd Kc Qs Jh Qc', 'Js 10h Jc 9h 9d 9c', 'Ah 8d 8c As 7h 7d'], 'Ac')
  g = R.newDeal((m = matchOf(4, 3)), Math.random, order)
  for (let i = 0; i < 4; i++) R.bid(g, m, i, 'pass')
  assert.ok(R.bid(g, m, 0, 's'))
  assert.equal(g.phase, 'play', 'no swap for a named suit')
})

test('strength: plain A 10 K Q J 9 8 7, trumps J 9 A 10 K Q 8 7, any trump over the led suit, another suit nothing', () => {
  const g = { trump: 's' }
  const plain = cs('Ah 10h Kh Qh Jh 9h 8h 7h')
  for (let k = 1; k < plain.length; k++) assert.ok(R.power(g, plain[k - 1], 'h') > R.power(g, plain[k], 'h'))
  const trumps = cs('Js 9s As 10s Ks Qs 8s 7s')
  for (let k = 1; k < trumps.length; k++) assert.ok(R.power(g, trumps[k - 1], 'h') > R.power(g, trumps[k], 'h'))
  assert.ok(R.power(g, c('7s'), 'h') > R.power(g, c('Ah'), 'h'))
  assert.equal(R.power(g, c('Ad'), 'h'), -1)
  const t = { trump: 's', trick: [{ p: 0, c: c('Kh') }, { p: 1, c: c('Ah') }, { p: 2, c: c('Ad') }, { p: 3, c: c('10h') }] }
  assert.equal(R.winnerIdx(t), 1)
})

test('legal: follow suit; void, you must trump', () => {
  const { g } = setup({ trump: 's', hands: ['Ah 7h Ks 8d', '', '', ''], trick: [[3, 'Kh']], dealer: 2 })
  assert.equal(g.turn, 0)
  assert.equal(names(R.legal(g, 0)), 'A♥ 7♥', 'follow hearts')
  g.players[0].hand = cs('Ks 7s 8d Ac')
  assert.equal(names(R.legal(g, 0)), 'K♠ 7♠', 'no hearts: trump')
  g.players[0].hand = cs('8d Ac')
  assert.equal(names(R.legal(g, 0)), '8♦ A♣', 'no hearts, no trumps: anything')
  g.trick = []
  assert.equal(R.legal(g, 0).length, 2, 'a lead: anything')
})

test('legal: over a trump in the trick you must overtrump when you can, else any trump', () => {
  // Lena (your partner) led Kh, Sasha trumped with the 10♠; you hold no hearts.
  const { g } = setup({ trump: 's', hands: ['Js 7s 8d', 'Qh', 'Ad', ''], trick: [[2, 'Kh'], [3, '10s']], dealer: 1 })
  assert.equal(g.turn, 0)
  assert.equal(names(R.legal(g, 0)), 'J♠', 'only the jack beats the 10')
  g.players[0].hand = cs('Qs 7s 8d')
  assert.equal(names(R.legal(g, 0)), 'Q♠ 7♠', 'nothing beats it: still a trump')
})

test('legal: a trump lead must be followed higher when you can', () => {
  const { g } = setup({ trump: 's', hands: ['9s 7s Ah', '', '', ''], trick: [[3, 'As']], dealer: 2 })
  assert.equal(names(R.legal(g, 0)), '9♠', 'the 9 beats the ace')
  g.players[0].hand = cs('Ks 7s Ah')
  assert.equal(names(R.legal(g, 0)), 'K♠ 7♠', 'nothing higher: any trump')
  g.players[0].hand = cs('Ah Kd')
  assert.equal(names(R.legal(g, 0)), 'A♥ K♦', 'no trumps: anything')
})

test('legal: with four, your partner winning the trick frees you from trumping; with three there is no partner', () => {
  // Lena led the A♥ and wins; Sasha followed. You have no hearts: anything goes.
  const { g } = setup({ trump: 's', hands: ['Ks 8d', '', '', ''], trick: [[2, 'Ah'], [3, '7h']], dealer: 1 })
  assert.equal(names(R.legal(g, 0)), 'K♠ 8♦')
  // Sasha trumps over Lena: now you must overtrump.
  g.trick = [{ p: 2, c: c('Ah') }, { p: 3, c: c('8s') }]
  assert.equal(names(R.legal(g, 0)), 'K♠')
  // Misha (an opponent) winning: trump.
  const four = setup({ trump: 's', hands: ['Ks 8d', '', '', ''], trick: [[3, '7h'], [1, 'Ah']], dealer: 2, turn: 0 }).g
  assert.equal(names(R.legal(four, 0)), 'K♠')
  // With three, Sasha's ace is never "your partner's".
  const three = setup({ mode: 3, trump: 's', hands: ['Ks 8d', '', ''], trick: [[1, 'Kh'], [2, 'Ah']], dealer: 0 }).g
  assert.equal(three.turn, 0)
  assert.equal(names(R.legal(three, 0)), 'K♠')
})

test('play: only your turn and a legal card; junk refused; a full trick waits to be collected', () => {
  const { g } = setup({ trump: 's', hands: ['Ah 7h Ks', '10h', 'Kh', 'Qh'], dealer: 3 })
  assert.equal(g.turn, 0)
  assert.equal(R.play(g, 1, c('10h')), false)
  for (const junk of [null, {}, { s: 'h', r: 15 }, { s: 'x', r: 14 }, { s: '__proto__', r: 14 }, c('Jd')]) assert.equal(R.play(g, 0, junk), false)
  assert.ok(R.play(g, 0, c('7h')))
  assert.equal(R.play(g, 1, c('Ks')), false, 'not in Misha’s hand')
  assert.ok(R.play(g, 1, c('10h')))
  assert.ok(R.play(g, 2, c('Kh')))
  assert.ok(R.play(g, 3, c('Qh')))
  assert.equal(g.phase, 'trick')
  assert.equal(g.turn, -1)
  assert.equal(g.log, 'Sasha plays Q♥.')
  assert.ok(R.collect(g))
  assert.equal(g.turn, 1, 'Misha’s 10 took it and leads')
  assert.deepEqual(g.pts.slice(0, 2), [0, 17])
  assert.equal(g.log, 'Misha takes the trick (+17).')
})

test('the last trick is worth 10 and ends the deal', () => {
  const { g, m } = setup({ trump: 's', taker: 0, hands: ['Ah', '7h', 'Kh', '8h'], dealer: 3 })
  for (const [p, n] of [[0, 'Ah'], [1, '7h'], [2, 'Kh'], [3, '8h']]) assert.ok(R.play(g, p, c(n)))
  assert.ok(R.collect(g))
  assert.equal(g.phase, 'last')
  assert.equal(g.pts[0], 25)
  assert.equal(g.lastSide, 0)
  assert.match(g.log, /Last trick \+10\.$/)
  assert.ok(R.endDeal(g, m))
  assert.equal(g.phase, 'done')
  assert.deepEqual(m.total, [25, 0])
})

test('melds: three in a row a terz (20), four or more 50, eight a deberc; by natural order 7 to A', () => {
  assert.deepEqual(R.runs(cs('7h 8h 9h Kd')), [{ s: 'h', len: 3, top: 9, value: 20 }])
  assert.deepEqual(R.runs(cs('9c 10c Jc Qc As')), [{ s: 'c', len: 4, top: 12, value: 50 }])
  assert.deepEqual(R.runs(cs('Qd Kd Ad 7d 8d')), [{ s: 'd', len: 3, top: 14, value: 20 }], 'no wrap from A to 7')
  assert.deepEqual(R.runs(cs('7s 8s 10s Js')), [])
  assert.equal(R.runs(cs('7h 8h 9h 10h Jh Qh Kh Ah'))[0].len, 8)
  assert.equal(R.meldName({ s: 'h', len: 3, top: 9 }), 'terz to 9♥')
  assert.equal(R.meldName({ s: 'c', len: 5, top: 13 }), '5 in a row to K♣')
})

test('the best meld: 50 over terz, then longer, higher, trumps, and the first to play', () => {
  const g = { trump: 's', dealer: 3, players: [{}, {}, {}, {}] }
  const m = (p, s, len, top) => ({ p, s, len, top, value: len >= 4 ? 50 : 20 })
  assert.equal(R.bestMeld(g, [m(1, 'h', 3, 14), m(2, 'd', 4, 10)]).p, 2, '50 beats a terz to the ace')
  assert.equal(R.bestMeld(g, [m(1, 'h', 4, 14), m(2, 'd', 5, 11)]).p, 2, 'five beats four')
  assert.equal(R.bestMeld(g, [m(1, 'h', 3, 12), m(2, 'd', 3, 13)]).p, 2, 'the higher top card')
  assert.equal(R.bestMeld(g, [m(1, 'h', 3, 13), m(2, 's', 3, 13)]).p, 2, 'trumps win a tie')
  assert.equal(R.bestMeld(g, [m(3, 'h', 3, 13), m(1, 'd', 3, 13)]).p, 1, 'then the first to play (you, Misha, Lena, Sasha)')
  assert.equal(R.bestMeld({ ...g, dealer: 0 }, [m(3, 'h', 3, 13), m(0, 'd', 3, 13)]).p, 3, 'the dealer plays last')
  assert.equal(R.bestMeld(g, []), null)
})

test('melds score after the first trick, only for the side with the best one, all of that side’s', () => {
  // You: a terz in hearts; Lena: 50 in clubs; Misha: a terz to the ace in diamonds. Us: 20 + 50.
  const { g } = setup({
    trump: 's',
    hands: ['7h 8h 9h 7s', 'Qd Kd Ad 8s', '7c 8c 9c 10c', 'Jd 10s Js 9d'],
    dealer: 3,
  })
  assert.equal(g.melds.length, 3)
  for (const [p, n] of [[0, '7s'], [1, '8s'], [2, '7c'], [3, '10s']]) assert.ok(R.play(g, p, c(n)), n)
  assert.ok(R.collect(g))
  assert.equal(g.meldSide, 0)
  assert.deepEqual(g.meld.slice(0, 2), [70, 0])
  assert.match(g.log, /Melds: Lena has the best, 4 in a row to 10♣: \+70 for Us\.$/)
  assert.ok(g.shownMelds)
})

test('bella: the holder’s king and queen of trumps score 20 when the second goes down', () => {
  const { g } = setup({ trump: 's', hands: ['Ks Qs Ah', '7s 8s', 'Ac 9c', 'Ad 9d'], dealer: 3 })
  assert.equal(g.bellaHolder, 0)
  for (const [p, n] of [[0, 'Ks'], [1, '7s'], [2, '9c'], [3, '9d']]) assert.ok(R.play(g, p, c(n)))
  assert.equal(g.bella[0], 0, 'one of the two')
  R.collect(g)
  assert.ok(R.play(g, 0, c('Qs')))
  assert.equal(g.bella[0], 20)
  assert.equal(g.log, 'You play Q♠. Bella! +20')
  const { g: h } = setup({ trump: 's', hands: ['Ks Ah', 'Qs 8s', '9c', '9d'], dealer: 3 })
  assert.equal(h.bellaHolder, -1, 'split between two players: no bella')
})

test('scoring: the taker’s side makes it with more than the other side and both sides keep their points', () => {
  const { g, m } = setup({ trump: 's', taker: 0, hands: ['As', '7h', 'Kh', '8h'], dealer: 3 })
  Object.assign(g, { phase: 'last', pts: [100, 62, 0], meld: [20, 0, 0], bella: [0, 20, 0], lastSide: 0 })
  assert.ok(R.endDeal(g, m))
  assert.deepEqual(g.result, { made: true, deal: [120, 82], add: [120, 82], ts: 0 })
  assert.deepEqual(m.total, [120, 82])
  assert.deepEqual(m.history, [{ taker: 0, trump: 's', made: true, add: [120, 82], total: [120, 82] }])
})

test('falling with four: a tie or less, and the taker keeps only its bella; the others take everything else', () => {
  const { g, m } = setup({ trump: 's', taker: 1, hands: ['As', '7h', 'Kh', '8h'], dealer: 3 })
  Object.assign(g, { phase: 'last', pts: [81, 81, 0], meld: [0, 20, 0], bella: [20, 20, 0], lastSide: 0 })
  // Them (Misha took): 81 + 20 + 20 = 121 against Us 81 + 20 = 101 would be made; make it a tie instead.
  g.meld = [20, 0, 0]
  assert.ok(R.endDeal(g, m))
  assert.equal(g.result.made, false, 'a tie falls')
  assert.deepEqual(g.result.add, [81 + 81 + 20 + 20, 20], 'Us take the cards and the melds and our bella; Them keep their bella')
  assert.deepEqual(m.history[0].made, false)
})

test('falling with three: the taker keeps its bella and each of the others gets half the pot', () => {
  const { g, m } = setup({ mode: 3, trump: 's', taker: 2, hands: ['As', '7h', 'Kh'], dealer: 0 })
  Object.assign(g, { phase: 'last', pts: [50, 40, 45], meld: [0, 0, 20], bella: [0, 0, 20], lastSide: 0 })
  // Sasha: 45 + 20 + 20 = 85 > 50 and > 40: made.
  assert.ok(R.endDeal(g, m))
  assert.equal(g.result.made, true)
  const f = setup({ mode: 3, trump: 's', taker: 2, hands: ['As', '7h', 'Kh'], dealer: 0 })
  Object.assign(f.g, { phase: 'last', pts: [70, 40, 30], meld: [0, 0, 20], bella: [0, 0, 20], lastSide: 0 })
  // Sasha: 70 < You 70: falls (more than each of the others is needed). Pot 30 + 20 = 50, 25 each.
  assert.ok(R.endDeal(f.g, f.m))
  assert.equal(f.g.result.made, false)
  assert.deepEqual(f.g.result.add, [95, 65, 20])
})

test('the match ends when a side reaches 501; the higher total wins', () => {
  const { g, m } = setup({ trump: 's', taker: 0, hands: ['As', '7h', 'Kh', '8h'], dealer: 3 })
  m.total = [400, 480]
  Object.assign(g, { phase: 'last', pts: [120, 42, 0], meld: [0, 0, 0], bella: [0, 0, 0], lastSide: 0 })
  assert.ok(R.endDeal(g, m))
  assert.equal(g.phase, 'over')
  assert.equal(m.over, true)
  assert.equal(m.winner, 1, 'Them: 522 over Us 520')
  assert.deepEqual(m.total, [520, 522])
})

test('deberc: all eight of a suit in a row wins the match on the spot', () => {
  // Lena is dealt six hearts and draws the other two.
  const order = stack(['As Ad Ac Js 9s 10s', 'Ks Kd Kc Qs Qd Qc', '7h 8h 9h 10h Jh Qh', '8s 8d 8c 7s 7d 7c'], 'Jd', '9d 10d 9c Kh Ah 10c Jc')
  const m = matchOf(4, 3)
  const g = R.newDeal(m, Math.random, order)
  assert.ok(R.bid(g, m, 0, 'd'))
  assert.equal(g.phase, 'over')
  assert.deepEqual(g.deberc, { p: 2, s: 'h' })
  assert.equal(m.over, true)
  assert.equal(m.winner, 0, 'Lena is your partner')
  assert.equal(g.log, 'Deberc! Lena holds all eight ♥ in a row.')
  assert.equal(R.bid(g, m, 0, 'pass'), false)
})

test('your hand: trumps first J 9 A 10 K Q 8 7, then each suit A K Q J 10 9 8 7; before a trump, plain order', () => {
  const cards = cs('7h Ah 9s Js 10h Kd 7s As 8c Qh')
  assert.equal(names(R.sortedHand({ trump: 's' }, cards)), 'J♠ 9♠ A♠ 7♠ A♥ Q♥ 10♥ 7♥ 8♣ K♦')
  assert.equal(names(R.sortedHand({ trump: 'h' }, cards)), 'A♥ 10♥ Q♥ 7♥ A♠ J♠ 9♠ 7♠ 8♣ K♦')
  assert.equal(names(R.sortedHand({ trump: null }, cards)), 'A♠ J♠ 9♠ 7♠ A♥ Q♥ 10♥ 7♥ 8♣ K♦')
})
