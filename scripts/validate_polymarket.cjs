"use strict";
const fs = require("node:fs"), P = require("../js/polymarket-utils.js");
const data = P.normalize(JSON.parse(fs.readFileSync("data/polymarket.json", "utf8")));
console.log("Polymarket snapshot:", P.GROUPS.map(spec => ({group:spec.id, status:data.groups[spec.id].fetch_status,
  fetched:data.groups[spec.id].fetched_at, events:data.groups[spec.id].events.map(row => row.title)})));
