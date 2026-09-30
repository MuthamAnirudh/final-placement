"""
Skill Gap & Market Intelligence Radar.

Data sources, blended:
  1. A curated offline dataset (data/market_skills.json) — always available, source of truth
     when no live provider is configured, and the fallback whenever a live call fails.
  2. An optional LIVE job-market provider (Adzuna or JSearch/RapidAPI) — if MARKET_LIVE_PROVIDER
     and its keys are set, live postings for the target role are fetched and skill mentions are
     counted via keyword matching against the same skill taxonomy, then blended with the cached
     weights (60% live / 40% cached) so a temporary API hiccup never zeroes-out the radar.

Live results are cached in-memory for MARKET_CACHE_TTL_S so repeated radar requests for the same
role don't re-hit the external API on every keystroke of a demo.
"""
import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

import httpx

from app.config import get_settings
from app.services.explainability import skill_recommendation_evidence

settings = get_settings()
logger = logging.getLogger("ai_ml_service.market")

_DATA_PATH = Path(settings.MARKET_DATA_PATH)
if not _DATA_PATH.is_absolute():
    # FIX: `.lstrip("./")` strips any leading '.' and '/' CHARACTERS (so "../data/x.json" or ".data/x.json"
    # resolved to the wrong file). Resolve the relative path against the service root properly, and fall back to
    # the bundled dataset if the configured location doesn't exist.
    _SERVICE_ROOT = Path(__file__).resolve().parent.parent.parent
    _DATA_PATH = (_SERVICE_ROOT / settings.MARKET_DATA_PATH).resolve()
    if not _DATA_PATH.exists():
        _DATA_PATH = _SERVICE_ROOT / "data" / "market_skills.json"

with open(_DATA_PATH, "r", encoding="utf-8") as _f:
    _DATASET = json.load(_f)

_ROLES: dict[str, dict] = _DATASET["roles"]
_ALIAS_TO_ROLE: dict[str, str] = {}
for _role, _info in _ROLES.items():
    _ALIAS_TO_ROLE[_role.lower()] = _role
    for _alias in _info.get("aliases", []):
        _ALIAS_TO_ROLE[_alias.lower()] = _role

_live_cache: dict[str, tuple[float, list[dict]]] = {}


def list_roles() -> list[str]:
    return sorted(_ROLES.keys())


def _phrase_in(needle: str, haystack: str) -> bool:
    """Whole-word(s) containment: 'pm' is NOT found in 'development', 'data scientist' IS found in
    'senior data scientist'."""
    return bool(re.search(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])", haystack))


def resolve_role(role_query: str) -> Optional[str]:
    q = re.sub(r"\s+", " ", (role_query or "").strip().lower())
    if not q:
        # FIX: an empty query used to "contain-match" the first alias in the dataset and silently return
        # some arbitrary role.
        return None
    if q in _ALIAS_TO_ROLE:
        return _ALIAS_TO_ROLE[q]
    # Loose match (e.g. "Senior Data Scientist" -> "Data Scientist"). FIX: this used plain substring tests, so
    # the alias "PM" matched inside "Software Development Engineer" (develo-pm-ent) and resolved to Product
    # Manager. Matching is now whole-word, and the LONGEST matching alias wins.
    best_alias, best_role = "", None
    for alias, canonical in _ALIAS_TO_ROLE.items():
        if len(alias) < 3:
            continue
        if (_phrase_in(alias, q) or _phrase_in(q, alias)) and len(alias) > len(best_alias):
            best_alias, best_role = alias, canonical
    if best_role:
        return best_role
    # Last resort: every word of a (multi-word) role name/alias appears in the query, in any order —
    # e.g. "Software Development Engineer" -> Software Engineer. The most specific (most words) wins.
    q_words = set(re.findall(r"[a-z0-9]+", q))
    best_size = 1
    for alias, canonical in _ALIAS_TO_ROLE.items():
        words = set(re.findall(r"[a-z0-9]+", alias))
        if len(words) > best_size and words <= q_words:
            best_size, best_role = len(words), canonical
    return best_role


def _cached_skills_for_role(role: str) -> list[dict]:
    return [dict(s) for s in _ROLES.get(role, {}).get("skills", [])]


