"""
UI Audit — screenshot any URL at 4 viewports and score UX across 7 dimensions
using Gemini. Returns S1-S4 severity findings with an overall score.
"""

import base64
import json
import os
import tempfile
from typing import List, Optional

import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field

app = FastAPI(
    title="UI Audit",
    description="Screenshot any URL at 4 viewports and score UX across 7 dimensions using Gemini. Returns S1/S2/S3/S4 severity findings.",
    version="0.1.0",
)

VIEWPORTS = [
    {"name": "desktop-1920", "width": 1920, "height": 1080},
    {"name": "desktop-1280", "width": 1280, "height": 800},
    {"name": "tablet-768", "width": 768, "height": 1024},
    {"name": "mobile-375", "width": 375, "height": 812},
]

DIMENSIONS = [
    "layout",
    "visual_hierarchy",
    "typography",
    "contrast",
    "affordance",
    "content_clarity",
    "mobile_ux",
]

SEVERITY_SCALE = """
S1 — Critical: broken flow, unusable on a viewport, page blank, can't complete core action
S2 — Major: wrong visual hierarchy, significant layout issue, CTA hidden, misleading colours
S3 — Minor: small spacing inconsistency, subtle misalignment, minor polish issue
S4 — Cosmetic: sub-pixel differences, animation timing, barely visible
"""

AUDIT_PROMPT = """You are an expert UX auditor. You are given screenshots of a web page at multiple viewports.

Score the interface across these 7 dimensions (0-100 each):
1. Layout — structure, alignment, whitespace
2. Visual Hierarchy — attention flow, prominence of key elements
3. Typography — readability, scale, line-height, font choices
4. Contrast — colour contrast ratios, legibility
5. Affordance — buttons look clickable, links look like links, interactive elements are obvious
6. Content Clarity — clear labels, no jargon, helpful empty states, good microcopy
7. Mobile UX — usable on small screen, touch targets adequate, not just squeezed desktop

For each real issue you find, produce a finding with:
- severity: S1, S2, S3, or S4 (use this scale: {severity_scale})
- category: one of {dimensions}
- description: what the problem is and why it matters
- fix: specific, actionable recommendation
- viewport: which viewport(s) show the issue

Return valid JSON only, no markdown fences, matching this exact shape:
{{
  "overall_score": <integer 0-100>,
  "dimension_scores": {{
    "layout": <0-100>,
    "visual_hierarchy": <0-100>,
    "typography": <0-100>,
    "contrast": <0-100>,
    "affordance": <0-100>,
    "content_clarity": <0-100>,
    "mobile_ux": <0-100>
  }},
  "findings": [
    {{
      "severity": "S1|S2|S3|S4",
      "category": "<dimension>",
      "description": "<what and why>",
      "fix": "<specific recommendation>",
      "viewport": "<viewport name or 'all'>"
    }}
  ],
  "summary": "<2-3 sentence overall assessment>"
}}
"""


class ViewportConfig(BaseModel):
    name: str
    width: int
    height: int


class Finding(BaseModel):
    severity: str = Field(description="S1 (Critical), S2 (Major), S3 (Minor), S4 (Cosmetic)")
    category: str = Field(description="UX dimension: layout, visual_hierarchy, typography, contrast, affordance, content_clarity, mobile_ux")
    description: str = Field(description="What the problem is and why it matters")
    fix: str = Field(description="Specific actionable recommendation")
    viewport: str = Field(description="Viewport name or 'all'")


class DimensionScores(BaseModel):
    layout: int
    visual_hierarchy: int
    typography: int
    contrast: int
    affordance: int
    content_clarity: int
    mobile_ux: int


class ScreenshotResult(BaseModel):
    viewport: str
    width: int
    height: int


class Input(BaseModel):
    url: str = Field(description="URL to audit (must be publicly accessible)", example="https://example.com")
    viewports: Optional[List[ViewportConfig]] = Field(
        default=None,
        description="Custom viewports to capture. Defaults to 1920, 1280, 768, 375px widths.",
    )
    dimensions: Optional[List[str]] = Field(
        default=None,
        description="UX dimensions to focus on. Defaults to all 7.",
    )
    wait_for_selector: Optional[str] = Field(
        default=None,
        description="CSS selector to wait for before screenshotting (useful for SPAs).",
    )


