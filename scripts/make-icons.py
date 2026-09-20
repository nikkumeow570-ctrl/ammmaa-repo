#!/usr/bin/env python3
"""Render the app icons from the Amma illustration in public/amma.js.

Needs: pip install playwright && playwright install chromium   (developer tool only, not used at runtime)
Usage: python3 scripts/make-icons.py
Writes public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon,badge-96}.png
"""
import functools, http.server, pathlib, socketserver, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'icons'
PORT = 8793
PEACOCK = '#0C4B47'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

BADGE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" fill="#fff">
  <circle cx="48" cy="16" r="9"/><ellipse cx="48" cy="44" rx="23" ry="26"/>
  <path d="M6 96 C8 74 26 66 48 66 C70 66 88 74 90 96 Z"/></svg>"""

def render(page, name, size, html, transparent=False):
    page.set_viewport_size({'width': size, 'height': size})
    page.set_content(html)
    page.evaluate('document.fonts && document.fonts.ready')
    page.wait_for_timeout(150)
    page.screenshot(path=str(OUT / name), omit_background=transparent)
    print('wrote', name)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=str(PUBLIC)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{PORT}/nothing')
        svg = page.evaluate("async () => (await import('/amma.js')).ammaSvg('loving', { decorative: true })")
        base = ('<style>*{margin:0;box-sizing:border-box}html,body{background:transparent}'
                '.amma *{animation:none!important}.amma .heart{display:none}</style>')

        def shell(size, radius, height_pct, top):
            # `top` = distance from the top edge to the top of the illustration, in % of the icon size
            return (f'{base}<div style="width:{size}px;height:{size}px;background:{PEACOCK};border-radius:{radius};'
                    f'overflow:hidden;position:relative">'
                    f'<div style="position:absolute;left:0;right:0;top:{top}%;display:flex;justify-content:center">'
                    f'{svg.replace("<svg", f"<svg style=\'height:{int(size*height_pct)}px;width:auto\'", 1)}</div></div>')

        # purpose "any": rounded square, bust anchored to the bottom
        render(page, 'icon-512.png', 512, shell(512, '112px', 0.90, 10), transparent=True)
        render(page, 'icon-192.png', 192, shell(192, '42px', 0.90, 10), transparent=True)
        # maskable: full bleed, face kept inside the central safe zone
        render(page, 'icon-maskable-512.png', 512, shell(512, '0', 1.02, 10))
        # iOS rounds the corners itself: full-bleed square
        render(page, 'apple-touch-icon.png', 180, shell(180, '0', 0.94, 8))
        # Android status-bar badge: white silhouette on transparent
        render(page, 'badge-96.png', 96, f'{base}{BADGE_SVG}', transparent=True)
        browser.close()
    httpd.shutdown()

if __name__ == '__main__':
    main()
