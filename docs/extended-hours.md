# Pre-market and after-hours percentages

The ordinary quotes, charts, daily closing histories and recorded account
performance stay on regular-session data. Extended observations are separate
fields on the independent five-minute feed; no additional chart is drawn.

Yahoo's five-day, five-minute chart with `includePrePost=true` supplies completed
extended-session candle closes and dated trading-session boundaries. Each
percentage uses its own actual preceding regular close: the previous session
for pre-market, the same session for after-hours. The regular quote's official
last price / previous close take precedence over five-minute reference candles
when the metadata identifies the exact session. Missing data never become zero.

Cash indices do not publish ordinary official pre/post index levels. The extra
lines are explicitly approximate ETF reference returns: SPY for the S&P 500,
QQQ (Nasdaq 100, distinct from the Composite), EWC (Canadian equities, distinct
from the S&P/TSX), and IEUR (European equities, distinct from the STOXX 600).
The currency/listing are checked. EEM and FEQT use their own listings when the
provider publishes extended data. The date, retained status and reference ETF
are visible; the tooltip describes the source and exact comparison.

For each private account, current quantities remain in the browser. Positions
are valued against a single common closing date. Extended prices apply only to
holdings with a quote from the selected session; other holdings retain their
actual regular closing mark. The result is a portfolio-weighted indicative
impact, not a return renormalized over the covered subset. Coverage is displayed
when partial. Dated USD/CAD observations at/before both valuation instants supply
the CAD conversion; no later FX observation or missing reference mark can create
a percentage. No covered position, missing FX or missing baseline produces `—`.

The last dated values survive provider/network outages without advancing their
observation or collection times. An extended-hours provider failure preserves
the regular quote and cannot stop its collection. Tests cover reference closes,
finished candles, listing/currency checks, FX timing, weighted private-account
percentages, partial coverage, independent observation merging and responsive UI.

Source context: Yahoo Finance chart settings support extended-hours display:
https://ca.help.yahoo.com/kb/interactive-charts-sln26786.html
Cash index calculation outside regular hours differs from trading index funds:
https://www.schwab.com/stocks/extended-hours-trading
