"""
Actionable roadmap generation — the "Intelligence" layer.

Deliberately produces WEEK-BY-WEEK, BUILD-THIS-NOT-JUST-STUDY-THIS output
(exact repo/project names, not just topic lists) because that's the explicit
differentiator requested: "tells a student exactly what to build or study
next week to land a target role", not a passive progress dashboard.

Falls back to a deterministic template-based roadmap (no LLM required) if no
provider key is configured, so the feature is always demoable offline.
"""
import logging
from typing import Optional

from app.services.llm_providers import call_llm, parse_json_loose, LLMError
from app.services.ai_reliability import check_reliability

logger = logging.getLogger("ai_ml_service.roadmap")


def _clean_weeks(data: dict, duration_weeks: int) -> None:
    """Validate/normalise the LLM's `weeks` array in place; raises ValueError if it is unusable so the caller
    serves the deterministic offline roadmap instead of sending the UI something it cannot render.

    FIX: the parsed LLM JSON was returned as-is. A missing/non-list `weeks`, or week entries that aren't
    objects, reached the frontend (which maps over `weeks`) and produced a blank/crashing roadmap panel."""
    weeks = data.get("weeks")
    if not isinstance(weeks, list) or not weeks:
        raise ValueError("LLM roadmap has no usable 'weeks' list.")
    cleaned = []
    for i, w in enumerate(weeks):
        if not isinstance(w, dict):
            raise ValueError("LLM roadmap contains a malformed week entry.")
        topics = w.get("study_topics")
        topics = [str(t) for t in topics] if isinstance(topics, list) else ([str(topics)] if topics else [])
        try:
            hours = float(w.get("estimated_hours", 10))
        except (TypeError, ValueError):
            hours = 10.0
        cleaned.append({**w, "week": i + 1, "theme": str(w.get("theme") or f"Week {i + 1}"),
                        "study_topics": topics[:4], "build_this": str(w.get("build_this") or ""),
                        "resume_bullet": str(w.get("resume_bullet") or ""), "estimated_hours": hours})
    data["weeks"] = cleaned
    data["duration_weeks"] = len(cleaned)
    for key in ("milestone_projects", "interview_focus_next"):
        val = data.get(key)
        data[key] = [str(v) for v in val] if isinstance(val, list) else []

ROADMAP_SYSTEM_PROMPT = """You are an expert technical career coach for campus placements in India, \
specializing in turning a skill gap into a concrete build plan.

Given a student's current skills, resume summary (optional), and a target job role, produce a \
week-by-week roadmap (default 6 weeks unless a different duration is given) that is ACTION-FIRST: \
each week must name a specific thing to BUILD (a project with a real, specific name/scope — never \
"work on projects") alongside what to study, and end with how that week's output should appear on \
a resume/GitHub.

Output ONLY strict JSON, no markdown fences, no commentary, matching exactly this schema:
{
  "target_role": string,
  "duration_weeks": number,
  "weeks": [
    {
      "week": number,
      "theme": string (short, e.g. "REST APIs & Auth"),
      "study_topics": [string] (max 4, specific not generic),
      "build_this": string (ONE specific, scoped, named project/feature to build this week),
      "resume_bullet": string (how to phrase this week's output as a resume line once done),
      "estimated_hours": number
    }
  ],
  "milestone_projects": [string] (2-3 capstone-level project ideas spanning the whole roadmap),
  "interview_focus_next": [string] (max 5 topics to expect in interviews for this role),
  "priority_gap": string (the single most urgent skill gap to close first, one sentence)
}
"""


