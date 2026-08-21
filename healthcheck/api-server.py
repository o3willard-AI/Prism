# Minimal health API — Python stdlib only, no pip install required
# Provides: OS uptime
# Start with: python healthcheck\api-server.py
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8081
BOOT_TIME = time.time() - time.monotonic()  # approximate boot epoch


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence request logs

    def do_GET(self):
        if self.path in ('/', '/status'):
            body = json.dumps({
                'ok': True,
                'uptime_seconds': int(time.monotonic()),
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Health API listening on http://127.0.0.1:{PORT}')
    server.serve_forever()
