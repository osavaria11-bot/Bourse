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
