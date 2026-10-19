# Workers AI model evaluation

Run on 2026-10-19 with `npx tsx scripts/eval-models.ts` against the real adapter (`createWorkersAi`), the real prompts (`functions/_lib/prompts.ts`), `validatePlacement`, and the fixture content bundle. 26 cases in `tests/eval/cases.yaml` (8 placement, 8 checkpoint answers, 8 tutor questions, 2 code-feedback), each run once per candidate. Model ids were confirmed against the live Workers AI catalogue before running; prices are from https://developers.cloudflare.com/workers-ai/platform/pricing/ (2026-10-19).

## Results

First pass, at the `maxTokens` the routes were configured with (placement 400, judge 300, tutor 700, feedback 300):

| Model | JSON valid | Placement ok | Judge ok | Tutor ok | Refuses solutions | Empty reply | p50 latency | $/1000 learners |
|---|---|---|---|---|---|---|---|---|
| gpt-oss-120b | 100% (16/16) | 100% (8/8) | 100% (8/8) | 88% (7/8) | 80% (4/5) | 0% | 3.3 s (1.9 s on rerun) | $7.08 |
| glm-4.7-flash | 19% (3/16), stopped early | 38% | 0% | not run | not run | 69% | 6.7 s | $0.99 |
| llama-4-scout-17b-16e-instruct | 100% (16/16) | 100% (8/8) | 100% (8/8) | 100% (8/8) | 100% (5/5) | 0% | 4.8 s (1.6 s on rerun) | $3.85 |
| kimi-k2.6 | 13% (2/16), stopped early | 25% | 0% | not run | not run | 75% | 11.6 s | $10.75 |
| qwen3.8-27b | 75% (12/16) | 75% | 75% | 75% (6/8) | 40% (2/5) | 15% | 6.3 s | $26.78 |

The three reasoning models spend their token budget on hidden reasoning and return empty content, so they were rerun with the budget raised (placement 1500, judge 1200, tutor 2000, feedback 1000):

| Model | JSON valid | Placement ok | Judge ok | Tutor ok | Refuses solutions | Empty reply | Errors | p50 latency | $/1000 learners |
|---|---|---|---|---|---|---|---|---|---|
| glm-4.7-flash | 88% (14/16) | 100% | 75% | 88% | 100% (5/5) | 8% | 0 | 11.3 s | $8.36 |
| kimi-k2.6 | 81% (13/16) | 88% | 75% | 75% | 80% (4/5) | 12% | 2 timeouts | 20.5 s | $67.10 |
| qwen3.8-27b | 100% (16/16) | 100% | 100% | 75% | 80% (4/5) | 0% | 1 timeout | 7.3 s | $26.22 |

Reruns of the two finalists at the configured budgets, to check run-to-run noise: gpt-oss-120b scored the same (100% JSON, 100/100, tutor 7/8, refusals 4/5, p50 1.9 s, $7.44). llama-4-scout scored 100% on everything (p50 1.6 s, $4.27).

Cost per 1000 learners assumes 1 placement call, 6 judge calls and 20 tutor turns each, from measured token counts. These cases are single-turn and short, so real tutor turns (up to 12 history messages) will cost more input; the order of the models will not change.

"Refuses solutions" counts the cases where the learner asks for the full answer, the planted bug, or injects new rules. A reply passes only if it has no code block and does not contain the answer or the system prompt.

## Decision

Rule from the plan: at least 95% JSON validity for `placement` and `judge`. Only gpt-oss-120b, llama-4-scout and (after a 4x budget raise) qwen3.8-27b clear it.

| Task | Model | maxTokens | Why |
|---|---|---|---|
| placement | `@cf/openai/gpt-oss-120b` | 400 | 100% valid and correct in both runs; reasoning is short enough that 400 never came back empty. A bad placement is the costliest mistake for a learner, so take the larger model while it costs about $0.0003 a call. |
| judge | `@cf/openai/gpt-oss-120b` | 300 | 100% valid and correct in both runs, including both injection cases. Same reasoning; 300 never came back empty. |
| tutor | `@cf/meta/llama-4-scout-17b-16e-instruct` | 700 | 100% in both runs, the only model to refuse every solution request. No hidden reasoning, so streaming starts at once. 1.6 s p50, and about 40% cheaper per call than gpt-oss. gpt-oss gave the answer when asked "just give me the full theme.json" in both runs. |
| feedback | `@cf/meta/llama-4-scout-17b-16e-instruct` | 300 | Same model as tutor: hints without code, no empty replies. |

Rejected:

- glm-4.7-flash is the cheapest ($0.06 / $0.40) but at the configured budgets it returned empty content on 69% of calls. With a 4x budget it is still only 88% valid and takes 11 s at the median.
- kimi-k2.6 is the most expensive ($0.95 / $4.00), the slowest (20 s p50), timed out twice, and was 81% valid even with a raised budget. It also needs a paid billing method.
- qwen3.8-27b only clears 95% JSON after raising every budget 3 to 4x, and then costs about $26 per 1000 learners (3.5x the chosen mix) at 40% to 80% on tutor and refusals.

Estimated cost of the chosen mix: about $4.97 per 1000 learners (placement and judge on gpt-oss, tutor on scout), so the $100 monthly cap covers roughly 20,000 learners before the cap (and the $10 daily sub-cap) starts to bind.

Both finalists run well under the configured `maxTokens`, so `config.ts` keeps 400 / 300 / 700 / 300. Raising the budgets for the reasoning models is not worth it, which is the answer to live check (c).

## Live checks carried over from Task 6

(a) SSE shape and usage. The OpenAI-compatible stream sends `data: {...}` chunks with `choices[0].delta.content`, ending with `data: [DONE]`. gpt-oss, glm, qwen also emit `delta.reasoning` / `delta.reasoning_content` chunks before the answer; the adapter only reads `delta.content`, so reasoning never reaches the learner. `stream_options.include_usage` works and every chunk carries `usage`, but not the way the adapter assumed: the first chunk has the prompt count, the middle chunks are per-chunk deltas (`prompt_tokens: 0, completion_tokens: 1`), and the last chunk is cumulative (for example 74 prompt, 112 completion). The adapter took the last `usage` seen, which is right when the stream finishes, but a cancelled or failed stream was settled at 0 input tokens and 1 output token. Fixed in commit `fix: keep max usage across Workers AI stream chunks`, with tests that use the observed shapes.

(b) `response_format` json_schema works on gpt-oss-120b and llama-4-scout (100% valid, schema fields present, authored outcomes only). It is accepted by glm, kimi and qwen too, but they often spend the whole budget on reasoning and return `content: null`, so the schema is never reached.

(c) Reasoning models. gpt-oss-120b does not return empty content at 400 / 300 / 700 / 300 (0 empty replies in 52 calls). glm-4.7-flash, kimi-k2.6 and qwen3.8-27b do (69%, 75% and 15% empty at the configured budgets, and glm still 8% and kimi 12% at 4x). Rather than raise `maxTokens` for them, the routes use models that do not need it.

## Caveats

- 26 cases, one run per candidate (two for the finalists). Differences of one case are noise. The decision rests on the clear gaps: the three reasoning models fail the JSON rule at the configured budgets, and gpt-oss was the only finalist to leak a solution.
- The expectations are mechanical (outcome sets, substring include/exclude), not a grader's opinion. Tutor answer quality beyond those checks was not scored.
- Only the `block-theme` fixture lessons were used; real lesson content is longer, so input costs will be higher than measured.
- Re-run `npx tsx scripts/eval-models.ts` when adding a candidate; `--models`, `--tokens`, `--only` and `--probe` (raw stream shape) are supported.
