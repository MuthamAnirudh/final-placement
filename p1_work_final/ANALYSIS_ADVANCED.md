# Advanced Analysis & Insights Upgrade

The existing Mock Interview Studio **Insights** mode has been upgraded in place to **Analysis & Insights**. No new top-level tab was created.

## Analysis layers

- Deterministic evidence aggregation across Company Rounds, Project Reviews and Viva sessions.
- Readiness decomposition using the existing weighted readiness model.
- Median, mean, volatility, consistency and five-vs-five momentum analysis.
- Evidence confidence based on session volume, mode coverage and recency; this is an evidence-quality indicator, not a prediction.
- Multi-modal evidence matrix showing sessions, latest score, average, best score, change and signal per mode.
- Risk/anomaly radar for evidence gaps, instability and stale data.
- Decision-grade action engine that routes the student to the existing Project Review, Viva or Company Round workflows.
- Trend visualization using the existing chart infrastructure.
- Exportable JSON analysis report.
- Optional AI synthesis that receives aggregate metrics only and explicitly separates measured evidence from interpretation.
- AI output is constrained to evidence, risks, actions and a confidence note; it is not allowed to invent employers, ranks, achievements or probabilities.

## Preservation guarantees

- Existing Company Rounds, Project Review, Viva and legacy Insights/7-day-plan functionality remain available.
- The Resume workspace was not modified.
- No new top-level navigation tab was introduced.
- Existing persisted history keys are reused; no migration is required.
