#!/usr/bin/env python3
"""Minimal SMTP capture server for local/CI tests ONLY (no TLS, no auth).
Stores each received message as a .eml file in $OUT_DIR. Never use in production."""
import asyncio, os, time, re

OUT = os.environ.get("OUT_DIR", "/tmp/smtp-capture")
PORT = int(os.environ.get("SMTP_PORT", "2525"))
os.makedirs(OUT, exist_ok=True)

async def handle(reader, writer):
    def send(line): writer.write((line + "\r\n").encode())
    send("220 localhost smtp-capture")
    await writer.drain()
    mail_from, rcpt, data_mode, buf = None, [], False, []
    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode(errors="replace").rstrip("\r\n")
        if data_mode:
            if text == ".":
                data_mode = False
                name = f"{time.time():.6f}.eml"
                with open(os.path.join(OUT, name), "w") as f:
                    f.write(f"X-Capture-From: {mail_from}\nX-Capture-To: {','.join(rcpt)}\n" + "\n".join(buf))
                buf = []
                send("250 OK queued")
            else:
                buf.append(text[1:] if text.startswith("..") else text)
            await writer.drain(); continue
        cmd = text.upper()
        if cmd.startswith("EHLO"):
            writer.write(b"250-localhost\r\n250 8BITMIME\r\n")
        elif cmd.startswith("HELO"): send("250 localhost")
        elif cmd.startswith("MAIL FROM"): mail_from = text[10:].strip(); send("250 OK")
        elif cmd.startswith("RCPT TO"): rcpt.append(text[8:].strip()); send("250 OK")
        elif cmd == "DATA": data_mode = True; send("354 End data with <CR><LF>.<CR><LF>")
        elif cmd == "QUIT": send("221 Bye"); await writer.drain(); break
        elif cmd in ("RSET", "NOOP"): send("250 OK")
        else: send("250 OK")
        await writer.drain()
    writer.close()

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print(f"smtp-capture on 127.0.0.1:{PORT} -> {OUT}", flush=True)
    async with server:
        await server.serve_forever()

asyncio.run(main())
