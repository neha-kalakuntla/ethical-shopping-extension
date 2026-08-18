# Ethical Grade Source Roadmap

This is the long-term source list for the ethical grading system. The rule is: use official, structured, source-backed data for scoring whenever possible. Use AI/RAG only to summarize already-collected source text, not to invent facts or calculate grades.

## Priority 0: Product Identity

These sources help answer: "What product, brand, parent company, barcode, ASIN, or manufacturer are we actually looking at?"

| Source | Use | Notes |
| --- | --- | --- |
| Amazon Selling Partner API - Catalog Items | ASIN metadata, images, product types, identifiers | Best Amazon-specific structured path, but access/auth may be hard. |
| Amazon Creators/Product Advertising replacement | Amazon affiliate/product lookup | PA-API docs say PA-API is being deprecated; verify current replacement before building. |
| GS1 Verified by GS1 | GTIN/UPC/EAN company/product identity | Strong identity source when barcode exists. Enterprise/API access may require GS1 membership. |
| Open Food Facts | Food barcode, brand, ingredients, allergens, packaging | Open data, great for food; user-contributed, so confidence should vary. |
| USDA FoodData Central | Nutrition and branded food data | Strong U.S. nutrition source; needs API key. |
| NIH Dietary Supplement Label Database | Supplement labels, ingredients, barcode search | Strong for vitamins/supplements. |
| OpenCorporates | Legal entity matching, parent/legal company identity | Useful for parent-company mapping; licensing matters. |
| GLEIF LEI Search | Legal Entity Identifier data | Useful for public/global corporate entity identity. |
| SEC EDGAR APIs | Public company filings, ticker/CIK, company metadata | Strong for public companies, not product-level. |

## Priority 1: Certifications And Verified Labels

These should become the strongest positive evidence because they are third-party or official verification sources.

### Broad Company Ethics

| Source | Use | Notes |
| --- | --- | --- |
| B Lab Find a B Corp | Certified B Corporation status, scores, dates | Already prototyped with local snapshots. |
| Fairtrade Finder | Fairtrade certified producers, traders, licensees | Need distinguish licensee/product mark from upstream operator certification. |
| FLOCERT Customer Search | Fairtrade-certified organizations | Good supply-chain operator source. |
| Rainforest Alliance Certificate Holders | Farm/group/supply-chain certificates | Be careful: certificate holder does not always mean retail product certified. |

### Organic, Food, Agriculture

| Source | Use | Notes |
| --- | --- | --- |
| USDA Organic INTEGRITY Database | Certified organic operations | Strong for operations; product-level organic still needs label/product evidence. |
| Non-GMO Project Product Verification | Non-GMO verification | Add if product/search access is reliable. |
| Regenerative Organic Certified | ROC products/brands | Good if accessible in structured form. |
| Certified Humane | Animal welfare certification | Product/brand scope matters. |
| Global Animal Partnership | Animal welfare step ratings | Good for meat/egg/dairy categories. |
| A Greener World / Animal Welfare Approved | Animal welfare certifications | Useful for food products and farms. |
| MSC | Sustainable seafood fisheries and chain-of-custody suppliers | Supplier/fishery certification, product matching needs care. |
| ASC | Aquaculture certification | Similar caveat to MSC. |

### Forest, Paper, Packaging

| Source | Use | Notes |
| --- | --- | --- |
| FSC Search | FSC certificate/license holders | Strong for wood/paper supply chain. |
| PEFC Certificate Search | Forest/paper certification | Add as FSC complement. |
| SFI Certified Products/Organizations | Forest/paper certification | North America-heavy. |
| How2Recycle | Packaging recyclability labels | Licensing/access likely needed. |
| Cradle to Cradle Certified Products | Circularity/material health certification | Good product-level sustainability signal. |

### Textiles, Apparel, Materials

| Source | Use | Notes |
| --- | --- | --- |
| GOTS Certified Suppliers Database | Organic textile supply chain certification | Entity/supplier-level, not always retail SKU. |
| OEKO-TEX Buying Guide / Label Check | Textile chemical-safety certifications | Product/certificate scope matters. |
| Textile Exchange standards: GRS, RCS, OCS, RDS, RWS | Recycled/organic/down/wool claims | Add if registry/download access is workable. |
| Fair Wear Foundation | Apparel labor verification | Brand/company-level, useful for labor score. |

### Safer Chemicals, Home, Cleaning

