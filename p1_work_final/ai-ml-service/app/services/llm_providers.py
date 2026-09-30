"""
Provider-agnostic LLM caller used by the roadmap generator and the resume
parser's free-text reasoning steps.

Mirrors the Node/Express backend's fallback strategy (backend/server.js):
try providers in AI_PROVIDER_ORDER, skip any without a configured key, retry
transient failures with backoff, and raise a clear error only if every
configured provider failed.
"""
import asyncio
import json
import logging
import time
from typing import Optional

import httpx

from app.config import get_settings, get_key, get_model

logger = logging.getLogger("ai_ml_service.llm")

settings = get_settings()

_cache: dict[str, tuple[float, str]] = {}


def _cache_put(key: str, text: str) -> None:
    """FIX: the response cache used to grow without bound (every distinct prompt was kept forever, including
    full resume texts). Now bounded: expired entries are dropped first, then the oldest."""
    now = time.time()
    if len(_cache) >= max(8, settings.LLM_CACHE_MAX_ENTRIES):
        for k in [k for k, (ts, _t) in _cache.items() if now - ts >= settings.CACHE_TTL_S]:
            _cache.pop(k, None)
        while len(_cache) >= max(8, settings.LLM_CACHE_MAX_ENTRIES):
            _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
    _cache[key] = (now, text)


class LLMError(Exception):
    def __init__(self, message: str, provider_errors: Optional[dict] = None):
        super().__init__(message)
        self.provider_errors = provider_errors or {}


def _cache_key(system: str, user: str, opts: dict) -> str:
    return json.dumps({"s": system, "u": user, "o": opts}, sort_keys=True)


def _configured_providers() -> list[str]:
    available = {
        "groq": bool(get_key("groq")),
        "gemini": bool(get_key("gemini")),
    }
    return [p for p in settings.AI_PROVIDER_ORDER if available.get(p)]


# Groq exposes an OpenAI-compatible Chat Completions API, so this helper (originally shared
# with a real OpenAI provider) is reused for Groq's request/response shape.
async def _call_openai_compatible(client: httpx.AsyncClient, base_url: str, api_key: str, model: str,
                                   system: str, user: str, opts: dict, timeout_s: Optional[float] = None) -> str:
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": opts.get("maxTokens", 1024),
        "temperature": opts.get("temperature", 0.4),
    }
    if opts.get("jsonMode"):
        body["response_format"] = {"type": "json_object"}
    # gpt-oss models are reasoning models: with the default effort they can spend the whole max_tokens budget
    # "thinking" and return an EMPTY answer. Keep the reasoning short so the visible answer always fits.
    if "gpt-oss" in str(model).lower():
        body["reasoning_effort"] = "low"
        body["max_tokens"] = max(int(body["max_tokens"]), 1024)
    resp = await client.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
        json=body,
        timeout=timeout_s or settings.AI_REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    data = resp.json()
    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not text.strip():
        raise RuntimeError("Groq returned an empty answer")
    return text


async def _call_gemini(client: httpx.AsyncClient, system: str, user: str, opts: dict,
                       timeout_s: Optional[float] = None) -> str:
    model = get_model("gemini")
    # Google migrated Gemini API keys from the old `AIza...` format to a new `AQ....` format
    # (fully enforced as of Sept 2026); new-format keys must be sent via the `x-goog-api-key`
    # header rather than the old `?key=` query param, which now returns an auth error for them.
    resp = await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": get_key("gemini")},
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "maxOutputTokens": opts.get("maxTokens", 1024),
                "temperature": opts.get("temperature", 0.4),
                **({"responseMimeType": "application/json"} if opts.get("jsonMode") else {}),
            },
        },
        timeout=timeout_s or settings.AI_REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    data = resp.json()
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    text = "".join(p.get("text", "") for p in parts)
    if not text.strip():
        raise RuntimeError("Gemini returned an empty answer (possibly blocked by safety filters)")
    return text


