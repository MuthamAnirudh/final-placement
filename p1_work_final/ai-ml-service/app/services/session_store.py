"""
Tiny helpers shared by the in-memory session stores (adaptive diagnostic + mock interview).

FIX: ADAPTIVE_SESSION_TTL_S / INTERVIEW_SESSION_TTL_S were defined in config.py but never enforced, so every
session ever started stayed in RAM until the process restarted (a slow memory leak on the 512 MB Render free
tier). These helpers apply the TTL and a hard cap; the oldest / least recently used sessions go first.
"""
import time


def touch(state: dict) -> None:
    state["last_active"] = time.time()


def purge(store: dict, ttl_s: float, max_entries: int) -> int:
    """Drop expired sessions, then evict the least-recently-active ones above `max_entries`.
    Returns how many were removed."""
    now = time.time()
    removed = 0
    for sid in [sid for sid, st in store.items()
                if now - st.get("last_active", st.get("created_at", now)) > ttl_s]:
        store.pop(sid, None)
        removed += 1
    overflow = len(store) - max(1, max_entries)
    if overflow > 0:
        oldest = sorted(store, key=lambda sid: store[sid].get("last_active", store[sid].get("created_at", now)))
        for sid in oldest[:overflow]:
            store.pop(sid, None)
            removed += 1
    return removed
