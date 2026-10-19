"use strict";
// Called from the existing quote queue. Never publish an unvalidated source.
// A transient full-validation/deployment failure gets at most two retries.
module.exports = async function ensureValidatedSource({github, context, core, sourceSha}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || "")) throw new Error("Invalid source commit");
  const repo = {owner: context.repo.owner, repo: context.repo.repo};
  const {data} = await github.rest.actions.listWorkflowRuns({...repo, workflow_id: "static.yml", head_sha: sourceSha, per_page: 20});
  const runs = data.workflow_runs.filter(run => run.head_sha === sourceSha && run.head_branch === "main").sort((a, b) => b.id - a.id);
  const {data: ref} = await github.rest.git.getRef({...repo, ref: "heads/main"});
  if (ref.object.sha !== sourceSha) {core.info("Source superseded; waiting for current main validation."); return false;}
  if (runs.some(run => run.status === "completed" && run.conclusion === "success")) {
    core.info("Exact source already validated."); return true;
  }
  if (runs.some(run => run.status !== "completed")) {core.info("Full validation/publication already queued or running."); return false;}
  const failed = runs[0];
  if (failed?.conclusion === "failure" && Number.isInteger(failed.run_attempt) && failed.run_attempt >= 1 && failed.run_attempt < 3) {
    try {
      await github.request("POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs", {...repo, run_id: failed.id});
      core.info("Retry requested for failed validation/publication; attempt " + (failed.run_attempt + 1) + "/3. Published site kept.");
    } catch (error) {core.warning("Automatic publication retry unavailable: " + error.message);}
  } else if (failed?.conclusion === "failure") core.warning("Publication still failing after the retry limit; source remains blocked pending a fix.");
  else core.info("Waiting for full source validation; published site kept.");
  return false;
};
