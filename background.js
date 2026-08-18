importScripts("shared.js");

const FOOD_CACHE_PREFIX = "ethicalGradeFood:";
const FOOD_SEARCH_CACHE_PREFIX = "ethicalGradeFoodSearch:v3:";
const USDA_SEARCH_CACHE_PREFIX = "ethicalGradeUsdaSearch:v1:";
const USDA_IDENTITY_CACHE_PREFIX = "ethicalGradeUsdaIdentity:v1:";
const BRANDFETCH_SEARCH_CACHE_PREFIX = "ethicalGradeBrandfetchSearch:v2:";
// Brandfetch client IDs are public browser identifiers, not secret API keys.
const BRANDFETCH_CLIENT_ID = "1id-vw5PxdUPcIibeCa";
const FOOD_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const FOOD_MISS_TTL = 24 * 60 * 60 * 1000;
const OEKO_CACHE_PREFIX = "ethicalGradeOeko:";
const VEGAN_SOCIETY_CACHE_PREFIX = "ethicalGradeVeganSociety:";
const NON_GMO_CACHE_PREFIX = "ethicalGradeNonGmo:";
const GREEN_SEAL_CACHE_PREFIX = "ethicalGradeGreenSeal:";
const EPEAT_CACHE_PREFIX = "ethicalGradeEpeat:";
const ENERGY_STAR_CACHE_PREFIX = "ethicalGradeEnergyStar:";
const COSMOS_CACHE_PREFIX = "ethicalGradeCosmos:";
const EU_ECOLABEL_CACHE_PREFIX = "ethicalGradeEuEcolabel:";
const PAGE_CLAIM_ARCHIVE_KEY = "ethicalGradePageClaims";
const PAGE_CLAIM_ARCHIVE_LIMIT = 250;
const FOOD_FIELDS = ["code", "product_name", "brands", "brands_tags", "categories_tags", "ingredients_text", "allergens_tags", "traces_tags", "labels_tags", "nutriments", "nutriscore_grade", "nova_group", "ecoscore_grade", "environmental_score_grade", "packaging", "packagings"].join(",");
let cosmosBrandIndexPromise = null;
let offscreenCreatingPromise = null;
let offscreenCloseTimer = null;
const pendingOcrRequests = new Map();

function localGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key])));
}
function localSet(key, value) {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}

async function ensureOcrDocument() {
  if (offscreenCloseTimer) clearTimeout(offscreenCloseTimer);
  offscreenCloseTimer = null;
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length) return;
  if (!offscreenCreatingPromise) {
    offscreenCreatingPromise = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run packaged local OCR for printed product barcode digits."
    }).finally(() => { offscreenCreatingPromise = null; });
  }
  await offscreenCreatingPromise;
}

function scheduleOcrDocumentClose() {
  if (offscreenCloseTimer) clearTimeout(offscreenCloseTimer);
  offscreenCloseTimer = setTimeout(async () => {
    offscreenCloseTimer = null;
    if (pendingOcrRequests.size) return;
    try {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (contexts.length) await chrome.offscreen.closeDocument();
    } catch (_error) {
      // The document may already have closed during service-worker suspension.
    }
  }, 120000);
}

