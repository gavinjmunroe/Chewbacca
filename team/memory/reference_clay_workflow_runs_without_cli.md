---
name: reference_clay_workflow_runs_without_cli
description: A Clay workflow test run is one POST the frontend session can send, so chewbacca clay verify-emails needs no clay CLI login; an allowance never covers a workflow picked by name
metadata:
  type: reference
---

`clay workflows runs test WF --inputs -` sends `POST /v3/workspaces/:ws/tc-workflows/:wf/runs` with body `{inputs}` (contract createWorkflowRun, read from the clay CLI 1.9.1 binary on 2026-10-17). `GET .../runs/:runId` (getWorkflowRun) returns `workflowRunSteps`, each with nodeName, status and stepOutputs. Both are in library/clay-api/clay.json as createWorkflowTestRun and getWorkflowRunSteps, so a run works through the api-anything session even when the CLI login has expired (it had on 2026-10-17).

`chewbacca clay verify-emails` replaced zeutara-gtme scripts/zb_verify.py, which launch-guard and clay-native-guard both refused on 2026-10-16 and left Monday's list unverified. It prices the batch with workflow-cost, skips addresses already in out= or marked verified=valid in csv= (42 of 141 Monday rows), and gets one ok for the whole list.

A security review on the same day found that a standing allowance covered `write:spends-credits`, so it would have run any workflow, including one whose name only contains "verify". So workflow-test-run is in ALLOWANCE_NEVER, and verify-emails uses the allowance only for the workflow listed in VERIFY_WORKFLOWS. Any other workflow= needs Caleb's ok.
