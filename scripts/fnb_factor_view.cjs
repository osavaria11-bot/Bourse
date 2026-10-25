"use strict";
module.exports = function factorView(html) {
  html = html.replace(/<!-- fnb-factors:start -->[\s\S]*?<!-- fnb-factors:end -->\s*/g, "");
  const view = `<!-- fnb-factors:start --><section class="section factor-panel" aria-labelledby="factorTitle">
  <div class="section-head"><h2 id="factorTitle">Facteurs de risque · face au benchmark</h2></div>
  <p id="factorStatus" class="method-summary" role="status">Sélectionne un portefeuille et une référence pour comparer leurs sensibilités.</p>
  <div id="factorContent" hidden><div id="factorMetrics" class="factor-metrics"></div>
  <div class="table-wrap factor-table" tabindex="0" aria-label="Sensibilités factorielles et contribution à la variance active"><table><colgroup><col style="width:27%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:22%"><col style="width:17%"></colgroup><thead><tr><th scope="col">Facteur</th><th scope="col"><span data-exposure-name>Portefeuille</span></th><th scope="col"><span data-reference-label>Benchmark</span></th><th scope="col">Écart</th><th scope="col">Bande 95 %<small>sur l’écart</small></th><th scope="col">Risque actif<small>part de variance</small></th></tr></thead><tbody id="factorValues"></tbody></table></div></div>
  <details class="factor-method"><summary>Lecture, méthode et sources</summary>
  <div class="risk-detail-content"><p id="factorReading" class="method-summary"></p>
  <p>Sensibilités historiques aux stratégies factorielles, estimées sur rendements. Un coefficient de +0,30 correspond à environ +0,30 point de rendement lorsque la stratégie gagne 1 point, les autres facteurs restant constants. L’écart indique une sensibilité supérieure ou inférieure au benchmark; ce n’est pas un pourcentage investi.</p>
  <p>Régression simultanée avec constante sur cinq séries : marché VEQT moins le taux sans risque mensuel; valeur VVL − VEQT; momentum VMO − VEQT; qualité FCUQ − VFV; faible volatilité FCUL − VFV. Portefeuille et benchmark utilisent exactement les mêmes mois, en CAD, distributions réinvesties, avec les rendements déjà présents dans SAVY. Le benchmark est celui du sélecteur en haut.</p>
  <p>Les coefficients sont des sensibilités conditionnelles aux stratégies de FNB, estimées sur au moins 36 mois consécutifs. Ce ne sont ni des scores fondamentaux des titres ni les facteurs purs de Fama–French. Les écarts de pays, de secteurs et de devises entre les fonds peuvent influencer les résultats. La taille et la croissance ne sont pas estimées, faute de séries comparables suffisantes.</p>
  <p>Les bandes autour des écarts sont approximatives : ±1,96 erreur-type Newey–West, trois retards mensuels et correction du nombre de paramètres. Une bande qui contient zéro ne distingue pas clairement le portefeuille du benchmark. Un historique court et des stratégies corrélées limitent la précision; ces bandes ne prédisent pas les rendements.</p>
  <p>La part du risque actif décompose la variance des rendements portefeuille − benchmark : coefficient d’écart × covariance de la stratégie avec cet écart, divisée par sa variance. Les parts et le résiduel totalisent 100 %; une part négative traduit un effet de compensation. Le résiduel inclut les risques non captés, dont l’or, les obligations et la crypto qui ne sont pas modélisés séparément. Il ne constitue pas une mesure d’alpha. Si le risque actif est nul, ses parts restent indisponibles.</p>
  <p>Sources des objectifs factoriels : <a href="https://www.vanguard.ca/en/product/investment-capabilities/factor-etfs" target="_blank" rel="noopener noreferrer">Vanguard · VVL et VMO</a>, <a href="https://www.fidelity.ca/en/products/etfs/fcuq/" target="_blank" rel="noopener noreferrer">Fidelity · FCUQ</a> et <a href="https://www.fidelity.ca/en/products/etfs/fcul/" target="_blank" rel="noopener noreferrer">Fidelity · FCUL</a>. Dates et sources des rendements : onglet Données.</p>
  <h3>Stabilité selon la fenêtre</h3><div id="factorStability"></div><p>Fenêtre 12 mois : les cinq facteurs et la constante ne sont pas estimés sur un échantillon aussi court. Fenêtre 24 mois : estimation exploratoire, au moins 24 mois communs; historique complet : minimum 36 mois. Les différences de signes ou de bandes ne constituent pas un test formel de changement de régime.</p><p>Le bêta affiché en KPI est le bêta simple face au benchmark sélectionné. Le coefficient « Marché actions » du tableau est une exposition conditionnelle à VEQT dans le modèle simultané : les deux ont des définitions différentes. Downside Beta : covariance conditionnelle portefeuille/benchmark divisée par la variance conditionnelle du benchmark durant ses seuls mois négatifs; huit mois baissiers minimum, prudence en dessous de douze.</p><p>Contrôle de multicolinéarité par VIF sur les facteurs standardisés : au-dessus de 10, prudence; au-dessus de 25, estimation refusée. Un R² élevé ne prouve ni une bonne construction du portefeuille ni un bon pouvoir prédictif. Taux, crédit, devises, taille et autres expositions non isolées peuvent rester dans le résiduel.</p><p id="factorDiagnostics"></p></div></details></section><!-- fnb-factors:end -->`;
  const section = html.indexOf('<section id="exposures"'), grid = html.indexOf('<div class="exposure-grid">', section);
  if (section < 0 || grid < section) throw Error("Factor exposure template not found");
  // Append inside the existing grid, after Geography and Sectors. Match the
  // balanced divs so repeated full and quote-only renders keep one compact row.
  const divs = /<\/?div\b[^>]*>/g; divs.lastIndex = grid;
  let depth = 0, target = -1, tag;
  while ((tag = divs.exec(html))) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { target = tag.index; break; }
  }
  if (target < grid) throw Error('Exposure grid closing tag missing');
  html = html.slice(0, target) + view + html.slice(target);
  html = html.replace('<h2 id="exposuresTitle">Géographie et secteurs</h2>', '<h2 id="exposuresTitle">Facteurs, géographie et secteurs</h2>');
  if (!html.includes('src="../js/fnb-factor-utils.js')) html = html.replace(/(<script[^>]+src="\.\.\/js\/fnb-dashboard.js)/, '<script src="../js/fnb-factor-utils.js?v=20261024-adaptive-risk"></script>$1');
  return html.replace(/fnb-factor-utils\.js\?v=[^"']+/g,'fnb-factor-utils.js?v=20261024-adaptive-risk');
};
