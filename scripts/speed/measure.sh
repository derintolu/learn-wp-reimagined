#!/usr/bin/env bash
# Studio speed baseline. Usage: scripts/speed/measure.sh <base-url> > perf/baseline-2026-10.json
# Drives the agent-browser CLI against a base URL (read-only: it only reads pages, and submits one
# fixed checkpoint answer per run). Medians of RUNS (default 5) at 1440x900 and 390x844.
#   lessonOpenMs       wall clock from `open /learn/<lesson>` until the first beat is visible
#                      (includes the CLI round trip; the same overhead is in every run)
#   beatAdvanceMs      in-page: click the continue control until the next beat is visible
#   checkpointResultMs in-page: submit the fixed answer until the result is shown. With the AI
#                      judge off the page offers the authored options instead; that path is
#                      recorded in checkpointPath ("fallback") and is not comparable to "ai".
# Each run uses a fresh browser session, so every lesson open is a cold load.
set -euo pipefail

BASE="${1:?usage: measure.sh <base-url>}"
BASE="${BASE%/}"
RUNS="${RUNS:-5}"
LESSON="${LESSON:-bt-what-is-a-block-theme}"
ANSWER="${ANSWER:-Every block theme needs style.css, whose header comment holds the name and details of the theme, and templates/index.html, the fallback template that makes WordPress treat it as a block theme.}"
FIXED='{\n  "$schema": "https://schemas.wp.org/trunk/theme.json",\n  "version": 3,\n  "settings": {\n    "color": {\n      "palette": [\n        { "name": "Base", "slug": "base", "color": "#ffffff" },\n        { "name": "Contrast", "slug": "contrast", "color": "#1e1e1e" },\n        { "name": "Subtle", "slug": "subtle", "color": "#f0f0f0" }\n      ]\n    }\n  }\n}\n'

now_ms() { perl -MTime::HiRes=time -e 'printf "%.0f", time*1000'; }
num() { tr -d '"\\ \n'; }

# Resolves with ms once `sel` is a visible element; rejects (returns -1) after 20 s.
WAIT_FN='const vis=s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
const until=(s,t=20000)=>new Promise(res=>{const t0=performance.now();const f=()=>vis(s)?res(true):performance.now()-t0>t?res(false):requestAnimationFrame(f);f()});
const sl=ms=>new Promise(r=>setTimeout(r,ms));'

run_once() { # $1 = width, $2 = height, $3 = session
  local w="$1" h="$2" S="agent-browser --session $3"
  $S set viewport "$w" "$h" >/dev/null
  local t0 t1
  t0=$(now_ms)
  $S open "$BASE/learn/$LESSON" >/dev/null
  $S eval "(async()=>{$WAIT_FN return (await until('[data-beat=\"0\"]'))?1:-1})()" >/dev/null
  t1=$(now_ms)
  local open_ms=$((t1 - t0))
  $S wait 500 >/dev/null

  local adv
  adv=$($S eval "(async()=>{$WAIT_FN
    const b=document.querySelector('.feed__continue button'); if(!b) return -1;
    const t0=performance.now(); b.click();
    if(!(await until('[data-beat=\"1\"]'))) return -1;
    return Math.round(performance.now()-t0)})()" | num)

  # Walk to the end of the beats, fix the planted bug, reach the checkpoint (not timed).
  local prep
  prep=$($S eval "(async()=>{$WAIT_FN
    for(let i=0;i<40&&document.querySelector('.feed__continue button');i++){document.querySelector('.feed__continue button').click();await sl(200)}
    if(!(await until('.bug__title'))) return 'nobug';
    if(window.innerWidth<=960){const p=[...document.querySelectorAll('.panes button')].find(x=>/workspace/i.test(x.textContent)); if(p){p.click();await sl(400)}}
    if(!(await until('.cm-content'))) return 'noeditor';
    const c=document.querySelector('.cm-content'); c.focus(); document.execCommand('selectAll');
    document.execCommand('insertText',false,\`$FIXED\`.replace(/\\\\n/g,'\n')); await sl(400);
    if(window.innerWidth<=960){const p=[...document.querySelectorAll('.panes button')].find(x=>/lesson|chat|feed/i.test(x.textContent)); if(p){p.click();await sl(400)}}
    [...document.querySelectorAll('button')].find(x=>/Check my fix/.test(x.textContent)).click();
    if(!(await until('.checkpoint'))) return 'nocheckpoint';
    await sl(1500);
    return document.querySelector('.checkpoint__form')?'ai':'fallback'})()" | num)

  local cp=-1 path="$prep"
  if [ "$prep" = ai ] || [ "$prep" = fallback ]; then
    cp=$($S eval "(async()=>{$WAIT_FN
      const ta=document.querySelector('.checkpoint__input'); let t0;
      if(ta){ta.focus();document.execCommand('insertText',false,\`$ANSWER\`);await sl(200);
        t0=performance.now(); document.querySelector('.checkpoint__form button[type=submit]').click();}
      else {const o=document.querySelector('.checkpoint__options .option'); t0=performance.now(); o.click();}
      if(!(await until('.checkpoint__echo',30000))) return -1;
      return Math.round(performance.now()-t0)})()" | num)
  fi
  $S close >/dev/null 2>&1 || true
  echo "$open_ms $adv $cp $path"
}

median() { sort -n | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:int((a[NR/2]+a[NR/2+1])/2)}'; }

declare -a OUT
PATHS=""
FAILED=0
for vp in 1440x900 390x844; do
  w=${vp%x*}; h=${vp#*x}
  o=(); a=(); c=()
  for i in $(seq 1 "$RUNS"); do
    read -r mo ma mc mp < <(run_once "$w" "$h" "speed-$vp-$i-$$")
    echo "run $vp #$i open=$mo advance=$ma checkpoint=$mc ($mp)" >&2
    o+=("$mo"); a+=("$ma"); c+=("$mc")
    if [ "$mo" -lt 0 ] || [ "$ma" -lt 0 ] || [ "$mc" -lt 0 ]; then FAILED=1; else PATHS="$PATHS $mp"; fi
  done
  OUT+=("\"$vp\": {\"lessonOpenMs\": $(printf '%s\n' "${o[@]}" | median), \"beatAdvanceMs\": $(printf '%s\n' "${a[@]}" | median), \"checkpointResultMs\": $(printf '%s\n' "${c[@]}" | median)}")
done

if [ "$FAILED" -ne 0 ]; then echo "measure.sh: at least one run failed (-1); no baseline written" >&2; exit 1; fi
CPPATH=$(echo "$PATHS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ',' | sed 's/,$//')
printf '{\n  "baseUrl": "%s",\n  "lesson": "%s",\n  "runs": %s,\n  "statistic": "median",\n  "measuredAt": "%s",\n  "provisional": %s,\n  "conditions": "%s",\n  "checkpointPath": "%s",\n  %s,\n  %s\n}\n' \
  "$BASE" "$LESSON" "$RUNS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PROVISIONAL:-false}" "${CONDITIONS:-}" "$CPPATH" "${OUT[0]}" "${OUT[1]}"
