'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const V = require('../panels/view.js')

const seats = (n = 4) => ['You', 'Misha', 'Lena', 'Sasha'].slice(0, n).map((name) => ({ name, count: 8, turn: false, tags: [] }))
const base = (extra = {}) => ({
  game: 1,
  seq: 1,
  mode: 4,
  target: 501,
  phase: 'play',
  turn: 0,
  trump: 's',
  taker: 1,
  turned: null,
  seats: seats(),
  trick: [],
  hand: [],
  myTurn: false,
  myMelds: [],
  thinking: null,
  log: '',
  paused: null,
  sheet: false,
  scores: { sides: [{ name: 'Us', total: 120, live: 40, me: true }, { name: 'Them', total: 501, live: null, me: false }], deal: 3 },
  history: [],
  total: [120, 501],
  sideNames: ['Us', 'Them'],
  result: null,
  ...extra,
})

test('a card prints its rank and suit symbol; red, black, the suit class and the trump tab', () => {
  assert.deepEqual(V.face({ s: 'h', r: 14 }), { rank: 'A', symbol: '♥', cls: 'card red s-h', label: 'Ace of hearts' })
  assert.deepEqual(V.face({ s: 'c', r: 10, trump: true }), { rank: '10', symbol: '♣', cls: 'card black s-c trump', label: '10 of clubs (trump)' })
  assert.equal(V.face({ s: 's', r: 11 }).label, 'Jack of spades')
  for (const junk of [null, {}, { s: 'h', r: 6 }, { s: 'h', r: 15 }, { s: 'x', r: 9 }, { s: '__proto__', r: 9 }, { s: 'h', r: '9' }]) {
    assert.equal(V.face(junk), null, JSON.stringify(junk))
  }
  assert.equal(V.short({ s: 'h', r: 10 }), '10♥')
  assert.equal(V.short(null), '')
  assert.equal(V.keyOf({ s: 'd', r: 12 }), 'd12')
})

test('card width: from both the felt’s width and height, within bounds', () => {
  assert.equal(V.cardWidth(330, 900), 45)
  assert.equal(V.cardWidth(5000, 5000), V.MAX_W)
  assert.equal(V.cardWidth(100, 900), V.MIN_W)
  assert.ok(V.cardWidth(1400, 400) < V.cardWidth(1400, 700), 'a short wide zone gets smaller cards')
  assert.ok(V.cardWidth(790, 1100) > 90, 'a big panel gets big cards')
  assert.equal(V.cardWidth(1580, 1990), V.MAX_W)
  for (const [w, h] of [[0, 0], [NaN, undefined], [-5, -5]]) assert.equal(V.cardWidth(w, h), V.MIN_W)
})

test('your hand overlaps to fit in one row; a very narrow panel wraps', () => {
  const cw = 44
  const nine = V.handLayout(9, 330, cw)
  assert.deepEqual(nine.rows, [9])
  assert.ok(8 * nine.step + cw <= 330)
  assert.equal(V.handLayout(3, 600, cw).step, cw + 4, 'a few cards sit a little apart')
  assert.deepEqual(V.handLayout(0, 330, cw), { rows: [], step: 0 })
  assert.ok(V.handLayout(9, 90, cw).rows.length >= 2)
})

test('the trick: bottom, left, top, right with four; bottom and the top two with three', () => {
  assert.deepEqual([0, 1, 2, 3].map((p) => V.trickPos(4, p)), ['b', 'l', 't', 'r'])
  assert.deepEqual([0, 1, 2].map((p) => V.trickPos(3, p)), ['b', 'tl', 'tr'])
})

test('badges: the known kinds only, each its own class', () => {
  const seat = {
    tags: [
      { kind: 'dealer', text: 'D', title: 'Dealer' },
      { kind: 'taker', text: '★ ♠', title: 'Took the trump' },
      { kind: 'pass', text: 'pass' },
      { kind: 'evil', text: 'x' },
      { kind: 'toString', text: 'x' },
      null,
    ],
  }
  assert.deepEqual(V.tagsOf(seat), [
    { cls: 'tag dealer', text: 'D', title: 'Dealer' },
    { cls: 'tag taker', text: '★ ♠', title: 'Took the trump' },
    { cls: 'tag pass', text: 'pass', title: '' },
  ])
  assert.deepEqual(V.tagsOf(null), [])
})

