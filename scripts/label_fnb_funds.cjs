"use strict";
// Presentation metadata only: never modify weights, returns or calculated ratios.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, ".."), file = path.join(root, "reports/portefeuilles-fnb.html");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/fnb-catalog.json"), "utf8"));
let html = fs.readFileSync(file, "utf8");
const pattern = /(<script[^>]*id="analysis"[^>]*>)([\s\S]*?)(<\/script>)/, data = JSON.parse(html.match(pattern)[2]);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const required = new Set([...data.funds, ...data.benchmark_order, ...Object.values(data.results).flatMap(row => Object.keys(row.weights || {}))]);
for (const ticker of required) {
  const fund = catalog.funds[ticker];
  if (!fund?.name || !fund.description || !fund.source_url?.startsWith("https://")) throw Error("Missing fund label: " + ticker);
}
html = html.replace(/<th\b([^>]*\bscope="row"[^>]*)>([\s\S]*?)<\/th>/g, (original, attrs, content) => {
  const ticker = attrs.match(/data-fund="([^"]+)"/)?.[1] || content.trim(), fund = catalog.funds[ticker];
  if (!fund) return original;
  attrs = attrs.replace(/\s*data-fund="[^"]*"/, "");
  return '<th' + attrs + ' data-fund="' + esc(ticker) + '"><span class="fund-ticker">' + esc(ticker) + '</span><a class="fund-name" href="' + esc(fund.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(fund.name) + '</a><span class="fund-description">' + esc(fund.description) + '</span></th>';
});
data.fund_labels = catalog.funds;
html = html.replace(/fnb-dashboard\.(js|css)\?v=[^"']+/g, "fnb-dashboard.$1?v="+(data.optimization?"20261019-monthly":"20261019-task2"));
html = html.replace(pattern, (_, open, body, close) => open + JSON.stringify(data).replace(/</g, "\\u003c") + close);
fs.writeFileSync(file, html);
console.log("Fund names and descriptions:", required.size, "verified funds; financial calculations unchanged.");
