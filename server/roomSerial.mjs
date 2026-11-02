// The room sensor on the lab laptop's USB (the user, 2 Nov 2026: "switch to USB, plug it into the lab laptop"):
// runs server/room-serial.py (Python standard library, no npm dependency), which opens the board's serial port
// and prints a line per reading — ROOM {"sensor","t","rh"} — and hands each one to the room store
// (server/room.mjs), stamped with the time it came. When the board is unplugged, or not there yet, the reader
// exits and is started again RETRY_S later, so plugging it in is all it takes.
// Port: auto (the first CH343 / CP210x / FTDI / Espressif USB serial), or `roomSerial` in server/config.json /
// ROOM_SERIAL; `"roomSerial": false` turns it off.
import path from 'node:path';
import { spawn } from 'node:child_process';

const RETRY_S = 20;

export function createRoomSerial(root, room, { port = null, python = 'python3', log = () => {} } = {}) {
  const script = path.join(root, 'server', 'room-serial.py');
  const st = { port: null, open: false, lastLine: null, error: null };
  let lastErr = null;
  function start() {
    const p = spawn(python, ['-I', script, ...(port ? [port] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('OPEN ')) { st.port = line.slice(5); st.open = true; st.error = null; lastErr = null; log(`reading the room sensor on ${st.port}`); }
        else if (line.startsWith('ERR ')) { st.error = line.slice(4); if (st.error !== lastErr) log(st.error); lastErr = st.error; }
        else if (line.startsWith('ROOM ')) {
          let q; try { q = JSON.parse(line.slice(5)); } catch (e) { continue; }
          const r = room.report(q);
          st.lastLine = Date.now();
          if (!r.ok) log(`bad reading "${line}": ${r.error}`);
        } else if (line.startsWith('SHT30')) { st.error = line; if (line !== lastErr) log(line); lastErr = line; }
      }
    });
    p.stderr.on('data', (c) => { const s = String(c).trim(); if (s && s !== lastErr) { log(s.split('\n').slice(-1)[0]); lastErr = s; } });
    p.on('error', (e) => { st.error = e.message; });
    p.on('close', () => {
      if (st.open) log(`room sensor on ${st.port} closed (unplugged?)`);
      st.open = false;
      setTimeout(start, RETRY_S * 1000).unref();
    });
  }
  start();
  return { status: () => ({ ...st }) };
}
