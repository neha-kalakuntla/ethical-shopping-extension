"use strict";

let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();
let paddleFrameReady = false;
const paddleReadyWaiters = [];
const paddleRequests = new Map();

function validGtin(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - sum % 10) % 10 === Number(digits[digits.length - 1]);
}

function gtinsFromOcr(text) {
  const candidates = [];
  const matches = String(text || "").match(/(?:\d[ .-]*){8,14}/g) || [];
  matches.forEach((match) => {
    const digits = match.replace(/\D/g, "");
    if (validGtin(digits)) candidates.push(digits);
  });
  return [...new Set(candidates)];
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: chrome.runtime.getURL("vendor/tesseract/tesseract-core-lstm.wasm.js"),
      langPath: chrome.runtime.getURL("vendor/tesseract/lang"),
      workerBlobURL: false,
      gzip: true
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789 .-",
        // Each supplied image is already a barcode-focused crop. Treating it as
        // a compact text block is much more reliable for the digits beneath bars
        // than sparse-page analysis of the full package.
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
      });
      return worker;
    });
  }
  return ocrWorkerPromise;
}

function paddleFrame() {
  return document.querySelector("#paddle-ocr-frame");
}

function waitForPaddleFrame() {
  if (paddleFrameReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ping = setInterval(() => {
      const frame = paddleFrame();
      if (frame && frame.contentWindow) frame.contentWindow.postMessage({ target: "ethical-grade-paddle-frame", type: "ping" }, "*");
    }, 300);
    const timer = setTimeout(() => {
      clearInterval(ping);
      reject(new Error("PaddleOCR sandbox did not become ready"));
    }, 20000);
    paddleReadyWaiters.push(() => {
      clearInterval(ping);
      clearTimeout(timer);
      resolve();
    });
  });
}

addEventListener("message", (event) => {
  const frame = paddleFrame();
  const message = event.data;
  if (!frame || event.source !== frame.contentWindow || !message || message.target !== "ethical-grade-paddle-parent") return;
  if (message.type === "ready") {
    paddleFrameReady = true;
    paddleReadyWaiters.splice(0).forEach((ready) => ready());
    return;
  }
  if (message.type !== "result") return;
  const pending = paddleRequests.get(message.requestId);
  if (!pending) return;
  paddleRequests.delete(message.requestId);
  clearTimeout(pending.timer);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(Array.isArray(message.items) ? message.items : []);
});

