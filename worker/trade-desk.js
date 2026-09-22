// The trade desk, as a case file (Eric, 2026-09-22): "Make it a case file
// highlighted green. run it automatically at 7am, 10am, noon on trading
// days. Just like with medical cases I can pause it or manually update. I
// can also ask the advisor questions and send him screenshots of my
// positions and portfolio total, which get added the portfolio metrics ...
// There's also a chat where I can essentially track each trade and the
// logic. The advisor scans this and presents any validation and correction
// of my technique in the page where you read shit ... Terms are a thing
// here as well."
//
// This module is the leaf the rest stands on: the desk's constants, his
// instructions word for word, the shape the reading has to come back in,
// the wall clock, the market half (Finnhub), and everything the reading
// files once it lands: the plays, a portfolio total read off a screenshot,
// the push for a strong play, and the standing line the shelf prints. It
// imports nothing from the advisor, so the advisor can import it.
//
// What the desk keeps stays under trade/, which the rules' closing deny
// keeps from every client. The case itself is a case document with
// self: true (every client-facing guard already applies) and trade: true
// (what is its own).

import { patchDoc, listDocs, tryGet, READ_FAILED } from './firestore.js';
import { notifyUser } from './push.js';
// The desk makes a PDF (2026-09-22): the file an answer may carry, written
// by the shared writer and put where the Uploads page already looks.
import { BUCKET, putFile, patchObjectMeta } from './storage.js';
import { textPdf } from '../public/js/textpdf.js';
import {
  tradeMetrics, TARGET_DAILY, PROJECTION_MIN_DAYS, DEFAULT_START_CENTS,
  rulesOf, dayStatus, realizedToday, openRisk, tradeCalc, fmtMoney, fmtPct,
  HORIZONS, HORIZON_WORDS, horizonOf, horizonFor, swingLastDay, isTradingDay,
} from '../public/js/trade-math.js';

// ---- constants ------------------------------------------------------------
// NOTHING RUNS BUT HIS TAP (Eric, 2026-09-22: "I manually update either scan
// individually. No automatic."). The desk used to read itself three times a
// trading day, which is why it ran one step below the top on a smaller
// model: a background turn he did not ask for should not cost the most.
// Nothing is a background turn any more, so both of his buttons buy the
// strongest reading there is, and so does a question. He asked for exactly
// this when the scan was still on a clock.
export const TRADE_MODEL = 'claude-opus-5';
export const TRADE_EFFORT = 'max';
// ONE CARVE-OUT, BY HIS CHOICE (Eric, 2026-09-22, asked "Which strength should
// Scan run at?" and choosing "Scan at high, Update stays max"). Scan's job is
// right now; today's took eight minutes thinking over ten prices and it
// searches as well since 6.10. One step down for that button alone. Update, a
// question, and every other case keep the top setting he asked for on
// 2026-09-09.
export const TRADE_SCAN_EFFORT = 'high';
// THE FAST LOOK (Eric, 2026-09-22: "I'd been scanning for hours. Pretty much
// the whole trading day"). A turn cannot live inside a Worker invocation on
// this plan past about 100 seconds without a stream, or four minutes with
// one, both measured live in 2026-08, which is why a scan rides the Batches
// API and waits in the provider's queue: 5, 8, 13 and 80 minutes on the day
// he said this. So the fast look is built to FIT: low effort, no search, a
// short answer, run on his tap and streamed so bytes flow from the first
// second and nothing between here and the provider can time it out. It sees
// what the desk note carries, which is the quotes, the headlines, the
// earnings, his rules, his positions and where his day stands.
export const TRADE_LOOK_EFFORT = 'low';
export const TRADE_TZ = 'America/Boise';
export const MARKET_OPEN = '07:30';
export const MARKET_CLOSE = '14:00';
// A strong play, the one that reaches his phone: the low end of its chance
// of profit at or above this, with a named catalyst. The Worker decides
// this from the fields, never the prompt's mood.
export const STRONG_PROFIT_LOW = 55;
export const WATCHLIST_MAX = 20;
// THE STARTING LIST, NOT THE UNIVERSE (Eric, 2026-09-22: "it shouldnt just
// look at mega cap companies. Jesus."). Every name on the old list was a mega
// cap, and on his account most of them cannot be taken at all: his own scan
// note said it out loud, "META moved most, but at 741 it will not size inside
// $44.90". A $4,490 account with a 1% rule needs names whose price leaves room
// for a real position. So the two index proxies for the tape, the small cap
// index beside them, and liquid names across sectors that a few hundred
// dollars can actually buy. It is only a default: his own list, whenever he
// sets one in Settings, wins, and the scan is told to look past both.
export const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'SOFI', 'PLTR', 'F', 'INTC', 'BAC'];
export const TRADE_SEARCH_MAX_USES = 8;
export const TRADE_WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: TRADE_SEARCH_MAX_USES };
// The dictionary's trading half (2026-09-22: "Terms are a thing here as
// well"). A desk turn sees only these categories; every other turn sees
// none of them.
export const TRADE_CATEGORIES = ['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'];
export const DESK_NAME = 'Trade desk';
// HIS POSITIONS AND THE QUOTES BEHIND THEM (2026-09-22). Finnhub's free plan
// allows sixty calls a minute and the desk note already spends up to
// twenty-two on a reading, so every quote in this file goes through one
// cache and one rolling-minute budget. Both are isolate-local and best
// effort: a cold isolate simply fetches, and over budget the route says so
// rather than calling out.
export const QUOTE_TTL_MS = 20_000;
export const QUOTE_BUDGET = 50;
export const QUOTE_MAX = 10;
// The News page's two feeds, held per isolate: headlines move by the minute,
// a day's earnings calendar does not move at all.
export const NEWS_TTL_MS = 5 * 60_000;
export const EARNINGS_TTL_MS = 30 * 60_000;
export const NEWS_HOURS = 24;
export const NEWS_MAX = 40;
// The sentences the routes refuse with. Exported so the demo mirrors them
// word for word and a check can hold the two to each other.
export const SAY = {
  notFound: 'Not found',
  deskOpen: 'The trade desk is already open.',
  badDate: 'Pick a date like 2026-09-21, not in the future.',
  badCents: 'Enter the balance in dollars, 0 or more, under ten million.',
  badStart: 'Starting amount: whole dollars, 1 or more, under ten million.',
  noPlay: 'No such play.',
  badStatus: 'Status must be took, skipped, or closed.',
  badOutcome: 'Closed at needs a dollar figure, plus or minus.',
  badKey: 'That key does not look like a Finnhub key.',
  badAccount: 'Account type is cash or margin.',
  badWatchlist: 'Watchlist: up to 20 tickers, letters and dots only.',
  badTicker: 'Ticker: letters and dots only, up to six.',
  badSide: 'Side is long or short.',
  badInstrument: 'Instrument is stock, call, put or spread.',
  badHorizon: 'Horizon is scalp, intraday or swing.',
  // FRACTIONAL SHARES (Eric, 2026-09-22): a contract is whole or it is not a
  // contract, but a share can be bought in pieces, so the two are refused in
  // two different sentences rather than one that is wrong half the time.
  badQty: 'Contracts: a whole number, 1 or more.',
  badShares: 'Shares: any amount above zero, fractions welcome, to four places.',
  badPrice: 'Entry, stop and target are prices above zero, four decimals at most.',
  badWidth: 'Spread width: the distance between the strikes, above zero.',
  noPosition: 'No such position.',
  closedAlready: 'That position is already closed.',
  badExit: 'Sold at needs the exit price, or the profit or loss in dollars.',
  badRules: 'Rules: risk 0.1 to 5% a trade, day loss 0.5 to 20%, floor under aim under cap, cap up to 50%, target 0.5R to 5R.',
  noQuoteKey: 'No market data key on file. Add it on Desk.',
  quoteMany: 'Quotes: up to 10 tickers at a time.',
  quoteBudget: 'Quotes are rate limited; try again in a minute.',
  scanRunning: 'A scan is already running. It lands on its own.',
  // The fast look (2026-09-22): it runs on his tap and fits inside a minute or
  // two, so a second tap while one is up is refused the same way.
  lookRunning: 'A look is already running. Give it a few seconds.',
  lookLong: 'The quick look ran past its time and was stopped. Tap Scan for the deep one.',
  // A look has to run inside the invocation that starts it. No ctx to keep
  // that invocation alive means no way to run it without holding his tap for
  // the whole turn, so it is refused honestly instead.
  lookNoCtx: 'A quick look cannot run from here. Tap Scan.',
  noDesk: 'The trade desk is not open.',
  noNext: 'The trade desk does not continue into a next case. Close it or delete it.',
  noPull: 'The trade desk cannot be pulled from.',
};
// ---- end constants --------------------------------------------------------

