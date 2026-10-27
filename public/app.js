const featuresEl = document.querySelector("#features-list");
const pricesEl = document.querySelector("#price-list");
const planEl = document.querySelector("#plan");
const form = document.querySelector("#invoice-form");
const statusEl = document.querySelector("#form-status");
const button = form.querySelector("button");
const selectionEl = document.querySelector("#selection");

let catalog = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(amount) {
  return `$${amount}`;
}

function saleTools() {
  return catalog.tools.filter((tool) => tool.forSale && Number.isFinite(tool.price));
}

function findTool(id) {
  return catalog.tools.find((tool) => tool.id === id) || null;
}

function pointsHtml(points) {
  return `<ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`;
}

function applyBrand() {
  const { brand } = catalog;
  document.title = brand.name;
  document.querySelector(".logo").textContent = brand.name;
  document.querySelector(".tagline").textContent = brand.tagline;
  document.querySelector("#hero-title").textContent = brand.headline;
  document.querySelector("#hero-summary").textContent = brand.summary;
  document.querySelector("#invoice-note").textContent = brand.invoiceNote;
  document.querySelector("#form-reassure").textContent = `One-time payment. Lifetime access. No subscription. ${brand.invoiceNote}`;

  const email = document.querySelector("#support-email");
  email.textContent = brand.supportEmail;
  email.href = `mailto:${brand.supportEmail}`;
  document.querySelector("#footer-copy").textContent = `© 2024 ${brand.name}. All rights reserved.`;
}

function renderFeatures() {
  featuresEl.innerHTML = catalog.tools
    .map((tool) => {
      const meta = tool.forSale
        ? `${money(tool.price)} one-time`
        : "Included with WorkSuite Pro";
      return `
        <article class="feature" style="--tool:${escapeHtml(tool.color)}">
          <p class="eyebrow">${escapeHtml(meta)}</p>
          <h3>${escapeHtml(tool.name)}</h3>
          <p class="summary">${escapeHtml(tool.summary)}</p>
          <p>${escapeHtml(tool.description)}</p>
          ${pointsHtml(tool.points)}
        </article>
      `;
    })
    .join("");
}

function renderPrices() {
  pricesEl.innerHTML = saleTools()
    .map((tool) => {
      const badge = tool.badge ? `<p class="badge">${escapeHtml(tool.badge)}</p>` : "";
      return `
        <article class="price-card${tool.badge ? " featured" : ""}" style="--tool:${escapeHtml(tool.color)}">
          ${badge}
          <h3>${escapeHtml(tool.name)}</h3>
          <p class="price">${money(tool.price)} <span>one-time</span></p>
          <p>${escapeHtml(tool.description)}</p>
          ${pointsHtml(tool.points)}
          <a class="btn" href="#contact" data-plan="${escapeHtml(tool.id)}">Request Invoice</a>
        </article>
      `;
    })
    .join("");

  pricesEl.querySelectorAll("[data-plan]").forEach((link) => {
    link.addEventListener("click", () => {
      planEl.value = link.dataset.plan;
      updateSelection();
    });
  });
}

function renderPlans() {
  const tools = saleTools();
  planEl.innerHTML = tools
    .map(
      (tool) =>
        `<option value="${escapeHtml(tool.id)}">${escapeHtml(tool.name)} — ${money(tool.price)}</option>`
    )
    .join("");
  const featured = tools.find((tool) => tool.badge) || tools[0];
  if (featured) {
    planEl.value = featured.id;
  }
}

function updateSelection() {
  const tool = findTool(planEl.value);
  if (!tool) {
    selectionEl.hidden = true;
    button.textContent = "Request Invoice";
    return;
  }
  selectionEl.hidden = false;
  selectionEl.innerHTML = `
    <p class="selection-name">${escapeHtml(tool.name)}</p>
    <p class="selection-price">${money(tool.price)} one-time</p>
    <p>${escapeHtml(tool.summary)} Lifetime access. No subscription.</p>
  `;
  button.textContent = `Request invoice for ${tool.name}`;
}

function showStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

async function loadCatalog() {
  const response = await fetch("/api/catalog");
  if (!response.ok) {
    throw new Error("Could not load the tool list.");
  }
  catalog = await response.json();
  applyBrand();
  renderFeatures();
  renderPrices();
  renderPlans();
  updateSelection();
}

planEl.addEventListener("change", updateSelection);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("", "");
  button.disabled = true;

  const data = new FormData(form);
  const payload = {
    toolId: planEl.value,
    name: String(data.get("name") || "").trim(),
    email: String(data.get("email") || "").trim(),
    note: String(data.get("note") || "").trim(),
  };

  try {
    const response = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Could not send the request.");
    }
    showStatus(body.message, "ok");
    form.reset();
    renderPlans();
    updateSelection();
  } catch (error) {
    showStatus(error.message || "Could not send the request.", "err");
  } finally {
    button.disabled = false;
  }
});

loadCatalog().catch((error) => {
  featuresEl.innerHTML = `<p class="status err">${escapeHtml(error.message)}</p>`;
  showStatus(error.message, "err");
});
