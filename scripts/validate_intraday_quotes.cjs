"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const I = require("../js/intraday-utils.js");
const data = JSON.parse(fs.readFileSync("data/intraday-quotes.json", "utf8"));
const normalized = I.normalize(data);
assert.equal(normalized.quotes.length, data.quotes.length, "Invalid or duplicate intraday quote");
assert.ok(normalized.quotes.length > 0, "Empty quote file");
const catalog = JSON.parse(fs.readFileSync("data/securities.json", "utf8"));
for (const definition of catalog.series) {
  const q = normalized.quotes.find(p => p.id === definition.id);
  if (q) {assert.equal(q.quote_symbol, definition.quote_symbol); assert.equal(q.currency, definition.currency);}
}
console.log("Validated exchange quote snapshots:", normalized.quotes.length);
