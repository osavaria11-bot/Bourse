"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), R = require("../js/portal-utils.js"), P = require("../js/portfolio-utils.js"), U = require("../js/macro-utils.js");
test("Old bookmarks and private fragments open the correct section; invalid tabs fall back safely", () => {
  assert.deepEqual(R.route("#indicators"), {page: "marches", tab: "economy"});
  assert.deepEqual(R.route("#yieldCurves"), {page: "marches", tab: "rates"});
  for (const fragment of ["#portfolio", "#portfolio=2", "#positions=synthetic", "#portfolio-key=synthetic"]) assert.equal(R.route(fragment).page, "portefeuilles");
  assert.deepEqual(R.route("#view=marches&tab=unknown"), {page: "marches", tab: "indices"});
  assert.deepEqual(R.route("#view=dashboard&tab=overview"), {page: "dashboard", tab: "overview"});
  assert.deepEqual(R.route("#dashboard"), {page: "dashboard", tab: "overview"});
  assert.deepEqual(R.route("#view=recherche&tab=strategies"), {page:"recherche",tab:"latest"});
  assert.deepEqual(R.route("#view=toString&tab=__proto__"), {page: "accueil", tab: "overview"});
});
test("Navigation and profile refresh keep private access in the fragment and preserve the route", () => {
  const initial = "https://example.test/Bourse/?v=1#portfolio-key=synthetic-test-key&portfolio=2";
  const next = new URL(R.address(initial, "recherche", "archives"));
  assert.equal(next.search, "?v=1"); assert.equal(next.pathname, "/Bourse/");
  assert.equal(new URLSearchParams(next.hash.slice(1)).get("portfolio-key"), "synthetic-test-key");
  assert.deepEqual(R.route(next.hash), {page: "recherche", tab: "archives"});
  const refreshed = new URL(R.preserveRoute(initial, next.href));
  assert.equal(refreshed.href, next.href);
  assert.equal(new URLSearchParams(refreshed.hash.slice(1)).get("portfolio"), "2");
  const dashboard = R.address(refreshed.href, "dashboard", "overview");
  assert.equal(new URLSearchParams(new URL(dashboard).hash.slice(1)).get("portfolio-key"), "synthetic-test-key");
  assert.equal(R.preserveRoute(initial, dashboard), dashboard);
});
test("Archives accept only dated local report PDFs, sort them and reject duplicates and unsafe paths", () => {
  const valid = {kind: "stocks", date: "2026-10-14", path: "reports/stocks/2026-10-14.pdf"};
  const payload = {schema_version: 1, documents: [valid, valid, {...valid, path: "https://evil.test/report.pdf"}, {...valid, date: "2026-02-30", path: "reports/stocks/2026-02-30.pdf"}, {kind: "real_estate", date: "2026-10-12", path: "reports/real-estate/2026-10-12.pdf"}]};
  assert.deepEqual(R.archiveEntries(payload, "stocks"), [valid]);
  assert.deepEqual(R.archiveEntries(null, "stocks"), []);
});
test("Added periods use existing dated histories and do not invent a long performance for recent listings", () => {
  const history = [["2026-10-14", 100], ["2026-10-15", 110], ["2026-10-16", 121]];
  const day = P.period(history, "1D"); assert.equal(day.start, "2026-10-15"); assert.ok(Math.abs(day.percent - 10) < 1e-10);
  assert.equal(P.period(history, "5Y").percent, null);
  assert.equal(P.period(history.slice(-1), "1D").percent, null);
  assert.equal(U.rangeStart("2026-10-16", "1W"), "2026-10-09");
  assert.equal(U.rangeStart("2026-10-16", "YTD"), "2026-01-01");
});
