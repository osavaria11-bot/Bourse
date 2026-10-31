"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),U=require("../js/portfolio-briefing-utils.js");
const personalPdf="https://chatgpt.com/library?file_id=libfile_test_report_0001&account_id=personal";
test("The committee report separates the actual portfolios, decisions, scenarios and sources without consuming subheadings",()=>{
 const text=["# SAVY — Comité", "## 1. Résumé exécutif", "Cinq conclusions.", "## 2. Portefeuille OS — FEQT", "### Valorisation et risque actif", "Analyse OS.", "## 3. Portefeuille JMC — VBAL", "Analyse équilibrée.", "## 4. Portefeuille MCL — VGRO", "Analyse croissance équilibrée.", "## 5. Comparaison des trois portefeuilles", "Comparaison relative.", "## 6. Analyse des scénarios optimisés", "Actuel, optimisé et recommandé.", "## 7. Tableau des recommandations", "| Actif | Décision |", "| --- | --- |", "| TEST | Conserver |", "## 8. Suivi des décisions précédentes", "Recommandation, pas transaction.", "## 9. Perspectives et surveillance", "Catalyseurs.", "## 10. Méthodologie, sources et limites", "Dates et hypothèses."].join("\n\n");
 const s=U.normalize({date:"2026-11-05",text}).sections;
 assert.match(s.summary,/Cinq conclusions/);assert.match(s.os,/### Valorisation et risque actif/);assert.doesNotMatch(s.os,/Analyse équilibrée/);
 assert.equal(s.jmc,"Analyse équilibrée.");assert.equal(s.mcl,"Analyse croissance équilibrée.");
 assert.match(s.comparison,/relative/);assert.match(s.optimization,/recommandé/);assert.match(s.recommendations,/\| TEST \|/);assert.match(s.follow_up,/pas transaction/);assert.equal(s.outlook,"Catalyseurs.");assert.equal(s.methodology,"Dates et hypothèses.");
});
test("Existing unstructured private editions survive unchanged and import does not invent absent sections",()=>{
 const old={date:"2026-11-03",text:"Synthèse des changements.\\nOS : allocation.\\nJMC : risque.\\nMCL : résultats."};
 const entry=U.entries(JSON.stringify([old]))[0];assert.equal(entry.text,old.text);assert.equal(entry.sections.summary,old.text);assert.equal(entry.sections.os,undefined);
 const plain=U.normalize({date:old.date,text:"OS est bien diversifié.\n\nJMC : analyse à compléter."});assert.equal(plain.sections.os,undefined);assert.match(plain.sections.summary,/OS est bien/);
});
test("A complete structured report round-trips dates, sections and the authenticated PDF reference",()=>{
 const input={schema_version:1,date:"2026-11-05",data_date:"2026-11-04",finviz_date:"2026-11-04",pdf_url:personalPdf,sections:{summary:"Conclusions.",os:"OS.",jmc:"JMC.",mcl:"MCL.",recommendations:"Décisions.",methodology:"Sources."}};
 const entry=U.importPayload(JSON.stringify(input))[0];assert.equal(entry.pdf_url,personalPdf);assert.equal(entry.data_date,input.data_date);assert.equal(entry.finviz_date,input.finviz_date);
 assert.match(entry.text,/Portefeuille OS/);assert.equal(entry.sections.os,"OS.");
 const restored=U.importPayload(JSON.stringify({schema_version:1,editions:[entry]}));assert.deepEqual(restored,[entry]);
});
test("A PDF cannot be supplied as a public, script, deceptive-host or credential-bearing URL",()=>{
 const unsafe=["https://osavaria11-bot.github.io/Bourse/reports/private.pdf","javascript:alert(1)",personalPdf.replace("chatgpt.com","chatgpt.com.evil.test"),personalPdf.replace("chatgpt.com","me@chatgpt.com"),personalPdf+"&access_token=secret",personalPdf+"&file_id=libfile_other_report",personalPdf+"#private",personalPdf.replace("personal","another-account"),personalPdf.replace("https:","http:")];
 for(const pdf_url of unsafe){assert.equal(U.libraryUrl(pdf_url),null,pdf_url);assert.throws(()=>U.normalize({date:"2026-11-05",text:"Rapport privé.",pdf_url}),/lien personnel/);}
});
test("Adding and updating editions preserves histories longer than twelve without mutating an older recommendation",()=>{
 const history=Array.from({length:18},(_,i)=>({date:"2026-10-"+String(i+1).padStart(2,"0"),text:"Recommandation initiale "+i}));const before=JSON.stringify(history);
 const merged=U.merge(history,[{date:"2026-11-05",text:"Nouvelle édition."}]);assert.equal(merged.length,19);assert.equal(merged.at(-1).date,"2026-10-01");assert.equal(JSON.stringify(history),before);
 const replaced=U.merge(merged,[{date:"2026-11-05",text:"Édition corrigée."}]);assert.equal(replaced.length,19);assert.equal(replaced[0].text,"Édition corrigée.");assert.equal(replaced.at(-1).text,history[0].text);
});
test("Invalid batch dates or schema versions fail before any history is replaced",()=>{
 assert.equal(U.validDate("2026-02-29"),false);assert.equal(U.validDate("2028-02-29"),true);
 assert.throws(()=>U.importPayload(JSON.stringify([{date:"2026-11-05",text:"Valide."},{date:"2026-02-30",text:"Invalide."}])),/date/);
 assert.throws(()=>U.importPayload(JSON.stringify({schema_version:2,editions:[{date:"2026-11-05",text:"Rapport."}]})),/version/);
 assert.throws(()=>U.normalize({date:"2026-11-05",text:"Rapport.",data_date:"2026-13-01"}),/date des données/);
 assert.throws(()=>U.normalize({date:"2026-11-05",sections:{os:42}}),/section/);
});
test("Long reports and literal HTML stay report data; the old 30 000-character cap is removed",()=>{
 const text="Analyse détaillée. ".repeat(2000)+"\n<img src=x onerror=alert(1)>";
 assert.ok(text.length>30000);const entry=U.normalize({date:"2026-11-05",text});assert.equal(entry.text,text);assert.match(entry.sections.summary,/<img/);
 assert.throws(()=>U.normalize({date:"2026-11-05",text:"x".repeat(U.MAX_LENGTH+1)}),/taille permise/);
});
