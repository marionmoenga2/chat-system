"""
Small client for Google's Gemini API (REST).
Picks a working "flash" model automatically, because model names change over time.
"""
import os
import re
import time

import httpx

BASE = "https://generativelanguage.googleapis.com/v1beta"
_model = {"name": None, "until": 0.0}


class GeminiError(Exception):
    """code is one of: rejected, rate_limited, timeout, unreachable, no_model, error_<status>"""

    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _headers(key):
    return {"x-goog-api-key": key, "content-type": "application/json"}


async def _candidates(client, key):
    forced = os.getenv("GEMINI_MODEL", "").strip()
    if forced:
        return [forced]
    found = []
    try:
        r = await client.get(f"{BASE}/models", params={"pageSize": 200}, headers=_headers(key))
    except httpx.TimeoutException:
        raise GeminiError("timeout")
    except httpx.HTTPError:
        raise GeminiError("unreachable")
    if r.status_code in (401, 403) or (r.status_code == 400 and "API key" in r.text):
        raise GeminiError("rejected", r.text[:200])
    if r.status_code == 200:
        for m in r.json().get("models", []):
            name = (m.get("name") or "").replace("models/", "")
            if "generateContent" not in (m.get("supportedGenerationMethods") or []):
                continue
            hit = re.fullmatch(r"gemini-(\d+(?:\.\d+)?)-flash", name)
            if hit:
                found.append((tuple(int(x) for x in hit.group(1).split(".")), name))
    found.sort(reverse=True)
    names = [n for _, n in found[:3]]
    names.append("gemini-flash-latest")
    return names


def _extract(data):
    out = []
    for cand in (data.get("candidates") or [])[:1]:
        for part in ((cand.get("content") or {}).get("parts") or []):
            if part.get("text") and not part.get("thought"):
                out.append(part["text"])
    return "".join(out).strip()


async def generate(key, system, turns, max_tokens=1500):
    """turns: [{"role": "user" or "assistant", "content": "..."}]. Returns the answer text."""
    contents = [
        {"role": "user" if t["role"] == "user" else "model", "parts": [{"text": t["content"]}]}
        for t in turns
    ]
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4},
    }
    async with httpx.AsyncClient(timeout=45) as client:
        if _model["name"] and time.time() < _model["until"]:
            names = [_model["name"]]
        else:
            names = await _candidates(client, key)
        last = GeminiError("no_model")
        for name in names:
            try:
                r = await client.post(f"{BASE}/models/{name}:generateContent", headers=_headers(key), json=body)
            except httpx.TimeoutException:
                raise GeminiError("timeout")
            except httpx.HTTPError:
                raise GeminiError("unreachable")
            if r.status_code == 200:
                _model.update(name=name, until=time.time() + 3600)
                return _extract(r.json())
            print("Gemini error:", name, r.status_code, r.text[:300])
            if r.status_code in (401, 403) or (r.status_code == 400 and "API key" in r.text):
                raise GeminiError("rejected", r.text[:200])
            last = GeminiError("rate_limited" if r.status_code == 429 else f"error_{r.status_code}", r.text[:200])
            _model["name"] = None
        raise last
