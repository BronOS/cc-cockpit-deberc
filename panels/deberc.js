'use strict'
// The Deberc panel page. It draws the state the host sends and posts your moves; the match, the computer players, the
// score sheet and the Claude pause live in the host (lib/controller.js), so this page can be closed or hidden at any
// time. The host marks which of your cards may be played now, so the page needs no rules of its own; the host checks
// every move again. Only the shake of a card that may not be played is the page's own.
//
// Everything sits in one IIFE: a top-level `const top` (or any name a window property already holds: `name`, `open`,
// `history`) in a classic script throws and kills the whole page.
;(function () {
  const V = globalThis.DebercView
  const $ = (id) => document.getElementById(id)
  const felt = $('felt')
  const cover = $('cover')

  let state = null
  let shown = null // { game, seq } of the state drawn
  let notice = '' // a refusal for this page (Go to the tab on a closed tab), until the next state
  /** The trick's cards drawn last, by key, so a card new in the trick fades in once. */
  let inTrick = new Set()

  const post = (message) => ccPanel.post(message)

  // ---- drawing ----

  /** A card element: face up with its corner and big symbol (plain text only), or a back for `null`. */
  function cardEl(card, tag = 'div') {
    const el = document.createElement(tag)
    if (tag === 'button') el.type = 'button'
    const f = card ? V.face(card) : null
    if (!f) {
      el.className = 'card back'
      return el
    }
    el.className = f.cls
    const ix = document.createElement('span')
    ix.className = 'ix'
    const rank = document.createElement('b')
    rank.textContent = f.rank
    const sym = document.createElement('i')
    sym.textContent = f.symbol
    ix.append(rank, sym)
    const pip = document.createElement('span')
    pip.className = 'pip'
    pip.textContent = f.symbol
    el.append(ix, pip)
    el.setAttribute('aria-label', f.label)
    el.title = f.label
    return el
  }

  function tagEls(seat) {
    return V.tagsOf(seat).map((t) => {
      const el = document.createElement('span')
      el.className = t.cls
      el.textContent = t.text
      if (t.title) el.title = t.title
      return el
    })
  }

  function drawScore() {
    const box = $('score')
    box.replaceChildren()
    const { rows, foot } = V.scoreRows(state)
    for (const r of rows) {
      const row = document.createElement('div')
      row.className = `row${r.me ? ' me-side' : ''}`
      const nm = document.createElement('span')
      nm.className = 'nm'
      nm.textContent = r.name
      const total = document.createElement('b')
      total.textContent = String(r.total)
      const track = document.createElement('div')
      track.className = 'track'
      const fill = document.createElement('i')
      fill.style.width = `${r.pct}%`
      track.append(fill)
      const live = document.createElement('span')
      live.className = 'live'
      live.textContent = r.live
      row.append(nm, total, track, live)
      box.append(row)
    }
    const f = document.createElement('div')
    f.className = 'sfoot'
    f.textContent = foot
    box.append(f)
  }

  function drawSeats() {
    const seats = $('seats')
    seats.replaceChildren()
    seats.style.gridTemplateColumns = `repeat(${state.seats.length - 1}, minmax(0, 1fr))`
    state.seats.forEach((seat, i) => {
      if (i === 0) return
      const d = document.createElement('div')
      d.className = `seat${seat.turn ? ' turn' : ''}`
      const head = document.createElement('div')
      head.className = 'top'
      const nm = document.createElement('b')
      nm.textContent = seat.name
      const count = document.createElement('span')
      count.className = 'n'
      count.textContent = String(seat.count)
      count.title = `${seat.count} ${seat.count === 1 ? 'card' : 'cards'}`
      head.append(nm, count, ...tagEls(seat))
      const h = document.createElement('div')
      h.className = 'hand'
      for (let k = 0; k < seat.count; k++) h.append(cardEl(null))
      d.append(head, h)
      seats.append(d)
    })
  }

  function drawTrumpBox() {
    const tb = $('trumpbox')
    tb.replaceChildren()
    const box = V.trumpBox(state)
    if (!box) return
    if (box.suit) {
      const s = document.createElement('div')
      s.className = `suit ${box.red ? 'red' : 'black'}`
      s.textContent = V.SYMBOLS[box.suit]
      s.title = 'Trump'
      tb.append(s)
    } else if (box.card) tb.append(cardEl(box.card))
    const lbl = document.createElement('div')
    lbl.className = 'lbl'
    box.lines.forEach((line, k) => {
      if (k > 0) lbl.append(document.createElement('br'))
      lbl.append(line)
    })
    tb.append(lbl)
    if (box.extra) {
      const x = document.createElement('div')
      x.className = 'lbl'
      x.textContent = box.extra
      tb.append(x)
    }
  }

  function drawTrick(kind) {
    const tr = $('trick')
    tr.replaceChildren()
    const now = new Set()
    for (const t of state.trick) {
      const el = cardEl(t.card)
      el.classList.add(`p-${V.trickPos(state.mode, t.p)}`)
      if (t.win) el.classList.add('win')
      const key = V.keyOf(t.card)
      now.add(key)
      if (kind === 'change' && !inTrick.has(key)) el.classList.add('new')
      tr.append(el)
    }
    inTrick = now
    const hint = V.trickHint(state)
    if (hint) {
      const h = document.createElement('div')
      h.className = 'hint'
      h.textContent = hint
      tr.append(h)
    }
  }

  function drawStatus() {
    const st = $('status')
    st.replaceChildren()
    for (const part of V.statusOf(state)) {
      const el = document.createElement(part.strong ? 'b' : part.muted ? 'small' : 'span')
      el.textContent = part.text
      if (st.childNodes.length > 0) st.append(' ')
      st.append(el)
    }
  }

  /** The bid and swap buttons; each posts its own message (the host checks it). */
  let acts = []
  function drawActs() {
    const box = $('acts')
    box.replaceChildren()
    acts = V.actsOf(state)
    acts.forEach((a, k) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = a.label
      b.dataset.k = String(k)
      if (a.title) b.title = a.title
      const cls = []
      if (a.primary) cls.push('cc-primary')
      if (a.suit) cls.push('suitb', a.red ? 'red' : 'black')
      b.className = cls.join(' ')
      box.append(b)
    })
  }

  function drawHand() {
    const me = $('me')
    me.className = `me${state.myTurn && state.phase === 'play' ? ' turn' : ''}`
    const mine = $('mine')
    const you = document.createElement('b')
    you.textContent = 'You'
    mine.replaceChildren(you, ...tagEls(state.seats[0]))

    const box = $('hand')
    // Keyboard focus stays with its card across a redraw (the elements are new each time).
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.key : null
    box.replaceChildren()
    const cw = parseFloat(getComputedStyle(felt).getPropertyValue('--cw')) || 44
    const width = box.clientWidth || felt.clientWidth - 16
    const { rows, step } = V.handLayout(state.hand.length, width, cw)
    let k = 0
    let refocus = null
    for (const count of rows) {
      const row = document.createElement('div')
      // Cards that overlap hide their corner tab: a trump gets a gold top edge too, which the strip still shows.
      row.className = step < cw && count > 1 ? 'row tight' : 'row'
      for (let j = 0; j < count; j++, k++) {
        const card = state.hand[k]
        const el = cardEl(card, 'button')
        const key = V.keyOf(card)
        el.dataset.key = key
        el.classList.add(card.dim ? 'no' : 'ok')
        if (!card.ok) el.setAttribute('aria-disabled', 'true')
        if (j > 0) el.style.marginLeft = `${step - cw}px`
        if (key === focused) refocus = el
        row.append(el)
      }
      box.append(row)
    }
    if (refocus) refocus.focus({ preventScroll: true })
    else if (focused) felt.focus({ preventScroll: true })
  }

  /** A table of plain text cells; a cell `{ main, sub }` puts `sub` small under `main`. */
  function tableEl(spec) {
    const t = document.createElement('table')
    const hr = document.createElement('tr')
    for (const h of spec.head) {
      const th = document.createElement('th')
      th.textContent = h
      hr.append(th)
    }
    t.append(hr)
    for (const r of spec.rows) {
      const tr = document.createElement('tr')
      if (r.cls) tr.className = r.cls
      const label = document.createElement('td')
      label.textContent = r.label
      if (r.cells.length === 0) label.colSpan = spec.head.length
      tr.append(label)
      for (const cell of r.cells) {
        const td = document.createElement('td')
        if (cell && typeof cell === 'object') {
          td.append(String(cell.main), document.createElement('br'))
          const small = document.createElement('small')
          small.textContent = String(cell.sub)
          td.append(small)
        } else td.textContent = String(cell)
        tr.append(td)
      }
      t.append(tr)
    }
    return t
  }

  let coverButtons = []
  function drawCover() {
    const spec = V.coverFor(state)
    if (!spec) {
      if (!cover.hidden && cover.contains(document.activeElement)) felt.focus({ preventScroll: true })
      cover.hidden = true
      cover.textContent = ''
      coverButtons = []
      return
    }
    cover.className = `cover ${spec.kind}`
    cover.textContent = ''
    const big = document.createElement('div')
    big.className = 'big'
    if (spec.dot) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      big.append(dot)
    }
    // Plain text only: a tab's name is never put into HTML.
    big.append(spec.title)
    cover.append(big)
    // A result's line sits above its table; the sheet's under it.
    const what = () => {
      if (!spec.text) return
      const el = document.createElement('div')
      el.className = 'what'
      el.textContent = spec.text
      cover.append(el)
    }
    if (spec.kind !== 'sheet') what()
    if (spec.table) {
      const wrap = document.createElement('div')
      wrap.className = 'sheet'
      wrap.append(tableEl(spec.table))
      cover.append(wrap)
    }
    if (spec.kind === 'sheet') what()
    if (notice) {
      const line = document.createElement('div')
      line.className = 'cc-error-line'
      line.textContent = notice
      cover.append(line)
    }
    const row = document.createElement('div')
    row.className = 'buttons'
    coverButtons = spec.buttons
    spec.buttons.forEach((b, k) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = b.label
      btn.dataset.k = String(k)
      if (b.primary) btn.className = 'cc-primary'
      row.append(btn)
    })
    cover.append(row)
    cover.hidden = false
    // The board keeps the keyboard: a key meant for the table must not press a cover's button the moment it comes up.
    // Enter on the board presses the cover's main button.
  }

  function draw() {
    if (!state) return
    const kind = V.changeOf(shown, state)
    $('loading').hidden = true
    felt.style.setProperty('--cw', `${V.cardWidth(felt.clientWidth - 16, felt.clientHeight)}px`)
    felt.classList.toggle('four', !!state.four)
    drawScore()
    drawSeats()
    drawTrumpBox()
    drawTrick(kind)
    drawStatus()
    drawActs()
    drawHand()
    drawCover()
    const stats = state.stats || {}
    $('won').textContent = String(stats.won || 0)
    $('lost').textContent = String(stats.lost || 0)
    $('modeinfo').textContent = `${state.modeText} · ${state.levelText}`
    const vs = `games to ${state.target} with ${state.modeText}`
    for (const id of ['won', 'lost']) $(id).parentElement.title = vs
    shown = { game: state.game, seq: state.seq }
  }

  // ---- the host ----

  ccPanel.onMessage((message) => {
    if (!message || typeof message !== 'object') return
    if (message.state) {
      state = message.state
      notice = ''
      draw()
    } else if (typeof message.notice === 'string') {
      notice = message.notice
      drawCover()
    }
  })
  // Each new connection (the first one, a host restart) asks for the whole state and says whether the page is on
  // screen (the computer players move only while some view shows the board); an app without onConnect gets one ask.
  const hello = () => post({ hello: 1, visible: !document.hidden })
  if (typeof ccPanel.onConnect === 'function') ccPanel.onConnect(hello)
  else hello()
  document.addEventListener('visibilitychange', () => post({ act: 'seen', visible: !document.hidden }))
  // The panel being hidden or closed unmounts the page; the host also learns it from ctx.views. Best effort.
  window.addEventListener('pagehide', () => post({ act: 'seen', visible: false }))

  let resizeFrame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (!state) return
      shown = { game: state.game, seq: state.seq } // a resize is no move: nothing fades in
      draw()
    })
  }).observe(felt)

  // ---- input ----

  function shake(el) {
    el.classList.remove('shake')
    void el.offsetWidth
    el.classList.add('shake')
  }

  /** A tap on one of your cards: play it when the host marked it playable, shake it when it may not go now. */
  function tapCard(el) {
    if (!state || !state.myTurn || state.phase !== 'play') return
    const card = state.hand.find((c) => V.keyOf(c) === el.dataset.key)
    if (!card) return
    if (!card.ok) return shake(el)
    post({ act: 'play', card: { s: card.s, r: card.r } })
  }

  felt.addEventListener('click', (e) => {
    const handCard = e.target.closest('#hand .card')
    if (handCard) return tapCard(handCard)
    const act = e.target.closest('#acts button[data-k]')
    if (act) {
      const a = acts[Number(act.dataset.k)]
      if (a && state && state.myTurn) post(a.msg)
      felt.focus({ preventScroll: true })
      return
    }
    if (e.target.closest('#score')) {
      if (state && !state.paused && !state.sheet && state.phase !== 'done' && state.phase !== 'over') post({ act: 'sheet', open: true })
    }
  })

  // Keys only while the board (or one of your cards) has focus, and only these; everything else goes on to the app.
  felt.addEventListener('keydown', (e) => {
    if (!state || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter' && e.target === felt && !cover.hidden) {
      const primary = cover.querySelector('button.cc-primary')
      if (primary) {
        e.preventDefault()
        primary.click()
      }
      return
    }
    if (e.key === 'Escape' && state.sheet) {
      e.preventDefault()
      post({ act: 'sheet', open: false })
      return
    }
    const act = V.actOfKey(e.key)
    if (!act) return
    e.preventDefault()
    post({ act })
  })

  cover.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-k]')
    if (!btn) return
    const b = coverButtons[Number(btn.dataset.k)]
    if (!b) return
    post(b.msg)
    // The cover goes; the board takes the keyboard back.
    if (b.msg.act !== 'goto') felt.focus({ preventScroll: true })
  })
})()
