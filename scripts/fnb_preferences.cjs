"use strict";
// A construction preference, separate from the sortable historical metrics.
// Keep the two mixed-asset mandates outside the equity-growth preference.
module.exports=function preferences(D){
 const validation=D.optimization.validation,delta=validation.metrics.sharpe-validation.benchmark.sharpe,best=[...D.custom_order,"proposal"].sort((a,b)=>D.results[b].sharpe-D.results[a].sharpe)[0];
 const items=[
  ["5","Noyau mondial, Nasdaq limité à 10 % et 5 % d’or : mon compromis de croissance et de diversification préféré."],
  ["2","Sept FNB complémentaires et une construction plus simple que la nouvelle proposition; mon premier choix sans or."],
  ["proposal","Allocation entièrement en FNB d’actions, plafonds géographiques et sectoriels. Troisième choix : allocation défensive et "+Object.keys(D.results.proposal.weights).length+" fonds; "+(delta>0?"validation chronologique favorable, à confirmer par le suivi réel.":"la validation chronologique ne bat pas VEQT au Sharpe.")],
  ["4","Proche d’Élan, avec moins de Nasdaq et davantage de faible volatilité; choix plus défensif."],
  ["1","Cinq FNB, faciles à suivre; concentration canadienne et dividendes moins équilibrés entre les régions."],
  ["8","Noyau mondial et momentum diversifiés, mais volatilité historique plus élevée que les premiers choix."],
  ["6",(best==="6"?"Meilleur Sharpe du groupe sur le backtest actuel":"Historique de rendement ajusté au risque favorable")+", avec davantage de convictions sectorielles; je privilégie la robustesse."],
  ["7","Historique fort, mais concentration en banques, énergie et gestion active plus difficile à maintenir."],
  ["3","Faible volatilité bien représentée, au prix d’un biais défensif marqué pour un objectif de croissance."],
  ["9","Le plus offensif; sa volatilité et son recul maximal historiques pèsent sur mon appréciation."]
 ];
 return {date:D.optimization.generated_at.slice(0,10),criteria:"Préférence de construction pour la croissance à long terme : diversification, concentration, simplicité et frais avant le seul backtest. Proposition incluse; nº 10 et 11, mandats mixtes, comparés au tableau mais exclus de cette préférence. Ce jugement ne prédit pas les rendements.",entries:items.map(([id,reason],i)=>({id,rank:i+1,reason}))};
};
