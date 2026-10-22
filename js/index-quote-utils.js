(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IndexQuoteUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const definitions = [
    {id: "IXIC", symbol: "^COMPX:US", canonical: "^IXIC", currency: "USD", type: "index"},
    {id: "TSX", symbol: "^TSX", canonical: "^GSPTSE", currency: "CAD", type: "index"},
    {id: "EEM", symbol: "EEM:US", canonical: "EEM", currency: "USD", type: "etf"},
    {id: "FEQT", symbol: "FEQT:CC", canonical: "FEQT.NE", currency: "CAD", type: "etf"}
  ];
  const positive = n => typeof n === "number" && Number.isFinite(n) && n > 0;
  function request(now = Date.now()) {
    const from = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    return {query: "query {" + definitions.map(d =>
      `q${d.id}:getQuoteBySymbol(symbol:"${d.symbol}"){symbol currency datatype prevClose} ` +
      `c${d.id}:getChartDataBySymbol(symbol:"${d.symbol}",fromDate:"${from}",interval:5){dateTime close}`).join(" ") + "}"};
  }
  function parse(payload, now = Date.now()) {
    const result = [], localDate = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}), today = localDate.format(now);
    const clock = new Intl.DateTimeFormat("en-GB", {timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(now);
    const weekday = new Intl.DateTimeFormat("en", {timeZone: "America/Toronto", weekday: "short"}).format(now);
    const openHours = !["Sat", "Sun"].includes(weekday) && clock >= "09:30" && clock < "16:00";
    for (const d of definitions) {
      const quote = payload?.data?.["q" + d.id], candles = payload?.data?.["c" + d.id];
      if (quote?.symbol !== d.symbol || quote.currency !== d.currency || quote.datatype !== d.type || !Array.isArray(candles)) continue;
      const points = new Map();
      for (const row of candles) {
        // TMX dates five-minute bars at their opening. Use completed bars only;
        // a response's collection time is never a quote's observation time.
        if (typeof row?.dateTime !== "string" || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/.test(row.dateTime) || !positive(row.close)) continue;
        const start = Date.parse(row.dateTime), time = row.dateTime.slice(11, 16);
        // A trailing last-trade row can sit between bars; it is not a
        // completed five-minute candle and must not be shifted into one.
        if (Number(row.dateTime.slice(14, 16)) % 5 || row.dateTime.slice(17, 19) !== "00") continue;
        const end = time === "16:00" ? start : start + 300000;
        if (!Number.isFinite(start) || end > now || now - end > 7 * 86400000) continue;
        const local = localDate.format(start);
        if (local !== row.dateTime.slice(0, 10) || time < "09:30" || time > "16:00") continue;
        points.set(new Date(end).toISOString(), {price: row.close, day: local, offset: row.dateTime.slice(-6)});
      }
      const sorted = [...points].sort((a, b) => a[0].localeCompare(b[0]));
      if (!sorted.length) continue;
      const [timestamp, last] = sorted.at(-1), session = sorted.filter(([, p]) => p.day === last.day);
      const preceding = sorted.filter(([, p]) => p.day < last.day).at(-1);
      const previous = preceding?.[1].price || (last.day === today && positive(quote.prevClose) ? quote.prevClose : null);
      const start = new Date(last.day + "T09:30:00" + last.offset).toISOString();
      const end = new Date(last.day + "T16:00:00" + last.offset).toISOString();
      result.push({id: d.id, quote_symbol: d.canonical, currency: d.currency, price: last.price, previous_close: previous,
        timestamp, session_date: last.day, exchange_timezone: "America/Toronto", instrument_type: d.type.toUpperCase(),
        market_state: last.day === today && now >= Date.parse(start) && now < Date.parse(end) ? "regular" : "closed",
        session_start: start, session_end: end, provider_delay_minutes: d.symbol.endsWith(":US") ? 15 : null,
        fetched_at: new Date(now).toISOString(), fetch_status: last.day < today && openHours ? "cached" : "fresh", history_interval_minutes: 5,
        intraday_history: session.map(([time, p]) => [time, p.price]), observation_kind: "candle_close",
        source_provider: "tmx", source_symbol: d.symbol, source_label: "TMX Money",
        source_url: "https://money.tmx.com/en/quote/" + encodeURIComponent(d.symbol)});
    }
    return result;
  }
  return {definitions, request, parse};
});
