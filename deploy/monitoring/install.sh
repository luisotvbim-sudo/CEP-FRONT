#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bash -n "$script_dir/healthcheck.sh"
install -m 0755 "$script_dir/healthcheck.sh" /usr/local/sbin/cep-front-healthcheck
install -m 0644 "$script_dir/cep-front-healthcheck.service" /etc/systemd/system/cep-front-healthcheck.service
install -m 0644 "$script_dir/cep-front-healthcheck.timer" /etc/systemd/system/cep-front-healthcheck.timer
systemd-analyze verify /etc/systemd/system/cep-front-healthcheck.service /etc/systemd/system/cep-front-healthcheck.timer
systemctl daemon-reload
systemctl enable --now cep-front-healthcheck.timer
systemctl list-timers cep-front-healthcheck.timer --no-pager