| Source | Use | Notes |
| --- | --- | --- |
| EPA Safer Choice Product Search | Safer cleaning and chemical products | Strong official product-level source. |
| EPA Safer Chemical Ingredients List | Ingredient-level chemical safety | Good future ingredient parser support. |
| Green Seal Certified Products and Services | Cleaning, paper, paints, lodging, services | Good certification source; product directory access may need scraping/cache. |
| UL ECOLOGO | Multi-category ecolabel | Add if product/cert listing access is reliable. |
| EU Ecolabel Product Catalogue | EU ecolabel products; CSV/API available | Good structured source for EU/global products. |
| Blue Angel Product/Company Directory | German ecolabel products and companies | Strong EU environmental label. |

### Electronics And Appliances

| Source | Use | Notes |
| --- | --- | --- |
| ENERGY STAR Product Finder APIs | Energy-efficient certified models and UPC data | Strong product/model-level source. |
| EPEAT Registry | Sustainable electronics certification | Strong for electronics; check access/licensing. |
| TCO Certified Product Finder | Sustainable IT products | Strong third-party electronics certification. |
| iFixit repairability scores | Repairability/circularity signal | Third-party rating; useful but not certification. |

### Vegan, Cruelty-Free, Animal Testing

| Source | Use | Notes |
| --- | --- | --- |
| Leaping Bunny Shopping Guide | Cruelty-free brands | Strong cruelty-free signal for covered categories. |
| PETA Ultimate Cruelty-Free List | Cruelty-free and vegan company lists | Good secondary/parallel cruelty-free source. |
| Vegan Action Certified Vegan database | Vegan product certification | Product-level vegan signal. |
| Vegan Society Vegan Trademark | Vegan trademarked products | Product/brand-level vegan signal. |
| BeVeg | Vegan product/facility certification | Add where registry access is available. |
| American Vegetarian Association | Vegan/vegetarian/plant-based certifications | Useful as an additional vegan/vegetarian source. |

## Priority 2: Health, Safety, Recalls

These sources should usually create warnings or "watch" evidence, not broad ethical positives.

| Source | Use | Notes |
| --- | --- | --- |
| FDA Enforcement Reports / openFDA | Food, drug, device, cosmetic recalls/adverse events | Strong regulatory source; match carefully by brand/product. |
| USDA FSIS Recall API | Meat, poultry, egg recall data | Strong for FSIS-regulated foods. |
| CPSC Recall API | Consumer product recalls | Strong product-safety source. |
| NHTSA Recall APIs | Vehicle/child-seat/vehicle equipment recalls | Relevant if later covering car products/accessories. |
| NIH DSLD | Supplement labels and ingredients | Also product identity for supplements. |
| EWG Skin Deep / Guide to Healthy Cleaning | Ingredient/product hazard ratings | Useful only with licensing and methodology display; do not treat as official. |

## Priority 3: Labor, Human Rights, And Supply Chain Risk

These are usually company/category/country risk signals, not product-proof by themselves.

| Source | Use | Notes |
| --- | --- | --- |
| U.S. DOL ILAB List of Goods Produced by Child Labor or Forced Labor | Country + good forced/child labor risk | Strong risk source, not company-specific proof. |
| KnowTheChain | Company forced-labor benchmark | Strong for large companies in covered sectors. |
| World Benchmarking Alliance CHRB / Social Benchmark | Human rights and social performance | Strong company benchmark; coverage limited to major companies. |
| Fashion Revolution Fashion Transparency Index | Apparel transparency | Third-party benchmark; useful for fashion brands. |
| Remake Fashion Accountability Report | Apparel labor/climate/waste accountability | Secondary benchmark; methodology must be shown. |
| Better Work | Factory program data in apparel | Useful where brand/factory mapping exists. |
| Worker Rights Consortium | Apparel labor investigations | Good controversy/investigation source. |
| WRAP Certified Facilities | Apparel facility certification | Facility-level; needs supplier mapping. |
| SA8000 / Social Accountability International | Social accountability certification | Useful if certified organization data is accessible. |

## Priority 4: Climate, Pollution, Environmental Compliance

These sources are strong, but matching facility/company to consumer product is hard. Use confidence scores.

| Source | Use | Notes |
| --- | --- | --- |
| Science Based Targets initiative Target Dashboard | Validated climate targets and commitments | Good company-level climate source. |
| CDP scores and disclosures | Climate/water/forest disclosure and scores | Licensing/access likely needed. |
| EPA GHGRP / FLIGHT | Facility greenhouse gas emissions | Strong facility data; product/company matching hard. |
| EPA ECHO | Facility compliance, violations, enforcement | Strong official environmental compliance source. |
| EPA TRI | Toxic chemical releases/transfers | Strong facility-level pollution data. |
| Climate TRACE | Sector/facility emissions estimates | Useful climate context, confidence/source caveats needed. |
| RE100 | Renewable electricity commitments | Good company-level signal, not proof of product footprint. |
| WBA Climate/Energy/Food/Nature Benchmarks | Company-level climate/nature performance | Good benchmark data for covered companies. |

