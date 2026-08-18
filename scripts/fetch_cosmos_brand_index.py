#!/usr/bin/env python3
"""Build the compact brand-ID index used for live COSMOS product lookups."""

from __future__ import annotations
import html, json, urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "https://www.cosmos-standard.org/en/databases/products-directory/"
OUTPUT = ROOT / "data" / "cosmos-brand-index.json"

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.in_brand = False; self.current = None; self.text = []; self.brands = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "select" and values.get("id") == "id_brand": self.in_brand = True
        elif self.in_brand and tag == "option": self.current = values.get("value") or ""; self.text = []
    def handle_data(self, data):
        if self.current is not None: self.text.append(data)
    def handle_endtag(self, tag):
        if self.in_brand and tag == "option" and self.current is not None:
            name = html.unescape(" ".join("".join(self.text).split()))
            if self.current and name and name != ".": self.brands.append([self.current, name])
            self.current = None; self.text = []
        elif self.in_brand and tag == "select": self.in_brand = False

def main():
    request = urllib.request.Request(URL, headers={"Accept": "text/html", "User-Agent": "EthicalGrade/0.3"})
    with urllib.request.urlopen(request, timeout=90) as response: body = response.read().decode("utf-8", "replace")
    parser = Parser(); parser.feed(body)
    OUTPUT.write_text(json.dumps({"schemaVersion": 1, "sourceUrl": URL, "brands": parser.brands}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {len(parser.brands)} COSMOS brand identifiers")

if __name__ == "__main__": main()
