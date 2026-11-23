'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fakeCtx } = require('./fake-ctx.js')
const rules = require('../lib/rules.js')
const { stack } = require('./helpers.js')

const root = path.join(__dirname, '..')
const host = require('../dist/host.js')

const tab = (tabId, status, extra = {}) => ({ tabId, status, cwd: '/proj', notes: [], files: [], ...extra })
const settle = async () => {
  for (let k = 0; k < 5; k++) await new Promise((resolve) => setImmediate(resolve))
}

const realNewDeal = rules.newDeal
const realNewMatch = rules.newMatch
test.afterEach(() => {
  host.deactivate()
  rules.newDeal = realNewDeal
  rules.newMatch = realNewMatch
})

/** Kh turned; nobody but you would take it. */
const ORDER = stack(['As Ad Ac Jh 9h 10s', 'Ks Kd Kc Qs Qd Qc', 'Js Jd Jc 9s 9d 9c', '8s 8d 8c 8h 7s 7d'], 'Kh', '10h 10d 7h 7c Ah 10c Qh')
/** You take diamonds and Lena holds all eight hearts: a deberc, won on the spot. */
const DEBERC = stack(['As Ad Ac Js 9s 10s', 'Ks Kd Kc Qs Qd Qc', '7h 8h 9h 10h Jh Qh', '8s 8d 8c 7s 7d 7c'], 'Jd', '9d 10d 9c Kh Ah 10c Jc')

/** Every deal from `order`, the first dealt by `dealer` (3: you bid first; 0: Misha does). */
function rig(order, dealer) {
  rules.newDeal = (m, rng) => realNewDeal(m, rng, m.mode === 4 ? order : undefined)
  rules.newMatch = (mode, rng) => {
    const m = realNewMatch(mode, rng)
    m.dealer = dealer % mode
    return m
  }
}

async function started(opts, order, dealer = 3) {
  if (order) rig(order, dealer)
  const f = fakeCtx(opts)
  host.activate(f.ctx)
  await settle()
  return f
}
async function tick(t, ms) {
  t.mock.timers.tick(ms)
  await settle()
}

test('hello is answered with the state; the deal and the cards live in the host', async () => {
  const f = await started()
  await f.send({ hello: 1, visible: true }, 'web:3')
  const s = f.lastState()
  assert.equal(s.seats.length, 4, 'four in pairs by default')
  assert.equal(s.hand.length, 6)
  assert.equal(f.posts.at(-1).options, undefined, 'state changes go to every view')
  assert.equal(JSON.stringify(s).includes('"deck":['), false)
})

test('header: New game, Players and Level; the match score as its text', async () => {
  const f = await started({}, ORDER)
  const h = f.headers.at(-1)
  assert.equal(h.meta, 'Us 0 : 0 Them · to 501')
  assert.deepEqual(h.actions.map((a) => a.id), ['new', 'players', 'level'])
  assert.equal(h.actions[0].icon, 'refresh')
  for (const a of h.actions.slice(1)) assert.ok(fs.existsSync(path.join(root, a.icon)), `${a.id}: the icon is a file of the plugin`)
  assert.match(h.actions[1].title, /Players: 4 in pairs\. Switch to 3 each for themselves/)
  assert.match(h.actions[2].title, /Normal\. Switch to Easy/)
  const n = f.headers.length
  await f.send({ hello: 1 })
  assert.equal(f.headers.length, n, 'an unchanged header is not set again')
})

test('Players switches 4 and 3 and starts a new game; Level switches and plays on; both remembered app-wide', async () => {
  const f = await started()
  await f.send({ hello: 1, visible: true })
  const game = f.lastState().game
  await f.click('players')
  assert.equal(f.lastState().mode, 3)
  assert.equal(f.lastState().seats.length, 3)
  assert.equal(f.lastState().game, game + 1)
  assert.equal(await f.ctx.appStorage.get('players'), 3)
  assert.equal(f.headers.at(-1).meta, '0 : 0 : 0 · to 501')
  await f.click('players')
  assert.equal(f.lastState().mode, 4)
  await f.click('players')
  const g2 = f.lastState().game
  await f.click('level')
  assert.equal(f.lastState().level, 'easy')
  assert.equal(f.lastState().game, g2, 'the same game')
  assert.equal(await f.ctx.appStorage.get('level'), 'easy')
  assert.match(f.headers.at(-1).actions[2].title, /Easy\. Switch to Normal/)
  host.deactivate()

  const g = fakeCtx()
  await g.ctx.appStorage.set('players', 3)
  await g.ctx.appStorage.set('level', 'easy')
  host.activate(g.ctx)
  await g.send({ hello: 1 })
  assert.equal(g.lastState().mode, 3, 'the players picked last come back')
  assert.equal(g.lastState().level, 'easy')
})