## Priority 5: Company Ownership, Legal, And Enforcement

These help connect product brands to parent companies and serious controversies.

| Source | Use | Notes |
| --- | --- | --- |
| OpenCorporates | Legal entities, jurisdictions, officers, filings | Useful for entity resolution and parent mapping. |
| SEC EDGAR APIs | Public company filings and risk disclosures | Strong source for public companies. |
| GLEIF LEI Search | Global legal entity identifiers | Good for entity resolution. |
| UK Companies House API | UK company registry data | Add for global expansion. |
| FTC enforcement actions | Consumer protection/deceptive marketing cases | Useful for greenwashing or misleading claims. |
| DOJ enforcement/settlements | Major legal actions | Use as controversy source. |
| EPA enforcement cases | Environmental enforcement | Often accessible through ECHO. |
| OSHA inspection/citation data | Workplace safety violations | Company/facility matching needed. |
| NLRB cases | Labor relations cases | U.S.-specific labor signal. |
| CourtListener / RECAP | U.S. court cases | RAG summarization only after entity disambiguation. |
| OpenSanctions | Sanctions/watchlist relationships | Use carefully; high-stakes matching must be conservative. |

## Priority 6: News, Controversies, And RAG Sources

These should not directly calculate grades. They should support a short, source-bound "controversies found" summary.

| Source | Use | Notes |
| --- | --- | --- |
| Google Programmable Search / Custom Search | Find relevant pages for a company query | Query must include exact entity name and disambiguators. |
| GDELT | News/event discovery | Useful broad news index; noisy. |
| Wikipedia / Wikidata | Entity disambiguation and parent-company hints | Never final proof for certification or score. |
| Official company sustainability reports | Company claims and disclosures | Treat as self-reported unless audited. |
| NGO reports | Context and allegations | Need source credibility labels and timestamps. |
| Regulator press releases | Enforcement summaries | Stronger than general news. |

## Marketplace Signals To Treat Carefully

These are useful discovery signals but should not be treated as verified by themselves.

| Source | Use | Notes |
| --- | --- | --- |
| Amazon Climate Pledge Friendly | Detect possible certification/claim on Amazon | Resolve to underlying certification before scoring strongly. |
| Product page text | Candidate facts, keywords, visible claims | Low confidence until verified. |
| Seller names | Candidate brand/manufacturer evidence | Weak identity signal. |
| User reviews/questions | Possible issue discovery | Too noisy for scoring; maybe future UX only. |

## Paid Or Licensed Sources To Consider Later

These can improve coverage, but should wait until the model and data contracts are stable.

| Source | Use | Notes |
| --- | --- | --- |
| 1WorldSync / GS1 data pools | Retail product master data | Strong product identity; commercial. |
| NielsenIQ / Label Insight | Product attributes and ingredients | Commercial. |
| Good On You | Fashion brand ratings | Commercial/partnership likely. |
| Ethical Consumer | Company/product ethical ratings | Commercial/partnership likely. |
| RepRisk / Sustainalytics / MSCI ESG / ISS ESG | ESG risk datasets | Commercial; methodology and licensing matter. |
| Sedex | Supply-chain labor/audit data | Commercial/private membership. |
| Higg / Cascale tools | Apparel/material impact data | Access/licensing constraints. |

## Implementation Order

1. Product identity: Amazon ASIN + GS1/Open Food Facts where available.
2. Certification cache: B Lab, USDA Organic, Fairtrade/FLOCERT, Rainforest Alliance, FSC, EPA Safer Choice.
3. Product health/safety: Open Food Facts, FoodData Central, FDA/FSIS/CPSC recalls.
4. Entity resolution: OpenCorporates, GLEIF, SEC EDGAR.
5. Category-specific certifications: textiles, electronics, cruelty-free, vegan, animal welfare.
6. Company-level benchmarks: SBTi, WBA, KnowTheChain, DOL ILAB.
7. Facility-level risk: EPA ECHO, TRI, GHGRP, OSHA.
8. Controversy summaries: Google/GDELT/news/courts/regulator pages with strictly source-bound RAG.

## Scoring Trust Rules

- Product-level certification beats company-level certification.
- Official certifier directory beats marketplace claim.
- Company-level certification should help, but must not imply every product is certified.
- Facility-level pollution or labor issues should affect confidence unless facility-to-product mapping is strong.
- Self-reported company claims should be shown separately from verified third-party claims.
- News/RAG summaries should never directly set a numerical score.

