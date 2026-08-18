#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "shared.js"), "utf8"), context);
const api = context.EthicalGrade;

const explicitBrandDatabase = { records: [["certified-vegan-test", "88 Acres", [], [[
  "vegan_action_certified_products", "certified", "product", "https://vegan.org/certified-products",
  0.92, 1, 1, ["Apple Ginger Crisp Seed + Oat Bar"], ["Apple Ginger Crisp Seed + Oat Bar"], []
]]]], providers: { vegan_action_certified_products: {
  name: "Certified Vegan", issuer: "Vegan Action", sourceType: "official_product_directory"
} } };
assert.strictEqual(api.findCertificationMatches({
  brand: "Unrelated Brand", title: "88 Acres Apple Ginger Crisp Seed + Oat Bar"
}, explicitBrandDatabase).length, 0, "title prefix must not override an explicit different brand");

assert(api.equivalentGtin("009800800070", "0009800800070"), "UPC and zero-padded GTIN should match");
assert.deepStrictEqual(
  Array.from(api.identifiersFromText("UPC 009800892204 Global Trade Identification Number 00009800892204")),
  ["009800892204", "00009800892204"],
  "Amazon UPC and full GTIN labels should be extracted"
);
const live = api.productFromOpenFoodFacts({ product: {
  code: "0009800800070",
  product_name: "Nutella & Go!",
  ingredients_text: "Hazelnut spread, wheat breadsticks, barley malt extract",
  labels_tags: ["en:gluten-free"]
}}, "009800800070");
assert(live && live.barcode === "0009800800070", "Open Food Facts response should normalize into a cached product");

const amazonFacts = api.extractAmazonFoodFacts(`Diet type\nVegetarian\nNutrition facts\nCalories 270\nSugars 23g\nIngredients\nNUTELLA: SUGAR, PALM OIL. BREADSTICKS: ENRICHED WHEAT FLOUR, MALT EXTRACT.\nProduct details\nAllergen Information\nGluten Free`);
assert(amazonFacts.ingredientsText.includes("WHEAT FLOUR"), "Amazon ingredients section should be extracted");
assert(amazonFacts.nutrition.includes("Calories 270"), "Amazon nutrition section should be extracted");
assert(amazonFacts.foodLabels.includes("Vegetarian"), "Amazon diet labels should be extracted");

const profile = api.createProfile("health");
const product = api.attachFoodProduct({ key: "B00G2XNSWQ", title: "Nutella & Go!" }, {
  status: "matched", product: live, confidence: 0.98, method: "page_gtin_exact"
});
const result = api.gradeProduct(product, profile);
assert(result.violations.some((item) => item.id === "gluten" && item.match === "wheat"), "Ingredient evidence must override a contradictory gluten-free label");

const unknown = api.gradeProduct({ key: "unknown", title: "Unknown product" }, api.createProfile("balanced"));
assert.strictEqual(unknown.grade, "N/A", "A product without category evidence must not receive a letter grade");
assert.strictEqual(unknown.score, null, "A product without category evidence must not receive a numeric score");
assert.strictEqual(unknown.status, "insufficient_data");
assert.strictEqual(unknown.coverage, 0);

const expiredMatches = api.findCertificationMatches(
  { brand: "Expired Example", title: "Expired Example Product" },
  { records: [{ id: "expired", brand: "Expired Example", aliases: [], certifications: [{ name: "Expired Certification", issuer: "Test", status: "expired", current: false, gradeEligible: false }] }] }
);
const expiredEvidence = api.getProductEvidence({ title: "Expired Example Product", brand: "Expired Example", verifiedCertifications: expiredMatches });
assert.strictEqual(expiredMatches.length, 1, "Expired evidence should remain displayable");
assert(!expiredEvidence.some((record) => record.provider === "certification_provider"), "Expired evidence must not enter grade-bearing certification evidence");

const scopedDatabase = { records: [
  { id: "ra", brand: "Chocolove", aliases: [], certifications: [{ name: "Rainforest Alliance", scope: "brand", matchTerms: ["chocolate", "cocoa"] }] },
  { id: "ft", brand: "Numi Organic Tea", aliases: ["Numi"], certifications: [{ name: "Fair Trade Certified", scope: "product", productNames: ["Citrus Green Iced Tea"], matchTerms: ["Citrus Green Iced Tea"] }] }
] };
assert.strictEqual(api.findCertificationMatches({ brand: "Chocolove", title: "Chocolove Dark Chocolate Bar" }, scopedDatabase).length, 1);
assert.strictEqual(api.findCertificationMatches({ brand: "Chocolove", title: "Chocolove Cotton Tote" }, scopedDatabase).length, 0, "Category-scoped certification must not spill into unrelated products");
assert.strictEqual(api.findCertificationMatches({ brand: "Numi", title: "Numi Citrus Green Iced Tea" }, scopedDatabase).length, 1);
assert.strictEqual(api.findCertificationMatches({ brand: "Numi", title: "Numi Ceramic Mug" }, scopedDatabase).length, 0, "Product-scoped certification requires the certified product name");
const gotsDatabase = { records: [{ id: "gots-example", brand: "Example Textiles", aliases: ["Example Home"], certifications: [{
  name: "Global Organic Textile Standard (GOTS)", sourceId: "gots_certified_suppliers", scope: "product",
  productNames: ["Home textiles", "towel"], matchTerms: ["Home textiles", "towel"], current: true, gradeEligible: true
}] }] };
assert.strictEqual(api.findCertificationMatches({ brand: "Example Home", title: "Example Home Organic Cotton Towel" }, gotsDatabase).length, 0,
  "A GOTS supplier and product category must not count without an explicit retail GOTS claim");
assert.strictEqual(api.findCertificationMatches({ brand: "Example Home", title: "Example Home GOTS Certified Organic Cotton Towel" }, gotsDatabase).length, 1,
  "An explicit GOTS claim plus an official supplier and product-scope match should verify");
assert.strictEqual(api.findCertificationMatches({ brand: "Brand: Applegate", title: "Applegate Organic Oven Roasted Chicken Breast Sliced, 6oz" }, {
  records: [{ id: "usda-organic-5520030778", brand: "Applegate Farms", aliases: ["Applegate"], certifications: [{ name: "USDA Organic certified operation", issuer: "USDA", sourceId: "usda_organic_integrity", scope: "product", current: true, gradeEligible: true, productNames: ["Roasted Chicken Breast"], matchTerms: ["Roasted Chicken Breast"] }] }]
}).length, 1, "Amazon's Brand: prefix must not prevent a verified USDA product match");

const compactDatabase = {
  providers: { b: { name: "Certified B Corporation", issuer: "B Lab", sourceType: "official_directory" } },
  records: [["bcorp-tribe", "Tribe Breweries Pty Ltd", ["Tribe Breweries"], [["b", "listed active", "company", "https://www.bcorporation.net/en-us/find-a-b-corp/company/tribe-breweries-pty-ltd/", 0.92, 1, 1, [], []]]]]
};
const compactMatches = api.findCertificationMatches({ brand: "Tribe Breweries", title: "Tribe Breweries Beer" }, compactDatabase);
assert.strictEqual(compactMatches.length, 1, "Compact certification index should match aliases");
assert.strictEqual(compactMatches[0].issuer, "B Lab");
assert(compactMatches[0].officialProfileUrl.endsWith("/tribe-breweries-pty-ltd/"));

