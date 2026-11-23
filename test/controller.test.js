'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const { createController, headerMeta, STEP_MS, TRICK_MS, LAST_MS, REDEAL_MS } = require('../lib/controller.js')
const { c, seeded, stack } = require('./helpers.js')

const tab = (tabId, status, extra = {}) => ({ tabId, status, ...extra })
const names = (cards) => cards.map((x) => R.cardName(x)).join(' ')

/** Four players, Sasha deals, Kh is turned: you bid first. Taking hearts gives you a terz to the jack. */
const ORDER = stack(['As Ad Ac Jh 9h 10s', 'Ks Kd Kc Qs Qd Qc', 'Js Jd Jc 9s 9d 9c', '8s 8d 8c 8h 7s 7d'], 'Kh', '10h 10d 7h 7c Ah 10c Qh')
/** Lena is dealt six hearts and draws the other two once you take diamonds: a deberc. */
const DEBERC = stack(['As Ad Ac Js 9s 10s', 'Ks Kd Kc Qs Qd Qc', '7h 8h 9h 10h Jh Qh', '8s 8d 8c 7s 7d 7c'], 'Jd', '9d 10d 9c Kh Ah 10c Jc')

const fixedMatch = (dealer) => (mode, rng) => {
  const m = R.newMatch(mode, rng)
  m.dealer = dealer === undefined ? mode - 1 : dealer
  return m
}
/** A controller dealing `order` every time (the dealer moving on), with the desktop page shown. */
function make(order = ORDER, opts = {}) {
  const ctl = createController({ deal: (m, rng) => R.newDeal(m, rng, order), match: fixedMatch(opts.dealer), ...opts })
  ctl.setShown('desktop', true)
  return ctl
}
/** Runs computer steps until it is your turn, the deal is scored, or nothing is due. */
function runBots(ctl, max = 100) {
  for (let k = 0; k < max && ctl.nextStep(); k++) ctl.step()
}

test('the snapshot: your cards, the turned card, the others only as counts, never the deck', () => {
  const ctl = make()
  const s = ctl.snapshot()
  assert.equal(s.mode, 4)
  assert.equal(s.modeText, '4 in pairs')
  assert.equal(s.level, 'normal')
  assert.equal(s.phase, 'bid1')
  assert.equal(s.myTurn, true)
  assert.deepEqual(s.turned, { s: 'h', r: 13, trump: false })
  assert.deepEqual(s.seats.map((x) => [x.name, x.count]), [['You', 6], ['Misha', 6], ['Lena', 6], ['Sasha', 6]])
  for (const seat of s.seats) assert.deepEqual(Object.keys(seat).sort(), ['count', 'name', 'tags', 'turn'])
  assert.deepEqual(s.seats[3].tags, [{ kind: 'dealer', text: 'D', title: 'Dealer' }])
  assert.deepEqual(s.seats[2].tags, [{ kind: 'team', text: 'partner', title: 'Your partner' }])
  assert.equal(names(s.hand), 'A♠ 10♠ J♥ 9♥ A♣ A♦', 'before a trump: each suit high to low')
  assert.ok(s.hand.every((x) => !x.ok && !x.dim), 'bidding: no card to play, none dimmed')
  assert.equal(s.deck, undefined)
  assert.equal(s.players, undefined)
  const text = JSON.stringify(s)
  for (const hidden of ['"s":"s","r":13', '"s":"c","r":12', '"s":"h","r":10']) assert.equal(text.includes(hidden), false, `${hidden} is not sent`)
  assert.deepEqual(s.scores, {
    sides: [
      { name: 'Us', total: 0, live: null, me: true },
      { name: 'Them', total: 0, live: null, me: false },
    ],
    deal: 1,
  })
  assert.equal(s.thinking, null)
  assert.equal(s.result, null)
  assert.equal(s.sheet, false)
  assert.deepEqual(s.stats, { won: 0, lost: 0 })
})

