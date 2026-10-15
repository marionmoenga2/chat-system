"""
Small client for Groq's OpenAI-compatible API (a free tier is available).
Picks a working chat model automatically, because model names change over time.
"""
import os
import re
import time

import httpx

BASE = "https://api.groq.com/openai/v1"
PREFERRED = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
SKIP = ("whisper", "guard", "tts", "playai", "orpheus", "embed", "safeguard", "transcri")
_model = {"name": None, "until": 0.0}


class GroqError(Exception):
    """code is one of: rejected, rate_limited, timeout, unreachable, no_model, error_<status>"""

    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _headers(key):
    return {"Authorization": f"Bearer {key}", "content-type": "application/json"}


async def _candidates(client, key):
    forced = os.getenv("GROQ_MODEL", "").strip()
    if forced:
        return [forced]
    ids = []
    try:
        r = await client.get(f"{BASE}/models", headers=_headers(key))
    except httpx.TimeoutException:
        raise GroqError("timeout")
    except httpx.HTTPError:
        raise GroqError("unreachable")
    if r.status_code in (401, 403):
        raise GroqError("rejected", r.text[:200])
    if r.status_code == 200:
        ids = [m.get("id", "") for m in r.json().get("data", []) if m.get("active", True)]
        ids = [i for i in ids if i and not any(s in i.lower() for s in SKIP)]
    names = [p for p in PREFERRED if p in ids]
    names += [i for i in ids if i not in names][:2]
    return names or list(PREFERRED)


async def generate(key, system, turns, max_tokens=600):
    """turns: [{"role": "user" or "assistant", "content": "..."}]. Returns the answer text."""
    messages = [{"role": "system", "content": system}] + [
        {"role": t["role"], "content": t["content"]} for t in turns
    ]
    async with httpx.AsyncClient(timeout=45) as client:
        if _model["name"] and time.time() < _model["until"]:
            names = [_model["name"]]
        else:
            names = await _candidates(client, key)
        last = GroqError("no_model")
        for name in names:
            body = {"model": name, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4}
            try:
                r = await client.post(f"{BASE}/chat/completions", headers=_headers(key), json=body)
            except httpx.TimeoutException:
                raise GroqError("timeout")
            except httpx.HTTPError:
                raise GroqError("unreachable")
            if r.status_code == 200:
                data = r.json()
                text = ""
                choices = data.get("choices") or []
                if choices:
                    text = (choices[0].get("message") or {}).get("content") or ""
                text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
                _model.update(name=name, until=time.time() + 3600)
                return text
            print("Groq error:", name, r.status_code, r.text[:300])
            if r.status_code in (401, 403):
                raise GroqError("rejected", r.text[:200])
            last = GroqError("rate_limited" if r.status_code == 429 else f"error_{r.status_code}", r.text[:200])
            _model["name"] = None
        raise last
