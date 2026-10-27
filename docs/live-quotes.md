# Independent intraday feed

`Intraday quotes` collects Yahoo exchange observations every five minutes and
publishes only `intraday-quotes.json` on the `savy-live-quotes` branch. The browser
reads that public file directly from `raw.githubusercontent.com`, with a dated
Pages snapshot and direct TMX observations as fallbacks. Provider timestamps,
currency/listing checks, cached observations and daily closing histories retain
their existing meaning. No private positions enter this feed.

Quote collection runs its focused Python and JavaScript checks before publishing.
It never deploys Pages, waits for a full-site validation, or changes `main`. Failed
collections retain the last successful file and queue a retry. Main changes and
cancelled site builds cannot stop the next collection. Cron and build completion
are additional recovery triggers; a single queued successor prevents multiplying
the refresh chain. Weekend self-dispatch stops; weekday cron restarts it.

The branch uses normal fast-forward commits. Publication refuses an older or
invalid collection; consumers also merge by each observation's timestamp so a
stale Pages edition cannot replace a newer live price. Raw GitHub permits browser
CORS access; this uses the existing repository without an additional service.

To diagnose delays, compare the independent file's `generated_at`, each quote's
`timestamp` and `fetched_at`, and the `Intraday quotes` run. A recent collection
does not imply a recent trade for an illiquid or provider-delayed instrument.
The existing UI marks retained/stale observations rather than relabelling them.