test('your bid and your cards: trumps first in your hand, only legal cards playable, refusals change nothing', () => {
  const ctl = make()
  assert.equal(ctl.act({ act: 'bid', choice: 'd' }).changed, false, 'the first round offers hearts only')
  assert.equal(ctl.act({ act: 'play', card: c('As') }).changed, false, 'bidding, not playing')
  assert.equal(ctl.act({ act: 'swap', yes: true }).changed, false)
  assert.equal(ctl.act({ act: 'next' }).changed, false)
  assert.ok(ctl.act({ act: 'bid', choice: 'h' }).changed)
  let s = ctl.snapshot()
  assert.equal(s.phase, 'play')
  assert.equal(s.trump, 'h')
  assert.equal(s.taker, 0)
  assert.equal(names(s.hand), 'J♥ 9♥ 10♥ K♥ A♠ 10♠ A♣ A♦')
  assert.ok(s.hand[0].trump)
  assert.ok(s.hand.every((x) => x.ok), 'your lead: anything')
  assert.deepEqual(s.myMelds, ['terz to J♥'])
  assert.deepEqual(s.seats[0].tags, [{ kind: 'taker', text: '★ ♥', title: 'Took the trump' }])
  assert.deepEqual(s.scores.sides.map((x) => x.live), [0, 0], 'this deal’s points while it is played')
  assert.equal(s.log, 'You take ♥.')
  assert.ok(ctl.act({ act: 'play', card: c('As') }).changed)
  assert.equal(ctl.act({ act: 'play', card: c('Ad') }).changed, false, 'Misha’s turn now')
  s = ctl.snapshot()
  assert.equal(s.myTurn, false)
  assert.equal(s.thinking, 'Misha')
  assert.equal(s.trick.length, 1)
  assert.deepEqual(s.trick[0], { p: 0, card: { s: 's', r: 14, trump: false }, win: false })
  assert.equal(s.seats[1].turn, true)
})

test('the steps: a computer move about 650 ms, a full trick 900, the last trick 700, a redeal 1400', () => {
  const ctl = make()
  ctl.act({ act: 'bid', choice: 'h' })
  ctl.act({ act: 'play', card: c('As') })
  assert.equal(ctl.nextStep().ms, STEP_MS)
  ctl.step()
  ctl.step()
  ctl.step()
  let s = ctl.snapshot()
  assert.equal(s.phase, 'trick')
  assert.equal(s.trick.filter((t) => t.win).length, 1, 'the winning card is marked')
  assert.equal(ctl.nextStep().ms, TRICK_MS)
  assert.ok(ctl.step().changed)
  s = ctl.snapshot()
  assert.equal(s.trick.length, 0)
  assert.match(s.log, /the trick \(\+\d+\)/)
  // The last trick.
  const g = ctl.game()
  g.phase = 'last'
  g.turn = -1
  assert.equal(ctl.nextStep().ms, LAST_MS)
  // Everyone passing twice.
  const r = make()
  r.act({ act: 'bid', choice: 'pass' })
  runBots(r) // the others pass Kh (none of them holds a strong heart hand)
  assert.equal(r.snapshot().phase, 'bid2')
  assert.equal(r.snapshot().myTurn, true)
  r.act({ act: 'bid', choice: 'pass' })
  for (let k = 0; k < 3; k++) r.step()
  assert.equal(r.snapshot().phase, 'redeal', 'nobody holds a hand worth a trump')
  assert.equal(r.nextStep().ms, REDEAL_MS)
  const game = r.snapshot().game
  assert.ok(r.step().changed)
  assert.equal(r.snapshot().game, game + 1)
  assert.equal(r.snapshot().phase, 'bid1')
  assert.equal(r.game().dealer, 0, 'the deal passed to the left')
})

