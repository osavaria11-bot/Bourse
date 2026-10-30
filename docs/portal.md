# SAVY financial portal

The existing static site and GitHub Pages workflows are retained. `portal.js` moves the original live components into the compact pages and a complete dashboard. It never clones a financial chart or changes a stored position. `portal.css` supplies the compact dark/light presentation without a framework, CDN or new production dependency.

## Navigation

| Section | Views |
| --- | --- |
| Accueil | Market summary, three sourced headlines, CNN sentiment and history, latest reports, macro readings; full news and audio in a secondary view |
| Marchés | Six market charts, all economic series, policy odds and sovereign curves, original resources, and the September 13, 2026 climate and carbon capture PDF |
| Portefeuilles | All three existing portfolios; overview, positions, allocation heatmap and exposures, contributions/risk/movers, earnings, transaction availability, and the Analyse tab (a dedicated placeholder with no fabricated calculations) |
| Recherche | Finviz research and portfolio tracking together: one Wednesday 22:00 America/Toronto delivery, current selection and simulation rules; published PDF archives |
| Immobilier | Current briefing, opportunities and published PDF archives |
| Polymarket | Three Finance, five popular political markets and two popular events across all topics; ten distinct markets, five columns on desktop and a compact responsive grid |
| Analyse FNB | Interactive comparison of the 11 ETF portfolios, ratios, risk/return compass, investment growth, permanent tracking and a separate efficient-frontier laboratory versus VEQT; existing allocations unchanged |
| Dashboard complet | Rightmost navigation item; all original components on one page, all six market charts, every filtered macro chart and all portfolio panels |

The complete dashboard moves the same live component nodes into its page and restores their exact original positions on exit. No duplicated IDs, separate quotes or extra timers. Period changes and refreshes retain the complete chart grid; returning to a compact section restores its selected market and full-view setting. Portfolio visibility controls and empty-data gating are preserved. Direct dashboard bookmarks and personal access fragments work together.

Routes use `#view=…&tab=…`. Old `#portfolio`, `#indicators`, `#yieldCurves`, `#weeklyReports`, `#fearGreed` and `#polymarket` bookmarks still work. Browser back/forward and refresh preserve the selected page. Cmd/Ctrl+K opens economic search. Desktop navigation stays at the top; mobile navigation stays at the bottom, including the safe area.

The FNB report is available at `#view=analyses&tab=overview` (`FNB` in mobile navigation). Its self-contained file, `reports/portefeuilles-fnb.html`, is loaded once when the tab first opens. Returning to the tab preserves the selections. The full-screen link opens the same report independently. The report follows the same light/dark SAVY palette, including when the parent theme changes; all report selections and calculations are retained.

The seventh report view, `Frontière efficiente`, is a local exploratory laboratory. It calculates in a same-origin worker only on first opening, and reuses the current serialized monthly ETF returns. Weight sliders and frontier dragging recompute immediately without changing the optimizer’s stored recommendation, private portfolios or permanent tracking ledger. It supports a benchmark-relative view and a sampled Sharpe/IR trade-off, a cap per ETF, fund selection and a separate validation period. Its dedicated preferences are isolated in `savy:fnb-frontier:v1:*`. The parent’s content-height observer includes this view, including after worker results and mobile reflows. See `docs/fnb-frontier.md` for formulas and numerical checks.

Personal access keys remain exclusively in URL fragments and existing local storage. Navigation preserves the key and selected portfolio. Profile refresh retains the current page instead of resetting it. Personal Home Screen manifest and export formats are unchanged. Import fragments are removed after import, as before.

## Charts and data

Indices retain one selected chart by default; “Voir tous les indices” displays all six and returns to that selection. The economy page displays all 42 indicators (the original 41 plus NY Fed twelve-month U.S. recession probability) in one compact grid, with no chart subviews or pagination. The recession card dates its monthly history by the input month and labels the forecast month separately; it is not the proprietary MacroMicro global indicator. Category/search/favorite filters remain optional and do not split the page; each new session begins with all categories. Existing favorites, filters, sorting, CSV exports, source links, pointer/keyboard chart readings and refresh handlers are preserved. An expanded market/portfolio view moves the actual component into a native dialog and restores it on close, retaining live controls and updates.

Six-month and two-year market ranges and one-day/one-year/two-year/five-year portfolio choices use the existing period calculations. One-day portfolio comparisons use one completed session. Insufficient history still yields unavailable returns; no backfilled prices or invented performance. Macro short ranges use calendar dates anchored to the latest observation, with a visible insufficient-data state where necessary.

VIX and US 10-year headline quotes retain their existing Yahoo mappings (`^VIX`, `^TNX`); historical series remain distinct and labelled. FRED's nominal/real US 10-year yields and Treasury spreads are completed from dated primary Treasury publications when available sooner. The Canadian policy decision is verified separately from its historical daily observations. The interface distinguishes the check timestamp, actual observation date and a pending current-day curve publication. FEQT retains `FEQT.NE` in CAD and the validated five-minute session history. Deployment refreshes quotes, decision odds, both official yield curves and interest-rate completions in both publication paths; the source-controlled snapshot can be older than the published snapshot.

## Reports and unavailable records

