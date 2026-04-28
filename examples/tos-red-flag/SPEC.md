---
slug: tos-red-flag
display_name: TOS Red Flag Scanner
category: productivity
viral_hook: "Paste a Terms of Service — get the 5 scariest clauses explained in plain English in under 8 seconds"
audience: Anyone signing up for a service, privacy-conscious users, founders reviewing contracts
latency_target_ms: 8000
runtime_kind: gemini
gemini_model: gemini-2.5-flash-lite
handles_money: false
input_schema:
  text:
    type: string
    description: The Terms of Service text to analyze (max 10000 chars)
    max_length: 10000
    required: true
  source:
    type: string
    description: Optional — name of the service (e.g. "OpenAI", "Spotify") for context
    max_length: 100
    required: false
output_schema:
  red_flags:
    type: array
    items:
      type: object
      properties:
        clause:
          type: string
          description: The problematic clause or phrase (quoted)
        risk_type:
          type: string
          description: Category of risk (data-sharing / arbitration / termination / auto-renewal / liability / ip-ownership / other)
        plain_english:
          type: string
          description: What this actually means in plain language
        severity:
          type: string
          description: How bad this is (low / medium / high)
  risk_level:
    type: string
    description: Overall risk level for this TOS (low / medium / high)
  plain_english_summary:
    type: string
    description: 2-3 sentence plain-English summary of the biggest concerns
  red_flag_count:
    type: integer
    description: Total number of red flags found
test_inputs:
  - { text: "We may share your personal data with third parties for marketing purposes without your explicit consent." }
  - { text: "You agree to binding arbitration and waive your right to class-action lawsuits." }
  - { text: "Your content license: You grant us a worldwide, royalty-free, irrevocable license to use, reproduce, and distribute your content." }
golden_inputs:
  - { text: "We may share your personal data with third parties for marketing purposes without your explicit consent." }
  - { text: "You agree that we may terminate your account at any time, for any reason, without notice or liability." }
  - { text: "Your usage data, including prompts and outputs, may be used to train our AI models." }
golden_outputs:
  - { red_flags_min: 1, required_keys: [red_flags, risk_level, plain_english_summary, red_flag_count] }
  - { red_flags_min: 1, required_keys: [red_flags, risk_level, plain_english_summary, red_flag_count] }
  - { red_flags_min: 1, required_keys: [red_flags, risk_level, plain_english_summary, red_flag_count] }
---

# TOS Red Flag Scanner

Paste any Terms of Service or contract section — get the top red flags explained in plain English.
No lawyer needed. No reading the entire document.

## Why it works

TOS documents average 5,000-10,000 words. Nobody reads them. But they contain clauses that
matter — data sharing, arbitration, IP ownership, auto-renewal traps. This app surfaces only
the parts that should make you pause.

## Input

- `text` (required): TOS text to analyze, max 10,000 characters
- `source` (optional): Service name for context

## Output

- `red_flags`: List of problematic clauses with explanation and severity
- `risk_level`: Overall risk (low / medium / high)
- `plain_english_summary`: 2-3 sentence summary of the biggest concerns
- `red_flag_count`: How many flags were found
