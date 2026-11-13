#!/usr/bin/env python3
"""serve_https.py — server HTTPS estático para probar en la red local.

La Gamepad API (y cualquier secure-context) solo existe bajo HTTPS o localhost:
por http:// en una IP del lab los botones del mando no aparecen nunca. Este
script sirve el directorio actual por https://0.0.0.0:8443 con un certificado
self-signed (adway.local, 825 días) que se genera solo con `openssl` la primera
vez (stdlib only: nada de cryptography) y queda en ./certs/.

Uso:   python3 serve_https.py           # Ctrl-C para salir
Luego: https://<ip-wifi>:8443/  → aceptá la advertencia del certificado una vez.
"""
import os
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "0.0.0.0"
PORT = 8443
CERT_DIR = Path("certs")
CERT = CERT_DIR / "cert.pem"
KEY = CERT_DIR / "key.pem"
DAYS = 825
IFACE = "wlp4s0"  # interfaz wifi esperada; hay fallback a la primera que tenga IPv4

# openssl config: CN + SAN fijos. Con config explícita funciona igual en openssl
# 1.x y 3.x (no dependemos de -addext, que es más nuevo).
OPENSSL_CNF = """\
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = adway.local

[v3_ca]
subjectAltName = @alt_names
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = adway.local
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = 192.168.1.104
"""


def run(cmd, **kw):
    """Ejecuta cmd captureando stdout/stderr; devuelve CompletedProcess."""
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def ensure_cert():
    """Genera cert.pem/key.pem en ./certs/ invocando openssl (sin librerías extra)."""
    if CERT.exists() and KEY.exists():
        return True
    if run(["which", "openssl"]).returncode != 0:
        print("✗ hace falta `openssl` en el PATH para generar el certificado", flush=True)
        return False
    CERT_DIR.mkdir(exist_ok=True)
    cnf = CERT_DIR / "openssl.cnf"
    cnf.write_text(OPENSSL_CNF)
    r = run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(KEY), "-out", str(CERT),
             "-days", str(DAYS), "-config", str(cnf)])
    if r.returncode != 0:
        print(f"✗ openssl fallo:\n{r.stderr.strip()}", flush=True)
        return False
    os.chmod(KEY, 0o600)
    print(f"certificado self-signed generado en {CERT_DIR}/ "
          f"(CN=adway.local, SAN x4, {DAYS} días)", flush=True)
    return True


def local_ip():
    """IP real de wlp4s0 vía `ip -4 addr show`; fallback: primera IPv4 no-loopback."""
    def ipv4_of(out):
        for line in out.splitlines():
            for tok in line.split():
                if "." in tok and "/" in tok:
                    ip = tok.split("/")[0]
                    if not ip.startswith("127."):
                        return ip
        return None

    r = run(["ip", "-4", "addr", "show", IFACE])
    if r.returncode == 0:
        ip = ipv4_of(r.stdout)
        if ip:
            return ip
    r = run(["ip", "-4", "-o", "addr", "show"])
    if r.returncode == 0:
        for line in r.stdout.splitlines():
            if "lo" == line.split()[1]:
                continue
            ip = ipv4_of(line)
            if ip:
                return ip
    return "127.0.0.1"


class QuietHandler(SimpleHTTPRequestHandler):
    """Estático puro (sin token); el querystring que mande el navegador se ignora."""

    def log_message(self, fmt, *args):  # silencioso: la consola muestra solo las URLs
        pass


def serve():
    import ssl

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))

    handler = partial(QuietHandler, directory=os.getcwd())
    httpd = ThreadingHTTPServer((HOST, PORT), handler)
    httpd.daemon_threads = True
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = local_ip()
    print(f"  MORIS ARENA sirviendo {os.getcwd()}", flush=True)
    print(f"  ▶ https://{ip}:{PORT}/   (wifi, para celular/mando)", flush=True)
    print(f"  ▶ https://localhost:{PORT}/   (esta máquina)", flush=True)
    print("  aceptá la advertencia del certificado una vez (self-signed)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    print("server cerrado", flush=True)


if __name__ == "__main__":
    if not ensure_cert():
        sys.exit(1)
    serve()
