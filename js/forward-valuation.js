(() => {
  "use strict";
  const F = window.SavyForwardUtils;
  const host = document.getElementById("panel-recherche-forward");
  if (!host || !F) return;
  const NS = "http://www.w3.org/2000/svg", KEY = "savy_forward_internal_view_v1";
  const names = {pe: "P/E forward", ev_ebitda: "EV/EBITDA forward"};
  const statusNames = {low: "Sous Q1 · zone basse", central: "Entre Q1 et Q3", high: "Au-dessus de Q3", insufficient: "Historique insuffisant", unavailable: "Multiple N/D"};
  const state = {id: "NVDA", horizon: 1, range: "2Y", view: "lists", confirm5y: false, imports: {}};
  let dataset, instruments, charts, summary, note, select, stockControl, horizonControl, rangeControl, horizonButtons, rangeButtons, viewButtons, rankings, auditView, refreshNotice, lastWidth = 0;
  const number = (n, digits = 2) => Number.isFinite(n) ? new Intl.NumberFormat("fr-CA", {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(n) : "N/D";
  const multiple = n => F.positive(n) ? number(n) + "×" : "N/D";
  const date = value => value ? new Intl.DateTimeFormat("fr-CA", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}).format(new Date(value + "T12:00:00Z")) : "N/D";
  function el(tag, className = "", text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function svg(tag, attributes = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text; return node;
  }
  function sourceLink(url, text) {
    const node = el("a", "", text);
    if (/^https:\/\/[a-z0-9.-]+\//i.test(url)) {node.href = url; node.target = "_blank"; node.rel = "noopener noreferrer";}
    return node;
  }
  function remember() {
    try {localStorage.setItem(KEY, JSON.stringify({id: state.id, horizon: state.horizon, range: state.range, view: state.view, confirm5y: state.confirm5y}));} catch (_) { /* Optional local preference. */ }
  }
  function choose(key, value) {state[key] = value; remember(); render();}
  function segment(label, options, key, className = "") {
    const group = el("div", className), title = el("span", "forward-control-label", label);
    const controls = el("div", "forward-segment"); controls.setAttribute("role", "group"); controls.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const button = el("button", "", text); button.type = "button"; button.dataset.value = value;
      button.setAttribute("aria-pressed", String(state[key] === value));
      button.addEventListener("click", () => choose(key, value)); controls.append(button);
    }
    group.append(title, controls); return {group, buttons: [...controls.children]};
  }
  function selected() {return instruments.get(state.id);}
  function model(key, horizon = state.horizon) {return F.metric(selected(), key, horizon, state.range, state.imports[state.id]);}
  function setup() {
    host.replaceChildren();
    const app = el("section", "forward-app"); app.setAttribute("aria-labelledby", "forwardTitle");
    const heading = el("div", "forward-heading"), title = el("div");
    title.append(el("p", "forward-eyebrow", "Recherche · Actions individuelles"));
    const h2 = el("h2", "", "Valorisation forward"); h2.id = "forwardTitle";
    title.append(h2, el("p", "", "Les multiples dans leur historique."));
    heading.append(title, el("span", "forward-internal", "FY1 / FY2")); app.append(heading);
    refreshNotice = el("div", "forward-refresh-notice"); refreshNotice.setAttribute("role", "status"); app.append(refreshNotice);
    const controls = el("div", "forward-controls"), stock = el("div", "forward-stock-control");
    const view = segment("AFFICHAGE", [["lists", "Listes"], ["charts", "Graphiques"], ["audit", "Vérification · 5 titres"]], "view");
    viewButtons = view.buttons; stockControl = stock;
    const label = el("label", "", "ACTION"); label.htmlFor = "forwardStock";
    select = el("select"); select.id = "forwardStock";
    for (const item of [...instruments.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const option = el("option", "", item.id + " — " + item.title); option.value = item.id; select.append(option);
    }
    select.value = state.id; select.addEventListener("change", () => choose("id", select.value)); stock.append(label, select);
    const horizon = segment("HORIZON DES PRÉVISIONS", [[1, "1 an · FY1"], [2, "2 ans · FY2"]], "horizon");
    const range = segment("HISTORIQUE AFFICHÉ", [["1Y", "1 an"], ["2Y", "2 ans"], ["5Y", "5 ans"], ["MAX", "Max."]], "range", "forward-range-control");
    horizonControl = horizon.group; rangeControl = range.group;
    horizonButtons = horizon.buttons; rangeButtons = range.buttons; controls.append(view.group, stock, horizon.group, range.group); app.append(controls);
    summary = el("div", "forward-summary"); summary.setAttribute("aria-label", "Les quatre multiples forward"); app.append(summary);
    note = el("p", "forward-selection-note"); note.setAttribute("aria-live", "polite"); app.append(note);
    charts = el("div", "forward-charts"); app.append(charts);
    rankings = el("section", "forward-rankings"); rankings.setAttribute("aria-label", "Actions au-dessus de Q3 ou sous Q1 pour les quatre ratios"); app.append(rankings);
    auditView = el("section", "forward-audit"); auditView.setAttribute("aria-label", "Vérification de cinq actions au 2 novembre 2026"); app.append(auditView);
    const details = el("details", "forward-method"); details.append(el("summary", "", "Sources, méthode et import d’un historique"));
    details.append(el("p", "", "1 an (FY1) = premier exercice dont la fin est à venir. 2 ans (FY2) = deuxième exercice à venir. Les calendriers fiscaux de NVDA, MDA, MU, AAPL et RY ont été vérifiés ; les autres dates restent celles des fournisseurs et peuvent désigner une fin de mois approximative. Ces horizons ne sont pas des périodes glissantes de 12 ou 24 mois. Le choix « Historique affiché » règle séparément la période des graphiques."));
    details.append(el("p", "", "Les repères portent uniquement sur les observations positives de la fenêtre affichée : moyenne arithmétique, médiane et quartiles Q1 (25 %) et Q3 (75 %), avec interpolation linéaire entre rangs. Au moins 12 relevés mensuels ou importés, ou 30 relevés quotidiens SAVY, sont nécessaires. Les lacunes restent visibles. Un niveau sous Q1 décrit un multiple historiquement bas, sans constituer une recommandation d’achat."));
    details.append(el("p", "", "Les listes comparent chaque action à ses propres quartiles, sur l’historique choisi. Vert : multiple strictement supérieur à Q3. Rouge : multiple strictement inférieur à Q1. Les titres entre les deux lignes, ceux dont le dernier multiple manque et ceux sans historique suffisant ne sont pas placés dans ces listes. Cliquer sur un titre ouvre son graphique au même horizon. Les listes sont alphabétiques et restent distinctes pour chacun des quatre ratios."));
    details.append(el("p", "", "Le P/E mensuel provient des consensus datés du classeur SAVY du 29 octobre 2026. Il reste distinct des relevés quotidiens MarketScreener : aucune série n’est raccordée et aucun ancien cours n’est divisé par les prévisions d’aujourd’hui. Les historiques génériques dont l’horizon est inconnu ne sont pas utilisés. EV/EBITDA est N/D pour les sociétés financières. Les dates du cours, du consensus et du bilan restent celles des sources."));
    details.append(el("p", "", "Les historiques P/E et les listes s’arrêtent au 28–29 octobre 2026. Le graphique EV/EBITDA annuel reprend le tableau MarketScreener : exercices réalisés, puis prévisions FY1/FY2 en pointillés. Les EV prévisionnelles du fournisseur intègrent sa dette et sa trésorerie projetées ; elles diffèrent des cartes calculées à EV actuelle. Cette courbe annuelle ne constitue pas un historique des multiples forward observés à chaque date et ne sert pas aux quartiles. La croissance de l’EBITDA compare deux exercices consécutifs de cette même source ; une base nulle, négative ou manquante donne N/D. Une base encore estimée est signalée."));
    details.append(el("p", "", "Le refresh du briefing du matin met à jour les cartes de multiples récents dans Graphiques. Il réutilise les clôtures SAVY dans la même devise et la même cotation que les prévisions. Une prévision conservée garde sa date ; un échec ne rajeunit pas les anciennes données. Les relevés matinaux sont conservés séparément, sans modifier les clôtures historiques ou les quartiles DoltHub. Les listes historiques ne deviennent pas un classement actuel par simple changement de cours ou de fournisseur."));
    const format = el("p"); format.append(el("strong", "", "Format CSV : "), el("code", "", "date,ticker,pe_fy1,pe_fy2,ev_ebitda_fy1,ev_ebitda_fy2"), document.createTextNode(". Dates AAAA-MM-JJ, multiples positifs, cellules vides pour N/D. Les données d’import doivent utiliser la même définition fiscale à chaque date.")); details.append(format);
    const importer = el("div", "forward-import"), input = el("input"); input.type = "file"; input.accept = ".csv,text/csv"; input.id = "forwardImport"; input.setAttribute("aria-label", "Importer un historique CSV FY1/FY2");
    const clear = el("button", "", "Effacer l’import"); clear.type = "button";
    const template = el("button", "", "Modèle CSV"); template.type = "button";
    const message = el("p", "forward-import-status"); message.setAttribute("role", "status");
    input.addEventListener("change", async () => {
      const file = input.files[0]; if (!file) return;
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error("Le fichier dépasse 10 Mo.");
        const imported = F.parseImport(await file.text(), [...instruments.values()]);
        state.imports = imported; if (!imported[state.id]) state.id = Object.keys(imported)[0];
        message.textContent = Object.values(imported).reduce((sum, rows) => sum + rows.length, 0) + " relevés importés dans cette session. Aucune donnée envoyée."; remember(); render();
      } catch (error) {message.textContent = "Import refusé : " + error.message;}
    });
    clear.addEventListener("click", () => {state.imports = {}; input.value = ""; message.textContent = "Import effacé. Sources d’origine rétablies."; render();});
    template.addEventListener("click", () => {
      const blob = new Blob(["\uFEFFdate,ticker,pe_fy1,pe_fy2,ev_ebitda_fy1,ev_ebitda_fy2\n"], {type: "text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob), anchor = el("a"); anchor.href = url; anchor.download = "SAVY_Historique_Forward_Modele.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    importer.append(input, template, clear); details.append(importer, message); app.append(details); host.append(app);
    if (window.ResizeObserver) new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width > 0 && Math.abs(width - lastWidth) > 4) {lastWidth = width; requestAnimationFrame(renderCharts);}
    }).observe(app);
  }
  function render() {
    if (!selected()) return;
    refreshNotice.replaceChildren();
    refreshNotice.hidden = !dataset.refresh;
    if (dataset.refresh) {
      const r = dataset.refresh, c = r.counts;
      const timestamp = new Intl.DateTimeFormat("fr-CA", {dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto"}).format(new Date(r.checked_at));
      refreshNotice.append(el("strong", "", "Actualisation · briefing du matin"), el("p", "", "Dernier contrôle : " + timestamp + " (Montréal). " + c.collected + " prévisions relues · " + c.reused + " relevés réutilisés · " + (c.cached + c.retained) + " données conservées après échec · " + c.unavailable + " relevés de multiples récents indisponibles."),
        el("p", "", "Les cartes montrent les multiples récents. Le graphique EV/EBITDA annuel et les historiques P/E gardent leurs propres sources et dates."));
      if (r.annual_coverage) refreshNotice.append(el("p", "", "EV/EBITDA annuel · " + r.annual_coverage.available + " / " + r.annual_coverage.eligible + " titres non financiers disponibles, avec prévisions et croissance de l’EBITDA selon la couverture de la source."));
      const problems = r.results.filter(item => item.error);
      if (problems.length) {
        const details = el("details"); details.append(el("summary", "", "Détails des sources à reprendre (" + problems.length + ")"));
        for (const item of problems) details.append(el("p", "", item.id + " : " + item.error));
        refreshNotice.append(details);
      }
    }
    select.value = state.id;
    const lists = state.view === "lists", audit = state.view === "audit";
    for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.value === state.view));
    stockControl.hidden = lists || audit; horizonControl.hidden = lists || audit; rangeControl.hidden = audit;
    summary.hidden = lists || audit; note.hidden = lists || audit; charts.hidden = lists || audit; rankings.hidden = !lists; auditView.hidden = !audit;
    for (const button of horizonButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.value) === state.horizon));
    for (const button of rangeButtons) button.setAttribute("aria-pressed", String(button.dataset.value === state.range));
    summary.replaceChildren();
    for (const key of F.METRICS) for (const horizon of [1, 2]) {
      const m = model(key, horizon), card = el("article", "forward-summary-card" + (horizon === state.horizon ? " is-selected" : ""));
      const imported = state.imports[state.id]?.some(row => F.positive(row[key + "_fy" + horizon]));
      const current = !imported ? F.currentMetric(selected(), key, horizon) : null, latest = current || m.latest;
      card.dataset.metric = key; card.dataset.horizon = horizon;
      card.append(el("h3", "", (key === "pe" ? "P/E" : "EV/EBITDA") + " · " + horizon + " an" + (horizon === 2 ? "s" : "")), el("strong", "", multiple(latest?.value)));
      card.append(el("p", "", m.reason === "financial" ? "Non pertinent · société financière" : m.reason === "ev_bridge_unreconciled" ? "EV suspendue · bilan à rapprocher" : latest?.period_end ? (selected().fiscal_calendar ? "Exercice au " : "Repère fiscal fournisseur · ") + date(latest.period_end) : "Prévision indisponible"));
      if (current) {
        card.append(el("p", "", "Cours : " + date(current.price_date) + " · Prévisions : " + date(current.consensus_date)));
        if (["cached", "retained"].includes(current.status)) card.append(el("p", "forward-current-warning", "Dernières données valides · source à reprendre"));
        if (key === "ev_ebitda" && F.positive(current.value)) card.append(el("p", "", "EV indicative · pont de bilan annuel"));
      } else if (dataset.refresh && !imported) card.append(el("p", "forward-current-warning", "Refresh indisponible · relevé archivé du " + date(m.latest?.date)));
      summary.append(card);
    }
    note.replaceChildren(el("strong", "", selected().title + " · FY" + state.horizon), document.createTextNode(" — EV/EBITDA annuel : réalisé et prévisions. P/E : historique forward avec moyenne et quartiles. Chaque graphique conserve sa définition et ses dates."));
    if (lists) renderRankings(); else if (audit) renderAudit(); else renderCharts();
  }
  function renderCharts() {
    if (!charts || !selected() || state.view !== "charts") return;
    charts.replaceChildren();
    const importedEv = state.imports[state.id]?.some(row => F.positive(row["ev_ebitda_fy" + state.horizon]));
    charts.append(importedEv || selected().financial ? panel(model("ev_ebitda")) : annualPanel(), panel(model("pe")));
  }
  function renderRankings() {
    rankings.replaceChildren();
    const heading = el("div", "forward-ranking-intro"), title = el("h3", "", "Les actions hors des quartiles");
    const period = {"1Y": "1 an", "2Y": "2 ans", "5Y": "5 ans", MAX: "toute la série disponible"}[state.range];
    heading.append(title, el("p", "", "Historique : " + period + ". Chaque titre est comparé à ses propres lignes Q1 et Q3. Cliquer sur un titre pour voir sa courbe."));
    heading.append(el("p", "forward-ranking-date", Object.keys(state.imports).length ? "Imports personnels et archives conservées : les dates figurent sur chaque titre." : "Relevés conservés des 28–29 octobre 2026. Ce classement ne décrit pas les cours d’aujourd’hui."));
    rankings.append(heading);
    renderCommonLow();
    const grid = el("div", "forward-ranking-grid");
    for (const key of F.METRICS) for (const horizon of [1, 2]) {
      const result = F.rankedLists([...instruments.values()], key, horizon, state.range, state.imports);
      const card = el("article", "forward-ranking-card"); card.dataset.metric = key; card.dataset.horizon = horizon;
      const cardHeading = el("div", "forward-ranking-heading");
      cardHeading.append(el("h4", "", names[key] + " · " + horizon + " an" + (horizon === 2 ? "s" : "") + " (FY" + horizon + ")"),
        el("span", "forward-ranking-coverage", result.eligible + " / " + result.total + " classables"));
      card.append(cardHeading);
      if (!result.eligible) {
        const empty = el("div", "forward-ranking-empty");
        empty.append(el("strong", "", "Classement indisponible"), el("p", "", "L’historique de ce même ratio et de ce même horizon est insuffisant pour tracer Q1 et Q3. Les multiples disponibles restent consultables dans Graphiques."));
        if (key === "ev_ebitda") {
          const button = el("button", "forward-stock-chip forward-annual-link", "Voir le graphique annuel et la croissance de l’EBITDA"); button.type = "button";
          button.addEventListener("click", () => {state.horizon = horizon; state.view = "charts"; remember(); render(); charts.scrollIntoView({block: "start"});});
          empty.append(button);
        }
        card.append(empty);
      } else {
        const groups = el("div", "forward-ranking-groups");
        for (const side of ["above", "below"]) {
          const group = el("section", "forward-ranking-group is-" + side); group.dataset.side = side;
          const groupHeading = el("h5", "", side === "above" ? "Au-dessus de la ligne verte · Q3" : "Sous la ligne rouge · Q1");
          groupHeading.append(el("span", "forward-ranking-count", String(result[side].length))); group.append(groupHeading);
          const list = el("ul", "forward-stock-list");
          for (const row of result[side]) {
            const item = el("li"), button = el("button", "forward-stock-chip", row.id);
            button.type = "button"; button.dataset.stock = row.id;
            const description = row.title + " (" + row.id + ") : " + multiple(row.value) + ", " + (side === "above" ? "Q3" : "Q1") + " = " + multiple(row.boundary) + ", relevé du " + date(row.date) + ".";
            button.title = description; button.setAttribute("aria-label", description);
            button.addEventListener("click", () => {state.id = row.id; state.horizon = horizon; state.view = "charts"; remember(); render(); host.scrollIntoView({block: "start"});});
            item.append(button); list.append(item);
          }
          if (!result[side].length) group.append(el("p", "forward-ranking-no-match", "Aucun titre classable dans cette zone."));
          else group.append(list);
          groups.append(group);
        }
        card.append(groups);
      }
      const missing = result.excluded.financial + result.excluded.missing + result.excluded.history;
      const footer = el("p", "forward-ranking-footer", result.central + " entre Q1 et Q3 · " + missing + " non classables");
      const exclusions = [];
      if (result.excluded.history) exclusions.push(result.excluded.history + " sans historique suffisant");
      if (result.excluded.missing) exclusions.push(result.excluded.missing + " sans dernier multiple disponible");
      if (result.excluded.financial) exclusions.push(result.excluded.financial + " sociétés financières (EV/EBITDA non pertinent)");
      if (exclusions.length) footer.append(document.createTextNode(". " + exclusions.join("; ") + "."));
      card.append(footer); grid.append(card);
    }
    rankings.append(grid);
  }
  function openChart(identity, horizon = 1) {
    state.id = identity; state.horizon = horizon; state.view = "charts"; remember(); render(); host.scrollIntoView({block: "start"});
  }
  function renderCommonLow() {
    const all = F.commonLow([...instruments.values()], state.range, state.imports);
    const rows = state.confirm5y ? all.filter(row => row.confirmed5y) : all;
    const block = el("section", "forward-common"), heading = el("div", "forward-common-heading");
    const title = el("h4", "", "P/E sous Q1 à 1 an et à 2 ans");
    title.append(el("span", "forward-ranking-count", String(rows.length)));
    const filter = el("label", "forward-common-filter"), check = el("input");
    check.type = "checkbox"; check.checked = state.confirm5y;
    check.addEventListener("change", () => choose("confirm5y", check.checked));
    filter.append(check, document.createTextNode("Confirmer aussi sur 5 ans")); heading.append(title, filter);
    block.append(heading, el("p", "", "Même relevé et même source aux deux horizons. Parmi ces " + all.length + " titres, " + all.filter(row => row.confirmed5y).length + " sont aussi sous leurs deux Q1 sur 5 ans. Sélection historique à examiner ; les fondamentaux restent à valider."));
    const list = el("ul", "forward-stock-list");
    for (const row of rows) {
      const item = el("li"), button = el("button", "forward-stock-chip", row.id); button.type = "button";
      button.setAttribute("aria-label", row.title + " : P/E FY1 " + multiple(row.fy1.value) + ", FY2 " + multiple(row.fy2.value) + ", sous Q1 au " + date(row.date) + ". Voir le graphique.");
      button.title = row.title + " · " + date(row.date) + (row.confirmed5y ? " · confirmé sur 5 ans" : "");
      button.addEventListener("click", () => openChart(row.id)); item.append(button); list.append(item);
    }
    if (rows.length) block.append(list); else block.append(el("p", "", "Aucun titre ne satisfait ces critères avec les données disponibles."));
    rankings.append(block);
  }
  function renderAudit() {
    auditView.replaceChildren();
    const audit = dataset.audit;
    if (!audit) {auditView.append(el("p", "", "Vérification non disponible.")); return;}
    const intro = el("div", "forward-ranking-intro");
    intro.append(el("h3", "", "Cinq titres vérifiés"), el("p", "", "Cours rapprochés de la clôture du " + date(audit.price_date) + " · Prévisions relevées le " + date(audit.as_of) + "."),
      el("p", "forward-ranking-date", "Cette vérification reste distincte du classement historique. Les dates de révision de chaque analyste ne sont pas fournies."));
    auditView.append(intro);
    const table = el("table", "forward-audit-table"), caption = el("caption", "", "Multiples des deux prochains exercices fiscaux");
    const head = el("thead"), labels = ["Action / cours", "P/E · FY1", "P/E · FY2", "EV/EBITDA · FY1", "EV/EBITDA · FY2"], header = el("tr");
    for (const label of labels) {const th = el("th", "", label); th.scope = "col"; header.append(th);} head.append(header);
    const body = el("tbody");
    for (const result of audit.results) {
      const tr = el("tr"), identity = el("th"), button = el("button", "forward-stock-chip", result.id); identity.scope = "row";
      button.type = "button"; button.setAttribute("aria-label", "Voir le graphique historique de " + result.title); button.addEventListener("click", () => openChart(result.id));
      identity.append(button, el("small", "", number(result.snapshot.price) + " " + result.snapshot.currency)); tr.append(identity);
      for (const [index, key, horizon] of [[1, "pe", 1], [2, "pe", 2], [3, "ev_ebitda", 1], [4, "ev_ebitda", 2]]) {
        const value = F.auditMetric(result, horizon), td = el("td"); td.dataset.label = labels[index];
        td.append(el("strong", "", multiple(value[key])));
        td.append(el("small", "", key === "ev_ebitda" && result.ev_status !== "indicative" ? result.ev_status === "withheld" ? "Suspendu · bilan à rapprocher" : "Non pertinent · banque" : "Exercice au " + date(value.period_end)));
        if (key === "ev_ebitda" && result.ev_status === "indicative") td.append(el("small", "forward-indicative", "Indicatif"));
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(caption, head, body); auditView.append(table);
    const notes = el("div", "forward-audit-notes");
    notes.append(el("p", "", "RY : FY1 devient l’exercice 2027 et FY2 l’exercice 2028. Les prévisions n’ont pas changé à exercice identique depuis le 29 octobre."),
      el("p", "", "MDA : EV/EBITDA suspendu en attendant le rapprochement de la dette nette. NVDA, MU et AAPL : EV indicative, calculée avec le pont de bilan annuel du fournisseur."),
      el("p", "", "Historique EV/EBITDA : les estimations datées FY1/FY2 manquent encore. Les quartiles et listes EV/EBITDA restent indisponibles."));
    auditView.append(notes);
    const details = el("details", "forward-method"); details.append(el("summary", "", "Révisions des prévisions et sources"));
    const pct = value => value === null ? "N/D" : Math.abs(value) < 1e-8 ? "stable" : (value > 0 ? "+" : "") + number(value) + " %";
    for (const result of audit.results) {
      const p = el("p"); p.append(el("strong", "", result.id + " — "));
      p.append(document.createTextNode(result.periods.map(period => "BPA FY" + period.fiscal_year + " : " + pct(period.eps_revision_pct) + " ; EBITDA : " + pct(period.ebitda_revision_pct)).join(". ") + ". Comparaison au " + date(result.previous_observation_date) + ", à exercice identique. "));
      p.append(sourceLink(result.snapshot.source_url, "Prévisions"), document.createTextNode(" · "), sourceLink(result.price_check.source_url, "Cours"), document.createTextNode(" · "), sourceLink(result.calendar.source_url, "Calendrier fiscal"));
      details.append(p);
    }
    details.append(el("p", "", "Les définitions BPA/EBITDA du fournisseur restent à rapprocher des mesures ajustées des sociétés. Les ratios récents ne sont pas raccordés aux courbes DoltHub."));
    const mda = el("p"); mda.append(sourceLink(audit.mda_balance_source_url, "MDA · bilan plus récent")); details.append(mda);
    for (const review of audit.history_review) {const p = el("p"); p.append(sourceLink(review.url, review.source), document.createTextNode(" — " + review.finding)); details.append(p);}
    auditView.append(details);
  }
  function annualPanel() {
    const stock = selected(), m = F.annualEv(stock, state.range), article = el("article", "forward-panel forward-annual-panel"); article.dataset.metric = "ev_ebitda";
    const heading = el("div", "forward-panel-heading"), left = el("div");
    left.append(el("h3", "", "EV/EBITDA annuel · historique et prévisions"), el("p", "", "Exercices fiscaux · réalisé puis FY1 / FY2 estimés"));
    const selectedYear = m.growth.find(item => item.horizon === state.horizon)?.target;
    const current = el("div", "forward-current"); current.append(el("strong", "", multiple(selectedYear?.ev_ebitda)), el("small", "", selectedYear ? "FY" + selectedYear.fiscal_year + " · " + (selectedYear.ev_ebitda_is_estimate ? "estimation" : "réalisé") : "FY" + state.horizon + " · N/D"));
    heading.append(left, current); article.append(heading);
    const growth = el("div", "forward-ebitda-growth"); growth.setAttribute("aria-label", "Croissance annuelle de l’EBITDA");
    for (const horizon of [1, 2]) {
      const item = m.growth.find(row => row.horizon === horizon), card = el("div", "forward-growth-card" + (horizon === state.horizon ? " is-selected" : "")); card.dataset.horizon = horizon;
      const value = item?.value, hasValue = Number.isFinite(value);
      card.append(el("h4", "", "Croissance EBITDA · FY" + horizon), el("strong", hasValue ? value < 0 ? "is-negative" : "is-positive" : "", hasValue ? (value > 0 ? "+" : "") + number(value, 1) + " %" : "N/D"));
      card.append(el("p", "", item?.year ? "FY" + item.year + " / FY" + item.baseYear : "Exercices non disponibles"));
      card.append(el("p", "", hasValue ? "Base " + (item.base.ebitda_is_estimate ? "estimée" : "réalisée") + " → " + (item.target.ebitda_is_estimate ? "prévision" : "réalisé") : item?.reason === "nonpositive_base" ? "Base d’EBITDA nulle ou négative" : "EBITDA manquant pour l’un des exercices")); growth.append(card);
    }
    article.append(growth);
    const legend = el("div", "forward-annual-legend"); legend.append(el("span", "is-actual", "Réalisé"), el("span", "is-estimate", "Prévisions")); article.append(legend);
    const count = m.points.filter(point => F.positive(point[1])).length;
    if (count >= 2) {
      article.append(drawChart(m), el("p", "forward-chart-hint", "Survoler les exercices · flèches gauche / droite au clavier. Prévisions jusqu’à FY2."));
    } else {
      const empty = el("div", "forward-empty"); empty.append(el("strong", "", "Tableau annuel indisponible"), el("p", "", "La source ne fournit pas assez de multiples annuels positifs pour ce titre.")); article.append(empty);
    }
    const source = el("div", "forward-source-line");
    if (m.source) {
      source.append(sourceLink(m.source.source_url, "MarketScreener · tableau annuel"), document.createTextNode(" · Relevé du " + date(m.source.date) + ". Multiples annuels du fournisseur ; EV prévisionnelle avec dette/trésorerie projetées, distincte des cartes à EV actuelle. Aucun quartile forward calculé sur cette courbe."));
      if (stock.annual_status?.status === "retained") source.append(el("p", "forward-current-warning", "Dernier tableau conservé · source à reprendre."));
      if (stock.ev_quality?.status === "withheld") source.append(el("p", "forward-current-warning", "MDA : les cartes à EV actuelle restent suspendues en attendant le rapprochement du bilan. La courbe reprend les ratios annuels publiés par le fournisseur."));
    } else source.textContent = "Tableau annuel non disponible pour ce titre. Les dernières données valides sont conservées lors des refresh.";
    article.append(source); return article;
  }
  function panel(m) {
    const article = el("article", "forward-panel"); article.dataset.metric = m.key;
    const heading = el("div", "forward-panel-heading"), left = el("div");
    const title = el("h3", "", names[m.key] + " · " + state.horizon + " an" + (state.horizon === 2 ? "s" : "") + " (FY" + state.horizon + ")");
    left.append(title);
    const frequency = m.frequency === "monthly" ? "Mensuel" : m.frequency === "imported" ? "Import personnel" : "Relevés quotidiens";
    left.append(el("p", "", m.first ? frequency + " · " + m.stats.count + " observation" + (m.stats.count > 1 ? "s" : "") + " · " + date(m.first) + " au " + date(m.last) : "Historique fiscal non disponible"));
    const status = m.reason === "financial" ? "Non pertinent" : m.reason === "ev_bridge_unreconciled" ? "Bilan à rapprocher" : statusNames[m.stats.status];
    const badge = el("span", "forward-status is-" + m.stats.status, status); badge.dataset.status = m.stats.status; left.append(badge);
    const current = el("div", "forward-current");
    current.append(el("strong", "", multiple(m.latest?.value)), el("small", "", m.latest ? "Relevé du " + date(m.latest.date) : "N/D"));
    heading.append(left, current); article.append(heading);
    const count = m.points.filter(point => F.positive(point[1])).length;
    if (count >= 2) {
      article.append(drawChart(m));
      article.append(el("p", "forward-chart-hint", m.stats.available ? "Survoler la courbe · flèches gauche / droite au clavier" : "Quartiles : " + count + " / " + m.stats.minimum + " observations requises."));
    } else {
      const empty = el("div", "forward-empty");
      empty.append(el("strong", "", m.reason === "financial" ? "EV/EBITDA non pertinent" : m.reason === "ev_bridge_unreconciled" ? "EV/EBITDA suspendu" : "Historique FY" + state.horizon + " insuffisant"));
      empty.append(el("p", "", m.reason === "financial" ? "Ce multiple n’est pas utilisé pour les sociétés financières. Le P/E reste disponible lorsque les bénéfices sont positifs." :
        m.reason === "ev_bridge_unreconciled" ? selected().ev_quality.note : count === 1 ? "Un relevé de clôture vérifié est disponible. Le multiple du dernier relevé reste visible; la moyenne et les quartiles attendent un historique suffisant du même horizon." :
        "Les prévisions actuelles ne permettent pas de reconstruire les anciens multiples. Un historique daté de ce même horizon est nécessaire pour afficher la courbe et les quartiles."));
      article.append(empty);
    }
    const stats = el("div", "forward-stats");
    for (const [label, field, style] of [["Moyenne", "mean", "mean"], ["Q1 · 25 %", "q1", "q1"], ["Médiane", "median", ""], ["Q3 · 75 %", "q3", "q3"], ["Percentile", "percentile", ""]]) {
      const item = el("dl", "forward-stat " + style); item.dataset.stat = field;
      const value = m.stats.available ? m.stats[field] : null;
      item.append(el("dt", "", label), el("dd", "", field === "percentile" ? value === null ? "N/D" : number(value, 0) + " %" : multiple(value)));
      stats.append(item);
    }
    article.append(stats);
    const source = el("div", "forward-source-line");
    if (m.source) {
      const urls = m.source.urls || [];
      source.append(urls[0] ? sourceLink(urls[0], m.source.label) : document.createTextNode(m.source.label));
      if (m.latest?.consensus_date) source.append(document.createTextNode(" · Consensus du " + date(m.latest.consensus_date)));
      if (m.latest?.ev_bridge_date && m.key === "ev_ebitda") source.append(document.createTextNode(" · Bilan au " + date(m.latest.ev_bridge_date)));
      if (m.latest?.indicative) source.append(document.createTextNode(" · Relevé indicatif : date du cours non confirmée pour cette séance."));
      else if (m.latest?.price_date) source.append(document.createTextNode(" · Cours du " + date(m.latest.price_date)));
    } else source.textContent = m.reason === "financial" ? "Société financière : aucune comparaison EV/EBITDA." : "Aucune donnée de ce même horizon n’est disponible.";
    article.append(source); return article;
  }
  function drawChart(m) {
    const annual = m.frequency === "annual";
    const wrap = el("div", "forward-chart"), tooltip = el("div", "forward-tooltip"); tooltip.hidden = true;
    const width = Math.max(300, Math.min(1200, (charts.clientWidth || host.clientWidth || 900) - 20)), height = width < 540 ? 192 : 215;
    const margin = {left: 17, top: 19, right: 52, bottom: 28}, plotW = width - margin.left - margin.right, plotH = height - margin.top - margin.bottom;
    const points = m.points, positivePoints = points.filter(point => F.positive(point[1]));
    const timestamps = points.map(point => Date.parse(point[0])), start = timestamps[0], end = timestamps.at(-1);
    const values = positivePoints.map(point => point[1]);
    if (m.stats.available) values.push(m.stats.mean, m.stats.q1, m.stats.q3);
    const min = Math.min(...values), max = Math.max(...values), pad = (max - min || max * .1 || 1) * .16;
    const bottom = Math.max(0, min - pad), top = max + pad;
    const x = d => margin.left + (Date.parse(d) - start) / (end - start || 1) * plotW;
    const y = v => margin.top + (top - v) / (top - bottom || 1) * plotH;
    const chartTitle = annual ? "EV/EBITDA annuel, réalisé et prévisions FY1/FY2" : names[m.key] + " FY" + state.horizon + ", courbe historique, moyenne et quartiles";
    const chart = svg("svg", {viewBox: "0 0 " + width + " " + height, role: "img", tabindex: "0", "aria-label": chartTitle + ". Utiliser les flèches pour explorer."});
    chart.append(svg("title", {}, selected().title + " — " + chartTitle));
    if (m.stats.available) chart.append(svg("rect", {class: "fv-band", x: margin.left, y: y(m.stats.q3), width: plotW, height: y(m.stats.q1) - y(m.stats.q3)}));
    for (let i = 0; i < 5; i++) {
      const value = bottom + (top - bottom) * i / 4, yy = y(value);
      chart.append(svg("line", {class: "fv-grid", x1: margin.left, x2: width - margin.right, y1: yy, y2: yy}), svg("text", {x: width - margin.right + 8, y: yy + 3}, number(value, max > 100 ? 0 : 1)));
    }
    const ticks = Math.min(points.length, width < 500 ? 4 : 6);
    for (let i = 0; i < ticks; i++) {
      const index = Math.round((points.length - 1) * i / (ticks - 1)), d = points[index][0], xx = x(d);
      const label = annual ? "FY" + m.metadata[d].fiscal_year : new Intl.DateTimeFormat("fr-CA", {year: "2-digit", month: "short", timeZone: "UTC"}).format(new Date(d + "T12:00:00Z"));
      chart.append(svg("line", {class: "fv-grid", x1: xx, x2: xx, y1: margin.top, y2: height - margin.bottom}),
        svg("text", {x: xx, y: height - 7, "text-anchor": i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}, label));
    }
    if (m.stats.available) for (const field of ["q1", "mean", "q3"]) chart.append(svg("line", {class: "fv-" + field, x1: margin.left, x2: width - margin.right, y1: y(m.stats[field]), y2: y(m.stats[field])}));
    let path = "", previous = null;
    const maxGap = annual ? 400 : m.frequency === "monthly" ? 75 : m.frequency === "daily" ? 7 : 90;
    for (const point of points) {
      if (!F.positive(point[1])) {previous = null; continue;}
      const move = !previous || (Date.parse(point[0]) - Date.parse(previous[0])) / 86400000 > maxGap;
      if (annual) {
        const estimate = m.metadata[point[0]].ev_ebitda_is_estimate;
        if (!move) chart.append(svg("path", {class: "fv-series" + (estimate || m.metadata[previous[0]].ev_ebitda_is_estimate ? " fv-estimated" : ""), d: "M" + x(previous[0]) + "," + y(previous[1]) + "L" + x(point[0]) + "," + y(point[1])}));
        chart.append(svg("circle", {class: "fv-annual-point" + (estimate ? " is-estimate" : ""), cx: x(point[0]), cy: y(point[1]), r: m.metadata[point[0]].fiscal_year === m.firstYear + state.horizon - 1 ? 4.5 : 3}));
      } else path += (move ? "M" : "L") + x(point[0]).toFixed(2) + "," + y(point[1]).toFixed(2) + " ";
      previous = point;
    }
    if (!annual) {
      chart.append(svg("path", {class: "fv-series", d: path}));
      const last = positivePoints.at(-1); chart.append(svg("circle", {class: "fv-focus", cx: x(last[0]), cy: y(last[1]), r: 3.2}));
    }
    const crosshair = svg("line", {class: "fv-crosshair", y1: margin.top, y2: height - margin.bottom, visibility: "hidden"});
    const dot = svg("circle", {class: "fv-focus", r: 4, visibility: "hidden"}); chart.append(crosshair, dot);
    let cursor = positivePoints.length - 1;
    function reveal(index) {
      cursor = Math.max(0, Math.min(positivePoints.length - 1, index)); const p = positivePoints[cursor], xx = x(p[0]);
      crosshair.setAttribute("x1", xx); crosshair.setAttribute("x2", xx); crosshair.setAttribute("visibility", "visible");
      dot.setAttribute("cx", xx); dot.setAttribute("cy", y(p[1])); dot.setAttribute("visibility", "visible");
      const label = annual ? "FY" + m.metadata[p[0]].fiscal_year + (m.metadata[p[0]].ev_ebitda_is_estimate ? " · prévision" : " · réalisé") : date(p[0]);
      tooltip.replaceChildren(document.createTextNode(label), el("strong", "", multiple(p[1]))); tooltip.hidden = false;
      tooltip.style.left = Math.max(5, Math.min(width - 210, xx + 12)) + "px";
    }
    function hide() {tooltip.hidden = true; crosshair.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");}
    chart.addEventListener("pointermove", event => {
      const rect = chart.getBoundingClientRect(), xx = (event.clientX - rect.left) * width / rect.width;
      const timestamp = start + (xx - margin.left) / plotW * (end - start);
      let closest = 0, distance = Infinity;
      positivePoints.forEach((p, i) => {const delta = Math.abs(Date.parse(p[0]) - timestamp); if (delta < distance) {closest = i; distance = delta;}}); reveal(closest);
    });
    chart.addEventListener("pointerleave", hide); chart.addEventListener("blur", hide);
    chart.addEventListener("keydown", event => {if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {event.preventDefault(); reveal(event.key === "Home" ? 0 : event.key === "End" ? positivePoints.length - 1 : cursor + (event.key === "ArrowLeft" ? -1 : 1));}});
    wrap.append(chart, tooltip); return wrap;
  }
  const visible = () => !document.hidden && !host.closest("[hidden]") && host.getClientRects().length > 0;
  let refreshing = false, starting = false;
  async function readData() {
    const response = await fetch("data/forward-valuation.json", {cache: "no-cache", signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error("Fichier de données inaccessible");
    return F.validate(await response.json());
  }
  async function refreshVisibleData() {
    if (refreshing || !visible()) return;
    refreshing = true;
    try {
      const next = await readData();
      if (next.refresh?.checked_at !== dataset.refresh?.checked_at || next.prepared_at !== dataset.prepared_at) {
        dataset = next; instruments = new Map(next.instruments.map(row => [row.id, row]));
        if (!selected()) state.id = next.instruments[0].id;
        window.SavyForwardValuation.dataset = dataset; render();
      }
    } catch (_) { /* Keep dated, validated data when the connection is unavailable. */ }
    finally {refreshing = false;}
  }
  async function start() {
    if (starting || dataset) return;
    starting = true;
    try {
      if (window.SAVY_FORWARD_DATA) dataset = F.validate(window.SAVY_FORWARD_DATA);
      else dataset = await readData();
      instruments = new Map(dataset.instruments.map(row => [row.id, row]));
      try {const saved = JSON.parse(localStorage.getItem(KEY)); if (instruments.has(saved?.id)) state.id = saved.id; if ([1, 2].includes(saved?.horizon)) state.horizon = saved.horizon; if (["1Y", "2Y", "5Y", "MAX"].includes(saved?.range)) state.range = saved.range; if (["lists", "charts", "audit"].includes(saved?.view)) state.view = saved.view; if (typeof saved?.confirm5y === "boolean") state.confirm5y = saved.confirm5y;} catch (_) { /* Default preferences. */ }
      if (!instruments.has(state.id)) state.id = instruments.keys().next().value;
      setup(); render(); window.SavyForwardValuation = {state, render, model, dataset};
      if (!window.SAVY_FORWARD_DATA) {
        setInterval(refreshVisibleData, 300000);
        document.addEventListener("visibilitychange", refreshVisibleData);
        window.addEventListener("hashchange", refreshVisibleData);
      }
    } catch (error) {host.replaceChildren(el("p", "forward-error", "La valorisation forward ne peut pas être chargée : " + error.message));}
    finally {starting = false;}
  }
  if (window.SAVY_FORWARD_DATA || visible()) start();
  else {
    host.append(el("p", "forward-selection-note", "Chargement de la valorisation à l’ouverture de cet onglet…"));
  }
  if (!window.SAVY_FORWARD_DATA) {
    const open = () => {if (visible()) {if (dataset) refreshVisibleData(); else start();}};
    const observer = new MutationObserver(open);
    observer.observe(host, {attributes: true, attributeFilter: ["hidden"]});
    const page = host.closest(".portal-page");
    if (page) observer.observe(page, {attributes: true, attributeFilter: ["hidden"]});
    window.addEventListener("hashchange", open);
  }
})();