const duplicateProfileDatabase = { records: [
  { id: "old", brand: "Patagonia", aliases: [], certifications: [{ name: "Certified B Corporation", issuer: "B Lab", sourceUrl: "https://www.bcorporation.net/en-us/find-a-b-corp/company/patagonia-inc/" }] },
  { id: "new", brand: "Patagonia", aliases: [], certifications: [{ name: "Certified B Corporation", issuer: "B Lab", officialProfileUrl: "https://www.bcorporation.net/en-us/find-a-b-corp/company/patagonia-inc/" }] }
] };
assert.strictEqual(api.findCertificationMatches({ brand: "Patagonia", title: "Patagonia Jacket" }, duplicateProfileDatabase).length, 1, "The same official certification profile must not be counted twice");

const humaneDatabase = { records: [{ id: "producer", brand: "Producer", aliases: ["Cadia", "Central Market"], certifications: [{
  name: "Certified Humane", scope: "product", productNames: ["Free-Range Brown Eggs", "Organic Brown Eggs", "Pasture-Raised Brown Eggs"],
  matchTerms: ["Free-Range Brown Eggs", "Organic Brown Eggs", "Pasture-Raised Brown Eggs"],
  productRules: [{ brands: ["Cadia"], terms: ["Free-Range Brown Eggs", "Organic Brown Eggs"] }, { brands: ["Central Market"], terms: ["Pasture-Raised Brown Eggs"] }]
}] }] };
assert.strictEqual(api.findCertificationMatches({ brand: "Cadia", title: "Cadia Free-Range Brown Eggs" }, humaneDatabase).length, 1);
assert.strictEqual(api.findCertificationMatches({ brand: "Cadia", title: "Cadia Pasture-Raised Brown Eggs" }, humaneDatabase).length, 0, "A certified product phrase from another private label must not cross brands");

const creminelliDatabase = { records: [{ id: "creminelli", brand: "Creminelli Fine Meats (Creminelli Operating LLC)", aliases: ["Creminelli Fine Meats®", "Creminelli"], certifications: [{
  name: "Certified Humane", scope: "product", productNames: ["Varzi Uncured Italian Salami", "Varzi Salami"],
  matchTerms: ["Varzi Uncured Italian Salami", "Varzi Salami"], productRules: [{ brands: ["Creminelli Fine Meats®", "Creminelli"], terms: ["Varzi Uncured Italian Salami", "Varzi Salami"] }]
}] }] };
assert.strictEqual(api.findCertificationMatches({ brand: "Creminelli", title: "Creminelli Sliced Varzi Salami, 2.2 Ounce" }, creminelliDatabase).length, 1, "A conservative directory alias should match the retail title");
assert.strictEqual(api.findCertificationMatches({ brand: "Visit the Creminelli Store", title: "Creminelli Black Pepper Salami Minis, Humanely Raised Pork" }, {
  records: [{ id: "creminelli", brand: "Creminelli Fine Meats", aliases: ["Creminelli"], certifications: [{
    name: "Certified Humane Raised and Handled", issuer: "Humane Farm Animal Care", scope: "product", gradeEligible: true, current: true,
    productNames: ["Salami Minis Black Pepper Cracked Peppercorns Uncured Italian Salami"],
    matchTerms: ["Salami Minis Black Pepper Cracked Peppercorns Uncured Italian Salami"],
    productRules: [{ brands: ["Creminelli"], terms: ["Salami Minis Black Pepper Cracked Peppercorns Uncured Italian Salami"] }]
  }] }]
}).length, 1, "Amazon store wrappers and reordered certified-product words should still match");
assert.strictEqual(api.findCertificationMatches({ brand: "Visit the Creminelli Store", title: "Creminelli Ceramic Serving Board" }, creminelliDatabase).length, 0, "A brand match alone must not confer a product-scoped certification");
assert.strictEqual(api.findCertificationMatches({ brand: "Visit the Creminelli Store", title: "CREMINELLI Barolo Salame, 5.5 OZ" }, {
  records: [{ id: "creminelli", brand: "Creminelli Fine Meats", aliases: ["Creminelli"], certifications: [{
    name: "Certified Humane Raised and Handled", scope: "product", productNames: ["Barolo Salami"], matchTerms: ["Barolo Salami"],
    productRules: [{ brands: ["Creminelli"], terms: ["Barolo Salami"] }]
  }] }]
}).length, 1, "Equivalent retail spellings such as salame and salami should match");

const contaminationDatabase = { records: [{ id: "unrelated", brand: "Unrelated B Corp", aliases: [], certifications: [{ name: "Certified B Corporation", issuer: "B Lab", scope: "company" }] }] };
assert.strictEqual(api.findCertificationMatches({
  brand: "Visit the Deli Direct Store", title: "Farmers Market Foods White Wine Milano Salami",
  ingredientsText: "Unrelated B Corp", text: "Unrelated B Corp", facts: { pageText: "Unrelated B Corp appears in recommendations and reviews" }
}, contaminationDatabase).length, 0, "Unrelated full-page, ingredient, review, or recommendation text must not create a certification match");
assert.strictEqual(api.findCertificationMatches({
  brand: "Visit the Deli Direct Store", seller: "Farmers Market Foods", title: "Farmers Market Foods White Wine Milano Salami",
  productBullets: ["Made with a cleaner ingredient profile for consumers who value quality ingredients"]
}, { records: [{ id: "profile", brand: "PROFILE", aliases: [], certifications: [{ name: "Certified B Corporation", issuer: "B Lab", scope: "company" }] }] }).length, 0,
"A company name found only in descriptive product bullets must not create a company certification match");
assert.strictEqual(api.findCertificationMatches({
  brand: "Visit the 365 by Whole Foods Market Store", title: "365 by Whole Foods Market, Sour Gummy Watermelon Rings"
}, { records: [{ id: "watermelon", brand: "Watermelon", aliases: [], certifications: [{ name: "Certified B Corporation", issuer: "B Lab", scope: "company" }] }] }).length, 0,
"A company name used later as a flavor or ingredient in a product title must not establish company identity");

const unverifiedFairTradeGrade = api.gradeProduct({
  title: "Example Candy", brand: "Example", productBullets: ["Made with fair trade sugar"], text: "Fair Trade Certified"
}, api.createProfile("ethical"));
assert(!unverifiedFairTradeGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive" && /labor signal/i.test(item.label)),
  "An unverified Fairtrade page claim must not create labor certification credit");
assert(!unverifiedFairTradeGrade.categoryResults.find((item) => item.id === "transparency").evidence.some((item) => item.type === "positive"),
  "An unverified certification page claim must not create transparency credit");