def _fallback_roadmap(target_role: str, current_skills: list[str], missing_skills: list[str],
                       duration_weeks: int) -> dict:
    """Deterministic offline fallback so the demo never breaks without an API key."""
    weeks = []
    pool = missing_skills or ["core fundamentals", "a portfolio project", "system design basics",
                               "interview DSA practice", "a capstone project", "resume polish"]
    for i in range(duration_weeks):
        topic = pool[i % len(pool)]
        weeks.append({
            "week": i + 1,
            "theme": topic.title(),
            "study_topics": [topic, f"{topic} best practices"],
            "build_this": f"A small project applying {topic} to a real {target_role}-relevant use case",
            "resume_bullet": f"Built a project demonstrating {topic} for {target_role} readiness",
            "estimated_hours": 10,
        })
    return {
        "target_role": target_role,
        "duration_weeks": duration_weeks,
        "weeks": weeks,
        "milestone_projects": [f"End-to-end {target_role} portfolio project", "Open-source contribution in your target stack"],
        "interview_focus_next": (missing_skills or ["fundamentals"])[:5],
        "priority_gap": f"Close the gap in {pool[0]} first — it blocks the rest of the roadmap.",
        "generated_by": "offline-template (no LLM key configured)",
    }


async def generate_roadmap(
    target_role: str,
    current_skills: list[str],
    missing_skills: Optional[list[str]] = None,
    resume_summary: Optional[str] = None,
    duration_weeks: int = 6,
    provider: Optional[str] = None,
) -> dict:
    missing_skills = missing_skills or []
    provider = (provider or "").strip().lower() or None
    if provider not in (None, "groq", "gemini"):
        provider = None  # unknown provider name: use the normal configured order rather than failing
    user_prompt = (
        f"TARGET ROLE: {target_role}\n"
        f"DURATION: {duration_weeks} weeks\n"
        f"CURRENT SKILLS: {', '.join(current_skills) or 'none listed'}\n"
        f"KNOWN GAPS TO PRIORITIZE: {', '.join(missing_skills) or 'infer from target role'}\n"
        + (f"RESUME SUMMARY:\n{resume_summary[:2500]}\n" if resume_summary else "")
    )
    try:
        opts = {"jsonMode": True, "maxTokens": 2200, "temperature": 0.5}
        if provider:
            opts["provider"] = provider
        res = await call_llm(ROADMAP_SYSTEM_PROMPT, user_prompt, opts)
        data = parse_json_loose(res["text"])
        _clean_weeks(data, duration_weeks)
        data["target_role"] = str(data.get("target_role") or target_role)
        data["generated_by"] = f"llm:{res['provider']}"

        # AI Reliability layer (spec §16): the model was given target_role/current_skills/
        # missing_skills as the only "facts" about this student — check its free-text
        # priority_gap sentence (the one field most likely to state something not actually
        # supported by those facts) against them. week themes/build_this are per-week creative
        # project ideas, not factual claims about the student, so they're intentionally not
        # checked here — there's no "known fact" for a specific project name to be grounded in.
        known_facts = [f"Target role: {target_role}."]
        known_facts += [f"{s} is a skill the student already has." for s in current_skills]
        known_facts += [f"{s} is a missing skill, a gap for {target_role}." for s in missing_skills]
        priority_gap = data.get("priority_gap")
        if priority_gap is not None and not isinstance(priority_gap, str):
            priority_gap = data["priority_gap"] = str(priority_gap)
        if priority_gap:
            reliability = check_reliability(priority_gap, known_facts)
            data["priority_gap_reliability"] = reliability
            if reliability.get("confidence_label") == "low":
                # Prefer a deterministic, request-grounded gap over an unsupported LLM claim.
                data["priority_gap"] = (
                    f"Prioritize {missing_skills[0]} for the target role." if missing_skills
                    else f"Prioritize the next skill most relevant to {target_role}."
                )
                data["priority_gap_replaced"] = True

        return data
    except Exception as exc:  # noqa: BLE001 - LLMError, ValueError, plus TypeError/KeyError from odd LLM JSON
        # Never expose provider/network/parser exception details to the browser. Keep the
        # deterministic fallback and expose only a stable diagnostic flag.
        logger.warning("Roadmap LLM path failed, serving offline template: %s: %s", type(exc).__name__, exc)
        fallback = _fallback_roadmap(target_role, current_skills, missing_skills, duration_weeks)
        fallback["llm_unavailable"] = True
        return fallback
