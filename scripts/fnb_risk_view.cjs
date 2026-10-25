'use strict';
module.exports=function riskView(html,dailyRisk=null,stressInput=null){
 html=html.replace(/<!-- fnb-risk:start -->[\s\S]*?<!-- fnb-risk:end -->\s*/g,'');
 const view=`<!-- fnb-risk:start --><script type="application/json" id="fnbDailyRisk">${JSON.stringify(dailyRisk).replace(/</g,'\\u003c')}</script><script type="application/json" id="fnbStressInput">${JSON.stringify(stressInput).replace(/</g,'\\u003c')}</script>
 <section class="section risk-snapshot" aria-labelledby="riskSnapshotTitle">
 <div class="section-head"><h2 id="riskSnapshotTitle">Risque de perte</h2><span class="small">CAD · confiance 95 %</span></div>
 <p class="method-summary" id="riskSnapshotStatus" role="status"></p>
 <div id="riskSnapshotContent" hidden>
 <div class="risk-snapshot-metrics">
 <div title="Quantile empirique des pertes quotidiennes aux poids cibles actuels. Ce seuil peut être dépassé."><span>VaR · 1 jour</span><strong id="riskVarDaily">—</strong><small id="riskDailyNote"></small></div>
 <div title="Quantile des pertes composées sur 21 séances consécutives. Blocs non chevauchants, sans multiplication par racine de 21."><span>VaR · 1 mois</span><strong id="riskVar">—</strong><small>21 séances</small></div>
 <div title="Expected Shortfall : moyenne du pire 5 % de la distribution à 21 séances, avec observation frontière fractionnaire."><span>CVaR · 1 mois</span><strong id="riskCvar">—</strong><small>Queue de perte</small></div>
 <div title="VaR du portefeuille / VaR du benchmark sur les mêmes 21 séances. Ce n’est pas la VaR active; inférieur à 1× signifie une VaR plus faible lorsque le dénominateur est positif."><span>Relative VaR</span><strong id="riskRelative">—</strong><small id="riskRelativeNote"></small></div>
 </div>
 <div class="stress-heading"><label for="riskScenario">Stress comparé</label><select id="riskScenario" aria-label="Scénario de stress principal"></select></div>
 <div id="riskStressComparison" class="stress-comparison"></div>
 <div class="risk-secondary">
 <div title="Plus forte perte cumulative entre un sommet et le creux suivant, portefeuille et benchmark sur une période commune."><span>Maximum Drawdown</span><strong id="riskDrawdown">—</strong><small id="riskDrawdownNote"></small></div>
 <div title="Rendement composé du portefeuille durant les mois négatifs du benchmark, divisé par le rendement composé de celui-ci. Un ratio négatif peut correspondre à un gain du portefeuille."><span>Downside Capture</span><strong id="riskCapture">—</strong><small id="riskCaptureNote"></small><div id="riskCaptureBars" class="capture-bars"></div></div>
 </div>
 <div class="risk-distribution"><div title="Asymétrie ajustée de Fisher–Pearson; une valeur négative indique une queue gauche plus marquée dans cet échantillon."><span>Skewness · 1 j</span><strong id="riskSkewness">—</strong></div><div title="Excès d’aplatissement corrigé du biais; une loi normale a un excès de zéro."><span>Excess Kurtosis · 1 j</span><strong id="riskExcessKurtosis">—</strong></div></div>
 <div class="risk-contribution-head"><h3>Top 4 contributions au risque</h3><span class="small">Variance absolue</span></div>
 <div id="riskContributions" class="risk-contribution-bars"></div>
 <p id="riskContributionNote" class="small"></p><p class="small risk-quality" id="riskSampleNote"></p>
 </div>
 <details class="factor-method"><summary>Scénarios, fiabilité et méthodes</summary><div class="risk-detail-content">
 <h3>Scénarios complets et couverture</h3><p>Il s’agit de l’allocation actuelle dans un environnement historique, sauf pondérations historiques explicitement datées. « Observé » qualifie les rendements des FNB, pas un portefeuille détenu à l’époque.</p><div id="riskScenarios"></div>
 <h3>Échantillon et validation</h3><div id="riskValidation"></div>
 <h3>Bêta et diversification</h3><div id="riskAttribution"></div>
 <h3>Contributions des positions</h3><div id="riskActiveContributions"></div>
 <h3>Conventions et limites</h3><p>Rendements totaux en CAD, distributions et fractionnements ajustés. VaR quotidienne et horizon mensuel de 21 séances : simulation aux poids cibles actuels constants, rééquilibrés chaque séance. Les blocs non chevauchants ne sont pas supposés indépendants : leur autocorrélation réduit le nombre effectif; bootstrap circulaire de blocs de trois périodes pour l’intervalle percentile 95 %. Les variantes de décalage des blocs sont des contrôles de sensibilité, jamais des observations supplémentaires.</p>
 <p>Le Maximum Drawdown quotidien utilise ces mêmes poids constants et les mêmes séances, seulement si l’historique ne contient aucun trou; sinon, le backtest mensuel commun est utilisé et ne mesure pas les creux intramensuels. Downside Capture et Downside Beta utilisent les mêmes mois calendaires que le backtest existant, rééquilibré en janvier. Capture : ratio des rendements composés durant les mois négatifs du benchmark; minimum trois mois. Le bêta baissier demande huit mois négatifs; moins de douze reste fragile.</p>
 <p>Stress : priorité aux rendements réels, puis à un indice documenté représentatif, puis aux positions datées ou à une reconstruction explicitement actuelle, enfin aux sensibilités estimées. Sans données défendables, le résultat reste indisponible. Les composantes sont agrégées par poids au début de la période, achat et conservation, sans corrélation ajoutée. La conversion USD vers CAD compose les facteurs de change; aucune conversion supplémentaire sur une série déjà en CAD. Les couvertures inconnues ne sont pas supposées. Le modèle FX est une sensibilité empirique conditionnelle, pas une exposition contractuelle; les trajectoires d’un levier quotidien ne sont jamais reconstruites par multiplication d’un rendement de crise.</p>
 <p>Les chocs hypothétiques sont des hypothèses explicites : technologie −35 %, autres actions −10 %, crypto −45 %, autres actifs et change constants; récession : marché −25 %, proxy obligataire +5 %, spread crédit −8 %; taux : proxy obligataire −12 %, marché −8 %; CAD +15 % : USD/CAD −13,04 %. Le choc de taux est un rendement du proxy XBB, pas une conversion supposée d’une hausse de taux en points de base. XCB − XGB représente imparfaitement le crédit, notamment à cause des écarts de duration. Les sensibilités historiques ne modélisent pas toutes les non-linéarités, couvertures ou changements de régime.</p>
 <p>Aucun intervalle de stress global n’est affiché sans modèle d’incertitude défendable. Le bootstrap de la VaR reste conditionnel à l’historique disponible; il ne contient pas les crises absentes. Le rejeu chronologique utilise uniquement les observations antérieures à chaque prévision, mais l’allocation actuelle a été choisie après une partie de l’historique. L’univers actuel peut comporter un biais de sélection et de survie. Ce calcul n’est ni une validation de la sélection hors échantillon, ni une garantie de perte maximale.</p>
 <p id="riskSourceStatus"></p><p><a href="../data/fnb-stress-history.json" target="_blank" rel="noopener noreferrer">Sources et entrées de stress</a> · <a href="../data/fnb-daily-risk.json" target="_blank" rel="noopener noreferrer">Sources et séries quotidiennes</a></p><button type="button" id="riskPerformanceLink">Voir les ratios de performance</button>
 </div></details></section><!-- fnb-risk:end -->`;
 const section=html.indexOf('<section id="exposures"'),target=html.indexOf('<!-- fnb-factors:start -->',section);
 if(section<0||target<section)throw Error('Risk snapshot exposure target missing');
 html=html.slice(0,target)+view+html.slice(target);
 if(!html.includes('src="../js/fnb-stress-utils.js'))html=html.replace(/(<script[^>]+src="\.\.\/js\/fnb-dashboard.js)/,'<script src="../js/fnb-stress-utils.js?v=20261024-adaptive-risk"></script>$1');
 if(!html.includes('src="../js/fnb-risk-utils.js'))html=html.replace(/(<script[^>]+src="\.\.\/js\/fnb-dashboard.js)/,'<script src="../js/fnb-risk-utils.js?v=20261024-adaptive-risk"></script>$1');
 return html.replace(/fnb-risk-utils\.js\?v=[^"']+/g,'fnb-risk-utils.js?v=20261024-adaptive-risk');
};