test('the computer players move only while a view shows the panel', () => {
  const ctl = createController({ deal: (m, rng) => R.newDeal(m, rng, ORDER), match: fixedMatch(0) })
  assert.equal(ctl.snapshot().turn, 1, 'Misha bids first')
  assert.equal(ctl.nextStep(), null, 'no page yet')
  assert.equal(ctl.setShown('desktop', true), true)
  const next = ctl.nextStep()
  assert.equal(next.ms, STEP_MS)
  assert.equal(ctl.setShown('web:1', true), false, 'already running')
  assert.equal(ctl.setShown('desktop', undefined), false, 'the browser still shows it')
  assert.equal(ctl.setShown('web:1', false), true, 'out of sight everywhere: they stop')
  assert.equal(ctl.nextStep(), null)
  ctl.setShown('web:1', true)
  assert.ok(ctl.step().changed)
  assert.notEqual(ctl.nextStep().key, next.key, 'a new state, a new key')
  assert.equal(ctl.setShown(5, true), false)
})

test('the score sheet: opens over the game and holds it; closes; not over a scored deal', () => {
  const ctl = make(ORDER, { dealer: 0 })
  assert.ok(ctl.nextStep())
  assert.ok(ctl.act({ act: 'sheet', open: true }).changed)
  assert.equal(ctl.act({ act: 'sheet', open: true }).changed, false, 'already open')
  let s = ctl.snapshot()
  assert.equal(s.sheet, true)
  assert.equal(s.thinking, null)
  assert.equal(ctl.nextStep(), null, 'the computer players wait')
  assert.equal(ctl.step().changed, false)
  assert.ok(ctl.act({ act: 'sheet', open: false }).changed)
  assert.equal(ctl.act({ act: 'sheet', open: false }).changed, false)
  assert.ok(ctl.nextStep())
  // Your moves wait too.
  const mine = make()
  mine.act({ act: 'sheet', open: true })
  assert.equal(mine.snapshot().myTurn, false)
  assert.equal(mine.act({ act: 'bid', choice: 'h' }).changed, false)
  mine.act({ act: 'sheet' })
  assert.ok(mine.act({ act: 'bid', choice: 'h' }).changed)
  // A scored deal has its own cover.
  const g = mine.game()
  g.phase = 'done'
  assert.equal(mine.act({ act: 'sheet', open: true }).changed, false)
  s = mine.snapshot()
  assert.deepEqual(s.history, [])
})

test('a scored deal: the result table, the score sheet’s row, Next deal moves the deal on', () => {
  const ctl = make()
  ctl.act({ act: 'bid', choice: 'h' })
  const g = ctl.game()
  Object.assign(g, { phase: 'last', turn: -1, pts: [100, 62, 0], meld: [20, 0, 0], bella: [20, 0, 0], lastSide: 0 })
  assert.ok(ctl.step().changed)
  const s = ctl.snapshot()
  assert.equal(s.phase, 'done')
  assert.deepEqual(s.result, {
    kind: 'deal',
    title: 'You made it with ♥.',
    text: '',
    next: 'next',
    table: {
      head: ['Us ★', 'Them'],
      rows: [
        { label: 'Cards', cells: [90, 62] },
        { label: 'Last trick', cells: [10, ''] },
        { label: 'Melds', cells: [20, ''] },
        { label: 'Bella', cells: [20, ''] },
        { label: 'This deal', cells: [140, 62], cls: 'sum' },
        { label: 'Scored', cells: ['+140', '+62'], cls: 'add' },
        { label: 'Game', cells: [140, 62], cls: 'sum' },
      ],
    },
  })
  assert.deepEqual(s.history, [{ label: '1. You ♥', made: true, add: [140, 62], total: [140, 62] }])
  assert.deepEqual(s.scores.sides.map((x) => [x.total, x.live]), [[140, 140], [62, 62]])
  assert.equal(s.scores.deal, 1)
  assert.equal(ctl.meta(), 'Us 140 : 62 Them · to 501')
  assert.equal(ctl.nextStep(), null, 'the next deal waits for you')
  const game = s.game
  assert.ok(ctl.act({ act: 'next' }).changed)
  const n = ctl.snapshot()
  assert.equal(n.game, game + 1)
  assert.equal(n.phase, 'bid1')
  assert.equal(n.dealer, 0, 'Sasha dealt; you deal now')
  assert.equal(n.scores.deal, 2)
  assert.deepEqual(n.total, [140, 62], 'the match goes on')
})

