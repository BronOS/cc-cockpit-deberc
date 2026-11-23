# Deberc

A cc-cockpit plugin (`bronos.deberc`): Deberc, a card game of the klaberjass family, against computer players in a
panel, to play while Claude works. Four players in pairs (you and Lena against Misha and Sasha) or three each for
themselves; the first side to 501 wins. When a Claude tab of the window finishes its turn and waits for you, the game
pauses and tells you which tab it is.

It is a harmless game: no commands, no network, no secrets, no overlays, and one setting (the four-colour deck). It
reads the window's Claude tab statuses and names, and its one action on a tab is to show it when you click **Go to the
tab**. It never types into or sends anything to a session.

## Install

From a checkout: `ccc plugin link <path to this repo>`, then Allow it in the app window. The **Deberc** panel opens in
the right zone (move it like any panel).

## How to play

32 cards (7 to ace). Play goes clockwise: you, then the players along the top from left to right. With four, your
partner Lena sits across from you, in the middle of the top row.

### A deal

- Six cards each, and one card turned up: its suit is offered as trump. Each player in turn from the dealer's left
  **takes** it or **passes**.
- Nobody took it: a second round where a player may **name another suit**. Everyone passes again: a new deal.
- Whoever holds the trump 7 may swap it for the turned card (you are asked; a computer player always swaps).
- Then the rest is dealt: with four, two more each (the taker gets the turned card and one more); with three, three
  more each, and the turned card stays face up over the four cards nobody gets.

### Cards and play

- Trumps rank **J** 20, **9** 14, A 11, 10 10, K 4, Q 3, 8, 7. Other suits A 11, 10 10, K 4, Q 3, J 2, 9, 8, 7.
- Follow suit. If you can't, you must trump (unless, with four, your partner is winning the trick), over the trick's
  highest trump if you can. On a trump lead, go higher if you can.
- The last trick is worth 10. A deal of four holds 162 points.

### Melds

- Three in a row in one suit: **terz**, 20. Four or more: **50**. They are shown after the first trick, and only the
  side with the best one scores its melds (50 over terz, then the longer run, the higher top card, trumps, and the
  player who plays first).
- King and queen of trumps in one hand: **bella**, 20, said when the second goes down. It always counts.
- All eight of a suit in a row: **deberc**, the game is won on the spot.

### The taker must win

The taker's side must score more than the other side (with three: more than each of the others). If it does not, it
**falls**: it keeps only its bella, and the opponents take everything else (with three, the other two split the
taker's points and melds).

### Your moves

- Bidding: the buttons under the table: **Take ♠** or **Pass**, in the second round a suit or **Pass**, and **Swap**
  or **Keep** for the trump 7.
- Playing: tap a card. Cards you may not play now sit lower with their ink softened; one tapped anyway shakes. When it
  is your move your hand gets an outline.
- Your hand runs high to low from the left: trumps first (J 9 A 10 K Q 8 7), then each suit A K Q J 10 9 8 7, so runs
  show. Trumps carry a gold corner tab (and a gold top edge when the hand overlaps).
- Badges read by shape and text: the dealer a round **D**, the taker a bold **★** with the trump suit in a thick frame,
  a pass a dashed frame, **terz**, **50** and **bella** in a solid frame. The blue outline shows whose move it is; the
  card winning a full trick gets a thick green outline.
- The scoreboard on top shows each side's total, a bar toward 501 (yours solid with a ▸, the others striped) and this
  deal's points. Tap it for the **score sheet**: every deal so far, who took which trump, who fell, and the totals.
  The game waits while it is open.
- After a deal a table shows its cards, last trick, melds, bella, what each side scored and the match total; **Next
  deal** goes on.
- Keys work only after a click into the board (it has focus): **N** new game, **Enter** presses a cover's main button,
  **Escape** closes the score sheet. Other keys go on to the app.

### The title bar

- **New game** (the circular arrow) starts a new match.
- **Players** (the people) switches between four in pairs and three each for themselves, and starts a new match.
- **Level** (the bars) switches the computer players between **Easy** and **Normal**, from their next move on. Both
  bid the same way. Easy plays a random legal card. Normal draws trumps when its side took them, leads aces and tens
  whose ace is gone, feeds points to a partner who is safely winning, and otherwise wins the trick when it can.
- Its text shows the match score: `Us 120 : 86 Them · to 501`. The players and the level you picked last come back
  next time.

The bar under the board counts your matches **Won** and **Lost**, per number of players, kept for every project
window, across restarts.

The computer players move about every 650 ms (a full trick stays 900 ms), on a timer in the plugin's host, and only
while some view shows the panel and the score sheet is closed: you never come back to moves you did not see.

The cards grow with the panel, sized from both its width and its height (up to a limit). The felt and the card faces
have their own colours for light and dark themes. Settings › Plugins › Deberc has **Four-colour deck**: diamonds turn
blue and clubs green (each suit still prints its own symbol).

## The Claude pause

While a match is in play (you made a move, and it is neither over nor waiting on Next deal), a Claude tab of the same
window that was **working** and becomes **waiting for input** pauses it: the computer players stop, the board takes
no moves, and a cover says **Claude is ready** with the tab's name. **Resume game** goes on; **Go to the tab** shows
that tab and leaves the game paused for when you come back.

- Only a change seen while you play pauses: a tab that was already waiting, or one that finished before your first
  move, does not. An open score sheet already holds the game, so it is not paused over it.
- With several tabs, the cover names the latest one to become ready.
- The match lives in the plugin's host, not in the panel page: it survives the panel being hidden or closed, and every
  view of the window shows the same match. A restart of the plugin host ends the match in progress; records are kept.

How it knows: `ctx.sessions.onChange` and one `ctx.sessions.list()` at start; **Go to the tab** is
`ctx.sessions.focus`. The computer players learn that the panel is gone from `ctx.views.onChange` and that a page is
out of sight from the page itself.

## Development

Plain JavaScript, no build step: `dist/host.js` wires `lib/controller.js` (the match, the computer players' timer
steps, the score sheet, the pause and the records) to the plugin API and runs the timer; `lib/rules.js` is the game's
rules, `lib/bots.js` the computer players' choices and `lib/pause.js` the working-to-waiting rule, all pure. The page
never sees the deck or the others' cards: the host sends your hand with what each card may do now, so `panels/`
(`view.js` its pure helpers, `deberc.js` the drawing and the input) has no rules of its own, and the host checks every
move again.

`npm test` runs the `node:test` suites: the rules, a seeded fuzz that plays hundreds of whole matches with four and
three players at both levels (32 cards always, every card played legal, a deal of four worth exactly 162, nothing
stuck, every match ending; `FUZZ_MATCHES=n` plays more), the computer players, the controller, the host with a fake
`ctx` and fake timers, and the page's helpers.

## License

MIT
