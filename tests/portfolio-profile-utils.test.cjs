"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const A = require("../js/portfolio-profile-utils.js");
function fixture() {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const profile = {schema_version: 1, kind: "encrypted_portfolio", algorithm: "AES-GCM", revision: "synthetic-v1"};
  const portfolio = {positions: [{ticker: "V", quantity: 1.5, currency: "USD", average_cost: 350}]};
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(A.associatedData(profile));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(portfolio)), cipher.final(), cipher.getAuthTag()]);
  return {key: key.toString("base64url"), portfolio, profile: {...profile, iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url")}};
}
test("An integrated profile opens only with its personal key and keeps fractional holdings", async () => {
  const f = fixture();
  assert.deepEqual(await A.unlock(f.profile, f.key), f.portfolio);
  await assert.rejects(A.unlock(f.profile, crypto.randomBytes(32).toString("base64url")));
});
test("Tampered contents, revisions and invalid envelopes never authenticate", async () => {
  const f = fixture(), ciphertext = Buffer.from(f.profile.ciphertext, "base64url"); ciphertext[0] ^= 1;
  for (const altered of [{...f.profile, ciphertext: ciphertext.toString("base64url")}, {...f.profile, revision: "synthetic-v2"},
    {...f.profile, algorithm: "plain"}, {...f.profile, iv: "AA"}, null]) await assert.rejects(A.unlock(altered, f.key));
  assert.equal(A.validKey(""), false); assert.equal(A.validKey("<bad>"), false);
});
test("The personal Home Screen URL retains access in its fragment and uses the same site scope", () => {
  const f = fixture(), page = "https://example.test/Bourse/index.html?v=123#portfolio";
  const manifest = A.homeManifest(page, f.key), url = new URL(manifest.start_url);
  assert.equal(url.pathname, "/Bourse/"); assert.equal(url.search, "?v=123");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("portfolio-key"), f.key);
  assert.equal(manifest.scope, "https://example.test/Bourse/"); assert.equal(manifest.display, "standalone");
  assert.throws(() => A.personalURL(page, "invalid"));
});
for (const portfolioId of ["2", "3"]) test("profile " + portfolioId + " binds its portfolio ID to authentication and its Home Screen selection", async () => {
  const f = fixture(), profile = {...f.profile, portfolio_id: portfolioId}, iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(f.key, "base64url"), iv); cipher.setAAD(A.associatedData(profile));
  const content = {...f.portfolio, portfolio_id: portfolioId, benchmark: portfolioId === "3" ? "VGRO" : "VBAL"};
  profile.iv = iv.toString("base64url"); profile.ciphertext = Buffer.concat([cipher.update(JSON.stringify(content)), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  assert.deepEqual(await A.unlock(profile, f.key), content);
  await assert.rejects(A.unlock({...profile, portfolio_id: "1"}, f.key));
  await assert.rejects(A.unlock({...profile, portfolio_id: portfolioId === "2" ? "3" : "2"}, f.key));
  await assert.rejects(A.unlock({...profile, portfolio_id: undefined}, f.key));
  const manifest = A.homeManifest("https://example.test/Bourse/", f.key, portfolioId), params = new URLSearchParams(new URL(manifest.start_url).hash.slice(1));
  assert.equal(params.get("portfolio"), portfolioId); assert.equal(params.get("portfolio-key"), f.key); assert.equal(manifest.scope, "https://example.test/Bourse/");
});