test('the computer players move on a timer, about 650 ms each, only while a view shows the panel', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, ORDER, 0)
  await tick(t, 2000)
  assert.equal(f.lastState(), undefined, 'no page, no moves')
  await f.send({ hello: 1, visible: true })
  assert.equal(f.lastState().thinking, 'Misha')
  await tick(t, 600)
  assert.equal(f.lastState().log, 'You deal. ♥ is offered as trump.', 'not yet')
  await tick(t, 60)
  assert.equal(f.lastState().log, 'Misha passes.')
  await tick(t, 650)
  assert.equal(f.lastState().log, 'Lena passes.')
  await tick(t, 650)
  assert.equal(f.lastState().log, 'Sasha passes.')
  assert.equal(f.lastState().myTurn, true)
  const n = f.posts.length
  await tick(t, 5000)
  assert.equal(f.posts.length, n, 'your turn: nothing runs')
  await f.send({ act: 'bid', choice: 'h' })
  assert.equal(f.lastState().phase, 'play')
  assert.equal(f.lastState().thinking, 'Misha', 'Misha leads (your left)')
  await tick(t, 700)
  assert.equal(f.lastState().trick.length, 1)
})

test('a hidden panel stops them; showing it again goes on', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, ORDER, 0)
  await f.send({ hello: 1, visible: true })
  await f.send({ hello: 1, visible: true }, 'web:1')
  await tick(t, 300)
  f.viewGone('desktop')
  await tick(t, 400)
  assert.equal(f.lastState().log, 'Misha passes.', 'the browser still shows it')
  await f.click('new')
  f.viewGone('web:1')
  await tick(t, 2000)
  assert.match(f.lastState().log, /deal\. ♥ is offered/, 'hidden everywhere: nobody moves')
  await f.send({ hello: 1, visible: true })
  await tick(t, 700)
  assert.equal(f.lastState().log, 'Misha passes.')
  await f.click('new')
  await f.send({ act: 'seen', visible: false })
  await tick(t, 2000)
  assert.match(f.lastState().log, /offered/, 'the page out of sight (a minimized window)')
  await f.send({ act: 'seen', visible: true })
  await tick(t, 700)
  assert.equal(f.lastState().log, 'Misha passes.')
})

test('the score sheet holds the game while it is open', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, ORDER, 0)
  await f.send({ hello: 1, visible: true })
  await f.send({ act: 'sheet', open: true })
  assert.equal(f.lastState().sheet, true)
  await tick(t, 3000)
  assert.match(f.lastState().log, /offered/, 'nobody moved')
  await f.send({ act: 'sheet', open: false })
  await tick(t, 700)
  assert.equal(f.lastState().log, 'Misha passes.')
})

test('pause: a working tab turning waiting after your move pauses everything; Go to the tab focuses it; Resume goes on', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({ sessions: [tab('t1', 'working', { title: 'Fix the scroll test' })] }, ORDER)
  await f.send({ hello: 1, visible: true })
  f.setSessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })])
  assert.equal(f.lastState().paused, null, 'no move of yours yet')
  await f.send({ act: 'bid', choice: 'h' })
  await f.send({ act: 'play', card: { s: 's', r: 14 } })
  f.setSessions([tab('t1', 'working', { title: 'Fix the scroll test' })])
  f.setSessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })])
  assert.deepEqual(f.lastState().paused, { name: 'Fix the scroll test' })
  const n = f.posts.length
  await tick(t, 5000)
  assert.equal(f.posts.length, n, 'nothing moves while paused')
  await f.send({ act: 'sheet', open: true })
  assert.equal(f.posts.length, n)

  await f.send({ act: 'goto' }, 'web:1')
  assert.deepEqual(f.focused, ['t1'])
  assert.equal(f.posts.length, n, 'a focus that worked posts nothing')
  assert.ok(f.lastState().paused, 'Go to the tab does not resume')

  await f.send({ act: 'resume' })
  assert.equal(f.lastState().paused, null)
  await tick(t, 700)
  assert.equal(f.lastState().trick.length, 2, 'Misha played once resumed')
})