async function recognizeWithPaddle(image) {
  await waitForPaddleFrame();
  const frame = paddleFrame();
  if (!frame || !frame.contentWindow) throw new Error("PaddleOCR sandbox is unavailable");
  const requestId = `paddle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const items = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      paddleRequests.delete(requestId);
      reject(new Error("PaddleOCR scan timed out"));
    }, 150000);
    paddleRequests.set(requestId, { resolve, reject, timer });
    frame.contentWindow.postMessage({ target: "ethical-grade-paddle-frame", type: "recognize", requestId, image }, "*");
  });
  const words = items.map((item) => {
    const points = Array.isArray(item.poly) ? item.poly : [];
    const xs = points.map((point) => Number(point && (point.x ?? point[0]) || 0));
    const ys = points.map((point) => Number(point && (point.y ?? point[1]) || 0));
    const x0 = xs.length ? Math.min(...xs) : 0;
    const x1 = xs.length ? Math.max(...xs) : 0;
    const y0 = ys.length ? Math.min(...ys) : 0;
    const y1 = ys.length ? Math.max(...ys) : 0;
    return {
      text: String(item.text || "").trim(),
      confidence: Math.max(0, Math.min(100, Number(item.score || 0) * 100)),
      x0, y0, x1, y1, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0)
    };
  }).filter((word) => word.text.length >= 2);
  return { text: words.map((word) => word.text).join("\n"), words };
}

function boxedWords(data) {
  const found = [];
  const seen = new Set();
  function add(word) {
    if (!word || typeof word !== "object" || seen.has(word)) return;
    seen.add(word);
    if (typeof word.text === "string" && word.bbox && Number.isFinite(Number(word.bbox.x0)) && Number.isFinite(Number(word.bbox.x1))) found.push(word);
  }
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (Array.isArray(value.words)) value.words.forEach(add);
    ["blocks", "paragraphs", "lines"].forEach((key) => visit(value[key]));
  }
  if (Array.isArray(data && data.words)) data.words.forEach(add);
  visit(data && data.blocks);
  return found;
}

function uniqueProminentWords(words) {
  const best = new Map();
  (Array.isArray(words) ? words : []).forEach((word) => {
    const key = String(word && word.text || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    if (!key) return;
    const score = Number(word.height || 0) * Math.max(1, Number(word.confidence || 0));
    const previous = best.get(key);
    if (!previous || score > previous.score) best.set(key, { word, score });
  });
  return [...best.values()].map((entry) => entry.word);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== "offscreen" || message.type !== "ETHICAL_GRADE_OCR_BARCODE") return;
  ocrQueue = ocrQueue.catch(() => undefined).then(async () => {
    try {
      const worker = await getOcrWorker();
      const packageMode = message.mode === "package";
      await worker.setParameters(packageMode ? {
        tessedit_char_whitelist: "",
        // AUTO avoids treating every tiny logo edge as an independent text line,
        // which produced harmless but noisy "Image too small" diagnostics.
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        debug_file: "/dev/null",
        preserve_interword_spaces: "1"
      } : {
        tessedit_char_whitelist: "0123456789 .-",
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
        debug_file: "/dev/null"
      });
      const texts = [];
      const paddleProminentWords = [];
      const tesseractProminentWords = [];
      const suppliedImages = Array.isArray(message.images) ? message.images : [message.image];
      let paddleStatus = packageMode ? "unavailable" : "not_requested";
      if (packageMode && suppliedImages[0]) {
        try {
          const paddle = await recognizeWithPaddle(suppliedImages[0]);
          if (paddle.text) texts.push(paddle.text);
          paddleProminentWords.push(...paddle.words);
          paddleStatus = "complete";
        } catch (error) {
          paddleStatus = `error: ${String(error && error.message || error).slice(0, 160)}`;
        }
      }
      for (let imageIndex = 0; imageIndex < suppliedImages.length; imageIndex += 1) {
        const image = suppliedImages[imageIndex];
        if (!image) continue;
        if (packageMode) {
          await worker.setParameters({
            tessedit_char_whitelist: "",
            // The complete package needs layout analysis. The remaining images
            // are focused label crops, where sparse text finds isolated display
            // words such as a brand, flavor, and certification name more often.
            tessedit_pageseg_mode: imageIndex === 0
              ? Tesseract.PSM.AUTO
              : (imageIndex === 2 || imageIndex === 3 ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SPARSE_TEXT),
            debug_file: "/dev/null",
            preserve_interword_spaces: "1"
          });
        }
        const result = await worker.recognize(image, {}, packageMode && imageIndex === 0 ? { blocks: true } : {});
        texts.push(String(result && result.data && result.data.text || ""));
        // The first package image is the complete package. Preserve a small,
        // serializable set of its OCR word boxes so the content script can use
        // visual prominence (large label text) to distinguish brands from fine
        // print. Cropped passes remain useful for text but cannot dominate size.
        if (packageMode && imageIndex === 0) {
          boxedWords(result && result.data).forEach((word) => {
            const text = String(word && word.text || "").trim();
            const box = word && word.bbox || {};
            const width = Math.max(0, Number(box.x1 || 0) - Number(box.x0 || 0));
            const height = Math.max(0, Number(box.y1 || 0) - Number(box.y0 || 0));
            const confidence = Math.max(0, Math.min(100, Number(word && word.confidence || 0)));
            if (text.length >= 2 && width >= 3 && height >= 3) tesseractProminentWords.push({
              text, width, height, confidence,
              x0: Number(box.x0 || 0), y0: Number(box.y0 || 0),
              x1: Number(box.x1 || 0), y1: Number(box.y1 || 0)
            });
          });
        }
      }
      const text = texts.join("\n");
      const counts = new Map();
      texts.forEach((recognized) => gtinsFromOcr(recognized).forEach((gtin) => counts.set(gtin, (counts.get(gtin) || 0) + 1)));
      // Bar decoding must agree across passes before OCR is reached. For the
      // printed digits, retain each check-digit-valid reading even if only one
      // crop can resolve it; the content layer still rejects multiple different
      // candidates as ambiguous.
      const candidates = packageMode ? [] : [...counts.keys()];
      const candidateCounts = packageMode ? {} : Object.fromEntries([...counts.entries()]);
      // Coordinates from different OCR engines are not interchangeable: each
      // engine scales and segments the source independently. Mixing them made
      // unrelated words appear on the same visual line. Paddle supplies the
      // primary layout; Tesseract remains a genuine fallback.
      const layoutWords = paddleProminentWords.length >= 4 ? paddleProminentWords : tesseractProminentWords;
      chrome.runtime.sendMessage({
        target: "background", type: "ETHICAL_GRADE_OCR_BARCODE_RESULT", requestId: message.requestId,
        status: "complete", candidates, candidateCounts, words: uniqueProminentWords(layoutWords).sort((a, b) => (b.height * b.confidence) - (a.height * a.confidence)).slice(0, 120),
        text: text.slice(0, packageMode ? 7000 : 500), engines: { tesseract: "complete", paddle: paddleStatus }
      });
    } catch (error) {
      ocrWorkerPromise = null;
      chrome.runtime.sendMessage({
        target: "background", type: "ETHICAL_GRADE_OCR_BARCODE_RESULT", requestId: message.requestId,
        status: "error", candidates: [], error: String(error && error.message || error)
      });
    }
  });
});
