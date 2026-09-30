"""
Speech-to-text for the Mock Interview flow.

The existing frontend already has browser SpeechRecognition (Chrome/Edge
only, no server round-trip). This service adds a Whisper-based alternative
that:
  - works in any browser (audio is recorded client-side via MediaRecorder /
    WebRTC getUserMedia — already present in the frontend — and POSTed here),
  - is far more accurate for accented/noisy speech, which matters a lot for
    a fair mock-interview grade,
  - can run against Groq's fast Whisper-large-v3 endpoint (OpenAI-compatible
    API) or a fully local faster-whisper model for offline/zero-cost demos.
"""
import asyncio
import io

import httpx

from app.config import get_settings, get_key
from app.services._util import safe_suffix

settings = get_settings()

_local_model = None


async def _transcribe_openai_compatible(base_url: str, api_key: str, model: str, filename: str, content: bytes) -> str:
    files = {"file": (filename, io.BytesIO(content), "application/octet-stream")}
    data = {"model": model}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json().get("text", "") or ""
    except httpx.HTTPStatusError as exc:
        # FIX: an upstream 4xx/5xx used to escape as a bare HTTPStatusError -> generic "Internal server
        # error". Turn it into a readable RuntimeError that the router maps to a proper response.
        code = getattr(exc.response, "status_code", "?")
        hint = ("the Groq API key was rejected" if code in (401, 403)
                else "Groq rate limit reached, try again shortly" if code == 429
                else "the audio format or model was rejected" if code in (400, 404, 415, 422)
                else "the speech-to-text provider had a problem")
        raise RuntimeError(f"Speech-to-text failed ({code}): {hint}.") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Speech-to-text provider is unreachable ({type(exc).__name__}).") from exc


def _transcribe_local(filename: str, content: bytes) -> str:
    global _local_model
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "Local Whisper requested (WHISPER_PROVIDER=local) but 'faster-whisper' isn't "
            "installed. Run `pip install faster-whisper` or switch WHISPER_PROVIDER to "
            "'groq' in .env."
        ) from exc
    if _local_model is None:
        _local_model = WhisperModel(settings.LOCAL_WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    import tempfile, os as _os
    suffix = safe_suffix(filename, ".wav")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        segments, _info = _local_model.transcribe(tmp_path)
        return " ".join(seg.text.strip() for seg in segments)
    finally:
        _os.unlink(tmp_path)


async def transcribe_audio(filename: str, content: bytes) -> dict:
    provider = settings.WHISPER_PROVIDER
    if provider == "local":
        # faster-whisper is CPU-bound and synchronous: run it off the event loop so /health keeps answering.
        text = await asyncio.to_thread(_transcribe_local, filename, content)
        return {"text": text.strip(), "provider": "local-faster-whisper"}
    # default: groq (only remaining hosted option besides local)
    if not get_key("groq"):
        raise RuntimeError("WHISPER_PROVIDER=groq but GROQ_API_KEY is not set.")
    # WHISPER_MODEL (config) is honoured now; it used to be ignored, and its old default ("whisper-1") is an
    # OpenAI model id that Groq does not serve.
    model = settings.WHISPER_MODEL if settings.WHISPER_MODEL and settings.WHISPER_MODEL != "whisper-1" else "whisper-large-v3"
    text = await _transcribe_openai_compatible(
        "https://api.groq.com/openai/v1", get_key("groq"), model, filename, content)
    return {"text": text.strip(), "provider": f"groq-{model}"}
