# Ethical Grade Recovery Notes

Recovered from the Codex session log for task `019eff6e-5690-7890-b946-c143dda6e1f5`.

The extension source represents the stable July 18 build with the July 21 evidence-provider, certification-cache, and source-display enhancements replayed in chronological order.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the root recovered extension folder containing `manifest.json`.

## Verification

The recovered JavaScript passes syntax checks. The fixture suite passes four recorded cases:

- Amazon detail cleaning cups: C-, 71/100
- Amazon search organic towels: B, 84/100
- Amazon search leather bag: Avoid, 0/100
- Amazon detail Patagonia B Corp: C, 76/100

The `recovery/` directory contains the reconstructed architecture documents, source snapshot, generator, and fixtures from the same session.

## Preservation

This recovery was created separately. It did not overwrite the current GitHub-backed rebuild at `/Users/nehakalakuntla-pro/ethical-shopping-extension`.

## Free image identification

Right-clicking an image and choosing **Show Ethical Grade** performs product identification locally. Packaged Tesseract OCR reads visible brand and product text, nearby webpage text helps disambiguate it, and Open Food Facts provides a free optional cross-check. Barcode detection remains the best way to identify a product accurately but it is not required. No product image is uploaded to a paid AI service, and no API key is needed.
