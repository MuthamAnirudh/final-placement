"""Small shared helpers."""
import re


def safe_suffix(filename: str, default: str = ".webm") -> str:
    """File extension for a temp file, derived from an untrusted upload name.

    FIX: transcribe.py / audio_prosody.py / video_behavioral.py built the temp-file suffix straight from the
    client-supplied filename (`"." + filename.split(".")[-1]`). A name like "a.b/../../x" put path separators
    into the suffix (temp-file creation error at best, path traversal at worst). Only 1-8 alphanumerics are
    kept now.
    """
    if not filename or "." not in filename:
        return default
    ext = re.sub(r"[^A-Za-z0-9]", "", filename.rsplit(".", 1)[-1])[:8]
    return f".{ext}" if ext else default