async function recognizeLocalImageText(image, mode) {
  const images = (Array.isArray(image) ? image : [image]).filter((item) => String(item || "").startsWith("data:image/"));
  if (!images.length) return { status: "invalid", candidates: [], error: "No valid OCR image was supplied" };
  await ensureOcrDocument();
  const requestId = `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingOcrRequests.delete(requestId);
      scheduleOcrDocumentClose();
      resolve({ status: "timeout", candidates: [] });
    }, 180000);
    pendingOcrRequests.set(requestId, (result) => {
      clearTimeout(timer);
      scheduleOcrDocumentClose();
      resolve(result);
    });
    chrome.runtime.sendMessage({ target: "offscreen", type: "ETHICAL_GRADE_OCR_BARCODE", requestId, images, mode: mode || "barcode" });
  });
}

function recognizeBarcodeDigits(image) { return recognizeLocalImageText(image, "barcode"); }
function recognizePackageText(image) { return recognizeLocalImageText(image, "package"); }
async function fetchFoodProduct(code) {
  const normalized = EthicalGrade.normalizeBarcode(code);
  if (!EthicalGrade.validGtin(normalized)) return { status: "invalid", product: null };
  const key = `${FOOD_CACHE_PREFIX}${normalized}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}?fields=${encodeURIComponent(FOOD_FIELDS)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}`);
    const payload = await response.json();
    const product = EthicalGrade.productFromOpenFoodFacts(payload, normalized);
    const result = product ? { status: "matched", product } : { status: "not_found", product: null };
    await localSet(key, { savedAt: Date.now(), ttl: product ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", product: null, error: String(error && error.message || error) };
  }
}
const FOOD_SEARCH_STOP_WORDS = new Set("and the with from for style original organic vegan dairy free plant based product foods food net weight oz ounce ounces gram grams package nutrition ingredients".split(" "));

function foodSearchText(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function foodSearchTokens(value) {
  return [...new Set(foodSearchText(value).split(/\s+/).filter((word) => word.length >= 3 && !FOOD_SEARCH_STOP_WORDS.has(word)))];
}

function tokenAgreement(expected, actual) {
  const wanted = foodSearchTokens(expected);
  if (!wanted.length) return 0;
  const found = new Set(foodSearchTokens(actual));
  return wanted.filter((token) => found.has(token)).length / wanted.length;
}

async function searchBrandfetch(query) {
  const cleaned = String(query || "").replace(/[^A-Za-z0-9'’& .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (cleaned.length < 3) return { status: "invalid", candidates: [] };
  const cacheKey = `${BRANDFETCH_SEARCH_CACHE_PREFIX}${foodSearchText(cleaned)}`;
  const cached = await localGet(cacheKey);
  // Cache parsed candidate metadata briefly; never build a permanent local
  // copy of Brandfetch's logo collection.
  if (cached && Date.now() - cached.savedAt < FOOD_MISS_TTL) return { ...cached.result, cached: true };
  try {
    const response = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(cleaned)}?c=${encodeURIComponent(BRANDFETCH_CLIENT_ID)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Brandfetch returned ${response.status}`);
    const payload = await response.json();
    const candidates = (Array.isArray(payload) ? payload : []).map((item) => {
      const nameAgreement = tokenAgreement(cleaned, item && item.name || "");
      const queryTokens = foodSearchTokens(cleaned);
      const nameTokens = foodSearchTokens(item && item.name || "");
      const overlap = queryTokens.filter((token) => nameTokens.includes(token)).length;
      const precision = nameTokens.length ? overlap / nameTokens.length : 0;
      const lexicalAgreement = nameAgreement && precision ? 2 * nameAgreement * precision / (nameAgreement + precision) : 0;
      const compactQuery = foodSearchText(cleaned).replace(/\s+/g, "");
      const compactName = foodSearchText(item && item.name || "").replace(/\s+/g, "");
      const exactName = compactQuery && compactName && compactQuery === compactName;
      const serviceScore = Math.max(0, Math.min(1, Number(item && item._score || 0) / 60));
      const confidence = Math.min(0.99, 0.65 * Math.max(lexicalAgreement, exactName ? 0.98 : 0) + 0.35 * serviceScore);
      return {
        id: String(item && item.brandId || ""),
        name: String(item && item.name || "").trim(),
        domain: String(item && item.domain || "").trim(),
        logoUrl: String(item && item.icon || "").trim(),
        confidence,
        claimed: Boolean(item && item.claimed),
        verified: Boolean(item && item.verified)
      };
    }).filter((item) => item.id && item.name && item.domain && /^https:\/\//i.test(item.logoUrl))
      .sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    const result = { status: candidates.length ? "candidates" : "not_found", candidates };
    await localSet(cacheKey, { savedAt: Date.now(), result });
    return result;
  } catch (error) {
    return { status: "unavailable", candidates: [], error: String(error && error.message || error) };
  }
}