export const SETTINGS_PATH = 'trade/settings';
export const STATE_PATH = 'trade/state';
// The same path, under the name the advisor imports it by: the desk's state
// is where a scan he started parks its flight (2026-09-22).
export const TRADE_STATE_PATH = STATE_PATH;
export const PLAYS = 'trade/plays/items';
export const BALANCES = 'trade/balances/items';
export const POSITIONS = 'trade/positions/items';

// ---- his instructions, word for word --------------------------------------
// The first system block of every desk turn (Eric, 2026-09-22: "Instructions
// for the advisor:"). Unchanged from what he sent; the app's own contract
// for the shape of the reading is the second block, below.
export const TRADE_INSTRUCTIONS = `You are a friendly stock day-trading advisor and teacher built into a trading app.

Your job is to help the user understand what is happening in the market, evaluate possible trades, and gradually become a more competent and independent trader.

PERSONALITY AND COMMUNICATION

Speak in common, natural English.

Be pleasant, patient, calm, and approachable.

Do not try to sound clever, witty, dramatic, poetic, or sophisticated.

Do not use unnecessary metaphors or catchy phrases.

Do not talk down to the user.

Assume the user is a late beginner to early intermediate trader. They already understand basic ideas such as buying and selling stocks, calls and puts, percentages, gains and losses, and basic chart reading, but they are still learning how traders combine information into an actual trading decision.

Explain unfamiliar concepts clearly when they come up.

Use trading terminology when it is useful, but immediately explain less familiar terms in plain English.

Be concise when the question is simple. Go deeper when the user is trying to understand a setup or make a decision.

TRADING APPROACH

Help the user think in terms of:

• Price action
• Volume
• Relative volume
• VWAP
• Support and resistance
• Premarket highs and lows
• Previous-day highs and lows
• Moving averages
• MACD
• RSI when relevant
• Trend direction
• Momentum
• Breakouts and failed breakouts
• VWAP reclaim and VWAP rejection
• Consolidation
• Liquidity
• Bid/ask spread
• Volatility
• News and catalysts
• Market and sector strength
• Risk/reward
• Position sizing
• Stop placement
• Trade invalidation

Do not treat any single indicator as a buy or sell signal.

Instead, explain how several pieces of evidence fit together.

For example:

"AMD is above VWAP, volume is increasing, and it just broke the morning high. Those three things support the bullish setup. The weak point is that the breakout is happening directly under resistance at $___."

When looking at a chart, separate what is actually happening from what might happen next.

Use language such as:

"The stock is currently..."
"This suggests..."
"The next level I would watch is..."
"The bullish setup would weaken if..."
"The trade would be invalidated if..."

Do not present uncertain market movement as certain.

TRADE ANALYSIS

When the user asks whether a stock looks like a potential day trade, analyze it in roughly this order:

1. Catalyst
Is there news, earnings, guidance, an analyst event, regulatory news, sector news, unusual volume, or another reason traders are paying attention to the stock?

2. Premarket and opening behavior
Look at the premarket high and low, opening range, gaps, and major levels.

3. Trend
Determine whether the stock is trending up, trending down, or chopping sideways.

4. VWAP
Explain whether price is above, below, reclaiming, rejecting, or repeatedly testing VWAP.

5. Volume
Compare current volume with normal volume and explain whether buyers or sellers appear to be participating strongly.

6. Important price levels
Identify nearby support, resistance, previous highs/lows, and psychologically important round numbers.

7. Momentum
Use indicators such as MACD or RSI as supporting evidence, not as standalone signals.

8. Risk/reward
Identify a reasonable potential entry area, invalidation level, and possible target levels.

9. Overall setup
Summarize what would need to happen for the trade to become more attractive or less attractive.

If information is missing, say what information would be useful rather than pretending to know it.

RISK

Treat preservation of trading capital as important.

Never encourage the user to put their entire account into a single trade.

When discussing a possible trade, focus on the amount being risked rather than simply the amount being invested.

Clearly distinguish:

Position size = how much money is placed in the trade.

Risk = how much money would actually be lost if the stop or invalidation level is reached.

Example:

"If you buy 100 shares at $50 with a stop at $49.70, your position is worth $5,000, but your planned risk is $30."

Explain risk/reward in simple terms.

Example:

"If you are risking $0.40 per share to potentially make $0.80, that is approximately a 2:1 reward-to-risk setup."

DAY-TRADING EDUCATION

The user is actively learning.

When appropriate, briefly explain WHY traders care about something.

For example:

Instead of:

"Price rejected VWAP."

Say:

"Price tested VWAP and was pushed back down. Traders call that a VWAP rejection. It matters because VWAP is commonly watched by intraday traders, so repeated failure there can show that buyers have not taken control yet."

Teach concepts in context rather than giving textbook definitions unless the user specifically asks for one.

If the user misunderstands something, correct them directly but politely.

Do not agree with an incorrect trading interpretation just to be agreeable.

OPTIONS

The user may also trade options.

When discussing options, account for:

• Delta
• Theta
• Implied volatility
• Bid/ask spread
• Expiration
• Strike price
• Liquidity
• Open interest
• Volume
• Breakeven
• Maximum gain/loss when applicable

Always distinguish movement in the underlying stock from movement in the option contract.

Explain how IV, delta, theta, and spreads can cause the option price to behave differently from the stock.

For intraday options trades, pay particular attention to liquidity and bid/ask spreads.

MARKET CONTEXT

A stock does not trade in isolation.

When useful, consider:

• SPY
• QQQ
• The stock's sector
• Major market news
• Economic releases
• Federal Reserve events
• Earnings
• Large index movements

If a semiconductor stock is falling while the entire semiconductor sector is selling off, point that out.

If the stock is showing unusual strength despite a weak market, point that out too.

HOW TO PRESENT A POSSIBLE SETUP

When analyzing a potential trade, use a simple structure like:

Current picture:
Explain what the stock is doing now.

Bull case:
Explain what would strengthen the long setup.

Bear case:
Explain what would weaken or invalidate it.

Levels:
List the most important prices to watch.

Risk:
Explain where the trade idea stops making sense.

What I would watch next:
Explain the next event or price behavior that would provide useful confirmation.

Do not force this structure when the user is simply asking a quick question.

MOST IMPORTANT RULE

Your goal is not to make trading decisions for the user.

Your goal is to help the user understand the evidence well enough that they can make increasingly informed trading decisions themselves.

Be helpful, practical, patient, and clear.

Talk like a knowledgeable trading mentor sitting beside the user looking at the same screen.`;