test('Go to the tab on a closed tab tells only that view', async () => {
  const f = await started({ sessions: [tab('t1', 'working')] }, ORDER)
  await f.send({ hello: 1, visible: true })
  await f.send({ act: 'bid', choice: 'h' })
  f.setSessions([tab('t1', 'waiting')])
  f.setSessions([])
  await f.send({ act: 'goto' }, 'web:2')
  assert.deepEqual(f.posts.at(-1), { panelId: 'deberc', message: { notice: 'That Claude tab is closed.' }, options: { view: 'web:2' } })
})

test('a result is stored app-wide per players, on top of other windows, and counted once', async () => {
  rig(DEBERC, 3)
  const f = fakeCtx()
  await f.ctx.appStorage.set('won:4', 10)
  host.activate(f.ctx)
  await f.send({ hello: 1, visible: true })
  assert.deepEqual(f.lastState().stats, { won: 10, lost: 0 })
  await f.ctx.appStorage.set('won:4', 12) // another window won twice meanwhile
  await f.send({ act: 'bid', choice: 'd' })
  await settle()
  const s = f.lastState()
  assert.equal(s.phase, 'over')
  assert.equal(s.result.title, 'Deberc! Lena holds all eight ♥ in a row.')
  assert.equal(await f.ctx.appStorage.get('won:4'), 13)
  assert.deepEqual(s.stats, { won: 13, lost: 0 })
  assert.equal(await f.ctx.appStorage.get('won:3'), undefined, 'per players')
  await f.send({ act: 'bid', choice: 'd' })
  await settle()
  assert.equal(await f.ctx.appStorage.get('won:4'), 13, 'counted once')
  assert.equal(await f.ctx.appStorage.get('lost:4'), undefined)
})

test('without ctx.appStorage the records and choices go to ctx.storage', async () => {
  const f = await started({ appStorage: false }, DEBERC)
  await f.click('players')
  await f.click('players') // back to four: a new match from the stacked deck
  await f.send({ hello: 1, visible: true })
  await f.send({ act: 'bid', choice: 'd' })
  await settle()
  assert.equal(f.lastState().phase, 'over')
  assert.equal(await f.ctx.storage.get('won:4'), 1)
  assert.equal(await f.ctx.storage.get('players'), 4)
})

test('the four-colour deck follows the app setting', async () => {
  const f = await started({ settings: { fourColour: true } })
  await f.send({ hello: 1 })
  assert.equal(f.lastState().four, true)
  f.setSettings({ fourColour: false })
  assert.equal(f.lastState().four, false)
  const n = f.posts.length
  f.setSettings({ fourColour: false })
  assert.equal(f.posts.length, n, 'no change, no post')
})

test('New game from the title bar or the page (N) starts a match and drops the pending computer move', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, ORDER, 0)
  await f.send({ hello: 1, visible: true })
  await tick(t, 600)
  await f.click('new')
  await tick(t, 100)
  assert.match(f.lastState().log, /offered/, 'the old timer did not fire on the new deal')
  await tick(t, 600)
  assert.equal(f.lastState().log, 'Misha passes.', 'the new deal has its own')
  const game = f.lastState().game
  await f.send({ act: 'new' })
  assert.equal(f.lastState().game, game + 1)
})

