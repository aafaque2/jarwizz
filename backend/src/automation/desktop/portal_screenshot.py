#!/usr/bin/env python3
"""
Full-screen capture on Wayland via the XDG desktop portal.

GNOME 47+ locks down org.gnome.Shell.Screenshot ("Screenshot is not allowed"),
so the supported route is org.freedesktop.portal.Screenshot. The portal writes
the PNG to a location of its own choosing (~/Pictures/Screenshot-N.png on GNOME)
and hands back a file:// URI; we move it to the destination the caller asked for
so nothing accumulates in the user's Pictures folder.

Usage: portal_screenshot.py <destination.png>
Prints the destination path on success, exits non-zero with a message on failure.
"""
import os
import shutil
import sys
from urllib.parse import unquote, urlparse

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

TIMEOUT_SECONDS = 30


def capture(dest):
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    # The portal derives the Request object path from our unique bus name.
    sender = bus.get_unique_name()[1:].replace(".", "_")
    token = "jarwizz%d" % os.getpid()
    request_path = "/org/freedesktop/portal/desktop/request/%s/%s" % (sender, token)

    loop = GLib.MainLoop()
    result = {}

    def on_response(_conn, _sender, _obj, _iface, _signal, params):
        result["code"] = params[0]
        result["data"] = dict(params[1])
        loop.quit()

    bus.signal_subscribe(
        "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request",
        "Response", request_path, None, Gio.DBusSignalFlags.NONE, on_response,
    )
    bus.call_sync(
        "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot", "Screenshot",
        GLib.Variant("(sa{sv})", ("", {
            "handle_token": GLib.Variant("s", token),
            "interactive": GLib.Variant("b", False),
        })),
        GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None,
    )

    GLib.timeout_add_seconds(TIMEOUT_SECONDS, lambda: (loop.quit(), False)[1])
    loop.run()

    if "code" not in result:
        raise RuntimeError("portal did not respond within %ds" % TIMEOUT_SECONDS)
    if result["code"] != 0:
        raise RuntimeError("portal denied the screenshot (response code %d)" % result["code"])

    uri = result["data"].get("uri")
    if not uri:
        raise RuntimeError("portal returned no image URI")

    src = unquote(urlparse(uri).path)
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    shutil.move(src, dest)
    return dest


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: portal_screenshot.py <destination.png>")
    try:
        print(capture(sys.argv[1]))
    except Exception as exc:  # surfaced verbatim by the Node caller
        sys.exit("screenshot failed: %s" % exc)
