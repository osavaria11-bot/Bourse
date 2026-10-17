# SAVY financial portal

The existing static site and GitHub Pages workflows are retained. `portal.js` moves the original live components into six compact pages and a complete dashboard. It never clones a financial chart or changes a stored position. `portal.css` supplies the compact dark/light presentation without a framework, CDN or new production dependency.

## Navigation

| Section | Views |
| --- | --- |
| Accueil | Market summary, three sourced headlines, CNN sentiment and history, latest reports, macro readings; full news and audio in a secondary view |
| Marchés | Six market charts, all economic series, policy odds and sovereign curves, original resources |
| Portefeuilles | All three existing portfolios; overview, positions, allocation heatmap and exposures, contributions/risk/movers, earnings, transaction availability |
| Recherche | Current Finviz selection, strategy rules and data availability, published PDF archives |
| Immobilier | Current briefing, opportunities and published PDF archives |
| Polymarket | Three Finance and five popular political markets with their live collection and cache behavior |
| Dashboard complet | Rightmost navigation item; all original components on one page, all six market charts, every filtered macro chart and all portfolio panels |

The complete dashboard moves the same live component nodes into its page and restores their exact original positions on exit. No duplicated IDs, separate quotes or extra timers. Period changes and refreshes retain the complete chart grid; returning to a compact section restores its selected chart and comparison setting. Portfolio visibility controls and empty-data gating are preserved. Direct dashboard bookmarks and personal access fragments work together.

Routes use `#view=…&tab=…`. Old `#portfolio`, `#indicators`, `#yieldCurves`, `#weeklyReports`, `#fearGreed` and `#polymarket` bookmarks still work. Browser back/forward and refresh preserve the selected page. Cmd/Ctrl+K opens economic search. Desktop navigation stays at the top; mobile navigation stays at the bottom, including the safe area.

Personal access keys remain exclusively in URL fragments and existing local storage. Navigation preserves the key and selected portfolio. Profile refresh retains the current page instead of resetting it. Personal Home Screen manifest and export formats are unchanged. Import fragments are removed after import, as before.

## Charts and data

Indices and economic series default to one selected chart. The economic comparison view paginates six charts at a time; all filtered series remain available. Existing favorites, filters, sorting, CSV exports, source links, pointer/keyboard chart readings and refresh handlers are preserved. An expanded market/portfolio view moves the actual component into a native dialog and restores it on close, retaining live controls and updates.

Six-month and two-year market ranges and one-day/one-year/two-year/five-year portfolio choices use the existing period calculations. One-day portfolio comparisons use one completed session. Insufficient history still yields unavailable returns; no backfilled prices or invented performance. Macro short ranges use calendar dates anchored to the latest observation, with a visible insufficient-data state where necessary.

VIX and US 10-year headline quotes retain their existing Yahoo mappings (`^VIX`, `^TNX`); FRED histories remain distinct and labelled. FEQT retains `FEQT.NE` in CAD and the validated five-minute session history. Deployment refreshes quotes; the source-controlled snapshot can be older than the published snapshot.

## Reports and unavailable records

`data/weekly-reports.json` remains the report source. The two report kinds are displayed on their respective pages; detailed stock scenarios are expandable and the complete PDFs remain accessible. `scripts/build_report_archive.cjs` enumerates only dated PDFs actually present under `reports/stocks` and `reports/real-estate`. Both existing publishing paths rebuild this manifest, so future report files appear without editing the interface.

The current project has no dated transaction ledger or strategy-return ledger. These views explicitly report unavailable history; current holdings, costs, reconstructed performance and reports are retained. Strategy allocation rules are descriptive only, not synthetic performance. A report containing fewer than five admissible stocks keeps its actual count.

## Validation

Run `npm test`, Python collector tests and `npm run test:browser`. `PORTAL_WEBKIT=1` additionally runs the portal suite in WebKit for iPhone layouts; GitHub validation installs and runs both Chromium and WebKit. Existing component suites reach controls through real portal links using `tests/portal-navigation.cjs`. The independent `portal-browser.cjs` suite does not use that helper and checks routing, first-screen desktop content, all sections, all mobile subviews, expansion, archives, private fragments and no horizontal overflow at 375/320 px. All portfolio test positions and keys are synthetic.