## Reference Links

These are the official or primary pages checked while drafting this roadmap.

### Product Identity

- Amazon Selling Partner API Catalog Items: https://developer-docs.amazon.com/sp-api/reference/getcatalogitem
- Amazon listing/product docs: https://developer-docs.amazon.com/sp-api/lang-en_US/docs/manage-product-listings-guide
- Amazon Product Advertising API docs: https://webservices.amazon.com/paapi5/documentation/common-request-parameters.html
- GS1 Verified by GS1: https://www.gs1.org/services/verified-by-gs1
- GS1 support overview: https://support.gs1.org/support/solutions/articles/43000734077-what-is-verified-by-gs1-
- Open Food Facts API: https://openfoodfacts.github.io/openfoodfacts-server/api/
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- NIH Dietary Supplement Label Database API: https://dsldapi.od.nih.gov/
- OpenCorporates API: https://api.opencorporates.com/documentation/API-Reference
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces

### Certifications And Labels

- B Lab Find a B Corp: https://www.bcorporation.net/en-us/
- B Lab FAQ: https://www.bcorporation.net/en-us/faq/are-there-b-corps-my-area/
- Fairtrade Finder: https://www.fairtrade.net/en/fairtrade-finder.html
- FLOCERT customer search: https://www.flocert.net/fairtrade-customer-search/
- Rainforest Alliance certificate holders: https://knowledge.rainforest-alliance.org/docs/list-of-certificate-holders
- USDA Organic INTEGRITY Database: https://agdatacommons.nal.usda.gov/articles/dataset/The_Organic_INTEGRITY_Database/24661722
- FSC certificate search: https://search.fsc.org/en/
- FSC claims check: https://fsc.org/en/claims-check
- GOTS: https://global-standard.org/
- OEKO-TEX Standard 100: https://www.oeko-tex.com/en/our-standards/oeko-tex-standard-100/
- OEKO-TEX buying guide: https://services.oeko-tex.com/buying-guide/
- MSC supplier certification: https://www.msc.org/en-us/for-business/supply-chain-companies
- MSC supplier directory help: https://cert.msc.org/supplierdirectory/MSCPages/Public/help.htm
- EPA Safer Choice: https://www.epa.gov/saferchoice
- EPA Safer Choice products: https://www.epa.gov/saferchoice/products
- Green Seal certified directory: https://certified.greenseal.org/company/core-products
- ENERGY STAR product finder: https://www.energystar.gov/productfinder/advanced
- ENERGY STAR product datasets: https://www.energystar.gov/products/productstr
- EPEAT product finder: https://www.epeat.net/product-finder
- TCO Certified product search: https://tcocertified.com/search/
- EU Ecolabel catalogue: https://environmental-data.ec.europa.eu/ecolabel/index.html
- Blue Angel: https://www.blauer-engel.de/en
- Cradle to Cradle Certified products: https://c2ccertified.org/certified-products
- PETA cruelty-free list: https://crueltyfree.peta.org/
- Leaping Bunny / Humane World guide: https://www.humaneworld.org/en/resources/consumer-guide-cruelty-free
- Vegan Action certification: https://vegan.org/certification
- BeVeg vegan certification: https://www.beveg.com/
- American Vegetarian Association: https://americanveg.org/

### Health, Safety, Labor, Climate, And Legal

- openFDA food APIs: https://open.fda.gov/apis/food/
- FDA enforcement reports: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports
- FDA iRES API docs: https://www.accessdata.fda.gov/work/recovery-package/scripts/ires/apidocs/
- USDA FSIS Recall API: https://www.fsis.usda.gov/science-data/developer-resources/recall-api
- CPSC Recalls API: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
- NHTSA datasets and APIs: https://www.nhtsa.gov/nhtsa-datasets-and-apis
- OSHA data: https://www.osha.gov/data
- OSHA establishment search: https://www.osha.gov/help/establishment-search
- U.S. DOL ILAB List of Goods: https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods
- World Benchmarking Alliance CHRB: https://www.worldbenchmarkingalliance.org/benchmark/corporate-human-rights-benchmark
- KnowTheChain methodology: https://www.business-humanrights.org/en/from-us/knowthechain/how-we-work/
- Science Based Targets initiative dashboard: https://sciencebasedtargets.org/target-dashboard
- EPA ECHO: https://echo.epa.gov/
- EPA ECHO data notes: https://echo.epa.gov/resources/echo-data/about-the-data
- EPA TRI overview: https://www.epa.gov/enviro/tri-overview
- EPA TRI search: https://www.epa.gov/enviro/tri-ez-search