test('the trump box: the offered card, then the suit and who took it; with three the turned card over four face down', () => {
  assert.deepEqual(V.trumpBox(base({ phase: 'bid1', trump: null, turned: { s: 'h', r: 13 } })), { card: { s: 'h', r: 13 }, lines: ['offered'] })
  assert.deepEqual(V.trumpBox(base({ phase: 'bid2', trump: null, turned: { s: 'h', r: 13 } })).lines, ['turned down'])
  assert.deepEqual(V.trumpBox(base()), { suit: 's', red: false, lines: ['trump', 'Misha took it'], extra: '' })
  assert.deepEqual(V.trumpBox(base({ taker: 0, trump: 'd' })).lines, ['trump', 'You took it'])
  assert.equal(V.trumpBox(base({ mode: 3, seats: seats(3), turned: { s: 's', r: 13 } })).extra, 'K♠ + 4 face down')
})

test('the bid and swap buttons on your turn', () => {
  const t = { s: 'h', r: 13 }
  assert.deepEqual(V.actsOf(base({ phase: 'bid1', myTurn: true, trump: null, turned: t })), [
    { label: 'Take ♥', msg: { act: 'bid', choice: 'h' }, primary: true },
    { label: 'Pass', msg: { act: 'bid', choice: 'pass' } },
  ])
  const second = V.actsOf(base({ phase: 'bid2', myTurn: true, trump: null, turned: t }))
  assert.deepEqual(second.map((b) => b.label), ['♠', '♣', '♦', 'Pass'])
  assert.deepEqual(second[2].msg, { act: 'bid', choice: 'd' })
  assert.equal(second[2].red, true)
  assert.equal(second[0].title, 'Name spades as trump')
  assert.deepEqual(V.actsOf(base({ phase: 'swap', myTurn: true, trump: 'h', turned: t })), [
    { label: 'Swap 7♥ for K♥', msg: { act: 'swap', yes: true }, primary: true },
    { label: 'Keep', msg: { act: 'swap', yes: false } },
  ])
  assert.deepEqual(V.actsOf(base({ phase: 'bid1', trump: null, turned: t })), [], 'not your turn')
  assert.deepEqual(V.actsOf(base({ myTurn: true })), [], 'playing: tap a card')
})

test('the status line: what happened, then your move in bold or who is thinking', () => {
  const t = { s: 'h', r: 13 }
  assert.deepEqual(V.statusOf(base({ log: 'Misha passes.', phase: 'bid1', myTurn: true, trump: null, turned: t })), [
    { text: 'Misha passes.' },
    { text: 'Take ♥ as trump, or pass?', strong: true },
  ])
  assert.deepEqual(V.statusOf(base({ phase: 'bid2', myTurn: true, trump: null, turned: t }))[0], { text: 'Name a trump suit, or pass.', strong: true })
  assert.deepEqual(V.statusOf(base({ phase: 'swap', myTurn: true, trump: 'h', turned: t }))[0], { text: 'You hold the 7♥: swap it for K♥?', strong: true })
  assert.deepEqual(V.statusOf(base({ myTurn: true, myMelds: ['terz to J♥'] })), [
    { text: 'Your move.', strong: true },
    { text: 'You hold terz to J♥.', muted: true },
  ])
  assert.deepEqual(V.statusOf(base({ log: 'Lena plays 7♠.', thinking: 'Sasha' })), [{ text: 'Lena plays 7♠.' }, { text: 'Sasha is thinking…', muted: true }])
  assert.deepEqual(V.statusOf(base({ thinking: 'Sasha', paused: { name: 'x' } })), [], 'nobody thinks while paused')
  assert.deepEqual(V.statusOf(null), [])
})