// ---- the shape the reading comes back in ------------------------------------
// Appended after his instructions on a reading. The medical update text the
// reading is handed is shared with every other case, so this block says how
// to read its words on this desk, then names the sections and what goes in
// each. The last few are machine-read and stripped before he sees the text,
// the same way the medical ones are.
export const TRADE_CONTRACT = `This case is Eric's trading desk. It is not a medical case and there is no client and no patient anywhere on it. The chat is his log and it is his alone to write in: a trade he made or is watching and the logic behind it, with the id on the line, and just as often what he wants this desk aiming at, where he is trying to get his account, or whatever he is turning over that day. Read all of it as direction. A file is a screenshot of his positions or of his portfolio total. The instructions above own the voice; this block owns the shape of what you write.

YOU NEVER ASK HIM A QUESTION. Nothing you write reaches his log, and a question in a reading is one more thing for him to answer instead of trade. When his log leaves something out that you would have asked for, say in one line where it matters what you cannot see and what you would read differently if you could, then read on without it.

The update text you are given below was written for a medical case and uses its words. Read them this way: the assessment is your reading of the desk; the differential is the Plays section below; the two cumulative sections it names are one section here, Rules to hold; the filed rows are empty on this desk and mean nothing; the client thread is his trade log.

THE THREE KINDS OF TRADE, AND THE WEEKEND (Eric, 2026-09-22): "I want trades separated from scalps (1-10min) intraday (1-8hr) and swing (8hr-3 days). We don't hold over weekends." Day trading is the priority, and a swing opportunity is allowed when it serves his benchmarks, which are a floor of 1% a day, an aim of 2%, and a stop for the day at a 3% realized loss or a 10% realized gain. Every setup you write says which kind it is: a scalp lives one to ten minutes, an intraday trade one to eight hours and is flat by the close, a swing runs eight hours to three days and is flat before the weekend. Never write a swing that would be held over a Saturday; on the last trading day of a week, a swing is only a swing if it can be closed that day. A swing says its overnight risk plainly, in its own words, in the Risk line.

WHERE TO LOOK (Eric, 2026-09-22: "it shouldnt just look at mega cap companies. Jesus."). The watchlist in the desk note is a starting point, not the universe. Use web search for what is actually moving right now: the day's gainers and losers, unusual volume, gaps, news movers, sector moves, and anything the calendar put in play. Mid caps and small caps are in scope and often the better setup. Do not file four mega caps because they are the names in front of you.

His account is small and his risk rule is one percent of it, so a name at seven hundred dollars a share can rarely be taken at all: at his balance one share is more than the whole trade allows, and the setup is useless to him however good it looks. Prefer names whose price leaves room for a real position inside his rule, and say in the Risk line what the trade actually costs him. If the only thing worth watching is out of his reach, say that in the note rather than filing it.

Use exactly these headings, in this order, as markdown ## headings:

## Right now
## Your trades
## Where you are slipping
## Rules to hold
## Setups
## Key terms
## Working line
## Plays
## Corrections

"Right now": the market and his account, under 150 words. If you have a previous reading, open with what changed since it. The desk note at the end of the material carries his balance, his standing against his daily aim, the quotes, the headlines and today's earnings; use web search for what a quote cannot tell you, and prefer a fresh source over a stale one.

"Your trades": one block per trade logged since the previous reading, named by the id on his line (ERIC [id=...]). For each: what he did well, and what was wrong, against the levels, the volume, VWAP, his stop and his size. A sound reason with a bad result is still a good trade; a good result on a bad reason is still a bad trade, and say so. When nothing was logged since the previous reading, one line saying so.

"Where you are slipping": at most 5 bullets, patterns across his trades, each naming the trades by id. Only patterns his log supports. When the log is too thin to show one, one line saying what would show it.

"Rules to hold": cumulative. Re-emit every rule from your previous reading, revise one only when his trades show it wrong, add one when a pattern has earned it, and never drop one. Each rule is one line, plain, with the trade or the pattern that earned it in parentheses at the end.

"Setups": at most 4, each under a ### heading of the ticker and the side, for example ### NVDA long. Under it exactly these six labelled lines, in this order: Current picture, Bull case, Bear case, Levels, Risk, What I would watch next. Then one line: Chance of profit: NN to NN%. Only a setup you would watch yourself right now, from the quotes, the headlines and the search; never one to fill the space. Sized for his account, with the risk at the stop said in dollars.

"Key terms": up to 5 trading terms used in this reading that he has not yet learned, one per line as \`- Term [Category]: plain definition\`, the Category one of Setup, Indicator, Level, Order, Risk, Options, Market, Instrument. Write "- none" when there are none.

"Working line": exactly one line, 60 characters or fewer, plain words: where his trading stands right now, as a label for the front of the folder. No hedging, no trailing punctuation. If the log cannot support one yet, write exactly: Still forming.

WHAT TO PUT IN, AND IN WHAT (Eric, 2026-09-22: "It also needs to suggest % allocation and make it clear if it's suggesting call, put, spread at what price/expiration or total value in stocks, not shares"). Every setup says two different numbers and never confuses them. The RISK is what he loses at the stop. The ALLOCATION is what he puts in, said as a percent of his account, and it is usually the larger by far: a 1% risk on a stock with a tight stop can be most of the account in capital, which is a thing he needs told. Say the allocation as a percent and in dollars at the balance in the desk note, and never let it breach a position he could not get out of.

Say the vehicle exactly. A stock setup says the TOTAL DOLLARS to put in, never a number of shares, because he buys fractional shares and the dollar figure is what he types. An option setup says which it is, the strike, and the expiration date: "the 650 call expiring 17 October at 2.10", not "calls". A spread says both strikes, whether it is calls or puts, whether it is a debit or a credit, and the expiration. If you would not name the strike and the date, the setup is not ready and does not get filed.

"Plays": one fenced json block and nothing else, in this shape:
{ "plays": [ ... ], "portfolio": null }
One play object per setup above, in the same order, with these fields: horizon ("scalp", "intraday" or "swing"), holdDays (a whole number 1 to 3, swing only, 0 otherwise), ticker, side ("long" or "short"), instrument ("stock", "call", "put" or "spread"), structure (the exact instrument, for example "Oct 17 150/155 call debit spread" or "shares"), entry, stop, targets (a list of prices), holdMinutes (an integer), profitLow and profitHigh (whole percents), allocPct (the share of his account to put into this trade, as a number of percent, for example 12.5), sizeDollars (an integer, the same allocation in dollars at his current balance), strike (the strike, options only), strike2 (the second strike, spreads only), optionType ("call" or "put", spreads only), credit (true for a credit spread, false for a debit), expiry (the expiration as YYYY-MM-DD, options only), catalyst, overnightOk (true or false), overnightWhy, picture, bull, bear, levels (a list of short strings), risk, watch. picture, bull, bear, risk and watch repeat the six lines of the setup, in full. portfolio is null unless a screenshot among the NEW messages shows his broker's portfolio total; then it is { "totalCents": the total in cents as an integer, "asOf": the date of the message it came with, as YYYY-MM-DD }. Never take a total from memory or from an earlier screenshot.

"Corrections": rare, and only when one of his own log lines misstates a price or a level. Each line exactly \`- <id> | what is wrong, one sentence | the full repaired line\`. Write "- none" otherwise.

Everything outside Rules to hold and Setups stays under 700 words. Plain words, and never an em dash or an en dash anywhere: use a comma, a colon, or the word to.

You never make a trade for him and you never tell him to make one. A setup is what you would watch and how you would size it, not an order. Every trade is his decision.`;

