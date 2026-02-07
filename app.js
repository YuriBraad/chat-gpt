function createStorage() {
  const memoryStore = new Map();

  function storageAvailable(storage) {
    try {
      const testKey = "__inventory_test__";
      storage.setItem(testKey, "ok");
      storage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  const backends = [
    { name: "localStorage", store: window.localStorage },
    { name: "sessionStorage", store: window.sessionStorage }
  ];

  const activeBackend = backends.find((backend) => storageAvailable(backend.store));

  function getRaw(key) {
    if (activeBackend) {
      return activeBackend.store.getItem(key);
    }
    return memoryStore.get(key) ?? null;
  }

  function setRaw(key, value) {
    if (activeBackend) {
      activeBackend.store.setItem(key, value);
      return;
    }
    memoryStore.set(key, value);
  }

  function showStorageWarning() {
    if (activeBackend) {
      return;
    }
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.innerHTML = `
      <strong>Let op:</strong>
      <span class="small">Je browser blokkeert opslag. Gegevens worden alleen tijdelijk bewaard.</span>
    `;
    const target = document.querySelector("main");
    if (target) {
      target.prepend(notice);
    }
  }

  return {
    backendName: activeBackend ? activeBackend.name : "memory",
    get(key, fallback) {
      const raw = getRaw(key);
      if (!raw) {
        return fallback;
      }
      try {
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      setRaw(key, JSON.stringify(value));
    },
    showStorageWarning
  };
}

const storage = createStorage();

const keys = {
  products: "inventory_products",
  categories: "inventory_categories",
  events: "inventory_events",
  orderlist: "inventory_orderlist"
};

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const defaultCategories = [
  { id: "cat-krat", name: "Krat", multiplier: 24 },
  { id: "cat-doos", name: "Doos", multiplier: 12 }
];

function ensureDefaults() {
  if (!storage.get(keys.categories)) {
    storage.set(keys.categories, defaultCategories);
  }
  if (!storage.get(keys.products)) {
    storage.set(keys.products, []);
  }
  if (!storage.get(keys.events)) {
    storage.set(keys.events, []);
  }
  if (!storage.get(keys.orderlist)) {
    storage.set(keys.orderlist, []);
  }
}

function getProducts() {
  return storage.get(keys.products, []);
}

function setProducts(products) {
  storage.set(keys.products, products);
}

function getCategories() {
  return storage.get(keys.categories, defaultCategories);
}

function setCategories(categories) {
  storage.set(keys.categories, categories);
}

function getEvents() {
  return storage.get(keys.events, []);
}

function setEvents(events) {
  storage.set(keys.events, events);
}

function getOrderlist() {
  return storage.get(keys.orderlist, []);
}

function setOrderlist(orderlist) {
  storage.set(keys.orderlist, orderlist);
}

function productStatus(product) {
  if (product.quantity < product.min) {
    return "danger";
  }
  if (product.quantity <= product.min + 2) {
    return "warn";
  }
  return "ok";
}

function getCategoryLabel(product) {
  const category = getCategories().find((item) => item.id === product.categoryId);
  return category ? `${category.name} (x${category.multiplier})` : "Geen";
}

function computeTotals() {
  const products = getProducts();
  const totalItems = products.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
  return { count: products.length, totalItems };
}

function computeEventNeeds() {
  const events = getEvents();
  const needs = {};
  events.forEach((event) => {
    event.items.forEach((item) => {
      if (!needs[item.productId]) {
        needs[item.productId] = { quantity: 0, events: [] };
      }
      needs[item.productId].quantity += Number(item.quantity || 0);
      needs[item.productId].events.push(event.name);
    });
  });
  return needs;
}

function computeSuggestions() {
  const products = getProducts();
  const suggestions = [];

  products.forEach((product) => {
    if (product.quantity < product.min) {
      suggestions.push({
        productId: product.id,
        quantity: product.min - product.quantity,
        reason: `Onder minimum (min ${product.min}, huidig ${product.quantity}).`
      });
    }
  });

  const needs = computeEventNeeds();
  Object.entries(needs).forEach(([productId, data]) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }
    if (product.quantity < data.quantity) {
      const deficit = data.quantity - product.quantity;
      const eventNames = [...new Set(data.events)].join(", ");
      suggestions.push({
        productId,
        quantity: deficit,
        reason: `Verwacht tekort voor evenementen (${eventNames}): nodig ${data.quantity}, beschikbaar ${product.quantity}.`
      });
    }
  });

  return suggestions;
}

function mergeSuggestionsIntoOrderlist() {
  const orderlist = getOrderlist();
  const suggestions = computeSuggestions();
  const merged = [...orderlist];

  suggestions.forEach((suggestion) => {
    const existing = merged.find((item) => item.productId === suggestion.productId);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, suggestion.quantity);
      existing.reason = existing.reason ? `${existing.reason} ${suggestion.reason}` : suggestion.reason;
    } else {
      merged.push({
        id: uid(),
        productId: suggestion.productId,
        quantity: suggestion.quantity,
        reason: suggestion.reason
      });
    }
  });

  setOrderlist(merged);
  return merged;
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }
  return new Date(dateString).toLocaleDateString("nl-NL", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function setActiveNav() {
  const page = document.body.dataset.page;
  document.querySelectorAll("nav a").forEach((link) => {
    if (link.dataset.page === page) {
      link.classList.add("active");
    }
  });
}

function renderDashboard() {
  const totals = computeTotals();
  document.getElementById("product-count").textContent = totals.count;
  document.getElementById("item-count").textContent = totals.totalItems;

  const orderlist = getOrderlist();
  const products = getProducts();
  const orderlistContainer = document.getElementById("orderlist-items");
  orderlistContainer.innerHTML = "";
  let totalPrice = 0;

  orderlist.forEach((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) {
      return;
    }
    const itemTotal = (Number(product.price) || 0) * item.quantity;
    totalPrice += itemTotal;
    const row = document.createElement("div");
    row.className = "card";
    row.innerHTML = `
      <strong>${product.name}</strong><br />
      <span class="small">${item.quantity} stuks · € ${itemTotal.toFixed(2)}</span>
    `;
    orderlistContainer.appendChild(row);
  });

  document.getElementById("orderlist-total").textContent = `€ ${totalPrice.toFixed(2)}`;

  const eventsContainer = document.getElementById("event-list");
  eventsContainer.innerHTML = "";
  getEvents().forEach((event) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${event.name}</strong><br />
      <span class="small">${formatDate(event.date)} · ${event.repeat}</span>
    `;
    eventsContainer.appendChild(card);
  });
}

function renderInventory() {
  const tbody = document.getElementById("inventory-body");
  tbody.innerHTML = "";
  const products = getProducts();

  products.forEach((product) => {
    const status = productStatus(product);
    const row = document.createElement("tr");
    row.className = `status-${status}`;
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${getCategoryLabel(product)}</td>
      <td>${product.quantity}</td>
      <td>${product.min}</td>
      <td>
        <span class="badge ${status}">
          ${status === "danger" ? "Onder minimum" : status === "warn" ? "Bijna minimum" : "Voldoende"}
        </span>
      </td>
      <td>
        <div class="inline-actions">
          <button class="icon" data-action="minus" data-id="${product.id}">-</button>
          <button class="icon" data-action="plus" data-id="${product.id}">+</button>
          <button class="ghost" data-action="min" data-id="${product.id}">Instellingen</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderInventoryEntry() {
  const categorySelect = document.getElementById("category");
  categorySelect.innerHTML = "<option value="">Geen categorie</option>";
  getCategories().forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name} (x${category.multiplier})`;
    categorySelect.appendChild(option);
  });

  const unitInput = document.getElementById("category-units");
  const quantityInput = document.getElementById("quantity");
  const helper = document.getElementById("category-helper");

  function updateHelper() {
    const selected = getCategories().find((item) => item.id === categorySelect.value);
    if (!selected) {
      helper.textContent = "";
      return;
    }
    helper.textContent = `1 ${selected.name} = ${selected.multiplier} stuks.`;
  }

  categorySelect.addEventListener("change", () => {
    updateHelper();
    unitInput.value = "";
  });

  unitInput.addEventListener("input", () => {
    const selected = getCategories().find((item) => item.id === categorySelect.value);
    if (!selected) {
      return;
    }
    const units = Number(unitInput.value || 0);
    quantityInput.value = units * selected.multiplier;
  });

  updateHelper();

  const form = document.getElementById("inventory-form");
  if (form.dataset.bound === "true") {
    return;
  }
  form.dataset.bound = "true";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const products = getProducts();
    products.push({
      id: uid(),
      name: formData.get("name"),
      categoryId: formData.get("category"),
      quantity: Number(formData.get("quantity")),
      min: Number(formData.get("min")),
      price: Number(formData.get("price"))
    });
    setProducts(products);
    event.target.reset();
    unitInput.value = "";
    updateHelper();
    alert("Product toegevoegd!");
  });
}

