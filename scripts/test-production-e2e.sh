#!/bin/bash
# Test all routes against production domain xactions.medirus.online
BASE_URL="https://xactions.medirus.online"
echo "=== Testing Production Routes at $BASE_URL ==="

ROUTES=(
  "/api/health"
  "/login"
  "/admin"
  "/monitor"
  "/status"
  "/run"
  "/benchmark"
  "/accounts"
  "/proxies"
  "/sessions"
  "/osint"
  "/graph"
  "/analytics"
  "/price-correlation"
  "/workflows"
  "/automations"
  "/scheduler"
  "/calendar"
  "/a2a"
  "/jev-test"
  "/thread"
  "/thread-composer"
  "/tweet-schedule"
  "/video"
  "/ai"
  "/ai-api"
  "/playground"
  "/facebook"
  "/unfollowers"
  "/mcp"
  "/extension"
  "/platform"
  "/agent"
  "/security"
)

PASSED=0
FAILED=0

for route in "${ROUTES[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$route")
  # 200 (public) or 307 (auth redirect to login) are both passing
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ]; then
    echo "  ✅ $route -> $STATUS"
    ((PASSED++))
  else
    echo "  ❌ $route -> $STATUS"
    ((FAILED++))
  fi
done

echo "=== Results: $PASSED passed, $FAILED failed ==="
