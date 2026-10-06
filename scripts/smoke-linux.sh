#!/usr/bin/env bash
# Native Electron on private X11/Wayland displays and a private D-Bus session.
set -euo pipefail
if [[ "${1:-}" != inner ]]; then
  exec dbus-run-session -- bash "$0" inner "${1:-x11}"
fi
mode="${2:-x11}"
test "$mode" = x11 || test "$mode" = wayland
# Electron loads libnotify dynamically; a notification server alone is insufficient.
python3 -c 'import ctypes; ctypes.CDLL("libnotify.so.4")' || {
  echo "Native notification smoke requires libnotify.so.4 (Ubuntu: install libnotify4)." >&2
  exit 1
}
runtime="$(mktemp -d)"
export HOME="$runtime/home" XDG_CONFIG_HOME="$runtime/config" XDG_CACHE_HOME="$runtime/cache"
export XDG_RUNTIME_DIR="$runtime/run" XDG_SESSION_TYPE="$mode" LUMILAN_DESKTOP_FIXTURE=1
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
pids=()
cleanup() {
  result=$?
  if [[ "$result" != 0 ]]; then
    for log in "$runtime"/*.log; do test ! -f "$log" || tail -n 40 "$log"; done
  fi
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
  rm -rf -- "$runtime"
}
trap cleanup EXIT
python3 scripts/desktop-fixture.py >"$runtime/desktop.log" 2>&1 & pids+=("$!")
for attempt in {1..50}; do
  if gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.GetActive >/dev/null 2>&1; then break; fi
  sleep .1
done
gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.GetActive
if [[ "$mode" = x11 ]]; then
  unset WAYLAND_DISPLAY
  Xvfb -displayfd 3 -screen 0 1920x1080x24 -nolisten tcp 3>"$runtime/display" >"$runtime/x11.log" 2>&1 & pids+=("$!")
  for attempt in {1..50}; do if [[ -s "$runtime/display" ]]; then break; fi; sleep .1; done
  test -s "$runtime/display"
  export DISPLAY=":$(cat "$runtime/display")"
  for attempt in {1..50}; do if xdpyinfo >/dev/null 2>&1; then break; fi; sleep .1; done
  xdpyinfo >/dev/null
  openbox >"$runtime/wm.log" 2>&1 & pids+=("$!")
  trayer --edge bottom --align right --widthtype request >"$runtime/tray.log" 2>&1 & pids+=("$!")
else
  unset DISPLAY
  export WAYLAND_DISPLAY=lumilan-smoke
  weston --backend=headless-backend.so --use-pixman --socket="$WAYLAND_DISPLAY" --idle-time=0 --width=1920 --height=1080 >"$runtime/wayland.log" 2>&1 & pids+=("$!")
  for attempt in {1..50}; do if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then break; fi; sleep .1; done
  test -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
fi
repetitions="${LUMILAN_NOTCH_SMOKE_REPEATS:-3}"
case "$repetitions" in 1|2|3) ;; *) echo 'Smoke repetitions must be 1, 2, or 3.' >&2; exit 1 ;; esac
for ((attempt=1; attempt<=repetitions; attempt++)); do node out/scripts/smoke-ui.cjs; node out/scripts/smoke-notch.cjs; done