test('a fall reads as one', () => {
  const ctl = make()
  ctl.act({ act: 'bid', choice: 'h' })
  Object.assign(ctl.game(), { phase: 'last', turn: -1, pts: [60, 102, 0], meld: [0, 0, 0], bella: [20, 0, 0], lastSide: 1 })
  ctl.step()
  const s = ctl.snapshot()
  assert.equal(s.result.title, 'You fall: the other side takes everything but the bella.')
  assert.deepEqual(s.result.table.rows.find((r) => r.label === 'Scored').cells, ['+20', '+162'])
  assert.equal(s.history[0].label, '1. You ♥ (fell)')
})

test('a deberc on your bid ends the match on the spot and counts once', () => {
  const ctl = make(DEBERC)
  const r = ctl.act({ act: 'bid', choice: 'd' })
  assert.deepEqual(r, { changed: true, outcome: { kind: 'won', mode: 4 } })
  const s = ctl.snapshot()
  assert.equal(s.phase, 'over')
  assert.deepEqual(s.result, {
    kind: 'won',
    title: 'Deberc! Lena holds all eight ♥ in a row.',
    text: 'You and Lena win the game on the spot.',
    table: null,
    next: 'new',
  })
  assert.deepEqual(s.stats, { won: 1, lost: 0 })
  assert.equal(s.myTurn, false)
  assert.equal(ctl.act({ act: 'next' }).changed, false)
  assert.ok(ctl.act({ act: 'new' }).changed)
  assert.equal(ctl.snapshot().phase, 'bid1')
  assert.deepEqual(ctl.snapshot().stats, { won: 1, lost: 0 })
})

test('whole matches through the controller: each ends once, at 501, and counts once', () => {
  for (const mode of [4, 3]) {
    const rng = seeded(mode * 7)
    const ctl = createController({ rng, mode })
    ctl.setShown('desktop', true)
    const outcomes = []
    for (let k = 0; k < 20000 && ctl.snapshot().phase !== 'over'; k++) {
      const s = ctl.snapshot()
      let r
      if (s.myTurn) {
        if (s.phase === 'bid1') r = ctl.act({ act: 'bid', choice: rng() < 0.4 ? s.turned.s : 'pass' })
        else if (s.phase === 'bid2') r = ctl.act({ act: 'bid', choice: 'pass' })
        else if (s.phase === 'swap') r = ctl.act({ act: 'swap', yes: true })
        else r = ctl.act({ act: 'play', card: s.hand.find((x) => x.ok) })
      } else if (s.phase === 'done') r = ctl.act({ act: 'next' })
      else r = ctl.step()
      assert.ok(r.changed, `${mode}: stuck in ${s.phase}`)
      if (r.outcome) outcomes.push(r.outcome)
    }
    const s = ctl.snapshot()
    assert.equal(s.phase, 'over')
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].mode, mode)
    assert.equal(s.result.next, 'new')
    assert.equal(s.stats[outcomes[0].kind], 1)
    if (s.result.table) assert.match(s.result.title, / \d+ : \d+/)
    assert.equal(ctl.step().changed, false, 'nothing runs once it is over')
  }
})