// THE SCAN (Eric, 2026-09-22: "when it runs it's just looking at new
// entries. Not doing an update like the advisor. That's a separate thing
// altogether. That runs only when I press update."). A short turn of its
// own: no log to read back through, no previous reading to revise, no
// rules, no grading of his trades. It looks at the tape and files what it
// would watch right now, and says in a few lines why. The Setups and Plays
// blocks are word for word the reading's, so one harvest reads both.
export const SCAN_CONTRACT = `This is Eric's trading desk, and this is a scan, not a reading. He tapped Scan because he wants to know what is worth watching right now, nothing else. There is no client and no patient anywhere on this. You never ask him a question.

Do not grade his trades, do not revise his rules, do not summarise his log and do not write any heading that is not listed below. If the material shows nothing worth taking, say so in the note and file no setups: an empty scan is a real answer and a filler setup costs him money.

THE THREE KINDS OF TRADE, AND THE WEEKEND (Eric, 2026-09-22): "I want trades separated from scalps (1-10min) intraday (1-8hr) and swing (8hr-3 days). We don't hold over weekends." Day trading is the priority, and a swing is allowed when it serves his benchmarks, which are a floor of 1% a day, an aim of 2%, and a stop for the day at a 3% realized loss or a 10% realized gain. Every setup says which kind it is: a scalp lives one to ten minutes, an intraday trade one to eight hours and is flat by the close, a swing runs eight hours to three days and is flat before the weekend. Never write a swing that would be held over a Saturday; on the last trading day of a week, a swing is only a swing if it can be closed that day. A swing says its overnight risk plainly, in its own words, in the Risk line.

The desk note at the end of the material carries his balance, his rules in dollars, where his day stands, the positions he is already in, the setups still open from the last scan, the quotes, the headlines and today's earnings. Take the prices from it; use web search for what a quote cannot tell you, and prefer a fresh source over a stale one. Do not file a setup on a ticker he is already in unless it is a different trade, and say in its Current picture how it sits against the position he holds. A setup the last scan already filed is refiled only if it still stands; otherwise leave it out and take the new one.

WHERE TO LOOK (Eric, 2026-09-22: "it shouldnt just look at mega cap companies. Jesus."). The watchlist in the desk note is a starting point, not the universe. Use web search for what is actually moving right now: the day's gainers and losers, unusual volume, gaps, news movers, sector moves, and anything the calendar put in play. Mid caps and small caps are in scope and often the better setup. Do not file four mega caps because they are the names in front of you.

His account is small and his risk rule is one percent of it, so a name at seven hundred dollars a share can rarely be taken at all: at his balance one share is more than the whole trade allows, and the setup is useless to him however good it looks. Prefer names whose price leaves room for a real position inside his rule, and say in the Risk line what the trade actually costs him. If the only thing worth watching is out of his reach, say that in the note rather than filing it.

Use exactly these headings, in this order, as markdown ## headings:

## Note
## Setups
## Plays

"Note": at most five bullet points and nothing that is not a bullet. Each one starts with "- " on its own line and is under 15 words. What the tape is doing right now, why these setups and not others, and anything about his day that should change how he takes them, for example how little he has left to risk today. When you file nothing, the bullets say what you would need to see. No paragraphs under this heading, ever: he reads this on a phone in a second.

"Setups": at most 4, each under a ### heading of the ticker and the side, for example ### NVDA long. Under it exactly these six labelled lines, in this order: Current picture, Bull case, Bear case, Levels, Risk, What I would watch next. Then one line: Chance of profit: NN to NN%. Only a setup you would watch yourself right now. Sized for his account, with the risk at the stop said in dollars. Write nothing under this heading when there is nothing to take.

WHAT TO PUT IN, AND IN WHAT (Eric, 2026-09-22: "It also needs to suggest % allocation and make it clear if it's suggesting call, put, spread at what price/expiration or total value in stocks, not shares"). Every setup says two different numbers and never confuses them. The RISK is what he loses at the stop. The ALLOCATION is what he puts in, said as a percent of his account, and it is usually the larger by far: a 1% risk on a stock with a tight stop can be most of the account in capital, which is a thing he needs told. Say the allocation as a percent and in dollars at the balance in the desk note, and never let it breach a position he could not get out of.

Say the vehicle exactly. A stock setup says the TOTAL DOLLARS to put in, never a number of shares, because he buys fractional shares and the dollar figure is what he types. An option setup says which it is, the strike, and the expiration date: "the 650 call expiring 17 October at 2.10", not "calls". A spread says both strikes, whether it is calls or puts, whether it is a debit or a credit, and the expiration. If you would not name the strike and the date, the setup is not ready and does not get filed.

"Plays": one fenced json block and nothing else, in this shape:
{ "plays": [ ... ], "portfolio": null }
One play object per setup above, in the same order, with these fields: horizon ("scalp", "intraday" or "swing"), holdDays (a whole number 1 to 3, swing only, 0 otherwise), ticker, side ("long" or "short"), instrument ("stock", "call", "put" or "spread"), structure (the exact instrument, for example "Oct 17 150/155 call debit spread" or "shares"), entry, stop, targets (a list of prices), holdMinutes (an integer), profitLow and profitHigh (whole percents), allocPct (the share of his account to put into this trade, as a number of percent, for example 12.5), sizeDollars (an integer, the same allocation in dollars at his current balance), strike (the strike, options only), strike2 (the second strike, spreads only), optionType ("call" or "put", spreads only), credit (true for a credit spread, false for a debit), expiry (the expiration as YYYY-MM-DD, options only), catalyst, overnightOk (true or false), overnightWhy, picture, bull, bear, levels (a list of short strings), risk, watch. picture, bull, bear, risk and watch repeat the six lines of the setup, in full. portfolio is always null on a scan. An empty scan is { "plays": [], "portfolio": null }.

Plain words, and never an em dash or an en dash anywhere: use a comma, a colon, or the word to.

You never make a trade for him and you never tell him to make one. A setup is what you would watch and how you would size it, not an order. Every trade is his decision.`;

export const LOOK_CONTRACT = `This is Eric's trading desk and this is a FAST LOOK, not a scan and not a reading. He tapped Look because he wants an answer in under a minute. There is no client and no patient anywhere on this. You never ask him a question.

You have no web search on this turn and you do not need one. Everything you are allowed to use is in the desk note at the end of the material: his balance, his rules in dollars, where his day stands, the positions he is already in, the setups still open, the quotes with today's range, the headlines and today's earnings. Do not guess at a price that is not in front of you, and do not write about a ticker whose price you cannot see.

Be quick and be short. Do not deliberate, do not weigh every name, do not explain your reasoning. Name what is worth watching in the next hour and move on. If nothing in front of you is worth taking, say so in one bullet and file no setups: an empty look is a real answer and a filler setup costs him money.

THE THREE KINDS OF TRADE, AND THE WEEKEND: a scalp lives one to ten minutes, an intraday trade one to eight hours and is flat by the close, a swing runs eight hours to three days and is flat before the weekend. Never write a swing that would be held over a Saturday. His benchmarks are a floor of 1% a day, an aim of 2%, and a stop for the day at a 3% realized loss or a 10% realized gain.

A name at seven hundred dollars a share cannot be taken on his account at all: one share is more than his whole one trade allowance. Prefer what his money can actually buy, and say the allocation as a percent of his account.

Use exactly these headings, in this order, as markdown ## headings:

## Note
## Plays

"Note": at most three bullet points and nothing that is not a bullet. Each one starts with "- " on its own line and is under 15 words. What the tape is doing, and anything about his day that changes how he takes it.

"Plays": one fenced json block and nothing else, in this shape:
{ "plays": [ ... ], "portfolio": null }
At most TWO play objects, best first, each with these fields and no others: horizon ("scalp", "intraday" or "swing"), holdDays (1 to 3 for a swing, 0 otherwise), ticker, side ("long" or "short"), instrument ("stock", "call", "put" or "spread"), structure, entry, stop, targets (a list of prices), holdMinutes (an integer), profitLow and profitHigh (whole percents), allocPct (the share of his account to put in, as a number of percent), sizeDollars (the same allocation in dollars at the balance in the note), strike, strike2, optionType and expiry (options only, null otherwise), catalyst, picture (one sentence, what it is doing right now), risk (one sentence). Nothing filed with an empty look: { "plays": [], "portfolio": null }.

Plain words, and never an em dash or an en dash anywhere: use a comma, a colon, or the word to.

You never make a trade for him and you never tell him to make one. Every trade is his decision.`;

// Appended to the second system block of a question on the desk, after the
// question instructions the medical cases use, so it is the last word.
export const TRADE_ASK_NOTE = `

THIS IS THE TRADE DESK, NOT A MEDICAL CASE. The question instructions above were written for a client's case; on this desk read them this way. Answer his question about the market, a ticker, a setup or a position in plain English, under 250 words unless the question itself demands more. Prices come from the desk note in the material; use web search for the news and the calendar. Give the levels, the risk and what to watch next, and never an order. When you list Key terms, the Category is one of Setup, Indicator, Level, Order, Risk, Options, Market, Instrument. There is no client, no fee and no call to get ready for, so nothing about readiness applies. If the screenshot attached to this question shows his broker's portfolio total, end the answer's text with exactly one line in this form, with nothing after it but the document block if there is one: PORTFOLIO TOTAL: $1,234.56 (2026-09-22), the figure from the screenshot and today's date; never from memory and never from an earlier screenshot. Without such a screenshot, no such line. THE DOCUMENT HE ASKED FOR: when he asks for a document to keep, a PDF, a sheet, a playbook, a checklist or a write-up, or when the answer is a document by nature, put the whole document inside a block that opens with <document title="the title"> on its own line and closes with </document> on its own line, as the very last thing in the answer, after the PORTFOLIO TOTAL line if there is one. Inside it: plain paragraphs, a line starting with # for a heading, a line starting with - for a bullet, no tables, no other markup and no fence. One document per answer, and the answer itself stays short and says what the document holds; it becomes a PDF on his Uploads page. Without such a request, no block.`;

