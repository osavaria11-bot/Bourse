"use strict";

// Dispatch is supported with GITHUB_TOKEN. Each source check or validated
// refresh queues its successor, so delayed calendar events or run indexing
// do not stop the feed. This dispatcher never authorizes quote publication.
module.exports = async function queueRefresh({github, context, core, sourceSha, collectedAt,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const collected = Date.parse(collectedAt), initial = now();
  if (!Number.isFinite(collected) || collected > initial + 300000)
    throw new Error("Invalid collection time; refusing an unthrottled refresh loop");
  const repo = {owner: context.repo.owner, repo: context.repo.repo};
  const current = async () => (await github.rest.repos.getBranch({...repo, branch: "main"})).data.commit.sha === sourceSha;
  if (!await current()) {
    core.info("Source changed; leaving the publication queue immediately.");
    return "source_changed";
  }
  // Always wait between attempts, including when the provider failed and the
  // start of the attempted run is used instead of a successful collection.
  await wait(Math.max(0, collected + 5 * 60000 - initial));
  if (!await current()) {
    core.info("Source changed; the validated full deployment will restart the feed.");
    return "source_changed";
  }
  const workflow_id = "intraday-quotes.yml";
  const {data} = await github.rest.actions.listWorkflowRuns({...repo, workflow_id, per_page: 100});
  const pending = data.workflow_runs.some(run => run.id !== context.runId && run.head_branch === "main" &&
    ["queued", "pending", "waiting", "requested", "in_progress"].includes(run.status));
  if (pending) {
    core.info("Another refresh is already queued; keeping one refresh chain.");
    return "already_queued";
  }
  await github.rest.actions.createWorkflowDispatch({...repo, workflow_id, ref: "main"});
  core.info("Next actual quote collection queued after the five-minute interval.");
  return "queued";
};
