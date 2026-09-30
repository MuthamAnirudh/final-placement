# AI/ML service audit — what was fixed (v4 -> v5)

Only `ai-ml-service/` code was changed (plus its README/.env.example/Dockerfile). No feature, endpoint, response field or
frontend/backend file was removed or renamed; all changes are bug fixes or additive fields.

## Crashes / wrong results (HTTP 500 or silently wrong numbers)
| Where | Problem | Fix |
|---|---|---|
| `interview_nlp._summarize_session` | `None.get(...)` crash on the last turn of any session that used the multimodal endpoint without audio/video | None-safe lookups |
| `interview_nlp.analyze_transcript` | filler/hedge words counted as **substrings** ("um" in "number/summary", "uh" in "though") -> fluent answers scored badly | whole-word matching |
| `interview_nlp` LLM feedback | string/null scores from the model broke rubric + session summary (`"8" * 10`, str vs int compare) | feedback normalised right after parsing |
| `adaptive_engine.mastery_with_decay` | timezone-less timestamp -> `TypeError` for the whole batch; bad timestamp was labelled "Fresh" | naive = UTC; invalid = "Unknown" (`timestamp_valid` flag added) |
| `adaptive_engine.submit_coding_answer` | LLM score as string -> `TypeError` | coerced/clamped |
| `adaptive_engine.submit_answer` | duplicate answers double-counted; wrong-topic item gave a misleading 404; answers accepted after finish | validated (422) |
| `llm_providers.parse_json_loose` | returned lists/strings -> `TypeError` in callers | must be a JSON object, else offline fallback |
| `roadmap` | unvalidated LLM `weeks` reached the UI; odd JSON -> 500 | validated/normalised, else offline roadmap |
| `market_intel.resolve_role` | "Software **Development** Engineer" resolved to *Product Manager* (alias "PM" matched inside "develoPMent"); blank query matched a random role | whole-word, longest match |
| `market_intel.compute_radar` | a blank or 1-letter skill ("c", "r") marked almost every skill as "you have it" | exact/length-guarded matching |
| `parser.extract_skills` | substring matching: "c", "go", "java" in "JavaScript", "git" in "GitHub"... | whole-token matching |
| `parser.extract_text` | corrupt/encrypted PDF, bad DOCX, binary file -> generic 500 | clear 422 message; DOCX tables now read |
| `ai_reliability` | sentence-final skill name kept its full stop and never matched -> good text flagged "ungrounded" and replaced | trailing dots stripped |
| `career_path.predict` | whitespace-only `target_interest` boosted **every** track by +15 | ignored |
| `matcher` | one corrupt index line disabled all `/match/*`; Qdrant ids changed each restart (duplicates); `client.search` removed in new qdrant-client | tolerant load, atomic write, stable ids, `query_points` |

## "AI/ML service not responding" / timeouts / memory
| Where | Problem | Fix |
|---|---|---|
| `llm_providers.call_llm` | up to 30 s x 3 retries x 2 providers = 180 s, longer than the gateway's ~55 s, so the portal showed "unavailable" instead of the offline fallback | overall deadline `AI_TOTAL_DEADLINE_S` (38 s) |
| audio / video analysis | blocked the event loop (so `/health` timed out), full-res video frames all held in RAM (OOM on 512 MB), ffmpeg hang / bad WAV -> 500, bogus WebM fps -> 1 frame sampled | worker thread, streamed + downscaled + capped frames, FFT pitch, timeouts, degrade to `available:false` |
| sessions / LLM cache | TTL settings existed but were never applied; caches grew forever | TTL + max-entries + bounded cache |
| `main.py` | CORS middleware was innermost, so 401/503 replies had no CORS header ("Failed to fetch"); unbounded usage-counter map; bad `KEEP_ALIVE_INTERVAL_S` killed keep-warm | order fixed, capped, safe parse |
| `config.py` | a typo in `ADAPTIVE_SE_THRESHOLD` crashed startup; `WHISPER_MODEL` default was an OpenAI id Groq doesn't serve and was ignored | safe parsing; Groq model id used |
| uploads | temp-file suffix built from the client filename (path characters) | sanitised |
| internal errors | provider/exception text leaked in `llm_error` / `enrichment_error` / `grading_error` | logged server-side, stable message returned |

Also added: `ai-ml-service/.env.example` (README referenced it but it did not exist), stale README key names fixed,
`tests/test_regressions.py` (27 tests, one per bug above).
