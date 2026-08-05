#!/usr/bin/env python3
"""Assemble the single-file dashboard: src/* -> index.html (repo root)."""
import os
here=os.path.dirname(os.path.abspath(__file__))
def r(n): return open(os.path.join(here,n),encoding='utf-8').read()
bg=r('bg_b64.txt').strip()
css=r('styles.css').replace('__BGIMG__', 'url("data:image/jpeg;base64,'+bg+'")')
html=(r('template.html').replace('__CSS__',css)
      .replace('__CORE__',r('cetp_core.js')).replace('__APP__',r('app.js')))
out=os.path.join(here,'..','index.html')
open(out,'w',encoding='utf-8').write(html)
print('Built %s (%.1f KB)'%(os.path.abspath(out),len(html.encode('utf-8'))/1024))
for t in ('__CSS__','__CORE__','__APP__','__BGIMG__'):
    assert t not in html
print('OK — no unresolved tokens')
