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
  // Workflow concurrency permits one running and one pending refresh. The
  // runs API can still list a stranded run as queued long after newer runs
  // have completed, so its status cannot decide whether to dispatch.
  await github.rest.actions.createWorkflowDispatch({...repo, workflow_id: "intraday-quotes.yml", ref: "main"});
  core.info("Next actual quote collection queued after the five-minute interval.");
  return "queued";
};