async def call_llm(system: str, user: str, opts: Optional[dict] = None) -> dict:
    """
    Returns {"text": str, "provider": str} or raises LLMError.
    opts: {maxTokens, temperature, jsonMode, noCache, provider (force one)}
    """
    opts = opts or {}
    if len(system) + len(user) > settings.MAX_PROMPT_CHARS:
        raise LLMError(f"Prompt exceeds MAX_PROMPT_CHARS ({settings.MAX_PROMPT_CHARS})")

    key = _cache_key(system, user, opts)
    if not opts.get("noCache"):
        hit = _cache.get(key)
        if hit and (time.time() - hit[0]) < settings.CACHE_TTL_S:
            return {"text": hit[1], "provider": "cache"}

    forced = opts.get("provider")
    if forced:
        forced = str(forced).strip().lower()
        # FIX: a forced provider with no key used to fire a doomed request; and an unknown provider name
        # silently produced an empty error map. Validate both up front with a clear message.
        if forced not in ("groq", "gemini"):
            raise LLMError(f"Unknown LLM provider '{forced}'. Use 'groq' or 'gemini'.")
        if not get_key(forced):
            raise LLMError(f"Provider '{forced}' was requested but its API key is not configured.")
    providers = [forced] if forced else _configured_providers()
    if not providers:
        raise LLMError(
            "No LLM provider is configured. Set GROQ_API_KEY or GEMINI_API_KEY in ai-ml-service/.env"
        )

    errors: dict[str, str] = {}
    deadline = time.monotonic() + max(5, settings.AI_TOTAL_DEADLINE_S)
    async with httpx.AsyncClient() as client:
        for provider in providers:
            for attempt in range(settings.AI_MAX_RETRIES + 1):
                remaining = deadline - time.monotonic()
                if remaining < 2.0:
                    errors[f"{provider}#{attempt}"] = "overall AI deadline reached"
                    break
                per_call_timeout = min(float(settings.AI_REQUEST_TIMEOUT_S), remaining)
                try:
                    if provider == "groq":
                        text = await _call_openai_compatible(
                            client, "https://api.groq.com/openai/v1", get_key("groq"),
                            get_model("groq"), system, user, opts, per_call_timeout)
                    else:
                        text = await _call_gemini(client, system, user, opts, per_call_timeout)
                    _cache_put(key, text)
                    return {"text": text, "provider": provider}
                except Exception as exc:  # noqa: BLE001 - deliberately broad, we fall back
                    # str(TimeoutException) is often empty, so always record the exception class too.
                    errors[f"{provider}#{attempt}"] = f"{type(exc).__name__}: {exc}"[:300]
                    logger.warning("LLM provider %s attempt %s failed: %s", provider, attempt, errors[f"{provider}#{attempt}"])
                    status = getattr(getattr(exc, "response", None), "status_code", None)
                    if status in (400, 401, 403, 404):
                        break  # retrying the same bad key / model will never help
                    if attempt < settings.AI_MAX_RETRIES:
                        backoff = 0.6 * (2 ** attempt)
                        if deadline - time.monotonic() > backoff + 2.0:
                            await asyncio.sleep(backoff)
                        else:
                            break
    raise LLMError("All configured LLM providers failed.", provider_errors=errors)


def parse_json_loose(text: str) -> dict:
    """Best-effort JSON parse: strips markdown fences and finds the outermost {...}.

    FIX: callers immediately index the result like a dict, but this used to return whatever JSON parsed
    (a list, a string, a number) which then crashed with TypeError -> HTTP 500. Anything that is not a JSON
    object now raises ValueError, which every caller already handles by falling back offline.
    """
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned[:4].lower() == "json":
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            parsed = json.loads(cleaned[start:end + 1])
        else:
            raise
    if not isinstance(parsed, dict):
        raise ValueError("LLM returned JSON that is not an object.")
    return parsed
