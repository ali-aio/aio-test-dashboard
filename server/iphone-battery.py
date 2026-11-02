#!/usr/bin/env python3
"""Read the battery of the paired iPhones over Wi-Fi (the iPhone on the pad card).

Run by server/iphones.mjs every few minutes with pymobiledevice3's Python (a venv on the lab laptop,
~/.venv-ios). Each iPhone was paired once over USB (pair record in /var/lib/lockdown) and had Wi-Fi
connections switched on; after that it answers over the network while unlocked at least once since
it started. Prints one JSON object: { "<udid>": { "pct", "charging", "external", "full", "ip" } }
for every phone it could read. Phones it can't find are simply missing.

    python iphone-battery.py <udid>[=<last ip>] ...

A phone's last known address is tried first, straight over TCP with its pair record: Bonjour on the
office Wi-Fi often misses a phone for half a minute or more (2 Nov 2026), and the address changes
only when the phone restarts or rejoins the network.
"""
import asyncio
import json
import plistlib
import sys
from pathlib import Path

from pymobiledevice3.lockdown import create_using_tcp, get_mobdev2_lockdowns

RECORD_DIRS = [Path("/var/lib/lockdown"), Path.home() / ".pymobiledevice3"]


def battery(b, ip):
    return {
        "pct": b.get("BatteryCurrentCapacity"),
        "charging": bool(b.get("BatteryIsCharging")),
        "external": bool(b.get("ExternalConnected")),
        "full": bool(b.get("FullyCharged")),
        "ip": ip,
    }


async def direct(udid, ip, out):
    for d in RECORD_DIRS:
        f = d / f"{udid}.plist"
        if not f.exists():
            continue
        ld = None
        try:
            ld = await asyncio.wait_for(create_using_tcp(hostname=ip, identifier=udid, pair_record=plistlib.loads(f.read_bytes()), autopair=False), 10)
            if ld.paired:
                out[udid] = battery(await ld.get_value(domain="com.apple.mobile.battery"), ip)
                return
        except Exception as e:
            print(f"{udid} at {ip}: {type(e).__name__}: {e}", file=sys.stderr)
        finally:
            if ld is not None:
                try:
                    await ld.close()
                except Exception:
                    pass


async def browse(want, out, timeout):
    async for ip, ld in get_mobdev2_lockdowns(only_paired=True, timeout=timeout):
        try:
            if ld.udid in want and ld.udid not in out:
                out[ld.udid] = battery(await ld.get_value(domain="com.apple.mobile.battery"), ip)
        except Exception as e:  # one phone failing must not lose the others
            print(f"{ld.udid}: {type(e).__name__}: {e}", file=sys.stderr)
        finally:
            try:
                await ld.close()
            except Exception:
                pass


async def main():
    hints = dict(a.split("=", 1) if "=" in a else (a, None) for a in sys.argv[1:])
    want = set(hints)
    out = {}
    await asyncio.gather(*(direct(u, ip, out) for u, ip in hints.items() if ip))
    # Bonjour answers come and go (on 2 Nov the phone was missed on the first browse and seen on
    # the third), so browse a few times until every phone asked for has been read.
    for timeout in (8, 12, 16, 20):
        if want <= out.keys():
            break
        try:
            await browse(want, out, timeout)
        except Exception as e:
            print(f"browse: {type(e).__name__}: {e}", file=sys.stderr)
    missing = want - out.keys()
    if missing:
        print(f"not found: {', '.join(sorted(missing))}", file=sys.stderr)
    print(json.dumps(out))


asyncio.run(main())
