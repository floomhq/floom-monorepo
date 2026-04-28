"""Persistent HTTP wrapper around crawl4ai."""

from __future__ import annotations

import asyncio
import os
import threading
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Crawl4AI Floom Engine")

DATA_DIR = os.environ.get("DATA_DIR", "/data")
_state: dict[str, Any] = {"crawler": None, "warm": False, "error": None}
_loop = asyncio.new_event_loop()


class CrawlRequest(BaseModel):
    urls: list[str]
    crawler_params: dict[str, Any] | None = None
    extra: dict[str, Any] | None = None


def _run_loop() -> None:
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


async def _warm() -> None:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig

        os.makedirs(DATA_DIR, exist_ok=True)
        browser_config = BrowserConfig(headless=True, user_data_dir=DATA_DIR)
        crawler = AsyncWebCrawler(config=browser_config)
        await crawler.start()
        _state["crawler"] = crawler
        _state["warm"] = True
    except Exception as exc:
        _state["error"] = str(exc)


threading.Thread(target=_run_loop, daemon=True).start()
asyncio.run_coroutine_threadsafe(_warm(), _loop)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": _state["error"] is None, "warm": _state["warm"], "error": _state["error"]}


@app.post("/crawl")
async def crawl(request: CrawlRequest) -> dict[str, Any]:
    if _state["error"]:
        raise HTTPException(status_code=503, detail=_state["error"])
    if not _state["warm"] or _state["crawler"] is None:
        raise HTTPException(status_code=503, detail="engine warming up")
    if not request.urls:
        raise HTTPException(status_code=400, detail="urls required")

    url = request.urls[0]
    wait_for = (request.crawler_params or {}).get("wait_for")

    async def _crawl_one() -> dict[str, Any]:
        from crawl4ai import CrawlerRunConfig

        config = CrawlerRunConfig(wait_for=wait_for) if wait_for else CrawlerRunConfig()
        result = await _state["crawler"].arun(url=url, config=config)
        return {
            "url": getattr(result, "url", url),
            "markdown": getattr(result, "markdown", "") or "",
            "cleaned_html": getattr(result, "cleaned_html", "") or "",
            "metadata": getattr(result, "metadata", {}) or {},
            "links": getattr(result, "links", {}) or {},
        }

    future = asyncio.run_coroutine_threadsafe(_crawl_one(), _loop)
    try:
        result = future.result(timeout=30)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"results": [result]}