function renderAgenda() {
  const productOptions = getProducts()
    .map((product) => `<option value="${product.id}">${product.name}</option>`)
    .join("");
  const container = document.getElementById("agenda-items");

  function renderAgendaList() {
    const list = document.getElementById("agenda-list");
    list.innerHTML = "";
    getEvents().forEach((event) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <strong>${event.name}</strong>
        <div class="small">${formatDate(event.date)} · ${event.repeat}</div>
        <div class="small">Verwachting: ${event.items
          .map((item) => {
            const product = getProducts().find((entry) => entry.id === item.productId);
            return `${product ? product.name : "Onbekend"} (${item.quantity})`;
          })
          .join(", ")}</div>
      `;
      list.appendChild(card);
    });
  }

  function addItemRow() {
    const row = document.createElement("div");
    row.className = "grid-2";
    row.innerHTML = `
      <div>
        <label>Product</label>
        <select name="productId" required>
          <option value="">Selecteer product</option>
          ${productOptions}
        </select>
      </div>
      <div>
        <label>Verwacht aantal</label>
        <input type="number" name="expected" min="0" step="1" required />
      </div>
    `;
    container.appendChild(row);
  }

  const addButton = document.getElementById("add-agenda-item");
  addButton.onclick = () => {
    addItemRow();
  };

  const form = document.getElementById("agenda-form");
  if (form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const items = [];
      const rows = container.querySelectorAll(".grid-2");
      rows.forEach((row) => {
        const productId = row.querySelector("select").value;
        const quantity = Number(row.querySelector("input").value || 0);
        if (productId) {
          items.push({ productId, quantity });
        }
      });
      const events = getEvents();
      events.push({
        id: uid(),
        name: formData.get("name"),
        date: formData.get("date"),
        repeat: formData.get("repeat"),
        items
      });
      setEvents(events);
      event.target.reset();
      container.innerHTML = "";
      addItemRow();
      renderAgendaList();
      alert("Evenement opgeslagen!");
    });
  }

  if (container.children.length === 0) {
    addItemRow();
  }

  renderAgendaList();
}

function renderSettings() {
  const list = document.getElementById("category-list");
  list.innerHTML = "";
  getCategories().forEach((category) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${category.name}</strong>
      <div class="small">${category.multiplier} stuks per categorie</div>
    `;
    list.appendChild(card);
  });

  const form = document.getElementById("category-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const categories = getCategories();
    categories.push({
      id: uid(),
      name: formData.get("name"),
      multiplier: Number(formData.get("multiplier"))
    });
    setCategories(categories);
    event.target.reset();
    renderSettings();
  };
}