async function searchBrandfetchCandidates(queries) {
  const cleanedQueries = [...new Set((Array.isArray(queries) ? queries : [queries])
    .map((query) => String(query || "").trim()).filter((query) => query.length >= 3))].slice(0, 8);
  if (!cleanedQueries.length) return { status: "invalid", candidates: [] };
  const results = await Promise.all(cleanedQueries.map((query) => searchBrandfetch(query)));
  const merged = new Map();
  results.forEach((result, queryIndex) => {
    (result.candidates || []).forEach((candidate) => {
      const weightedConfidence = Math.max(0, candidate.confidence - queryIndex * 0.025);
      const existing = merged.get(candidate.id);
      if (!existing || weightedConfidence > existing.confidence) merged.set(candidate.id, {
        ...candidate,
        confidence: weightedConfidence,
        matchedQuery: cleanedQueries[queryIndex]
      });
    });
  });
  const candidates = [...merged.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  const unavailable = results.every((result) => result.status === "unavailable");
  return { status: candidates.length ? "candidates" : unavailable ? "unavailable" : "not_found", candidates, queries: cleanedQueries };
}

async function searchFoodProductsByBrand(brand, productName, ocrText, contextText) {
  const cleanBrand = String(brand || "").trim();
  const cleanProduct = String(productName || "").trim();
  const normalizedBrand = foodSearchText(cleanBrand).replace(/\s+/g, "-");
  if (normalizedBrand.length < 3) return { status: "invalid", candidates: [] };
  const cacheIdentity = foodSearchText(`${cleanBrand}|${cleanProduct}`).slice(0, 220);
  const cacheKey = `${FOOD_SEARCH_CACHE_PREFIX}${cacheIdentity}`;
  const cached = await localGet(cacheKey);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };

  const fields = "code,product_name,generic_name,brands,categories";
  const identityQuery = `${cleanBrand} ${cleanProduct}`.trim().slice(0, 180);
  const urls = [
    `https://world.openfoodfacts.org/api/v2/search?brands_tags=${encodeURIComponent(normalizedBrand)}&page_size=100&fields=${encodeURIComponent(fields)}`,
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(identityQuery)}&search_simple=1&action=process&json=1&page_size=80&fields=${encodeURIComponent(fields)}`,
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanProduct.slice(0, 140))}&search_simple=1&action=process&json=1&page_size=80&fields=${encodeURIComponent(fields)}`
  ];
  try {
    const responses = await Promise.all(urls.map(async (url) => {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Open Food Facts search returned ${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload.products) ? payload.products : [];
    }));
    const products = new Map();
    responses.flat().forEach((product) => {
      const gtin = EthicalGrade.normalizeBarcode(product && product.code);
      if (EthicalGrade.validGtin(gtin) && !products.has(gtin)) products.set(gtin, product);
    });
    const supportingText = `${ocrText || ""} ${contextText || ""}`;
    const candidates = [...products.entries()].map(([gtin, product]) => {
      const candidateBrand = product.brands || "";
      const candidateName = product.product_name || product.generic_name || "Unnamed product";
      const brandAgreement = tokenAgreement(cleanBrand, candidateBrand);
      const productAgreement = tokenAgreement(cleanProduct, `${candidateName} ${product.generic_name || ""} ${product.categories || ""}`);
      const evidenceAgreement = tokenAgreement(`${candidateBrand} ${candidateName}`, supportingText);
      const exactBrand = foodSearchText(candidateBrand).split(" ").join("").includes(foodSearchText(cleanBrand).split(" ").join(""));
      const confidence = Math.min(0.99, (exactBrand ? 0.32 : 0.25 * brandAgreement) + 0.48 * productAgreement + 0.20 * evidenceAgreement);
      return {
        gtin,
        name: candidateName,
        brand: candidateBrand || cleanBrand,
        score: Math.round(confidence * 100),
        confidence,
        brandAgreement,
        productAgreement,
        evidenceAgreement
      };
    }).filter((item) => item.brandAgreement >= 0.5 || foodSearchText(item.brand).includes(foodSearchText(cleanBrand)) || (item.productAgreement >= 0.5 && item.evidenceAgreement >= 0.3))
      .sort((a, b) => b.confidence - a.confidence || b.productAgreement - a.productAgreement).slice(0, 5);
    const best = candidates[0] || null;
    const runnerUp = candidates[1] || null;
    const sufficientlyDistinct = !runnerUp || best.confidence - runnerUp.confidence >= 0.08 || best.confidence >= 0.9;
    const directBrandMatch = best && best.confidence >= 0.72 && best.brandAgreement >= 0.5 && best.productAgreement >= 0.45;
    // OCR frequently damages a stylized brand while reading the plain product
    // description correctly. A very strong product/evidence match may recover
    // the database brand, but only when it is clearly ahead of alternatives.
    const productRecoveredBrand = best && best.confidence >= 0.6 && best.productAgreement >= 0.8 && best.evidenceAgreement >= 0.65;
    const matched = best && (directBrandMatch || productRecoveredBrand) && sufficientlyDistinct;
    let result = { status: matched ? "matched" : candidates.length ? "candidates" : "not_found", best: matched ? best : null, candidates };
    if (!matched) {
      try {
        const usdaResult = await searchUsdaProductsByIdentity(cleanBrand, cleanProduct);
        if (usdaResult.candidates.length) {
          const merged = new Map();
          [...candidates, ...usdaResult.candidates].forEach((candidate) => {
            const existing = merged.get(candidate.gtin);
            if (!existing || candidate.confidence > existing.confidence) merged.set(candidate.gtin, candidate);
          });
          const combined = [...merged.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
          const combinedBest = combined[0] || null;
          const combinedRunnerUp = combined[1] || null;
          const distinct = combinedBest && (!combinedRunnerUp || combinedBest.confidence - combinedRunnerUp.confidence >= 0.08);
          const usdaMatched = combinedBest && combinedBest.source === "USDA FoodData Central"
            && combinedBest.confidence >= 0.76 && combinedBest.brandAgreement >= 0.5
            && combinedBest.productAgreement >= 0.55 && distinct;
          result = { status: usdaMatched ? "matched" : "candidates", best: usdaMatched ? combinedBest : null, candidates: combined };
        }
      } catch (_error) {
        // Preserve Open Food Facts results when the rate-limited USDA fallback
        // is unavailable.
      }
    }
    await localSet(cacheKey, { savedAt: Date.now(), ttl: candidates.length ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", candidates: [], error: String(error && error.message || error) };
  }
}

async function searchUsdaProductsByIdentity(brand, productName) {
  const query = `${String(brand || "").trim()} ${String(productName || "").trim()}`.replace(/\s+/g, " ").trim().slice(0, 160);
  if (query.length < 5) return { candidates: [] };
  const cacheKey = `${USDA_IDENTITY_CACHE_PREFIX}${foodSearchText(query)}`;
  const cached = await localGet(cacheKey);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return cached.result;
  const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, dataType: ["Branded"], pageSize: 50 })
  });
  if (!response.ok) throw new Error(`USDA FoodData Central returned ${response.status}`);
  const payload = await response.json();
  const candidates = (Array.isArray(payload.foods) ? payload.foods : []).map((food) => {
    const gtin = EthicalGrade.normalizeBarcode(food && food.gtinUpc);
    const candidateBrand = String(food && (food.brandName || food.brandOwner) || "").trim();
    const candidateName = String(food && food.description || "").trim();
    const brandAgreement = tokenAgreement(brand, candidateBrand);
    const productAgreement = tokenAgreement(productName, candidateName);
    const evidenceAgreement = tokenAgreement(query, `${candidateBrand} ${candidateName}`);
    const confidence = Math.min(0.99, 0.3 * brandAgreement + 0.5 * productAgreement + 0.2 * evidenceAgreement);
    return { gtin, name: candidateName || "Unnamed product", brand: candidateBrand || brand, source: "USDA FoodData Central", confidence, brandAgreement, productAgreement, evidenceAgreement };
  }).filter((candidate) => EthicalGrade.validGtin(candidate.gtin) && candidate.brandAgreement >= 0.4 && candidate.productAgreement >= 0.35)
    .sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  const result = { candidates };
  await localSet(cacheKey, { savedAt: Date.now(), ttl: candidates.length ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
  return result;
}

function nutritionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function candidateServingNutrient(product, nutrient, servingGrams) {
  const nutriments = product && product.nutriments || {};
  const serving = nutritionNumber(nutriments[`${nutrient}_serving`]);
  if (serving !== null) return serving;
  const per100g = nutritionNumber(nutriments[`${nutrient}_100g`]);
  return per100g !== null && servingGrams ? per100g * servingGrams / 100 : null;
}

function usdaProductFromSearchResult(food) {
  const nutrientNames = {
    "energy": "energy-kcal",
    "total lipid fat": "fat",
    "fatty acids total saturated": "saturated-fat",
    "sodium na": "sodium",
    "carbohydrate by difference": "carbohydrates",
    "total carbohydrate": "carbohydrates",
    "sugars total including nlea": "sugars",
    "sugars total": "sugars",
    "protein": "proteins"
  };
  const nutriments = {};
  (Array.isArray(food && food.foodNutrients) ? food.foodNutrients : []).forEach((item) => {
    const name = foodSearchText(item && (item.nutrientName || item.name));
    const key = nutrientNames[name];
    const value = nutritionNumber(item && (item.value ?? item.amount));
    if (!key || value === null) return;
    const unit = String(item.unitName || item.unit || "").toLowerCase();
    // Open Food Facts represents sodium in grams per 100 g; USDA commonly
    // returns milligrams. Normalize before using the shared scorer.
    nutriments[`${key}_100g`] = key === "sodium" && unit === "mg" ? value / 1000 : value;
  });
  return {
    code: food && food.gtinUpc,
    product_name: food && food.description || "",
    generic_name: "",
    brands: food && (food.brandName || food.brandOwner) || "",
    serving_size: food && food.servingSize ? `${food.servingSize} ${food.servingSizeUnit || ""}`.trim() : "",
    quantity: food && food.packageWeight || "",
    nutriments,
    _source: "USDA FoodData Central"
  };
}

async function searchUsdaFoodProducts(brandHints, productHints) {
  const brand = (brandHints || [])[0] || "";
  // Search the strongest brand broadly. OCR product phrases are often damaged;
  // the shared scorer below still requires product-name and nutrition agreement
  // before any GTIN can be called probable.
  const query = brand.trim().slice(0, 80);
  if (query.length < 4) return [];
  const cacheKey = `${USDA_SEARCH_CACHE_PREFIX}${foodSearchText(query)}`;
  const cached = await localGet(cacheKey);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return cached.products || [];
  const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, dataType: ["Branded"], pageSize: 100 })
  });
  if (!response.ok) throw new Error(`USDA FoodData Central returned ${response.status}`);
  const payload = await response.json();
  const products = (Array.isArray(payload.foods) ? payload.foods : []).map(usdaProductFromSearchResult)
    .filter((item) => EthicalGrade.validGtin(EthicalGrade.normalizeBarcode(item.code)));
  await localSet(cacheKey, { savedAt: Date.now(), ttl: products.length ? FOOD_CACHE_TTL : FOOD_MISS_TTL, products });
  return products;
}

