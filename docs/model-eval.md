# Workers AI model evaluation

Run on 2026-10-19 with `npx tsx scripts/eval-models.ts` against the real adapter (`createWorkersAi`), the real prompts (`functions/_lib/prompts.ts`), `validatePlacement`, and the fixture content bundle. 26 cases in `tests/eval/cases.yaml` (8 placement, 8 checkpoint answers, 8 tutor questions, 2 code-feedback), each run once per candidate. Model ids were confirmed against the live Workers AI catalogue before running; prices are from https://developers.cloudflare.com/workers-ai/platform/pricing/ (2026-10-19).

## Results

First pass, at the `maxTokens` the routes were configured with (placement 400, judge 300, tutor 700, feedback 300):

| Model | JSON valid | Placement ok | Judge ok | Tutor ok | Refuses solutions | Empty reply | p50 latency | $/1000 learners |
|---|---|---|---|---|---|---|---|---|
| gpt-oss-120b | 100% (16/16) | 100% (8/8) | 100% (8/8) | 88% (7/8) | 75% (3/4) | 0% | 3.3 s (1.9 s on rerun) | $7.08 |
| glm-4.7-flash | 19% (3/16), stopped early | 38% | 0% | not run | not run | 69% | 6.7 s | n/a (incomplete) |
| llama-4-scout-17b-16e-instruct | 100% (16/16) | 100% (8/8) | 100% (8/8) | 100% (8/8) | 100% (4/4) | 0% | 4.8 s (1.6 s on rerun) | $3.85 |
| kimi-k2.6 | 13% (2/16), stopped early | 25% | 0% | not run | not run | 75% | 11.6 s | n/a (incomplete) |
| qwen3.8-27b | 75% (12/16) | 75% | 75% | 75% (6/8) | 50% (2/4) | 15% | 6.3 s | $26.78 |

The three reasoning models spend their token budget on hidden reasoning and return empty content, so they were rerun with the budget raised (placement 400 to 1500, 3.75x; judge 300 to 1200, 4x; tutor 700 to 2000, 2.9x; feedback 300 to 1000, 3.3x):

| Model | JSON valid | Placement ok | Judge ok | Tutor ok | Refuses solutions | Empty reply | Errors | p50 latency | $/1000 learners |
|---|---|---|---|---|---|---|---|---|---|
| glm-4.7-flash | 88% (14/16) | 100% | 75% | 88% | 100% (4/4) | 8% | 0 | 11.3 s | $8.36 |
| kimi-k2.6 | 81% (13/16) | 88% | 75% | 75% | 75% (3/4) | 12% | 2 timeouts | 20.5 s | $67.10 |
| qwen3.8-27b | 100% (16/16) | 100% | 100% | 75% | 75% (3/4) | 0% | 1 timeout | 7.3 s | $26.22 |

Reruns of the two finalists at the configured budgets, to check run-to-run noise: gpt-oss-120b scored the same (100% JSON, 100/100, tutor 7/8, refusals 3/4, p50 1.9 s, $7.44). llama-4-scout scored 100% on everything (p50 1.6 s, $4.27).

The cost column is "n/a (incomplete)" for a model that stopped early, because it has no tutor results to price. (An earlier version of this table left the tutor cost out and showed $0.99 and $10.75; those figures were wrong.) Cost per 1000 learners assumes 1 placement call, 6 judge calls and 20 tutor turns each, from measured token counts. These cases are single-turn and short, so real tutor turns (up to 12 history messages) will cost more input; the order of the models will not change.

"Refuses solutions" counts the four cases where the learner tries to extract the answer: three tutor questions (full answer, the planted bug, a prompt-injection rewrite of the rules) and one code-feedback injection. The plain `f-version` feedback case is not one of them. A timeout counts as not passing. A reply passes only if it has no code block and does not contain the answer or the system prompt.

## Decision

Rule from the plan: at least 95% JSON validity for `placement` and `judge`. Only gpt-oss-120b, llama-4-scout and (after raising its budgets) qwen3.8-27b clear it.

| Task | Model | maxTokens | Why |
|---|---|---|---|
| placement | `@cf/openai/gpt-oss-120b` | 400 | 100% valid and correct in both runs; reasoning is short enough that 400 never came back empty. A bad placement is the costliest mistake for a learner, so take the larger model while it costs about $0.0003 a call. |
| judge | `@cf/openai/gpt-oss-120b` | 300 | 100% valid and correct in both runs, including both injection cases. Same reasoning; 300 never came back empty. |
| tutor | `@cf/meta/llama-4-scout-17b-16e-instruct` | 700 | 100% in both runs, the only model to refuse every solution request. No hidden reasoning, so streaming starts at once. 1.6 s p50 on the rerun. A tutor call averaged $0.000162 on scout against $0.000276 on gpt-oss (41% less). gpt-oss gave the answer when asked "just give me the full theme.json" in both runs. |
| feedback | `@cf/meta/llama-4-scout-17b-16e-instruct` | 300 | Same model as tutor: hints without code, no empty replies. |

