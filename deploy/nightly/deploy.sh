#!/usr/bin/env bash
set -Eeuo pipefail

app_dir=/opt/cep-front
repo=luisotvbim-sudo/CEP-FRONT
health_url=https://cep.lat/healthz
cd "$app_dir"

compose=(docker compose --env-file .env -f compose.production.yaml)
current=$(git rev-parse HEAD)
old_image=$(docker inspect --format '{{.Config.Image}}' cep-front-production-web-1 2>/dev/null || true)
if [[ "$old_image" == cep-front:* ]]; then
  old_tag=${old_image#cep-front:}
else
  old_tag=$(sed -n 's/^FRONT_IMAGE_TAG=//p' .env | tail -n 1)
  old_tag=${old_tag:-${current:0:12}}
fi

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo 'Tracked files on the VM have local changes; deployment skipped.' >&2
  exit 1
fi

git fetch --no-tags origin main
target=$(git rev-parse FETCH_HEAD)
if [[ "$current" == "$target" ]]; then
  echo "CEP front already uses the latest main commit: ${target:0:12}"
  exit 0
fi
if ! git merge-base --is-ancestor "$current" "$target"; then
  echo 'The main branch is not a normal continuation of the deployed commit; deployment skipped.' >&2
  exit 1
fi

ci_file=$(mktemp)
source_dir=$(mktemp -d)
cleanup() {
  rm -f -- "$ci_file"
  rm -rf -- "$source_dir"
}
trap cleanup EXIT

curl --fail --silent --show-error --max-time 30 \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: CEP-FRONT-nightly-deployment' \
  "https://api.github.com/repos/$repo/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=$target&per_page=10" \
  -o "$ci_file"

python3 - "$ci_file" "$target" "$repo" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
sha, repository = sys.argv[2:]
runs = data.get('workflow_runs', [])
if not runs:
    raise SystemExit('No CI run exists for the new main commit.')
run = max(runs, key=lambda item: (item.get('run_number', 0), item.get('run_attempt', 0)))
valid = (run.get('head_sha') == sha and run.get('head_branch') == 'main'
         and run.get('event') == 'push' and run.get('status') == 'completed'
         and run.get('conclusion') == 'success'
         and run.get('repository', {}).get('full_name') == repository)
if not valid:
    raise SystemExit('The latest CI run for this commit is not successful; deployment skipped.')
PY

tag=${target:0:12}
git archive "$target" | tar -x -C "$source_dir"
docker build -t "cep-front:$tag" "$source_dir"

rollback_and_exit() {
  local reason=$1
  echo "Deployment failed: $reason. Restoring front commit ${current:0:12}." >&2
  set +e
  git checkout --detach "$current"
  sed -i "s/^FRONT_IMAGE_TAG=.*/FRONT_IMAGE_TAG=$old_tag/" .env
  "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 60 web
  exit 1
}

git checkout --detach "$target" || rollback_and_exit 'the target commit could not be checked out'
sed -i "s/^FRONT_IMAGE_TAG=.*/FRONT_IMAGE_TAG=$tag/" .env \
  || rollback_and_exit 'the image tag could not be updated'
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 60 web \
  || rollback_and_exit 'the new front did not become healthy'

for attempt in {1..15}; do
  if [[ $(curl --silent --show-error --max-time 5 \
      -H 'User-Agent: CEP-FRONT-nightly-deployment' \
      -o /dev/null -w '%{http_code}' "$health_url" || true) == 200 ]]; then
    printf '%s\n' "$target" > .local/deployed-commit
    echo "CEP front deployed successfully: ${current:0:12} -> $tag"
    exit 0
  fi
  sleep 2
done

rollback_and_exit 'the public health check did not return HTTP 200'

