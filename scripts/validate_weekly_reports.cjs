"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const W = require("../js/weekly-reports-utils.js");
const root = path.resolve(__dirname, "..");
const raw = JSON.parse(fs.readFileSync(path.join(root, "data/weekly-reports.json"), "utf8"));
const data = W.normalize(raw);
for (const kind of W.KINDS) {
  const report = data.reports[kind];
  if (!report) throw new Error("Invalid or missing weekly report: " + kind);
  const bytes = fs.readFileSync(path.join(root, report.document.path));
  if (bytes.subarray(0, 5).toString() !== "%PDF-" || bytes.length !== report.document.size_bytes ||
      crypto.createHash("sha256").update(bytes).digest("hex") !== report.document.sha256) throw new Error("PDF does not match its dated edition: " + kind);
  console.log(kind + ": " + report.edition_date + " · " + report.document.pages + " pages · verified PDF" +
    (kind === "stocks" ? " · " + report.stocks.length + " candidates" : ""));
}
