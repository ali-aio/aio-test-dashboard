#!/usr/bin/env python3
"""Read the battery of the paired iPhones over Wi-Fi (the iPhone on the pad card).

Run by server/iphones.mjs every few minutes with pymobiledevice3's Python (a venv on the lab laptop,
~/.venv-ios). Each iPhone was paired once over USB (pair record in /var/lib/lockdown) and had Wi-Fi
connections switched on; after that it answers over the network while unlocked at least once since
it started. Prints one JSON object: { "<udid>": { "pct", "charging", "external", "full", "ip" } }
for every phone it could read. Phones it can't find are simply missing.

    python iphone-battery.py <udid> [<udid> ...]
"""
import asyncio
import json
import sys

from pymobiledevice3.lockdown import get_mobdev2_lockdowns


async def browse(want, out, timeout):
    async for ip, ld in get_mobdev2_lockdowns(only_paired=True, timeout=timeout):
        try:
            if ld.udid in want and ld.udid not in out:
                b = await ld.get_value(domain="com.apple.mobile.battery")
                out[ld.udid] = {
                    "pct": b.get("BatteryCurrentCapacity"),
                    "charging": bool(b.get("BatteryIsCharging")),
                    "external": bool(b.get("ExternalConnected")),
                    "full": bool(b.get("FullyCharged")),
                    "ip": ip,
                }
        except Exception as e:  # one phone failing must not lose the others
            print(f"{ld.udid}: {type(e).__name__}: {e}", file=sys.stderr)
        finally:
            try:
                await ld.close()
            except Exception:
                pass


async def main():
    want = set(sys.argv[1:])
    out = {}
    # Bonjour answers come and go (on 2 Nov the phone was missed on the first browse and seen on
    # the third), so browse a few times until every phone asked for has been read.
    for timeout in (8, 12, 16):
        if want <= out.keys():
            break
        try:
            await browse(want, out, timeout)
        except Exception as e:
            print(f"browse: {type(e).__name__}: {e}", file=sys.stderr)
    print(json.dumps(out))


asyncio.run(main())