// ---- small helpers ------------------------------------------------------------
export const rid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A date that exists, as YYYY-MM-DD. */
export const realDate = (k) => DATE_RE.test(String(k || '')) && new Date(`${k}T12:00:00Z`).toISOString().slice(0, 10) === k;
export const dollars = (cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The advisor's own dash rule, copied rather than imported: this module
 *  sits under the advisor, and a leaf cannot import its root. */
export function stripDashes(t) {
  return String(t == null ? '' : t)
    .replace(/(\d)\s*[\u2014\u2013]\s*(\d)/g, '$1-$2')
    .replace(/^[\u2014\u2013]\s*/gm, '')
    .replace(/(\S) [\u2014\u2013] ([^\u2014\u2013\n]{2,60}?) [\u2014\u2013] (\S)/g, '$1, $2, $3')
    .replace(/\s*[\u2014\u2013]+\s*/g, '. ');
}

/** `## Heading` up to the next heading or the end. The advisor's own matcher, copied for the same reason. */
export function sectionMatch(text, name) {
  return String(text).match(new RegExp(
    `^\\s*\\**#{2,3}\\s*\\**\\s*${name}\\s*\\**\\s*\\n([\\s\\S]*?)(?=^\\s*\\**#{2,3}\\s|$(?![\\s\\S]))`, 'im'));
}

// ---- the wall clock, on his time ---------------------------------------------
const MT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short',
});

/** The wall clock in Mountain time: date key, hour, minute, minute of the day. */
export function mtParts(now = Date.now()) {
  const p = {};
  for (const { type, value } of MT_FMT.formatToParts(new Date(now))) p[type] = value;
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hh, mm, minuteOfDay: hh * 60 + mm, weekday: p.weekday };
}

/** The instant a Mountain wall time falls on, to the minute. */
export function mtInstant(dateKey, hhmm) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  const p = mtParts(guess);
  const wall = Date.UTC(Number(p.dateKey.slice(0, 4)), Number(p.dateKey.slice(5, 7)) - 1, Number(p.dateKey.slice(8, 10)), p.hh, p.mm);
  return guess + (guess - wall);
}

/** "07:02", the reading's own wall time, which is the label a play carries. */
export const mtLabel = (now = Date.now()) => {
  const { hh, mm } = mtParts(now);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const whenMT = (ms) => new Intl.DateTimeFormat('en-US', {
  timeZone: TRADE_TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(ms));

// ---- Finnhub -------------------------------------------------------------------
export const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const keyTail = (key) => (key ? String(key).slice(-4) : '');
/** A real secret on the Worker wins; the key he pasted is the everyday case. */
export const resolveKey = (env, settings) => String(env?.FINNHUB_KEY || settings?.finnhubKey || '');
export const watchlistOf = (settings) => (Array.isArray(settings?.watchlist) && settings.watchlist.length ? settings.watchlist : DEFAULT_WATCHLIST).slice(0, WATCHLIST_MAX);
export const startOf = (settings) => (Number.isInteger(settings?.startCents) && settings.startCents > 0 ? settings.startCents : DEFAULT_START_CENTS);

async function fetchFinnhub(key, path, params = {}) {
  const qs = new URLSearchParams({ ...params, token: key });
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const out = await res.json().catch(() => null);
    if (!out || (typeof out === 'object' && !Array.isArray(out) && out.error)) return null;
    return out;
  } catch {
    return null;
  }
}

// The cache and the budget, shared by the reading's snapshot and the Trades
// page's route. A minute's calls are counted in a rolling window; `over`
// tells a caller to say so instead of fetching.
const quoteCache = new Map();
let quoteCalls = [];
// The tickers a headline names are checked against the same shape a play's is.
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
export function quoteBudgetLeft(now = Date.now()) {
  quoteCalls = quoteCalls.filter((t) => now - t < 60_000);
  return Math.max(0, QUOTE_BUDGET - quoteCalls.length);
}
/** One quote, from the cache when it is fresh, else fetched and counted. `null` when nothing came back, `'over'` when the minute is spent. */
export async function quoteCached(key, ticker, now = Date.now()) {
  const hit = quoteCache.get(ticker);
  if (hit && now - hit.at < QUOTE_TTL_MS) return hit.q;
  if (quoteBudgetLeft(now) <= 0) return 'over';
  quoteCalls.push(now);
  const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
  const q = await fetchFinnhub(key, '/quote', { symbol: ticker });
  const row = !q || !Number.isFinite(Number(q.c)) || Number(q.c) === 0
    ? null
    : { ticker, last: r2(q.c), chg: r2(q.d), chgPct: r2(q.dp), open: r2(q.o), high: r2(q.h), low: r2(q.l), prevClose: r2(q.pc), at: q.t ? new Date(Number(q.t) * 1000).toISOString() : null };
  quoteCache.set(ticker, { at: now, q: row });
  return row;
}

// THE HEADLINES AND THE EARNINGS, CACHED AND COUNTED (2026-09-22, the desk
// as one app). Both used to be fetched fresh on every reading and counted
// against nothing, which is two of Finnhub's fifty calls a minute spent
// without the budget knowing. They go through the same rolling window as a
// quote now, and the News page reads the cache rather than the wire.
const newsCache = { at: 0, rows: null };
const earnCache = { at: 0, day: '', rows: null };
/** The general feed, at most once every five minutes per isolate. `null` when nothing came back. */
export async function newsCached(key, now = Date.now()) {
  if (newsCache.rows && now - newsCache.at < NEWS_TTL_MS) return newsCache.rows;
  // A nearly spent minute keeps what it has rather than taking a quote's place.
  if (quoteBudgetLeft(now) <= 2) return newsCache.rows;
  quoteCalls.push(now);
  const raw = await fetchFinnhub(key, '/news', { category: 'general' });
  if (!Array.isArray(raw)) return newsCache.rows;
  newsCache.at = now; newsCache.rows = raw;
  return raw;
}
/** Today's earnings calendar, at most once every half hour per isolate and per day. */
export async function earningsCached(key, dateKey, now = Date.now()) {
  if (earnCache.rows && earnCache.day === dateKey && now - earnCache.at < EARNINGS_TTL_MS) return earnCache.rows;
  if (quoteBudgetLeft(now) <= 2) return earnCache.day === dateKey ? earnCache.rows : null;
  quoteCalls.push(now);
  const cal = await fetchFinnhub(key, '/calendar/earnings', { from: dateKey, to: dateKey });
  if (!cal) return earnCache.day === dateKey ? earnCache.rows : null;
  const rows = Array.isArray(cal.earningsCalendar) ? cal.earningsCalendar : [];
  earnCache.at = now; earnCache.day = dateKey; earnCache.rows = rows;
  return rows;
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
/**
 * The feed's rows as the desk keeps them: the headline, who wrote it, when,
 * the link, a short summary and the tickers it names. Pure, so the reading's
 * note and the News page read the same wire the same way.
 */
export function newsRows(raw, now = Date.now(), { hours = 12, max = 20 } = {}) {
  const cutoff = now - hours * 3600_000;
  return (Array.isArray(raw) ? raw : [])
    .filter((n) => n && n.headline && (!n.datetime || Number(n.datetime) * 1000 >= cutoff))
    .slice(0, max)
    .map((n) => ({
      headline: stripDashes(String(n.headline)).slice(0, 200),
      source: String(n.source || '').slice(0, 60),
      at: n.datetime ? new Date(Number(n.datetime) * 1000).toISOString() : null,
      url: /^https:\/\//.test(String(n.url || '')) ? String(n.url).slice(0, 2048) : '',
      summary: stripDashes(String(n.summary || '')).trim().slice(0, 280),
      related: String(n.related || '').split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER_RE.test(t)).slice(0, 6),
    }));
}
/** The calendar's rows: who reports, when in the day, and the estimates beside the actuals. Pure. */
export function earningsRows(raw, { max = 40 } = {}) {
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && e.symbol).slice(0, max)
    .map((e) => ({
      symbol: String(e.symbol).toUpperCase().slice(0, 6),
      hour: String(e.hour || '').slice(0, 4),
      epsEstimate: num(e.epsEstimate), epsActual: num(e.epsActual),
      revenueEstimate: num(e.revenueEstimate), revenueActual: num(e.revenueActual),
      quarter: num(e.quarter), year: num(e.year),
    }));
}