function renderOrderlist() {
  const products = getProducts();
  const suggestions = computeSuggestions();
  const suggestionContainer = document.getElementById("suggestions");
  suggestionContainer.innerHTML = "";

  if (suggestions.length === 0) {
    suggestionContainer.innerHTML = "<p class=\"small\">Geen voorstellen op dit moment.</p>";
  } else {
    suggestions.forEach((suggestion) => {
      const product = products.find((item) => item.id === suggestion.productId);
      if (!product) {
        return;
      }
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <strong>${product.name}</strong>
        <div class="small">Voorstel: ${suggestion.quantity} stuks</div>
        <div class="small">${suggestion.reason}</div>
      `;
      suggestionContainer.appendChild(card);
    });
  }

  const applyButton = document.getElementById("apply-suggestions");
  applyButton.onclick = () => {
    mergeSuggestionsIntoOrderlist();
    renderOrderlist();
  };

  const orderlist = getOrderlist();
  const listContainer = document.getElementById("orderlist");
  listContainer.innerHTML = "";
  let totalPrice = 0;

  orderlist.forEach((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) {
      return;
    }
    const itemTotal = (Number(product.price) || 0) * item.quantity;
    totalPrice += itemTotal;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${product.name}</strong>
      <div class="small">${item.quantity} stuks · € ${itemTotal.toFixed(2)}</div>
      <div class="small">${item.reason || "Handmatig toegevoegd"}</div>
    `;
    listContainer.appendChild(card);
  });

  document.getElementById("orderlist-total").textContent = `€ ${totalPrice.toFixed(2)}`;

  const productSelect = document.getElementById("order-product");
  productSelect.innerHTML = "<option value=\"\">Selecteer product</option>";
  products.forEach((product) => {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = product.name;
    productSelect.appendChild(option);
  });

  const orderForm = document.getElementById("order-form");
  orderForm.onsubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const orderlistItems = getOrderlist();
    orderlistItems.push({
      id: uid(),
      productId: formData.get("order-product"),
      quantity: Number(formData.get("order-quantity")),
      reason: formData.get("order-reason")
    });
    setOrderlist(orderlistItems);
    event.target.reset();
    renderOrderlist();
  };
}

function wireInventoryActions() {
  const table = document.getElementById("inventory-body");
  if (!table) {
    return;
  }

  table.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    const id = event.target.dataset.id;
    if (!action || !id) {
      return;
    }
    const products = getProducts();
    const product = products.find((item) => item.id === id);
    if (!product) {
      return;
    }
    if (action === "plus") {
      product.quantity += 1;
    }
    if (action === "minus") {
      product.quantity = Math.max(0, product.quantity - 1);
    }
    if (action === "min") {
      const newMin = prompt("Nieuw minimum voor " + product.name, String(product.min));
      if (newMin !== null && newMin !== "") {
        product.min = Number(newMin);
      }
    }
    setProducts(products);
    renderInventory();
  });
}

ensureDefaults();

document.addEventListener("DOMContentLoaded", () => {
  setActiveNav();
  storage.showStorageWarning();
  const page = document.body.dataset.page;
  if (page === "dashboard") {
    renderDashboard();
  }
  if (page === "inventory") {
    renderInventory();
    wireInventoryActions();
  }
  if (page === "inventory-entry") {
    renderInventoryEntry();
  }
  if (page === "agenda") {
    renderAgenda();
  }
  if (page === "settings") {
    renderSettings();
  }
  if (page === "orderlist") {
    renderOrderlist();
  }
});
