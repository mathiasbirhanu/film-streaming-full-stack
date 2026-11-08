#!/bin/bash
# One-shot .NET API smoke test: builds, boots on :5080 against the embedded
# PostgreSQL, exercises the core endpoints, then tears down.
cd /home/z/my-project/backend/StreamRoots.Api
export DOTNET_CLI_TELEMETRY_OPTOUT=1 NUGET_PACKAGES=/home/z/my-project/.nuget DOTNET_NOLOGO=1
export STREAMROOTS_PG="Host=127.0.0.1;Port=5433;Database=streamroots;Username=streamroots"
export ASPNETCORE_URLS="http://127.0.0.1:5080"

FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 expected=$2 got=$3"; FAIL=1; fi; }

# kill any zombie API instance squatting on :5080
lsof -ti:5080 2>/dev/null | xargs -r kill -9; sleep 1

/home/z/my-project/.dotnet/dotnet build -v q 2>&1 | rg -q "error" && { echo "BUILD FAILED"; exit 1; }
echo "== build ok =="

/home/z/my-project/.dotnet/dotnet bin/Debug/net9.0/StreamRoots.Api.dll > /tmp/sr-api.log 2>&1 &
API=$!
UP=0
for i in $(seq 1 30); do sleep 1; curl -sf http://127.0.0.1:5080/health >/dev/null 2>&1 && { UP=1; break; }; done
[ "$UP" = "1" ] && echo "== api up ==" || { echo "API NEVER CAME UP"; tail -5 /tmp/sr-api.log; kill $API 2>/dev/null; exit 1; }

# 1. health
check "GET /health" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5080/health)"

# 2. public catalog — must be a JSON array of 4 published titles, no sourceRef
CAT=$(curl -s http://127.0.0.1:5080/api/catalog)
COUNT=$(echo "$CAT" | bun -e "const d=await new Response(require('fs').readFileSync(0)).json(); console.log(d.length)")
check "catalog items (PG published)" 4 "$COUNT"
echo "$CAT" | rg -q "sourceRef" && { echo "FAIL  catalog leaks sourceRef"; FAIL=1; } || echo "PASS  catalog hides sourceRef"

# 3. playlists rail — 2 published playlists
PL=$(curl -s http://127.0.0.1:5080/api/catalog/playlists)
PLC=$(echo "$PL" | bun -e "const d=await new Response(require('fs').readFileSync(0)).json(); console.log(d.length)")
check "playlists rail" 2 "$PLC"

# 4. login as admin (scrypt verify against Node-minted hash)
LOGIN=$(curl -s -c /tmp/sr-cookies.txt -X POST http://127.0.0.1:5080/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"admin@demo.stream","password":"demo1234"}')
echo "$LOGIN" | rg -q '"ok":true' && echo "PASS  admin login (scrypt verified)" || { echo "FAIL  admin login: $LOGIN"; FAIL=1; }

# 5. admin income report — exact ledger numbers
INC=$(curl -s -b /tmp/sr-cookies.txt http://127.0.0.1:5080/api/admin/income)
echo "$INC" | rg -q '"grossCents":299' && echo "PASS  income gross=299" || { echo "FAIL  income: $INC" | head -2; FAIL=1; }
echo "$INC" | rg -q '"producerCents":209' && echo "PASS  income producer=209" || { echo "FAIL  producer share"; FAIL=1; }
echo "$INC" | rg -q '"platformCents":90'  && echo "PASS  income platform=90"  || { echo "FAIL  platform share"; FAIL=1; }
echo "$INC" | rg -q '"producerShareBps":7000' && echo "PASS  share default 7000" || { echo "FAIL  share bps"; FAIL=1; }

# 6. role gate — no cookie on admin endpoint must fail
ANON=$(curl -s http://127.0.0.1:5080/api/admin/income)
echo "$ANON" | rg -q '"ok":false' && echo "PASS  admin gated when anonymous" || { echo "FAIL  admin not gated"; FAIL=1; }

# 7. producer isolation — Kwame's income must show ONLY his title
curl -s -c /tmp/sr-kwame.txt -X POST http://127.0.0.1:5080/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"producer2@demo.stream","password":"demo1234"}' > /dev/null
KINC=$(curl -s -b /tmp/sr-kwame.txt http://127.0.0.1:5080/api/producer/income)
KT=$(echo "$KINC" | bun -e "const d=await new Response(require('fs').readFileSync(0)).json(); console.log(d.data.rows.map(r=>r.title).join('|'))")
check "producer income isolated" "Tears of Steel" "$KT"

# 8. producer group gate — viewer must be rejected
curl -s -c /tmp/sr-viewer.txt -X POST http://127.0.0.1:5080/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"viewer@demo.stream","password":"demo1234"}' > /dev/null
VGATE=$(curl -s -b /tmp/sr-viewer.txt http://127.0.0.1:5080/api/producer/income)
echo "$VGATE" | rg -q "Producer access required" && echo "PASS  viewer blocked from producer API" || { echo "FAIL  viewer gate: $VGATE"; FAIL=1; }

kill $API 2>/dev/null
[ "$FAIL" = "0" ] && echo "== API SMOKE: ALL PASSED ==" || echo "== API SMOKE: FAILURES =="
exit $FAIL
