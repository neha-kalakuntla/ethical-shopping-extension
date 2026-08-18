(async () => {
  const output = document.querySelector("#result");
  try {
    const canvas = document.querySelector("#sample");
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111";
    context.font = "bold 110px sans-serif";
    context.fillText("TOFURKY", 45, 155);
    const engine = await PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textDetectionModelAsset: { url: "../vendor/paddleocr/ppocr-det.tar" },
      textRecognitionModelAsset: { url: "../vendor/paddleocr/ppocr-rec.tar" },
      ortOptions: { backend: "wasm", wasmPaths: "../vendor/paddleocr/", numThreads: 1, simd: true, proxy: false }
    });
    const [result] = await engine.predict(canvas, { textRecScoreThresh: 0.25 });
    const text = (result.items || []).map((item) => item.text).join(" ");
    output.textContent = text || "NO_TEXT";
    document.documentElement.dataset.result = /TOFURKY/i.test(text) ? "pass" : "fail";
  } catch (error) {
    output.textContent = String(error && error.stack || error);
    document.documentElement.dataset.result = "error";
  }
})();