`data/weekly-reports.json` remains the report source. The two report kinds are displayed on their respective pages; detailed stock scenarios are expandable and the complete PDFs remain accessible. `scripts/build_report_archive.cjs` enumerates only dated PDFs actually present under `reports/stocks` and `reports/real-estate`. Both existing publishing paths rebuild this manifest, so future report files appear without editing the interface.

The site does not reconstruct a Finviz transaction/return ledger from allocation rules. Dated A/B/SPY simulation snapshots come from the weekly publisher's existing state and workbook, with their public summary in report highlights and the full comparison in the PDF. No private state file is exposed. Personal portfolio records and the separate permanent FNB ledger retain their own methods and histories. A report containing fewer than five admissible stocks keeps its actual count.

## Validation

Run `npm test`, Python collector tests and `npm run test:browser`. `PORTAL_WEBKIT=1` additionally runs the portal suite in WebKit for iPhone layouts; GitHub validation installs and runs both Chromium and WebKit. Existing component suites reach controls through real portal links using `tests/portal-navigation.cjs`. The independent `portal-browser.cjs` suite does not use that helper and checks routing, first-screen desktop content, all sections, all mobile subviews, expansion, archives, private fragments and no horizontal overflow at 375/320 px. All portfolio test positions and keys are synthetic.

Yield-curve presets follow the latest available publication by default. The common requested B date uses the newest country; each country shows its own actual observation date without filling missing maturities. Changing A/B or swapping fixes the dates for historical comparisons. “Suivre les dernières publications” restores automatic updates and the chosen preset; this mode is persisted independently from the date pair. Cached decision odds retain their source dates and expire through the existing validation rules.

Natural narration uses `fr-CA-AntoineNeural`. The voice participates in the content-addressed audio/cache key; the player rejects former voice manifests. Device fallback prioritizes known male French voices while retaining the existing play/pause/seek/speed controls.

## Research presentation

`Recherche & suivi` combines the former selection and strategies subviews. Legacy `tab=strategies` bookmarks resolve to the shared section. The user combined research and tracking into one existing task, every Wednesday at 22:00 America/Toronto. The interface shows that local schedule for both parts; it does not convert 22:00 UTC or advertise a separate Thursday task. Thursday closing prices remain the simulated execution rule, distinct from the Wednesday report and valuation time. The publisher includes dated A/B/SPY results in the stock report summary/highlights and full PDF. A separate compact tracking table reads `data/research-performance.json`: USD NAV history only, with cumulative/period returns and matched SPY differences computed from these values. Its valuation date is independent of the research edition date. The request of 20 October explicitly excludes this research and tracking from both the written and audio morning briefing. The shared publication contract is `docs/weekly-reports.md`; no additional task, private task ID, Library ID or simulation-state file is published. The existing PDF/data path remains `data/weekly-reports.json` and `reports/stocks/`.

The embedded FNB report uses the parent page for vertical scrolling. Its frame has no visible border and a content-driven height that grows and shrinks after view, data or viewport changes. The same SAVY theme remains synchronized. On phones all six FNB views fit a two-row navigation, comparison tables retain only necessary horizontal scrolling, and internal comparison/preference panels do not add a second set of margins. Standalone and frozen reports retain their data and controls.

`data/fnb-catalog.json` supplies the verified issuer fund name, a two-word French description and its source link for every FNB and comparator. `scripts/label_fnb_funds.cjs` enriches the individual cards, complete card grid, comparator rows and source table. The overview rebuild calls the helper so later report refreshes retain those labels. Financial results and holdings are unchanged.

The new Polymarket `trending` group selects two additional open events across all topics by 24-hour volume, excluding IDs already used by Finance and Politics. Older eight-market snapshots remain usable, with the extra cards marked unavailable until a valid collection arrives. Existing refresh workflows collect the expanded snapshot without an additional schedule.


## Revue privée des trois portefeuilles — onglet Analyse

L'onglet `Portefeuilles → Analyse` reprend la hiérarchie visuelle du briefing immobilier : dernière édition, synthèse, trois cartes OS/FEQT, JMC/VBAL, MCL/VGRO, puis archives des éditions. Les raccourcis vers Positions, Allocations, Performance & risque et Résultats ouvrent les données déjà disponibles, sans calcul supplémentaire ni exposition du portefeuille sélectionné.

La tâche ChatGPT dédiée demeure indépendante, programmée le **mardi à 2 h, fuseau America/Toronto**. Elle livre un briefing dans ChatGPT; **aucun mécanisme sécurisé de synchronisation automatique depuis ChatGPT vers cette page statique n'est actuellement connecté**.

L'utilisateur peut copier le texte de sa revue dans le formulaire de l'onglet, choisir sa date et le conserver dans `localStorage`, clé `savy:portfolio-private-briefings:v1`. Les archives et la dernière édition sont construites depuis cet appareil seulement (12 éditions récentes, texte limité à 30 000 caractères); il n'y a ni API d'envoi ni synchronisation de navigateur à navigateur. Les données sont affichées uniquement avec `textContent`, sans interprétation HTML. Les scripts du site ne doivent jamais publier les rapports privés ou les clés AES-GCM dans le dépôt public, ni prétendre déchiffrer les fichiers `data/personal-portfolio*.json` en l'absence d'une clé autorisée.