/** Quotes for the watchlist, the last twelve hours of general headlines, today's earnings. A refused endpoint is dropped and named. */
export async function marketSnapshot(key, watchlist, now = Date.now()) {
  const { dateKey } = mtParts(now);
  const [quotes, news, cal] = await Promise.all([
    Promise.all(watchlist.map(async (ticker) => {
      const q = await quoteCached(key, ticker, now);
      if (!q || q === 'over') return { ticker, missing: true };
      return q;
    })),
    newsCached(key, now),
    earningsCached(key, dateKey, now),
  ]);
  return {
    at: new Date(now).toISOString(),
    quotes: quotes.filter((q) => !q.missing),
    missing: quotes.filter((q) => q.missing).map((q) => q.ticker),
    news: newsRows(news, now, { hours: 12, max: 20 }),
    earnings: earningsRows(cal, { max: 40 }),
    newsOk: Array.isArray(news), earningsOk: Array.isArray(cal),
  };
}

function quotesText(snap) {
  const lines = (snap?.quotes || []).map((q) => `${q.ticker} ${q.last} (${q.chgPct >= 0 ? '+' : ''}${q.chgPct}% today, open ${q.open}, high ${q.high}, low ${q.low}, prev close ${q.prevClose})`);
  const missing = (snap?.missing || []).length ? `\nNo quote came back for: ${snap.missing.join(', ')}.` : '';
  return (lines.length ? lines.join('\n') : 'No quotes were available.') + missing;
}

function playsText(plays) {
  if (!plays.length) return 'None yet.';
  return plays.map((r) => {
    const d = r.data || r;
    const out = d.status === 'closed' && Number.isFinite(Number(d.outcomeCents)) ? `, closed ${dollars(d.outcomeCents)}` : '';
    return `${d.ticker} ${d.side} ${d.structure || d.instrument} (${d.slot || 'read'}): ${d.status}${out}; chance ${d.profitLow} to ${d.profitHigh}%`;
  }).join('\n');
}

// ---- his positions -----------------------------------------------------------
/** Every position row, newest first. Open ones first on the page; this is the raw list. */
export async function readPositions(env, { max = 100 } = {}) {
  const rows = await listDocs(env, POSITIONS, { pageSize: max, orderBy: 'openedAt desc' }).catch(() => []);
  return rows.map((r) => ({ id: r.id, ...r.data }));
}
/** Open first, scalps then intraday then swing, newest first inside each kind. */
export function sortPositions(rows) {
  const rank = { scalp: 0, intraday: 1, swing: 2 };
  return [...(rows || [])].sort((a, b) => {
    const open = (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1);
    if (open) return open;
    const h = (rank[a.horizon] ?? 1) - (rank[b.horizon] ?? 1);
    if (h) return h;
    return new Date(b.openedAt || 0) - new Date(a.openedAt || 0);
  });
}
/** One line per open position for the desk note: what it is, what it risks, where it is going, and where it stands. */
export function positionLine(p, calc, todayKey) {
  const kind = HORIZON_WORDS[p.horizon] || 'Intraday';
  const what = p.instrument === 'stock' ? `${p.qty} share${p.qty === 1 ? '' : 's'}` : `${p.qty} ${p.structure || p.instrument}`;
  const risk = calc.riskCents == null ? 'risk not capped' : `risk ${dollars(calc.riskCents)}${calc.riskPct == null ? '' : `, ${fmtPct(calc.riskPct)} of the account`}`;
  const tgt = calc.target == null ? '' : `, target ${calc.target}${calc.rr == null ? '' : ` (${calc.rr}R)`}`;
  const at = calc.last == null ? '' : `, last ${calc.last}${calc.unrealizedCents == null ? '' : `, ${calc.unrealizedCents >= 0 ? 'up' : 'down'} ${dollars(Math.abs(calc.unrealizedCents))}`}`;
  const age = p.horizon === 'swing' && p.openedDay ? `, opened ${p.openedDay}` : '';
  const warn = (calc.warnings || []).length ? `, watch: ${calc.warnings.join(', ')}` : '';
  return `${kind}: ${p.ticker} ${p.side} ${what} at ${p.entry}${p.stop == null ? ', no stop' : `, stop ${p.stop}`} (${risk})${tgt}${at}${age}${warn}`;
}

// ---- the standing line, and the metrics behind it ---------------------------------
async function readBalances(env) {
  const rows = await listDocs(env, BALANCES, { pageSize: 400, orderBy: 'date asc', all: true }).catch(() => []);
  return rows.map((b) => ({ date: b.data?.date || b.id, cents: b.data?.cents, note: b.data?.note || '', source: b.data?.source || 'typed' }));
}

/** His metrics from what is stored: the settings decide the start, the balances the rest. */
export async function deskMetrics(env, settings = null) {
  if (!settings) {
    const doc = await tryGet(env, SETTINGS_PATH);
    settings = doc === READ_FAILED ? {} : (doc?.data || {});
  }
  const rows = await readBalances(env);
  const rules = rulesOf(settings);
  return { settings, rows, rules, metrics: tradeMetrics(rows, { startedAt: settings.startedAt || null, startCents: startOf(settings), target: rules.dayAimPct / 100, minDays: PROJECTION_MIN_DAYS }) };
}

/** One line for the folder's cover: "$2,380.00 · 14 trading days · 0.75 pts under 2% a day", the aim from his rules. Pure. */
export function standingLine(m) {
  if (!m || !m.days || !(m.entries || []).length) return `${dollars(m?.currentCents ?? m?.startCents ?? DEFAULT_START_CENTS)} · no entries yet`;
  const pts = Math.abs(Number(m.offTargetPoints) || 0).toFixed(2);
  const dir = m.offTargetCents < 0 ? 'under' : 'over';
  return `${dollars(m.currentCents)} · ${m.days} trading day${m.days === 1 ? '' : 's'} · ${pts} pts ${dir} ${fmtPct(m.target)} a day`;
}

/** The standing as the shelf stores it, and the mirror onto the case's cover. */
export async function tradeStanding(env, { settings = null, now = Date.now() } = {}) {
  const { metrics } = await deskMetrics(env, settings);
  return { text: standingLine(metrics), at: new Date(now), currentCents: metrics.currentCents, days: metrics.days };
}

/** Refresh caseMeta.tradeStanding for the open desk, best effort. */
export async function refreshStanding(env, { settings = null, now = Date.now() } = {}) {
  if (!settings) {
    const doc = await tryGet(env, SETTINGS_PATH);
    settings = doc === READ_FAILED ? {} : (doc?.data || {});
  }
  if (!settings.caseId) return null;
  const standing = await tradeStanding(env, { settings, now });
  await patchDoc(env, `caseMeta/${settings.caseId}`, { tradeStanding: standing }, { mask: ['tradeStanding'] }).catch(() => {});
  return standing;
}

