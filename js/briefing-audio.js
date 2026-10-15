(() => {
  "use strict";
  const U = window.BriefingAudioUtils, $ = id => document.getElementById(id);
  if (!U || !$("briefingAudio")) return;
  const play = $("briefingAudioPlay"), chapter = $("briefingAudioChapter"), speed = $("briefingAudioRate"), progress = $("briefingAudioProgress");
  const setting = "savy:briefing-audio:rate:v1";
  let chapterSignature = "";
  function time(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return Math.floor(rounded / 60) + ":" + String(rounded % 60).padStart(2, "0");
  }
  function paint(state) {
    const available = state.supported && state.length > 0, playing = state.state === "playing";
    play.disabled = !available;
    play.textContent = playing ? "Ⅱ Pause" : state.state === "ended" ? "▶ Réécouter" : state.position > 0 || state.state === "paused" ? "▶ Reprendre" : "▶ Écouter le briefing";
    play.setAttribute("aria-pressed", String(playing));
    $("briefingAudioStop").disabled = !available || state.state === "ready";
    $("briefingAudioPrevious").disabled = !available || state.chapter === 0;
    $("briefingAudioNext").disabled = !available || state.chapter >= state.chapters.length - 1;
    chapter.disabled = !available; speed.disabled = !available; progress.disabled = !available;
    const signature = JSON.stringify(state.chapters.map(c => c.title));
    if (signature !== chapterSignature) {
      chapterSignature = signature;
      chapter.replaceChildren(...state.chapters.map((c, i) => {const option = document.createElement("option"); option.value = String(i); option.textContent = c.title; return option;}));
    }
    chapter.value = String(state.chapter); speed.value = String(state.rate);
    progress.max = String(state.length || 1); progress.value = String(state.position);
    const elapsed = state.elapsed;
    $("briefingAudioTime").textContent = (state.natural ? "" : "≈ ") + time(elapsed) + " / " + time(state.seconds);
    progress.setAttribute("aria-valuetext", (state.natural ? "" : "Environ ") + time(elapsed) + " sur " + time(state.seconds));
    const status = !state.supported ? "La lecture vocale n’est pas disponible dans ce navigateur." : !state.length ? "Écoute disponible après le chargement du briefing." :
      state.state === "playing" ? "Lecture · " + state.chapters[state.chapter].title : state.state === "paused" ? "En pause · " + state.chapters[state.chapter].title :
      state.state === "error" ? "La lecture s’est interrompue. Relance-la avec le bouton de lecture." : state.state === "ended" ? "Briefing terminé." :
      state.natural ? "Voix naturelle · Français canadien" : "Français · voix de l’appareil";
    $("briefingAudioStatus").textContent = status;
    $("briefingAudioNote").textContent = state.natural ? "Sylvie · voix de synthèse en français canadien. " +
      (state.adapted ? "Une version écrite spécialement pour l’écoute." : "Le briefing et son analyse en audio.") :
      "La voix de l’appareil prend le relais lorsque l’audio naturel n’est pas disponible. Garde cette page ouverte pendant l’écoute.";
  }
  let media;
  try {media = new Audio();} catch { /* Device speech remains available. */ }
  const player = U.createPlayer({speech: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance, media, onChange: paint});
  try {const rate = Number(localStorage.getItem(setting)); if ([.75, 1, 1.25, 1.5, 1.75, 2].includes(rate)) player.setRate(rate);} catch { /* Session controls remain usable. */ }
  play.addEventListener("click", () => player.snapshot().state === "playing" ? player.pause() : player.play());
  $("briefingAudioStop").addEventListener("click", player.stop);
  $("briefingAudioPrevious").addEventListener("click", player.previous);
  $("briefingAudioNext").addEventListener("click", player.next);
  chapter.addEventListener("change", () => player.selectChapter(Number(chapter.value)));
  progress.addEventListener("change", () => player.seek(Number(progress.value)));
  speed.addEventListener("change", () => {player.setRate(Number(speed.value)); try {localStorage.setItem(setting, speed.value);} catch { /* Optional preference. */ }});
  window.addEventListener("pagehide", () => {if (player.snapshot().engine !== "neural") player.pause();});
  let request = 0;
  function setBriefing(briefing) {
    const changed = player.setBriefing(briefing);
    if (!player.snapshot().length) {request++; return changed;}
    if (changed || !player.snapshot().natural) {
      const token = ++request;
      fetch("data/briefing-audio.json", {cache: "no-store", signal: AbortSignal.timeout(12000)})
        .then(response => {if (!response.ok) throw Error("Audio unavailable"); return response.json();})
        .then(manifest => {if (token === request) player.setAudio(manifest);})
        .catch(() => { /* A missing MP3 must not hide the current written edition or disable device speech. */ });
    }
    return changed;
  }
  window.SavyBriefingAudio = {setBriefing, snapshot: player.snapshot};
})();
