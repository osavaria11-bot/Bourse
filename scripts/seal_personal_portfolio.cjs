"use strict";
// Private input and access links stay outside the public repository.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const P = require("../js/portfolio-utils.js"), A = require("../js/portfolio-profile-utils.js");
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/seal_personal_portfolio.cjs PRIVATE_INPUT PUBLIC_OUTPUT");
const root = path.resolve(__dirname, "..");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/securities.json"), "utf8"));
const positions = P.normalizePositions(input, catalog);
let key;
try {key = new URLSearchParams(new URL(input.savy_access.url).hash.slice(1)).get("portfolio-key");} catch { /* First creation. */ }
if (!A.validKey(key)) key = crypto.randomBytes(32).toString("base64url");
const profile = {schema_version: 1, kind: "encrypted_portfolio", algorithm: "AES-GCM", revision: new Date().toISOString()};
const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv);
cipher.setAAD(A.associatedData(profile));
const plaintext = JSON.stringify({schema_version: 1, base_currency: "CAD", as_of: input.as_of, positions});
const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
profile.iv = iv.toString("base64url"); profile.ciphertext = ciphertext.toString("base64url");
fs.writeFileSync(outputPath, JSON.stringify(profile, null, 2) + "\n");
input.savy_access = {url: A.personalURL("https://osavaria11-bot.github.io/Bourse/?v=20261010-portefeuille-direct", key), profile_revision: profile.revision};
fs.writeFileSync(inputPath, JSON.stringify(input, null, 2) + "\n");
console.log(positions.length + " positions intégrées dans le fichier public chiffré; lien conservé avec la sauvegarde privée.");
