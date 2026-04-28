---
slug: email-subject-scorer
display_name: Subject Line Scorer
category: marketing
viral_hook: "Paste your email subject line — get an open-rate score + 3 stronger rewrites in 2 seconds"
audience: Sales people, founders, marketers — anyone sending cold emails or newsletters
latency_target_ms: 3000
runtime_kind: gemini
gemini_model: gemini-2.5-flash-lite
handles_money: false
input_schema:
  subject:
    type: string
    description: The email subject line to score (max 200 chars)
    max_length: 200
    required: true
  context:
    type: string
    description: Optional — what the email is about (helps improve rewrites)
    max_length: 500
    required: false
output_schema:
  score:
    type: integer
    description: Open-rate prediction score from 1 (terrible) to 10 (excellent)
  verdict:
    type: string
    description: "One-word verdict: weak | average | strong"
  issues:
    type: array
    items: string
    description: Top 2-3 issues with the subject line
  rewrites:
    type: array
    items:
      type: object
      properties:
        angle: string
        subject: string
    description: 3 stronger subject line variants with angle labels
  explanation:
    type: string
    description: One sentence explaining the score
test_inputs:
  - { subject: "Re: Your proposal from last week" }
  - { subject: "[URGENT] You need to act NOW - Limited offer!!!" }
  - { subject: "Quick question about your marketing strategy", context: "B2B SaaS cold outreach" }
golden_inputs:
  - { subject: "Re: Your proposal from last week" }
  - { subject: "[URGENT] You need to act NOW - Limited offer!!!" }
  - { subject: "Quick question about your marketing strategy" }
golden_outputs:
  - { score_range: [4, 8], required_keys: [score, verdict, issues, rewrites, explanation] }
  - { score_range: [1, 3], required_keys: [score, verdict, issues, rewrites, explanation], verdict_enum: [weak] }
  - { score_range: [4, 8], required_keys: [score, verdict, issues, rewrites, explanation] }
---

# Subject Line Scorer

Rate any email subject line on its open-rate potential. Get a score from 1-10, the top problems,
and 3 stronger rewrites — all in under 3 seconds.

## Why it works

Subject lines are the #1 lever for email open rates. Most people write them last and revise them
zero times. This app gives instant, specific feedback without sending to a paid tool.

## Input

- `subject` (required): The email subject line, max 200 characters
- `context` (optional): What the email is about, helps tailor rewrites

## Output

- `score` (1-10): Open-rate prediction
- `verdict`: weak / average / strong
- `issues`: Top 2-3 problems with the subject
- `rewrites`: 3 stronger variants with angle labels (curiosity / value / directness)
- `explanation`: One sentence on the score
