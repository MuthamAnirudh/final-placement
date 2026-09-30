"""
Regression tests for bugs found in the AI/ML service audit (each test names the failure it guards against).

Pure service-layer tests: no FastAPI app, no network, no LLM keys needed (LLM calls are monkeypatched or fall
back offline). Run from ai-ml-service/:

    pytest tests/test_regressions.py -v
"""
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.services import (  # noqa: E402
    adaptive_engine, ai_reliability, audio_prosody, career_path, interview_nlp, llm_providers,
    market_intel, matcher, parser, roadmap, session_store,
)
from app.services._util import safe_suffix  # noqa: E402

settings = get_settings()


# ---------------------------------------------------------------- interview_nlp
def test_filler_words_are_whole_words_not_substrings():
    text = "The summary covers the number of columns on the platform, though it is enough."
    result = interview_nlp.analyze_transcript(text)
    assert result["filler_word_count"] == 0, "um/uh must not be counted inside number/summary/though"


def test_real_fillers_and_hedges_are_still_counted():
    result = interview_nlp.analyze_transcript("Um, I think, you know, it was basically fine, maybe.")
    assert result["filler_word_count"] >= 3
    assert result["hedge_word_count"] >= 2


def test_llm_feedback_with_string_scores_does_not_crash_rubric(monkeypatch):
    bad = json.dumps({"star_structure_present": "true", "technical_depth_0_10": "8/10",
                      "communication_clarity_0_10": None, "strengths": "Good answer", "improvements": None,
                      "ideal_answer_outline": ["a"], "follow_up_question": None})

    async def fake(system, user, opts):
        return {"text": bad, "provider": "fake"}

    monkeypatch.setattr(interview_nlp, "call_llm", fake)
    evaluation = asyncio.run(interview_nlp.evaluate_answer("Q?", "I built a service and improved latency."))
    rubric = interview_nlp.rubric_breakdown(evaluation)  # used to raise TypeError on string arithmetic
    assert rubric["competencies"]["Technical Depth"] == 80.0
    assert evaluation["feedback"]["strengths"] == ["Good answer"]


def test_multimodal_session_without_audio_video_reaches_summary_without_crashing():
    started = interview_nlp.start_interview_session("Software Engineer")
    sid = started["session_id"]
    last = None
    for _ in range(settings.INTERVIEW_MAX_FOLLOWUPS):
        last = asyncio.run(interview_nlp.respond_in_session_multimodal(
            sid, "I built an API and improved response time by caching.", 20.0))
    # Used to raise AttributeError ('NoneType' has no attribute 'get') when building the summary.
    assert last["session_finished"] is True
    assert last["session_summary"]["turns_completed"] == settings.INTERVIEW_MAX_FOLLOWUPS
    # replaying a finished session returns the summary instead of piling up more turns
    again = asyncio.run(interview_nlp.respond_in_session(sid, "one more"))
    assert again["session_finished"] is True


