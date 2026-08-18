(function contentScript() {
  "use strict";

  const { STORAGE_KEY, mergeProfile, gradeProduct, findCertificationMatches, resolveProductByIdentifiers, attachFoodProduct } = EthicalGrade;
  let profile = null;
  let certificationDatabase = null;
  let certificationDatabaseLoaded = false;
  let productDatabase = null;
  let productDatabaseLoaded = false;
  const liveLookupState = Object.create(null);
  const liveOekoCertifications = Object.create(null);
  const liveVeganSocietyCertifications = Object.create(null);
  const liveNonGmoCertifications = Object.create(null);
  const liveGreenSealCertifications = Object.create(null);
  const liveEpeatCertifications = Object.create(null);
  const liveEnergyStarCertifications = Object.create(null);
  const liveCosmosCertifications = Object.create(null);
  const liveEuEcolabelCertifications = Object.create(null);
  const persistedClaimKeys = new Set();
  let observer = null;
  let scanTimer = null;
  let activePopover = null;
  let activeBadge = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  let latestImageOcrText = "";
  let latestImageOcrWords = [];
  let latestImageContextText = "";
  let latestLocalIdentityMatched = false;
  let latestImageVisualDataUrl = "";
  let brandVisualComparisonId = 0;

  function loadProfile() {
    return new Promise((resolve) => chrome.storage.sync.get(STORAGE_KEY, (result) => resolve(mergeProfile(result[STORAGE_KEY]))));
  }
  function loadCertificationDatabase() {
    if (certificationDatabaseLoaded) return Promise.resolve(certificationDatabase);
    return fetch(chrome.runtime.getURL("data/certification-index.json"))
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        certificationDatabase = data && Array.isArray(data.records) ? data : null;
        certificationDatabaseLoaded = true;
        return certificationDatabase;
      })
      .catch(() => {
        certificationDatabase = null;
        certificationDatabaseLoaded = true;
        return null;
      });
  }
  function loadProductDatabase() {
    if (productDatabaseLoaded) return Promise.resolve(productDatabase);
    productDatabase = { products: [] };
    productDatabaseLoaded = true;
    return Promise.resolve(productDatabase);
  }
  function cleanText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function extractAsin(value) {
    const text = String(value || "");
    const pathMatch = text.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    if (pathMatch) return pathMatch[1].toUpperCase();
    const rawMatch = text.match(/\b([A-Z0-9]{10})\b/);
    return rawMatch ? rawMatch[1].toUpperCase() : "";
  }
  function validAsin(value) { return /^[A-Z0-9]{10}$/.test(String(value || "")); }
  function cleanPageType() {
    const path = location.pathname;
    if (/\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.href)) return "detail";
    if (path === "/s" || path.startsWith("/s/")) return "search";
    return "";
  }
  function shouldProcessPage() { return Boolean(cleanPageType()); }
  function decorativeText(value) {
    return /logo|sprite|icon|avatar|stars|rating|badge|leaf|climate pledge|sustainability|banner|hero|prime day|deal event|video|play button/i.test(String(value || ""));
  }
  function usefulImage(image) {
    if (!image || !image.isConnected || image.closest(".eg-popover")) return false;
    const style = window.getComputedStyle(image);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = image.getBoundingClientRect();
    if ((rect.left === 0 && rect.top === 0) || rect.width < 80 || rect.height < 80) return false;
    const width = image.naturalWidth || image.clientWidth || image.width;
    const height = image.naturalHeight || image.clientHeight || image.height;
    return width >= 80 && height >= 80 && !decorativeText(image.getAttribute("alt"));
  }
  function candidateTitle(container, image, link) {
    const titleNode = container && container.querySelector("h2, #productTitle, .a-size-base-plus, .a-size-medium, .eg-demo-title");
    return cleanText((image && image.getAttribute("alt")) || (link && link.getAttribute("aria-label")) || (titleNode && titleNode.textContent) || (link && link.textContent));
  }
  function productLikeCandidate(candidate) {
    return Boolean(candidate && validAsin(candidate.asin) && candidate.image && usefulImage(candidate.image) && candidate.title && candidate.title.length >= 6 && !decorativeText(candidate.title));
  }
  function detailCandidate() {
    const asin = extractAsin(location.href);
    if (!validAsin(asin)) return null;
    const container = document.querySelector("#ppd, #dp-container") || document.body;
    const title = cleanText((document.querySelector("#productTitle") || {}).textContent);
    const selectors = ["#imgTagWrapperId img#landingImage", "#landingImage", "#main-image-container #landingImage", "#imgTagWrapperId img[data-old-hires]", "#imgTagWrapperId img"];
    const image = selectors.map((selector) => document.querySelector(selector)).find(usefulImage);
    const candidate = { asin, container, image, title: title || (image && image.getAttribute("alt")) || "Amazon product" };
    return productLikeCandidate(candidate) ? candidate : null;
  }
  function searchResultsRoot() {
    const selectors = ["#search .s-main-slot.s-result-list", "#search .s-main-slot", "[data-component-type='s-search-results'] .s-main-slot", ".s-main-slot.s-result-list"];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  }
  function cardCandidateFromContainer(container) {
    const asin = extractAsin(container.getAttribute("data-asin"));
    if (!validAsin(asin)) return null;
    const exactLink = container.querySelector(`a[href*="/dp/${asin}"], a[href*="/gp/product/${asin}"]`);
    const anyLink = container.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");
    const link = exactLink || anyLink;
    const linkAsin = link ? extractAsin(link.href) : "";
    if (linkAsin && linkAsin !== asin) return null;
    const image = (link && link.querySelector("img")) || container.querySelector("img.s-image, img[data-a-dynamic-image], img[data-image-latency]");
    const candidate = { asin, container, image, title: candidateTitle(container, image, link) };
    return productLikeCandidate(candidate) ? candidate : null;
  }
  function cardCandidateFromLink(link) {
    const asin = extractAsin(link.href);
    if (!validAsin(asin)) return null;
    const image = link.querySelector("img");
    if (!image) return null;
    const container = link.closest("[data-asin], [data-component-type='s-search-result'], li, .a-section, div") || link;
    const candidate = { asin, container, image, title: candidateTitle(container, image, link) };
    return productLikeCandidate(candidate) ? candidate : null;
  }
  function candidates() {
    const found = [];
    const seen = new Set();
    const pageType = cleanPageType();
    if (!pageType) return found;
    const detail = pageType === "detail" ? detailCandidate() : null;
    if (detail) {
      seen.add(detail.asin);
      found.push(detail);
    }
    if (pageType !== "search") return found;
    const scope = searchResultsRoot();
    if (!scope) return found;
    scope.querySelectorAll("[data-asin]").forEach((container) => {
      const candidate = cardCandidateFromContainer(container);
      if (!candidate || seen.has(candidate.asin)) return;
      seen.add(candidate.asin);
      found.push(candidate);
    });
    scope.querySelectorAll("a[href*='/dp/'] img, a[href*='/gp/product/'] img").forEach((image) => {
      const link = image.closest("a[href*='/dp/'], a[href*='/gp/product/']");
      const candidate = link && cardCandidateFromLink(link);
      if (!candidate || seen.has(candidate.asin)) return;
      seen.add(candidate.asin);
      found.push(candidate);
    });
    return found;
  }
  function priceText(container) {
    if (!container) return "";
    const node = container.querySelector(".a-price .a-offscreen, [data-a-color='price'] .a-offscreen, .eg-demo-price");
    return node ? cleanText(node.textContent) : "";
  }
  function firstText(root, selectors) {
    if (!root) return "";
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const text = cleanText(node && node.textContent);
      if (text) return text;
    }
    return "";
  }
  function textList(root, selectors, limit) {
    if (!root) return [];
    const values = [];
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => {
        const text = cleanText(node.textContent);
        if (text && !values.includes(text)) values.push(text);
      });
    });
    return values.slice(0, limit || 8);
  }
  function parsePriceValue(value) {
    const match = String(value || "").replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
    return match ? Number(match[1]) : null;
  }
  function certificationList(value) {
    const text = String(value || "").toLowerCase();
    return [[/climate pledge friendly/, "Climate Pledge Friendly"], [/fair trade|fairtrade/, "Fair Trade (page claim)"], [/usda organic|organic certified|certified organic/, "Organic (page claim)"], [/cruelty-free|cruelty free/, "Cruelty-free (page claim)"], [/rainforest alliance/, "Rainforest Alliance (page claim)"]].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  }
  function productPageClaims(candidate, fields, sourceUrl) {
    if (!EthicalGrade || typeof EthicalGrade.extractPageClaims !== "function") return [];
    return EthicalGrade.extractPageClaims(fields, { sourceUrl, capturedAt: new Date().toISOString() });
  }
  function persistPageClaims(product) {
    const claims = Array.isArray(product.pageClaims) ? product.pageClaims : [];
    if (!claims.length || !product.asin) return;
    const signature = `${product.asin}:${claims.map((claim) => `${claim.claimType}:${claim.sourceField}:${claim.exactText}`).join("|")}`;
    if (persistedClaimKeys.has(signature)) return;
    persistedClaimKeys.add(signature);
    try {
      chrome.runtime.sendMessage({
        type: "ETHICAL_GRADE_SAVE_PAGE_CLAIMS",
        product: { asin: product.asin, gtin: product.gtin, title: product.title, brand: product.brand, url: product.url },
        claims
      }, () => { try { void chrome.runtime.lastError; } catch (_) { /* Extension context may have reloaded. */ } });
    } catch (_) { /* Extension context may have reloaded. */ }
  }
  function identifierValues(value) {
    return EthicalGrade.identifiersFromText(value);
  }
  function structuredIdentifiers() {
    const values = [];
    document.querySelectorAll("[itemprop='gtin'], [itemprop='gtin8'], [itemprop='gtin12'], [itemprop='gtin13'], [itemprop='gtin14'], meta[property='product:gtin']").forEach((node) => {
      values.push(node.getAttribute("content") || node.getAttribute("value") || node.textContent);
    });
    document.querySelectorAll("script[type='application/ld+json']").forEach((node) => {
      try {
        const visit = (value) => {
          if (Array.isArray(value)) return value.forEach(visit);
          if (!value || typeof value !== "object") return;
          Object.entries(value).forEach(([key, child]) => /^(?:gtin(?:8|12|13|14)?|upc|ean)$/i.test(key) ? values.push(child) : visit(child));
        };
        visit(JSON.parse(node.textContent));
      } catch (_) { /* Ignore malformed merchant JSON-LD. */ }
    });
    return values.map((value) => String(value || "").replace(/\D/g, "")).filter(Boolean);
  }
  function pageIdentifiers(scope, pageType) {
    if (pageType !== "detail") return [];
    const detailRoots = [
      document.body,
      scope && scope.nodeType !== Node.DOCUMENT_NODE ? scope : null,
      document.querySelector("#detailBullets_feature_div"),
      document.querySelector("#productDetails_feature_div"),
      document.querySelector("#productOverview_feature_div"),
      document.querySelector("#productFactsDesktopExpander"),
      document.querySelector("[data-feature-name='productDetails']")
    ].filter(Boolean);
    const visiblePageText = document.body && document.body.innerText;
    const documentText = document.documentElement && document.documentElement.textContent;
    return [...new Set(structuredIdentifiers()
      .concat(identifierValues(visiblePageText), identifierValues(documentText))
      .concat(detailRoots.flatMap((root) => identifierValues(root.textContent))))];
  }
  function amazonFoodFacts(pageType) {
    if (pageType !== "detail") return {};
    return EthicalGrade.extractAmazonFoodFacts(String(document.body && document.body.innerText || ""));
  }
  function attachAmazonFoodFacts(product, extracted) {
    const entries = Object.entries(extracted || {}).filter(([, value]) => hasFact(value));
    if (!entries.length) return product;
    const additions = { ...extracted, foodFactSource: "amazon_product_page", foodFactConfidence: 0.72 };
    Object.assign(product, additions);
    product.facts = { ...(product.facts || {}), ...additions };
    product.sourceEvidence = (product.sourceEvidence || []).concat(entries.map(([field, value]) => ({
      provider: "page_facts", field, label: field.replace(/([A-Z])/g, " $1").toLowerCase(), value,
      text: Array.isArray(value) ? value.join(", ") : value, source: "amazon_product_page", confidence: 0.72, searchable: true
    })));
    return product;
  }
  function requestLiveFoodProduct(identifiers) {
    const codes = [...new Set((identifiers || []).map((value) => EthicalGrade.normalizeBarcode(value)).filter((value) => EthicalGrade.validGtin(value)))];
    const lookupKey = codes.slice().sort().join(":");
    if (!lookupKey || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_FOOD", identifiers: codes }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.product) return;
        if (!productDatabase) productDatabase = { products: [] };
        if (!productDatabase.products.some((item) => EthicalGrade.equivalentGtin(item.barcode, response.product.barcode))) productDatabase.products.push(response.product);
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) {
      liveLookupState[lookupKey] = "";
    }
  }
  function requestLiveOekoCertification(number) {
    const lookupKey = `oeko:${number}`;
    if (!number || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_OEKO", number }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveOekoCertifications[number] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveVeganSocietyCertification(asin, brand, title) {
    const lookupKey = `vegan-society:${asin}:${brand}:${title}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_VEGAN_SOCIETY", brand, title }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveVeganSocietyCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveNonGmoCertification(asin, brand, title, identifiers) {
    const lookupKey = `non-gmo:${asin}:${brand}:${title}:${(identifiers || []).join(":")}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_NON_GMO", brand, title, identifiers }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveNonGmoCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveGreenSealCertification(asin, brand, title) {
    const lookupKey = `green-seal:${asin}:${brand}:${title}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_GREEN_SEAL", brand, title }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveGreenSealCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveEpeatCertification(asin, brand, title) {
    const lookupKey = `epeat:${asin}:${brand}:${title}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_EPEAT", brand, title }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveEpeatCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveEnergyStarCertification(asin, brand, title, identifiers) {
    const lookupKey = `energy-star:${asin}:${brand}:${title}:${(identifiers || []).join(":")}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_ENERGY_STAR", brand, title, identifiers }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveEnergyStarCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveCosmosCertification(asin, brand, title) {
    const lookupKey = `cosmos:${asin}:${brand}:${title}`;
    if (!asin || !brand || !title || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_COSMOS", brand, title }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveCosmosCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function requestLiveEuEcolabelCertification(asin, identifiers) {
    const lookupKey = `eu-ecolabel:${asin}:${(identifiers || []).join(":")}`;
    if (!asin || !(identifiers || []).length || liveLookupState[lookupKey]) return;
    liveLookupState[lookupKey] = "pending";
    try {
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_EU_ECOLABEL", identifiers }, (response) => {
        let runtimeError = null;
        try { runtimeError = chrome.runtime.lastError; } catch (_) { liveLookupState[lookupKey] = ""; return; }
        liveLookupState[lookupKey] = runtimeError ? "" : "complete";
        if (runtimeError || !response || response.status !== "matched" || !response.certification) return;
        liveEuEcolabelCertifications[asin] = response.certification;
        closeActivePopover();
        scheduleScan();
      });
    } catch (_) { liveLookupState[lookupKey] = ""; }
  }
  function productText(candidate, facts) {
    const container = candidate.container;
    return [candidate.title, facts.brand, facts.seller, facts.category, facts.priceText, ...(facts.productBullets || []), ...(facts.certifications || []), container && container.getAttribute("aria-label"), container && container.getAttribute("title"), facts.pageText].filter(Boolean).join(" ");
  }
  function productInfo(candidate) {
    const pageType = cleanPageType();
    const container = candidate.container;
    const scope = pageType === "detail" ? document : container;
    const link = pageType === "detail" ? null : container.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");
    const href = link ? link.href : location.href;
    const visiblePrice = priceText(container) || (scope !== container ? priceText(scope) : "");
    const brand = pageType === "detail" ? firstText(scope, ["#bylineInfo, .eg-demo-brand"]) : "";
    const seller = pageType === "detail" ? firstText(scope, ["#sellerProfileTriggerId", "#merchant-info", "#tabular-buybox-container [tabular-attribute-name='Sold by'] .tabular-buybox-text", ".tabular-buybox-text"]) : "";
    const category = pageType === "detail" ? textList(document, ["#wayfinding-breadcrumbs_feature_div li a", "#wayfinding-breadcrumbs_container li a"], 5).join(" > ") : "";
    const productBullets = pageType === "detail" ? textList(document, ["#feature-bullets li span.a-list-item", "#detailBullets_feature_div li", "#productOverview_feature_div tr", "#productFactsDesktopExpander li"], 8) : [];
    const productDescription = pageType === "detail" ? firstText(document, ["#productDescription", "#aplus_feature_div", "#bookDescription_feature_div"]).slice(0, 5000) : "";
    const pageText = cleanText(container && container.textContent).slice(0, pageType === "detail" ? 1600 : 900);
    const pageClaims = productPageClaims(candidate, { title: candidate.title, product_bullet: productBullets, product_description: productDescription, page_text: pageText }, href);
    const certifications = [...new Set(pageClaims.map((claim) => `${claim.label} (page claim)`))];
    const cardText = pageType === "search" ? pageText : "";
    const identifiers = pageIdentifiers(scope, pageType);
    const facts = { asin: candidate.asin, gtin: identifiers[0] || "", title: candidate.title, brand, price: parsePriceValue(visiblePrice), priceText: visiblePrice, seller, category, productBullets, productDescription, pageClaims, certifications, identifiers, cardText, imageUrl: candidate.image.currentSrc || candidate.image.src, url: href, pageType, pageText };
    const product = { key: candidate.asin, asin: candidate.asin, gtin: facts.gtin, href, url: href, src: facts.imageUrl, imageUrl: facts.imageUrl, title: candidate.title, brand, price: facts.price, priceText: visiblePrice, seller, category, productBullets, productDescription, pageClaims, certifications, cardText, facts, text: productText(candidate, facts) };
    attachAmazonFoodFacts(product, amazonFoodFacts(pageType));
    product.text = [product.text, product.ingredientsText, product.allergens, product.nutrition, product.foodLabels].flat().filter(Boolean).join(" ");
    const oekoNumbers = pageType === "detail" && typeof EthicalGrade.oekoLabelNumbersFromText === "function"
      ? EthicalGrade.oekoLabelNumbersFromText([
          document.body && document.body.innerText,
          document.documentElement && document.documentElement.textContent
        ].filter(Boolean).join(" ")) : [];
    oekoNumbers.filter((number) => !liveOekoCertifications[number]).forEach(requestLiveOekoCertification);
    if (pageType === "detail" && brand && !liveVeganSocietyCertifications[candidate.asin]) {
      requestLiveVeganSocietyCertification(candidate.asin, brand, candidate.title);
    }
    if (pageType === "detail" && brand && !liveNonGmoCertifications[candidate.asin]) {
      requestLiveNonGmoCertification(candidate.asin, brand, candidate.title, identifiers);
    }
    if (pageType === "detail" && brand && !liveGreenSealCertifications[candidate.asin]) {
      requestLiveGreenSealCertification(candidate.asin, brand, candidate.title);
    }
    if (pageType === "detail" && brand && !liveCosmosCertifications[candidate.asin]) {
      requestLiveCosmosCertification(candidate.asin, brand, candidate.title);
    }
    if (pageType === "detail" && identifiers.length && !liveEuEcolabelCertifications[candidate.asin]) {
      requestLiveEuEcolabelCertification(candidate.asin, identifiers);
    }
    if (pageType === "detail" && brand && /(laptop|notebook|computer|desktop|monitor|display|chromebook|macbook|workstation)/i.test(`${category} ${candidate.title}`) && !liveEpeatCertifications[candidate.asin]) {
      requestLiveEpeatCertification(candidate.asin, brand, candidate.title);
    }
    if (pageType === "detail" && brand && /(appliance|refrigerator|freezer|washer|dryer|dishwasher|dehumidifier|air cleaner|air purifier|television|\btv\b|monitor|display|computer|laptop|printer|thermostat|air conditioner|heat pump|water heater|ceiling fan|pool pump|charger)/i.test(`${category} ${candidate.title}`) && !liveEnergyStarCertifications[candidate.asin]) {
      requestLiveEnergyStarCertification(candidate.asin, brand, candidate.title, identifiers);
    }
    const verifiedCertifications = (typeof findCertificationMatches === "function" ? findCertificationMatches(product, certificationDatabase) : [])
      .concat(oekoNumbers.map((number) => liveOekoCertifications[number]).filter(Boolean))
      .concat(liveVeganSocietyCertifications[candidate.asin] ? [liveVeganSocietyCertifications[candidate.asin]] : [])
      .concat(liveNonGmoCertifications[candidate.asin] ? [liveNonGmoCertifications[candidate.asin]] : [])
      .concat(liveGreenSealCertifications[candidate.asin] ? [liveGreenSealCertifications[candidate.asin]] : [])
      .concat(liveEpeatCertifications[candidate.asin] ? [liveEpeatCertifications[candidate.asin]] : [])
      .concat(liveEnergyStarCertifications[candidate.asin] ? [liveEnergyStarCertifications[candidate.asin]] : []);
    if (liveCosmosCertifications[candidate.asin]) verifiedCertifications.push(liveCosmosCertifications[candidate.asin]);
    if (liveEuEcolabelCertifications[candidate.asin]) verifiedCertifications.push(liveEuEcolabelCertifications[candidate.asin]);
    facts.verifiedCertifications = verifiedCertifications;
    product.verifiedCertifications = verifiedCertifications;
    if (pageType === "detail") persistPageClaims(product);
    const resolution = typeof resolveProductByIdentifiers === "function" ? resolveProductByIdentifiers(identifiers, productDatabase) : null;
    product.identityResolution = resolution;
    if (pageType === "detail" && resolution && resolution.status === "not_found") requestLiveFoodProduct(identifiers);
    return typeof attachFoodProduct === "function" ? attachFoodProduct(product, resolution) : product;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
  }
  function list(items) { return items.map((item) => `<li>${escapeHtml(item)}</li>`).join(""); }
  function impactText(value) { return typeof value === "number" && value !== 0 ? `impact ${value > 0 ? "+" : ""}${value}` : ""; }
  function evidenceList(items, fallbackItems) {
    const evidence = items && items.length ? items : [];
    if (!evidence.length) return list(fallbackItems || []);
    return evidence.map((item) => {
      if (typeof item === "string") return `<li>${escapeHtml(item)}</li>`;
      const details = [item.source, item.match ? `match: ${item.match}` : "", impactText(item.impact)].filter(Boolean).join(" | ");
      return `<li class="eg-evidence-item"><strong>${escapeHtml(item.display || item.label || "Product signal")}</strong>${details ? `<small>${escapeHtml(details)}</small>` : ""}</li>`;
    }).join("");
  }
  function shortFact(value) {
    const displayValue = (item) => {
      if (!item || typeof item !== "object") return item;
      const packaging = [item.shape && item.shape.lc_name, item.material && item.material.lc_name, item.recycling && item.recycling.lc_name].filter(Boolean).join(" / ");
      return [item.name || item.label || item.certification || item.type || packaging, item.issuer, item.status].filter(Boolean).join(" - ");
    };
    const text = cleanText(Array.isArray(value) ? value.filter(Boolean).map(displayValue).join(", ") : displayValue(value));
    if (!text) return "Missing";
    return text.length > 110 ? `${text.slice(0, 107)}...` : text;
  }
  function hasFact(value) {
    return Array.isArray(value) ? value.some((item) => cleanText(item)) : Boolean(cleanText(value));
  }
  function pageLabel(pageType) {
    if (pageType === "detail") return "Product page";
    if (pageType === "search") return "Search card";
    return pageType || "Unknown";
  }
  function sourceLabel(value) {
    const labels = {
      amazon_product_page: "Amazon product page",
      amazon_search_card: "Amazon search card",
      local_certification_database: "Local certification database",
      open_food_facts: "Open Food Facts",
      verified_certification_provider: "Verified certification provider",
      page_facts: "Page facts",
      sample_product: "Sample product",
      unknown: "Unknown source"
    };
    return labels[value] || cleanText(value).replace(/_/g, " ");
  }
  function confidencePercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "";
  }
  function sourceRows(result) {
    const records = Array.isArray(result.sourceEvidence) ? result.sourceEvidence : [];
    const searchable = records.filter((record) => record && record.searchable && hasFact(record.text || record.value));
    const identity = records.filter((record) => record && !record.searchable && ["asin", "url"].includes(record.field) && hasFact(record.text || record.value));
    const ordered = searchable.filter((record) => record.field === "verifiedCertifications").concat(searchable.filter((record) => record.field !== "verifiedCertifications"));
    const rows = (ordered.length ? ordered : identity).slice(0, 6);
    if (!rows.length) return `<div class="eg-source-empty">Missing</div>`;
    return rows.map((record) => {
      const meta = [sourceLabel(record.source), confidencePercent(record.confidence)].filter(Boolean).join(" | ");
      return `<div class="eg-source-row"><div><strong>${escapeHtml(record.label || record.field || "Source")}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div><span>${escapeHtml(shortFact(record.text || record.value))}</span></div>`;
    }).join("");
  }
  function factRows(product) {
    const facts = product.facts || {};
    const isSearchCard = facts.pageType === "search";
    const rows = isSearchCard
      ? [["ASIN", facts.asin || product.asin], ["Page", pageLabel(facts.pageType)], ["Title", facts.title || product.title], ["Price", facts.priceText || product.priceText], ["Signals", facts.certifications || product.certifications], ["Verified", facts.verifiedCertifications || product.verifiedCertifications], ["Card text", facts.cardText || facts.pageText]]
      : [["ASIN", facts.asin || product.asin], ["GTIN", facts.gtin || product.gtin], ["Identity", facts.identityMatch || product.identityMatch], ["Page", pageLabel(facts.pageType)], ["Title", facts.title || product.title], ["Brand", facts.brand || product.brand], ["Seller", facts.seller || product.seller], ["Price", facts.priceText || product.priceText], ["Ingredients", facts.ingredientsText || product.ingredientsText], ["Allergens", facts.allergens || product.allergens], ["Nutrition", facts.nutrition || product.nutrition], ["Food labels", facts.foodLabels || product.foodLabels], ["Packaging", facts.packaging || product.packaging], ["Category", facts.category || product.category], ["Page claims", facts.certifications || product.certifications], ["Verified certifications", facts.verifiedCertifications || product.verifiedCertifications], ["Bullets", facts.productBullets || product.productBullets]];
    const visibleRows = isSearchCard ? rows.filter(([label, value]) => ["ASIN", "Page", "Title", "Price", "Card text"].includes(label) || hasFact(value)) : rows;
    return visibleRows.map(([label, value]) => `<div class="eg-fact-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(shortFact(value))}</span></div>`).join("");
  }
  function makePopover(product, result) {
    const scoreText = result.score === null ? "No score" : `${result.score}/100`;
    const statusText = result.status === "insufficient_data" ? `Insufficient data · ${result.coverage}% coverage` : result.provisional ? `Provisional · ${result.coverage}% coverage` : `Supported · ${result.coverage}% coverage`;
    const evidence = result.evidence || {};
    const positives = (evidence.positive || []).slice(0, 3);
    const watch = (evidence.watch || []).slice(0, 3);
    const missing = (evidence.missing || []).slice(0, 2);
    const pop = document.createElement("div");
    pop.className = "eg-popover";
    pop.hidden = true;
    pop.innerHTML = `<div class="eg-popover-title"><strong>${escapeHtml(product.title)}</strong><span class="eg-confidence">${escapeHtml(result.confidence)} confidence</span></div><div class="eg-section"><span>Grade</span><ul><li class="eg-grade-row"><strong>${escapeHtml(result.grade)}</strong><em>${escapeHtml(scoreText)}</em></li><li class="eg-coverage-row">${escapeHtml(statusText)}</li></ul></div><div class="eg-section"><span>Positive</span><ul>${evidenceList(positives, (result.positives || []).slice(0, 3))}</ul></div><div class="eg-section"><span>Watch</span><ul>${evidenceList(watch, (result.negatives || []).slice(0, 3))}</ul></div>${missing.length ? `<div class="eg-section"><span>Missing</span><ul>${evidenceList(missing, [])}</ul></div>` : ""}<details class="eg-sources"><summary>Sources</summary><div class="eg-source-list">${sourceRows(result)}</div></details><details class="eg-facts"><summary>Facts</summary><div class="eg-fact-grid">${factRows(product)}</div></details>`;
    return pop;
  }
  function positionBadge(badge, image) {
    const rect = image.getBoundingClientRect();
    badge.style.left = `${Math.max(0, rect.right + window.scrollX - badge.offsetWidth - 8)}px`;
    badge.style.top = `${Math.max(0, rect.top + window.scrollY + 8)}px`;
  }
  function positionPopover(popover, badge) {
    const rect = badge.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(330, window.innerWidth - margin * 2);
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${Math.max(140, window.innerHeight - margin * 2)}px`;
    popover.hidden = false;
    popover.style.visibility = "hidden";
    let height = popover.offsetHeight;
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const below = rect.bottom + 8;
    const shouldPlaceAbove = below + height > window.innerHeight - margin && rect.top > window.innerHeight - rect.bottom;
    let top = shouldPlaceAbove ? rect.top - height - 8 : below;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    popover.style.maxHeight = `${Math.max(140, window.innerHeight - top - margin)}px`;
    height = popover.offsetHeight;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "visible";
  }
  function clearBadges() {
    document.querySelectorAll(".eg-grade-badge").forEach((node) => node.remove());
    document.querySelectorAll(".eg-popover").forEach((node) => { if (node !== activePopover) node.remove(); });
  }
  function closeActivePopover() {
    window.clearTimeout(hoverOpenTimer);
    window.clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
    if (activePopover) { activePopover.remove(); activePopover = null; activeBadge = null; }
  }
  function cancelHoverClose() {
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  }
  function scheduleHoverClose() {
    cancelHoverClose();
    hoverCloseTimer = window.setTimeout(closeActivePopover, 250);
  }
  function openProductPopover(badge, product, result) {
    window.clearTimeout(hoverOpenTimer);
    hoverOpenTimer = null;
    cancelHoverClose();
    if (activePopover && activeBadge === badge) return;
    closeActivePopover();
    activeBadge = badge;
    activePopover = makePopover(product, result);
    activePopover.addEventListener("mouseenter", cancelHoverClose);
    activePopover.addEventListener("mouseleave", scheduleHoverClose);
    document.body.append(activePopover);
    positionPopover(activePopover, badge);
  }
  function isInsideActivePopover(target) {
    return Boolean(activePopover && target && target.nodeType && (target === activePopover || activePopover.contains(target)));
  }
  function attach(candidate) {
    const product = productInfo(candidate);
    const result = gradeProduct(product, profile);
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = `eg-grade-badge eg-tone-${result.tone}`;
    badge.textContent = result.grade;
    badge.title = `${result.grade} ethical fit, ${result.coverage}% evidence coverage, ${result.confidence.toLowerCase()} confidence`;
    badge.setAttribute("aria-label", `${result.grade} ethical fit for ${product.title}`);
    badge._egImage = candidate.image;
    badge.addEventListener("mouseenter", () => {
      cancelHoverClose();
      window.clearTimeout(hoverOpenTimer);
      hoverOpenTimer = window.setTimeout(() => openProductPopover(badge, product, result), 700);
    });
    badge.addEventListener("mouseleave", () => {
      window.clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
      if (activeBadge === badge) scheduleHoverClose();
    });
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (activePopover && activeBadge === badge) { closeActivePopover(); return; }
      openProductPopover(badge, product, result);
    });
    document.body.append(badge);
    positionBadge(badge, candidate.image);
  }
  function repositionBadges() {
    document.querySelectorAll(".eg-grade-badge").forEach((badge) => {
      if (badge._egImage && document.body.contains(badge._egImage)) positionBadge(badge, badge._egImage);
    });
  }
  function scan() {
    if (!profile) return;
    if (!shouldProcessPage()) { closeActivePopover(); clearBadges(); if (observer) observer.disconnect(); return; }
    if (activePopover && document.body.contains(activePopover)) return;
    if (observer) observer.disconnect();
    clearBadges();
    candidates().forEach(attach);
    startObserver();
  }
  function scheduleScan() { window.clearTimeout(scanTimer); scanTimer = window.setTimeout(scan, 300); }
  function isExtensionNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && (node.classList.contains("eg-grade-badge") || node.classList.contains("eg-popover") || node.classList.contains("eg-floating-result"));
  }
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      const onlyOurs = mutations.every((mutation) => {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return nodes.length && nodes.every(isExtensionNode);
      });
      if (!onlyOurs) scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  function floatingImageResult(srcUrl, pageUrl) {
    const old = document.querySelector(".eg-floating-result");
    if (old) old.remove();
    latestLocalIdentityMatched = false;
    const panel = document.createElement("div");
    panel.className = "eg-floating-result";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Ethical Grade image scan");
    panel.innerHTML = `<button type="button" class="eg-floating-close" aria-label="Close">×</button><div class="eg-image-scan-head"><img class="eg-image-scan-preview" src="${escapeHtml(srcUrl)}" alt="Selected product"><div><strong>Scanning selected image</strong><span>Image captured from this page</span></div></div><div class="eg-image-scan-status" data-state="working"><i aria-hidden="true"></i><div><strong>Reading brand and product…</strong><span>Local OCR runs first; barcode and packaging checks are optional supporting evidence.</span></div></div>`;
    panel.querySelector(".eg-floating-close").addEventListener("click", () => panel.remove());
    document.body.append(panel);
  }

  function runImageIdentityLookup(identity, ocrText) {
    if (!identity || !identity.brand || !identity.productName) return;
    const brandHints = nutritionIdentityHints(identity, ocrText).brands;
    chrome.runtime.sendMessage({
      type: "ETHICAL_GRADE_SEARCH_FOOD_BRAND",
      brand: identity.brand,
      productName: identity.productName,
      ocrText: ocrText || "",
      contextText: latestImageContextText
    }, (lookup) => {
      if (chrome.runtime.lastError || !lookup) return;
      showImageIdentityCandidates(lookup, identity.brand);
      const resolvedBrands = (lookup.candidates || []).map((candidate) => cleanText(candidate.brand)).filter(Boolean);
      const enrichedHints = [...new Set([...brandHints, ...resolvedBrands])].slice(0, 4);
      if (enrichedHints.some((brand) => !brandHints.includes(brand))) {
        chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_SEARCH_BRANDFETCH", queries: enrichedHints }, (brandLookup) => {
          if (!chrome.runtime.lastError && brandLookup) showBrandfetchCandidates(brandLookup, enrichedHints);
        });
      }
    });
    chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_SEARCH_BRANDFETCH", queries: brandHints }, (lookup) => {
      if (!chrome.runtime.lastError && lookup) showBrandfetchCandidates(lookup, brandHints);
    });
  }

  function showBrandfetchCandidates(response, searchedBrands) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-brand-logo-candidates");
    if (previous) previous.remove();
    const candidates = response && Array.isArray(response.candidates) ? response.candidates : [];
    const searchedLabel = (Array.isArray(searchedBrands) ? searchedBrands : [searchedBrands]).filter(Boolean).join(", ");
    const section = document.createElement("div");
    section.className = "eg-image-certifications eg-image-brand-logo-candidates";
    if (!candidates.length) {
      section.innerHTML = response && response.status === "unavailable"
        ? `<strong>Brand-logo directory</strong><span>Brandfetch was temporarily unavailable.</span>`
        : `<strong>Brand-logo directory</strong><span>No logo candidates were found for “${escapeHtml(searchedLabel)}.”</span>`;
    } else {
      section.innerHTML = `<strong>Possible brand logos</strong><span>Brandfetch candidates from package hints: ${escapeHtml(searchedLabel)}.</span><ul>${candidates.slice(0, 3).map((candidate) => `<li class="eg-brand-logo-candidate"><img src="${escapeHtml(candidate.logoUrl)}" alt=""><span><b>${escapeHtml(candidate.name)}</b><small>${escapeHtml(candidate.domain)} · ${Math.round(Number(candidate.confidence || 0) * 100)}% search agreement${candidate.matchedQuery ? ` · via “${escapeHtml(candidate.matchedQuery)}”` : ""}</small></span></li>`).join("")}</ul><small>Source: Brandfetch. Local visual comparison runs below; neither a candidate nor a visual similarity is proof by itself.</small>`;
    }
    panel.append(section);
    if (candidates.length && latestImageVisualDataUrl) compareBrandLogoCandidates(candidates, section);
  }

  function imageFromRemoteUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Logo image could not be loaded"));
      image.src = url;
    });
  }

  function visualSignature(source, crop) {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const sx = crop ? Math.round(source.naturalWidth * crop[0]) : 0;
    const sy = crop ? Math.round(source.naturalHeight * crop[1]) : 0;
    const sw = crop ? Math.max(1, Math.round(source.naturalWidth * crop[2])) : source.naturalWidth;
    const sh = crop ? Math.max(1, Math.round(source.naturalHeight * crop[3])) : source.naturalHeight;
    context.fillStyle = "white";
    context.fillRect(0, 0, size, size);
    context.drawImage(source, sx, sy, sw, sh, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const gray = new Float32Array(size * size);
    let mean = 0;
    for (let index = 0; index < gray.length; index += 1) {
      const offset = index * 4;
      gray[index] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
      mean += gray[index];
    }
    mean /= gray.length;
    let variance = 0;
    gray.forEach((value) => { variance += (value - mean) ** 2; });
    const deviation = Math.sqrt(variance / gray.length) || 1;
    const signature = [];
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const index = y * size + x;
        const normalized = (gray[index] - mean) / deviation;
        const horizontal = (gray[index + 1] - gray[index - 1]) / 255;
        const vertical = (gray[index + size] - gray[index - size]) / 255;
        signature.push(normalized, horizontal, vertical);
      }
    }
    return signature;
  }

  function signatureSimilarity(left, right) {
    if (!left || !right || left.length !== right.length) return 0;
    let dot = 0;
    let leftLength = 0;
    let rightLength = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftLength += left[index] ** 2;
      rightLength += right[index] ** 2;
    }
    const cosine = dot / (Math.sqrt(leftLength * rightLength) || 1);
    return Math.max(0, Math.min(1, (cosine + 1) / 2));
  }

  function likelyLogoCrops() {
    const crops = [[0, 0, 1, 1]];
    // Brand marks are commonly in the upper two-thirds of front packaging.
    // Overlapping windows avoid assuming a particular retailer or package.
    [0.28, 0.38, 0.5].forEach((height) => {
      const width = Math.min(0.72, height * 1.45);
      const xStep = Math.max(0.12, width * 0.42);
      const yStep = Math.max(0.1, height * 0.38);
      for (let y = 0; y + height <= 0.76; y += yStep) {
        for (let x = 0; x + width <= 1.001; x += xStep) crops.push([x, y, width, height]);
      }
    });
    return crops.slice(0, 45);
  }

  async function compareBrandLogoCandidates(candidates, section) {
    const comparisonId = ++brandVisualComparisonId;
    const status = document.createElement("small");
    status.className = "eg-brand-visual-status";
    status.textContent = "Comparing candidate logos locally…";
    section.append(status);
    try {
      const packageImage = await imageFromDataUrl(latestImageVisualDataUrl);
      const packageSignatures = likelyLogoCrops().map((crop) => visualSignature(packageImage, crop));
      const results = [];
      for (const candidate of candidates.slice(0, 3)) {
        try {
          const logo = await imageFromRemoteUrl(candidate.logoUrl);
          const logoSignature = visualSignature(logo, null);
          const similarity = Math.max(...packageSignatures.map((signature) => signatureSimilarity(signature, logoSignature)));
          results.push({ ...candidate, visualSimilarity: similarity });
        } catch (_error) {
          // One inaccessible logo must not prevent comparison of the others.
        }
      }
      if (comparisonId !== brandVisualComparisonId || !section.isConnected) return;
      results.sort((a, b) => b.visualSimilarity - a.visualSimilarity);
      const best = results[0];
      const runnerUp = results[1];
      const distinct = best && (!runnerUp || best.visualSimilarity - runnerUp.visualSimilarity >= 0.06);
      // Edge-signature matching is supporting evidence only. A deliberately
      // high gate prevents ordinary package text blocks from becoming matches.
      if (best && best.visualSimilarity >= 0.76 && distinct) {
        status.innerHTML = `<b>Possible visual brand match: ${escapeHtml(best.name)}</b><br>${Math.round(best.visualSimilarity * 100)}% local visual similarity. Experimental supporting evidence only.`;
      } else if (results.length) {
        status.textContent = "No candidate logo was visually distinctive enough to call a match.";
      } else {
        status.textContent = "Candidate logos could not be read for local comparison.";
      }
    } catch (_error) {
      if (comparisonId === brandVisualComparisonId && section.isConnected) status.textContent = "Local visual comparison was unavailable for this image.";
    }
  }

  function nutritionValue(text, pattern, unit) {
    const match = String(text || "").match(pattern);
    if (!match) return null;
    const value = Number(String(match[1] || "").replace(/,/g, "."));
    if (!Number.isFinite(value) || value < 0) return null;
    if (unit === "mg" && !/mg/i.test(match[0])) return null;
    if (unit === "g" && !/\d\s*g\b/i.test(match[0])) return null;
    return value;
  }

  function nutritionFingerprintFromText(ocrText) {
    const text = cleanText(ocrText).replace(/[|]/g, " ");
    const serving = text.match(/serving\s+size.{0,35}?(?:\((\d+(?:\.\d+)?)\s*g\)|(\d+(?:\.\d+)?)\s*g)/i);
    const packageWeight = text.match(/net\s*(?:wt\.?|weight)?.{0,12}?(\d+(?:\.\d+)?)\s*(oz|g)\b/i);
    const fingerprint = {
      servingGrams: serving ? Number(serving[1] || serving[2]) : null,
      calories: nutritionValue(text, /\bcalories?\s{0,6}(\d{1,4})\b/i),
      fatG: nutritionValue(text, /\btotal\s+fat\s{0,8}(\d+(?:\.\d+)?)\s*g\b/i, "g"),
      saturatedFatG: nutritionValue(text, /\bsat(?:urated)?\.?\s*fat\s{0,8}(\d+(?:\.\d+)?)\s*g\b/i, "g"),
      sodiumMg: nutritionValue(text, /\bsodium\s{0,8}(\d+(?:\.\d+)?)\s*mg\b/i, "mg"),
      carbohydratesG: nutritionValue(text, /\btotal\s+carbohydrates?\s{0,8}(\d+(?:\.\d+)?)\s*g\b/i, "g"),
      sugarsG: nutritionValue(text, /\btotal\s+sugars?\s{0,8}(\d+(?:\.\d+)?)\s*g\b/i, "g"),
      proteinG: nutritionValue(text, /\bprotein\s{0,8}(\d+(?:\.\d+)?)\s*g\b/i, "g"),
      packageWeight: packageWeight ? `${packageWeight[1]} ${packageWeight[2].toLowerCase()}` : ""
    };
    const count = ["calories", "fatG", "saturatedFatG", "sodiumMg", "carbohydratesG", "sugarsG", "proteinG"]
      .filter((field) => fingerprint[field] !== null).length;
    return count >= 2 ? { ...fingerprint, count } : null;
  }

  function nutritionIdentityHints(identity, ocrText) {
    const strongBrands = [];
    const compoundBrands = [];
    const prominentBrands = [];
    const distinctiveBrands = [];
    const repeatedBrands = [];
    const brands = [];
    const products = [];
    const text = String(ocrText || "");
    // A printed brand domain or trademark is normally cleaner evidence than
    // the tentative identity parser, especially for stylized package logos.
    for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9'’-]{2,30})(?:foods?)?\s*\.\s*com\b/gi)) strongBrands.push(match[1]);
    for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9'’-]{2,30})[®™]/g)) strongBrands.push(match[1]);
    // Packaging often repeats the brand on the front, back, URL, and legal
    // copy. Repetition supplies fallback candidates when a stylized logo loses
    // its ®/™ symbol during OCR. Generic nutrition and product words are barred.
    const brandNoise = new Set("nutrition facts serving servings size amount calories calorie total fat saturated trans cholesterol sodium carbohydrate carbohydrates dietary fiber sugars protein vitamin ingredients ingredient contains manufactured distributed product products foods food organic vegan dairy free plant based original ground crumbles ultimate smart keep frozen refrigerated cook cooking directions information content contents package packaging weight ounce ounces grams gram net with from your their this that have made per daily value".split(" "));
    const wordCounts = new Map();
    (text.match(/[A-Za-z][A-Za-z'’-]{2,30}/g) || []).forEach((word) => {
      const normalized = word.toLowerCase().replace(/[’]/g, "'");
      if (brandNoise.has(normalized)) return;
      const entry = wordCounts.get(normalized) || { word, count: 0 };
      entry.count += 1;
      if (word.length > entry.word.length) entry.word = word;
      wordCounts.set(normalized, entry);
    });
    [...wordCounts.values()].filter((entry) => entry.count >= 2)
      .sort((a, b) => b.count - a.count || b.word.length - a.word.length)
      .slice(0, 3).forEach((entry) => repeatedBrands.push(entry.word));
    // A large front-panel word may appear only once. Keep several distinctive
    // all-caps tokens as directory-search candidates; the directory and visual
    // stages decide whether they are real brands. Nutrition vocabulary and
    // obviously corrupted compounds remain excluded.
    const displayNoise = /SATURAT|CHOLESTER|REFRIGERAT|^POSSIBLE$|SERV|PROTEIN|ANTIBIOT|GROUND|PLANT|ANIMAL|CONTAIN|PRODUCT|NETWT/i;
    compoundOcrBrandHints(latestImageOcrWords).forEach((phrase) => compoundBrands.push(phrase));
    (Array.isArray(latestImageOcrWords) ? latestImageOcrWords : [])
      .filter((word) => word && Number(word.confidence || 0) >= 45 && Number(word.height || 0) >= 12)
      .sort((a, b) => (Number(b.height || 0) * Number(b.confidence || 0)) - (Number(a.height || 0) * Number(a.confidence || 0)))
      .map((word) => cleanText(word.text))
      .filter((word) => /^[A-Za-z][A-Za-z'’-]{5,24}$/.test(word) && !displayNoise.test(word))
      .slice(0, 5).forEach((word) => prominentBrands.push(word));
    [...new Set(text.match(/\b[A-Z][A-Z'’-]{5,24}\b/g) || [])]
      .filter((word) => !displayNoise.test(word) && !brandNoise.has(word.toLowerCase()))
      .slice(0, 5).forEach((word) => distinctiveBrands.push(word));
    if (identity && identity.brand) brands.push(identity.brand);
    if (identity && identity.productName) products.push(identity.productName);
    // Capture short phrases attached to ®/™. The symbol is supporting layout
    // evidence; the phrase is only a search hint, never certification proof.
    for (const match of text.matchAll(/\b((?:[A-Za-z][A-Za-z0-9'’-]*\s+){0,2}[A-Za-z][A-Za-z0-9'’-]*)[®™]\s*([A-Za-z][A-Za-z0-9'’-]{2,30})?/g)) {
      const phrase = cleanText(match[1]).replace(/^(?:our|the|a|an|enjoy|live|original)\s+/i, "");
      const following = cleanText(match[2]);
      if (phrase) products.push(phrase, following ? `${phrase} ${following}` : "");
    }
    // OCR can interleave a nearby Nutrition Facts column with package prose
    // (for example, inserting "Trans Fat 0g" inside a product name). Remove
    // those generic label fragments, then recover short title-like phrases.
    const deinterleaved = text.replace(/\b(?:total\s+)?(?:trans|saturated|sat\.?|mono(?:unsaturated)?|poly(?:unsaturated)?)\s*fat\s*\d+(?:\.\d+)?\s*g\b/gi, " ")
      .replace(/\b(?:cholesterol|sodium|protein|dietary\s+fiber|total\s+sugars?|total\s+carbohydrates?)\s*\d+(?:\.\d+)?\s*(?:mg|g|%)?\b/gi, " ")
      .replace(/\s+/g, " ");
    for (const match of deinterleaved.matchAll(/\b((?:[A-Z][A-Za-z'’-]{2,}\s+){1,3}(?:Original|Classic|Traditional|Unsweetened|Vanilla|Chocolate))\b/g)) products.push(match[1]);
    const cleanHints = (values, maximum) => [...new Set(values.map((hint) => cleanText(hint)).filter((hint) => /^[A-Za-z][A-Za-z0-9'’ -]{2,79}$/.test(hint)))].slice(0, maximum);
    const genericBrandHint = /^(?:plant[- ]?based|dairy[- ]?free|gluten[- ]?free|organic|vegan|beef|chicken|pork|avocado|protein|ground|crumbles|cheese|pizza|original)$/i;
    const cleanedBrands = cleanHints([...strongBrands, ...compoundBrands, ...prominentBrands, ...distinctiveBrands, ...repeatedBrands, ...brands], 18)
      .filter((hint) => !genericBrandHint.test(hint) && !identityClaimOnly.test(hint));
    return { brands: cleanedBrands.slice(0, 8), products: cleanHints(products, 8) };
  }

  function showNutritionFingerprint(fingerprint, identity, ocrText) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-nutrition");
    if (previous) previous.remove();
    if (!fingerprint) return;
    const labels = [
      ["Serving", fingerprint.servingGrams, "g"], ["Calories", fingerprint.calories, ""], ["Fat", fingerprint.fatG, "g"],
      ["Saturated fat", fingerprint.saturatedFatG, "g"], ["Sodium", fingerprint.sodiumMg, "mg"],
      ["Carbohydrates", fingerprint.carbohydratesG, "g"], ["Sugars", fingerprint.sugarsG, "g"], ["Protein", fingerprint.proteinG, "g"]
    ].filter(([, value]) => value !== null && value !== undefined);
    const section = document.createElement("div");
    section.className = "eg-image-certifications eg-image-nutrition";
    section.innerHTML = `<strong>Nutrition fingerprint</strong><span>${labels.map(([label, value, unit]) => `${escapeHtml(label)}: ${escapeHtml(value)}${unit}`).join(" · ")}${fingerprint.packageWeight ? ` · Package: ${escapeHtml(fingerprint.packageWeight)}` : ""}</span><small>Extracted locally from package OCR. Nutrition alone cannot verify product identity.</small>`;
    panel.append(section);

    if (fingerprint.count < 3) return;
    const hints = nutritionIdentityHints(identity, ocrText);
    if (!hints.brands.length) return;
    chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_SEARCH_FOOD_NUTRITION", fingerprint, brandHints: hints.brands, productHints: hints.products }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      const candidates = Array.isArray(response.candidates) ? response.candidates : [];
      const old = panel.querySelector(".eg-image-nutrition-candidates");
      if (old) old.remove();
      const results = document.createElement("div");
      results.className = "eg-image-certifications eg-image-nutrition-candidates";
      results.innerHTML = response.status === "probable" && response.best
        ? `<strong>Probable GTIN</strong><b>${escapeHtml(response.best.gtin)}</b><span>${escapeHtml(response.best.brand)} — ${escapeHtml(response.best.name)}</span><small>${Math.round(Number(response.best.confidence || 0) * 100)}% combined agreement · ${escapeHtml(response.best.source || "Open Food Facts")}. Inferred from product text and nutrition; not barcode-verified.</small>`
        : candidates.length
        ? `<strong>Possible nutrition matches</strong><span>These are suggestions, not confirmed identities.</span><ul>${candidates.slice(0, 3).map((candidate) => `<li><b>${escapeHtml(candidate.brand)} — ${escapeHtml(candidate.name)}</b><small>${Math.round(Number(candidate.confidence || 0) * 100)}% combined agreement across ${escapeHtml(candidate.compared)} nutrition fields · ${escapeHtml(candidate.source || "Open Food Facts")}</small></li>`).join("")}</ul>`
        : `<strong>Nutrition database cross-check</strong><span>No sufficiently close Open Food Facts or USDA FoodData Central candidates were found.</span>`;
      panel.append(results);
    });
  }

  function showLocalImageIdentity(identity, ocrText) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-identity");
    if (previous) previous.remove();
    const section = document.createElement("div");
    section.className = "eg-image-certifications eg-image-identity";
    const product = identity ? [identity.productName, identity.variant].filter(Boolean).join(" — ") : "";
    const confidence = Math.round(Number(identity && identity.confidence || 0) * 100);
    const title = identity ? ([identity.brand, product].filter(Boolean).join(" — ") || "Product not identified") : "Product not identified";
    const confirmed = identity && identity.status === "confirmed";
    const identified = identity && identity.status === "identified";
    section.dataset.state = identity && identity.status || "unknown";
    section.innerHTML = identity
      ? `<strong>${escapeHtml(confirmed ? "Product confirmed for this scan" : identified ? "Product identified locally" : "Possible local identity")}</strong><b>${escapeHtml(title)}</b>${confirmed ? `<span>Entered by you · not saved</span>` : `<span>${confidence}% confidence · OCR and webpage context</span>`}${identity.visibleEvidence && identity.visibleEvidence.length ? `<small>Evidence: ${escapeHtml(identity.visibleEvidence.join(" · "))}</small>` : ""}<small>${confirmed ? "The correction is used only for this scan. Certifications still require a matching official record." : "No paid API was used. This identity is probabilistic and is not itself certification verification."}</small>`
      : `<strong>Local product identity</strong><span>Not enough readable package text was found to identify this product.</span>`;
    if (!identified && !confirmed) {
      const form = document.createElement("form");
      form.className = "eg-image-identity-form";
      form.innerHTML = `<label>Brand<input name="brand" type="text" value="${escapeHtml(identity && identity.brand || "")}" autocomplete="off" required></label><label>Product<input name="product" type="text" value="${escapeHtml(product)}" autocomplete="off" required></label><button type="submit">Use for this scan</button><small>This correction will not be saved.</small>`;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const brand = cleanText(form.elements.brand.value);
        const productName = cleanText(form.elements.product.value);
        if (!brand || !productName) return;
        const corrected = { status: "confirmed", brand, productName, variant: "", confidence: 1, visibleEvidence: [] };
        showLocalImageIdentity(corrected, ocrText);
        latestLocalIdentityMatched = true;
        updateImageScan("matched", "Product confirmed", `${brand} — ${productName}`, "");
        loadCertificationDatabase().then((database) => {
          if (!database) return;
          const supplied = { title: productName, name: productName, brand, facts: { brand } };
          showVerifiedImageCertifications(findCertificationMatches(supplied, database));
        });
        runImageIdentityLookup(corrected, ocrText);
      });
      section.append(form);
    }
    panel.append(section);
    if (identified && confidence >= 65) {
      latestLocalIdentityMatched = true;
      updateImageScan("found", "Possible product identity", title, "");
      loadCertificationDatabase().then((database) => {
        if (!database) return;
        const identified = { title: product, name: product, brand: identity.brand, facts: { brand: identity.brand, category: identity.category } };
        showVerifiedImageCertifications(findCertificationMatches(identified, database));
      });
    }
  }

  function updateImageScan(status, title, detail, barcode) {
    if (latestLocalIdentityMatched && ["working", "missing", "unsupported", "error"].includes(status)) return;
    const panel = document.querySelector(".eg-floating-result");
    const row = panel && panel.querySelector(".eg-image-scan-status");
    if (!row) return;
    row.dataset.state = status;
    row.querySelector("strong").textContent = title;
    row.querySelector("span").textContent = detail;
    const previous = panel.querySelector(".eg-image-barcode");
    if (previous) previous.remove();
    if (barcode) {
      const code = document.createElement("div");
      code.className = "eg-image-barcode";
      code.innerHTML = `<strong>GTIN</strong><span>${escapeHtml(barcode)}</span>`;
      row.after(code);
    }
  }

  const imageCertificationPatterns = [
    [/(?:certified\s+)?b\s+corporation|certified\s+b\s+corp/i, "Certified B Corporation"],
    [/usda\s+organic/i, "USDA Organic"],
    [/non[- ]?gmo\s+project\s+verified/i, "Non-GMO Project Verified"],
    [/rainforest\s+alliance/i, "Rainforest Alliance"],
    [/fair\s*trade|fairtrade/i, "Fairtrade / Fair Trade"],
    [/certified\s+humane/i, "Certified Humane"],
    [/certified\s+gluten[- ]?free|gfco\.org/i, "Certified Gluten-Free"],
    [/certified\s+plant[- ]?based/i, "Certified Plant Based"],
    [/vegan\s+(?:certified|trademark)|certified\s+vegan/i, "Certified Vegan / Vegan Trademark"],
    [/peta[- ]approved\s+vegan/i, "PETA-Approved Vegan"],
    [/leaping\s+bunny/i, "Leaping Bunny"],
    [/forest\s+stewardship\s+council|\bfsc\b/i, "FSC (packaging detection)"],
    [/marine\s+stewardship\s+council|msc\s+certified/i, "MSC"],
    [/oeko[- ]?tex|standard\s+100/i, "OEKO-TEX"],
    [/global\s+organic\s+textile\s+standard|\bgots\b/i, "GOTS"],
    [/bluesign(?:®)?\s+product/i, "bluesign PRODUCT"],
    [/ewg\s+verified/i, "EWG Verified"],
    [/cradle\s+to\s+cradle\s+certified/i, "Cradle to Cradle Certified"],
    [/climate\s+neutral\s+certified|carbonneutral(?:®)?\s+product/i, "Climate/Carbon Neutral certification"],
    [/certified\s+halal|halal\s+certified|\bhalal\b/i, "Halal (packaging detection)"],
    [/\bkosher\b/i, "Kosher (packaging detection)"],
    [/\bvegan\b/i, "Vegan (packaging claim)"]
  ];

  function imageCertificationClaims(text) {
    return imageCertificationPatterns.filter(([pattern]) => pattern.test(String(text || ""))).map(([, label]) => label);
  }

  function showImageCertificationClaims(claims, error, recognizedText, engines) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-certifications");
    if (previous) previous.remove();
    const section = document.createElement("div");
    section.className = "eg-image-certifications";
    if (error) {
      section.innerHTML = `<strong>Packaging certification scan</strong><span>Unavailable: ${escapeHtml(String(error).slice(0, 140))}</span>`;
    } else if (claims.length) {
      section.innerHTML = `<strong>Packaging detections · unverified</strong><div>${claims.map((claim) => `<span>${escapeHtml(claim)}</span>`).join("")}</div><small>These labels are image evidence only and do not affect the grade until matched to an official source.</small>`;
    } else {
      section.innerHTML = `<strong>Packaging detections</strong><span>No supported certification label text was recognized.</span>`;
    }
    if (!error) {
      const raw = cleanText(recognizedText) || "No readable text returned.";
      if (engines) {
        const paddle = String(engines.paddle || "unavailable");
        section.insertAdjacentHTML("beforeend", `<small>OCR engines: Tesseract · PaddleOCR ${escapeHtml(paddle === "complete" ? "active" : paddle)}</small>`);
      }
      section.insertAdjacentHTML("beforeend", `<details class="eg-image-ocr-debug" open><summary>Recognized package text</summary><pre>${escapeHtml(raw)}</pre></details>`);
    }
    panel.append(section);
  }

  function showVerifiedImageCertifications(certifications) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-certifications-verified");
    if (previous) previous.remove();
    const current = (certifications || []).filter((item) => item && item.current !== false && item.gradeEligible !== false);
    if (!current.length) return;
    const section = document.createElement("div");
    section.className = "eg-image-certifications eg-image-certifications-verified";
    section.innerHTML = `<strong>Verified certifications</strong><div>${current.map((item) => `<span>${escapeHtml(item.name || item.certification || item.issuer || "Verified certification")}</span>`).join("")}</div><small>Confirmed through an official certification record matched to the identified product or brand scope.</small>`;
    panel.append(section);
  }

  function showBarcodeDebug(candidateCanvases, attempts, nativeAvailable) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-barcode-debug");
    if (previous) previous.remove();
    const section = document.createElement("details");
    section.className = "eg-barcode-debug";
    section.open = true;
    const attemptText = attempts.length
      ? attempts.map((item) => `${item.format || "unknown"}: ${item.value}`).join("\n")
      : "No decoder returned any value.";
    section.innerHTML = `<summary>Barcode scan diagnostics</summary><small>Native: ${nativeAvailable ? "available" : "unavailable"} · ZXing: ${typeof ZXingBrowser !== "undefined" ? "available" : "unavailable"} · ZBar: ${typeof zbarWasm !== "undefined" ? "available" : "unavailable"}</small><div class="eg-barcode-debug-images">${candidateCanvases.slice(0, 7).map((candidate, index) => `<figure><img src="${candidate.toDataURL("image/jpeg", 0.78)}" alt="Scan crop ${index + 1}"><figcaption>crop ${index + 1}</figcaption></figure>`).join("")}</div><pre>${escapeHtml(attemptText)}</pre>`;
    panel.append(section);
  }

  function scanImageCertifications(canvas) {
    // Use separate label-oriented passes. Large display type is often reversed
    // (white on a colored package), while ingredients are dark on light, so a
    // single full-image OCR treatment regularly sees one and misses the other.
    const images = [
      scaledCanvas(canvas, 2.5, false),
      scaledCanvas(canvas, 3, 145),
      croppedCanvas(canvas, 0.04, 0, 0.92, 0.23, 8, false),
      croppedCanvas(canvas, 0.04, 0, 0.92, 0.23, 8, 145),
      croppedCanvas(canvas, 0, 0, 1, 0.34, 6, false),
      croppedCanvas(canvas, 0, 0, 1, 0.34, 6, 145),
      croppedCanvas(canvas, 0, 0.18, 0.64, 0.52, 6, false),
      croppedCanvas(canvas, 0, 0.18, 0.64, 0.52, 6, 145),
      croppedCanvas(canvas, 0, 0.52, 1, 0.48, 5, false),
      croppedCanvas(canvas, 0, 0.52, 1, 0.48, 5, 145)
    ].map((image) => image.toDataURL("image/png"));
    chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_OCR_PACKAGE", images }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response || response.status !== "complete") {
        showImageCertificationClaims([], runtimeError && runtimeError.message || response && response.error || "Local OCR did not respond", "");
        return;
      }
      latestImageOcrText = response.text || "";
      latestImageOcrWords = Array.isArray(response.words) ? response.words : [];
      showImageCertificationClaims(imageCertificationClaims(response.text || ""), "", response.text || "", response.engines);
      const identity = localIdentityFromText(response.text || "", latestImageContextText, response.words || []);
      showNutritionFingerprint(nutritionFingerprintFromText(response.text || ""), identity, response.text || "");
      showLocalImageIdentity(identity, response.text || "");
      runImageIdentityLookup(identity, response.text || "");
    });
  }

  const identityBoilerplate = /nutrition|ingredients?|serving|calories|total fat|cholesterol|sodium|carbohydrate|protein|vitamin|manufactured|distributed|questions?|comments?|product of|keep refrigerated|best before|daily value|scan me|www\.|\.com\b|net wt|ounces?|grams?\b/i;
  const identityClaimOnly = /^(?:dairy[- ]?free|plant[- ]?based|vegan|vegetarian|organic|non[- ]?gmo|gluten[- ]?free|kosher|halal|certified|contains nuts?|peanut[- ]?free|soy[- ]?free|lactose[- ]?free|preservative[- ]?free)$/i;
  const identityProse = /\b(?:directions?|instructions?|stovetop|microwave|cook(?:ing|ed)?|minutes?|stir(?:ring|red)?|covered|skillet|saucepan|medium heat|frozen|thaw|add|recipe|simmer|food safety|daily diet|servings? per container|per\s*\d*\s*(?:cup|serving))\b/i;
  const identityClaimWord = /\b(?:free|vegan|vegetarian|organic|non[- ]?gmo|kosher|halal|certified|based|ingredients?|project|verified)\b/gi;
  const productWords = /\b(?:cheese|shreds?|parmesan|cream|spread|slices?|sticks?|salami|chocolate|candy|cookies?|crackers?|chips?|snacks?|cereal|granola|yogurt|milk|butter|sauce|dressing|coffee|tea|juice|water|bottle|sheets?|socks?|shirt|shampoo|conditioner|lotion|cleaner|detergent|makeup|lipstick|bag|backpack|toy|food|treats?)\b/i;
  const variantWords = /\b(?:cheddar|mozzarella|parmesan|scallion|spicy|plain|classic|original|vanilla|chocolate|strawberry|roasted|smoked|unsweetened|salted|style|grated|shredded|sliced)\b/i;

  function identityLine(value) {
    return cleanText(value).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)'®™.-]+$/g, "").trim();
  }

  function identityLabelCandidate(value) {
    const text = identityLine(value);
    const words = text.split(/\s+/).filter(Boolean);
    const claimWords = text.match(identityClaimWord) || [];
    if (text.length < 3 || text.length > 72 || words.length > 9 || !/[A-Za-z]{3}/.test(text)) return "";
    if (identityBoilerplate.test(text) || identityProse.test(text) || identityClaimOnly.test(text)) return "";
    if (claimWords.length >= 2 && !productWords.test(text) && !variantWords.test(text)) return "";
    if (/[.!?]\s+[A-Z]/.test(text) || /[,;:]\s+\w+\s+\w+\s+\w+/i.test(text)) return "";
    return text;
  }

  function cleanIdentityBrand(value) {
    let text = identityLine(value).replace(/\b(?:foods?|inc|llc|corp|corporation)\.?$/i, "").trim();
    text = text.split(/\s+[|•·—–]\s+|[,;:]|\s+\d/)[0].trim();
    const words = text.split(/\s+/).filter(Boolean).slice(0, 4);
    text = words.join(" ");
    if (!text || text.length < 3 || /\d/.test(text) || identityBoilerplate.test(text) || identityClaimOnly.test(text)) return "";
    return text;
  }

  function addIdentityCandidate(list, value, score) {
    const text = identityLabelCandidate(value);
    if (!text) return;
    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const duplicate = list.find((candidate) => candidate.normalized === normalized
      || candidate.normalized.includes(normalized) || normalized.includes(candidate.normalized));
    if (duplicate) {
      if (score > duplicate.score) Object.assign(duplicate, { text, normalized, score });
      return;
    }
    list.push({ text, normalized, score });
  }

  function identityWordDistance(left, right) {
    const a = String(left || "").toLowerCase();
    const b = String(right || "").toLowerCase();
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[b.length];
  }

  function prominentOcrLines(ocrWords) {
    const words = (Array.isArray(ocrWords) ? ocrWords : []).filter((word) => word && identityLine(word.text));
    const lines = [];
    words.sort((a, b) => Number(a.y0 || 0) - Number(b.y0 || 0) || Number(a.x0 || 0) - Number(b.x0 || 0)).forEach((word) => {
      const height = Math.max(1, Number(word.height || 0));
      const centerY = (Number(word.y0 || 0) + Number(word.y1 || 0)) / 2;
      let line = lines.find((candidate) => {
        const x0 = Number(word.x0 || 0);
        const x1 = Number(word.x1 || 0);
        const horizontalGap = x0 > candidate.x1 ? x0 - candidate.x1 : candidate.x0 > x1 ? candidate.x0 - x1 : 0;
        return Math.abs(candidate.centerY - centerY) <= Math.max(candidate.height, height) * 0.55
          && horizontalGap <= Math.max(candidate.height, height) * 3.5;
      });
      if (!line) {
        line = { words: [], centerY, height, confidence: 0, x0: Number(word.x0 || 0), x1: Number(word.x1 || 0) };
        lines.push(line);
      }
      line.words.push(word);
      const count = line.words.length;
      line.centerY = ((line.centerY * (count - 1)) + centerY) / count;
      line.height = Math.max(line.height, height);
      line.x0 = Math.min(line.x0, Number(word.x0 || 0));
      line.x1 = Math.max(line.x1, Number(word.x1 || 0));
      line.confidence += Number(word.confidence || 0);
    });
    return lines.map((line) => {
      const ordered = line.words.sort((a, b) => Number(a.x0 || 0) - Number(b.x0 || 0));
      const averageConfidence = line.confidence / Math.max(1, ordered.length);
      const text = ordered.map((word) => identityLine(word.text)).filter(Boolean).join(" ");
      return { text, height: line.height, confidence: averageConfidence, score: line.height * Math.max(25, averageConfidence), x0: line.x0, x1: line.x1, centerY: line.centerY };
    }).filter((line) => line.text.length >= 2).sort((a, b) => b.score - a.score);
  }

  function compoundOcrBrandHints(ocrWords) {
    const lines = prominentOcrLines(ocrWords).filter((line) => Number(line.confidence || 0) >= 38
      && line.text.length <= 34 && line.text.split(/\s+/).length <= 3);
    if (lines.length < 2) return [];
    const maxScore = Math.max(...lines.map((line) => Number(line.score || 0)), 1);
    const eligible = lines.filter((line) => Number(line.score || 0) >= maxScore * 0.18)
      .sort((a, b) => Number(a.centerY || 0) - Number(b.centerY || 0));
    const instructionWords = new Set("reasealable resealable tear here value pack dinner time serving suggestion enlarged show texture keep frozen heat thoroughly nutrition facts net weight less fat protein cooked more later".split(" "));
    const phrases = [];
    const addPhrase = (selected) => {
      const phrase = cleanText(selected.map((line) => line.text).join(" "));
      const tokens = phrase.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) || [];
      if (tokens.length < 2 || tokens.length > 6) return;
      const useful = tokens.filter((token) => !instructionWords.has(token));
      if (useful.length < 2 || identityBoilerplate.test(phrase) || identityClaimOnly.test(phrase)) return;
      if (!phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) phrases.push(phrase);
    };
    for (let start = 0; start < eligible.length; start += 1) {
      const group = [eligible[start]];
      for (let next = start + 1; next < eligible.length && group.length < 3; next += 1) {
        const previous = group[group.length - 1];
        const candidate = eligible[next];
        const verticalGap = Number(candidate.centerY || 0) - Number(previous.centerY || 0);
        const overlap = Math.max(0, Math.min(previous.x1, candidate.x1) - Math.max(previous.x0, candidate.x0));
        const narrower = Math.max(1, Math.min(previous.x1 - previous.x0, candidate.x1 - candidate.x0));
        const centers = Math.abs(((previous.x0 + previous.x1) / 2) - ((candidate.x0 + candidate.x1) / 2));
        const scale = Math.max(Number(previous.height || 1), Number(candidate.height || 1));
        if (verticalGap > scale * 2.4 || (overlap / narrower < 0.2 && centers > scale * 4.5)) break;
        group.push(candidate);
        addPhrase(group);
      }
    }
    return phrases.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length).slice(0, 5);
  }

  function localIdentityFromText(ocrText, pageContext, ocrWords) {
    const rawLines = String(ocrText || "").split(/\n+/).map(identityLine).filter((line) => line.length >= 2 && line.length <= 90);
    const uniqueLines = rawLines.filter((line, index) => rawLines.findIndex((other) => other.toLowerCase() === line.toLowerCase()) === index);
    const combined = `${ocrText || ""}\n${pageContext || ""}`;
    const domainBrand = combined.match(/\b([a-z][a-z0-9'-]{2,})(?:foods?)?\s*\.\s*com\b/i);
    const manufacturer = combined.match(/(?:manufactured|distributed)\s+by\s*[:\-]?\s*([a-z][a-z0-9 '&.-]{2,35}?)(?:\s+(?:foods?|inc|llc|corp|corporation)\b|,|\n)/i);
    const ignoredContextWords = new Set(["image", "images", "product", "shopping", "amazon", "google", "photo", "picture", "vegan", "organic", "cheese", "dairy", "free", "plant", "based", "the", "with", "from", "made", "new", "shop", "buy", "pack"]);
    const contextWords = String(pageContext || "").match(/[A-Za-z][A-Za-z0-9'’-]{2,}/g) || [];
    const recognizedWords = String(ocrText || "").match(/[A-Za-z][A-Za-z0-9'’-]{2,}/g) || [];
    const contextBrand = contextWords.find((word) => !ignoredContextWords.has(word.toLowerCase())
      && recognizedWords.some((recognized) => identityWordDistance(word, recognized) <= Math.max(1, Math.floor(word.length * 0.22))));
    const visualLines = prominentOcrLines(ocrWords);
    const prominentBrand = visualLines.filter((line) => {
      const text = identityLine(line && line.text);
      return text.length >= 3 && text.length <= 42 && Number(line.confidence || 0) >= 35
        && !identityBoilerplate.test(text) && !identityClaimOnly.test(text) && !productWords.test(text) && !variantWords.test(text);
    })[0];
    const brandLine = uniqueLines.slice(0, 18).find((line) => {
      const words = line.split(/\s+/);
      return words.length <= 4 && line.length <= 32 && !identityBoilerplate.test(line) && !identityClaimOnly.test(line)
        && !productWords.test(line) && !variantWords.test(line) && /[A-Za-z]{3}/.test(line);
    });
    const brandCandidates = [domainBrand && domainBrand[1].replace(/foods?$/i, ""), manufacturer && manufacturer[1], contextBrand, prominentBrand && prominentBrand.text, brandLine];
    const brand = brandCandidates.map(cleanIdentityBrand).find(Boolean) || "";
    if (!brand || brand.length < 3) return null;

    const brandIndex = uniqueLines.findIndex((line) => line.toLowerCase().includes(brand.toLowerCase()) || brand.toLowerCase().includes(line.toLowerCase()));
    const nearby = uniqueLines.slice(Math.max(0, brandIndex), Math.min(uniqueLines.length, Math.max(brandIndex + 1, 1) + 9));
    const rankedCandidates = [];
    visualLines.forEach((line) => {
      if (line.text.toLowerCase() === brand.toLowerCase()) return;
      let score = Number(line.score || 0);
      if (productWords.test(line.text)) score *= 1.3;
      if (variantWords.test(line.text)) score *= 1.12;
      const letters = line.text.replace(/[^A-Za-z]/g, "");
      const uppercase = line.text.replace(/[^A-Z]/g, "");
      if (letters.length >= 4 && uppercase.length / letters.length > 0.72) score *= 1.12;
      addIdentityCandidate(rankedCandidates, line.text, score);
    });
    // Text-only lines can fill gaps when an OCR engine did not return boxes,
    // but category words alone never outrank an actual prominent label.
    nearby.concat(uniqueLines).forEach((line, index) => {
      if (line.toLowerCase() === brand.toLowerCase() || (!productWords.test(line) && !variantWords.test(line))) return;
      addIdentityCandidate(rankedCandidates, line, 250 - Math.min(index, 100));
    });
    rankedCandidates.sort((a, b) => b.score - a.score);
    const productLines = rankedCandidates.slice(0, 2).map((candidate) => candidate.text);
    if (!productLines.length) return { status: "ambiguous", brand, productName: "", variant: "", confidence: 0.48, visibleEvidence: [brand] };

    const productName = productLines.join(" — ").replace(/\s+/g, " ").slice(0, 120);
    const contextHasBrand = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(pageContext || ""));
    const confidence = Math.min(0.9, 0.58 + (contextHasBrand ? 0.1 : 0) + (productLines.length >= 2 ? 0.12 : 0) + (domainBrand ? 0.08 : 0));
    return {
      status: confidence >= 0.65 ? "identified" : "ambiguous",
      brand,
      productName,
      variant: "",
      confidence,
      visibleEvidence: [brand, ...productLines].slice(0, 6)
    };
  }

  function showImageIdentityCandidates(response, brand) {
    const panel = document.querySelector(".eg-floating-result");
    if (!panel) return;
    const previous = panel.querySelector(".eg-image-identity-candidates");
    if (previous) previous.remove();
    const section = document.createElement("div");
    section.className = "eg-image-certifications eg-image-identity-candidates";
    const candidates = response && Array.isArray(response.candidates) ? response.candidates : [];
    if (response.status === "matched" && response.best) {
      const best = response.best;
      section.dataset.state = "matched";
      section.innerHTML = `<strong>${escapeHtml(best.source || "Open Food Facts")} match</strong><b>${escapeHtml(best.brand)} — ${escapeHtml(best.name)}</b><span>${Math.round(Number(best.confidence || 0) * 100)}% match confidence</span><small>Matched by agreement between the locally read brand/product text and a free database record.</small>`;
      latestLocalIdentityMatched = true;
      updateImageScan("matched", "Product identified", `${best.brand} — ${best.name}`, best.gtin);
      chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_FOOD", identifiers: [best.gtin] }, (lookup) => {
        if (chrome.runtime.lastError || !lookup || lookup.status !== "matched" || !lookup.product) return;
        loadCertificationDatabase().then((database) => {
          if (!database || typeof findCertificationMatches !== "function") return;
          const identified = {
            ...lookup.product,
            gtin: best.gtin,
            identifiers: [best.gtin],
            facts: { ...(lookup.product.facts || {}), gtin: best.gtin, identifiers: [best.gtin] }
          };
          showVerifiedImageCertifications(findCertificationMatches(identified, database));
        });
      });
    } else if (!candidates.length) {
      section.innerHTML = `<strong>Free database cross-check</strong><span>Recognized probable brand “${escapeHtml(brand)},” but Open Food Facts and USDA found no matching candidates.</span>`;
    } else {
      section.innerHTML = `<strong>Possible free-database matches</strong><span>The results were too close or incomplete to choose safely.</span><ul>${candidates.slice(0, 3).map((item) => `<li><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.brand)} · ${Math.round(Number(item.confidence || 0) * 100)}% agreement · ${escapeHtml(item.source || "Open Food Facts")}</small></li>`).join("")}</ul>`;
    }
    panel.append(section);
  }

  function imageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  function scaledCanvas(source, scale, highContrast) {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(scale, 2200 / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (highContrast) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const threshold = typeof highContrast === "number" ? highContrast : 155;
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
        const value = gray < threshold ? 0 : 255;
        pixels.data[index] = value;
        pixels.data[index + 1] = value;
        pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    return canvas;
  }

  function rotatedCanvas(source, clockwise) {
    const canvas = document.createElement("canvas");
    canvas.width = source.height;
    canvas.height = source.width;
    const context = canvas.getContext("2d");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(clockwise ? Math.PI / 2 : -Math.PI / 2);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  function croppedCanvas(source, leftRatio, topRatio, widthRatio, heightRatio, scale, highContrast) {
    const sx = Math.max(0, Math.round(source.width * leftRatio));
    const sy = Math.max(0, Math.round(source.height * topRatio));
    const sw = Math.min(source.width - sx, Math.max(1, Math.round(source.width * widthRatio)));
    const sh = Math.min(source.height - sy, Math.max(1, Math.round(source.height * heightRatio)));
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    crop.getContext("2d", { willReadFrequently: true }).drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return scaledCanvas(crop, scale, highContrast);
  }

  function localizedBarcodeRegions(source) {
    // Analyze a small copy so localization remains fast even for large product
    // photos. Barcodes create many strong parallel edges in one direction,
    // whereas tables and general text have more balanced horizontal/vertical edges.
    const maximum = 480;
    const ratio = Math.min(1, maximum / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(32, Math.round(source.width * ratio));
    canvas.height = Math.max(32, Math.round(source.height * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const columns = 16;
    const rows = 16;
    const horizontalEdges = new Float64Array(columns * rows);
    const verticalEdges = new Float64Array(columns * rows);
    const samples = new Uint32Array(columns * rows);
    const grayAt = (x, y) => {
      const index = (y * canvas.width + x) * 4;
      return pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    };
    for (let y = 1; y < canvas.height - 1; y += 2) {
      for (let x = 1; x < canvas.width - 1; x += 2) {
        const cellX = Math.min(columns - 1, Math.floor(x * columns / canvas.width));
        const cellY = Math.min(rows - 1, Math.floor(y * rows / canvas.height));
        const cell = cellY * columns + cellX;
        verticalEdges[cell] += Math.abs(grayAt(x + 1, y) - grayAt(x - 1, y));
        horizontalEdges[cell] += Math.abs(grayAt(x, y + 1) - grayAt(x, y - 1));
        samples[cell] += 1;
      }
    }
    const candidates = [];
    const windowShapes = [[3, 3], [4, 3], [5, 3], [3, 4], [3, 5]];
    for (const [windowWidth, windowHeight] of windowShapes) {
      for (let top = 0; top <= rows - windowHeight; top += 1) {
        for (let left = 0; left <= columns - windowWidth; left += 1) {
          let xEdges = 0;
          let yEdges = 0;
          let count = 0;
          for (let row = top; row < top + windowHeight; row += 1) {
            for (let column = left; column < left + windowWidth; column += 1) {
              const cell = row * columns + column;
              xEdges += verticalEdges[cell];
              yEdges += horizontalEdges[cell];
              count += samples[cell];
            }
          }
          if (!count) continue;
          xEdges /= count;
          yEdges /= count;
          const dominant = Math.max(xEdges, yEdges);
          const secondary = Math.min(xEdges, yEdges);
          // Parallel-edge strength plus directionality. The small secondary-edge
          // penalty demotes Nutrition Facts boxes and checkerboard-like patterns.
          const score = dominant * (dominant + 8) / (secondary + 18);
          if (dominant < 18 || score < 18) continue;
          const paddingX = 0.75;
          const paddingY = 0.75;
          const x = Math.max(0, (left - paddingX) / columns);
          const y = Math.max(0, (top - paddingY) / rows);
          const right = Math.min(1, (left + windowWidth + paddingX) / columns);
          const bottom = Math.min(1, (top + windowHeight + paddingY) / rows);
          candidates.push({ region: [x, y, right - x, bottom - y], score });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    const intersectionOverUnion = (first, second) => {
      const [ax, ay, aw, ah] = first;
      const [bx, by, bw, bh] = second;
      const intersection = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
        * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
      return intersection / (aw * ah + bw * bh - intersection || 1);
    };
    for (const candidate of candidates) {
      if (selected.some((region) => intersectionOverUnion(region, candidate.region) > 0.38)) continue;
      selected.push(candidate.region);
      if (selected.length >= 5) break;
    }
    return selected;
  }

  function detailedBarcodeRegions() {
    // Focus on compact edge regions where retail barcodes normally appear. Broad
    // full-package scans can mistake Nutrition Facts table rules for ITF bars.
    return [
      // Tall side strips preserve complete vertically oriented barcodes whose
      // bars cross the boundary between the middle and lower package regions.
      [0.52, 0.18, 0.44, 0.78], [0.04, 0.18, 0.44, 0.78],
      [0.48, 0.58, 0.50, 0.38], [0.02, 0.58, 0.50, 0.38],
      [0.48, 0.22, 0.42, 0.48], [0.10, 0.22, 0.42, 0.48],
      [0.42, 0.42, 0.56, 0.42], [0.02, 0.42, 0.56, 0.42],
      [0.48, 0.04, 0.50, 0.38], [0.02, 0.04, 0.50, 0.38]
    ];
  }

  function finishImageBarcodeMatch(identifiers, method) {
    const barcode = identifiers[0];
    const methodText = method === "ocr" ? "Printed digits passed the GTIN check. Looking up the product…" : "Looking up the product…";
    updateImageScan("found", "Valid barcode found", methodText, barcode);
    chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_LOOKUP_FOOD", identifiers }, (response) => {
      if (chrome.runtime.lastError || !response) {
        updateImageScan("found", "Valid barcode found", "The product lookup was unavailable.", barcode);
        return;
      }
      if (response.status === "matched" && response.product) {
        const name = [response.product.facts && response.product.facts.brand, response.product.name].filter(Boolean).join(" — ") || "Product identified";
        updateImageScan("matched", "Product identified", name, barcode);
        loadCertificationDatabase().then((database) => {
          if (!database || typeof findCertificationMatches !== "function") return;
          const identified = {
            ...response.product,
            gtin: barcode,
            identifiers,
            facts: { ...(response.product.facts || {}), gtin: barcode, identifiers }
          };
          showVerifiedImageCertifications(findCertificationMatches(identified, database));
        });
      } else {
        updateImageScan("found", "Valid barcode found", "No Open Food Facts product matched this GTIN.", barcode);
      }
    });
  }

  async function scanBarcodeCapture(imageDataUrl, crop, source) {
    const timeout = window.setTimeout(() => {
      updateImageScan("error", "Barcode scan timed out", "Try keeping the entire barcode visible, then scan the image again.");
    }, 25000);
    if (typeof BarcodeDetector === "undefined" && typeof ZXingBrowser === "undefined") {
      window.clearTimeout(timeout);
      updateImageScan("unsupported", "Barcode scanner unavailable", "This Chrome installation does not expose its local barcode detector.");
      return;
    }
    try {
      const image = await imageFromDataUrl(imageDataUrl);
      const scaleX = crop ? image.naturalWidth / crop.viewportWidth : 1;
      const scaleY = crop ? image.naturalHeight / crop.viewportHeight : 1;
      const sx = crop ? Math.max(0, Math.round(crop.left * scaleX)) : 0;
      const sy = crop ? Math.max(0, Math.round(crop.top * scaleY)) : 0;
      const sw = crop ? Math.min(image.naturalWidth - sx, Math.max(1, Math.round(crop.width * scaleX))) : image.naturalWidth;
      const sh = crop ? Math.min(image.naturalHeight - sy, Math.max(1, Math.round(crop.height * scaleY))) : image.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      // Keep only the current scan in memory; this is not written to storage.
      latestImageVisualDataUrl = canvas.toDataURL("image/jpeg", 0.88);
      // Run independently from product identification. Results are explicitly
      // non-grading packaging evidence until an official source confirms them.
      scanImageCertifications(canvas);
      const automaticRegions = localizedBarcodeRegions(canvas);
      const scanRegions = automaticRegions.concat(detailedBarcodeRegions());
      const fullLarge = scaledCanvas(canvas, 2.5, false);
      const quickVariants = [canvas, fullLarge, scaledCanvas(canvas, 2.5, true), rotatedCanvas(fullLarge, true), rotatedCanvas(fullLarge, false)];
      const priorityRegions = automaticRegions.slice(0, 5).concat(detailedBarcodeRegions().slice(0, 4));
      priorityRegions.forEach((region) => {
        const focused = croppedCanvas(canvas, ...region, 4, false);
        quickVariants.push(
          focused,
          croppedCanvas(canvas, ...region, 4, 120),
          croppedCanvas(canvas, ...region, 4, 155),
          croppedCanvas(canvas, ...region, 4, 190),
          rotatedCanvas(focused, true),
          rotatedCanvas(focused, false)
        );
      });
      const rawValues = [];
      const trustedRetailValues = [];
      const decodedAttempts = [];
      const recordDecodedBarcode = (value, format) => {
        const name = (typeof format === "number" && typeof ZXingBrowser !== "undefined" && ZXingBrowser.BarcodeFormat
          ? ZXingBrowser.BarcodeFormat[format] : String(format || "").toUpperCase())
          .replace(/^ZBAR_/, "").replace(/-/g, "_");
        decodedAttempts.push({ value: String(value || ""), format: name });
        // Trust only retail UPC/EAN symbologies. Nutrition-table rules were
        // previously being decoded as repeated ITF/Code-128 false positives.
        if (/^(?:EAN_8|EAN_13|UPC_A|UPC_E)$/.test(name)) {
          rawValues.push(value);
          trustedRetailValues.push(value);
        }
      };
      if (typeof BarcodeDetector !== "undefined") {
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e"];
        const supported = typeof BarcodeDetector.getSupportedFormats === "function"
          ? await BarcodeDetector.getSupportedFormats() : formats;
        const enabledFormats = formats.filter((format) => supported.includes(format));
        if (enabledFormats.length) {
          const detector = new BarcodeDetector({ formats: enabledFormats });
          for (const variant of quickVariants) {
            const detections = await detector.detect(variant);
            detections.forEach((item) => recordDecodedBarcode(item.rawValue, item.format));
          }
        }
      }
      if (typeof ZXingBrowser !== "undefined") {
        const reader = new ZXingBrowser.BrowserMultiFormatReader();
        for (const variant of quickVariants) {
          try {
            const result = reader.decodeFromCanvas(variant);
            recordDecodedBarcode(result.getText(), result.getBarcodeFormat());
          } catch (_notFound) {
            // ZXing signals a normal miss by throwing; continue with the next preprocessing pass.
          }
        }
        for (const region of scanRegions.slice(0, 8)) {
          for (const highContrast of [false, 125, 165, 205]) {
            const variant = croppedCanvas(canvas, ...region, 3, highContrast);
            try {
              const result = reader.decodeFromCanvas(variant);
              recordDecodedBarcode(result.getText(), result.getBarcodeFormat());
            } catch (_notFound) {
              // Continue with the next crop or contrast treatment.
            }
          }
        }
      }
      if (typeof zbarWasm !== "undefined" && typeof zbarWasm.scanImageData === "function") {
        const zbarVariants = [canvas];
        priorityRegions.slice(0, 7).forEach((region) => {
          zbarVariants.push(croppedCanvas(canvas, ...region, 4, false));
        });
        priorityRegions.slice(0, 3).forEach((region) => {
          zbarVariants.push(croppedCanvas(canvas, ...region, 4, 155));
        });
        for (const variant of zbarVariants) {
          try {
            const context = variant.getContext("2d", { willReadFrequently: true });
            const symbols = await zbarWasm.scanImageData(context.getImageData(0, 0, variant.width, variant.height));
            (symbols || []).forEach((symbol) => recordDecodedBarcode(symbol.decode(), symbol.typeName));
          } catch (error) {
            decodedAttempts.push({ format: "ZBAR_ERROR", value: String(error && error.message || error).slice(0, 120) });
            break;
          }
        }
      }
      const debugCanvases = [canvas].concat(priorityRegions.map((region) => croppedCanvas(canvas, ...region, 1.5, false)));
      showBarcodeDebug(debugCanvases, decodedAttempts, typeof BarcodeDetector !== "undefined");
      const barcodeCounts = new Map();
      rawValues.map(EthicalGrade.normalizeBarcode).filter(EthicalGrade.validGtin).forEach((value) => {
        // Compare equivalent UPC/EAN/GTIN representations without allowing an
        // isolated low-resolution decode to outrank repeated agreement.
        const key = value.length === 13 && value.startsWith("0") ? value.slice(1) : value;
        const existing = barcodeCounts.get(key);
        barcodeCounts.set(key, { value: existing && existing.value.length <= value.length ? existing.value : value, count: (existing ? existing.count : 0) + 1 });
      });
      const rankedIdentifiers = [...barcodeCounts.values()].sort((a, b) => b.count - a.count);
      const trustedIdentifiers = [...new Set(trustedRetailValues.map(EthicalGrade.normalizeBarcode).filter(EthicalGrade.validGtin)
        .map((value) => value.length === 13 && value.startsWith("0") ? value.slice(1) : value))];
      const identifiers = trustedIdentifiers.length === 1 ? trustedIdentifiers
        : rankedIdentifiers.length && rankedIdentifiers[0].count >= 2
          && (!rankedIdentifiers[1] || rankedIdentifiers[0].count > rankedIdentifiers[1].count)
          ? [rankedIdentifiers[0].value] : [];
      if (!identifiers.length) {
        window.clearTimeout(timeout);
        updateImageScan("working", "Reading printed barcode digits…", `Local OCR is scanning ${source === "original" ? `the original ${canvas.width}×${canvas.height} image` : "the visible image"}.`);
        // OCR targeted crops rather than the text-heavy entire package. This makes
        // the small human-readable GTIN occupy far more of the OCR input.
        const ocrRegions = [
          // Tight lower corners make a 90–120 px printed UPC hundreds of pixels
          // wide before OCR. The wider overlapping crops handle unusual layouts.
          [0.52, 0.60, 0.46, 0.38], [0.02, 0.60, 0.48, 0.38],
          [0.42, 0.48, 0.58, 0.52], [0, 0.48, 0.58, 0.52],
          [0.20, 0.55, 0.60, 0.43]
        ];
        const ocrImages = [];
        scanRegions.slice(0, 3).forEach((region) => {
          ocrImages.push(croppedCanvas(canvas, ...region, 6, false).toDataURL("image/png"));
        });
        for (const region of ocrRegions) {
          ocrImages.push(croppedCanvas(canvas, ...region, 6, false).toDataURL("image/png"));
          ocrImages.push(croppedCanvas(canvas, ...region, 6, true).toDataURL("image/png"));
        }
        chrome.runtime.sendMessage({ type: "ETHICAL_GRADE_OCR_BARCODE", images: ocrImages }, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError || !response || response.status !== "complete") {
            const detail = runtimeError && runtimeError.message || response && response.error || response && response.status || "No response from local OCR";
            updateImageScan("error", "Local OCR failed", String(detail).slice(0, 180));
            return;
          }
          const counts = response.candidateCounts && typeof response.candidateCounts === "object" ? response.candidateCounts : {};
          const ocrCandidates = [...new Set((response.candidates || []).map(EthicalGrade.normalizeBarcode).filter((candidate) => {
            if (!EthicalGrade.validGtin(candidate)) return false;
            // EAN-8 is valid, but an isolated OCR-only eight-digit sequence is
            // commonly a lot/date/weight false positive when no bars exist.
            return Number(counts[candidate] || 0) >= 2;
          }))];
          if (ocrCandidates.length === 1) {
            finishImageBarcodeMatch(ocrCandidates, "ocr");
          } else if (ocrCandidates.length > 1) {
            updateImageScan("missing", "Barcode digits were ambiguous", "OCR found multiple valid-looking identifiers, so none were accepted.");
          } else {
            updateImageScan("missing", "No barcode found", "Neither the bars nor the printed digits produced a valid GTIN.");
          }
        });
        return;
      }
      window.clearTimeout(timeout);
      finishImageBarcodeMatch(identifiers, "bars");
    } catch (_error) {
      window.clearTimeout(timeout);
      updateImageScan("error", "Barcode scan failed", "Try another image with a larger, sharper barcode.");
    }
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".eg-grade-badge") && !event.target.closest(".eg-popover")) closeActivePopover();
  });
  window.addEventListener("scroll", (event) => {
    if (isInsideActivePopover(event.target)) return;
    closeActivePopover();
  }, true);
  window.addEventListener("resize", () => {
    repositionBadges();
    if (activePopover && activeBadge && document.body.contains(activePopover) && document.body.contains(activeBadge)) positionPopover(activePopover, activeBadge);
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    if (message.type === "ETHICAL_GRADE_IMAGE_SCANNER_PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ETHICAL_GRADE_CONTEXT_IMAGE") {
      latestImageContextText = message.contextText || "";
      floatingImageResult(message.srcUrl, message.pageUrl);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ETHICAL_GRADE_SCAN_BARCODE_CAPTURE") {
      scanBarcodeCapture(message.imageDataUrl || message.screenshot, message.crop, message.source || "screenshot");
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ETHICAL_GRADE_IMAGE_BARCODE_RESULT") {
      if (message.status === "image_not_visible") updateImageScan("missing", "Image could not be captured", "Keep the selected image visible in the window and try again.");
      if (message.status === "capture_failed") updateImageScan("error", "Image capture failed", "Refresh this page and try the image again.");
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ETHICAL_GRADE_REFRESH") {
      loadProfile().then((next) => { profile = next; scan(); });
      sendResponse({ ok: true });
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) { profile = mergeProfile(changes[STORAGE_KEY].newValue); scan(); }
  });
  if (shouldProcessPage()) Promise.all([loadProfile(), loadCertificationDatabase(), loadProductDatabase()]).then(([next]) => { profile = next; scan(); });
})();