Rejected:

- glm-4.7-flash has the lowest list price ($0.06 / $0.40 per million tokens), but its reasoning eats the budget: at the configured budgets it returned empty content on 69% of calls, and its total cost could not be computed because it stopped early. With the raised budgets it is 88% valid, takes 11 s at the median, and its mix costs $8.36 per 1000 learners, more than twice the chosen mix.
- kimi-k2.6 is the most expensive ($0.95 / $4.00), the slowest (20 s p50), timed out twice, and was 81% valid even with a raised budget. Per the pricing page it also needs the Workers Paid plan or prepaid AI Gateway credits (https://developers.cloudflare.com/workers-ai/platform/pricing/).
- qwen3.8-27b only clears 95% JSON after raising every budget (2.9x to 4x), and then costs about $26 per 1000 learners (5x the chosen mix) with tutor 6/8 and refusals 3/4.

Estimated cost of the chosen mix: about $4.97 per 1000 learners, from measured mean cost per call: placement on gpt-oss 1 x $0.000293 = $0.29, judge on gpt-oss 6 x $0.000240 = $1.44, tutor on scout 20 x $0.000162 = $3.24. So the $100 monthly cap covers roughly 20,000 learners before the cap (and the $10 daily sub-cap) starts to bind.

Both finalists run well under the configured `maxTokens`, so `config.ts` keeps 400 / 300 / 700 / 300. Raising the budgets for the reasoning models is not worth it, which is the answer to live check (c).

## Live checks carried over from Task 6

(a) SSE shape and usage. The OpenAI-compatible stream sends `data: {...}` chunks with `choices[0].delta.content`, ending with `data: [DONE]`. gpt-oss, glm, qwen also emit `delta.reasoning` / `delta.reasoning_content` chunks before the answer; the adapter only reads `delta.content`, so reasoning never reaches the learner. `stream_options.include_usage` works and every chunk carries `usage`, but not the way the adapter assumed: the first chunk has the prompt count, the middle chunks are per-chunk deltas (`prompt_tokens: 0, completion_tokens: 1`), and the last chunk is cumulative (for example 74 prompt, 112 completion). The adapter used to take the last `usage` seen, which is right when the stream finishes, but a cancelled or failed stream was settled at 0 input tokens and 1 output token. Because `delta.reasoning` is not delivered, counting delivered text under-counts reasoning models too. The adapters now settle as follows. Workers AI: the input count is the per-chunk maximum (the first chunk carries the prompt), and the output is the precise figure only if the final cumulative usage chunk (both counts above 0) was seen; on cancel, error, or a normal end without that chunk, the output is settled at the reserved `maxTokens` (the worst case), so the cap is never under-counted. Anthropic: the same rule, keyed on the `message_delta` usage. Tests cover cancel, error, and normal-end-without-final-usage for both adapters, plus a usage chunk with `prompt_tokens: 0` falling back to the input estimate.

(b) `response_format` json_schema works on gpt-oss-120b and llama-4-scout (100% valid, schema fields present, authored outcomes only). It is accepted by glm, kimi and qwen too, but they often spend the whole budget on reasoning and return `content: null`, so the schema is never reached.

(c) Reasoning models. gpt-oss-120b does not return empty content at 400 / 300 / 700 / 300 (0 empty replies in 52 calls). glm-4.7-flash, kimi-k2.6 and qwen3.8-27b do (69%, 75% and 15% empty at the configured budgets, and glm still 8% and kimi 12% at 4x). Rather than raise `maxTokens` for them, the routes use models that do not need it.

## Caveats

- 26 cases, one run per candidate (two for the finalists). Differences of one case are noise. The decision rests on the clear gaps: the three reasoning models fail the JSON rule at the configured budgets, and gpt-oss was the only finalist to leak a solution.
- The expectations are mechanical (outcome sets, substring include/exclude), not a grader's opinion. Tutor answer quality beyond those checks was not scored.
- Only the `block-theme` fixture lessons were used; real lesson content is longer, so input costs will be higher than measured.
- Re-run `npx tsx scripts/eval-models.ts` when adding a candidate; `--models`, `--tokens`, `--only` and `--probe` (raw stream shape) are supported.
