(() => {
  "use strict";
  const root = document.getElementById("panel-portefeuilles-analysis");
  if (!root) return;
  const KEY = "savy:portfolio-private-briefings:v1";
  const LIMIT = 12, MAX_LENGTH = 30000;
  const $ = selector => root.querySelector(selector);
  const title = $("#portfolioBriefingLatestTitle"), status = $("#portfolioBriefingStatus");
  const content = $("#portfolioBriefingContent"), archive = $("#portfolioBriefingArchives");
  const dateField = $("#portfolioBriefingDate"), textField = $("#portfolioBriefingText");
  const formStatus = $("#portfolioBriefingFormStatus");
  const form = root.querySelector(".portfolio-briefing-form");
  function validDate(value) {
    if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T12:00:00Z");
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
  }
  function dayLabel(value) {
    return new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", day: "numeric", month: "long", year: "numeric"}).format(new Date(value + "T12:00:00Z"));
  }
  function editions() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter(x => x && validDate(x.date) && typeof x.text === "string" &&
        x.text.trim() && x.text.length <= MAX_LENGTH).slice(0, LIMIT).sort((a,b) => b.date.localeCompare(a.date));
    } catch {return [];}
  }
  let selectedDate = null;
  function show() {
    const entries = editions(), current = entries.find(x => x.date === selectedDate) || entries[0];
    title.textContent = current ? "Revue du " + dayLabel(current.date) : "Première édition à venir";
    status.textContent = current ? "Rapport privé conservé dans ce navigateur · " + (entries.length === 1 ? "1 édition" : entries.length + " éditions") :
      "Aucune édition privée enregistrée dans SAVY pour le moment. La première revue est programmée le mardi.";
    content.textContent = current ? current.text : "";
    archive.replaceChildren();
    if (!entries.length) {
      const p = document.createElement("p"); p.className = "portal-empty";
      p.textContent = "Aucune édition précédente disponible sur cet appareil.";
      archive.append(p); return;
    }
    for (const entry of entries) {
      const row = document.createElement("div"); row.className = "portal-briefing-archive-row portfolio-briefing-archive-row";
      const button = document.createElement("button"); button.type = "button";
      button.textContent = "Édition du " + dayLabel(entry.date);
      button.dataset.briefingDate = entry.date;
      if (current?.date === entry.date) button.setAttribute("aria-current", "true");
      const meta = document.createElement("span"); meta.className = "meta";
      meta.textContent = current?.date === entry.date ? "Affichée" : "Consulter";
      row.append(button,meta);archive.append(row);
    }
  }
  archive.addEventListener("click", event => {
    const button = event.target.closest("button[data-briefing-date]");
    if (!button) return;
    selectedDate = button.dataset.briefingDate;
    show();
    title.scrollIntoView({block:"nearest", behavior:"auto"});
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const date = dateField.value, text = textField.value.trim();
    if (!validDate(date) || !text || text.length > MAX_LENGTH) {
      formStatus.textContent = "Indique une date valide et un texte de 30 000 caractères au maximum.";return;
    }
    const entries = editions().filter(x => x.date !== date);
    entries.unshift({date, text});
    entries.sort((a,b) => b.date.localeCompare(a.date));
    try {localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));}
    catch {formStatus.textContent = "Enregistrement impossible sur cet appareil (stockage indisponible ou plein).";return;}
    selectedDate = date;
    formStatus.textContent = "Édition enregistrée localement. Aucune information envoyée à GitHub.";
    textField.value = "";
    show();
  });
  try {
    dateField.value = new Intl.DateTimeFormat("sv-SE", {timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  } catch {dateField.value = new Date().toISOString().slice(0,10);}
  show();
})();
