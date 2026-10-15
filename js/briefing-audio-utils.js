(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BriefingAudioUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clean = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  function narration(briefing, limit = 240) {
    if (!briefing || !/^\d{4}-\d{2}-\d{2}$/.test(briefing.edition_date || "") ||
        !Array.isArray(briefing.stories) || !briefing.stories.length) return null;
    const day = new Date(briefing.edition_date + "T12:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== briefing.edition_date) return null;
    const date = new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", day: "numeric", month: "long", year: "numeric"}).format(day);
    const sections = [{title: "Présentation", text: "Voici l’essentiel du matin de Savy. Édition du " + date + ". Les nouvelles qui comptent et leurs implications pour les marchés."}];
    for (const [index, story] of briefing.stories.slice(0, 6).entries()) {
      if (![story?.title, story?.summary, story?.impact].every(value => clean(value))) continue;
      sections.push({title: clean(story.title), text: "Nouvelle " + (index + 1) + ". " + clean(story.title) + ". " +
        clean(story.summary) + " Pour les marchés. " + clean(story.impact)});
    }
    if (sections.length === 1) return null;
    const watch = (Array.isArray(briefing.fred_watch) ? briefing.fred_watch : []).filter(item => clean(item.title) && clean(item.explanation));
    if (watch.length) sections.push({title: "Les graphiques à surveiller", text: "Les graphiques à surveiller. " +
      watch.map(item => clean(item.title) + ". " + clean(item.explanation)).join(" ")});
    sections.push({title: "Fin du briefing", text: "C’était l’essentiel du matin de Savy. Les sources et les graphiques sont disponibles dans le briefing."});
    const result = {text: "", chapters: [], chunks: []};
    const maximum = Math.floor(Math.max(80, Math.min(400, Number(limit) || 240)));
    for (const section of sections) {
      const text = section.text.replace(/\$\s*US\b/g, "dollars américains").replace(/\$\s*CA\b/g, "dollars canadiens").replace(/%/g, " pour cent");
      if (result.text) result.text += "\n\n";
      const base = result.text.length, chapter = result.chapters.length;
      result.text += text;
      result.chapters.push({title: section.title, start: base, end: base + text.length});
      for (let start = 0; start < text.length;) {
        while (/\s/.test(text[start] || "") && start < text.length) start++;
        if (start >= text.length) break;
        let end = Math.min(text.length, start + maximum);
        if (end < text.length) {
          const space = text.lastIndexOf(" ", end);
          if (space > start) end = space;
        }
        const part = text.slice(start, end).trimEnd();
        result.chunks.push({text: part, start: base + start, end: base + start + part.length, chapter});
        start = end;
      }
    }
    result.words = result.text.trim().split(/\s+/).length;
    return result;
  }
  function preferredVoice(voices) {
    const french = (voices || []).filter(voice => /^fr(?:[-_]|$)/i.test(voice.lang || ""));
    return french.find(voice => /^fr[-_]CA$/i.test(voice.lang)) || french.find(voice => voice.default) || french[0] || null;
  }
  function createPlayer({speech, Utterance, onChange = () => {}}) {
    const supported = !!speech && typeof speech.speak === "function" && typeof speech.cancel === "function" && typeof Utterance === "function";
    let content = null, position = 0, rate = 1, state = supported ? "empty" : "unavailable", generation = 0, active = null;
    function chapterIndex() {
      if (!content) return 0;
      const index = content.chapters.findIndex(chapter => chapter.end > position);
      return index < 0 ? content.chapters.length - 1 : index;
    }
    function snapshot() {
      return {supported, state, position, rate, speaking: active !== null, length: content?.text.length || 0,
        chapters: content?.chapters || [], chapter: chapterIndex(), words: content?.words || 0,
        seconds: content ? content.words / (155 * rate) * 60 : 0};
    }
    function emit() {onChange(snapshot());}
    function interrupt() {
      generation++; active = null;
      if (supported) try {speech.cancel();} catch { /* A new user gesture can retry. */ }
    }
    function speak() {
      if (!content || state !== "playing") return;
      const chunk = content.chunks.find(chunk => chunk.end > position);
      if (!chunk) {position = content.text.length; state = "ended"; active = null; emit(); return;}
      const start = Math.max(position, chunk.start), token = ++generation;
      let utterance;
      try {utterance = new Utterance(content.text.slice(start, chunk.end));} catch {state = "error"; emit(); return;}
      active = utterance; // Keep a strong reference until the voice finishes.
      utterance.lang = "fr-CA"; utterance.rate = rate; utterance.pitch = 1; utterance.volume = 1;
      let voices = [];
      try {voices = speech.getVoices?.() || [];} catch { /* Language selection still works without a voice list. */ }
      const voice = preferredVoice(voices);
      if (voice) {utterance.voice = voice; utterance.lang = voice.lang;}
      utterance.onboundary = event => {
        if (token !== generation || state !== "playing") return;
        if (Number.isFinite(event.charIndex)) position = Math.max(position, Math.min(chunk.end, start + event.charIndex));
        emit();
      };
      utterance.onend = () => {
        if (token !== generation || state !== "playing") return;
        position = chunk.end; active = null; emit(); speak();
      };
      utterance.onerror = () => {
        if (token !== generation || state !== "playing") return;
        state = "error"; active = null; emit();
      };
      position = start; emit();
      try {speech.resume?.(); speech.speak(utterance);} catch {state = "error"; active = null; emit();}
    }
    function play() {
      if (!supported || !content || state === "playing") return;
      if (position >= content.text.length) position = 0;
      interrupt(); state = "playing"; speak();
    }
    function pause() {
      if (state !== "playing") return;
      // Restart at the last spoken boundary on resume. This avoids relying on
      // native pause/resume queues that can remain stuck on mobile browsers.
      interrupt(); state = "paused"; emit();
    }
    function seek(value) {
      if (!supported || !content || !Number.isFinite(Number(value))) return;
      const playing = state === "playing";
      interrupt(); position = Math.max(0, Math.min(content.text.length, Math.floor(Number(value))));
      state = playing ? "playing" : position >= content.text.length ? "ended" : "paused";
      emit(); if (playing) speak();
    }
    function stop() {
      interrupt(); position = 0; state = !supported ? "unavailable" : content ? "ready" : "empty"; emit();
    }
    function setRate(value) {
      if (!Number.isFinite(Number(value))) return;
      const next = Math.max(.75, Math.min(2, Number(value)));
      if (next === rate) return;
      rate = next;
      if (state === "playing") {interrupt(); speak();} else emit();
    }
    function setBriefing(briefing) {
      const next = narration(briefing);
      // Quote refreshes and fetching an unchanged edition must not restart audio.
      if ((next?.text || "") === (content?.text || "")) return false;
      interrupt(); content = next; position = 0;
      state = !supported ? "unavailable" : content ? "ready" : "empty"; emit(); return true;
    }
    function selectChapter(index) {
      if (!content || !Number.isFinite(Number(index))) return;
      const chapter = content.chapters[Math.max(0, Math.min(content.chapters.length - 1, Math.floor(Number(index))))];
      seek(chapter.start);
    }
    emit();
    return {snapshot, setBriefing, play, pause, stop, seek, setRate, selectChapter,
      next: () => selectChapter(chapterIndex() + 1), previous: () => selectChapter(chapterIndex() - 1)};
  }
  return {narration, preferredVoice, createPlayer};
});
