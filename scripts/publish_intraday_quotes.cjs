"use strict";
const fs = require("node:fs"), I = require("../js/intraday-utils.js");
const BRANCH = "savy-live-quotes", FILE = "intraday-quotes.json";

// One public data file, on a separate branch. No Pages deployment, private
// positions, code changes, force pushes or writes to main are involved.
module.exports = async function publish({github, context, core,
  payload = JSON.parse(fs.readFileSync("data/intraday-quotes.json", "utf8")), now = Date.now()}) {
  const normalized = I.normalize(payload, now), generated = Date.parse(payload.generated_at);
  if (!normalized.quotes.length || normalized.quotes.length !== payload.quotes.length || now - generated > 10 * 60000)
    throw new Error("Refusing an invalid, empty or expired quote collection");
  const repo = {owner: context.repo.owner, repo: context.repo.repo};
  let parent = null, base_tree;
  try {
    parent = (await github.rest.git.getRef({...repo, ref: "heads/" + BRANCH})).data.object.sha;
  } catch (error) {if (error.status !== 404) throw error;}
  if (parent) {
    const previous = (await github.rest.repos.getContent({...repo, path: FILE, ref: parent})).data;
    const old = JSON.parse(Buffer.from(previous.content, "base64").toString("utf8"));
    if (old.kind !== "intraday_quotes") throw new Error("Unexpected independent branch content");
    if (Date.parse(old.generated_at) >= generated) {
      core.info("A newer collection is already public; retaining it."); return "newer_exists";
    }
    base_tree = (await github.rest.git.getCommit({...repo, commit_sha: parent})).data.tree.sha;
  }
  const data = {...payload, delivery: {channel: "independent", branch: BRANCH, workflow_run_id: context.runId}};
  const tree = (await github.rest.git.createTree({...repo, ...(base_tree ? {base_tree} : {}), tree: [
    {path: FILE, mode: "100644", type: "blob", content: JSON.stringify(data) + "\n"}
  ]})).data.sha;
  const commit = (await github.rest.git.createCommit({...repo, tree, parents: parent ? [parent] : [],
    message: "quotes: " + payload.generated_at})).data.sha;
  if (parent) await github.rest.git.updateRef({...repo, ref: "heads/" + BRANCH, sha: commit, force: false});
  else await github.rest.git.createRef({...repo, ref: "refs/heads/" + BRANCH, sha: commit});
  const delayed = normalized.quotes.filter(q => q.market_state === "regular" &&
    (q.fetch_status === "cached" || now - Date.parse(q.timestamp) > 30 * 60000));
  core.info("Independent quote feed published: " + normalized.quotes.length + " symbols, " + payload.generated_at);
  if (delayed.length) core.warning("Dated observations retained for delayed/illiquid symbols: " + delayed.map(q => q.id).join(", "));
  return "published";
};
