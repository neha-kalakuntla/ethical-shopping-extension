# Tesseract.js local OCR runtime

The extension bundles these official packages so OCR runs locally under Chrome Manifest V3:

- `tesseract.js` 7.0.0 — Apache-2.0
- `tesseract.js-core` 7.0.0, LSTM compatibility build — Apache-2.0
- `@tesseract.js-data/eng` 1.0.0, `4.0.0_best_int` model — MIT

Sources: https://github.com/naptha/tesseract.js and https://github.com/naptha/tessdata

Only digits and separators are enabled for the barcode fallback. OCR output is accepted as a GTIN only when its length and check digit are valid.