async def _fetch_adzuna(role: str) -> list[dict]:
    """Counts skill-taxonomy mentions across recent Adzuna job-posting descriptions for the role."""
    if not (settings.ADZUNA_APP_ID and settings.ADZUNA_APP_KEY):
        raise RuntimeError("MARKET_LIVE_PROVIDER=adzuna but ADZUNA_APP_ID/ADZUNA_APP_KEY are not set.")
    url = f"https://api.adzuna.com/v1/api/jobs/{settings.ADZUNA_COUNTRY}/search/1"
    params = {"app_id": settings.ADZUNA_APP_ID, "app_key": settings.ADZUNA_APP_KEY,
              "what": role, "results_per_page": 50, "content-type": "application/json"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params, timeout=settings.AI_REQUEST_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
    results = data.get("results", [])
    if not results:
        # FIX: zero postings used to be scored as "demand 0 for every skill" and blended in at 60% weight,
        # dragging every skill down. No data => raise, so the caller falls back to the curated dataset.
        raise RuntimeError("Adzuna returned no postings for this role.")
    descriptions = " ".join((job.get("description") or "") for job in results)
    return _score_skills_from_text(role, descriptions, total_postings=len(results))


async def _fetch_jsearch(role: str) -> list[dict]:
    if not settings.JSEARCH_RAPIDAPI_KEY:
        raise RuntimeError("MARKET_LIVE_PROVIDER=jsearch but JSEARCH_RAPIDAPI_KEY is not set.")
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://jsearch.p.rapidapi.com/search",
            params={"query": role, "num_pages": "1"},
            headers={"X-RapidAPI-Key": settings.JSEARCH_RAPIDAPI_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
            timeout=settings.AI_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
    jobs = data.get("data", [])
    if not jobs:
        raise RuntimeError("JSearch returned no postings for this role.")
    descriptions = " ".join((job.get("job_description") or "") for job in jobs)
    return _score_skills_from_text(role, descriptions, total_postings=len(jobs))


def _score_skills_from_text(role: str, text: str, total_postings: int) -> list[dict]:
    lower = text.lower()
    taxonomy = [s["skill"] for s in _cached_skills_for_role(role)]
    scored = []
    for skill in taxonomy:
        # match on the first comma-free token group of a multi-word skill label too (e.g.
        # "Pandas/NumPy" -> also try "pandas", "numpy")
        variants = re.split(r"[/&]| and ", skill.lower())
        # FIX: str.count() matched substrings ("go" inside "google"/"algorithm", "r", "c", "sql" inside
        # "nosql"...), inflating live demand. Count whole-word occurrences only.
        hits = sum(len(re.findall(r"(?<![a-z0-9+#])" + re.escape(v.strip()) + r"(?![a-z0-9+#])", lower))
                   for v in variants if v.strip())
        demand = min(100, round(100 * hits / max(1, total_postings * 0.6)))
        scored.append({"skill": skill, "demand": demand, "growth": "live-observed"})
    return scored


async def _get_live_skills(role: str) -> Optional[list[dict]]:
    if not settings.MARKET_LIVE_PROVIDER:
        return None
    cache_key = f"{settings.MARKET_LIVE_PROVIDER}:{role}"
    hit = _live_cache.get(cache_key)
    if hit and (time.time() - hit[0]) < settings.MARKET_CACHE_TTL_S:
        return hit[1]
    try:
        if settings.MARKET_LIVE_PROVIDER == "adzuna":
            result = await _fetch_adzuna(role)
        elif settings.MARKET_LIVE_PROVIDER == "jsearch":
            result = await _fetch_jsearch(role)
        else:
            return None
        _live_cache[cache_key] = (time.time(), result)
        return result
    except Exception as exc:  # noqa: BLE001 — any live-provider failure falls back to the cached dataset
        logger.warning("Live market data (%s) unavailable for %r, using cached dataset: %s: %s",
                       settings.MARKET_LIVE_PROVIDER, role, type(exc).__name__, exc)
        return None


def _blend(cached: list[dict], live: Optional[list[dict]]) -> list[dict]:
    if not live:
        return cached
    live_by_skill = {s["skill"]: s for s in live}
    blended = []
    for c in cached:
        l = live_by_skill.get(c["skill"])
        if l:
            demand = round(0.6 * l["demand"] + 0.4 * c["demand"])
            blended.append({"skill": c["skill"], "demand": demand, "growth": c["growth"], "live_signal": True})
        else:
            blended.append({**c, "live_signal": False})
    return blended


def _normalize_skill(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _skill_variants(label: str) -> list[str]:
    """'Pandas/NumPy' -> ['pandas', 'numpy']; 'Docker & Kubernetes' -> ['docker', 'kubernetes']."""
    parts = [_normalize_skill(v) for v in re.split(r"[/&,]| and ", label or "")]
    parts = [v for v in parts if v]
    whole = _normalize_skill(label)
    return parts + ([whole] if whole and whole not in parts else [])


def _has_skill(market_label: str, have_normalized: set) -> bool:
    """FIX: the old test `norm in h or h in norm` on normalised strings meant a blank entry (h == "") or any
    short entry such as "c", "r" or "go" was "contained" in nearly every skill name — so one stray token made
    the radar claim you already had almost everything. Exact variant match always counts; fuzzy containment
    is only allowed when BOTH sides are at least 4 characters."""
    for h in have_normalized:
        if not h:
            continue
        for v in _skill_variants(market_label):
            if h == v:
                return True
            if len(h) >= 4 and len(v) >= 4 and (h in v or v in h):
                return True
    return False


async def compute_radar(target_role: str, current_skills: list[str]) -> dict:
    role = resolve_role(target_role)
    if role is None:
        return {
            "error": f"Unrecognized role '{target_role}'.",
            "available_roles": list_roles(),
        }

    cached = _cached_skills_for_role(role)
    live = await _get_live_skills(role)
    market_skills = _blend(cached, live)
    market_skills.sort(key=lambda s: -s["demand"])

    have_normalized = {_normalize_skill(s) for s in (current_skills or []) if _normalize_skill(s)}

    rows = []
    for m in market_skills:
        have_it = _has_skill(m["skill"], have_normalized)
        rows.append({
            "skill": m["skill"],
            "market_demand": m["demand"],
            "growth": m.get("growth", "stable"),
            "you_have_it": have_it,
        })

    missing_high_demand = sorted(
        [r for r in rows if not r["you_have_it"]], key=lambda r: -r["market_demand"]
    )[:8]
    have_count = sum(1 for r in rows if r["you_have_it"])
    coverage_pct = round(100 * have_count / len(rows), 1) if rows else 0.0

    top_priority_evidence = (
        skill_recommendation_evidence(missing_high_demand[0], rows, role)
        if missing_high_demand else None
    )

    return {
        "target_role": role,
        "matched_from_query": target_role,
        "coverage_pct": coverage_pct,
        "skills": rows,
        "missing_high_demand_skills": missing_high_demand,
        "top_priority_skill": missing_high_demand[0]["skill"] if missing_high_demand else None,
        "top_priority_skill_evidence": top_priority_evidence,
        "data_mode": "live+cached blend" if live else "cached (offline dataset)",
        "radar_chart": {
            "categories": [r["skill"] for r in rows[:10]],
            "market_demand": [r["market_demand"] for r in rows[:10]],
            "your_coverage": [100 if r["you_have_it"] else 0 for r in rows[:10]],
        },
    }


async def trending_skills(role_query: Optional[str] = None) -> dict:
    if role_query:
        role = resolve_role(role_query)
        if role is None:
            return {"error": f"Unrecognized role '{role_query}'.", "available_roles": list_roles()}
        cached = _cached_skills_for_role(role)
        live = await _get_live_skills(role)
        market_skills = _blend(cached, live)
        rising = sorted([s for s in market_skills if s.get("growth") in ("rising", "live-observed")],
                         key=lambda s: -s["demand"])[:10]
        return {"role": role, "trending": rising, "data_mode": "live+cached blend" if live else "cached"}
    # No role given — return the highest-demand "rising" skill across every role, deduped.
    seen: dict[str, dict] = {}
    for role, info in _ROLES.items():
        for s in info["skills"]:
            if s.get("growth") == "rising" and (s["skill"] not in seen or s["demand"] > seen[s["skill"]]["demand"]):
                seen[s["skill"]] = {**s, "example_role": role}
    return {"trending": sorted(seen.values(), key=lambda s: -s["demand"])[:15], "data_mode": "cached (cross-role)"}


# ===== NEW: Market Heat Index =====
#
# Deepens the radar/trending endpoints with a single comparable "how hot is this role right
# now" number, computed from the same demand-weighted skill dataset (no external calls, no
# fabricated salary figures -- relative demand only, which is the one thing this curated/
# live-blended dataset actually measures reliably).
_HEAT_TIERS = [(80, "\U0001f525 Very Hot"), (65, "Hot"), (50, "Warm"), (35, "Steady"), (0, "Cooling")]


def _heat_label(score: float) -> str:
    for threshold, label in _HEAT_TIERS:
        if score >= threshold:
            return label
    return "Cooling"


async def market_heat_index(target_role: str) -> dict:
    role = resolve_role(target_role)
    if role is None:
        return {"error": f"Unrecognized role '{target_role}'.", "available_roles": list_roles()}

    cached = _cached_skills_for_role(role)
    live = await _get_live_skills(role)
    skills = _blend(cached, live)
    if not skills:
        return {"role": role, "heat_score": None, "heat_label": "Unknown"}

    rising_bonus = sum(3 for s in skills if s.get("growth") in ("rising", "live-observed"))
    avg_demand = sum(s["demand"] for s in skills) / len(skills)
    heat_score = round(min(100, avg_demand + rising_bonus), 1)

    # Rank every role by the same heat score so the frontend can show "#3 of 12 roles" context.
    all_scores = []
    for r, info in _ROLES.items():
        s = info["skills"]
        if not s:
            continue
        a = sum(sk["demand"] for sk in s) / len(s)
        b = sum(3 for sk in s if sk.get("growth") == "rising")
        all_scores.append((r, round(min(100, a + b), 1)))
    # FIX: the requested role's score may include live data (and counts "live-observed" growth) while every other
    # role was scored from the cached dataset only, so the same role could rank inconsistently. Use the exact
    # score shown to the user for the requested role in the comparison list.
    all_scores = [(r, heat_score if r == role else sc) for r, sc in all_scores]
    all_scores.sort(key=lambda x: -x[1])
    rank = next((i + 1 for i, (r, _) in enumerate(all_scores) if r == role), None)

    return {
        "role": role,
        "heat_score": heat_score,
        "heat_label": _heat_label(heat_score),
        "rank": rank,
        "total_roles_compared": len(all_scores),
        "top_driving_skills": sorted(skills, key=lambda s: -s["demand"])[:5],
    }
