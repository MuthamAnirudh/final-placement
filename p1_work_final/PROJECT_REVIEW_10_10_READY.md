# Project Review — 10/10 Readiness Upgrade

## Scope
This release upgrades the existing Project Reviewer, Analysis & Insights, and review Results/Report workflow without removing or replacing existing modules. The Resume / Resume ATS component is preserved.

## Project Reviewer — reliability and correctness
- Deterministic evidence extraction is now used as a safety layer around AI scoring.
- AI scores are calibrated against observable evidence in the submitted profile and review stage.
- Missing evidence cannot silently become a high score.
- Final-stage dimensions receive stricter evidence caps than early-stage dimensions.
- Evidence Quality is reported separately from the rubric score.
- AI failures fall back automatically to the deterministic reviewer instead of leaving the reviewer stuck.
- Question-generation failures fall back to the built-in project question bank.
- Closing-panel AI failures retain the deterministic report.
- Navigation prevents entering an empty Report screen before a report exists.
- Project review reports now expose score provenance, evidence quality, and live-answer count.
- Markdown/PDF/report data remain compatible with the existing workflow.

## Analysis — advanced evidence model
- Uses existing Company Round, Project Review, and Viva history.
- Keeps readiness separate from Evidence Quality.
- Uses mean, median, spread/volatility, IQR, recency, source coverage and trajectory.
- Descriptive mean interval is withheld until at least five sessions to avoid over-interpreting tiny samples.
- Empty-state best-score handling is safe.
- AI receives aggregate facts only and remains an interpretation layer rather than the source of measured metrics.
- Exports methodology and metrics for auditability.

## Results — stronger interpretation
- Results display the score, verdict, evidence quality, score provenance and number of live answers.
- Rubric comments remain tied to each dimension.
- Strengths, gaps, risks, action plan, panel remarks and Q&A remain available.
- Results distinguish evidence-backed findings from AI interpretation.

## Validation
Passed:
- advancedFrontend.test.js
- analysisAdvanced.test.js
- securityHardening.test.js
- finalHardening.test.js
- frontendRegression.test.js
- production-audit.js
- modified application JavaScript syntax check
- backend syntax checks

The production browser vendor build remains an environment prerequisite because the current execution environment has no external network access to download the pinned third-party browser libraries. No fake vendor libraries were introduced.

## Real-time external Project Reviewer room

The Project Reviewer now supports a shared review room without removing the existing offline/AI panel review.

- Create a Room ID from **Project Reviewer → Real-time external review**.
- Publish the current project profile and README/report into the room.
- Upload PDF/TXT/MD/JSON/CSV/text evidence into the shared evidence package.
- Share the generated room link/Room ID with another reviewer.
- Reviewers can join with the Room ID, load the latest project/README snapshot, see uploaded evidence, and leave comments.
- Shared room updates are refreshed automatically every few seconds.
- Evidence and comments are timestamped and attributed to the reviewer name.
- The existing desk review, live panel, AI gateway, deterministic fallback, rubric, report, viva and history features remain unchanged.

### Recommended live-review evidence

1. Reviewer joins the Room ID.
2. Project owner publishes README + project profile.
3. Reviewer sees the package without re-uploading it.
4. Reviewer uploads a required evidence artifact.
5. Another reviewer observes the evidence appear automatically.
6. Reviewer leaves a comment; the other participant observes the comment update.
7. Reviewer loads the shared snapshot and runs the existing desk/live review.
