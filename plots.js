(() => {
  "use strict";

  const STATUS_ORDER = { free: 0, booked: 1, sold: 2 };
  const dataBySource = new Map();
  let allSources = new Set();

  function formatNumber(value, maximumFractionDigits = 0) {
    if (value === null || value === undefined || value === "") return "";
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(Number(value));
  }

  function naturalCompare(a, b) {
    return String(a.number).localeCompare(String(b.number), "ru", { numeric: true, sensitivity: "base" });
  }

  function countLabel(status, count) {
    const n = Number(count) || 0;
    if (status === "total") {
      const mod10 = n % 10;
      const mod100 = n % 100;
      const word = mod10 === 1 && mod100 !== 11 ? "участок" : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "участка" : "участков");
      return `${formatNumber(n)} ${word}`;
    }
    if (status === "free") return `${formatNumber(n)} ${n === 1 ? "свободный" : "свободных"}`;
    if (status === "booked") return `${formatNumber(n)} ${n === 1 ? "забронирован" : "забронировано"}`;
    if (status === "sold") return `${formatNumber(n)} ${n === 1 ? "продан" : "продано"}`;
    return formatNumber(n);
  }

  function splitSources(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  function updateSourceCounters(data, source) {
    const counts = data.counts || {};
    document.querySelectorAll("[data-plots-count]").forEach((element) => {
      const status = element.dataset.plotsCount;
      const requiredSource = element.dataset.plotsCountSource;
      if (requiredSource === source || (!requiredSource && allSources.size === 1)) {
        if (Object.prototype.hasOwnProperty.call(counts, status)) element.textContent = formatNumber(counts[status]);
      }
    });
    document.querySelectorAll("[data-plots-count-label]").forEach((element) => {
      const status = element.dataset.plotsCountLabel;
      const requiredSource = element.dataset.plotsCountLabelSource;
      if (requiredSource === source || (!requiredSource && allSources.size === 1)) {
        if (Object.prototype.hasOwnProperty.call(counts, status)) element.textContent = countLabel(status, counts[status]);
      }
    });
    updateAggregateCounters();
  }

  function aggregateValue(status, sources) {
    if (!sources.length || !sources.every((source) => dataBySource.has(source))) return null;
    return sources.reduce((sum, source) => sum + Number((dataBySource.get(source).counts || {})[status] || 0), 0);
  }

  function updateAggregateCounters() {
    document.querySelectorAll("[data-plots-count-aggregate]").forEach((element) => {
      const status = element.dataset.plotsCountAggregate;
      const value = aggregateValue(status, splitSources(element.dataset.plotsAggregateSources));
      if (value !== null) element.textContent = formatNumber(value);
    });
    document.querySelectorAll("[data-plots-count-label-aggregate]").forEach((element) => {
      const status = element.dataset.plotsCountLabelAggregate;
      const value = aggregateValue(status, splitSources(element.dataset.plotsAggregateSources));
      if (value !== null) element.textContent = countLabel(status, value);
    });
  }

  function makeTextElement(tag, text, className = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderPlot(plot) {
    const card = document.createElement("div");
    card.className = `plot-card plot-card-${plot.status || "free"}`;

    const main = document.createElement("div");
    main.appendChild(makeTextElement("strong", `Участок №${plot.number}`));
    main.appendChild(document.createElement("br"));
    const areaText = plot.areaM2 == null ? "Площадь уточняется" : `${formatNumber(plot.areaM2)} м² · ${formatNumber(plot.areaSotki, 2)} сот.`;
    main.appendChild(makeTextElement("span", areaText));
    main.appendChild(document.createElement("br"));
    main.appendChild(makeTextElement("span", `Кадастровый № ${plot.cadastralNumber}`));

    const side = document.createElement("div");
    side.className = "plot-card-side";
    if (plot.status === "free") side.appendChild(makeTextElement("strong", plot.priceText || "договорная"));
    side.appendChild(makeTextElement("span", plot.statusText || "свободен", `status-pill status-pill-${plot.status || "free"}`));
    card.append(main, side);
    return card;
  }

  function showState(container, text, className = "") {
    container.replaceChildren(makeTextElement("p", text, `plot-list-state ${className}`.trim()));
  }

  function renderList(container, data) {
    const requested = (container.dataset.statuses || "free").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const showAll = requested.includes("all");
    const plots = Array.isArray(data.plots) ? [...data.plots] : [];
    plots.sort((a, b) => {
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      return statusDiff || naturalCompare(a, b);
    });
    const visible = showAll ? plots : plots.filter((plot) => requested.includes(plot.status));
    if (!visible.length) {
      showState(container, container.dataset.emptyMessage || "Подходящих участков сейчас нет.", "plot-list-empty");
      return;
    }
    const fragment = document.createDocumentFragment();
    visible.forEach((plot) => fragment.appendChild(renderPlot(plot)));
    container.replaceChildren(fragment);
    if (data.complete === false) {
      container.prepend(makeTextElement("p", "Часть данных временно не обновилась. Показана последняя успешно полученная информация.", "plot-list-warning"));
    }
  }

  async function fetchData(source) {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
    const data = await response.json();
    dataBySource.set(source, data);
    updateSourceCounters(data, source);
    return data;
  }

  function collectSources() {
    const sources = new Set();
    document.querySelectorAll("[data-plots-source]").forEach((element) => sources.add(element.dataset.plotsSource));
    document.querySelectorAll("[data-plots-count-source]").forEach((element) => sources.add(element.dataset.plotsCountSource));
    document.querySelectorAll("[data-plots-count-label-source]").forEach((element) => sources.add(element.dataset.plotsCountLabelSource));
    document.querySelectorAll("[data-plots-aggregate-sources]").forEach((element) => splitSources(element.dataset.plotsAggregateSources).forEach((source) => sources.add(source)));
    sources.delete("");
    return sources;
  }

  document.addEventListener("DOMContentLoaded", () => {
    allSources = collectSources();
    const containersBySource = new Map();
    document.querySelectorAll("[data-plots-source]").forEach((container) => {
      const source = container.dataset.plotsSource;
      container.setAttribute("aria-live", "polite");
      container.setAttribute("aria-busy", "true");
      showState(container, "Загрузка участков…");
      if (!containersBySource.has(source)) containersBySource.set(source, []);
      containersBySource.get(source).push(container);
    });

    allSources.forEach((source) => {
      fetchData(source)
        .then((data) => (containersBySource.get(source) || []).forEach((container) => renderList(container, data)))
        .catch((error) => {
          console.error("Не удалось загрузить данные участков:", error);
          (containersBySource.get(source) || []).forEach((container) => showState(container, "Не удалось загрузить список участков. Обновите страницу или уточните наличие по телефону.", "plot-list-error"));
        })
        .finally(() => (containersBySource.get(source) || []).forEach((container) => container.setAttribute("aria-busy", "false")));
    });
  });
})();