test('the trick’s hint: your lead, or the bidding', () => {
  assert.equal(V.trickHint(base({ myTurn: true })), 'Your lead: tap a card')
  assert.equal(V.trickHint(base({ phase: 'bid2' })), 'Bidding')
  assert.equal(V.trickHint(base()), '')
  assert.equal(V.trickHint(base({ myTurn: true, trick: [{ p: 3, card: { s: 'h', r: 7 } }] })), '')
})

test('the scoreboard: totals, a bar toward 501 capped at full, this deal’s points, the line under it', () => {
  assert.deepEqual(V.scoreRows(base()), {
    rows: [
      { name: 'Us', total: 120, pct: (120 / 501) * 100, live: 'this deal 40', me: true },
      { name: 'Them', total: 501, pct: 100, live: '', me: false },
    ],
    foot: 'to 501 · deal 3 · tap for the score sheet',
  })
})

test('covers: the pause wins, then the score sheet, then a result', () => {
  const result = { kind: 'deal', title: 'You made it with ♠.', text: '', table: { head: ['Us ★', 'Them'], rows: [] }, next: 'next' }
  const paused = V.coverFor(base({ paused: { name: 'Fix the scroll test' }, sheet: true, phase: 'done', result }))
  assert.equal(paused.kind, 'paused')
  assert.equal(paused.title, 'Claude is ready')
  assert.equal(paused.text, '“Fix the scroll test” is waiting for you.')
  assert.deepEqual(paused.buttons.map((b) => [b.msg.act, b.label, b.primary]), [['resume', 'Resume game', true], ['goto', 'Go to the tab', false]])

  const sheet = V.coverFor(base({ sheet: true }))
  assert.equal(sheet.title, 'Score sheet')
  assert.equal(sheet.text, 'First to 501 wins.')
  assert.deepEqual(sheet.table.rows, [
    { label: 'No deals finished yet.', cells: [], cls: 'none' },
    { label: 'Total', cells: ['120', '501'], cls: 'sum' },
  ])
  assert.deepEqual(sheet.buttons, [{ label: 'Back to the game', msg: { act: 'sheet', open: false }, primary: true }])
  const withRows = V.sheetTable(base({ history: [{ label: '1. Misha ♠ (fell)', made: false, add: [162, 20], total: [162, 20] }] }))
  assert.deepEqual(withRows.head, ['Deal', 'Us', 'Them'])
  assert.deepEqual(withRows.rows[0], { label: '1. Misha ♠ (fell)', cells: [{ main: '+162', sub: '162' }, { main: '+20', sub: '20' }], cls: 'fell' })

  const deal = V.coverFor(base({ phase: 'done', result }))
  assert.equal(deal.title, 'You made it with ♠.')
  assert.deepEqual(deal.table.head, ['', 'Us ★', 'Them'])
  assert.deepEqual(deal.buttons, [{ label: 'Next deal', msg: { act: 'next' }, primary: true }])
  const over = V.coverFor(base({ phase: 'over', result: { kind: 'won', title: 'Deberc!', text: 'x', table: null, next: 'new' } }))
  assert.equal(over.table, null)
  assert.deepEqual(over.buttons, [{ label: 'New game', msg: { act: 'new' }, primary: true }])
  assert.equal(V.coverFor(base()), null)
  assert.equal(V.coverFor(null), null)
})

test('keys: N new game; nothing else', () => {
  assert.equal(V.actOfKey('n'), 'new')
  assert.equal(V.actOfKey('N'), 'new')
  for (const k of [' ', 'Enter', 't', 'constructor', undefined]) assert.equal(V.actOfKey(k), null, String(k))
})

test('a new deal, a change, or a resend', () => {
  assert.equal(V.changeOf(null, { game: 1, seq: 1 }), 'reset')
  assert.equal(V.changeOf({ game: 1, seq: 4 }, { game: 2, seq: 5 }), 'reset')
  assert.equal(V.changeOf({ game: 1, seq: 4 }, { game: 1, seq: 5 }), 'change')
  assert.equal(V.changeOf({ game: 1, seq: 4 }, { game: 1, seq: 4 }), 'same')
})
