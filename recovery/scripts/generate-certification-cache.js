#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const snapshotDir = process.env.CERTIFICATION_SOURCE_DIR || path.join(repoRoot, "source-snapshots", "certifications");
const outputPath = process.env.CERTIFICATION_CACHE_OUTPUT || path.join(repoRoot, "extension-work", "ethical-grade-extension", "data", "certifications.json");

function fail(message) {
  throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unique(values) {
  const seen = new Set();
  return values.map(clean).filter(Boolean).filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requireField(value, label, sourceFile) {
  const text = clean(value);
  if (!text) fail(`${sourceFile}: missing ${label}`);
  return text;
}

function sourceFiles() {
  if (!fs.existsSync(snapshotDir)) fail(`Missing certification source directory: ${snapshotDir}`);
  return fs.readdirSync(snapshotDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(snapshotDir, name));
}

function normalizeRecord(snapshot, record, sourceFile) {
  const source = snapshot.source || {};
  const brand = requireField(record.brand, "record.brand", sourceFile);
  const sourceId = requireField(source.id, "source.id", sourceFile);
  const issuer = clean(record.issuer) || requireField(source.issuer, "source.issuer", sourceFile);
  const sourceType = clean(record.sourceType) || requireField(source.sourceType, "source.sourceType", sourceFile);
  const name = clean(record.certificationName) || requireField(source.certificationName, "source.certificationName", sourceFile);
  const status = requireField(record.status, `${brand}.status`, sourceFile);
  const sourceUrl = requireField(record.sourceUrl, `${brand}.sourceUrl`, sourceFile);
  const verifiedAt = requireField(record.verifiedAt || snapshot.capturedAt, `${brand}.verifiedAt`, sourceFile);
  const prefix = clean(source.recordIdPrefix) || sourceId;

  const certification = {
    name,
    issuer,
    status,
    scope: clean(record.scope) || clean(source.defaultScope) || "company",
    sourceUrl,
    sourceType,
    sourceId,
    verifiedAt
  };

  if (record.certifiedSince !== undefined) certification.certifiedSince = record.certifiedSince;
  if (record.score !== undefined) certification.score = Number(record.score);
  if (record.expiresAt !== undefined) certification.expiresAt = record.expiresAt;

  return {
    id: clean(record.id) || `${prefix}-${slug(brand)}`,
    brand,
    aliases: unique([brand, ...(record.aliases || [])]),
    parentCompany: clean(record.parentCompany),
    certifications: [certification]
  };
}

function mergeRecords(records) {
  const byId = new Map();
  records.forEach((record) => {
    if (!byId.has(record.id)) {
      byId.set(record.id, record);
      return;
    }
    const existing = byId.get(record.id);
    existing.aliases = unique([...(existing.aliases || []), ...(record.aliases || [])]);
    existing.certifications = [...(existing.certifications || []), ...(record.certifications || [])];
  });
  return [...byId.values()].sort((a, b) => a.brand.localeCompare(b.brand));
}

function validateCache(cache) {
  const ids = new Set();
  cache.records.forEach((record) => {
    if (ids.has(record.id)) fail(`Duplicate certification record id: ${record.id}`);
    ids.add(record.id);
    requireField(record.brand, `${record.id}.brand`, "generated cache");
    if (!Array.isArray(record.certifications) || !record.certifications.length) fail(`${record.id}: missing certifications`);
    record.certifications.forEach((certification, index) => {
      requireField(certification.name, `${record.id}.certifications[${index}].name`, "generated cache");
      requireField(certification.issuer, `${record.id}.certifications[${index}].issuer`, "generated cache");
      requireField(certification.status, `${record.id}.certifications[${index}].status`, "generated cache");
      requireField(certification.sourceUrl, `${record.id}.certifications[${index}].sourceUrl`, "generated cache");
      requireField(certification.verifiedAt, `${record.id}.certifications[${index}].verifiedAt`, "generated cache");
    });
  });
}

function main() {
  const records = sourceFiles().flatMap((filePath) => {
    const snapshot = readJson(filePath);
    if (!Array.isArray(snapshot.records)) fail(`${filePath}: records must be an array`);
    return snapshot.records.map((record) => normalizeRecord(snapshot, record, path.relative(repoRoot, filePath)));
  });

  const cache = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    description: "Generated certification cache from local source snapshots. Do not hand-edit this file; edit work/recovery-package/source-snapshots/certifications instead.",
    records: mergeRecords(records)
  };

  validateCache(cache);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(`generated ${cache.records.length} certification records -> ${outputPath}`);
}

main();
