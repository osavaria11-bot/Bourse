(() => {
  "use strict";
  const P = window.PolymarketUtils, U = window.MacroUtils, host = document.getElementById("polymarketRow");
  if (!host) return;
  const KEY = "savy:polymarket:v1";
  let data = null, pending = null, copy = false;
  function el(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function render() {
    if (data) data = P.normalize(data); // Expire events even while the page remains open.
    host.replaceChildren();
    for (const spec of P.GROUPS) {
      const group = data?.groups[spec.id], events = group?.events || [];
      for (let index = 0; index < spec.count; index++) {
        const event = events[index], card = el("article", "polymarket-card card");
        card.dataset.group = spec.id;
        card.append(el("p", "eyebrow polymarket-category", spec.label + " · " + (index + 1)));
        if (!event) {
          card.append(el("h3", "", "Pari indisponible"), el("p", "meta", "Aucun relevé valide pour le moment.")); host.append(card); continue;
        }
        card.dataset.eventId = event.id;
        const title = el("h3"), link = el("a", "", event.title + " ↗");
        link.href = event.url; link.target = "_blank"; link.rel = "noopener noreferrer"; title.append(link); card.append(title);
        const outcomes = el("ul", "polymarket-outcomes");
        for (const point of event.outcomes) {
          const item = el("li"), description = el("span", "", P.label(point.label)); description.title = P.label(point.label);
          item.append(description, el("strong", "", P.percent(point.probability))); outcomes.append(item);
        }
        card.append(outcomes);
        const footer = el("div", "polymarket-card-footer");
        footer.append(el("p", "polymarket-volume", P.volume(spec.id === "finance" ? event.volume : event.volume_24h)),
          el("p", "meta", spec.id === "finance" ? "Volume total échangé" : "Volume échangé · 24 h"));
        const time = el("time", "meta polymarket-time", (copy || group.fetch_status === "cached" || Date.now() - U.parseTimestamp(group.fetched_at) > 1800000 ? "Relevé conservé · " : "Relevé · ") + U.timestampLabel(group.fetched_at));
        time.dateTime = group.fetched_at; footer.append(time); card.append(footer); host.append(card);
      }
    }
    const groups = data ? Object.values(data.groups) : [], count = groups.reduce((sum, group) => sum + group.events.length, 0);
    document.getElementById("polymarketStatus").textContent = !count ? "Les paris sont indisponibles pour le moment." :
      (copy || groups.some(group => group.fetch_status !== "fresh" || Date.now() - U.parseTimestamp(group.fetched_at) > 1800000) || count < 5 ?
        "Derniers relevés disponibles · les heures de collecte figurent sur chaque carte." : "3 paris finance par volume total · 2 paris politiques par volume sur 24 h.");
  }
  try {data = P.normalize(JSON.parse(localStorage.getItem(KEY))); copy = true; render();} catch {data = null;}
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch("data/polymarket.json?v=" + Date.now(), {cache:"no-store", signal:controller.signal});
        if (!response.ok) throw new Error("Polymarket indisponible");
        data = P.merge(data, await response.json()); copy = false;
        try {localStorage.setItem(KEY, JSON.stringify(data));} catch { /* Retain this session's snapshot. */ }
      } catch {copy = true;}
      finally {clearTimeout(timeout); render();}
    })();
    try {await pending;} finally {pending = null;}
  }
  document.getElementById("refreshButton").addEventListener("click", refresh);
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 300000);
  render(); refresh();
})();
