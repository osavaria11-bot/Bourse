"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const U = require("../js/briefing-audio-utils.js");
const briefing = () => ({edition_date: "2026-10-15", generated_at: "2026-10-15T11:00:00Z",
  stories: [{title: "Résultats et croissance", summary: "Le chiffre publié augmente de 2 % pour atteindre 10 $ US.",
    impact: "Les nouvelles commandes et les marges éclairent la lecture des marchés.", source_url: "https://example.test/private-link"},
    {title: "La demande", summary: "Les consommateurs comparent les prix.", impact: "Les volumes restent à surveiller."}],
  fred_watch: [{title: "Les taux", explanation: "La hausse des taux modifie le coût du capital."}],
  positions: [{ticker: "PRIVATE", quantity: 999}]});
function fixture() {
  const speech = {calls: [], cancelled: 0, voices: [{lang: "en-US", default: true}, {lang: "fr-FR"}, {lang: "fr-CA"}],
    getVoices() {return this.voices;}, speak(u) {this.current = u; this.calls.push(u);},
    cancel() {this.cancelled++; this.current = null;}, resume() {}, pause() {throw Error("Native pause must not be required");}};
  class Utterance {constructor(text) {this.text = text;}}
  const states = [], player = U.createPlayer({speech, Utterance, onChange: state => states.push(state)});
  player.setBriefing(briefing());
  return {speech, states, player};
}
test("Narration reads only the published edition, stories and analysis, without links or positions", () => {
  const n = U.narration(briefing());
  assert.match(n.text, /15 octobre 2026/); assert.match(n.text, /Pour les marchés/);
  assert.match(n.text, /2\s+pour cent/); assert.match(n.text, /dollars américains/);
  assert.match(n.text, /coût du capital/); assert.doesNotMatch(n.text, /https:|PRIVATE|999/);
  assert.equal(n.chapters.length, 5);
  for (const bad of [null, {}, {...briefing(), edition_date: "2026-02-30"}, {...briefing(), stories: []}]) assert.equal(U.narration(bad), null);
});
test("Long editions are split into bounded utterances without losing text", () => {
  const b = briefing(); b.stories[0].summary = "Une nouvelle détaillée. ".repeat(400) + "x".repeat(450);
  const n = U.narration(b);
  assert.ok(n.chunks.length > 30); assert.ok(n.chunks.every(c => c.text.length > 0 && c.text.length <= 240));
  assert.equal(n.chunks.map(c => c.text).join(" ").replace(/\s+/g, " ").replace(/x x/g, "xx"), n.text.replace(/\s+/g, " "));
});
test("French Canadian is preferred, then another French voice; English is never forced", () => {
  assert.equal(U.preferredVoice([{lang: "en-US", default: true}, {lang: "fr-FR"}, {lang: "fr-CA"}]).lang, "fr-CA");
  assert.equal(U.preferredVoice([{lang: "en-US"}, {lang: "fr-FR"}]).lang, "fr-FR");
  assert.equal(U.preferredVoice([{lang: "en-US"}]), null);
});
test("Loading a briefing never autoplays; the user gesture starts French speech synchronously", () => {
  const f = fixture(); assert.equal(f.speech.calls.length, 0); assert.equal(f.player.snapshot().state, "ready");
  f.player.play(); assert.equal(f.speech.calls.length, 1); assert.equal(f.speech.current.lang, "fr-CA");
  assert.equal(f.player.snapshot().state, "playing"); assert.equal(f.player.snapshot().speaking, true);
});
test("Pause resumes from the spoken boundary and ignores late cancelled utterances", () => {
  const f = fixture(); f.player.play(); const old = f.speech.current;
  old.onboundary({charIndex: 25}); f.player.pause(); assert.equal(f.player.snapshot().position, 25);
  assert.equal(f.player.snapshot().state, "paused"); old.onend(); old.onerror();
  assert.equal(f.player.snapshot().state, "paused");
  f.player.play(); assert.equal(f.speech.current.text, old.text.slice(25));
});
test("Seeking, chapter selection and rate changes preserve playback control", () => {
  const f = fixture(); f.player.selectChapter(2); assert.equal(f.speech.calls.length, 0);
  assert.equal(f.player.snapshot().chapter, 2); f.player.play(); assert.match(f.speech.current.text, /Nouvelle 2/);
  f.player.setRate(1.5); assert.equal(f.speech.current.rate, 1.5); assert.equal(f.player.snapshot().chapter, 2);
  f.player.previous(); assert.equal(f.player.snapshot().chapter, 1); f.player.next(); assert.equal(f.player.snapshot().chapter, 2);
  f.player.stop(); assert.equal(f.player.snapshot().position, 0); assert.equal(f.player.snapshot().state, "ready");
});
test("An unchanged fetched edition cannot interrupt ongoing audio or reset progress", () => {
  const f = fixture(); f.player.play(); f.speech.current.onboundary({charIndex: 20});
  const calls = f.speech.calls.length, cancelled = f.speech.cancelled;
  assert.equal(f.player.setBriefing({...briefing(), generated_at: "2026-10-15T12:00:00Z"}), false);
  assert.equal(f.speech.cancelled, cancelled); assert.equal(f.speech.calls.length, calls); assert.equal(f.player.snapshot().position, 20);
});
test("A changed edition stops the previous reading and waits for a new user gesture", () => {
  const f = fixture(); f.player.play(); const old = f.speech.current;
  f.player.setBriefing({...briefing(), edition_date: "2026-10-16"}); old.onend();
  assert.equal(f.player.snapshot().position, 0); assert.equal(f.player.snapshot().state, "ready");
  f.player.setBriefing(null); assert.equal(f.player.snapshot().length, 0); assert.equal(f.player.snapshot().state, "empty");
});
test("All chunks finish cleanly and replay starts from the introduction", () => {
  const f = fixture(); f.player.play(); let count = 0;
  while (f.player.snapshot().state === "playing" && count++ < 100) f.speech.current.onend();
  assert.equal(f.player.snapshot().state, "ended"); assert.equal(f.player.snapshot().position, f.player.snapshot().length);
  f.player.play(); assert.match(f.speech.current.text, /Voici l’essentiel/);
});
test("Voice errors are retryable, and unavailable or late-loading voice lists do not crash", () => {
  const f = fixture(); f.speech.voices = []; f.player.play(); assert.equal(f.speech.current.lang, "fr-CA");
  f.speech.current.onerror({error: "not-allowed"}); assert.equal(f.player.snapshot().state, "error");
  f.speech.getVoices = () => {throw Error("not ready");}; f.player.play(); assert.equal(f.player.snapshot().state, "playing");
  const unsupported = U.createPlayer({speech: null, Utterance: null}); unsupported.setBriefing(briefing()); unsupported.play();
  assert.equal(unsupported.snapshot().state, "unavailable");
});

