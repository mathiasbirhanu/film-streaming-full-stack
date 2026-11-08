#!/bin/bash
# StreamRoots full HTTP smoke test — boots the prod build on :3100,
# runs every route test, then tears down. One-shot: survives sandbox reaping.
cd /home/z/my-project
FAIL=0
note() { echo "$1"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  expected=$2 got=$3"; FAIL=1; fi
}

setsid env NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 bun .next/standalone/server.js > /tmp/sr-prod.log 2>&1 < /dev/null &
SRV=$!
UP=0
for i in $(seq 1 30); do
  sleep 1
  if curl -sf -o /dev/null http://127.0.0.1:3100/api; then UP=1; break; fi
done
if [ "$UP" != "1" ]; then echo "FATAL: prod server never came up"; cat /tmp/sr-prod.log; exit 1; fi
echo "== prod server up on :3100 =="

# 1. Home page
S=$(curl -s -o /tmp/home.html -w "%{http_code}" http://127.0.0.1:3100/)
check "GET / status" 200 "$S"
rg -q "StreamRoots" /tmp/home.html && echo "PASS  home HTML contains app name" || { echo "FAIL  home missing app name"; FAIL=1; }

# 2. Health API
BODY=$(curl -s http://127.0.0.1:3100/api)
S=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api)
check "GET /api status" 200 "$S"
echo "      /api body: $BODY"

# 3. Admin view shell (SPA — same route, different query param)
S=$(curl -s -o /tmp/admin.html -w "%{http_code}" "http://127.0.0.1:3100/?w=admin")
check "GET /?w=admin status" 200 "$S"

# 4. Thumbnail proxy — unknown id must not 5xx
S=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/thumb/nonexistent-id)
[ "$S" -ge 400 ] && [ "$S" -lt 500 ] && echo "PASS  /api/thumb unknown id -> $S (client error, no crash)" || { echo "FAIL  /api/thumb unknown id -> $S"; FAIL=1; }

# 5. Unknown route -> 404 (not a crash)
S=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/does-not-exist)
check "GET unknown route -> 404" 404 "$S"

# 6. Server action endpoint exists (POST without action id -> 400, proving route wired)
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3100/ -H "Next-Action: bogus")
[ "$S" -ge 400 ] && echo "PASS  POST / (bogus action id) -> $S (action layer armed)" || { echo "FAIL  POST / bogus -> $S"; FAIL=1; }

echo "== stopping prod server =="
kill $SRV 2>/dev/null; lsof -ti:3100 | xargs -r kill -9 2>/dev/null
[ "$FAIL" = "0" ] && echo "SMOKE RESULT: ALL PASSED" || echo "SMOKE RESULT: FAILURES PRESENT"
exit $FAIL
