#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const recoveryRoot = path.resolve(__dirname, "..");
const defaultExtensionDir = path.resolve(recoveryRoot, "..");
const extensionDir = process.env.ETHICAL_GRADE_EXTENSION_DIR || defaultExtensionDir;
const sharedPath = path.join(extensionDir, "shared.js");
const certificationDataPath = path.join(extensionDir, "data", "certifications.json");
const productDataPath = path.join(extensionDir, "data", "products.json");
const fixturePath = path.join(recoveryRoot, "tests", "fixtures", "amazon-products.json");

function fail(message) {
  throw new Error(message);
}

function loadEthicalGrade() {
  if (!fs.existsSync(sharedPath)) fail(`Missing shared.js at ${sharedPath}`);
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sharedPath, "utf8"), context, { filename: sharedPath });
  if (!context.EthicalGrade) fail("shared.js did not expose EthicalGrade");
  return context.EthicalGrade;
}

function loadFixtures() {
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(data.fixtures) || !data.fixtures.length) fail("No fixtures found");
  return data.fixtures;
}

function loadCertificationDatabase() {
  if (!fs.existsSync(certificationDataPath)) return null;
  const data = JSON.parse(fs.readFileSync(certificationDataPath, "utf8"));
  return data && Array.isArray(data.records) ? data : null;
}
function loadProductDatabase() {
  if (!fs.existsSync(productDataPath)) return null;
  const data = JSON.parse(fs.readFileSync(productDataPath, "utf8"));
  return data && Array.isArray(data.products) ? data : null;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fieldMap(records) {
  return new Map(records.map((record) => [record.field, record]));
}

function assertFields(fixture, records) {
  const fields = fieldMap(records);
  (fixture.requiredFields || []).forEach((field) => {
    assert(fields.has(field), `${fixture.id}: missing evidence field "${field}"`);
  });
  (fixture.requiredNonSearchableFields || []).forEach((field) => {
    assert(fields.has(field), `${fixture.id}: missing identity field "${field}"`);
    assert(fields.get(field).searchable === false, `${fixture.id}: identity field "${field}" should not be searchable`);
  });
  (fixture.requiredSearchableFields || []).forEach((field) => {
    assert(fields.has(field), `${fixture.id}: missing searchable field "${field}"`);
    assert(fields.get(field).searchable === true, `${fixture.id}: field "${field}" should be searchable`);
  });
}

function assertResult(fixture, result, records) {
  assert(result && typeof result === "object", `${fixture.id}: missing grade result`);
  assert(typeof result.grade === "string" && result.grade, `${fixture.id}: missing grade`);
  assert(result.score === null || Number.isFinite(result.score), `${fixture.id}: score should be numeric or null when evidence is insufficient`);
  if (result.score !== null) assert(result.score >= 0 && result.score <= 100, `${fixture.id}: score outside 0-100`);
  if (fixture.minScore !== undefined) {
    assert(result.score !== null && result.score >= Number(fixture.minScore), `${fixture.id}: expected score at least ${fixture.minScore}, got ${result.score}`);
  }
  assert(Array.isArray(result.sourceEvidence), `${fixture.id}: result should include sourceEvidence`);
  assert(records.length >= 1, `${fixture.id}: no source evidence records`);
  assert(result.evidence && Array.isArray(result.evidence.positive), `${fixture.id}: missing positive evidence array`);
  assert(result.evidence && Array.isArray(result.evidence.watch), `${fixture.id}: missing watch evidence array`);
  assert(result.evidence && Array.isArray(result.evidence.missing), `${fixture.id}: missing missing-evidence array`);

  if (fixture.requiredSource) {
    assert(records.some((record) => record.source === fixture.requiredSource), `${fixture.id}: missing source "${fixture.requiredSource}"`);
  }
  (fixture.requiredSources || []).forEach((source) => {
    assert(records.some((record) => record.source === source), `${fixture.id}: missing source "${source}"`);
  });
  (fixture.requiredProviders || []).forEach((provider) => {
    assert(records.some((record) => record.provider === provider), `${fixture.id}: missing provider "${provider}"`);
  });
  if (fixture.requiredWatchMatch) {
    const matches = (result.evidence.watch || []).map((item) => String(item.match || "").toLowerCase());
    assert(matches.some((match) => match.includes(fixture.requiredWatchMatch)), `${fixture.id}: expected watch match "${fixture.requiredWatchMatch}"`);
  }
  if (fixture.requiredCertificationMatch) {
    const certText = records.filter((record) => record.field === "verifiedCertifications").map((record) => String(record.text || "")).join(" ").toLowerCase();
    assert(certText.includes(fixture.requiredCertificationMatch.toLowerCase()), `${fixture.id}: expected certification match "${fixture.requiredCertificationMatch}"`);
  }
  if (fixture.requiredPositiveSource) {
    const positives = result.evidence.positive || [];
    assert(positives.some((item) => item.source === fixture.requiredPositiveSource), `${fixture.id}: expected positive evidence from "${fixture.requiredPositiveSource}"`);
  }
}

function main() {
  const api = loadEthicalGrade();
  const fixtures = loadFixtures();
  const certificationDatabase = loadCertificationDatabase();
  const productDatabase = loadProductDatabase();
  const providers = Array.isArray(api.FACT_PROVIDERS) ? api.FACT_PROVIDERS : [];
  assert(providers.some((provider) => provider.id === "page_facts"), "Missing page_facts provider metadata");
  assert(providers.some((provider) => provider.id === "certification_provider"), "Missing certification_provider metadata");
  assert(providers.some((provider) => provider.id === "open_food_facts_provider"), "Missing open_food_facts_provider metadata");
  assert(api.validGtin("3017620422003") === true, "Known GTIN should pass checksum validation");
  assert(api.validGtin("3017620422004") === false, "Invalid GTIN checksum should be rejected");
  const ambiguous = api.resolveProductByIdentifiers(["3017620422003"], { products: [productDatabase.products[0], { ...productDatabase.products[0], id: "duplicate" }] });
  assert(ambiguous.status === "ambiguous" && !ambiguous.product, "Ambiguous GTIN matches must fail closed");

  fixtures.forEach((fixture) => {
    const profile = api.createProfile(fixture.profile || "balanced");
    const product = JSON.parse(JSON.stringify(fixture.product));
    if (fixture.useCertificationDatabase) {
      assert(certificationDatabase, `${fixture.id}: missing certification database`);
      assert(typeof api.findCertificationMatches === "function", `${fixture.id}: missing findCertificationMatches`);
      const matches = api.findCertificationMatches(product, certificationDatabase);
      assert(matches.length > 0, `${fixture.id}: expected at least one certification database match`);
      product.verifiedCertifications = matches;
      product.facts = { ...(product.facts || {}), verifiedCertifications: matches };
    }
    if (fixture.useProductDatabase) {
      assert(productDatabase, `${fixture.id}: missing product database`);
      const resolution = api.resolveProductByIdentifiers(product.facts.identifiers, productDatabase);
      assert(resolution.status === "matched", `${fixture.id}: expected exact product identity match`);
      api.attachFoodProduct(product, resolution);
    }
    const result = api.gradeProduct(product, profile);
    const records = result.sourceEvidence || api.getProductEvidence(product);

    assertFields(fixture, records);
    assertResult(fixture, result, records);

    console.log(`ok ${fixture.id}: ${result.grade} ${result.score === null ? "no score" : `${result.score}/100`}, ${result.coverage}% coverage, ${records.length} source records`);
  });

  console.log(`checked ${fixtures.length} fixtures against ${sharedPath}`);
}

main();