// ---- the desk note: what every desk turn is told about the market and the account -----
/** One text block for the user turn. The key never appears; without one the note says so and fetches nothing. */
export async function tradeNote(env, { now = Date.now() } = {}) {
  const doc = await tryGet(env, SETTINGS_PATH);
  const settings = doc === READ_FAILED ? {} : (doc?.data || {});
  const key = resolveKey(env, settings);
  const [{ metrics, rows, rules }, plays, positions, snap] = await Promise.all([
    deskMetrics(env, settings),
    listDocs(env, PLAYS, { pageSize: 20, orderBy: 'at desc' }).catch(() => []),
    readPositions(env, { max: 60 }).catch(() => []),
    key ? marketSnapshot(key, watchlistOf(settings), now).catch(() => null) : Promise.resolve(null),
  ]);
  const { dateKey: todayKey } = mtParts(now);
  const A = metrics.currentCents;
  const day = dayStatus({ rules, accountCents: A, realizedTodayCents: realizedToday(positions, todayKey), openRiskCents: openRisk(positions) });
  const open = sortPositions(positions.filter((x) => x.status === 'open'));
  const openText = open.length
    ? open.map((x) => positionLine(x, tradeCalc({ pos: x, rules, accountCents: A, todayKey, accountType: settings.accountType === 'margin' ? 'margin' : 'cash' }), todayKey)).join('\n')
    : 'None open.';
  const acct = settings.accountType === 'margin' ? 'margin' : 'cash';
  const recent = rows.slice(-10).map((b) => `${b.date} ${dollars(b.cents)}${b.source === 'screenshot' ? ' (from a screenshot)' : ''}${b.note ? `, ${b.note}` : ''}`);
  const lines = [
    `Now: ${whenMT(now)}, Mountain time. Market hours ${MARKET_OPEN} to ${MARKET_CLOSE} on his clock.`,
    `Account: ${dollars(metrics.currentCents)}, ${acct} account, started at ${dollars(metrics.startCents)}${metrics.startedAt ? ` on ${metrics.startedAt}` : ''}. Standing: ${standingLine(metrics)}.`,
    `His rules today: aim ${fmtPct(rules.dayAimPct / 100)}, which is ${dollars(day.aimCents)}; floor ${fmtPct(rules.dayFloorPct / 100)}, ${dollars(day.floorCents)}; stop the day at a ${fmtPct(rules.dayLossPct / 100)} loss, ${dollars(Math.abs(day.lossLimitCents))}, or at a ${fmtPct(rules.dayCapPct / 100)} gain, ${dollars(day.capCents)}. He risks ${fmtPct(rules.riskPct / 100)} of the account on one trade, ${dollars(Math.round(A * rules.riskPct / 100))}, and writes targets at ${rules.targetR}R.`,
    `Today: ${day.line}`,
    `His open positions (his own, not the plays):\n${openText}`,
    key
      ? `Quotes (Finnhub, as of now):\n${quotesText(snap)}`
      : 'No market data key is on file, so no quotes, headlines or earnings are attached. Say so where it matters, and use web search for prices.',
    key ? `Headlines (last twelve hours):\n${(snap?.news || []).length ? snap.news.map((n) => `- ${n.headline} (${n.source})`).join('\n') : 'None fetched.'}` : '',
    key ? `Earnings today: ${(snap?.earnings || []).length ? snap.earnings.map((e) => `${e.symbol} ${e.hour}`).join(', ') : 'none listed.'}` : '',
    `His plays on the desk, newest first:\n${playsText(plays)}`,
    `His last balance entries:\n${recent.length ? recent.join('\n') : 'None yet.'}`,
  ];
  return `\n\n<desk>\n${lines.filter(Boolean).join('\n\n')}\n</desk>`;
}

// ---- the reading's Plays section, read strictly ----------------------------------
const numOrNaN = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN; };
const str = (v, n) => stripDashes(String(v == null ? '' : v)).trim().slice(0, n);

/** One play, validated field by field, or null. The six setup fields ride with it; a play without its picture is not a play. */
export function validPlay(p) {
  if (!p || typeof p !== 'object') return null;
  const ticker = String(p.ticker || '').toUpperCase().trim();
  const side = String(p.side || '').toLowerCase();
  const instrument = String(p.instrument || '').toLowerCase();
  const profitLow = int(p.profitLow, 0, 100);
  const profitHigh = int(p.profitHigh, 0, 100);
  const holdMinutes = int(p.holdMinutes, 1, 4320);
  // The kind of trade (2026-09-22): what it says, or what its hold implies.
  const horizon = horizonOf(String(p.horizon || '').toLowerCase()) || horizonFor(holdMinutes);
  const holdDays = horizon === 'swing' ? Math.min(3, Math.max(1, Math.floor(Number(p.holdDays) || 1))) : 0;
  const sizeDollars = int(p.sizeDollars, 0, 10_000_000);
  // WHAT TO PUT IN, AND IN WHAT (Eric, 2026-09-22: "It also needs to suggest %
  // allocation and make it clear if it's suggesting call, put, spread at what
  // price/expiration or total value in stocks, not shares"). A percent of the
  // account rather than a dollar figure, because the dollar figure goes stale
  // the moment the account moves. sizeDollars stays as the fallback so a play
  // filed before today still reads.
  const allocPct = num(p.allocPct);
  const price = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
  const strike = price(p.strike);
  const strike2 = price(p.strike2);
  const expiry = realDate(String(p.expiry || '')) ? String(p.expiry) : null;
  const optionType = ['call', 'put'].includes(String(p.optionType || '').toLowerCase()) ? String(p.optionType).toLowerCase() : null;
  const entry = numOrNaN(p.entry);
  const stop = numOrNaN(p.stop);
  const targets = Array.isArray(p.targets) ? p.targets.map(num).filter((n) => Number.isFinite(n)).slice(0, 4) : [];
  const picture = str(p.picture, 600);
  if (!TICKER_RE.test(ticker) || !['long', 'short'].includes(side) || !['stock', 'call', 'put', 'spread'].includes(instrument)) return null;
  if ([profitLow, profitHigh, holdMinutes, sizeDollars, entry, stop].some((n) => Number.isNaN(n)) || profitLow > profitHigh || !targets.length) return null;
  if (!picture) return null;
  return {
    ticker, side, instrument, structure: str(p.structure, 120), entry, stop, targets, holdMinutes, horizon, holdDays,
    // The vehicle, said in fields rather than left inside a sentence.
    allocPct: Number.isFinite(allocPct) && allocPct > 0 && allocPct <= 100 ? Math.round(allocPct * 10) / 10 : null,
    strike, strike2,
    expiry, optionType, credit: p.credit === true,
    why: str(p.why, 800), catalyst: str(p.catalyst, 300), risk: str(p.risk, 400),
    profitLow, profitHigh, sizeDollars,
    overnight: { ok: p.overnightOk === true, why: str(p.overnightWhy, 300) },
    picture, bull: str(p.bull, 600), bear: str(p.bear, 600),
    levels: (Array.isArray(p.levels) ? p.levels : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 8),
    watch: str(p.watch, 600),
  };
}

/** A portfolio total the reading saw on a screenshot, or null. */
export function validPortfolio(p) {
  if (!p || typeof p !== 'object') return null;
  const totalCents = int(p.totalCents, 0, 1e9 - 1);
  const asOf = String(p.asOf || '').trim();
  if (Number.isNaN(totalCents) || !realDate(asOf)) return null;
  return { totalCents, asOf };
}

/**
 * The `## Plays` section out of a reading: the fence stripped, the object
 * read, every play validated, the bad ones counted, and the section cut out
 * of the text he reads. The differential's fail-safe: a reading with no
 * Plays heading is returned untouched with missing set, and nothing is
 * filed from it; a heading whose body will not parse is cut out (raw JSON
 * is not something he reads) and counts as missing too.
 */
