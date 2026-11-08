#!/bin/bash
# One-shot parity run: boots the .NET API, runs the cross-implementation
# parity suite, tears down. TS vs .NET on the same PostgreSQL data.
export DOTNET_CLI_TELEMETRY_OPTOUT=1 NUGET_PACKAGES=/home/z/my-project/.nuget DOTNET_NOLOGO=1
export STREAMROOTS_PG="Host=127.0.0.1;Port=5433;Database=streamroots;Username=streamroots"
export ASPNETCORE_URLS="http://127.0.0.1:5080"
export DATABASE_URL="postgresql://streamroots@127.0.0.1:5433/streamroots"

lsof -ti:5080 2>/dev/null | xargs -r kill -9; sleep 1
cd /home/z/my-project/backend/StreamRoots.Api
/home/z/my-project/.dotnet/dotnet bin/Debug/net9.0/StreamRoots.Api.dll > /tmp/sr-api-parity.log 2>&1 &
API=$!
UP=0
for i in $(seq 1 30); do sleep 1; curl -sf http://127.0.0.1:5080/health >/dev/null 2>&1 && { UP=1; break; }; done
[ "$UP" = "1" ] || { echo "API NEVER CAME UP"; tail -5 /tmp/sr-api-parity.log; kill $API 2>/dev/null; exit 1; }

cd /home/z/my-project && bun scripts/parity-test.mjs
RC=$?
kill $API 2>/dev/null
exit $RC