function rankNutritionProducts(products, input, hints, names) {
  const servingGrams = nutritionNumber(input.servingGrams);
  const specifications = [
    ["calories", "energy-kcal", 8, 0.06],
    ["fatG", "fat", 1.5, 0.12],
    ["saturatedFatG", "saturated-fat", 1, 0.15],
    ["sodiumMg", "sodium", 80, 0.18],
    ["carbohydratesG", "carbohydrates", 2, 0.15],
    ["sugarsG", "sugars", 1.5, 0.2],
    ["proteinG", "proteins", 2, 0.12]
  ];
  return products.map((product) => {
    let compared = 0;
    let agreement = 0;
    const matchedFields = [];
    specifications.forEach(([field, nutrient, absoluteTolerance, relativeTolerance]) => {
      const expectedRaw = nutritionNumber(input[field]);
      if (expectedRaw === null) return;
      const expected = field === "sodiumMg" ? expectedRaw / 1000 : expectedRaw;
      const actual = candidateServingNutrient(product, nutrient, servingGrams);
      if (actual === null) return;
      compared += 1;
      const tolerance = field === "sodiumMg" ? absoluteTolerance / 1000 : Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance);
      const closeness = Math.max(0, 1 - Math.abs(actual - expected) / Math.max(tolerance, 0.001));
      agreement += closeness;
      if (closeness >= 0.65) matchedFields.push(field);
    });
    const nutritionConfidence = compared ? agreement / compared : 0;
    const candidateBrand = foodSearchText(Array.isArray(product.brands) ? product.brands.join(" ") : product.brands || "");
    const brandAgreement = hints.some((hint) => candidateBrand.includes(hint) || hint.includes(candidateBrand)) ? 1 : 0;
    const candidateName = `${product.product_name || ""} ${product.generic_name || ""}`;
    const productAgreement = names.length ? Math.max(...names.map((hint) => tokenAgreement(hint, candidateName))) : 0;
    const confidence = nutritionConfidence * 0.75 + brandAgreement * 0.1 + productAgreement * 0.15;
    return {
      gtin: EthicalGrade.normalizeBarcode(product.code),
      name: product.product_name || product.generic_name || "Unnamed product",
      brand: Array.isArray(product.brands) ? product.brands.join(", ") : product.brands || "Unknown brand",
      source: product._source || "Open Food Facts",
      confidence, nutritionConfidence, brandAgreement, productAgreement, compared, matchedFields
    };
  }).filter((candidate) => EthicalGrade.validGtin(candidate.gtin) && candidate.compared >= 3 && candidate.nutritionConfidence >= 0.68)
    .sort((a, b) => b.confidence - a.confidence || b.compared - a.compared).slice(0, 5);
}

