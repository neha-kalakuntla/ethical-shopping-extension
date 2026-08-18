(function optionsPage() {
  "use strict";

  const { STORAGE_KEY, SAMPLE_PRODUCTS, createProfile, mergeProfile, normalizeWeights, gradeProduct } = EthicalGrade;
  const PAGE_CLAIM_ARCHIVE_KEY = "ethicalGradePageClaims";
  let profile = createProfile("balanced");
  let sampleId = SAMPLE_PRODUCTS[0].id;
  const $ = (id) => document.getElementById(id);
  const els = {
    categoryList: $("categoryList"),
    dealbreakerList: $("dealbreakerList"),
    strictnessSlider: $("strictnessSlider"),
    strictnessValue: $("strictnessValue"),
    missingPenaltySlider: $("missingPenaltySlider"),
    missingPenaltyValue: $("missingPenaltyValue"),
    sampleProduct: $("sampleProduct"),
    gradePreview: $("gradePreview"),
    status: $("status"),
    saveButton: $("saveButton"),
    resetButton: $("resetButton"),
    claimArchiveSummary: $("claimArchiveSummary"),
    exportClaimsButton: $("exportClaimsButton")
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
  }
  function dirty() {
    profile.updatedAt = new Date().toISOString();
    els.status.textContent = "Unsaved changes";
  }
  function saveProfile() {
    profile.categories = normalizeWeights(profile.categories);
    profile.setupComplete = true;
    chrome.storage.sync.set({ [STORAGE_KEY]: profile }, () => {
      els.status.textContent = "Saved";
    });
  }
  function renderCategories() {
    profile.categories = normalizeWeights(profile.categories);
    els.categoryList.innerHTML = "";
    profile.categories.forEach((category) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<input type="checkbox" ${category.enabled ? "checked" : ""}><div><strong>${escapeHtml(category.label)}</strong><p>${escapeHtml(category.detail)}</p><input type="range" min="0" max="100" step="5" value="${category.weight}" ${category.enabled ? "" : "disabled"}></div><strong>${category.weight}%</strong>`;
      const checkbox = row.querySelector("input[type='checkbox']");
      const range = row.querySelector("input[type='range']");
      checkbox.addEventListener("change", () => {
        category.enabled = checkbox.checked;
        if (category.enabled && category.weight === 0) category.weight = 10;
        dirty();
        render();
      });
      range.addEventListener("input", () => {
        category.weight = Number(range.value);
        dirty();
        render();
      });
      els.categoryList.append(row);
    });
  }
  function renderDealbreakers() {
    els.dealbreakerList.innerHTML = "";
    profile.dealbreakers.forEach((item) => {
      const row = document.createElement("div");
      row.className = "row";
      const preference = item.id === "political_alignment" ? `<select class="dealbreaker-preference" aria-label="Political alignment preference"><option value="avoid_partisan" ${item.value === "avoid_partisan" ? "selected" : ""}>Avoid strongly partisan</option><option value="avoid_conservative" ${item.value === "avoid_conservative" ? "selected" : ""}>Avoid conservative-aligned</option><option value="avoid_liberal" ${item.value === "avoid_liberal" ? "selected" : ""}>Avoid liberal-aligned</option></select>` : "";
      const blockList = item.id === "blocked_terms" ? `<input class="dealbreaker-terms" type="text" value="${escapeHtml(item.terms || "")}" placeholder="Brand or term, another term" aria-label="Blocked brands or terms">` : "";
      row.innerHTML = `<input type="checkbox" ${item.enabled ? "checked" : ""}><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p>${preference}${blockList}</div><select class="dealbreaker-severity"><option value="warning" ${item.severity === "warning" ? "selected" : ""}>Warn</option><option value="cap" ${item.severity === "cap" ? "selected" : ""}>Cap</option><option value="avoid" ${item.severity === "avoid" ? "selected" : ""}>Avoid</option></select>`;
      const checkbox = row.querySelector("input");
      const select = row.querySelector(".dealbreaker-severity");
      const preferenceSelect = row.querySelector(".dealbreaker-preference");
      const termsInput = row.querySelector(".dealbreaker-terms");
      checkbox.addEventListener("change", () => { item.enabled = checkbox.checked; dirty(); renderPreview(); });
      select.addEventListener("change", () => { item.severity = select.value; dirty(); renderPreview(); });
      if (preferenceSelect) preferenceSelect.addEventListener("change", () => { item.value = preferenceSelect.value; dirty(); renderPreview(); });
      if (termsInput) termsInput.addEventListener("input", () => { item.terms = termsInput.value; dirty(); renderPreview(); });
      els.dealbreakerList.append(row);
    });
  }
  function describeStrictness(value) {
    if (value < 25) return `Gentle · ${value}`;
    if (value < 45) return `Balanced-leaning-gentle · ${value}`;
    if (value <= 55) return "Balanced";
    if (value <= 75) return `Balanced-leaning-strict · ${value}`;
    return `Strict · ${value}`;
  }
  function describeMissingPenalty(value) {
    if (value < 25) return `Light · ${value}`;
    if (value < 45) return `Medium-leaning-light · ${value}`;
    if (value <= 55) return "Medium";
    if (value <= 75) return `Medium-leaning-strong · ${value}`;
    return `Strong · ${value}`;
  }
  function renderStrictness() {
    els.strictnessSlider.value = String(profile.strictness);
    els.strictnessValue.textContent = describeStrictness(profile.strictness);
  }
  function renderMissing() {
    els.missingPenaltySlider.value = String(profile.missingDataPenalty);
    els.missingPenaltyValue.textContent = describeMissingPenalty(profile.missingDataPenalty);
  }
  function renderSamples() {
    els.sampleProduct.innerHTML = "";
    SAMPLE_PRODUCTS.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = product.title;
      option.selected = product.id === sampleId;
      els.sampleProduct.append(option);
    });
  }
  function renderPreview() {
    const product = SAMPLE_PRODUCTS.find((item) => item.id === sampleId) || SAMPLE_PRODUCTS[0];
    const result = gradeProduct(product, profile);
    const scoreText = result.score === null ? "No score" : `${result.score}/100`;
    els.gradePreview.innerHTML = `<div class="big"><span class="badge ${result.tone}">${escapeHtml(result.grade)}</span><div><strong>${escapeHtml(scoreText)}</strong><p>${escapeHtml(result.confidence)} confidence · ${result.coverage}% coverage</p></div></div><ul class="reasons"><li>${escapeHtml(result.positives[0])}</li><li>${escapeHtml(result.negatives[0])}</li></ul>`;
  }
  function render() {
    profile = mergeProfile(profile);
    renderCategories();
    renderDealbreakers();
    renderStrictness();
    renderMissing();
    renderSamples();
    renderPreview();
  }
  function loadClaimArchive() {
    chrome.storage.local.get(PAGE_CLAIM_ARCHIVE_KEY, (result) => {
      const archive = result[PAGE_CLAIM_ARCHIVE_KEY] || {};
      const products = Object.values(archive);
      const claimCount = products.reduce((sum, product) => sum + (Array.isArray(product.claims) ? product.claims.length : 0), 0);
      els.claimArchiveSummary.textContent = `${products.length} products · ${claimCount} unverified merchant claims stored locally`;
      els.exportClaimsButton.disabled = claimCount === 0;
    });
  }
  function exportClaimArchive() {
    chrome.storage.local.get(PAGE_CLAIM_ARCHIVE_KEY, (result) => {
      const archive = result[PAGE_CLAIM_ARCHIVE_KEY] || {};
      const payload = { schemaVersion: 1, kind: "merchant_page_claims", exportedAt: new Date().toISOString(), products: Object.values(archive) };
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ethical-grade-page-claims-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      els.status.textContent = "Page claims exported";
    });
  }

  chrome.storage.sync.get(STORAGE_KEY, (result) => {
    profile = mergeProfile(result[STORAGE_KEY]);
    render();
    loadClaimArchive();
  });
  els.strictnessSlider.addEventListener("input", () => {
    profile.strictness = Number(els.strictnessSlider.value);
    els.strictnessValue.textContent = describeStrictness(profile.strictness);
    dirty();
    renderPreview();
  });
  els.missingPenaltySlider.addEventListener("input", () => {
    profile.missingDataPenalty = Number(els.missingPenaltySlider.value);
    els.missingPenaltyValue.textContent = describeMissingPenalty(profile.missingDataPenalty);
    dirty();
    renderPreview();
  });
  els.sampleProduct.addEventListener("change", () => { sampleId = els.sampleProduct.value; renderPreview(); });
  els.saveButton.addEventListener("click", saveProfile);
  els.resetButton.addEventListener("click", () => { profile = createProfile("balanced"); dirty(); render(); });
  els.exportClaimsButton.addEventListener("click", exportClaimArchive);
})();
