#!/bin/sh
set -eu

display_pid=
app_pid=
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$app_pid" ]; then kill -TERM "$app_pid" 2>/dev/null || true; fi
  if [ -n "$display_pid" ]; then kill -TERM "$display_pid" 2>/dev/null || true; fi
  if [ -n "$app_pid" ]; then wait "$app_pid" 2>/dev/null || true; fi
  if [ -n "$display_pid" ]; then wait "$display_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
display_pid=$!
attempt=0
while [ ! -S /tmp/.X11-unix/X99 ]; do
  if ! kill -0 "$display_pid" 2>/dev/null || [ "$attempt" -ge 50 ]; then
    echo 'Browser display failed to start' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

node scripts/browser-pricing.mjs &
app_pid=$!
wait "$app_pid"
