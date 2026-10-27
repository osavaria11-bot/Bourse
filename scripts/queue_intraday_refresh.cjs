"use strict";

// Each focused, independently published collection queues its successor.
// A new main commit or a failed Pages build must not stop the quote feed.
module.exports = async function queueRefresh({github, context, core, collectedAt,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const collected = Date.parse(collectedAt), initial = now();
  if (!Number.isFinite(collected) || collected > initial + 300000)
    throw new Error("Invalid collection time; refusing an unthrottled refresh loop");
  const repo = {owner: context.repo.owner, repo: context.repo.repo};
  // Always wait between attempts, including when the provider failed and the
  // start of the attempted run is used instead of a successful collection.
  await wait(Math.max(0, collected + 5 * 60000 - initial));
  if ([0, 6].includes(new Date(now()).getUTCDay())) {
    core.info("Weekend: keeping the dated last observations; weekday cron will restart the feed.");
    return "weekend";
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
