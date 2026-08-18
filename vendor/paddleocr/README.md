# PaddleOCR local browser runtime

The extension bundles these components so its second OCR pass runs locally with no API key:

- `@paddleocr/paddleocr-js` 0.4.2 — Apache-2.0
- `onnxruntime-web` 1.27.0 — MIT
- `@techstark/opencv-js` 4.10.0-release.1 — Apache-2.0
- `PP-OCRv5_mobile_det` and `PP-OCRv5_mobile_rec` official inference models

Sources:

- https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js
- https://github.com/microsoft/onnxruntime
- https://github.com/TechStark/opencv-js
- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/

The JavaScript dependencies are bundled as extension-owned code. Model archives, the ONNX
WebAssembly runtime, and its local module loader are also extension-owned assets; no code is
fetched from an external service at runtime.