def test_blank_answer_in_session_is_rejected():
    sid = interview_nlp.start_interview_session("Data Scientist")["session_id"]
    try:
        asyncio.run(interview_nlp.respond_in_session(sid, "   "))
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_multimodal_optional_analysis_failure_never_fails_the_turn(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("decoder exploded")

    monkeypatch.setattr(interview_nlp.audio_prosody, "analyze_prosody", boom)
    sid = interview_nlp.start_interview_session("Software Engineer")["session_id"]
    res = asyncio.run(interview_nlp.respond_in_session_multimodal(
        sid, "I designed and delivered a feature.", 10.0, audio_bytes=b"xx", audio_filename="a.webm"))
    assert res["speech_prosody"]["available"] is False


# ---------------------------------------------------------------- adaptive engine
def test_freshness_accepts_timestamp_without_timezone():
    out = adaptive_engine.mastery_with_decay(0.4, "2026-09-01T10:00:00")  # used to raise TypeError
    assert out["timestamp_valid"] is True and out["days_since_practiced"] >= 0


def test_freshness_unparseable_timestamp_is_unknown_not_fresh():
    out = adaptive_engine.mastery_with_decay(0.4, "not a date")
    assert out["timestamp_valid"] is False
    assert out["freshness_confidence"] == 0.0 and out["freshness_label"] != "Fresh"


def test_adaptive_rejects_duplicate_and_foreign_topic_answers():
    start = adaptive_engine.start_session(["Python"], include_coding=False)
    sid, item = start["session_id"], start["next"]
    adaptive_engine.submit_answer(sid, item["id"], 0)
    try:
        adaptive_engine.submit_answer(sid, item["id"], 0)
        assert False, "duplicate answer must be rejected"
    except ValueError:
        pass
    foreign = next(i for i in adaptive_engine.MCQ_ITEMS if i["topic"] != "Python")
    try:
        adaptive_engine.submit_answer(sid, foreign["id"], 0)
        assert False, "item from another topic must be rejected"
    except ValueError:  # used to be a KeyError -> misleading 404
        pass


def test_adaptive_sessions_expire_and_are_capped(monkeypatch):
    sid = adaptive_engine.start_session(["Python"])["session_id"]
    adaptive_engine._SESSIONS[sid]["last_active"] = time.time() - 10 * settings.ADAPTIVE_SESSION_TTL_S
    try:
        adaptive_engine.get_report(sid)
        assert False, "expired session must be gone"
    except KeyError:
        pass
    monkeypatch.setattr(settings, "SESSION_MAX_ENTRIES", 3)
    for _ in range(6):
        adaptive_engine.start_session(["SQL"])
    assert len(adaptive_engine._SESSIONS) <= 3


def test_coding_score_returned_as_string_is_handled(monkeypatch):
    async def fake(system, user, opts):
        return {"text": json.dumps({"score_0_to_10": "8/10", "verdict": "strong"}), "provider": "fake"}

    monkeypatch.setattr(adaptive_engine, "call_llm", fake)
    sid = adaptive_engine.start_session(["Python"])["session_id"]
    out = asyncio.run(adaptive_engine.submit_coding_answer(sid, "Python", "Reverse a list", "def f(x): return x[::-1]"))
    assert out["grading"]["score_0_to_10"] == 8.0  # used to raise TypeError comparing str >= int


# ---------------------------------------------------------------- llm_providers
def test_parse_json_loose_rejects_non_objects_and_handles_fences():
    assert llm_providers.parse_json_loose('```json\n{"a": 1}\n```') == {"a": 1}
    for bad in ("[1, 2]", '"text"', "42"):
        try:
            llm_providers.parse_json_loose(bad)
            assert False, "non-object JSON must raise ValueError"
        except ValueError:
            pass


def test_call_llm_gives_up_at_overall_deadline(monkeypatch):
    monkeypatch.setattr(settings, "GROQ_API_KEY", "k1")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k2")
    monkeypatch.setattr(settings, "AI_TOTAL_DEADLINE_S", 5)
    monkeypatch.setattr(settings, "AI_MAX_RETRIES", 5)
    calls = {"n": 0}

    async def slow_fail(*a, **k):
        calls["n"] += 1
        await asyncio.sleep(1.2)
        raise RuntimeError("upstream down")

    monkeypatch.setattr(llm_providers, "_call_openai_compatible", slow_fail)
    monkeypatch.setattr(llm_providers, "_call_gemini", slow_fail)
    started = time.monotonic()
    try:
        asyncio.run(llm_providers.call_llm("s", "u-deadline", {"noCache": True}))
        assert False, "expected LLMError"
    except llm_providers.LLMError:
        pass
    assert time.monotonic() - started < 9, "must stop near AI_TOTAL_DEADLINE_S, not run all retries"


def test_forced_provider_without_key_fails_fast(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    try:
        asyncio.run(llm_providers.call_llm("s", "u", {"provider": "gemini", "noCache": True}))
        assert False
    except llm_providers.LLMError as exc:
        assert "not configured" in str(exc)


def test_llm_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(settings, "LLM_CACHE_MAX_ENTRIES", 10)
    llm_providers._cache.clear()
    for i in range(50):
        llm_providers._cache_put(f"k{i}", "v")
    assert len(llm_providers._cache) <= 10


# ---------------------------------------------------------------- roadmap
def _roadmap_with_llm_text(monkeypatch, text):
    async def fake(system, user, opts):
        return {"text": text, "provider": "fake"}

    monkeypatch.setattr(roadmap, "call_llm", fake)
    return asyncio.run(roadmap.generate_roadmap("Backend Developer", ["python"], ["docker"], None, 3))


def test_roadmap_falls_back_when_llm_returns_a_list_or_no_weeks(monkeypatch):
    for text in ("[1, 2, 3]", json.dumps({"target_role": "x"}), json.dumps({"weeks": "nope"})):
        out = _roadmap_with_llm_text(monkeypatch, text)  # used to raise TypeError -> HTTP 500
        assert out["llm_unavailable"] is True and len(out["weeks"]) == 3


def test_roadmap_normalises_a_valid_llm_answer(monkeypatch):
    good = json.dumps({"weeks": [{"week": 9, "theme": "Docker", "study_topics": "images", "build_this": "x",
                                  "resume_bullet": "y", "estimated_hours": "12"}],
                       "priority_gap": "Learn Docker first."})
    out = _roadmap_with_llm_text(monkeypatch, good)
    assert out["weeks"][0]["week"] == 1 and out["weeks"][0]["study_topics"] == ["images"]
    assert out["weeks"][0]["estimated_hours"] == 12.0


# ---------------------------------------------------------------- reliability
def test_term_at_end_of_sentence_matches_known_fact():
    facts = ["Kubernetes is a missing skill for Backend Engineer, recommended to learn next."]
    result = ai_reliability.verify_claim("The most valuable skill to learn next is Kubernetes.", facts)
    assert result["grounded"] is True  # 'kubernetes.' used to never match 'kubernetes'


# ---------------------------------------------------------------- parser
def test_skill_extraction_uses_whole_words():
    skills = parser.extract_skills("Good at Google Cloud and expressions. Vitamin c. Likes to go to market.")
    for wrong in ("c", "go", "express", "java", "git"):
        assert wrong not in skills
    real = parser.extract_skills("Skills: Java, JavaScript, C++, C, Go, Node.js, machine-learning, GitHub")
    for right in ("java", "javascript", "c++", "c", "go", "node.js", "machine learning", "github"):
        assert right in real


def test_corrupt_or_binary_uploads_are_a_clear_value_error():
    for name, data in (("cv.pdf", b"%PDF-1.4 broken"), ("cv.docx", b"not a zip"), ("cv.doc", b"\xd0\xcf\x00\x00junk")):
        try:
            parser.extract_text(name, data)
            assert False, f"{name} should raise ValueError"
        except ValueError:
            pass


# ---------------------------------------------------------------- market intel / career path
def test_role_resolution_is_whole_word_and_rejects_blank():
    assert market_intel.resolve_role("Software Development Engineer") == "Software Engineer"  # not Product Manager
    assert market_intel.resolve_role("") is None
    assert market_intel.resolve_role("   ") is None
    assert market_intel.resolve_role("Senior Data Scientist") == "Data Scientist"


def test_blank_or_tiny_skill_entries_do_not_claim_coverage():
    radar = asyncio.run(market_intel.compute_radar("Software Engineer", ["", "c", "r"]))
    assert radar["coverage_pct"] < 20, "stray one-letter/blank entries must not match nearly every skill"
    real = asyncio.run(market_intel.compute_radar("Data Scientist", ["pandas", "sql"]))
    assert any(r["you_have_it"] and "Pandas" in r["skill"] for r in real["skills"])


def test_whitespace_target_interest_does_not_boost_every_track():
    base = asyncio.run(career_path.predict(["python"], None, None, 6))
    blank = asyncio.run(career_path.predict(["python"], None, "   ", 6))
    assert [m["confidence"] for m in base["matches"]] == [m["confidence"] for m in blank["matches"]]


# ---------------------------------------------------------------- matcher
def test_faiss_backend_skips_corrupt_lines_and_writes_atomically(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "FAISS_INDEX_PATH", str(tmp_path))
    good = {"id": "a", "text": "python dev", "metadata": {}, "vector": matcher.embed("python dev")}
    (tmp_path / "meta.jsonl").write_text(json.dumps(good) + "\n{truncated-json\n", encoding="utf-8")
    backend = matcher._FaissBackend()  # used to raise JSONDecodeError and take down every /match/* call
    assert [r["id"] for r in backend._records] == ["a"]
    backend.upsert("b", "java dev", {})
    assert not (tmp_path / "meta.jsonl.tmp").exists()
    assert {r["id"] for r in matcher._FaissBackend()._records} == {"a", "b"}


# ---------------------------------------------------------------- audio / util / sessions
def test_ffmpeg_timeout_degrades_to_unavailable(monkeypatch):
    def hang(*a, **k):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=30)

    monkeypatch.setattr(audio_prosody.subprocess, "run", hang)
    result = audio_prosody.analyze_prosody(b"anything", "x.webm")
    assert result["available"] is False and "timed out" in result["reason"]


def test_safe_suffix_blocks_path_tricks():
    assert safe_suffix("answer.webm") == ".webm"
    assert safe_suffix("a.b/../../etc/x") == ".etcx"  # separators and dots are stripped from the extension
    assert safe_suffix("noext") == ".webm" and safe_suffix("") == ".webm"


def test_session_store_purge_expires_and_caps():
    now = time.time()
    store = {"old": {"last_active": now - 999}, "new1": {"last_active": now - 2}, "new2": {"last_active": now - 1}}
    session_store.purge(store, ttl_s=100, max_entries=1)
    assert list(store) == ["new2"]