test('junk from the page is ignored', async () => {
  const f = await started({}, ORDER)
  await f.send({ hello: 1, visible: false })
  const n = f.posts.length
  for (const m of [
    null,
    'x',
    5,
    {},
    { act: 'play' },
    { act: 'play', card: { s: 'zz', r: 1 } },
    { act: 'bid', choice: 'd' },
    { act: 'bid', choice: '__proto__' },
    { act: 'swap', yes: true },
    { act: 'next' },
    { act: 'goto' },
    { act: 'resume' },
    { act: 'seen' },
    { act: 'sheet', open: false },
    { act: 'toString' },
    { act: 'step' },
  ]) {
    await f.send(m)
  }
  assert.equal(f.posts.length, n)
  await f.click('nope')
  assert.equal(f.posts.length, n)
})

test('the plugin is harmless: no exec, network, secrets, overlays or session writes in its code', () => {
  const files = ['dist/host.js', 'lib/rules.js', 'lib/bots.js', 'lib/pause.js', 'lib/controller.js', 'panels/deberc.js', 'panels/view.js']
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    for (const bad of [
      'ctx.exec',
      'ctx.processes',
      'ctx.secrets',
      'ctx.oauth',
      'ctx.overlay',
      'ctx.openExternal',
      'sessions.send',
      'sessions.open',
      'sessions.close',
      'sessions.rename',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      "require('node:child_process')",
      "require('child_process')",
      'localStorage',
      'alert(',
      'innerHTML',
      'insertAdjacentHTML',
    ]) {
      assert.equal(text.includes(bad), false, `${file} uses ${bad}`)
    }
  }
})

test('English only: no Cyrillic anywhere in the plugin', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.git') return []
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : [p]
    })
  for (const file of walk(root)) {
    if (!/\.(js|json|html|css|svg|md)$/.test(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    assert.equal([...text].some((ch) => ch.codePointAt(0) >= 0x400 && ch.codePointAt(0) <= 0x4ff), false, path.relative(root, file))
  }
})

test('the manifest: id, one right-zone panel with an svg icon, one app setting, files present, no cli, skills or access', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  assert.equal(m.id, 'bronos.deberc')
  assert.equal(m.name, 'Deberc')
  assert.equal(m.api, 1)
  assert.match(m.version, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(Object.keys(m.contributes), ['panels', 'settings'])
  assert.deepEqual(Object.keys(m.contributes.settings), ['app'], 'no project settings')
  assert.deepEqual(m.contributes.settings.app.properties.fourColour, {
    type: 'boolean',
    title: 'Four-colour deck',
    description: m.contributes.settings.app.properties.fourColour.description,
    default: false,
  })
  assert.equal(m.access, undefined)
  assert.equal(m.services, undefined)
  const [p] = m.contributes.panels
  assert.equal(p.id, 'deberc')
  assert.equal(p.title, 'Deberc')
  assert.equal(p.defaultZone, 'right')
  assert.match(p.icon, /\.svg$/)
  for (const file of [m.main, p.entry, p.icon]) assert.ok(fs.existsSync(path.join(root, file)), file)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, m.version)
})

test('the page: no inline script or handlers, relative URLs only, the SDK first, the helpers before the page', () => {
  const html = fs.readFileSync(path.join(root, 'panels/deberc.html'), 'utf8')
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /src="/, 'every script has a src')
    assert.equal(m[2].trim(), '', 'no inline script')
  }
  assert.equal(/\son[a-z]+=/i.test(html), false, 'no inline event handlers')
  assert.equal(/(src|href)="\//.test(html), false, 'no root-absolute URL')
  assert.ok(html.indexOf('src="../__sdk/panel.js"') < html.indexOf('src="view.js"'))
  assert.ok(html.indexOf('src="view.js"') < html.indexOf('src="deberc.js"'))
  assert.equal(html.includes('lib/'), false, 'the rules stay in the host')
  assert.equal(/<form\b/i.test(html), false)
  // Plugin pages have no reset: without this a class with a display shows a hidden element.
  const css = fs.readFileSync(path.join(root, 'panels/deberc.css'), 'utf8')
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  // Each page script is one IIFE: a top-level const that clashes with a window property (top, name, open, history)
  // kills a classic script.
  for (const file of ['panels/deberc.js', 'panels/view.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.equal(/^(const|let|var|function|class)\s/m.test(text), false, `${file} declares nothing at its top level`)
  }
})