const pageClaims = api.extractPageClaims({
  product_bullet: ["CERTIFIABLE QUALITY: Non-GMO Project Verified, Keto Certified, Kosher Certified, Gluten Free."],
  product_description: "The listing claims these ingredients are Fair Trade. Diet type: Vegan and Vegetarian."
}, { sourceUrl: "https://www.amazon.com/dp/B07YBTWGPM", capturedAt: "2026-08-05T12:00:00Z" });
assert.deepStrictEqual(Array.from(pageClaims.map((claim) => claim.claimType)), ["non_gmo_project", "keto_certified", "kosher_certified", "fairtrade", "vegan", "vegetarian"]);
assert(pageClaims.every((claim) => claim.verificationStatus === "unverified" && claim.gradeEligible === false),
  "Merchant claims must remain unverified and grading-ineligible");
assert(pageClaims.every((claim) => claim.sourceUrl.includes("B07YBTWGPM") && claim.sourceField),
  "Merchant claims must preserve provenance for future RAG");
const pageClaimGrade = api.gradeProduct({ title: "Claim-only product", pageClaims }, api.createProfile("ethical"));
assert(!pageClaimGrade.categoryResults.find((item) => item.id === "transparency").evidence.some((item) => item.type === "positive"),
  "Structured merchant claims must not affect deterministic grading");

