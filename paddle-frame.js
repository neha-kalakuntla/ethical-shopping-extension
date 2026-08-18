"use strict";

let enginePromise = null;

function assetUrl(path) {
  return new URL(path, location.href).href;
}

function getEngine() {
  if (!enginePromise) {
    if (typeof PaddleOCR === "undefined") return Promise.reject(new Error("PaddleOCR bundle did not initialize in its sandbox"));
    enginePromise = PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textDetectionModelAsset: { url: assetUrl("vendor/paddleocr/ppocr-det.tar") },
      textRecognitionModelAsset: { url: assetUrl("vendor/paddleocr/ppocr-rec.tar") },
      ortOptions: {
        backend: "wasm",
        wasmPaths: assetUrl("vendor/paddleocr/"),
        numThreads: 1,
        simd: true,
        proxy: false
      }
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

async function recognize(image) {
  const engine = await getEngine();
  const blob = await fetch(image).then((response) => response.blob());
  const results = await engine.predict(blob, {
    textDetLimitSideLen: 1280,
    textDetLimitType: "max",
    textRecScoreThresh: 0.35
  });
  const result = results && results[0];
  return result && Array.isArray(result.items) ? result.items : [];
}

addEventListener("message", async (event) => {
  const message = event.data;
  if (event.source !== parent || !message || message.target !== "ethical-grade-paddle-frame") return;
  if (message.type === "ping") {
    parent.postMessage({ target: "ethical-grade-paddle-parent", type: "ready" }, "*");
    return;
  }
  if (message.type !== "recognize") return;
  try {
    const items = await recognize(message.image);
    parent.postMessage({ target: "ethical-grade-paddle-parent", type: "result", requestId: message.requestId, items }, "*");
  } catch (error) {
    parent.postMessage({ target: "ethical-grade-paddle-parent", type: "result", requestId: message.requestId, items: [], error: String(error && error.message || error) }, "*");
  }
});

parent.postMessage({ target: "ethical-grade-paddle-parent", type: "ready" }, "*");
