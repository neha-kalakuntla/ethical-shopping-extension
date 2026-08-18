(function initEthicalGrade(root) {
  "use strict";

  const STORAGE_KEY = "ethicalGradeProfile";
  const EVIDENCE_SCHEMA_VERSION = 1;
  const CATEGORY_DEFINITIONS = [
    ["labor", "Labor and human rights", "Worker treatment, pay, safety, forced or child labor risk"],
    ["animals", "Animal welfare", "Animal products, animal testing, treatment, and cruelty-free signals"],
    ["environment", "Environmental impact", "Carbon, packaging, waste, water, biodiversity, and transport"],
    ["health", "Health and nutrition", "Allergens, ingredients, sugar, sodium, protein, and diet fit"],
    ["price", "Budget and price", "Visible price and rough affordability"],
    ["small_business", "Small/local business", "Small, local, handmade, family-owned, or values-led sellers"],
    ["transparency", "Certifications and transparency", "Fair Trade, B Corp, organic, cruelty-free, and source quality"]
  ];
  const DEALBREAKER_DEFINITIONS = [
    ["animal_products", "Animal products", "Flags leather, wool, dairy, eggs, honey, gelatin, and meat.", "avoid"],
    ["animal_testing", "Animal testing", "Flags beauty, cleaning, or care products that may need cruelty-free proof.", "warning"],
    ["allergens", "Major allergens", "Flags peanuts, tree nuts, soy, sesame, shellfish, and similar terms.", "avoid"],
    ["gluten", "Gluten", "Flags wheat, barley, rye, bread, pasta, crackers, and similar terms.", "warning"],
    ["blocked_terms", "Blocked brands or terms", "Flags comma-separated words you never want to support.", "cap"],
    ["max_price", "Maximum price", "Flags products with a visible price above your limit.", "warning"]
  ];
  const PRESETS = [
    { id: "balanced", label: "Balanced", summary: "A practical mix of environment, labor, animal welfare, health, and price.", strictness: "balanced", missingDataPenalty: "medium", weights: { environment: 25, labor: 20, animals: 20, health: 20, price: 15 }, dealbreakers: {} },
    { id: "ethical", label: "Ethical shopper", summary: "Centers labor, animal welfare, environment, and trustworthy certifications.", strictness: "strict", missingDataPenalty: "strong", weights: { labor: 35, animals: 25, environment: 25, transparency: 15 }, dealbreakers: { animal_testing: "warning" } },
    { id: "climate", label: "Climate focused", summary: "Rewards lower footprint, less waste, local signals, and better sourcing.", strictness: "strict", missingDataPenalty: "strong", weights: { environment: 60, transparency: 15, labor: 15, small_business: 10 }, dealbreakers: {} },
    { id: "vegan", label: "Vegan / animal welfare", summary: "Strongly flags animal products and prioritizes animal welfare.", strictness: "strict", missingDataPenalty: "strong", weights: { animals: 45, labor: 20, environment: 20, health: 15 }, dealbreakers: { animal_products: "avoid", animal_testing: "avoid" } },
    { id: "budget", label: "Budget first", summary: "Prioritizes price while keeping health and ethics visible.", strictness: "gentle", missingDataPenalty: "light", weights: { price: 50, health: 20, environment: 15, labor: 15 }, dealbreakers: { max_price: "warning" } },
    { id: "health", label: "Health and nutrition", summary: "Centers food restrictions, ingredient quality, and nutrition goals.", strictness: "balanced", missingDataPenalty: "medium", weights: { health: 50, price: 20, environment: 15, transparency: 15 }, dealbreakers: { allergens: "avoid", gluten: "warning" } }
  ];
  const SAMPLE_PRODUCTS = [
    { id: "chocolate", title: "Fair Trade Vegan Dark Chocolate Bar", brand: "Cocoa North", price: 5.99, text: "fair trade vegan recycled paper organic" },
    { id: "leather", title: "Genuine Leather Travel Tote", brand: "Market Goods", price: 84.99, text: "genuine leather imported materials" },
    { id: "plastic", title: "Disposable Plastic Water Bottles, 40 Pack", brand: "ClearSpring", price: 7.99, text: "single-use disposable plastic bottles" },
    { id: "cookies", title: "Peanut Butter Wheat Cookies", brand: "Snack House", price: 3.49, text: "peanut wheat milk sugar cookies" }
  ];
  const keywordSets = {
    animal_products: ["leather", "wool", "silk", "gelatin", "beef", "chicken", "pork", "fish", "milk", "dairy", "cheese", "egg", "honey"],
    animal_testing: ["cosmetic", "makeup", "skincare", "skin care", "shampoo", "conditioner", "detergent", "cleaner"],
    allergens: ["peanut", "tree nut", "almond", "cashew", "walnut", "soy", "shellfish", "sesame"],
    gluten: ["gluten", "wheat", "barley", "rye", "malt extract", "breadstick", "bread", "pasta", "cracker", "cookie"]
  };
  const IDENTITY_EVIDENCE_FIELDS = ["asin", "url", "imageUrl"];
  const PAGE_FACT_PROVIDER = {
    id: "page_facts",
    label: "Page facts",
    description: "Visible product facts extracted from the current page or product card.",
    source: defaultEvidenceSource,
    confidence: defaultEvidenceConfidence,
    fields: [
      { field: "asin", label: "asin", searchable: false, value: (item, facts) => item.asin || facts.asin },
      { field: "url", label: "url", searchable: false, value: (item, facts) => item.href || item.url || facts.url },
      { field: "imageUrl", label: "image url", searchable: false, value: (item, facts) => item.imageUrl || item.src || facts.imageUrl },
      { field: "title", label: "title", searchable: true, value: (item, facts) => item.title || facts.title },
      { field: "brand", label: "brand", searchable: true, value: (item, facts) => item.brand || facts.brand },
      { field: "seller", label: "seller", searchable: true, value: (item, facts) => item.seller || facts.seller },
      { field: "category", label: "category", searchable: true, value: (item, facts) => item.category || facts.category },
      { field: "productBullets", label: "product bullets", searchable: true, value: (item, facts) => item.productBullets || facts.productBullets },
      { field: "certifications", label: "certification text", searchable: true, value: (item, facts) => item.certifications || facts.certifications },
      { field: "price", label: "price", searchable: true, value: (item, facts) => item.priceText || facts.priceText || item.price || facts.price },
      { field: "pageText", label: (item) => item.id ? "sample text" : "page text", searchable: true, value: (item, facts) => item.text || facts.pageText || facts.cardText }
    ]
  };
  const CERTIFICATION_PROVIDER = {
    id: "certification_provider",
    label: "Certification provider",
    description: "Verified certification facts supplied by a trusted certification data source.",
    source: "local_certification_database",
    confidence: 0.92,
    fields: [
      { field: "verifiedCertifications", label: "verified certifications", searchable: true, value: gradeEligibleCertificationText }
    ]
  };
  const PAGE_CLAIM_PROVIDER = {
    id: "page_claim_provider",
    label: "Merchant page claims",
    description: "Certification or sustainability wording claimed on the merchant page but not verified against an official source.",
    source: "amazon_product_page",
    confidence: 0.55,
    fields: [
      { field: "pageClaims", label: "page claims", searchable: false, value: (item, facts) => item.pageClaims || facts.pageClaims }
    ]
  };
  const FOOD_FACT_PROVIDER = {
    id: "open_food_facts_provider",
    label: "Open Food Facts provider",
    description: "Barcode-matched ingredients, allergens, nutrition, labels, and packaging from Open Food Facts.",
    source: (item, facts) => item.foodFactSource || facts.foodFactSource || "open_food_facts",
    confidence: (item, facts) => Number(item.foodFactConfidence || facts.foodFactConfidence || 0.9),
    fields: [
      { field: "gtin", label: "barcode / GTIN", searchable: false, value: (item, facts) => item.gtin || facts.gtin },
      { field: "identityMatch", label: "product identity", searchable: false, value: (item, facts) => item.identityMatch || facts.identityMatch },
      { field: "ingredientsText", label: "ingredients", searchable: true, value: (item, facts) => item.ingredientsText || facts.ingredientsText },
      { field: "allergens", label: "allergens", searchable: true, value: (item, facts) => item.allergens || facts.allergens },
      { field: "nutrition", label: "nutrition", searchable: true, value: (item, facts) => item.nutrition || facts.nutrition },
      { field: "foodLabels", label: "food labels", searchable: true, value: (item, facts) => item.foodLabels || facts.foodLabels },
      { field: "packaging", label: "packaging", searchable: true, value: (item, facts) => item.packaging || facts.packaging }
    ]
  };
  const FACT_PROVIDERS = [PAGE_FACT_PROVIDER, PAGE_CLAIM_PROVIDER, CERTIFICATION_PROVIDER, FOOD_FACT_PROVIDER];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function cleanValue(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  const PAGE_CLAIM_PATTERNS = [
    ["fairtrade", /\bfair\s*trade\b/i, "Fairtrade"],
    ["rainforest_alliance", /\brainforest alliance\b/i, "Rainforest Alliance"],
    ["certified_humane", /\bcertified humane\b/i, "Certified Humane"],
    ["organic", /\b(?:usda organic|certified organic|organic certified)\b/i, "Organic"],
    ["gots", /\b(?:gots|global organic textile standard)\b/i, "Global Organic Textile Standard (GOTS)"],
    ["msc", /\b(?:msc[- ]certified|marine stewardship council(?: certified)?)\b/i, "Marine Stewardship Council (MSC)"],
    ["fsc", /\b(?:fsc\s*(?:100%|mix|recycled|certified|label(?:led)?)|forest stewardship council(?: certified)?)\b/i, "Forest Stewardship Council (FSC)"],
    ["oeko_tex_made_in_green", /\b(?:oeko[- ]?tex(?:®)?\s+)?made in green\b/i, "OEKO-TEX MADE IN GREEN"],
    ["oeko_tex_standard_100", /\b(?:oeko[- ]?tex(?:®)?\s+)?standard 100\b/i, "OEKO-TEX STANDARD 100"],
    ["oeko_tex_organic_cotton", /\boeko[- ]?tex(?:®)?\s+organic cotton\b/i, "OEKO-TEX ORGANIC COTTON"],
    ["oeko_tex_leather_standard", /\boeko[- ]?tex(?:®)?\s+leather standard\b/i, "OEKO-TEX LEATHER STANDARD"],
    ["ewg_verified", /\bewg\s+verified(?:®|™)?\b/i, "EWG VERIFIED"],
    ["bluepass_consumer_product", /\bbluepass(?:®)?\s+consumer product\b/i, "bluepass Consumer Product"],
    ["bluesign_product", /\bbluesign(?:®)?\s+product\b/i, "bluesign PRODUCT"],
    ["bluesign_approved", /\bbluesign(?:®)?\s+approved\b/i, "bluesign APPROVED"],
    ["bluesign_system_partner", /\bbluesign(?:®)?\s+system partner\b/i, "bluesign System Partner"],
    ["change_climate_label", /\b(?:the climate label|climate neutral certified)\b/i, "The Climate Label"],
    ["carbonneutral_product", /\b(?:certified\s+)?carbonneutral(?:®)?\s+(?:certified\s+)?product\b/i, "CarbonNeutral product"],
    ["vegan_society_trademark", /\b(?:the\s+)?vegan society(?:'s)?\s+(?:vegan\s+)?trademark\b|\bvegan trademark(?:ed)?\b/i, "Vegan Trademark"],
    ["upcycled_certified", /\bupcycled certified(?:®|™)?\b/i, "Upcycled Certified"],
    ["global_recycled_standard", /\b(?:global recycled standard|grs[- ]certified)\b/i, "Global Recycled Standard (GRS)"],
    ["recycled_claim_standard", /\b(?:recycled claim standard|rcs[- ]certified)\b/i, "Recycled Claim Standard (RCS)"],
    ["asc", /\b(?:asc[- ]certified|aquaculture stewardship council(?: certified)?)\b/i, "Aquaculture Stewardship Council (ASC)"],
    ["fair_for_life", /\bfair for life(?: certified)?\b/i, "Fair for Life"],
    ["non_gmo_project", /\bnon[- ]?gmo project verified\b/i, "Non-GMO Project Verified"],
    ["agw_animal_welfare", /\bcertified animal welfare approved by agw\b/i, "Certified Animal Welfare Approved by AGW"],
    ["agw_grassfed", /\bcertified grassfed by agw\b/i, "Certified Grassfed by AGW"],
    ["agw_non_gmo", /\bcertified non[- ]?gmo by agw\b/i, "Certified Non-GMO by AGW"],
    ["agw_regenerative", /\bcertified regenerative by agw\b/i, "Certified Regenerative by AGW"],
    ["green_seal", /\bgreen seal(?:®)?(?:[- ]certified| certified)?\b/i, "Green Seal Certified"],
    ["epeat", /\bepeat(?:®)?(?:[- ]registered| registered| gold| silver| bronze)?\b/i, "EPEAT Registered"],
    ["tco_certified", /\btco certified(?: edge)?\b/i, "TCO Certified"],
    ["energy_star", /\benergy star(?:®)?(?:[- ]certified| certified)?\b/i, "ENERGY STAR Certified"],
    ["peta_animal_test_free_vegan", /\bpeta(?:'s)?\s+(?:approved\s+)?(?:animal test[- ]free and vegan|cruelty[- ]free and vegan)\b/i, "PETA Animal Test-Free and Vegan"],
    ["peta_animal_test_free", /\bpeta(?:'s)?\s+(?:approved\s+)?(?:animal test[- ]free|cruelty[- ]free)\b/i, "PETA Animal Test-Free"],
    ["peta_approved_vegan", /\bpeta[- ]approved vegan\b/i, "PETA-Approved Vegan"],
    ["goodweave", /\bgoodweave(?: certified)?\b/i, "GoodWeave Certified"],
    ["epa_safer_choice", /\b(?:epa\s+)?safer choice(?:[- ]certified| certified)?\b/i, "EPA Safer Choice Certified"],
    ["cosmos_organic", /\bcosmos organic\b/i, "COSMOS ORGANIC"],
    ["cosmos_natural", /\bcosmos natural\b/i, "COSMOS NATURAL"],
    ["responsible_wool_standard", /\b(?:responsible wool standard|rws[- ]certified)\b/i, "Responsible Wool Standard (RWS)"],
    ["responsible_down_standard", /\b(?:responsible down standard|rds[- ]certified)\b/i, "Responsible Down Standard (RDS)"],
    ["responsible_mohair_standard", /\b(?:responsible mohair standard|rms[- ]certified)\b/i, "Responsible Mohair Standard (RMS)"],
    ["responsible_alpaca_standard", /\b(?:responsible alpaca standard|ras[- ]certified)\b/i, "Responsible Alpaca Standard (RAS)"],
    ["organic_content_standard", /\b(?:organic content standard|ocs[- ]certified)\b/i, "Organic Content Standard (OCS)"],
    ["eu_ecolabel", /\b(?:eu ecolabel|european union ecolabel)\b/i, "EU Ecolabel"],
    ["blue_angel", /\b(?:blue angel|blauer engel)(?:[- ]certified| certified)?\b/i, "Blue Angel"],
    ["nordic_swan", /\b(?:nordic swan(?: ecolabel)?|svanem[aä]rket)(?:[- ]certified| certified)?\b/i, "Nordic Swan Ecolabel"],
    ["usda_certified_biobased", /\busda(?:[- ]certified)? biobased product(?: label| certified)?\b/i, "USDA Certified Biobased Product"],
    ["epa_watersense", /\b(?:epa\s+)?watersense(?:[- ]labeled| labeled| certified)?\b/i, "WaterSense Labeled"],
    ["ok_compost_industrial", /\bok compost industrial\b/i, "OK compost INDUSTRIAL"],
    ["ok_compost_home", /\bok compost home\b/i, "OK compost HOME"],
    ["seedling_compostable", /\b(?:seedling(?: compostability)?(?: logo| certified)?|certified compostable en 13432)\b/i, "Seedling Compostable"],
    ["iscc_plus", /\biscc plus(?:[- ]certified| certified)?\b/i, "ISCC PLUS"],
    ["zq_merino", /\b(?:zq merino(?: wool)?(?:[- ]certified| certified)?|zq[- ]certified (?:merino|wool))\b/i, "ZQ Merino"],
    ["pefc", /\b(?:pefc[- ]certified|programme for the endorsement of forest certification)\b/i, "PEFC Certified"],
    ["eu_organic", /\b(?:eu organic(?: logo| certified)?|euro[- ]leaf)\b/i, "EU Organic"],
    ["soil_association_organic", /\bsoil association(?: certified)? organic\b/i, "Soil Association Organic"],
    ["rspo", /\b(?:rspo[- ]certified|certified sustainable palm oil)\b/i, "RSPO Certified"],
    ["scs_recycled_content", /\b(?:scs global services )?(?:recycled content certified|certified recycled content)\b/i, "SCS Recycled Content Certified"],
    ["cruelty_free", /\bcruelty[- ]?free\b/i, "Cruelty-free"],
    ["climate_pledge_friendly", /\bclimate pledge friendly\b/i, "Climate Pledge Friendly"],
    ["keto_certified", /\bketo certified\b/i, "Keto Certified"],
    ["kosher_certified", /\bkosher certified\b/i, "Kosher Certified"],
    ["vegan", /\bvegan\b/i, "Vegan"],
    ["vegetarian", /\bveg(?:etarian|itarian)\b/i, "Vegetarian"]
  ];
  function extractPageClaims(fields, metadata) {
    const details = metadata || {};
    const capturedAt = details.capturedAt || new Date().toISOString();
    const sourceUrl = details.sourceUrl || "";
    const claims = [];
    const seen = new Set();
    Object.entries(fields || {}).forEach(([sourceField, rawValue]) => {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      values.forEach((rawText) => {
        const text = cleanValue(rawText);
        if (!text) return;
        const passages = text.split(/(?<=[.!?])\s+|\s*[|•]\s*/).map(cleanValue).filter(Boolean);
        passages.forEach((exactText) => {
          PAGE_CLAIM_PATTERNS.forEach(([claimType, pattern, label]) => {
            if (!pattern.test(exactText)) return;
            const key = `${claimType}|${sourceField}|${exactText.toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);
            claims.push({
              claimType, label, exactText: exactText.slice(0, 500), normalizedClaim: label.toLowerCase(),
              sourceUrl, sourceField, capturedAt, verificationStatus: "unverified",
              gradeEligible: false, confidence: 0.55
            });
          });
        });
      });
    });
    return claims;
  }
  function oekoLabelNumbersFromText(value) {
    const text = cleanValue(value);
    const numbers = [];
    const pattern = /(?:OEKO[- ]?TEX(?:®)?|STANDARD 100|MADE IN GREEN)[\s\S]{0,1200}?Certification Number\s*([A-Z0-9][A-Z0-9.-]{5,40})/gi;
    let match;
    while ((match = pattern.exec(text))) numbers.push(match[1].replace(/[.,;:]+$/, ""));
    return [...new Set(numbers)];
  }
  function oekoCertificationFromHtml(html, number) {
    const source = String(html || "");
    const eventMatch = source.match(/dataLayer\.push\((\{[^;]{0,1200}"event":"labelcheckSubmitted"[^;]{0,1200}\})\);/);
    if (!eventMatch) return null;
    let event;
    try { event = JSON.parse(eventMatch[1]); } catch (_) { return null; }
    if (!event || event.event !== "labelcheckSubmitted") return null;
    const label = cleanValue(event.label).replace(/®/g, "");
    const status = cleanValue(event.status).toLowerCase();
    const certificateNumber = cleanValue(event.number || number);
    if (!certificateNumber || !/OEKO[- ]?TEX/i.test(label)) return null;
    return {
      name: label, issuer: "OEKO-TEX Association", sourceId: "oeko_tex_label_check",
      status, scope: "product", certificationNumber: certificateNumber,
      officialProfileUrl: `https://www.oeko-tex.com/en/detail/?number=${encodeURIComponent(certificateNumber)}`,
      current: status === "valid", gradeEligible: status === "valid", confidence: 0.95
    };
  }
  function decodeHtmlText(value) {
    return cleanValue(String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
  }
  function veganSocietyCertificationFromHtml(html, brand, title) {
    const requestedBrand = normalizeProductBrand(brand);
    const requestedTitle = cleanValue(title);
    if (!requestedBrand || !requestedTitle) return null;
    const source = String(html || "");
    const starts = [...source.matchAll(/<div[^>]+class=["'][^"']*tm-brand-container[^"']*["'][^>]*>/gi)].map((match) => match.index);
    const containers = starts.map((start, index) => source.slice(start, starts[index + 1] || source.length));
    for (const container of containers) {
      const heading = container.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (!heading) continue;
      const directoryBrand = decodeHtmlText(heading[1]);
      if (normalizeProductBrand(directoryBrand) !== requestedBrand) continue;
      const paragraphs = [...container.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      const productNames = paragraphs.flatMap((match) => decodeHtmlText(match[1]).split(/\s*,\s*/).map(cleanValue).filter(Boolean));
      const matchedProduct = productNames.find((name) => productTermInText(name, requestedTitle));
      if (!matchedProduct) return null;
      const letter = /^[a-z]/.test(requestedBrand) ? requestedBrand[0] : "numbers";
      return {
        name: "Vegan Trademark", issuer: "The Vegan Society", sourceId: "vegan_society_trademark_directory",
        status: "registered", scope: "product", matchedBrand: directoryBrand, matchedProduct,
        officialProfileUrl: `https://www.vegansociety.com/search/products/${letter}`,
        current: true, gradeEligible: true, confidence: 0.94
      };
    }
    return null;
  }
  function nonGmoCertificationFromPayload(payload, brand, title, gtins) {
    const requestedBrand = normalizeProductBrand(brand);
    const requestedTitle = cleanValue(title);
    const requestedGtins = [...new Set((Array.isArray(gtins) ? gtins : [gtins]).map(normalizeBarcode).filter(validGtin))];
    const records = payload && Array.isArray(payload.data) ? payload.data : [];
    if (!records.length || (!requestedGtins.length && (!requestedBrand || !requestedTitle))) return null;
    const eligible = records.filter((record) => record && record.verified === true &&
      Array.isArray(record.verifications) && record.verifications.some((item) =>
        cleanValue(item && item.type).toLowerCase() === "nongmo" && cleanValue(item && item.status).toLowerCase() === "verified"));
    const barcodeMatch = requestedGtins.length ? eligible.find((record) => (record.packages || []).some((item) =>
      requestedGtins.some((gtin) => equivalentGtin(gtin, item && item.package_code)))) : null;
    const nameMatch = !barcodeMatch && requestedBrand && requestedTitle ? eligible.find((record) =>
      normalizeProductBrand(record.brand && record.brand.name) === requestedBrand && productTermInText(record.name, requestedTitle)) : null;
    const matched = barcodeMatch || nameMatch;
    if (!matched) return null;
    const matchedGtin = (matched.packages || []).map((item) => normalizeBarcode(item && item.package_code)).find(validGtin) || "";
    return {
      name: "Non-GMO Project Verified", issuer: "Non-GMO Project", sourceId: "non_gmo_project_product_finder",
      status: "verified", scope: "product", matchedBrand: cleanValue(matched.brand && matched.brand.name),
      matchedProduct: cleanValue(matched.name), matchedGtin, officialRecordId: cleanValue(matched.id),
      officialProfileUrl: "https://www.nongmoproject.org/find-non-gmo/",
      current: true, gradeEligible: true, confidence: barcodeMatch ? 0.98 : 0.94
    };
  }
  function greenSealCertificationFromHtml(html, brand, title) {
    const requestedBrand = normalizeProductBrand(brand);
    const requestedTitle = cleanValue(title);
    if (!requestedBrand || !requestedTitle) return null;
    const source = String(html || "");
    const pattern = /<a\s+href=["'](https:\/\/certified\.greenseal\.org\/product\/[^"']+)["'][^>]*>[\s\S]*?<\/a>\s*<\/div>\s*<div[^>]*>[\s\S]*?<a[^>]+href=["']https:\/\/certified\.greenseal\.org\/product\/[^"']+["'][^>]*>([\s\S]*?)<\/a>\s*<br\s*\/?>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
    let match;
    while ((match = pattern.exec(source))) {
      const directoryProduct = decodeHtmlText(match[2]);
      const directoryBrand = decodeHtmlText(match[3]).replace(/[™®]/g, "");
      if (normalizeProductBrand(directoryBrand) !== requestedBrand || !productTermInText(directoryProduct, requestedTitle)) continue;
      return {
        name: "Green Seal Certified", issuer: "Green Seal", sourceId: "green_seal_certified_directory",
        status: "certified", scope: "product", matchedBrand: directoryBrand, matchedProduct: directoryProduct,
        officialProfileUrl: match[1], current: true, gradeEligible: true, confidence: 0.95
      };
    }
    return null;
  }
  function cosmosCertificationFromHtml(html, brand, title) {
    const requestedBrand = normalizeProductBrand(brand);
    const requestedTitle = cleanValue(title);
    if (!requestedBrand || !requestedTitle) return null;
    for (const row of String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((match) => decodeHtmlText(match[1]));
      if (cells.length < 6) continue;
      const [productName, signature, directoryBrand, company, certifier, version] = cells;
      if (!/^(?:ORGANIC|NATURAL)$/i.test(signature) || normalizeProductBrand(directoryBrand) !== requestedBrand || !productTermInText(productName, requestedTitle)) continue;
      const level = signature.toUpperCase();
      return {
        name: `COSMOS ${level}`, issuer: "COSMOS-standard AISBL", sourceId: "cosmos_certified_products",
        status: "certified active", scope: "product", certificationLevel: level,
        matchedBrand: directoryBrand, matchedProduct: productName, certifiedCompany: company,
        certificationBody: certifier, standardVersion: version,
        officialProfileUrl: "https://www.cosmos-standard.org/en/databases/products-directory/",
        current: true, gradeEligible: true, confidence: 0.95
      };
    }
    return null;
  }
  function euEcolabelCertificationFromPayload(payload, gtin) {
    const requestedGtin = normalizeBarcode(gtin);
    if (!validGtin(requestedGtin)) return null;
    const records = payload && Array.isArray(payload.data) ? payload.data : [];
    const now = Date.now();
    const matched = records.find((record) => equivalentGtin(requestedGtin, record && record.ean13) &&
      (!record.expiration_date || Date.parse(record.expiration_date) >= now));
    if (!matched) return null;
    return {
      name: "EU Ecolabel", issuer: "European Commission", sourceId: "eu_ecolabel_product_catalogue",
      status: "certified active", scope: "product", matchedGtin: normalizeBarcode(matched.ean13),
      matchedProduct: cleanValue(matched.product_name), certifiedCompany: cleanValue(matched.licence_holder),
      licenceNumber: cleanValue(matched.licence_number), expirationDate: cleanValue(matched.expiration_date),
      productGroup: cleanValue(matched.group_name), productCategory: cleanValue(matched.group_category_name),
      officialRecordId: cleanValue(matched.item_id),
      officialProfileUrl: "https://environmental-data.ec.europa.eu/ecolabel/index.html",
      current: true, gradeEligible: true, confidence: 0.99
    };
  }
  function epeatCertificationFromHtml(html, brand, title) {
    const requestedBrand = normalizeProductBrand(brand).replace(/\s+(?:inc|llc|ltd|corporation|corp)$/, "");
    const requestedTitle = cleanValue(title);
    if (!requestedBrand || !requestedTitle) return null;
    for (const row of String(html || "").matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 8) continue;
      const link = cells[1].match(/href=["']([^"']*\/product-details\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const directoryProduct = decodeHtmlText(link[2]);
      const manufacturer = decodeHtmlText(cells[2]);
      const normalizedManufacturer = normalizeProductBrand(manufacturer).replace(/\s+(?:inc|llc|ltd|corporation|corp)$/, "");
      const location = decodeHtmlText(cells[4]);
      const tier = decodeHtmlText(cells[5]);
      const status = decodeHtmlText(cells[7]);
      if (normalizedManufacturer !== requestedBrand || !productTermInText(directoryProduct, requestedTitle) || location !== "United States" || status.toLowerCase() !== "active") continue;
      return {
        name: `EPEAT ${tier}`, issuer: "Global Electronics Council", sourceId: "epeat_registry",
        status: "active", tier, scope: "product", matchedBrand: manufacturer, matchedProduct: directoryProduct,
        locationOfUse: location, officialProfileUrl: /^https?:/i.test(link[1]) ? link[1] : `https://www.epeat.net${link[1]}`,
        current: true, gradeEligible: true, confidence: 0.96
      };
    }
    return null;
  }
  function energyStarModelCandidates(value) {
    return [...new Set(cleanValue(value).split(/\s+/).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
      .filter((token) => token.length >= 5 && /[a-z]/i.test(token) && /\d/.test(token)))].slice(0, 4);
  }
  function energyStarCertificationFromPayload(payload, brand, title, gtins) {
    const records = Array.isArray(payload) ? payload : [];
    const requestedBrand = normalizeProductBrand(brand).replace(/\s+(?:inc|llc|ltd|corporation|corp)$/, "");
    const requestedTitle = normalizeMatchValue(title).replace(/\s+/g, "");
    const requestedGtins = [...new Set((Array.isArray(gtins) ? gtins : [gtins]).map(normalizeBarcode).filter(validGtin))];
    for (const record of records) {
      if (!/united states/i.test(cleanValue(record && record.markets))) continue;
      const upcs = cleanValue(record.upc).split(/[;,|\s]+/).map(normalizeBarcode).filter(validGtin);
      const barcodeMatch = requestedGtins.some((gtin) => upcs.some((upc) => equivalentGtin(gtin, upc)));
      const directoryBrand = cleanValue(record.brand_name || record.energy_star_partner);
      const normalizedBrand = normalizeProductBrand(directoryBrand).replace(/\s+(?:inc|llc|ltd|corporation|corp)$/, "");
      const model = cleanValue(record.model_number || record.model_name);
      const modelBase = normalizeMatchValue(model.replace(/[\*#].*$/, "")).replace(/\s+/g, "");
      const modelMatch = requestedBrand && normalizedBrand === requestedBrand && modelBase.length >= 5 && requestedTitle.includes(modelBase);
      if (!barcodeMatch && !modelMatch) continue;
      return {
        name: "ENERGY STAR Certified", issuer: "U.S. Environmental Protection Agency", sourceId: "energy_star_model_index",
        status: "certified", scope: "product", matchedBrand: directoryBrand, matchedProduct: cleanValue(record.model_name || model),
        modelNumber: model, productCategory: cleanValue(record.product_category), energyStarId: cleanValue(record.pd_id),
        mostEfficient: /^yes$/i.test(cleanValue(record.meets_most_efficient_criteria)),
        officialProfileUrl: "https://www.energystar.gov/productfinder/", current: true, gradeEligible: true,
        confidence: barcodeMatch ? 0.98 : 0.96
      };
    }
    return null;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function hash(input) {
    let value = 2166136261;
    for (const char of String(input || "")) {
      value ^= char.charCodeAt(0);
      value += (value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24);
    }
    return value >>> 0;
  }
  function stable(seed, min, max) { return min + (hash(seed) % (max - min + 1)); }
  function presetById(id) { return PRESETS.find((preset) => preset.id === id) || PRESETS[0]; }

  function normalizeWeights(categories) {
    const next = categories.map((item) => ({ ...item, weight: Number(item.weight || 0) }));
    const enabled = next.filter((item) => item.enabled);
    if (!enabled.length) {
      next[0].enabled = true;
      next[0].weight = 100;
      return next;
    }
    const total = enabled.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) {
      const share = Math.floor(100 / enabled.length);
      let left = 100 - share * enabled.length;
      next.forEach((item) => {
        item.weight = item.enabled ? share + (left-- > 0 ? 1 : 0) : 0;
      });
      return next;
    }
    let rounded = 0;
    next.forEach((item) => {
      if (!item.enabled) {
        item.weight = 0;
        return;
      }
      item.weight = Math.round((item.weight / total) * 100);
      rounded += item.weight;
    });
    let diff = 100 - rounded;
    const targets = next.filter((item) => item.enabled);
    for (let i = 0; diff !== 0 && targets.length; i += 1) {
      const item = targets[i % targets.length];
      if (diff > 0) {
        item.weight += 1;
        diff -= 1;
      } else if (item.weight > 0) {
        item.weight -= 1;
        diff += 1;
      }
    }
    return next;
  }

  function createProfile(presetId) {
    const preset = presetById(presetId || "balanced");
    return {
      profileName: "My Values",
      preset: preset.id,
      strictness: preset.strictness,
      missingDataPenalty: preset.missingDataPenalty,
      categories: normalizeWeights(CATEGORY_DEFINITIONS.map(([id, label, detail]) => ({ id, label, detail, enabled: Boolean(preset.weights[id]), weight: preset.weights[id] || 0 }))),
      dealbreakers: DEALBREAKER_DEFINITIONS.map(([id, label, detail, defaultSeverity]) => ({ id, label, detail, enabled: Boolean(preset.dealbreakers[id]), severity: preset.dealbreakers[id] || defaultSeverity, value: id === "max_price" ? 50 : "", terms: "" })),
      setupComplete: false,
      updatedAt: new Date().toISOString()
    };
  }

  function mergeProfile(profile) {
    if (!profile || typeof profile !== "object") return createProfile("balanced");
    const base = createProfile(profile.preset || "balanced");
    return {
      ...base,
      ...profile,
      categories: normalizeWeights(CATEGORY_DEFINITIONS.map(([id, label, detail]) => {
        const existing = (profile.categories || []).find((item) => item.id === id);
        const fallback = base.categories.find((item) => item.id === id);
        return { ...fallback, ...existing, id, label, detail };
      })),
      dealbreakers: DEALBREAKER_DEFINITIONS.map(([id, label, detail, defaultSeverity]) => {
        const existing = (profile.dealbreakers || []).find((item) => item.id === id);
        const fallback = base.dealbreakers.find((item) => item.id === id);
        return { ...fallback, ...existing, id, label, detail, severity: (existing && existing.severity) || (fallback && fallback.severity) || defaultSeverity };
      })
    };
  }

  function evidenceText(value) {
    if (Array.isArray(value)) return value.map(cleanValue).filter(Boolean).join(" ");
    if (typeof value === "number") return String(value);
    return cleanValue(value);
  }
  function certificationText(value) {
    if (!value || typeof value !== "object") return cleanValue(value);
    const name = value.name || value.label || value.certification || value.type;
    const issuer = value.issuer || value.authority;
    const status = value.status;
    const scope = value.scope === "company" ? "company-level" : value.scope === "product" ? "product-specific" : value.scope;
    const matchedBrand = value.matchedBrand;
    return [name, value.certificationLevel ? `level: ${value.certificationLevel}` : "", value.standardVersion ? `version: ${value.standardVersion}` : "", matchedBrand ? `matched company: ${matchedBrand}` : "", scope ? `scope: ${scope}` : "", issuer ? `issuer: ${issuer}` : "", status ? `status: ${status}` : ""].filter(Boolean).join(" | ");
  }
  function verifiedCertificationText(product, facts) {
    const item = product || {};
    const sourceFacts = facts || {};
    const values = item.verifiedCertifications || sourceFacts.verifiedCertifications || [];
    if (Array.isArray(values)) return values.map(certificationText).filter(Boolean).join(" ");
    return certificationText(values);
  }
  function gradeEligibleCertificationText(product, facts) {
    const item = product || {};
    const sourceFacts = facts || {};
    const values = item.verifiedCertifications || sourceFacts.verifiedCertifications || [];
    if (!Array.isArray(values)) return "";
    return values.filter((certification) => certification && certification.gradeEligible !== false && certification.current !== false).map(certificationText).filter(Boolean).join(" ");
  }
  function adverseListing(product, adverseType) {
    const facts = (product || {}).facts || {};
    const values = (product || {}).verifiedCertifications || facts.verifiedCertifications || [];
    return Array.isArray(values) ? values.find((item) => item && item.current !== false && item.adverse === true && (!adverseType || item.adverseType === adverseType)) : null;
  }
  function normalizeMatchValue(value) {
    return cleanValue(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(?:salame|salumi)\b/g, "salami").replace(/\bn\b/g, "and").replace(/\s+/g, " ").trim();
  }
  function aliasInText(alias, text) {
    const normalizedAlias = normalizeMatchValue(alias);
    const normalizedText = normalizeMatchValue(text);
    if (!normalizedAlias || !normalizedText || normalizedAlias.length < 5) return false;
    return ` ${normalizedText} `.includes(` ${normalizedAlias} `);
  }
  const productMatchStopWords = new Set(["and", "with", "made", "the", "for", "from", "raised", "handled", "uncured", "italian"]);
  function productTermInText(term, text) {
    if (aliasInText(term, text)) return true;
    const normalizedTerm = normalizeMatchValue(term);
    const normalizedTextTokens = new Set(normalizeMatchValue(text).split(" "));
    if (/^[a-z0-9]{3,}$/.test(normalizedTerm)) return normalizedTextTokens.has(normalizedTerm);
    const termTokens = [...new Set(normalizedTerm.split(" ").filter((token) => token.length >= 4 && !productMatchStopWords.has(token)))];
    if (termTokens.length < 4) return false;
    const matched = termTokens.filter((token) => normalizedTextTokens.has(token)).length;
    return matched >= 3 && matched / termTokens.length >= 0.6;
  }
  const usdaMerchandiseTerms = new Set(["mug", "cup", "towel", "shirt", "hoodie", "toy", "book", "poster", "sticker", "case", "cover", "candle", "machine", "maker", "filter", "holder"]);
  function usdaScopeConflict(certification, title) {
    if (certification.sourceId !== "usda_organic_integrity") return false;
    const titleTokens = normalizeMatchValue(title).split(" ");
    const merchandise = titleTokens.filter((token) => usdaMerchandiseTerms.has(token));
    if (!merchandise.length) return false;
    const scopeText = normalizeMatchValue([...(certification.productNames || []), ...(certification.matchTerms || [])].join(" "));
    const scopeTokens = new Set(scopeText.split(" "));
    return merchandise.some((token) => !scopeTokens.has(token));
  }
  function normalizeProductBrand(value) {
    return normalizeMatchValue(value)
      .replace(/^(?:brand|by)\s+/, "")
      .replace(/^visit the /, "")
      .replace(/ store$/, "")
      .trim();
  }
  const compactCertificationIndexCache = new WeakMap();
  const certificationIndexStopWords = new Set(["company", "corporation", "corp", "incorporated", "limited", "group", "global", "international", "holdings", "products", "services"]);
  function expandCompactCertificationRecord(database, record) {
    return {
      id: record[0],
      brand: record[1],
      aliases: record[2] || [],
      certifications: (record[3] || []).map((certification) => {
        const provider = database.providers[certification[0]] || {};
        return {
          name: certification[11] || provider.name,
          issuer: provider.issuer,
          sourceType: provider.sourceType,
          sourceId: certification[0],
          status: certification[1],
          scope: certification[2],
          sourceUrl: certification[3],
          officialProfileUrl: certification[3],
          confidence: certification[4],
          current: Boolean(certification[5]),
          gradeEligible: Boolean(certification[6]),
          productNames: certification[7] || [],
          matchTerms: certification[8] || [],
          productRules: certification[9] || [],
          ...(certification[10] || {})
        };
      })
    };
  }
  function compactCertificationIndex(database) {
    let index = compactCertificationIndexCache.get(database);
    if (index) return index;
    const byAlias = new Map();
    const byToken = new Map();
    const byGtin = new Map();
    database.records.forEach((record) => {
      [record[1], ...(record[2] || [])].forEach((alias) => {
        const value = normalizeMatchValue(alias);
        if (!value) return;
        if (!byAlias.has(value)) byAlias.set(value, []);
        byAlias.get(value).push(record);
        value.split(" ").filter((token) => token.length >= 4 && !certificationIndexStopWords.has(token)).forEach((token) => {
          if (!byToken.has(token)) byToken.set(token, []);
          byToken.get(token).push(record);
        });
      });
      (record[3] || []).forEach((certification) => {
        ((certification[10] || {}).gtins || []).map(normalizeBarcode).filter(validGtin).forEach((gtin) => {
          if (!byGtin.has(gtin)) byGtin.set(gtin, []);
          byGtin.get(gtin).push(record);
        });
      });
    });
    index = { byAlias, byToken, byGtin };
    compactCertificationIndexCache.set(database, index);
    return index;
  }
  function certificationRecords(database, brand, searchableText, gtins) {
    if (!database || !Array.isArray(database.records)) return [];
    if (!database.providers) return database.records;
    const index = compactCertificationIndex(database);
    const candidates = new Set(index.byAlias.get(brand) || []);
    (gtins || []).forEach((gtin) => (index.byGtin.get(gtin) || []).forEach((record) => candidates.add(record)));
    normalizeMatchValue(searchableText).split(" ").filter((token) => token.length >= 4 && !certificationIndexStopWords.has(token)).forEach((token) => {
      (index.byToken.get(token) || []).forEach((record) => candidates.add(record));
    });
    return [...candidates].map((record) => expandCompactCertificationRecord(database, record));
  }
  function findCertificationMatches(product, database) {
    const item = product || {};
    const facts = item.facts || {};
    const brand = normalizeProductBrand(item.brand || facts.brand);
    const seller = normalizeProductBrand(item.seller || facts.seller);
    const normalizedTitle = normalizeMatchValue(item.title || facts.title);
    const requestedGtins = [...new Set([item.gtin, facts.gtin, item.barcode, facts.barcode].flat().map(normalizeBarcode).filter(validGtin))];
    // Certification identity must come only from fields scoped to this product.
    // Full-page and ingredient text can contain recommendations, comparisons, and reviews for unrelated brands.
    const searchableText = [
      item.title, facts.title, item.brand, facts.brand, item.seller, facts.seller,
      item.category, facts.category, item.productBullets, facts.productBullets,
      item.cardText, facts.cardText
    ].flat().filter(Boolean).join(" ");
    const matches = [];
    const seenMatches = new Set();
    certificationRecords(database, brand, searchableText, requestedGtins).forEach((record) => {
      const aliases = [record.brand, ...(record.aliases || [])].filter(Boolean);
      const brandMatch = brand && aliases.some((alias) => normalizeMatchValue(alias) === brand);
      const sellerMatch = seller && aliases.some((alias) => normalizeMatchValue(alias) === seller);
      // A title prefix is only an identity fallback when the page has no explicit brand.
      // Otherwise marketplace titles could transfer certification to a different brand.
      const titlePrefixMatch = !brand && aliases.some((alias) => {
        const normalizedAlias = normalizeMatchValue(alias);
        return normalizedAlias.length >= 5 && (normalizedTitle === normalizedAlias || normalizedTitle.startsWith(`${normalizedAlias} `));
      });
      (record.certifications || []).forEach((certification) => {
        const barcodeMatch = requestedGtins.some((gtin) => (certification.gtins || []).map(normalizeBarcode).some((certifiedGtin) => equivalentGtin(gtin, certifiedGtin)));
        if (!brandMatch && !sellerMatch && !titlePrefixMatch && !barcodeMatch) return;
        const productNames = certification.productNames || [];
        const matchTerms = certification.matchTerms || [];
        const productRules = certification.productRules || [];
        if (certification.sourceId === "gots_certified_suppliers") {
          const explicitGotsClaim = /\b(?:gots|global organic textile standard)\b/i.test([
            item.title, facts.title, item.productBullets, facts.productBullets,
            item.productDescription, facts.productDescription, item.cardText, facts.cardText,
            ...(item.pageClaims || facts.pageClaims || []).map((claim) => claim && (claim.exactText || claim.label))
          ].flat().filter(Boolean).join(" "));
          if (!explicitGotsClaim) return;
        }
        if (usdaScopeConflict(certification, item.title || facts.title)) return;
        if (certification.scope === "product" && !barcodeMatch && !productNames.some((name) => productTermInText(name, searchableText))) return;
        if (matchTerms.length && !barcodeMatch && !matchTerms.some((term) => productTermInText(term, searchableText))) return;
        if (productRules.length && !productRules.some((rule) => {
          const ruleBrands = rule.brands || [];
          const ruleTerms = rule.terms || [];
          const ruleBrandMatch = ruleBrands.some((ruleBrand) => normalizeMatchValue(ruleBrand) === brand || aliasInText(ruleBrand, searchableText));
          return ruleBrandMatch && ruleTerms.some((term) => productTermInText(term, searchableText));
        })) return;
        const matchKey = [certification.issuer, certification.name, certification.officialProfileUrl || certification.sourceUrl || record.id].map(normalizeMatchValue).join("|");
        if (seenMatches.has(matchKey)) return;
        seenMatches.add(matchKey);
        matches.push({
          ...certification,
          matchedBrand: record.brand,
          databaseId: record.id,
          matchType: barcodeMatch ? "barcode" : brandMatch ? "brand" : sellerMatch ? "seller" : "title_prefix"
        });
      });
    });
    return matches;
  }
  function normalizeBarcode(value) {
    return String(value || "").replace(/\D/g, "");
  }
  function identifiersFromText(value) {
    const text = String(value || "");
    const values = [];
    const labeled = /\b(?:UPC|EAN|GTIN(?:-?(?:8|12|13|14))?|Global\s+Trade\s+Identification\s+Number)\s*(?::|#|No\.?|Number)?\s*([0-9][0-9 -]{6,20}[0-9])\b/gi;
    let match;
    while ((match = labeled.exec(text))) values.push(normalizeBarcode(match[1]));
    return [...new Set(values.filter(Boolean))];
  }
  function validGtin(value) {
    const code = normalizeBarcode(value);
    if (![8, 12, 13, 14].includes(code.length)) return false;
    const digits = [...code].map(Number);
    const check = digits.pop();
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  function equivalentGtin(left, right) {
    const a = normalizeBarcode(left);
    const b = normalizeBarcode(right);
    if (!validGtin(a) || !validGtin(b)) return false;
    return a === b || a.replace(/^0+/, "") === b.replace(/^0+/, "");
  }
  function resolveProductByIdentifiers(identifiers, database) {
    const codes = [...new Set((identifiers || []).map(normalizeBarcode).filter(validGtin))];
    const products = database && Array.isArray(database.products) ? database.products : [];
    const matches = products.filter((product) => codes.some((code) => equivalentGtin(code, product.barcode)));
    if (matches.length !== 1) return { status: matches.length ? "ambiguous" : "not_found", identifiers: codes, product: null, confidence: 0 };
    return { status: "matched", identifiers: codes, product: matches[0], confidence: 0.98, method: "page_gtin_exact" };
  }
  function attachFoodProduct(product, resolution) {
    if (!product || !resolution || resolution.status !== "matched" || !resolution.product) return product;
    const matched = resolution.product;
    const food = matched.facts || {};
    const identityMatch = `${matched.name} (${resolution.method}, ${Math.round(resolution.confidence * 100)}% confidence)`;
    const additions = {
      gtin: matched.barcode,
      identityMatch,
      ingredientsText: food.ingredients_text,
      allergens: food.allergens,
      nutrition: food.nutriments || [food.nutriscore_grade ? `Nutri-Score ${food.nutriscore_grade}` : "", food.nova_group ? `NOVA ${food.nova_group}` : ""].filter(Boolean),
      foodLabels: food.labels,
      packaging: food.packaging,
      foodSourceUrl: matched.sourceUrl,
      foodFactSource: "open_food_facts",
      foodFactConfidence: resolution.confidence
    };
    Object.assign(product, additions);
    product.facts = { ...(product.facts || {}), ...additions };
    product.sourceEvidence = (product.sourceEvidence || []).concat({
      provider: "open_food_facts_provider", field: "foodSourceUrl", label: "Open Food Facts record",
      value: matched.sourceUrl, text: matched.sourceUrl, source: "open_food_facts", confidence: resolution.confidence, searchable: false
    });
    return product;
  }
  function productFromOpenFoodFacts(payload, requestedCode) {
    const product = payload && payload.product;
    const code = normalizeBarcode(product && (product.code || requestedCode));
    if (!product || !equivalentGtin(code, requestedCode)) return null;
    return {
      id: `gtin:${code}`,
      barcode: code,
      name: cleanValue(product.product_name) || `Product ${code}`,
      sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
      capturedAt: new Date().toISOString(),
      facts: {
        brand: product.brands,
        ingredients_text: product.ingredients_text,
        allergens: product.allergens_tags || [],
        traces: product.traces_tags || [],
        labels: product.labels_tags || [],
        categories: product.categories_tags || [],
        nutriments: product.nutriments || {},
        nutriscore_grade: product.nutriscore_grade,
        nova_group: product.nova_group,
        environmental_score_grade: product.environmental_score_grade || product.ecoscore_grade,
        packaging: product.packagings || product.packaging
      }
    };
  }
  function extractAmazonFoodFacts(rawText) {
    const raw = String(rawText || "");
    const section = (start, ends, limit) => {
      const startMatch = raw.match(start);
      if (!startMatch) return "";
      const rest = raw.slice(startMatch.index + startMatch[0].length);
      let end = rest.length;
      ends.forEach((pattern) => { const match = rest.match(pattern); if (match && match.index < end) end = match.index; });
      return cleanValue(rest.slice(0, Math.min(end, limit || 1400)));
    };
    const ingredientsText = section(/(?:^|\n)Ingredients\s*(?:\n|$)/i, [/(?:^|\n)(?:Product details|About this item|Directions|Legal Disclaimer|Safety Information)\s*(?:\n|$)/i], 1400);
    const nutrition = section(/(?:^|\n)Nutrition facts\s*(?:\n|$)/i, [/(?:^|\n)Ingredients\s*(?:\n|$)/i], 1200);
    const allergenMatch = raw.match(/(?:^|\n)Allergen Information\s*(?:\n|:)?\s*([^\n]+)/i);
    const dietMatch = raw.match(/(?:^|\n)Diet type\s*(?:\n|:)?\s*([^\n]+)/i);
    const foodLabels = [];
    if (dietMatch) foodLabels.push(cleanValue(dietMatch[1]));
    if (/Allergen Information\s+(?:\n|:)?\s*Gluten Free/i.test(raw)) foodLabels.push("Gluten Free");
    return { ingredientsText, allergens: allergenMatch ? [cleanValue(allergenMatch[1])] : [], nutrition, foodLabels: [...new Set(foodLabels.filter(Boolean))] };
  }
  function defaultEvidenceSource(product, facts) {
    if (product && product.id) return "sample_product";
    if (facts.pageType === "detail") return "amazon_product_page";
    if (facts.pageType === "search") return "amazon_search_card";
    return "page_facts";
  }
  function defaultEvidenceConfidence(product, facts) {
    if (product && product.id) return 0.45;
    if (facts.pageType === "detail") return 0.74;
    if (facts.pageType === "search") return 0.56;
    return 0.4;
  }
  function normalizeEvidenceRecord(record, index) {
    if (!record || typeof record !== "object") return null;
    const field = record.field || "text";
    const text = evidenceText(record.text || record.value);
    if (!text) return null;
    const searchable = record.searchable !== undefined ? Boolean(record.searchable) : !IDENTITY_EVIDENCE_FIELDS.includes(field);
    return {
      schemaVersion: record.schemaVersion || EVIDENCE_SCHEMA_VERSION,
      id: record.id || `ev:${hash(`${record.source || "unknown"}:${field}:${text}:${index || 0}`)}`,
      provider: record.provider || "",
      field,
      label: record.label || field,
      value: record.value === undefined ? text : record.value,
      text,
      source: record.source || "unknown",
      confidence: clamp(Number(record.confidence || 0.4), 0, 1),
      searchable
    };
  }
  function addEvidence(records, product, provider, definition) {
    const item = product || {};
    const facts = item.facts || {};
    const value = typeof definition.value === "function" ? definition.value(item, facts) : definition.value;
    const text = evidenceText(value);
    if (!text) return;
    const source = typeof provider.source === "function" ? provider.source(item, facts) : provider.source || provider.id;
    const confidence = typeof provider.confidence === "function" ? Number(provider.confidence(item, facts)) : Number(provider.confidence || 0.4);
    const label = typeof definition.label === "function" ? definition.label(item, facts) : definition.label;
    records.push(normalizeEvidenceRecord({
      provider: provider.id,
      field: definition.field,
      label,
      value,
      text,
      source,
      confidence,
      searchable: definition.searchable
    }, records.length));
  }
  function addProviderEvidence(records, product, provider) {
    (provider.fields || []).forEach((definition) => addEvidence(records, product, provider, definition));
  }
  function getProductEvidence(product) {
    const item = product || {};
    const records = [];
    (Array.isArray(item.sourceEvidence) ? item.sourceEvidence : []).forEach((record) => {
      const normalized = normalizeEvidenceRecord(record, records.length);
      if (normalized) records.push(normalized);
    });
    FACT_PROVIDERS.forEach((provider) => addProviderEvidence(records, item, provider));
    return records;
  }
  function providerMetadata() {
    return FACT_PROVIDERS.map((provider) => ({ id: provider.id, label: provider.label, description: provider.description }));
  }
  function addSourceField(fields, source, value) {
    const text = evidenceText(value);
    if (text) fields.push({ source, text, lower: text.toLowerCase() });
  }
  function sourceFields(product) {
    const item = product || {};
    const facts = item.facts || {};
    const fields = [];
    addSourceField(fields, "title", item.title || facts.title);
    addSourceField(fields, "brand", item.brand || facts.brand);
    addSourceField(fields, "seller", item.seller || facts.seller);
    addSourceField(fields, "category", item.category || facts.category);
    addSourceField(fields, "product bullets", item.productBullets || facts.productBullets);
    addSourceField(fields, "certification text", item.certifications || facts.certifications);
    addSourceField(fields, "verified certifications", verifiedCertificationText(item, facts));
    addSourceField(fields, "ingredients", item.ingredientsText || facts.ingredientsText);
    addSourceField(fields, "allergens", item.allergens || facts.allergens);
    addSourceField(fields, "nutrition", item.nutrition || facts.nutrition);
    addSourceField(fields, "packaging", item.packaging || facts.packaging);
    addSourceField(fields, "price", item.priceText || facts.priceText);
    addSourceField(fields, item.id ? "sample text" : "page text", item.text || facts.pageText || facts.cardText);
    return fields;
  }
  function parsePrice(product) {
    const facts = (product && product.facts) || {};
    if (product && typeof product.price === "number") return product.price;
    if (typeof facts.price === "number") return facts.price;
    const text = [product && product.priceText, facts.priceText, product && product.text, facts.pageText, facts.cardText].filter(Boolean).join(" ");
    const match = text.replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
    return match ? Number(match[1]) : null;
  }
  function orderedFields(product, preferredSources) {
    const fields = sourceFields(product);
    if (!preferredSources || !preferredSources.length) return fields;
    return fields.filter((field) => preferredSources.includes(field.source));
  }
  function fieldMatch(product, pattern, preferredSources) {
    for (const field of orderedFields(product, preferredSources)) {
      const match = field.lower.match(pattern);
      if (match) return { match: match[0], source: field.source };
    }
    return null;
  }
  function termHit(product, terms) {
    for (const field of sourceFields(product)) {
      const match = terms.find((term) => field.lower.includes(term));
      if (match) return { match, source: field.source };
    }
    return null;
  }
  function hasSource(product, sources) {
    return sourceFields(product).some((field) => sources.includes(field.source));
  }
  function evidenceItem(category, type, label, impact, source, match) {
    const categoryLabel = category.label || category.id || "Product";
    return {
      id: `${category.id || "product"}:${type}:${hash(`${label}:${match || ""}`)}`,
      category: category.id || "product",
      categoryLabel,
      type,
      label,
      impact,
      source,
      match: match || "",
      display: `${categoryLabel}: ${label}`
    };
  }
  function displayEvidence(item) {
    return item.display || `${item.categoryLabel || item.category}: ${item.label}`;
  }

  function dealbreakerViolations(product, profile) {
    return profile.dealbreakers.filter((item) => item.enabled).map((item) => {
      if (item.id === "max_price") {
        const price = parsePrice(product);
        const limit = Number(item.value || 50);
        return price !== null && price > limit ? { ...item, reason: `$${price.toFixed(2)} is above $${limit.toFixed(2)}`, source: "price", match: `$${price.toFixed(2)}` } : null;
      }
      if (item.id === "blocked_terms") {
        const hit = termHit(product, String(item.terms || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
        return hit ? { ...item, reason: `Matches blocked term "${hit.match}"`, source: hit.source, match: hit.match } : null;
      }
      if (item.id === "gluten") {
        const facts = product.facts || {};
        const ingredients = evidenceText(product.ingredientsText || facts.ingredientsText).toLowerCase();
        const allergens = evidenceText(product.allergens || facts.allergens).toLowerCase();
        const ingredientTerms = ["wheat", "barley", "rye", "malt extract", "breadstick", "bread", "pasta", "cracker", "cookie"];
        const ingredientMatch = ingredientTerms.find((term) => ingredients.includes(term) || allergens.includes(term));
        if (ingredientMatch) return { ...item, reason: `Ingredients or allergens include "${ingredientMatch}"`, source: ingredients.includes(ingredientMatch) ? "ingredients" : "allergens", match: ingredientMatch };
        const labels = evidenceText(product.foodLabels || (product.facts || {}).foodLabels).toLowerCase();
        if (/no[- ]gluten|gluten[- ]free/.test(labels)) return null;
      }
      if (item.id === "animal_testing") {
        const listing = adverseListing(product, "animal_testing");
        if (listing) return { ...item, reason: `${listing.issuer || "PETA"} lists ${listing.matchedBrand || "this company"} as a company that tests on animals`, source: listing.officialProfileUrl || listing.sourceUrl || "PETA directory", match: listing.matchedBrand || listing.name };
      }
      const hit = termHit(product, keywordSets[item.id] || []);
      return hit ? { ...item, reason: `${hit.source} includes "${hit.match}"`, source: hit.source, match: hit.match } : null;
    }).filter(Boolean);
  }

  function categoryScore(product, category) {
    let score = 70;
    const evidence = [];
    let reason = "Insufficient sourced evidence";
    let missing = false;
    const add = (type, label, impact, source, match) => {
      score += impact;
      evidence.push(evidenceItem(category, type, label, impact, source, match));
      reason = label;
    };
    const addMissing = (label, source) => {
      missing = true;
      evidence.push(evidenceItem(category, "missing", label, 0, source, ""));
      reason = label;
    };

    if (category.id === "environment") {
      const verifiedBetter = fieldMatch(product, /(rainforest alliance|marine stewardship council|msc[- ]certified|forest stewardship council|fsc (?:100%|mix|recycled|certified)|pefc[- ]certified|responsible (?:wool|mohair|alpaca) standard|r(?:w|m|a)s[- ]certified|zq merino|zq[- ]certified|organic content standard|ocs[- ]certified|eu organic|eu ecolabel|blue angel|blauer engel|nordic swan|svanem[aä]rket|usda certified biobased product|watersense|soil association organic|ok compost|seedling compostable|certified compostable en 13432|scs recycled content|recycled content certified|green seal|safer choice|energy star|epeat (?:gold|silver|bronze)|tco certified|oeko[- ]?tex (?:made in green|organic cotton)|bluesign product|bluepass consumer product|cosmos (?:organic|natural)|the climate label|climate neutral certified|carbonneutral(?:®)? product|certified regenerative by agw|upcycled certified|global recycled standard|grs[- ]certified|recycled claim standard|rcs[- ]certified|aquaculture stewardship council|asc[- ]certified|fair for life)/, ["verified certifications"]);
      const verifiedLimited = fieldMatch(product, /(rspo[- ]certified|certified sustainable palm oil|iscc plus)/, ["verified certifications"]);
      const materialBetter = fieldMatch(product, /(recycled|refill|reusable|compostable|organic|local|climate pledge friendly)/, ["packaging", "product bullets", "title", "page text"]);
      const better = verifiedBetter || materialBetter;
      const concern = fieldMatch(product, /(plastic|disposable|single-use|single use|imported)/, ["packaging", "product bullets", "title", "category", "page text"]);
      if (better) add("positive", "Better environmental signal", 14, better.source, better.match);
      if (verifiedLimited) add("positive", "Limited certified supply-chain signal", 7, verifiedLimited.source, verifiedLimited.match);
      if (concern) add("watch", "Waste or transport concern", -20, concern.source, concern.match);
    }
    if (category.id === "animals") {
      const verifiedBetter = fieldMatch(product, /(certified humane|humane farm animal care|animal welfare approved|certified grassfed by agw|vegan trademark|vegan society|peta animal test-free(?: and vegan)?|peta[- ]approved vegan|aquaculture stewardship council|asc[- ]certified)/, ["verified certifications"]);
      const productFit = fieldMatch(product, /(vegan|plant-based|plant based)/, ["ingredients", "product bullets", "title", "page text"]);
      const better = verifiedBetter || productFit;
      const concern = fieldMatch(product, /(leather|wool|silk|milk|dairy|egg|beef|pork|chicken|fish|honey|gelatin)/, ["ingredients", "allergens", "title", "product bullets", "category", "page text"]);
      const testingConcern = adverseListing(product, "animal_testing");
      if (better) add("positive", "Clearer animal welfare fit", 18, better.source, better.match);
      const verifiedFiber = fieldMatch(product, /(responsible (?:wool|down|mohair|alpaca) standard|r(?:w|d|m|a)s[- ]certified|zq merino|zq[- ]certified)/, ["verified certifications"]);
      if (verifiedFiber) add("positive", "Limited animal-fiber welfare signal", 8, verifiedFiber.source, verifiedFiber.match);
      if (concern) add("watch", "Animal product detected", -32, concern.source, concern.match);
      if (testingConcern) add("watch", "Company appears in PETA's animal-testing directory", -45, testingConcern.officialProfileUrl || testingConcern.sourceUrl || "PETA directory", testingConcern.matchedBrand || testingConcern.name);
    }
    if (category.id === "labor") {
      const verifiedBetter = fieldMatch(product, /(fair trade|fairtrade|fair for life|b corp|goodweave|tco certified|oeko[- ]?tex made in green|bluesign product|bluepass consumer product|global recycled standard|grs[- ]certified|aquaculture stewardship council|asc[- ]certified)/, ["verified certifications"]);
      const ownershipBetter = fieldMatch(product, /(worker-owned|worker owned|union)/, ["product bullets", "seller", "brand", "page text"]);
      const better = verifiedBetter || ownershipBetter;
      const concern = fieldMatch(product, /(ultra cheap|fast fashion|imported)/, ["title", "product bullets", "seller", "page text"]);
      if (better) add("positive", "Stronger labor signal", 18, better.source, better.match);
      if (concern) add("watch", "Labor risk needs review", -10, concern.source, concern.match);
    }
    if (category.id === "health") {
      const verifiedOeko = fieldMatch(product, /(oeko[- ]?tex|standard 100|made in green|leather standard|ewg verified|green seal|safer choice|tco certified|bluesign product|bluepass consumer product|cosmos (?:organic|natural)|eu organic|soil association organic)/, ["verified certifications"]);
      const nutritionBetter = fieldMatch(product, /(organic|low sugar|high protein|whole grain|unsweetened)/, ["nutrition", "ingredients", "verified certifications", "product bullets", "title", "certification text", "page text"]);
      const better = verifiedOeko || nutritionBetter;
      const concern = fieldMatch(product, /(added sugars?|sugar|cookie|candy|soda|fried|high sodium)/, ["nutrition", "ingredients", "title", "product bullets", "category", "page text"]);
      if (better) add("positive", "Better nutrition fit", 10, better.source, better.match);
      if (concern) add("watch", "Nutrition goal concern", -17, concern.source, concern.match);
    }
    if (category.id === "price") {
      const price = parsePrice(product);
      if (price === null) addMissing("Price not visible", "page scrape");
      else if (price <= 8) { score = 88; evidence.push(evidenceItem(category, "positive", "Low visible price", 8, "visible price", `$${price.toFixed(2)}`)); reason = "Low visible price"; }
      else if (price <= 25) { score = 77; evidence.push(evidenceItem(category, "positive", "Moderate visible price", 3, "visible price", `$${price.toFixed(2)}`)); reason = "Moderate visible price"; }
      else if (price <= 60) { score = 65; evidence.push(evidenceItem(category, "watch", "Higher visible price", -7, "visible price", `$${price.toFixed(2)}`)); reason = "Higher visible price"; }
      else { score = 50; evidence.push(evidenceItem(category, "watch", "Expensive visible price", -18, "visible price", `$${price.toFixed(2)}`)); reason = "Expensive visible price"; }
    }
    if (category.id === "small_business") {
      const better = fieldMatch(product, /(small business|handmade|local|family-owned|family owned)/, ["seller", "brand", "product bullets", "title", "page text"]);
      const concern = fieldMatch(product, /(amazon basics|mass market|big box)/, ["brand", "seller", "title", "page text"]);
      if (better) add("positive", "Small or local signal", 20, better.source, better.match);
      if (concern) add("watch", "Large-brand signal", -18, concern.source, concern.match);
    }
    if (category.id === "transparency") {
      const better = fieldMatch(product, /(fair trade|fairtrade|fair for life|b corp|goodweave|rainforest alliance|marine stewardship council|msc[- ]certified|aquaculture stewardship council|asc[- ]certified|forest stewardship council|fsc (?:100%|mix|recycled|certified)|pefc[- ]certified|responsible (?:wool|down|mohair|alpaca) standard|r(?:w|d|m|a)s[- ]certified|zq merino|zq[- ]certified|organic content standard|ocs[- ]certified|eu organic|eu ecolabel|soil association organic|rspo[- ]certified|certified sustainable palm oil|iscc plus|ok compost|seedling compostable|certified compostable en 13432|scs recycled content|recycled content certified|green seal|safer choice|energy star|epeat (?:gold|silver|bronze)|tco certified|ewg verified|bluesign product|bluepass consumer product|cosmos (?:organic|natural)|the climate label|climate neutral certified|carbonneutral(?:®)? product|vegan trademark|peta animal test-free(?: and vegan)?|peta[- ]approved vegan|upcycled certified|global recycled standard|grs[- ]certified|recycled claim standard|rcs[- ]certified|non[- ]?gmo project verified|certified (?:animal welfare approved|grassfed|non[- ]?gmo|regenerative) by agw|certified humane|certified|usda organic|cruelty-free|cruelty free|climate pledge friendly)/, ["verified certifications"]);
      if (better) add("positive", "Certification signal", 20, better.source, better.match);
    }
    if (!evidence.length) addMissing("No sourced evidence for this category", "missing structured facts");
    const available = evidence.some((item) => item.type === "positive" || item.type === "watch");
    return { id: category.id, label: category.label, weight: category.weight, score: available ? clamp(Math.round(score), 0, 100) : null, reason, missing: !available || missing, available, evidence };
  }

  function scoreToGrade(score) {
    if (score >= 97) return "A+";
    if (score >= 93) return "A";
    if (score >= 90) return "A-";
    if (score >= 87) return "B+";
    if (score >= 83) return "B";
    if (score >= 80) return "B-";
    if (score >= 77) return "C+";
    if (score >= 73) return "C";
    if (score >= 70) return "C-";
    if (score >= 67) return "D+";
    if (score >= 63) return "D";
    if (score >= 60) return "D-";
    return "F";
  }
  function toneForGrade(grade) {
    if (grade === "N/A") return "neutral";
    if (grade === "Avoid") return "avoid";
    if (/^A/.test(grade)) return "excellent";
    if (/^B/.test(grade)) return "good";
    if (/^C/.test(grade)) return "mixed";
    if (/^D/.test(grade)) return "weak";
    return "bad";
  }
  function dealbreakerEvidence(violation) {
    const impact = violation.severity === "avoid" ? -100 : violation.severity === "cap" ? -24 : -8;
    return evidenceItem({ id: "dealbreakers", label: violation.label }, "watch", violation.reason, impact, violation.source || (violation.id === "max_price" ? "price" : "user rule"), violation.match || violation.id);
  }
  function gradeProduct(product, rawProfile) {
    const profile = mergeProfile(rawProfile);
    const sourceEvidence = getProductEvidence(product || {});
    const enabled = profile.categories.filter((item) => item.enabled && item.weight > 0);
    const categoryResults = enabled.map((item) => categoryScore(product || {}, item));
    const violations = dealbreakerViolations(product || {}, profile);
    const warningCount = violations.filter((item) => item.severity === "warning").length;
    const capCount = violations.filter((item) => item.severity === "cap").length;
    const avoidCount = violations.filter((item) => item.severity === "avoid").length;
    const totalWeight = enabled.reduce((sum, item) => sum + item.weight, 0) || 1;
    const availableResults = categoryResults.filter((item) => item.available && Number.isFinite(item.score));
    const availableWeight = availableResults.reduce((sum, item) => sum + item.weight, 0);
    const coverage = clamp(Math.round((availableWeight / totalWeight) * 100), 0, 100);
    const minimumCoverage = { light: 25, medium: 40, strong: 60 }[profile.missingDataPenalty] || 40;
    const strict = profile.strictness === "strict" ? -5 : profile.strictness === "gentle" ? 4 : 0;
    let score = availableWeight ? availableResults.reduce((sum, item) => sum + item.score * (item.weight / availableWeight), 0) + strict - warningCount * 4 : null;
    if (score !== null && capCount) score = Math.min(score, 76);
    if (score !== null) score = clamp(Math.round(score), 0, 100);
    let grade = score !== null && coverage >= minimumCoverage ? scoreToGrade(score) : "N/A";
    if (grade === "N/A") score = null;
    if (avoidCount) { grade = "Avoid"; score = 0; }
    const evidenceConfidences = sourceEvidence.filter((item) => item.searchable).map((item) => Number(item.confidence)).filter(Number.isFinite);
    const averageEvidenceConfidence = evidenceConfidences.length ? evidenceConfidences.reduce((sum, value) => sum + value, 0) / evidenceConfidences.length : 0;
    const confidenceScore = clamp(Math.round(coverage * 0.7 + averageEvidenceConfidence * 100 * 0.3 - violations.length * 3), 5, 98);
    const confidence = confidenceScore >= 76 ? "High" : confidenceScore >= 48 ? "Medium" : "Low";
    const status = grade === "N/A" ? "insufficient_data" : coverage < 90 ? "provisional" : "supported";
    const categoryEvidence = categoryResults.flatMap((item) => item.evidence || []);
    const evidence = {
      positive: categoryEvidence.filter((item) => item.type === "positive").sort((a, b) => b.impact - a.impact),
      watch: violations.map(dealbreakerEvidence).concat(categoryEvidence.filter((item) => item.type === "watch")).sort((a, b) => a.impact - b.impact),
      missing: categoryEvidence.filter((item) => item.type === "missing").sort((a, b) => a.impact - b.impact)
    };
    const positives = evidence.positive.slice(0, 3).map(displayEvidence);
    const negatives = evidence.watch.concat(evidence.missing).slice(0, 4).map(displayEvidence);
    return { grade, score, tone: toneForGrade(grade), confidence, confidenceScore, coverage, minimumCoverage, status, provisional: status === "provisional", positives: positives.length ? positives : ["No sourced positive evidence yet"], negatives: negatives.length ? negatives : ["No sourced concerns found"], evidence, sourceEvidence, categoryResults, violations };
  }

  root.EthicalGrade = {
    STORAGE_KEY,
    EVIDENCE_SCHEMA_VERSION,
    FACT_PROVIDERS: providerMetadata(),
    PRESETS: clone(PRESETS),
    SAMPLE_PRODUCTS: clone(SAMPLE_PRODUCTS),
    createProfile,
    mergeProfile,
    normalizeWeights,
    getProductEvidence,
    findCertificationMatches,
    normalizeBarcode,
    identifiersFromText,
    validGtin,
    equivalentGtin,
    resolveProductByIdentifiers,
    attachFoodProduct,
    productFromOpenFoodFacts,
    extractAmazonFoodFacts,
    extractPageClaims,
    oekoLabelNumbersFromText,
    oekoCertificationFromHtml,
    veganSocietyCertificationFromHtml,
    nonGmoCertificationFromPayload,
    greenSealCertificationFromHtml,
    cosmosCertificationFromHtml,
    euEcolabelCertificationFromPayload,
    epeatCertificationFromHtml,
    energyStarModelCandidates,
    energyStarCertificationFromPayload,
    gradeProduct,
    toneForGrade
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
