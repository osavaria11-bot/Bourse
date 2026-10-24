"use strict";
// Enumerate only PDFs actually present in the repository. Both publishing paths rebuild this list.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, ".."), documents = [];
for (const [folder, kind] of [["stocks", "stocks"], ["real-estate", "real_estate"]]) {
  for (const name of fs.readdirSync(path.join(root, "reports", folder))) {
    if (!/^\d{4}-\d{2}-\d{2}\.pdf$/.test(name)) continue;
    const relative = "reports/" + folder + "/" + name, file = path.join(root, relative);
    if (!fs.statSync(file).isFile()) continue;
    documents.push({kind, date: name.slice(0, 10), path: relative});
  }
}
documents.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
fs.writeFileSync(path.join(root, "data/report-archive.json"), JSON.stringify({schema_version: 1, documents}, null, 2) + "\n");
console.log("Published report archive:", documents.length, "documents");
// The full and quote-only publishers both run this packaging step. Render the
// financial report from the same source so a quote refresh cannot restore an
// older ranking from the committed HTML. Calculators and schedules are unchanged.
require("./build_monthly_fnb.cjs");
