"""
Push-to-talk key monitoring (hold Ctrl+Shift).

Two backends, picked at runtime:

  evdev  — reads the kernel input devices directly, so it works on Wayland,
           X11 and the console alike. Needs the user in the `input` group
           (/dev/input/event* is root:input 0660). Preferred on Linux.
  pynput — X11/Win32 global hooks. Kept for Windows and X11 sessions. On a
           Wayland session pynput's X11 backend only ever sees XWayland
           clients, so it silently never fires — hence the evdev backend.

Both drive the same threading.Event: set while the combo is held, cleared on
release, which is exactly what main.py's record_while_held() waits on.
"""
import os
import sys
import threading

_MODIFIERS = ("ctrl", "ctrl_l", "ctrl_r", "shift", "shift_l", "shift_r")


# ydotoold registers its own uinput keyboard, so keystrokes Jarwizz injects via
# desktop_type come back to us as ordinary key events. Listening to that device
# would let the assistant trigger its own push-to-talk by typing Ctrl+Shift.
_SYNTHETIC_HINTS = ("ydotool", "virtual", "uinput", "xtest")


def _is_synthetic(name):
    lowered = (name or "").lower()
    return any(hint in lowered for hint in _SYNTHETIC_HINTS)


def _combo_held(pressed):
    ctrl = any(k in pressed for k in ("ctrl", "ctrl_l", "ctrl_r"))
    shift = any(k in pressed for k in ("shift", "shift_l", "shift_r"))
    return ctrl and shift


# ── evdev backend ───────────────────────────────────────────────────────────

def _start_evdev(event):
    import evdev
    from evdev import ecodes
    from selectors import DefaultSelector, EVENT_READ

    watched = {
        ecodes.KEY_LEFTCTRL: "ctrl_l",
        ecodes.KEY_RIGHTCTRL: "ctrl_r",
        ecodes.KEY_LEFTSHIFT: "shift_l",
        ecodes.KEY_RIGHTSHIFT: "shift_r",
    }

    devices = []
    for path in evdev.list_devices():
        try:
            dev = evdev.InputDevice(path)
        except OSError:
            continue  # not readable by this user; skip rather than fail
        caps = dev.capabilities().get(ecodes.EV_KEY, [])
        is_keyboard = ecodes.KEY_LEFTCTRL in caps and ecodes.KEY_LEFTSHIFT in caps
        if is_keyboard and not _is_synthetic(dev.name):
            devices.append(dev)
        else:
            dev.close()

    if not devices:
        raise RuntimeError(
            "no readable keyboard under /dev/input — add your user to the 'input' group "
            "(sudo usermod -aG input $USER) and log back in"
        )

    pressed = set()

    def pump():
        selector = DefaultSelector()
        for dev in devices:
            selector.register(dev, EVENT_READ)
        while True:
            for key, _ in selector.select():
                for ev in key.fileobj.read():
                    if ev.type != ecodes.EV_KEY:
                        continue
                    name = watched.get(ev.code)
                    if not name:
                        continue
                    if ev.value:            # 1 = down, 2 = autorepeat
                        pressed.add(name)
                    else:                   # 0 = up
                        pressed.discard(name)
                    if _combo_held(pressed):
                        event.set()
                    else:
                        event.clear()

    thread = threading.Thread(target=pump, daemon=True)
    thread.start()
    return "evdev (%s)" % ", ".join(d.name for d in devices)


# ── pynput backend ──────────────────────────────────────────────────────────

def _start_pynput(event):
    from pynput import keyboard

    pressed = set()

    def name_of(key):
        return key.name if getattr(key, "name", None) else str(key)

    def on_press(key):
        pressed.add(name_of(key))
        if _combo_held(pressed):
            event.set()

    def on_release(key):
        pressed.discard(name_of(key))
        if not _combo_held(pressed):
            event.clear()

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.daemon = True
    listener.start()
    return "pynput"


# ── Public entry point ──────────────────────────────────────────────────────

def start(event):
    """
    Start monitoring Ctrl+Shift in a daemon thread, driving `event`.
    Returns a short description of the backend in use.
    Raises RuntimeError if no backend can be started.
    """
    on_wayland = bool(os.environ.get("WAYLAND_DISPLAY")) or \
        os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"

    # On Wayland pynput is not merely worse, it is silently broken — never
    # fall back to it there, or push-to-talk would appear to work and never fire.
    backends = [_start_evdev] if sys.platform.startswith("linux") else [_start_pynput]
    if sys.platform.startswith("linux") and not on_wayland:
        backends.append(_start_pynput)

    errors = []
    for backend in backends:
        try:
            return backend(event)
        except Exception as exc:
            errors.append("%s: %s" % (backend.__name__.lstrip("_"), exc))

    raise RuntimeError("no push-to-talk backend available — " + "; ".join(errors))


if __name__ == "__main__":
    import time
    ev = threading.Event()
    print("[hotkey] backend:", start(ev))
    print("[hotkey] Hold Ctrl+Shift (Ctrl+C to quit)...")
    was = False
    while True:
        now = ev.is_set()
        if now != was:
            print("  HELD" if now else "  released")
            was = now
        time.sleep(0.05)
