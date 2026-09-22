#!/usr/bin/env bash
set -Eeuo pipefail

container=cep-front-production-web-1
health_url=${HEALTH_URL:-https://app.cep.lat/healthz}
state=$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)
http_status=$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$health_url" || true)

if [[ "$state" != running || "$health" == unhealthy || "$http_status" != 200 ]]; then
  echo "CEP front healthcheck failed: container=$state health=$health public=$http_status" >&2
  exit 1
fi

echo "CEP front healthy: public=200 container=$state health=$health"

