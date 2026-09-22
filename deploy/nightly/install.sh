#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test -d /opt/cep-front/.git
test -f /opt/cep-front/.local/deployed-commit
bash -n "$script_dir/deploy.sh"
systemd-analyze calendar '*-*-* 02:15:00 America/Sao_Paulo'
install -m 0755 "$script_dir/deploy.sh" /usr/local/sbin/cep-front-nightly-deploy
install -m 0644 "$script_dir/cep-front-update.service" /etc/systemd/system/cep-front-update.service
install -m 0644 "$script_dir/cep-front-update.timer" /etc/systemd/system/cep-front-update.timer
systemd-analyze verify /etc/systemd/system/cep-front-update.service /etc/systemd/system/cep-front-update.timer
systemctl daemon-reload
systemctl enable --now cep-front-update.timer
systemctl list-timers cep-front-update.timer --no-pager

