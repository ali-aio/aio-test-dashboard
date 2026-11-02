#!/usr/bin/env python3
"""Read the room sensor (ESP32-S3 + SHT30, firmware/room-sensor/) on a USB serial port and print its
ROOM lines to stdout, one per reading, for server/roomSerial.mjs. Standard library only.

    python3 -I server/room-serial.py [/dev/ttyACM0]

With no port given it picks the first USB-serial chip it knows (the board's COM port is a CH343,
1a86:55d3; CP210x and FTDI too). It releases DTR and RTS after opening: on the board's auto-reset
circuit they can hold the chip in reset, and then nothing ever comes (2 Nov 2026). Exits when the
port goes away; the server starts it again."""
import fcntl, glob, os, select, struct, sys, termios, time

KNOWN = ('1a86', '10c4', '0403', '303a')  # QinHeng CH34x (the COM port), Silicon Labs CP210x, FTDI, Espressif's own USB


def find():
    for dev in sorted(glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')):
        name = os.path.basename(dev)
        # /sys/class/tty/ttyACM0/device -> the USB interface; its parent holds idVendor
        p = os.path.realpath(f'/sys/class/tty/{name}/device')
        for _ in range(4):
            f = os.path.join(p, 'idVendor')
            if os.path.exists(f):
                if open(f).read().strip() in KNOWN:
                    return dev
                break
            p = os.path.dirname(p)
    return None


def main():
    dev = sys.argv[1] if len(sys.argv) > 1 else find()
    if not dev:
        print('ERR no USB-serial port found (is the sensor plugged in, on its COM port?)', flush=True)
        sys.exit(2)
    fd = os.open(dev, os.O_RDWR | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    a[0] = 0; a[1] = 0; a[3] = 0
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[4] = a[5] = termios.B115200
    termios.tcsetattr(fd, termios.TCSANOW, a)
    fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack('I', termios.TIOCM_DTR | termios.TIOCM_RTS))
    print(f'OPEN {dev}', flush=True)
    buf = b''
    while True:
        r, _, _ = select.select([fd], [], [], 30)
        if not r:
            continue
        chunk = os.read(fd, 1024)
        if not chunk:  # unplugged
            sys.exit(1)
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            s = line.decode('utf8', 'replace').strip()
            if s.startswith('ROOM ') or s.startswith('SHT30'):
                print(s, flush=True)
        buf = buf[-4096:]


if __name__ == '__main__':
    try:
        main()
    except OSError as e:
        print(f'ERR {e}', flush=True)
        sys.exit(1)
