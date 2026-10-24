"use strict";
module.exports = function factorView(html) {
  html = html.replace(/<!-- fnb-factors:start -->[\s\S]*?<!-- fnb-factors:end -->\s*/g, "");
  const view = `<!-- fnb-factors:start --><section class="section factor-panel" aria-labelledby="factorTitle">
  <div class="section-head"><div><h2 id="factorTitle">Facteurs de risque · face au benchmark</h2><p class="small">Sensibilités historiques aux stratégies factorielles</p></div><span class="factor-badge">Estimation sur rendements</span></div>
  <p id="factorStatus" class="method-summary" role="status">Sélectionne un portefeuille et une référence pour comparer leurs sensibilités.</p>
  <div id="factorContent" hidden><div id="factorMetrics" class="factor-metrics"></div>
  <p class="method-summary">Un coefficient de +0,30 correspond à environ +0,30 point de rendement lorsque la stratégie gagne 1 point, les autres facteurs restant constants. L’écart indique une sensibilité supérieure ou inférieure au benchmark; ce n’est pas un pourcentage investi.</p>
  <div class="table-wrap factor-table" tabindex="0" aria-label="Sensibilités factorielles et contribution à la variance active"><table><thead><tr><th scope="col">Facteur / stratégie</th><th scope="col" data-exposure-name>Portefeuille</th><th scope="col" data-reference-label>Benchmark</th><th scope="col">Écart de sensibilité</th><th scope="col">Bande indicative à 95 %<small>sur l’écart</small></th><th scope="col">Part du risque actif<small>variance de l’écart</small></th></tr></thead><tbody id="factorValues"></tbody></table></div>
  <p id="factorReading" class="method-summary"></p></div>
  <details class="factor-method"><summary>Lecture, méthode et sources</summary>
  <p>Régression simultanée avec constante sur cinq séries : marché VEQT moins le taux sans risque mensuel; valeur VVL − VEQT; momentum VMO − VEQT; qualité FCUQ − VFV; faible volatilité FCUL − VFV. Portefeuille et benchmark utilisent exactement les mêmes mois, en CAD, distributions réinvesties, avec les rendements déjà présents dans SAVY. Le benchmark est celui du sélecteur en haut.</p>
  <p>Les coefficients sont des sensibilités conditionnelles aux stratégies de FNB, estimées sur au moins 36 mois consécutifs. Ce ne sont ni des scores fondamentaux des titres ni les facteurs purs de Fama–French. Les écarts de pays, de secteurs et de devises entre les fonds peuvent influencer les résultats. La taille et la croissance ne sont pas estimées, faute de séries comparables suffisantes.</p>
  <p>Les bandes autour des écarts sont approximatives : ±1,96 erreur-type Newey–West, trois retards mensuels et correction du nombre de paramètres. Une bande qui contient zéro ne distingue pas clairement le portefeuille du benchmark. Un historique court et des stratégies corrélées limitent la précision; ces bandes ne prédisent pas les rendements.</p>
  <p>La part du risque actif décompose la variance des rendements portefeuille − benchmark : coefficient d’écart × covariance de la stratégie avec cet écart, divisée par sa variance. Les parts et le résiduel totalisent 100 %; une part négative traduit un effet de compensation. Le résiduel inclut les risques non captés, dont l’or, les obligations et la crypto qui ne sont pas modélisés séparément. Il ne constitue pas une mesure d’alpha. Si le risque actif est nul, ses parts restent indisponibles.</p>
  <p>Sources des objectifs factoriels : <a href="https://www.vanguard.ca/en/product/investment-capabilities/factor-etfs" target="_blank" rel="noopener noreferrer">Vanguard · VVL et VMO</a>, <a href="https://www.fidelity.ca/en/products/etfs/fcuq/" target="_blank" rel="noopener noreferrer">Fidelity · FCUQ</a> et <a href="https://www.fidelity.ca/en/products/etfs/fcul/" target="_blank" rel="noopener noreferrer">Fidelity · FCUL</a>. Dates et sources des rendements : onglet Données.</p>
  </details></section><!-- fnb-factors:end -->`;
  const section = html.indexOf('<section id="exposures"'), grid = html.indexOf('<div class="exposure-grid">', section);
  if (section < 0 || grid < section) throw Error("Factor exposure template not found");
  html = html.slice(0, grid) + view + html.slice(grid);
  html = html.replace('<h2 id="exposuresTitle">Géographie et secteurs</h2>', '<h2 id="exposuresTitle">Facteurs, géographie et secteurs</h2>');
  if (!html.includes('src="../js/fnb-factor-utils.js')) html = html.replace(/(<script[^>]+src="\.\.\/js\/fnb-dashboard.js)/, '<script src="../js/fnb-factor-utils.js?v=20261024-factors"></script>$1');
  return html;
};