const mscClaims = api.extractPageClaims({
  product_bullet: "MSC-certified wild Alaska pollock with the blue fish label."
}, { sourceUrl: "https://www.amazon.com/dp/MSCEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.strictEqual(mscClaims.length, 1, "An explicit MSC-certified claim should be preserved for future verification");
assert.strictEqual(mscClaims[0].claimType, "msc");
assert.strictEqual(mscClaims[0].gradeEligible, false, "An Amazon MSC claim alone must not affect the grade");
assert.strictEqual(api.extractPageClaims({ title: "MSC Industrial Supply Company Tool Set" }).length, 0,
  "The standalone acronym MSC must not be mistaken for seafood certification");

const verifiedMscGrade = api.gradeProduct({
  title: "Verified Wild Pollock", brand: "Verified Seafood", verifiedCertifications: [{
    name: "Marine Stewardship Council (MSC) Certified", issuer: "Marine Stewardship Council",
    sourceId: "msc_data_validation_api", status: "valid", scope: "product", current: true, gradeEligible: true
  }]
}, api.createProfile("climate"));
assert(verifiedMscGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A product validated by MSC's official API should create environmental credit");

const fscClaims = api.extractPageClaims({
  product_bullet: "Made with FSC Mix certified paper packaging and printed with responsible inks."
}, { sourceUrl: "https://www.amazon.com/dp/FSCEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.strictEqual(fscClaims.length, 1, "An explicit FSC label type should be retained for later verification");
assert.strictEqual(fscClaims[0].claimType, "fsc");
assert.strictEqual(fscClaims[0].gradeEligible, false, "An Amazon FSC claim alone must not affect the grade");
assert.strictEqual(api.extractPageClaims({ title: "FSC Examination Preparation Guide" }).length, 0,
  "The standalone acronym FSC must not be mistaken for a product certification");

const verifiedFscGrade = api.gradeProduct({
  title: "Verified Recycled Paper Notebook", brand: "Verified Paper", verifiedCertifications: [{
    name: "Forest Stewardship Council (FSC) Recycled", issuer: "Forest Stewardship Council",
    sourceId: "fsc_public_search", status: "valid", scope: "product", current: true, gradeEligible: true
  }]
}, api.createProfile("climate"));
assert(verifiedFscGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A scope-verified FSC product should create environmental credit");

const oekoClaims = api.extractPageClaims({
  product_bullet: "Sheets certified to OEKO-TEX STANDARD 100 and carrying the OEKO-TEX MADE IN GREEN label."
}, { sourceUrl: "https://www.amazon.com/dp/OEKOEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.deepStrictEqual(Array.from(oekoClaims.map((claim) => claim.claimType)), ["oeko_tex_made_in_green", "oeko_tex_standard_100"],
  "Distinct OEKO-TEX standards should be retained rather than collapsed into a generic claim");
assert(oekoClaims.every((claim) => claim.gradeEligible === false), "Merchant OEKO-TEX claims must remain grading-ineligible");
const unverifiedOekoGrade = api.gradeProduct({ title: "Claimed Sheets", productBullets: ["OEKO-TEX MADE IN GREEN"] }, api.createProfile("ethical"));
assert(!unverifiedOekoGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "An unverified MADE IN GREEN merchant claim must not create labor credit");
assert(!unverifiedOekoGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "An unverified MADE IN GREEN merchant claim must not create environmental credit");

const standard100Grade = api.gradeProduct({ title: "Verified Towel", verifiedCertifications: [{
  name: "OEKO-TEX STANDARD 100", issuer: "OEKO-TEX Association", sourceId: "oeko_tex_label_check",
  status: "valid", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("balanced"));
assert(standard100Grade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "Verified STANDARD 100 should create harmful-substance health credit");
assert(!standard100Grade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "STANDARD 100 must not be treated as a labor certification");

const madeInGreenGrade = api.gradeProduct({ title: "Verified Shirt", verifiedCertifications: [{
  name: "OEKO-TEX MADE IN GREEN", issuer: "OEKO-TEX Association", sourceId: "oeko_tex_label_check",
  status: "valid", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(madeInGreenGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "Verified MADE IN GREEN should create labor credit");
assert(madeInGreenGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified MADE IN GREEN should create environmental credit");

assert.deepStrictEqual(Array.from(api.oekoLabelNumbersFromText(
  "OEKO-TEX STANDARD 100 certified products. Certification Number 16.HIN.94317"
)), ["16.HIN.94317"], "Amazon's OEKO-TEX certificate number should be extracted from its sustainability panel");
const parsedOeko = api.oekoCertificationFromHtml(
  '<script>dataLayer.push({"event":"labelcheckSubmitted","number":"16.HIN.94317","label":"OEKO-TEX® STANDARD 100","status":"valid"});</script>',
  "16.HIN.94317"
);
assert(parsedOeko && parsedOeko.current && parsedOeko.gradeEligible, "A valid official OEKO-TEX Label Check result should verify the product certificate");
assert.strictEqual(parsedOeko.certificationNumber, "16.HIN.94317");
assert.strictEqual(api.oekoCertificationFromHtml(
  '<script>dataLayer.push({"event":"labelcheckSubmitted","number":"BAD","label":"OEKO-TEX® STANDARD 100","status":"invalid"});</script>', "BAD"
).gradeEligible, false, "An invalid OEKO-TEX result must never affect grading");

const ewgClaims = api.extractPageClaims({
  product_bullet: "This facial cleanser carries the EWG VERIFIED® mark."
}, { sourceUrl: "https://www.amazon.com/dp/EWGEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.strictEqual(ewgClaims.length, 1, "An explicit EWG VERIFIED merchant claim should be retained");
assert.strictEqual(ewgClaims[0].claimType, "ewg_verified");
assert.strictEqual(ewgClaims[0].gradeEligible, false, "An Amazon EWG claim alone must not affect grading");
const unverifiedEwgGrade = api.gradeProduct({ title: "Claimed Cleanser", productBullets: ["EWG VERIFIED"] }, api.createProfile("health"));
assert(!unverifiedEwgGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive" && /EWG/i.test(item.match)),
  "An unverified EWG merchant claim must not create health credit");
const verifiedEwgGrade = api.gradeProduct({ title: "Verified Cleanser", verifiedCertifications: [{
  name: "EWG VERIFIED", issuer: "Environmental Working Group", sourceId: "ewg_verified_product_directory",
  status: "verified", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("health"));
assert(verifiedEwgGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "An exact product-directory EWG match should create health credit");

const bluesignClaims = api.extractPageClaims({
  product_bullet: "This jacket is a bluesign® PRODUCT. The brand is also a bluesign® SYSTEM PARTNER."
}, { sourceUrl: "https://www.amazon.com/dp/BLUEEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.deepStrictEqual(Array.from(bluesignClaims.map((claim) => claim.claimType)), ["bluesign_product", "bluesign_system_partner"],
  "Finished-product and company-level bluesign claims must remain distinguishable");
assert(bluesignClaims.every((claim) => claim.gradeEligible === false), "Amazon bluesign claims must remain unverified");
const unverifiedBluesignGrade = api.gradeProduct({ title: "Claimed Jacket", productBullets: ["bluesign PRODUCT"] }, api.createProfile("ethical"));
assert(!unverifiedBluesignGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "An unverified bluesign merchant claim must not create environmental credit");
const verifiedBluepassGrade = api.gradeProduct({ title: "Verified Jacket", verifiedCertifications: [{
  name: "bluepass Consumer Product", issuer: "bluesign technologies ag", sourceId: "bluesign_bluepass_product_verification",
  status: "valid", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedBluepassGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A verified bluepass Consumer Product should create environmental credit");
assert(verifiedBluepassGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "A verified bluepass Consumer Product should create labor credit");

const climateClaims = api.extractPageClaims({
  product_bullet: "Climate Neutral Certified. This listing also calls the item carbon neutral."
}, { sourceUrl: "https://www.amazon.com/dp/CLIMATEEXAMPLE", capturedAt: "2026-08-06T12:00:00Z" });
assert.deepStrictEqual(Array.from(climateClaims.map((claim) => claim.claimType)), ["change_climate_label"],
  "An exact Climate Neutral Certified claim should be retained, but generic carbon-neutral wording should not masquerade as certification");
assert(climateClaims.every((claim) => claim.gradeEligible === false), "Merchant climate claims must remain grading-ineligible");
const unverifiedClimateGrade = api.gradeProduct({ title: "Claimed Product", productBullets: ["Climate Neutral Certified"] }, api.createProfile("ethical"));
assert(!unverifiedClimateGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "An unverified climate-label claim must not create environmental credit");
const verifiedClimateGrade = api.gradeProduct({ title: "Verified Product", verifiedCertifications: [{
  name: "The Climate Label", issuer: "The Change Climate Project", sourceId: "change_climate_certified_brand_directory",
  status: "certified", scope: "brand", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedClimateGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A current official Climate Label directory match should create environmental credit without claiming product-level certification");

const nextCertificationClaims = api.extractPageClaims({ product_bullet: [
  "Registered with The Vegan Society's Vegan Trademark.", "Upcycled Certified®.",
  "GRS-certified fabric and RCS-certified trim.", "ASC-certified salmon.", "Fair for Life certified cocoa."
] }, { sourceUrl: "https://www.amazon.com/dp/NEXTCERTS", capturedAt: "2026-08-07T12:00:00Z" });
assert.deepStrictEqual(Array.from(nextCertificationClaims.map((claim) => claim.claimType)), [
  "vegan_society_trademark", "vegan", "upcycled_certified", "global_recycled_standard", "recycled_claim_standard", "asc", "fair_for_life"
], "Each new certification family should be preserved distinctly while retaining the general vegan dietary claim");
assert(nextCertificationClaims.every((claim) => claim.gradeEligible === false), "Merchant claims for new certifications must remain unverified");
const remainingCertificationClaims = api.extractPageClaims({ product_bullet: [
  "RWS-certified wool under the Responsible Wool Standard.", "PEFC-certified paper packaging.",
  "EU Organic logo and Soil Association certified organic.", "RSPO-certified palm oil.",
  "SCS Global Services Recycled Content Certified."
] }, { sourceUrl: "https://www.amazon.com/dp/REMAINING", capturedAt: "2026-08-08T12:00:00Z" });
assert.deepStrictEqual(Array.from(remainingCertificationClaims.map((claim) => claim.claimType)), [
  "responsible_wool_standard", "pefc", "organic", "eu_organic", "soil_association_organic", "rspo", "scs_recycled_content"
], "The remaining recommended certification families should be captured distinctly");
assert(remainingCertificationClaims.every((claim) => claim.gradeEligible === false),
  "Merchant wording for the remaining certifications must never grade without official verification");
const remainingVerifiedGrade = api.gradeProduct({ title: "Verified Products", verifiedCertifications: [
  { name: "Responsible Wool Standard (RWS)", issuer: "Textile Exchange", scope: "product", current: true, gradeEligible: true },
  { name: "PEFC-certified", issuer: "PEFC International", scope: "product", current: true, gradeEligible: true },
  { name: "Soil Association Organic", issuer: "Soil Association Certification", scope: "product", current: true, gradeEligible: true },
  { name: "RSPO-certified", issuer: "RSPO", scope: "product", current: true, gradeEligible: true },
  { name: "SCS Recycled Content Certified", issuer: "SCS Global Services", scope: "product", current: true, gradeEligible: true }
] }, api.createProfile("balanced"));
assert(remainingVerifiedGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified remaining certifications should create appropriate environmental evidence");
assert(remainingVerifiedGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.impact === 8),
  "RWS should receive limited rather than full animal-welfare credit");
assert(remainingVerifiedGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "Verified Soil Association organic evidence should create health credit");
const rspoOnlyGrade = api.gradeProduct({ title: "Verified Palm Oil Product", verifiedCertifications: [
  { name: "RSPO-certified", issuer: "RSPO", scope: "product", current: true, gradeEligible: true }
] }, api.createProfile("ethical"));
assert(rspoOnlyGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.impact === 7),
  "RSPO should receive limited environmental credit because certification is not equivalent to deforestation-free proof");
const animalFiberClaims = api.extractPageClaims({ product_bullet: [
  "RDS-certified down under the Responsible Down Standard.",
  "RMS-certified fiber under the Responsible Mohair Standard.",
  "RAS-certified fiber under the Responsible Alpaca Standard.",
  "OCS-certified cotton under the Organic Content Standard."
] }, { sourceUrl: "https://www.amazon.com/dp/FIBERSTANDARDS", capturedAt: "2026-08-08T12:00:00Z" });
assert.deepStrictEqual(Array.from(animalFiberClaims.map((claim) => claim.claimType)), [
  "responsible_down_standard", "responsible_mohair_standard", "responsible_alpaca_standard", "organic_content_standard"
], "Related Textile Exchange standards should remain distinct claims");
assert(animalFiberClaims.every((claim) => claim.gradeEligible === false),
  "Retailer claims for Textile Exchange standards must remain non-grading until officially verified");
const verifiedRdsGrade = api.gradeProduct({ title: "Verified Down Jacket", verifiedCertifications: [{
  name: "Responsible Down Standard (RDS)", issuer: "Textile Exchange", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedRdsGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.impact === 8),
  "RDS should receive limited animal-welfare credit");
const verifiedOcsGrade = api.gradeProduct({ title: "Verified Cotton Shirt", verifiedCertifications: [{
  name: "Organic Content Standard (OCS)", issuer: "Textile Exchange", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedOcsGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "OCS should create environmental credit only when product verification exists");
const finalProductCertClaims = api.extractPageClaims({ product_bullet: [
  "Awarded the EU Ecolabel.", "Packaging is OK compost HOME and OK compost INDUSTRIAL certified.",
  "Displays the Seedling compostability logo and meets EN 13432.", "Uses ISCC PLUS-certified material.",
  "Made with ZQ-certified merino wool."
] }, { sourceUrl: "https://www.amazon.com/dp/FOURCERTS", capturedAt: "2026-08-08T12:00:00Z" });
assert.deepStrictEqual(Array.from(finalProductCertClaims.map((claim) => claim.claimType)), [
  "eu_ecolabel", "ok_compost_industrial", "ok_compost_home", "seedling_compostable", "iscc_plus", "zq_merino"
], "EU Ecolabel, compostability marks, ISCC PLUS, and ZQ should remain distinct claims");
assert(finalProductCertClaims.every((claim) => claim.gradeEligible === false),
  "Merchant claims for the four new certification families must remain non-grading");
const governmentEcolabelClaims = api.extractPageClaims({ product_bullet: [
  "Blue Angel certified cleaning paper.", "Carries the Nordic Swan Ecolabel."
] }, { sourceUrl: "https://www.amazon.com/dp/ECOLABELS", capturedAt: "2026-08-09T12:00:00Z" });
assert.deepStrictEqual(Array.from(governmentEcolabelClaims.map((claim) => claim.claimType)), ["blue_angel", "nordic_swan"],
  "Blue Angel and Nordic Swan must remain distinct merchant claims");
assert(governmentEcolabelClaims.every((claim) => claim.gradeEligible === false),
  "Merchant Blue Angel and Nordic Swan claims must not affect grading without official product verification");
const verifiedBlueAngelGrade = api.gradeProduct({ title: "Verified Recycled Paper", verifiedCertifications: [{
  name: "Blue Angel", issuer: "RAL gGmbH", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedBlueAngelGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A product-level Blue Angel record should create environmental credit once the official feed is connected");
const biobasedClaims = api.extractPageClaims({ product_bullet: [
  "Displays the USDA Certified Biobased Product label."
] }, { sourceUrl: "https://www.amazon.com/dp/BIOBASED", capturedAt: "2026-08-09T12:00:00Z" });
assert.deepStrictEqual(Array.from(biobasedClaims.map((claim) => claim.claimType)), ["usda_certified_biobased"],
  "The USDA Certified Biobased Product label should be captured as its own claim");
assert(biobasedClaims.every((claim) => claim.gradeEligible === false),
  "A merchant USDA Biobased claim must not affect grading without an exact certified catalogue record");
assert.strictEqual(api.extractPageClaims({ product_bullet: ["Qualifies for mandatory federal biobased purchasing."] }, {
  sourceUrl: "https://www.amazon.com/dp/SELFQUALIFIED", capturedAt: "2026-08-09T12:00:00Z"
}).length, 0, "Self-qualified federal purchasing status must not be treated as USDA product certification");
const verifiedBiobasedGrade = api.gradeProduct({ title: "Verified Biobased Cleaner", verifiedCertifications: [{
  name: "USDA Certified Biobased Product", issuer: "USDA", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedBiobasedGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "An exact USDA Certified Biobased Product record should create environmental credit");
const waterSenseClaims = api.extractPageClaims({ product_bullet: ["EPA WaterSense labeled showerhead"] }, {
  sourceUrl: "https://www.amazon.com/dp/WATERSENSE", capturedAt: "2026-08-09T12:00:00Z"
});
assert.deepStrictEqual(Array.from(waterSenseClaims.map((claim) => claim.claimType)), ["epa_watersense"],
  "WaterSense should be captured as its own merchant claim");
assert(waterSenseClaims.every((claim) => claim.gradeEligible === false),
  "A merchant WaterSense claim must not affect grading without an official model or UPC match");
const verifiedWaterSenseGrade = api.gradeProduct({ title: "Verified Showerhead", verifiedCertifications: [{
  name: "WaterSense Labeled", issuer: "U.S. Environmental Protection Agency", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedWaterSenseGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "An exact WaterSense product record should create environmental credit");
const verifiedEuEcolabelGrade = api.gradeProduct({ title: "Verified Detergent", verifiedCertifications: [{
  name: "EU Ecolabel", issuer: "European Commission", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedEuEcolabelGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "A verified EU Ecolabel product should create environmental credit");
const parsedEuEcolabel = api.euEcolabelCertificationFromPayload({ data: [{
  licence_number: "AT/006/002", expiration_date: "2099-12-31T00:00:00", group_name: "Laundry detergents",
  group_category_name: "Cleaning", licence_holder: "claro products GmbH", item_id: 124875,
  product_name: "claro Kunterbunt", ean13: "9005835312992"
}] }, "9005835312992");
assert(parsedEuEcolabel && parsedEuEcolabel.matchedGtin === "9005835312992" && parsedEuEcolabel.confidence === 0.99,
  "EU Ecolabel should verify an exact current GTIN from ECAT");
assert.strictEqual(api.euEcolabelCertificationFromPayload({ data: [{
  expiration_date: "2099-12-31T00:00:00", product_name: "Other Product", ean13: "9005835312992"
}] }, "4006381333931"), null, "EU Ecolabel must not transfer between GTINs");
assert.strictEqual(api.euEcolabelCertificationFromPayload({ data: [{
  expiration_date: "2020-01-01T00:00:00", product_name: "Expired Product", ean13: "9005835312992"
}] }, "9005835312992"), null, "Expired EU Ecolabel records must not affect grading");
const verifiedIsccGrade = api.gradeProduct({ title: "Verified Material Product", verifiedCertifications: [{
  name: "ISCC PLUS", issuer: "ISCC System GmbH", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedIsccGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.impact === 7),
  "ISCC PLUS should receive only limited environmental credit even with product evidence");
const verifiedZqGrade = api.gradeProduct({ title: "Verified Merino Sweater", verifiedCertifications: [{
  name: "ZQ Merino", issuer: "The New Zealand Merino Company", scope: "product", current: true, gradeEligible: true
}] }, api.createProfile("ethical"));
assert(verifiedZqGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.impact === 8),
  "ZQ should receive limited animal-welfare credit");
const unverifiedNextGrade = api.gradeProduct({ title: "Claimed Product", productBullets: ["Upcycled Certified", "ASC-certified", "Fair for Life"] }, api.createProfile("ethical"));
assert(!unverifiedNextGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Unverified merchant claims for the new sources must not create environmental credit");
const verifiedNextGrade = api.gradeProduct({ title: "Verified Product", verifiedCertifications: [
  { name: "Vegan Trademark", issuer: "The Vegan Society", status: "registered", scope: "product", current: true, gradeEligible: true },
  { name: "Upcycled Certified", issuer: "Upcycled Food Association", status: "certified", scope: "product", current: true, gradeEligible: true },
  { name: "ASC-certified", issuer: "Aquaculture Stewardship Council", status: "certified", scope: "product", current: true, gradeEligible: true },
  { name: "Fair for Life", issuer: "Fair for Life", status: "certified", scope: "brand", current: true, gradeEligible: true }
] }, api.createProfile("ethical"));
assert(verifiedNextGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "positive"),
  "Verified Vegan Trademark or ASC product evidence should create animal-category credit");
assert(verifiedNextGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "Verified ASC or Fair for Life evidence should create labor credit");
assert(verifiedNextGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified Upcycled, ASC, or Fair for Life evidence should create environmental credit");
const veganSocietyHtml = `<div class="tm-brand-container"><h3>Alpro</h3><div class="tm-grouping-container"><h4>Food</h4><p>Greek Style Plain, Soya Vanilla Dessert UHT</p></div></div>`;
const parsedVeganTrademark = api.veganSocietyCertificationFromHtml(veganSocietyHtml, "Visit the Alpro Store", "Alpro Greek Style Plain Plant Based Yogurt 400g");
assert(parsedVeganTrademark && parsedVeganTrademark.matchedBrand === "Alpro" && parsedVeganTrademark.matchedProduct === "Greek Style Plain",
  "The Vegan Society lookup should require both an exact normalized brand and a registered product-name match");
assert.strictEqual(api.veganSocietyCertificationFromHtml(veganSocietyHtml, "Alpro", "Alpro Almond Milk Unsweetened"), null,
  "A registered brand must not certify a product absent from its official product list");
assert.strictEqual(api.veganSocietyCertificationFromHtml(veganSocietyHtml, "Another Brand", "Greek Style Plain"), null,
  "A matching product phrase under a different brand must not verify");

const nonGmoPayload = { data: [{ id: "5-933-010001", name: "Baking Chocolate - Semi-Sweet Mega Chunks", brand: { id: "508", name: "Enjoy Life Foods" }, verified: true, packages: [{ package_code: "853522000535", type: "UPC-A" }], verifications: [{ type: "NonGMO", status: "Verified" }] }] };
const parsedNonGmo = api.nonGmoCertificationFromPayload(nonGmoPayload, "Enjoy Life Foods", "Enjoy Life Baking Chocolate Semi-Sweet Mega Chunks", []);
assert(parsedNonGmo && parsedNonGmo.scope === "product" && parsedNonGmo.matchedProduct.includes("Mega Chunks"),
  "Non-GMO Project lookup should match an exact brand plus registered product name");
assert(api.nonGmoCertificationFromPayload(nonGmoPayload, "Another Brand", "Baking Chocolate Semi-Sweet Mega Chunks", ["853522000535"]),
  "An exact package barcode should be sufficient even when merchant brand text is imperfect");
assert.strictEqual(api.nonGmoCertificationFromPayload(nonGmoPayload, "Enjoy Life Foods", "Semi-Sweet Mini Chips", []), null,
  "A verified brand must not certify a different product");
const verifiedNonGmoGrade = api.gradeProduct({ title: "Verified Food", verifiedCertifications: [parsedNonGmo] }, api.createProfile("ethical"));
assert(verifiedNonGmoGrade.categoryResults.find((item) => item.id === "transparency").evidence.some((item) => item.type === "positive"),
  "Verified Non-GMO Project evidence should create transparency credit");
assert(!verifiedNonGmoGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Non-GMO Project verification alone must not create environmental credit");

const agwClaims = api.extractPageClaims({ product_bullet: [
  "Certified Animal Welfare Approved by AGW", "Certified Grassfed by AGW",
  "Certified Non-GMO by AGW", "Certified Regenerative by AGW"
] }, { sourceUrl: "https://www.amazon.com/dp/AGWTEST" });
assert.deepStrictEqual(Array.from(agwClaims.map((claim) => claim.claimType)), [
  "agw_animal_welfare", "agw_grassfed", "agw_non_gmo", "agw_regenerative"
], "AGW's four certification programs should be captured distinctly");
assert(agwClaims.every((claim) => claim.gradeEligible === false), "Merchant AGW claims must remain unverified");
const unverifiedAgwGrade = api.gradeProduct({ title: "Claimed Beef", productBullets: ["Certified Animal Welfare Approved by AGW"] }, api.createProfile("ethical"));
assert(!unverifiedAgwGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "positive"),
  "An unverified AGW merchant claim must not create animal-welfare credit");
const verifiedAgwGrade = api.gradeProduct({ title: "Verified Beef", verifiedCertifications: [
  { name: "Certified Animal Welfare Approved by AGW", issuer: "A Greener World", status: "certified", scope: "product_type", current: true, gradeEligible: true },
  { name: "Certified Regenerative by AGW", issuer: "A Greener World", status: "certified", scope: "product_type", current: true, gradeEligible: true }
] }, api.createProfile("ethical"));
assert(verifiedAgwGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "positive"),
  "Verified AGW Animal Welfare evidence should create animal-welfare credit");
assert(verifiedAgwGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified AGW Regenerative evidence should create environmental credit");

const greenSealHtml = `<div class="row"><div><a href="https://certified.greenseal.org/product/safely-hand-soap-rise-shop-safely-llc"><img alt="Safely Hand Soap - Rise"></a></div><div><a href="https://certified.greenseal.org/product/safely-hand-soap-rise-shop-safely-llc" style="font-size: 22px;">Safely Hand Soap - Rise</a><br><span style="font-weight: bold">Safely</span></div></div>`;
const parsedGreenSeal = api.greenSealCertificationFromHtml(greenSealHtml, "Visit the Safely Store", "Safely Hand Soap Rise, 12 fl oz");
assert(parsedGreenSeal && parsedGreenSeal.matchedBrand === "Safely" && parsedGreenSeal.matchedProduct === "Safely Hand Soap - Rise",
  "Green Seal lookup should require an exact normalized brand and certified product-name match");
assert.strictEqual(api.greenSealCertificationFromHtml(greenSealHtml, "Safely", "Safely Dish Soap Calm"), null,
  "A Green Seal-certified brand must not certify another product");
assert.strictEqual(api.greenSealCertificationFromHtml(greenSealHtml, "Another Brand", "Safely Hand Soap Rise"), null,
  "A matching Green Seal product phrase under another brand must not verify");
const greenSealClaim = api.extractPageClaims({ product_bullet: "Green Seal Certified cleaner" }, { sourceUrl: "https://www.amazon.com/dp/GSTEST" });
assert(greenSealClaim.some((claim) => claim.claimType === "green_seal") && greenSealClaim.every((claim) => claim.gradeEligible === false),
  "Merchant Green Seal wording should be stored but remain grading-ineligible");
const verifiedGreenSealGrade = api.gradeProduct({ title: "Verified Cleaner", verifiedCertifications: [parsedGreenSeal] }, api.createProfile("balanced"));
assert(verifiedGreenSealGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified Green Seal product evidence should create environmental credit");
assert(verifiedGreenSealGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "Verified Green Seal product evidence should create health credit");

const epeatHtml = `<table><tbody><tr><td><span>&nbsp;</span></td><td><a href="/product-details/cf0c937052f04627968b062b48c90d2f">Apple MacBook Pro 14-inch (M5)</a></td><td>Apple Inc.</td><td>Notebook</td><td>United States</td><td>Gold</td><td>2025-10-22</td><td>Active</td></tr></tbody></table>`;
const parsedEpeat = api.epeatCertificationFromHtml(epeatHtml, "Apple Inc.", "Apple MacBook Pro 14-inch (M5)");
assert(parsedEpeat && parsedEpeat.tier === "Gold" && parsedEpeat.locationOfUse === "United States",
  "EPEAT lookup should match an active U.S. product registration by manufacturer and model name");
assert.strictEqual(api.epeatCertificationFromHtml(epeatHtml, "Apple", "Apple MacBook Air 13-inch M5"), null,
  "An EPEAT-registered manufacturer must not certify a different model");
assert.strictEqual(api.epeatCertificationFromHtml(epeatHtml.replace("Active", "Archived"), "Apple", "Apple MacBook Pro 14-inch M5"), null,
  "Inactive EPEAT registrations must not verify");
const epeatClaim = api.extractPageClaims({ product_bullet: "EPEAT Gold registered" }, { sourceUrl: "https://www.amazon.com/dp/EPEATTEST" });
assert(epeatClaim.some((claim) => claim.claimType === "epeat") && epeatClaim.every((claim) => claim.gradeEligible === false),
  "Merchant EPEAT wording should remain grading-ineligible");
const verifiedEpeatGrade = api.gradeProduct({ title: "Verified Laptop", verifiedCertifications: [parsedEpeat] }, api.createProfile("ethical"));
assert(verifiedEpeatGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified EPEAT evidence should create environmental credit");

const tcoClaim = api.extractPageClaims({ product_bullet: "TCO Certified display" }, { sourceUrl: "https://www.amazon.com/dp/TCOTEST" });
assert(tcoClaim.some((claim) => claim.claimType === "tco_certified") && tcoClaim.every((claim) => claim.gradeEligible === false),
  "Merchant TCO Certified wording should remain grading-ineligible");
const verifiedTco = { name: "TCO Certified", issuer: "TCO Development", status: "certified active", scope: "product", current: true, gradeEligible: true };
const verifiedTcoGrade = api.gradeProduct({ title: "Verified Monitor", verifiedCertifications: [verifiedTco] }, api.createProfile("ethical"));
assert(verifiedTcoGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified TCO Certified evidence should create environmental credit");
assert(verifiedTcoGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "Verified TCO Certified evidence should create labor credit");

const energyStarPayload = [{ pd_id: "2203489", product_category: "Consumer Refrigeration Products", brand_name: "LG", model_name: "LFC22770 Series", model_number: "LFC22770**", upc: "048231784818;048231784894", markets: "United States, Canada", meets_most_efficient_criteria: "No" }];
assert.deepStrictEqual(Array.from(api.energyStarModelCandidates("LG 22 cu. ft. Refrigerator LFC22770ST Stainless Steel")), ["LFC22770ST"],
  "ENERGY STAR lookup should extract distinctive model tokens from a product title");
const parsedEnergyStar = api.energyStarCertificationFromPayload(energyStarPayload, "Visit the LG Store", "LG Refrigerator LFC22770ST Stainless Steel", []);
assert(parsedEnergyStar && parsedEnergyStar.modelNumber === "LFC22770**" && parsedEnergyStar.productCategory.includes("Refrigeration"),
  "ENERGY STAR lookup should match brand plus a certified wildcard model number");
assert(api.energyStarCertificationFromPayload(energyStarPayload, "Different Brand", "Unrelated Product", ["048231784818"]),
  "An exact ENERGY STAR UPC should be sufficient even if merchant brand text is imperfect");
assert.strictEqual(api.energyStarCertificationFromPayload(energyStarPayload, "LG", "LG Refrigerator LFXS26973S", []), null,
  "An ENERGY STAR-certified brand must not certify a different model");
const energyStarClaim = api.extractPageClaims({ product_bullet: "ENERGY STAR Certified appliance" }, { sourceUrl: "https://www.amazon.com/dp/ESTEST" });
assert(energyStarClaim.some((claim) => claim.claimType === "energy_star") && energyStarClaim.every((claim) => claim.gradeEligible === false),
  "Merchant ENERGY STAR wording should remain grading-ineligible");
const verifiedEnergyStarGrade = api.gradeProduct({ title: "Verified Appliance", verifiedCertifications: [parsedEnergyStar] }, api.createProfile("ethical"));
assert(verifiedEnergyStarGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified ENERGY STAR evidence should create environmental credit");
assert(!verifiedEnergyStarGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "ENERGY STAR must not create labor credit");

const petaClaims = api.extractPageClaims({ product_bullet: "PETA Animal Test-Free and Vegan" }, { sourceUrl: "https://www.amazon.com/dp/PETATEST" });
assert(petaClaims.some((claim) => claim.claimType === "peta_animal_test_free_vegan") && petaClaims.every((claim) => claim.gradeEligible === false),
  "Merchant PETA wording should be stored but remain grading-ineligible");
const verifiedPeta = { name: "PETA Animal Test-Free", issuer: "PETA", status: "listed active", scope: "company", current: true, gradeEligible: true };
const verifiedPetaGrade = api.gradeProduct({ title: "Verified Cosmetics", verifiedCertifications: [verifiedPeta] }, api.createProfile("ethical"));
assert(verifiedPetaGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "positive"),
  "Verified PETA company evidence should create animal-testing credit");
assert(!verifiedPetaGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "PETA animal test-free status must not create environmental credit");
const petaVeganClaim = api.extractPageClaims({ product_bullet: "PETA-Approved Vegan" }, { sourceUrl: "https://www.amazon.com/dp/PETAVEGAN" });
assert(petaVeganClaim.some((claim) => claim.claimType === "peta_approved_vegan") && petaVeganClaim.every((claim) => claim.gradeEligible === false),
  "Merchant PETA-Approved Vegan wording should remain grading-ineligible");
const verifiedPetaVegan = { name: "PETA-Approved Vegan (Certified)", issuer: "PETA", status: "certified active", scope: "company", current: true, gradeEligible: true };
const verifiedPetaVeganGrade = api.gradeProduct({ title: "Verified Vegan Handbag", verifiedCertifications: [verifiedPetaVegan] }, api.createProfile("vegan"));
assert(verifiedPetaVeganGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "positive"),
  "Verified PETA-Approved Vegan evidence should create animal-welfare credit");
assert(!verifiedPetaVeganGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "PETA-Approved Vegan must not create labor credit");
const petaTestingListing = { name: "PETA Companies That Test Listing", issuer: "PETA", status: "listed active", scope: "company", current: true, gradeEligible: false, adverse: true, adverseType: "animal_testing", matchedBrand: "Example Cosmetics", officialProfileUrl: "https://crueltyfree.peta.org/company/example-cosmetics/" };
const petaTestingGrade = api.gradeProduct({ title: "Example Cosmetics Foundation", brand: "Example Cosmetics", verifiedCertifications: [petaTestingListing] }, api.createProfile("vegan"));
assert.strictEqual(petaTestingGrade.grade, "Avoid", "A verified PETA animal-testing listing should trigger the vegan profile's animal-testing dealbreaker");
assert(petaTestingGrade.categoryResults.find((item) => item.id === "animals").evidence.some((item) => item.type === "watch" && item.label.includes("animal-testing directory")),
  "A PETA animal-testing listing should create an animal-welfare concern");
assert(!petaTestingGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "watch"),
  "A PETA animal-testing listing must not create an environmental penalty");
const goodweaveDatabase = { schemaVersion: 2, records: [{ id: "goodweave-test", brand: "Ethical Rugs", aliases: [], certifications: [{ name: "GoodWeave Certified", issuer: "GoodWeave International", status: "certified active", scope: "product_category", matchTerms: ["rug", "carpet"], current: true, gradeEligible: true }] }] };
const goodweaveMatch = api.findCertificationMatches({ brand: "Ethical Rugs", title: "Ethical Rugs Handwoven Area Rug" }, goodweaveDatabase);
assert.strictEqual(goodweaveMatch.length, 1, "GoodWeave should match an exact business and certified product category");
assert.strictEqual(api.findCertificationMatches({ brand: "Ethical Rugs", title: "Ethical Rugs Coffee Mug" }, goodweaveDatabase).length, 0,
  "GoodWeave must not transfer certification to an unrelated product category");
assert.strictEqual(api.findCertificationMatches({ brand: "Another Brand", title: "Ethical Rugs Area Rug" }, goodweaveDatabase).length, 0,
  "GoodWeave must require an exact business identity match");
const verifiedGoodweaveGrade = api.gradeProduct({ title: "Verified Rug", verifiedCertifications: goodweaveMatch }, api.createProfile("ethical"));
assert(verifiedGoodweaveGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "Verified GoodWeave evidence should create labor credit");
assert(!verifiedGoodweaveGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "GoodWeave alone must not create environmental credit");
const saferChoiceDatabase = { schemaVersion: 1, providers: { epa_safer_choice_products: { name: "EPA Safer Choice Certified", issuer: "U.S. Environmental Protection Agency", sourceType: "official_product_directory" } }, records: [["safer-choice-test", "Walmart Inc.", [], [["epa_safer_choice_products", "certified active", "product", "https://www.epa.gov/saferchoice/products#search=test", 0.96, 1, 1, ["Great Value Glass Cleaner"], ["Great Value Glass Cleaner"], [], { gtins: ["078742112367"], productCategories: ["Window/Glass Cleaners"] }, "EPA Safer Choice Certified"]]]] };
const saferChoiceBarcodeMatch = api.findCertificationMatches({ brand: "Great Value", title: "Great Value Glass Cleaner", gtin: "078742112367" }, saferChoiceDatabase);
assert.strictEqual(saferChoiceBarcodeMatch.length, 1, "EPA Safer Choice should support exact UPC matching when the retail brand differs from the partner company");
assert.strictEqual(saferChoiceBarcodeMatch[0].matchType, "barcode", "Exact Safer Choice UPC evidence should identify its match method");
assert.strictEqual(api.findCertificationMatches({ brand: "Walmart Inc.", title: "Great Value Furniture Polish" }, saferChoiceDatabase).length, 0,
  "Safer Choice must not certify another product from the same partner company");
const saferChoiceGrade = api.gradeProduct({ title: "Verified Cleaner", verifiedCertifications: saferChoiceBarcodeMatch }, api.createProfile("balanced"));
assert(saferChoiceGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified EPA Safer Choice evidence should create environmental credit");
assert(saferChoiceGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "Verified EPA Safer Choice evidence should create health credit");

const cosmosHtml = `<table id="product-table"><tr><th>Product</th><th>Signature</th><th>Brand</th><th>Company</th><th>Certification body</th><th>Version</th></tr><tr><td>Rose Hydrating Face Cream</td><td>ORGANIC</td><td>Example Beauty®</td><td>Example Laboratories Ltd</td><td>Soil Association Certification</td><td>V4</td></tr><tr><td>Gentle Shampoo</td><td>NATURAL</td><td>Other Beauty</td><td>Other Ltd</td><td>Ecocert</td><td>V4</td></tr></table>`;
const parsedCosmos = api.cosmosCertificationFromHtml(cosmosHtml, "Visit the Example Beauty Store", "Example Beauty Rose Hydrating Face Cream, 50 ml");
assert(parsedCosmos && parsedCosmos.name === "COSMOS ORGANIC" && parsedCosmos.scope === "product",
  "COSMOS should preserve the ORGANIC level for an exact brand and matching product");
assert.strictEqual(api.cosmosCertificationFromHtml(cosmosHtml, "Example Beauty", "Example Beauty Gentle Shampoo"), null,
  "COSMOS must not transfer certification to another product from the same brand");
assert.strictEqual(api.cosmosCertificationFromHtml(cosmosHtml, "Other Brand", "Rose Hydrating Face Cream"), null,
  "COSMOS must require an exact normalized brand");
const cosmosClaim = api.extractPageClaims({ title: "COSMOS ORGANIC Face Cream", pageType: "detail", url: "https://www.amazon.com/dp/B000000000", facts: { product_bullet: ["COSMOS ORGANIC formula"] } });
assert(cosmosClaim.some((claim) => claim.claimType === "cosmos_organic") && cosmosClaim.every((claim) => claim.gradeEligible === false),
  "Amazon COSMOS wording must remain an unverified, non-grading claim");
const verifiedCosmosGrade = api.gradeProduct({ title: "Verified Face Cream", verifiedCertifications: [parsedCosmos] }, api.createProfile("balanced"));
assert(verifiedCosmosGrade.categoryResults.find((item) => item.id === "environment").evidence.some((item) => item.type === "positive"),
  "Verified COSMOS evidence should create environmental credit");
assert(verifiedCosmosGrade.categoryResults.find((item) => item.id === "health").evidence.some((item) => item.type === "positive"),
  "Verified COSMOS evidence should create health credit");
assert(!verifiedCosmosGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "COSMOS alone must not create labor credit");

const verifiedFairTradeGrade = api.gradeProduct({
  title: "Verified Coffee", brand: "Verified", verifiedCertifications: [{
    name: "Fairtrade licensed operator", issuer: "Fairtrade International", status: "licensed", scope: "product", current: true, gradeEligible: true
  }]
}, api.createProfile("ethical"));
assert(verifiedFairTradeGrade.categoryResults.find((item) => item.id === "labor").evidence.some((item) => item.type === "positive"),
  "Verified Fairtrade evidence should create labor credit");

console.log("shared identity, live-product normalization, and dietary precedence checks passed");