function probableNutritionResult(candidates) {
  const best = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  const distinct = best && (!runnerUp || best.confidence - runnerUp.confidence >= 0.08);
  const probable = best && best.compared >= 4 && best.nutritionConfidence >= 0.78
    && best.brandAgreement >= 0.9 && best.productAgreement >= 0.5 && best.confidence >= 0.82 && distinct;
  return { status: probable ? "probable" : candidates.length ? "candidates" : "not_found", best: probable ? best : null, candidates };
}

async function searchFoodProductsByNutrition(fingerprint, brandHints, productHints) {
  const input = fingerprint && typeof fingerprint === "object" ? fingerprint : {};
  const fields = ["calories", "fatG", "saturatedFatG", "sodiumMg", "carbohydratesG", "sugarsG", "proteinG"]
    .filter((field) => nutritionNumber(input[field]) !== null);
  if (fields.length < 3) return { status: "insufficient", candidates: [] };

  const hints = [...new Set((Array.isArray(brandHints) ? brandHints : []).map(foodSearchText).filter((hint) => hint.length >= 3 && hint.length <= 40))].slice(0, 6);
  const names = [...new Set((Array.isArray(productHints) ? productHints : []).map(foodSearchText).filter((hint) => hint.length >= 3 && hint.length <= 80))].slice(0, 8);
  if (!hints.length) return { status: "insufficient", candidates: [] };

  try {
    const responses = await Promise.all(hints.map(async (hint) => {
      const params = new URLSearchParams({
        brands_tags: hint.replace(/\s+/g, "-"),
        page_size: "100",
        fields: "code,product_name,generic_name,brands,serving_size,quantity,nutriments"
      });
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/search?${params}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload.products) ? payload.products : [];
    }));
    const searchableName = names.filter((name) => !/\d/.test(name) && name.split(/\s+/).length >= 2 && name.split(/\s+/).length <= 6)
      .sort((a, b) => b.length - a.length)[0] || names[0] || "";
    if (searchableName) {
      try {
        const response = await fetch("https://search.openfoodfacts.org/search", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            q: searchableName,
            page_size: 30,
            fields: ["code", "product_name", "generic_name", "brands", "serving_size", "quantity", "nutriments"]
          })
        });
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload.hits)) responses.push(payload.hits);
        }
      } catch (_error) {
        // Brand-tag results can still be ranked when full-text search is down.
      }
    }
    const uniqueProducts = new Map();
    responses.flat().forEach((product) => {
      const gtin = EthicalGrade.normalizeBarcode(product && product.code);
      if (EthicalGrade.validGtin(gtin) && !uniqueProducts.has(gtin)) uniqueProducts.set(gtin, product);
    });
    const openFoodFactsCandidates = rankNutritionProducts([...uniqueProducts.values()], input, hints, names);
    const openFoodFactsResult = probableNutritionResult(openFoodFactsCandidates);
    if (openFoodFactsResult.status === "probable") return openFoodFactsResult;

    // The shared USDA demo key is deliberately used only as a fallback because
    // it has a small public quota. Never let a fuzzy USDA result bypass the
    // same conservative nutrition, brand, product, and runner-up gates.
    try {
      const usdaProducts = await searchUsdaFoodProducts(hints, names);
      const merged = new Map();
      [...uniqueProducts.values(), ...usdaProducts].forEach((product) => {
        const gtin = EthicalGrade.normalizeBarcode(product && product.code);
        if (!EthicalGrade.validGtin(gtin)) return;
        const existing = merged.get(gtin);
        if (!existing || product._source === "USDA FoodData Central") merged.set(gtin, product);
      });
      return probableNutritionResult(rankNutritionProducts([...merged.values()], input, hints, names));
    } catch (usdaError) {
      return { ...openFoodFactsResult, fallbackError: String(usdaError && usdaError.message || usdaError) };
    }
  } catch (error) {
    return { status: "unavailable", candidates: [], error: String(error && error.message || error) };
  }
}
async function fetchOekoCertification(number) {
  const normalized = String(number || "").trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{5,40}$/i.test(normalized)) return { status: "invalid", certification: null };
  const key = `${OEKO_CACHE_PREFIX}${normalized}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const url = `https://www.oeko-tex.com/en/detail/?number=${encodeURIComponent(normalized)}&tx_avsite_labelchecksearch%5Baction%5D=search&tx_avsite_labelchecksearch%5Bcontroller%5D=LabelWidget`;
  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`OEKO-TEX returned ${response.status}`);
    const certification = EthicalGrade.oekoCertificationFromHtml(await response.text(), normalized);
    const result = certification && certification.current
      ? { status: "matched", certification }
      : { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: certification ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchVeganSocietyCertification(brand, title) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedBrand || !normalizedTitle) return { status: "invalid", certification: null };
  const key = `${VEGAN_SOCIETY_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const first = normalizedBrand.replace(/^(?:visit the |brand\s+|by\s+)/i, "").trim().charAt(0).toLowerCase();
  const letter = /^[a-z]$/.test(first) ? first : "numbers";
  const url = `https://www.vegansociety.com/search/products/${letter}`;
  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`The Vegan Society returned ${response.status}`);
    const certification = EthicalGrade.veganSocietyCertificationFromHtml(await response.text(), normalizedBrand, normalizedTitle);
    const result = certification ? { status: "matched", certification } : { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: certification ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchNonGmoCertification(brand, title, identifiers) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  const gtins = [...new Set((identifiers || []).map(EthicalGrade.normalizeBarcode).filter(EthicalGrade.validGtin))];
  if ((!normalizedBrand || !normalizedTitle) && !gtins.length) return { status: "invalid", certification: null };
  const key = `${NON_GMO_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}|${gtins.join(":")}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const keyword = gtins[0] || `${normalizedBrand} ${normalizedTitle}`.slice(0, 180);
  const url = `https://api.nongmoproject.org/api/v2/get_matching_products?page=1&keyword=${encodeURIComponent(keyword)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Non-GMO Project returned ${response.status}`);
    const certification = EthicalGrade.nonGmoCertificationFromPayload(await response.json(), normalizedBrand, normalizedTitle, gtins);
    const result = certification ? { status: "matched", certification } : { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: certification ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchGreenSealCertification(brand, title) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedBrand || !normalizedTitle) return { status: "invalid", certification: null };
  const key = `${GREEN_SEAL_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const query = `${normalizedBrand} ${normalizedTitle}`.slice(0, 180);
  const url = `https://certified.greenseal.org/search?limit=80&offset=0&query=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`Green Seal returned ${response.status}`);
    const certification = EthicalGrade.greenSealCertificationFromHtml(await response.text(), normalizedBrand, normalizedTitle);
    const result = certification ? { status: "matched", certification } : { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: certification ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchEpeatCertification(brand, title) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedBrand || !normalizedTitle) return { status: "invalid", certification: null };
  const key = `${EPEAT_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const url = `https://www.epeat.net/computers-and-displays-search-result/page-1/size-25?Filter.ProductName=${encodeURIComponent(normalizedTitle.slice(0, 180))}`;
  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`EPEAT returned ${response.status}`);
    const certification = EthicalGrade.epeatCertificationFromHtml(await response.text(), normalizedBrand, normalizedTitle);
    const result = certification ? { status: "matched", certification } : { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: certification ? FOOD_CACHE_TTL : FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchEnergyStarCertification(brand, title, identifiers) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  const gtins = [...new Set((identifiers || []).map(EthicalGrade.normalizeBarcode).filter(EthicalGrade.validGtin))];
  const candidates = gtins.length ? gtins : EthicalGrade.energyStarModelCandidates(normalizedTitle);
  if ((!normalizedBrand || !normalizedTitle) && !gtins.length || !candidates.length) return { status: "invalid", certification: null };
  const key = `${ENERGY_STAR_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}|${gtins.join(":")}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  try {
    for (const candidate of candidates) {
      const url = `https://data.energystar.gov/resource/8wj2-sec8.json?$limit=50&$q=${encodeURIComponent(candidate)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`ENERGY STAR returned ${response.status}`);
      const certification = EthicalGrade.energyStarCertificationFromPayload(await response.json(), normalizedBrand, normalizedTitle, gtins);
      if (certification) {
        const result = { status: "matched", certification };
        await localSet(key, { savedAt: Date.now(), ttl: FOOD_CACHE_TTL, result });
        return result;
      }
    }
    const result = { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
function normalizeDirectoryBrand(value) {
  return String(value || "").toLowerCase().replace(/^visit the\s+|\s+store$/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function loadCosmosBrandIndex() {
  if (!cosmosBrandIndexPromise) cosmosBrandIndexPromise = fetch(chrome.runtime.getURL("data/cosmos-brand-index.json"))
    .then((response) => response.ok ? response.json() : { brands: [] })
    .then((payload) => Array.isArray(payload.brands) ? payload.brands : [])
    .catch(() => []);
  return cosmosBrandIndexPromise;
}
async function fetchCosmosCertification(brand, title) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedBrand || !normalizedTitle) return { status: "invalid", certification: null };
  const key = `${COSMOS_CACHE_PREFIX}${normalizedBrand.toLowerCase()}|${normalizedTitle.toLowerCase()}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  const brandKey = normalizeDirectoryBrand(normalizedBrand);
  const brandIds = (await loadCosmosBrandIndex()).filter((item) => Array.isArray(item) && normalizeDirectoryBrand(item[1]) === brandKey).map((item) => item[0]);
  if (!brandIds.length) {
    const result = { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: FOOD_MISS_TTL, result });
    return result;
  }
  try {
    for (const brandId of brandIds) {
      let page = 1;
      let maxPage = 1;
      do {
        const url = `https://www.cosmos-standard.org/en/databases/products-directory/?brand=${encodeURIComponent(brandId)}&page=${page}`;
        const response = await fetch(url, { headers: { Accept: "text/html" } });
        if (!response.ok) throw new Error(`COSMOS returned ${response.status}`);
        const html = await response.text();
        const certification = EthicalGrade.cosmosCertificationFromHtml(html, normalizedBrand, normalizedTitle);
        if (certification) {
          const result = { status: "matched", certification };
          await localSet(key, { savedAt: Date.now(), ttl: FOOD_CACHE_TTL, result });
          return result;
        }
        maxPage = Math.min(30, Math.max(1, ...[...html.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]) || 1)));
        page += 1;
      } while (page <= maxPage);
    }
    const result = { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function fetchEuEcolabelCertification(identifiers) {
  const gtins = [...new Set((identifiers || []).map(EthicalGrade.normalizeBarcode).filter(EthicalGrade.validGtin))];
  if (!gtins.length) return { status: "invalid", certification: null };
  const key = `${EU_ECOLABEL_CACHE_PREFIX}${gtins.join(":")}`;
  const cached = await localGet(key);
  if (cached && Date.now() - cached.savedAt < cached.ttl) return { ...cached.result, cached: true };
  try {
    for (const gtin of gtins) {
      const url = `https://apps.data.env.service.ec.europa.eu/dataquery/v2/ecolabel/products?ean13=${encodeURIComponent(gtin)}&limit=10`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`EU Ecolabel returned ${response.status}`);
      const certification = EthicalGrade.euEcolabelCertificationFromPayload(await response.json(), gtin);
      if (certification) {
        const result = { status: "matched", certification };
        await localSet(key, { savedAt: Date.now(), ttl: FOOD_CACHE_TTL, result });
        return result;
      }
    }
    const result = { status: "not_found", certification: null };
    await localSet(key, { savedAt: Date.now(), ttl: FOOD_MISS_TTL, result });
    return result;
  } catch (error) {
    return { status: "unavailable", certification: null, error: String(error && error.message || error) };
  }
}
async function savePageClaims(message, sender) {
  const product = message && message.product || {};
  const asin = String(product.asin || "").toUpperCase();
  const gtin = EthicalGrade.normalizeBarcode(product.gtin || "");
  const productKey = /^[A-Z0-9]{10}$/.test(asin) ? `asin:${asin}` : (EthicalGrade.validGtin(gtin) ? `gtin:${gtin}` : "");
  if (!productKey) return { status: "invalid_product" };
  const claims = (Array.isArray(message.claims) ? message.claims : []).filter((claim) =>
    claim && claim.verificationStatus === "unverified" && claim.gradeEligible === false && claim.exactText
  ).slice(0, 50).map((claim) => ({
    claimType: String(claim.claimType || "").slice(0, 80),
    label: String(claim.label || "").slice(0, 120),
    exactText: String(claim.exactText).slice(0, 500),
    normalizedClaim: String(claim.normalizedClaim || "").slice(0, 120),
    sourceUrl: String(claim.sourceUrl || sender && sender.url || "").slice(0, 2000),
    sourceField: String(claim.sourceField || "page_text").slice(0, 80),
    capturedAt: String(claim.capturedAt || new Date().toISOString()),
    verificationStatus: "unverified",
    gradeEligible: false,
    confidence: Math.min(0.55, Number(claim.confidence) || 0.55)
  }));
  if (!claims.length) return { status: "empty" };
  const archive = await localGet(PAGE_CLAIM_ARCHIVE_KEY) || {};
  const previous = archive[productKey] && Array.isArray(archive[productKey].claims) ? archive[productKey].claims : [];
  const merged = new Map();
  previous.concat(claims).forEach((claim) => merged.set(`${claim.claimType}|${claim.sourceField}|${claim.exactText.toLowerCase()}`, claim));
  archive[productKey] = {
    asin, gtin, title: String(product.title || "").slice(0, 500), brand: String(product.brand || "").slice(0, 200),
    url: String(product.url || sender && sender.url || "").slice(0, 2000), updatedAt: new Date().toISOString(),
    claims: Array.from(merged.values()).slice(-50)
  };
  const trimmed = Object.fromEntries(Object.entries(archive).sort((a, b) =>
    String(b[1].updatedAt || "").localeCompare(String(a[1].updatedAt || ""))
  ).slice(0, PAGE_CLAIM_ARCHIVE_LIMIT));
  await localSet(PAGE_CLAIM_ARCHIVE_KEY, trimmed);
  return { status: "saved", productKey, count: archive[productKey].claims.length };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(EthicalGrade.STORAGE_KEY, (result) => {
    if (!result[EthicalGrade.STORAGE_KEY]) {
      chrome.storage.sync.set({ [EthicalGrade.STORAGE_KEY]: EthicalGrade.createProfile("balanced") });
    }
  });

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ethical-grade-image",
      title: "Show Ethical Grade",
      contexts: ["image"]
    });
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

