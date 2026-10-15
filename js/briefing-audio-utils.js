(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BriefingAudioUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clean = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  function oralScript(briefing) {
    const script = briefing?.audio_script;
    if (!script || script.edition_date !== briefing.edition_date || script.source_generated_at !== briefing.generated_at ||
        ![script.intro, script.watch, script.outro].every(clean) || !Array.isArray(script.stories) ||
        script.stories.length !== briefing.stories?.length ||
        !script.stories.every((item, index) => clean(item?.text) && item.title === briefing.stories[index].title)) return null;
    return script;
  }
  function narration(briefing, limit = 240) {
    if (!briefing || !/^\d{4}-\d{2}-\d{2}$/.test(briefing.edition_date || "") ||
        !Array.isArray(briefing.stories) || !briefing.stories.length) return null;
    const day = new Date(briefing.edition_date + "T12:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== briefing.edition_date) return null;
    const date = new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", day: "numeric", month: "long", year: "numeric"}).format(day);
    const script = oralScript(briefing);
    const sections = [{title: "Présentation", text: script ? clean(script.intro) : "Voici l’essentiel du matin de Savy. Édition du " + date + ". Les nouvelles qui comptent et leurs implications pour les marchés."}];
    for (const [index, story] of briefing.stories.slice(0, 6).entries()) {
      if (![story?.title, story?.summary, story?.impact].every(value => clean(value))) continue;
      sections.push({title: clean(story.title), text: script ? clean(script.stories[index].text) :
        "Nouvelle " + (index + 1) + ". " + clean(story.title) + ". " + clean(story.summary) + " Pour les marchés. " + clean(story.impact)});
    }
    if (sections.length === 1) return null;
    const watch = (Array.isArray(briefing.fred_watch) ? briefing.fred_watch : []).filter(item => clean(item.title) && clean(item.explanation));
    if (watch.length) sections.push({title: "Les graphiques à surveiller", text: script ? clean(script.watch) : "Les graphiques à surveiller. " +
      watch.map(item => clean(item.title) + ". " + clean(item.explanation)).join(" ")});
    sections.push({title: "Fin du briefing", text: script ? clean(script.outro) : "C’était l’essentiel du matin de Savy. Les sources et les graphiques sont disponibles dans le briefing."});
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
    result.adapted = !!script;
    return result;
  }
  function preferredVoice(voices) {
    const french = (voices || []).filter(voice => /^fr(?:[-_]|$)/i.test(voice.lang || ""));
    const score = voice => (/neural|natural|premium|enhanced|amélior|superieur|supérieur/i.test(voice.name || "") ? 100 : 0) +
      (/^fr[-_]CA$/i.test(voice.lang) ? 20 : 0) + (voice.default ? 5 : 0);
    return french.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function audioManifest(value, content) {
    if (!content || !value || value.schema_version !== 1 || value.kind !== "briefing_audio" || value.text !== content.text ||
        !/^data\/audio\/briefing-[a-f0-9]{24}\.mp3$/.test(value.src || "") ||
        !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 7200 ||
        !Array.isArray(value.chapters) || value.chapters.length !== content.chapters.length) return null;
    let previous = 0;
    for (const [index, item] of value.chapters.entries()) {
      const chapter = content.chapters[index];
      if (item.title !== chapter.title || item.start !== chapter.start || item.end !== chapter.end ||
          !Number.isFinite(item.time_start) || !Number.isFinite(item.time_end) ||
          Math.abs(item.time_start - previous) > .01 || item.time_end <= item.time_start || item.time_end > value.duration + .01) return null;
      previous = item.time_end;
    }
    return Math.abs(previous - value.duration) <= .01 ? value : null;
  }
  function createPlayer({speech, Utterance, media, onChange = () => {}}) {
    const supported = !!speech && typeof speech.speak === "function" && typeof speech.cancel === "function" && typeof Utterance === "function";
    const mediaSupported = !!media && typeof media.play === "function" && typeof media.pause === "function" && typeof media.addEventListener === "function";
    let content = null, position = 0, rate = 1, state = supported ? "empty" : "unavailable", generation = 0, active = null;
    let audio = null, engine = "device", pendingSeek = null;
    function timeAt(value) {
      if (!audio) return 0;
      const item = audio.chapters.find(item => item.end > value);
      if (!item) return audio.duration;
      return item.time_start + Math.max(0, Math.min(1, (value - item.start) / (item.end - item.start))) * (item.time_end - item.time_start);
    }
    function positionAt(seconds) {
      const item = audio?.chapters.find(item => item.time_end > seconds);
      if (!item) return content?.text.length || 0;
      return Math.floor(item.start + Math.max(0, Math.min(1, (seconds - item.time_start) / (item.time_end - item.time_start))) * (item.end - item.start));
    }
    function seekMedia() {
      pendingSeek = timeAt(position);
      if (media.readyState > 0) {media.currentTime = pendingSeek; pendingSeek = null;}
    }
    function chapterIndex() {
      if (!content) return 0;
      const index = content.chapters.findIndex(chapter => chapter.end > position);
      return index < 0 ? content.chapters.length - 1 : index;
    }
    function snapshot() {
      const seconds = audio ? audio.duration : content ? content.words / (155 * rate) * 60 : 0;
      return {supported: supported || !!audio, state, position, rate, speaking: active !== null || engine === "neural" && state === "playing", length: content?.text.length || 0,
        chapters: content?.chapters || [], chapter: chapterIndex(), words: content?.words || 0,
        seconds, elapsed: audio ? timeAt(position) : content ? seconds * position / content.text.length : 0,
        engine, natural: !!audio, adapted: !!content?.adapted, voice: audio?.voice_label || "Voix de l’appareil"};
    }
    function emit() {onChange(snapshot());}
    function interrupt() {
      generation++; active = null;
      if (mediaSupported) {media.pause(); pendingSeek = null;}
      if (supported) try {speech.cancel();} catch { /* A new user gesture can retry. */ }
    }
    function start() {
      if (!audio) {engine = "device"; speak(); return;}
      engine = "neural";
      const token = ++generation;
      const failed = () => {if (token === generation && state === "playing") {state = "error"; emit();}};
      try {
        if (media.error) media.load?.();
        media.playbackRate = rate; seekMedia();
        const promise = media.play();
        promise?.catch(failed); emit();
      } catch {failed();}
    }
    if (mediaSupported) {
      media.addEventListener("loadedmetadata", () => {
        if (!audio || pendingSeek === null) return;
        try {media.currentTime = pendingSeek; pendingSeek = null;} catch { /* Retry on the next user gesture. */ }
      });
      media.addEventListener("timeupdate", () => {
        if (!audio || engine !== "neural" || state !== "playing" || pendingSeek !== null) return;
        position = positionAt(media.currentTime); emit();
      });
      media.addEventListener("ended", () => {
        if (!audio || engine !== "neural" || state !== "playing") return;
        position = content.text.length; state = "ended"; emit();
      });
      media.addEventListener("error", () => {
        if (!audio || engine !== "neural" || state !== "playing") return;
        state = "error"; emit();
      });
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
      if (!(supported || audio) || !content || state === "playing") return;
      if (position >= content.text.length) position = 0;
      interrupt(); state = "playing"; start();
    }
    function pause() {
      if (state !== "playing") return;
      // Restart at the last spoken boundary on resume. This avoids relying on
      // native pause/resume queues that can remain stuck on mobile browsers.
      interrupt(); state = "paused"; if (audio) engine = "neural"; emit();
    }
    function seek(value) {
      if (!(supported || audio) || !content || !Number.isFinite(Number(value))) return;
      const playing = state === "playing";
      interrupt(); position = Math.max(0, Math.min(content.text.length, Math.floor(Number(value))));
      state = playing ? "playing" : position >= content.text.length ? "ended" : "paused";
      emit(); if (playing) start();
    }
    function stop() {
      interrupt(); position = 0; state = !(supported || audio) ? "unavailable" : content ? "ready" : "empty"; emit();
    }
    function setRate(value) {
      if (!Number.isFinite(Number(value))) return;
      const next = Math.max(.75, Math.min(2, Number(value)));
      if (next === rate) return;
      rate = next;
      if (state === "playing" && engine === "neural") {media.playbackRate = rate; emit();}
      else if (state === "playing") {interrupt(); start();} else emit();
    }
    function setBriefing(briefing) {
      const next = narration(briefing);
      // Quote refreshes and fetching an unchanged edition must not restart audio.
      if ((next?.text || "") === (content?.text || "")) return false;
      interrupt(); content = next; position = 0; audio = null; engine = "device";
      if (mediaSupported) media.removeAttribute?.("src");
      state = !supported ? "unavailable" : content ? "ready" : "empty"; emit(); return true;
    }
    function setAudio(value) {
      const next = mediaSupported ? audioManifest(value, content) : null;
      if (!next || audio?.src === next.src) return false;
      audio = next; media.preload = "metadata"; media.src = next.src;
      // Do not interrupt a reading already started while the MP3 was loading.
      if (state !== "playing") {engine = "neural"; if (state === "unavailable") state = "ready";}
      emit(); return true;
    }
    function selectChapter(index) {
      if (!content || !Number.isFinite(Number(index))) return;
      const chapter = content.chapters[Math.max(0, Math.min(content.chapters.length - 1, Math.floor(Number(index))))];
      seek(chapter.start);
    }
    emit();
    return {snapshot, setBriefing, setAudio, play, pause, stop, seek, setRate, selectChapter,
      next: () => selectChapter(chapterIndex() + 1), previous: () => selectChapter(chapterIndex() - 1)};
  }
  return {narration, oralScript, audioManifest, preferredVoice, createPlayer};
});
