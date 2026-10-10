(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PortfolioProfileUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function bytes(encoded) {
    if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Lien personnel invalide");
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function validKey(key) {
    try {return typeof key === "string" && key.length === 43 && bytes(key).length === 32;} catch {return false;}
  }
  function associatedData(profile) {
    return new TextEncoder().encode(profile.kind + ":" + profile.schema_version + ":" + profile.revision);
  }
  async function unlock(profile, key) {
    if (!validKey(key) || profile?.schema_version !== 1 || profile.kind !== "encrypted_portfolio" ||
        profile.algorithm !== "AES-GCM" || typeof profile.revision !== "string" || !profile.revision || profile.revision.length > 100 ||
        typeof profile.ciphertext !== "string" || profile.ciphertext.length > 140000) throw new Error("Portefeuille intégré invalide");
    const iv = bytes(profile.iv), ciphertext = bytes(profile.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16) throw new Error("Portefeuille intégré invalide");
    if (!globalThis.crypto?.subtle) throw new Error("Ouvre le lien personnel dans un navigateur récent");
    try {
      const secret = await globalThis.crypto.subtle.importKey("raw", bytes(key), {name: "AES-GCM"}, false, ["decrypt"]);
      const content = await globalThis.crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: associatedData(profile)}, secret, ciphertext);
      return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(content));
    } catch {throw new Error("Ce lien personnel ne peut pas ouvrir le portefeuille intégré");}
  }
  function personalURL(pageURL, key) {
    if (!validKey(key)) throw new Error("Lien personnel invalide");
    const url = new URL(".", pageURL);
    const release = new URL(pageURL).searchParams.get("v");
    if (release) url.searchParams.set("v", release);
    url.hash = "portfolio-key=" + key;
    return url.href;
  }
  function homeManifest(pageURL, key) {
    const base = new URL(".", pageURL).href;
    return {name: "SAVY · Mon portefeuille", short_name: "SAVY", lang: "fr-CA", id: base,
      start_url: personalURL(pageURL, key), scope: base, display: "standalone",
      background_color: "#0b121b", theme_color: "#0b121b"};
  }
  return {validKey, associatedData, unlock, personalURL, homeManifest};
});