function sendContextImage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      // Reading runtime.lastError prevents Chrome from reporting the expected
      // "Receiving end does not exist" probe as an uncaught promise error.
      const error = chrome.runtime.lastError;
      resolve(!error && Boolean(response && response.ok));
    });
  });
}

async function showContextImage(info, tab) {
  if (info.menuItemId !== "ethical-grade-image" || !tab || !tab.id) return;
  // Start the narrowly scoped permission request while the context-menu click is
  // still an active user gesture. It grants access only to the selected image's
  // host, allowing us to scan the original pixels instead of a resized thumbnail.
  let originalImagePromise = Promise.resolve(null);
  try {
    const imageUrl = new URL(info.srcUrl || "");
    if (imageUrl.protocol === "https:" || imageUrl.protocol === "http:") {
      const origin = `${imageUrl.protocol}//${imageUrl.host}/*`;
      originalImagePromise = chrome.permissions.request({ origins: [origin] }).then(async (granted) => {
        if (!granted) return null;
        const response = await fetch(imageUrl.href, { credentials: "omit" });
        if (!response.ok) throw new Error(`Original image returned ${response.status}`);
        const type = response.headers.get("content-type") || "image/jpeg";
        if (!type.startsWith("image/")) throw new Error("Selected URL did not return an image");
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 12 * 1024 * 1024) throw new Error("Original image is larger than 12 MB");
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return `data:${type};base64,${btoa(binary)}`;
      }).catch(() => null);
    }
  } catch (_invalidImageUrl) {
    // blob/data URLs and malformed URLs use the visible screenshot fallback.
  }
  const message = {
    type: "ETHICAL_GRADE_CONTEXT_IMAGE",
    srcUrl: info.srcUrl || "",
    pageUrl: info.pageUrl || tab.url || ""
  };
  const ping = { type: "ETHICAL_GRADE_IMAGE_SCANNER_PING" };
  if (!await sendContextImage(tab.id, ping)) {
    // Non-Amazon pages do not run the extension continuously. Inject only after
    // this explicit user gesture, then deliver the selected image.
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["shared.js", "vendor/zxing/zxing-browser.min.js", "vendor/zbar/zbar-wasm.js", "content.js"] });
    if (!await sendContextImage(tab.id, ping)) throw new Error("Injected image scanner did not become ready");
  }

  const frameTarget = { tabId: tab.id, frameIds: [Number.isInteger(info.frameId) ? info.frameId : 0] };
  const rectResults = await chrome.scripting.executeScript({
    target: frameTarget,
    func: (selectedUrl) => {
      const absolute = (value) => { try { return new URL(value, location.href).href; } catch (_error) { return ""; } };
      const wanted = absolute(selectedUrl);
      const image = Array.from(document.images).find((candidate) =>
        absolute(candidate.currentSrc) === wanted || absolute(candidate.src) === wanted || absolute(candidate.getAttribute("src")) === wanted
      );
      if (!image) return null;
      const rect = image.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return null;
      const nearby = image.closest("a, article, [role='listitem'], [data-docid], [data-product-id], div");
      const contextText = [image.alt, image.title, image.getAttribute("aria-label"), image.closest("a") && image.closest("a").textContent, nearby && nearby.textContent]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 1200);
      return { left, top, width: right - left, height: bottom - top, viewportWidth: innerWidth, viewportHeight: innerHeight, contextText };
    },
    args: [message.srcUrl]
  });
  const crop = rectResults && rectResults[0] && rectResults[0].result;
  if (!crop) {
    await sendContextImage(tab.id, message);
    await sendContextImage(tab.id, { type: "ETHICAL_GRADE_IMAGE_BARCODE_RESULT", status: "image_not_visible" });
    return;
  }
  try {
    message.contextText = crop.contextText || "";
    const originalImage = await originalImagePromise;
    if (originalImage) {
      await sendContextImage(tab.id, message);
      if (!await sendContextImage(tab.id, { type: "ETHICAL_GRADE_SCAN_BARCODE_CAPTURE", imageDataUrl: originalImage, crop: null, source: "original" })) {
        throw new Error("Original image scan was not received");
      }
      return;
    }
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await sendContextImage(tab.id, message);
    if (!await sendContextImage(tab.id, { type: "ETHICAL_GRADE_SCAN_BARCODE_CAPTURE", imageDataUrl: screenshot, crop, source: "screenshot" })) {
      throw new Error("Barcode capture was not received");
    }
  } catch (_error) {
    await sendContextImage(tab.id, message);
    await sendContextImage(tab.id, { type: "ETHICAL_GRADE_IMAGE_BARCODE_RESULT", status: "capture_failed" });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  showContextImage(info, tab).catch((error) => console.warn("Ethical Grade could not open the selected image", error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return undefined;
  if (message.target === "background" && message.type === "ETHICAL_GRADE_OCR_BARCODE_RESULT") {
    const complete = pendingOcrRequests.get(message.requestId);
    if (complete) {
      pendingOcrRequests.delete(message.requestId);
      complete({ status: message.status, candidates: Array.isArray(message.candidates) ? message.candidates : [], candidateCounts: message.candidateCounts && typeof message.candidateCounts === "object" ? message.candidateCounts : {}, words: Array.isArray(message.words) ? message.words : [], text: message.text || "", engines: message.engines || null, error: message.error || "" });
    }
    return undefined;
  }
  if (message.type === "ETHICAL_GRADE_OCR_BARCODE") {
    recognizeBarcodeDigits(message.images || message.image).then(sendResponse).catch((error) => sendResponse({ status: "error", candidates: [], error: String(error && error.message || error) }));
    return true;
  }
  if (message.type === "ETHICAL_GRADE_OCR_PACKAGE") {
    recognizePackageText(message.images || message.image).then(sendResponse).catch((error) => sendResponse({ status: "error", candidates: [], error: String(error && error.message || error) }));
    return true;
  }
  if (message.type === "ETHICAL_GRADE_SEARCH_FOOD_BRAND") {
    searchFoodProductsByBrand(message.brand, message.productName, message.ocrText, message.contextText).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_SEARCH_BRANDFETCH") {
    searchBrandfetchCandidates(message.queries || message.query).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_SEARCH_FOOD_NUTRITION") {
    searchFoodProductsByNutrition(message.fingerprint, message.brandHints, message.productHints).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_SAVE_PAGE_CLAIMS") {
    savePageClaims(message, _sender).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_OEKO") {
    fetchOekoCertification(message.number).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_VEGAN_SOCIETY") {
    fetchVeganSocietyCertification(message.brand, message.title).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_NON_GMO") {
    fetchNonGmoCertification(message.brand, message.title, message.identifiers).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_GREEN_SEAL") {
    fetchGreenSealCertification(message.brand, message.title).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_EPEAT") {
    fetchEpeatCertification(message.brand, message.title).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_ENERGY_STAR") {
    fetchEnergyStarCertification(message.brand, message.title, message.identifiers).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_COSMOS") {
    fetchCosmosCertification(message.brand, message.title).then(sendResponse);
    return true;
  }
  if (message.type === "ETHICAL_GRADE_LOOKUP_EU_ECOLABEL") {
    fetchEuEcolabelCertification(message.identifiers).then(sendResponse);
    return true;
  }
  if (message.type !== "ETHICAL_GRADE_LOOKUP_FOOD") return undefined;
  const identifiers = Array.isArray(message.identifiers) ? message.identifiers : [];
  (async () => {
    for (const identifier of identifiers) {
      const result = await fetchFoodProduct(identifier);
      if (result.status === "matched") return result;
      if (result.status === "unavailable") return result;
    }
    return { status: "not_found", product: null };
  })().then(sendResponse);
  return true;
});