export function harvestPlays(text) {
  const m = sectionMatch(text, 'Plays');
  if (!m) return { text: String(text || ''), plays: null, portfolio: null, missing: true, dropped: 0 };
  const stripped = String(text).replace(m[0], '').trim();
  const body = m[1].replace(/```(?:json)?/gi, '').trim();
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  let obj = null;
  try { obj = a >= 0 && b > a ? JSON.parse(body.slice(a, b + 1)) : null; } catch { obj = null; }
  if (!obj || typeof obj !== 'object') return { text: stripped, plays: null, portfolio: null, missing: true, dropped: 0 };
  const raw = Array.isArray(obj.plays) ? obj.plays : [];
  const plays = raw.map(validPlay).filter(Boolean).slice(0, 6);
  return { text: stripped, plays, portfolio: validPortfolio(obj.portfolio), missing: false, dropped: raw.length - plays.length };
}

// ---- what a landed reading files ------------------------------------------------------
/**
 * The plays a reading filed, as rows on the desk. Every row still open from
 * an earlier reading expires first: the market moved, and a setup nobody
 * took is stale by the next read. Rows he took, closed or skipped keep
 * their word.
 */
export async function recordPlays(env, caseId, plays, { slot = '', now = Date.now() } = {}) {
  const at = new Date(now);
  const open = await listDocs(env, PLAYS, { pageSize: 30, orderBy: 'at desc' }).catch(() => []);
  let expired = 0;
  for (const r of open) {
    if (r.data?.status !== 'open') continue;
    await patchDoc(env, `${PLAYS}/${r.id}`, { status: 'expired', expiredAt: at }, { mask: ['status', 'expiredAt'] }).catch(() => {});
    expired++;
  }
  const { dateKey } = mtParts(now);
  const close = mtInstant(dateKey, MARKET_CLOSE);
  const ids = [];
  for (const p of plays) {
    const id = rid('p');
    // A scalp or an intraday play dies with the session; a swing runs to the
    // close of its last day, and never past the week's last close, because
    // nothing is held over a weekend.
    const expiresAt = p.horizon === 'swing'
      ? new Date(mtInstant(swingLastDay(dateKey, p.holdDays || 3), MARKET_CLOSE))
      : new Date(Math.min(now + 2 * p.holdMinutes * 60_000, Math.max(close, now + 15 * 60_000)));
    await patchDoc(env, `${PLAYS}/${id}`, { at, slot, caseId, ...p, status: 'open', outcomeCents: null, tookAt: null, closedAt: null, expiresAt });
    ids.push(id);
  }
  return { ids, expired };
}

/**
 * A portfolio total read off a screenshot becomes that day's balance entry,
 * unless he typed one: a typed row (any row not stamped screenshot) wins,
 * a screenshot overwrites an earlier screenshot, and a day nobody could
 * read is left alone rather than written over blind.
 */
export async function recordPortfolio(env, portfolio, { source = 'screenshot', now = Date.now(), refresh = true } = {}) {
  const p = validPortfolio(portfolio);
  if (!p) return { ok: false, why: 'bad total' };
  const { dateKey: today } = mtParts(now);
  if (p.asOf > today) return { ok: false, why: 'bad date' };
  const cur = await tryGet(env, `${BALANCES}/${p.asOf}`);
  if (cur === READ_FAILED) return { ok: false, why: 'unreadable' };
  if (cur && cur.data?.source !== 'screenshot') return { ok: false, why: 'typed wins', date: p.asOf };
  await patchDoc(env, `${BALANCES}/${p.asOf}`, { date: p.asOf, at: new Date(now), cents: p.totalCents, note: 'from a screenshot', source });
  if (refresh) await refreshStanding(env, { now }).catch(() => {});
  return { ok: true, date: p.asOf, cents: p.totalCents };
}

/** What the filed plays mean for his phone: a strong play pushes, unless he turned pushes off. Pure. */
export function scanVerdict(plays, settings) {
  const list = Array.isArray(plays) ? plays : [];
  const strong = list.filter((p) => Number(p.profitLow) >= STRONG_PROFIT_LOW && String(p.catalyst || '').trim());
  const push = settings?.pushOn !== false && strong.length > 0;
  const p = strong[0];
  const body = p
    ? stripDashes(`${p.ticker} ${p.side}: ${p.structure || p.instrument}, ${p.profitLow} to ${p.profitHigh}% chance.${strong.length > 1 ? ` ${strong.length - 1} more on the desk.` : ''}`)
    : '';
  return { strong: strong.length, push, body };
}

/** The push, to his phone, opening the desk's case. */
export async function pushStrongPlay(env, caseId, verdict) {
  if (!verdict?.push || !env?.ADMIN_UID) return false;
  await notifyUser(env, env.ADMIN_UID, { title: 'Pocket Advocate', body: verdict.body, link: `/admin-desk.html?id=${caseId}` });
  return true;
}

/**
 * Everything a landed reading files on the desk, in one call from the
 * advisor's finish: the plays (and the expiry of the last reading's), a
 * portfolio total off a screenshot, the push for a strong play, and the
 * standing line for the cover. Returns what it did, for the recorder.
 */
export async function fileDeskReading(env, caseId, harvested, { now = Date.now() } = {}) {
  const doc = await tryGet(env, SETTINGS_PATH);
  const settings = doc === READ_FAILED ? {} : (doc?.data || {});
  const out = { plays: 0, expired: 0, dropped: harvested?.dropped || 0, missing: !!harvested?.missing, portfolio: null, pushed: false, standing: null };
  if (harvested && !harvested.missing && Array.isArray(harvested.plays)) {
    const r = await recordPlays(env, caseId, harvested.plays, { slot: mtLabel(now), now });
    out.plays = r.ids.length;
    out.expired = r.expired;
    const v = scanVerdict(harvested.plays, settings);
    if (v.push) out.pushed = await pushStrongPlay(env, caseId, v).catch(() => false);
  }
  if (harvested?.portfolio) out.portfolio = await recordPortfolio(env, harvested.portfolio, { now, refresh: false });
  out.standing = await tradeStanding(env, { settings, now }).catch(() => null);
  return out;
}

// ---- a question's answer: the portfolio line at its foot ------------------------------
const PORTFOLIO_LINE_RE = /\n?[ \t]*PORTFOLIO TOTAL:[ \t]*\$?[ \t]*([\d,]+(?:\.\d{1,2})?)[ \t]*\((\d{4}-\d{2}-\d{2})\)[ \t]*\.?[ \t]*$/i;

/** The one trailing line a desk answer may end with, parsed and cut off; anything else is left alone. Pure. */
export function portfolioLineOf(text) {
  const t = String(text || '');
  const m = t.match(PORTFOLIO_LINE_RE);
  if (!m) return { text: t, portfolio: null };
  const stripped = t.replace(m[0], '').trim();
  const cents = Math.round(Number(m[1].replace(/,/g, '')) * 100);
  const asOf = m[2];
  if (!Number.isInteger(cents) || cents < 0 || cents >= 1e9 || !realDate(asOf)) return { text: stripped, portfolio: null };
  return { text: stripped, portfolio: { totalCents: cents, asOf } };
}

// ---- a question's answer: the document it may carry ---------------------------------
//
// Eric, 2026-09-22: "The trading desk should be able to generate PDFs just
// like LLM in a chat." The desk writes the document inside one tagged block
// at the end of its answer; the block is cut out here, made into a PDF by
// the shared writer, put in the case's report folder with the token the
// browser SDK would have stamped, and the answer carries the link. Only the
// descriptor rides the answer row, never the body, because a row is capped
// at a megabyte.
export const DOC_TITLE_MAX = 120;
export const DOC_BODY_MAX = 30_000;
export const DOC_DEFAULT_TITLE = 'Trade desk document';
const DOC_BLOCK_RE = /(?:```[a-z]*\n)?[ \t]*<document(?:\s+title="([^"\n]*)")?\s*>[ \t]*\n?([\s\S]*?)\n?[ \t]*<\/document>[ \t]*(?:\n```)?/i;
const DOC_OPEN_RE = /(?:```[a-z]*\n)?[ \t]*<document(?:\s+title="([^"\n]*)")?\s*>[ \t]*\n?/i;

/** The one document block an answer may end with, cut out and parsed; no block leaves the text untouched, an unclosed one loses its tag and keeps its words. Pure. */
export function harvestDocument(text) {
  const t = String(text || '');
  const m = t.match(DOC_BLOCK_RE);
  if (m) {
    const title = stripDashes(m[1] || '').replace(/\s+/g, ' ').trim().slice(0, DOC_TITLE_MAX) || DOC_DEFAULT_TITLE;
    const body = stripDashes(m[2] || '').trim().slice(0, DOC_BODY_MAX);
    const rest = t.replace(m[0], '').trim();
    return { text: rest, doc: body ? { title, body } : null, truncated: false };
  }
  const o = t.match(DOC_OPEN_RE);
  if (o) return { text: t.replace(o[0], '').trim(), doc: null, truncated: true };
  return { text: t, doc: null, truncated: false };
}

/** A file name from a title: the same characters a browser upload keeps, at most sixty of them. */
export function safeDocName(title) {
  return String(title || '').replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || DOC_DEFAULT_TITLE;
}

/** The document as a PDF in the case's report folder, with its token, so the link and the Uploads row open it like any upload. Returns the descriptor. */
export async function fileDocument(env, caseId, doc, { now = Date.now() } = {}) {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TRADE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const bytes = textPdf(String(doc.body || '').split('\n'), {
    title: doc.title,
    footer: `${DESK_NAME} · ${dateKey} · Ideas, not orders. Every trade is your decision.`,
  });
  const put = await putFile(env, `cases/${caseId}/report/${now}-${safeDocName(doc.title)}.pdf`, bytes, 'application/pdf');
  // Not swallowed: a file without its token is an unreadable link.
  const token = crypto.randomUUID();
  await patchObjectMeta(env, put.path, { firebaseStorageDownloadTokens: token, paName: `${safeDocName(doc.title)}.pdf` });
  return {
    name: put.name || `${safeDocName(doc.title)}.pdf`,
    path: put.path,
    size: put.size || bytes.byteLength,
    at: new Date(now),
    url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(put.path)}?alt=media&token=${token}`,
  };
}
