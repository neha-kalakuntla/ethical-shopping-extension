(() => {
  const demo = document.getElementById("demo");

  function row(label, value) {
    const item = document.createElement("div");
    item.className = "eg-detail-row";
    const name = document.createElement("span");
    name.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value;
    item.append(name, detail);
    return item;
  }

  async function render() {
    const response = await fetch("../data/products.json");
    if (!response.ok) throw new Error(`Could not load products (${response.status})`);
    const database = await response.json();
    const resolution = EthicalGrade.resolveProductByIdentifiers(["3017620422003"], database);
    if (!resolution) throw new Error("The Nutella barcode fixture did not resolve");

    const product = EthicalGrade.attachFoodProduct({
      name: "Nutella Hazelnut Spread",
      brand: "Ferrero",
      price: 4.99,
      source: "Preview"
    }, resolution);
    const profile = EthicalGrade.createProfile("balanced");
    const glutenRule = profile.dealbreakers.find((item) => item.id === "gluten");
    if (glutenRule) { glutenRule.enabled = true; glutenRule.severity = "warning"; }
    const result = EthicalGrade.gradeProduct(product, profile);

    const card = document.createElement("section");
    card.className = "eg-popover";
    const header = document.createElement("div");
    header.className = "eg-popover-header";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "eg-eyebrow";
    eyebrow.textContent = "Exact barcode match";
    const title = document.createElement("h3");
    title.textContent = product.name;
    titleWrap.append(eyebrow, title);
    const grade = document.createElement("div");
    grade.className = `eg-large-grade eg-grade-${String(result.grade).toLowerCase().replace(/[^a-z]/g, "")}`;
    grade.textContent = result.grade;
    header.append(titleWrap, grade);

    const summary = document.createElement("p");
    summary.className = "eg-summary";
    summary.textContent = `${result.score}/100 · ${result.confidence} confidence`;
    const details = document.createElement("div");
    details.className = "eg-details";
    details.append(
      row("GTIN", product.gtin),
      row("Identity", product.identityMatch),
      row("Ingredients", product.ingredientsText || "Not available"),
      row("Allergens", Array.isArray(product.allergens) ? product.allergens.join(", ") : (product.allergens || "None listed")),
      row("Data source", "Open Food Facts")
    );
    const warning = document.createElement("p");
    warning.className = "eg-disclaimer";
    warning.textContent = "Dietary safeguards use product data as evidence, but ambiguous or missing allergen data should still be checked on the package.";
    card.append(header, summary, details, warning);
    demo.replaceChildren(card);
  }

  render().catch((error) => {
    const message = document.createElement("p");
    message.className = "preview-error";
    message.textContent = error.message;
    demo.replaceChildren(message);
    console.error(error);
  });
})();