function oralEdition() {
  const b = briefing();
  b.audio_script = {edition_date: b.edition_date, source_generated_at: b.generated_at,
    intro: "Bonjour. Voici notre version orale du quinze octobre.",
    stories: b.stories.map((story, index) => ({title: story.title, text: "Voici ce qui change dans le sujet " + index + ". Une explication distincte, préparée pour être écoutée et comprendre les implications."})),
    watch: "Regardons les taux en conservant leur vraie date d’observation.", outro: "Bonne journée. Les sources sont dans le texte."};
  return b;
}
function manifestFor(b) {
  const n = U.narration(b);
  return {schema_version: 1, kind: "briefing_audio", text: n.text,
    src: "data/audio/briefing-" + "a".repeat(24) + ".mp3", duration: n.chapters.length * 20,
    voice_label: "Sylvie · Français (Canada)",
    chapters: n.chapters.map((chapter, index) => ({...chapter, time_start: index * 20, time_end: (index + 1) * 20}))};
}
class Media extends EventTarget {
  constructor() {super(); this.currentTime = 0; this.readyState = 1; this.plays = 0; this.pauses = 0; this.src = "";}
  play() {this.plays++; return Promise.resolve();}
  pause() {this.pauses++;}
  removeAttribute(name) {if (name === "src") this.src = "";}
  fire(name) {this.dispatchEvent(new Event(name));}
}
test("A separately written oral edition is used only for its matching written edition", () => {
  const b = oralEdition(), n = U.narration(b);
  assert.equal(n.adapted, true); assert.match(n.text, /version orale/);
  assert.doesNotMatch(n.text, /Le chiffre publié augmente/);
  assert.deepEqual(n.chapters.slice(1, 3).map(c => c.title), b.stories.map(s => s.title));
  b.generated_at = "2026-10-15T12:00:00Z";
  assert.equal(U.narration(b).adapted, false, "An old script cannot narrate a newer revision");
  b.audio_script.source_generated_at = b.generated_at; b.audio_script.stories[0].title = "Other story";
  assert.equal(U.narration(b).adapted, false);
});
test("Natural playback uses the MP3 and its chapter timings without requiring device speech", () => {
  const b = oralEdition(), media = new Media(), player = U.createPlayer({media});
  player.setBriefing(b); assert.equal(player.snapshot().supported, false);
  assert.equal(player.setAudio(manifestFor(b)), true); assert.equal(player.snapshot().supported, true);
  assert.equal(player.snapshot().adapted, true); assert.equal(media.plays, 0, "Loading never autoplays");
  player.play(); assert.equal(media.plays, 1); assert.equal(player.snapshot().engine, "neural");
  player.selectChapter(2); assert.equal(media.currentTime, 40); assert.equal(player.snapshot().chapter, 2);
  const plays = media.plays; player.setRate(1.5); assert.equal(media.playbackRate, 1.5); assert.equal(media.plays, plays);
  media.currentTime = 50; media.fire("timeupdate"); assert.equal(player.snapshot().chapter, 2);
  assert.ok(Math.abs(player.snapshot().elapsed - 50) < .2);
  const position = player.snapshot().position; player.pause(); media.fire("ended");
  assert.equal(player.snapshot().state, "paused"); assert.equal(player.snapshot().position, position);
  player.play(); assert.ok(Math.abs(media.currentTime - 50) < .2);
  media.fire("ended"); assert.equal(player.snapshot().state, "ended");
  player.play(); assert.equal(media.currentTime, 0); player.stop(); assert.equal(player.snapshot().state, "ready");
});
test("Unmatched audio, incomplete timings and external media URLs are rejected", () => {
  const b = briefing(), n = U.narration(b), valid = manifestFor(b);
  for (const invalid of [{...valid, text: "Yesterday’s edition"}, {...valid, src: "https://other.test/tracker.mp3"},
    {...valid, duration: Infinity}, {...valid, chapters: valid.chapters.slice(1)},
    {...valid, chapters: valid.chapters.map((c, i) => i === 1 ? {...c, time_start: 0} : c)}]) assert.equal(U.audioManifest(invalid, n), null);
  const media = new Media(), player = U.createPlayer({media}); player.setBriefing(b); player.setAudio(valid); player.play();
  player.setBriefing({...b, edition_date: "2026-10-16"}); media.fire("ended");
  assert.equal(player.snapshot().natural, false); assert.equal(player.snapshot().state, "unavailable");
  assert.equal(player.setAudio(valid), false);
});
test("A late MP3 preserves current speech and becomes active on the next resume", () => {
  const media = new Media(), speech = fixture().speech;
  class Utterance {constructor(text) {this.text = text;}}
  const player = U.createPlayer({speech, Utterance, media}); player.setBriefing(briefing()); player.play();
  speech.current.onboundary({charIndex: 25}); const calls = speech.calls.length;
  player.setAudio(manifestFor(briefing())); assert.equal(speech.calls.length, calls); assert.equal(media.plays, 0);
  assert.equal(player.snapshot().engine, "device"); player.pause(); player.play();
  assert.equal(player.snapshot().engine, "neural"); assert.equal(player.snapshot().position, 25); assert.equal(media.plays, 1);
});
test("High quality French voices are preferred for device fallback", () => {
  assert.equal(U.preferredVoice([{lang: "fr-CA", name: "Basic"}, {lang: "fr-FR", name: "Thomas (Premium)"}]).name, "Thomas (Premium)");
});