test('pause: a working tab turning waiting after your move pauses everything until Resume', () => {
  const ctl = make(ORDER, { dealer: 0 })
  ctl.sessions([tab('t1', 'working', { name: 'Fix the scroll test' })])
  ctl.sessions([tab('t1', 'waiting', { name: 'Fix the scroll test' })])
  assert.equal(ctl.isPaused(), false, 'no move of yours yet')
  runBots(ctl)
  assert.equal(ctl.snapshot().myTurn, true)
  assert.ok(ctl.act({ act: 'bid', choice: 'pass' }).changed)
  ctl.sessions([tab('t1', 'working', { name: 'Fix the scroll test' })])
  assert.equal(ctl.sessions([tab('t1', 'waiting', { name: 'Fix the scroll test' })]), true)
  const s = ctl.snapshot()
  assert.deepEqual(s.paused, { name: 'Fix the scroll test' })
  assert.equal(s.thinking, null)
  assert.equal(ctl.nextStep(), null)
  assert.equal(ctl.step().changed, false)
  assert.equal(ctl.act({ act: 'sheet', open: true }).changed, false, 'no sheet over the pause')
  assert.equal(ctl.pausedTab(), 't1')
  // A later one renames the cover.
  ctl.sessions([tab('t1', 'waiting'), tab('t2', 'working', { title: 'Docs' })])
  assert.equal(ctl.sessions([tab('t1', 'waiting'), tab('t2', 'waiting', { title: 'Docs' })]), true)
  assert.deepEqual(ctl.snapshot().paused, { name: 'Docs' })
  assert.ok(ctl.act({ act: 'resume' }).changed)
  assert.equal(ctl.act({ act: 'resume' }).changed, false)
  assert.ok(ctl.nextStep())
})

test('never paused while the sheet is open, a scored deal waits, or the match is over', () => {
  const ctl = make()
  ctl.act({ act: 'bid', choice: 'h' })
  ctl.act({ act: 'sheet', open: true })
  ctl.sessions([tab('t1', 'working')])
  assert.equal(ctl.sessions([tab('t1', 'waiting')]), false)
  ctl.act({ act: 'sheet', open: false })
  ctl.game().phase = 'done'
  ctl.sessions([tab('t1', 'working')])
  assert.equal(ctl.sessions([tab('t1', 'waiting')]), false)
  const over = make(DEBERC)
  over.act({ act: 'bid', choice: 'd' })
  over.sessions([tab('t1', 'working')])
  assert.equal(over.sessions([tab('t1', 'waiting')]), false)
})

test('players, level, records and the header text', () => {
  const ctl = make()
  assert.equal(ctl.setMode(4), false)
  assert.ok(ctl.setMode(3))
  const s = ctl.snapshot()
  assert.equal(s.mode, 3)
  assert.equal(s.seats.length, 3)
  assert.deepEqual(s.scores.sides.map((x) => x.name), ['You', 'Misha', 'Sasha'])
  assert.equal(ctl.meta(), '0 : 0 : 0 · to 501')
  assert.equal(ctl.setMode(5), false)
  const game = ctl.snapshot().game
  assert.ok(ctl.setLevel('easy'))
  assert.equal(ctl.snapshot().game, game, 'the level does not deal again')
  assert.equal(ctl.setLevel('hard'), false)
  assert.ok(ctl.setStats(3, { won: 4, lost: 2 }))
  assert.equal(ctl.setStats(3, { won: 3 }), false, 'storage only raises a count')
  assert.equal(ctl.setStats(3, { won: 'x', lost: NaN }), false)
  assert.equal(ctl.setStats(2, { won: 9 }), false)
  assert.deepEqual(ctl.snapshot().stats, { won: 4, lost: 2 })
  assert.equal(ctl.setFour(true), true)
  assert.equal(ctl.setFour(true), false)
  assert.equal(headerMeta(4, [120, 86]), 'Us 120 : 86 Them · to 501')
})

test('junk from the page changes nothing', () => {
  const ctl = make()
  for (const m of [null, 'x', 5, {}, { act: 'bid' }, { act: 'bid', choice: '__proto__' }, { act: 'play', card: 'As' }, { act: 'toString' }, { act: 'step' }]) {
    assert.equal(ctl.act(m).changed, false, JSON.stringify(m))
  }
})
