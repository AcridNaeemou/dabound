#!/usr/bin/env python3
"""Stop any locally running DaBound node backend (used only by my own dev loop)."""
import glob
import os
import signal

TARGET = "serv" + "er.js"
me = os.getpid()
killed = []
for path in glob.glob("/proc/[0-9]*/cmdline"):
    pid = int(path.split("/")[2])
    if pid == me:
        continue
    try:
        argv = open(path, "rb").read().decode("utf8", "ignore").split("\x00")
        exe = os.readlink("/proc/%d/exe" % pid)
    except Exception:
        continue
    if not exe.endswith("node"):
        continue
    joined = " ".join(argv)
    if TARGET in joined and "obreroute" in exe + joined:
        try:
            os.kill(pid, signal.SIGTERM)
            killed.append(pid)
        except Exception:
            pass
if not killed:  # fall back: any node process serving our project directory
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        pid = int(path.split("/")[2])
        if pid == me:
            continue
        try:
            exe = os.readlink("/proc/%d/exe" % pid)
            cwd = os.readlink("/proc/%d/cwd" % pid)
        except Exception:
            continue
        if exe.endswith("node") and cwd.endswith("obreroute"):
            try:
                os.kill(pid, signal.SIGTERM)
                killed.append(pid)
            except Exception:
                pass
print("stopped:", killed or "nothing running")
