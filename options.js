(function optionsPage() {
  "use strict";

  const { STORAGE_KEY, PRESETS, SAMPLE_PRODUCTS, createProfile, mergeProfile, normalizeWeights, gradeProduct } = EthicalGrade;
  const PAGE_CLAIM_ARCHIVE_KEY = "ethicalGradePageClaims";
  let profile = createProfile("balanced");
  let sampleId = SAMPLE_PRODUCTS[0].id;
  const $ = (id) => document.getElementById(id);
  const els = {
    profileName: $("profileName"),
    presetGrid: $("presetGrid"),
    categoryList: $("categoryList"),
    dealbreakerList: $("dealbreakerList"),
    strictnessGroup: $("strictnessGroup"),
    missingGroup: $("missingGroup"),
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
    profile.profileName = els.profileName.value || "My Values";
    profile.categories = normalizeWeights(profile.categories);
    profile.setupComplete = true;
    chrome.storage.sync.set({ [STORAGE_KEY]: profile }, () => {
      els.status.textContent = "Saved";
    });
  }
  function renderPresets() {
    els.presetGrid.innerHTML = "";
    PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.className = `card${profile.preset === preset.id ? " is-selected" : ""}`;
      button.type = "button";
      button.innerHTML = `<strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.summary)}</span>`;
      button.addEventListener("click", () => {
        const name = profile.profileName || "My Values";
        profile = createProfile(preset.id);
        profile.profileName = name;
        dirty();
        render();
      });
      els.presetGrid.append(button);
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
      row.innerHTML = `<input type="checkbox" ${item.enabled ? "checked" : ""}><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><select><option value="warning" ${item.severity === "warning" ? "selected" : ""}>Warn</option><option value="cap" ${item.severity === "cap" ? "selected" : ""}>Cap</option><option value="avoid" ${item.severity === "avoid" ? "selected" : ""}>Avoid</option></select>`;
      const checkbox = row.querySelector("input");
      const select = row.querySelector("select");
      checkbox.addEventListener("change", () => { item.enabled = checkbox.checked; dirty(); renderPreview(); });
      select.addEventListener("change", () => { item.severity = select.value; dirty(); renderPreview(); });
      els.dealbreakerList.append(row);
    });
  }
  function renderStrictness() {
    els.strictnessGroup.innerHTML = "";
    [["gentle", "Gentle"], ["balanced", "Balanced"], ["strict", "Strict"]].forEach(([value, label]) => {
      const button = document.createElement("button");
      button.className = profile.strictness === value ? "is-selected" : "";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => { profile.strictness = value; dirty(); render(); });
      els.strictnessGroup.append(button);
    });
  }
  function renderMissing() {
    els.missingGroup.innerHTML = "";
    [["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]].forEach(([value, label]) => {
      const button = document.createElement("button");
      button.className = `card${profile.missingDataPenalty === value ? " is-selected" : ""}`;
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => { profile.missingDataPenalty = value; dirty(); render(); });
      els.missingGroup.append(button);
    });
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
    els.profileName.value = profile.profileName || "My Values";
    renderPresets();
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
  els.profileName.addEventListener("input", () => { profile.profileName = els.profileName.value; dirty(); });
  els.sampleProduct.addEventListener("change", () => { sampleId = els.sampleProduct.value; renderPreview(); });
  els.saveButton.addEventListener("click", saveProfile);
  els.resetButton.addEventListener("click", () => { profile = createProfile("balanced"); dirty(); render(); });
  els.exportClaimsButton.addEventListener("click", exportClaimArchive);
})();