class Output(BaseModel):
    overall_score: int = Field(description="Overall UX score 0-100")
    dimension_scores: DimensionScores
    findings: List[Finding] = Field(description="Ranked findings, S1 first")
    screenshots: List[ScreenshotResult] = Field(description="Viewports captured")
    summary: str = Field(description="2-3 sentence overall assessment")
    s1_count: int = Field(description="Number of critical findings")
    s2_count: int = Field(description="Number of major findings")
    s3_count: int = Field(description="Number of minor findings")
    s4_count: int = Field(description="Number of cosmetic findings")


async def capture_screenshots(url: str, viewports: List[dict], wait_for_selector: Optional[str]) -> List[dict]:
    """Capture full-page screenshots at each viewport. Returns list of {viewport, width, height, b64}."""
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            for vp in viewports:
                page = await browser.new_page(
                    viewport={"width": vp["width"], "height": vp["height"]},
                    user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                )
                try:
                    await page.goto(url, wait_until="networkidle", timeout=30000)
                    if wait_for_selector:
                        await page.wait_for_selector(wait_for_selector, timeout=10000)
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                        path = f.name
                    await page.screenshot(path=path, full_page=True)
                    with open(path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    os.unlink(path)
                    results.append({
                        "viewport": vp["name"],
                        "width": vp["width"],
                        "height": vp["height"],
                        "b64": b64,
                    })
                finally:
                    await page.close()
        finally:
            await browser.close()
    return results


def build_gemini_prompt(dimensions: List[str]) -> str:
    return AUDIT_PROMPT.format(
        severity_scale=SEVERITY_SCALE,
        dimensions=", ".join(dimensions),
    )


@app.post("/run", response_model=Output)
async def run(input: Input) -> Output:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")

    viewports = [vp.model_dump() for vp in input.viewports] if input.viewports else VIEWPORTS
    dimensions = input.dimensions or DIMENSIONS

    try:
        screenshots = await capture_screenshots(input.url, viewports, input.wait_for_selector)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Screenshot capture failed: {e}")

    if not screenshots:
        raise HTTPException(status_code=422, detail="No screenshots captured")

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash-001")

    parts = [build_gemini_prompt(dimensions)]
    for shot in screenshots:
        parts.append(f"\n--- Viewport: {shot['viewport']} ({shot['width']}x{shot['height']}) ---")
        parts.append(
            genai.types.Part.from_bytes(
                data=base64.b64decode(shot["b64"]),
                mime_type="image/png",
            )
        )

    try:
        response = model.generate_content(parts)
        raw = response.text.strip()
        # Strip markdown fences if model adds them anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Gemini returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini call failed: {e}")

    findings = [Finding(**f) for f in data.get("findings", [])]
    # Sort S1 first
    sev_order = {"S1": 0, "S2": 1, "S3": 2, "S4": 3}
    findings.sort(key=lambda f: sev_order.get(f.severity, 9))

    ds = data.get("dimension_scores", {})
    return Output(
        overall_score=data.get("overall_score", 0),
        dimension_scores=DimensionScores(
            layout=ds.get("layout", 0),
            visual_hierarchy=ds.get("visual_hierarchy", 0),
            typography=ds.get("typography", 0),
            contrast=ds.get("contrast", 0),
            affordance=ds.get("affordance", 0),
            content_clarity=ds.get("content_clarity", 0),
            mobile_ux=ds.get("mobile_ux", 0),
        ),
        findings=findings,
        screenshots=[ScreenshotResult(viewport=s["viewport"], width=s["width"], height=s["height"]) for s in screenshots],
        summary=data.get("summary", ""),
        s1_count=sum(1 for f in findings if f.severity == "S1"),
        s2_count=sum(1 for f in findings if f.severity == "S2"),
        s3_count=sum(1 for f in findings if f.severity == "S3"),
        s4_count=sum(1 for f in findings if f.severity == "S4"),
    )


@app.get("/health")
def health():
    return {"status": "ok"}
