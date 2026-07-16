(() => {
  "use strict";

  const STATUS_ORDER = { free: 0, booked: 1, sold: 2 };

  function formatNumber(value, maximumFractionDigits = 0) {
    if (value === null || value === undefined || value === "") return "";
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(Number(value));
  }

  function naturalCompare(a, b) {
    return String(a.number).localeCompare(String(b.number), "ru", {
      numeric: true,
      sensitivity: "base",
    });
  }

  function countLabel(status, count) {
    const labels = {
      free: count === 1 ? "свободный" : "свободных",
      booked: count === 1 ? "забронирован" : "забронировано",
      sold: count === 1 ? "продан" : "продано",
      total: count === 1 ? "участок" : "участков",
    };
    return `${formatNumber(count)} ${labels[status] || ""}`.trim();
  }

  function updateCounters(data) {
    const counts = data.counts || {};
    Object.entries(counts).forEach(([status, count]) => {
      document.querySelectorAll(`[data-plots-count="${status}"]`).forEach((element) => {
        element.textContent = formatNumber(count);
      });
      document.querySelectorAll(`[data-plots-count-label="${status}"]`).forEach((element) => {
        element.textContent = countLabel(status, count);
      });
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

    const areaText = plot.areaM2 == null
      ? "Площадь уточняется"
      : `${formatNumber(plot.areaM2)} м² · ${formatNumber(plot.areaSotki, 2)} сот.`;
    main.appendChild(makeTextElement("span", areaText));
    main.appendChild(document.createElement("br"));
    main.appendChild(makeTextElement("span", `Кадастровый № ${plot.cadastralNumber}`));

    const side = document.createElement("div");
    side.className = "plot-card-side";

    if (plot.status === "free") {
      side.appendChild(makeTextElement("strong", plot.priceText || "договорная"));
    }

    const status = makeTextElement("span", plot.statusText || "свободен", `status-pill status-pill-${plot.status || "free"}`);
    side.appendChild(status);

    card.append(main, side);
    return card;
  }

  function showState(container, text, className = "") {
    container.replaceChildren(makeTextElement("p", text, `plot-list-state ${className}`.trim()));
  }

  async function loadPlotList(container) {
    const source = container.dataset.plotsSource;
    if (!source) return;

    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-busy", "true");
    showState(container, "Загрузка участков…");

    try {
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      updateCounters(data);

      const requested = (container.dataset.statuses || "free")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const showAll = requested.includes("all");

      const plots = Array.isArray(data.plots) ? [...data.plots] : [];
      plots.sort((a, b) => {
        const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        return statusDiff || naturalCompare(a, b);
      });

      const visible = showAll ? plots : plots.filter((plot) => requested.includes(plot.status));
      if (!visible.length) {
        showState(container, "Подходящих участков сейчас нет.", "plot-list-empty");
        return;
      }

      const fragment = document.createDocumentFragment();
      visible.forEach((plot) => fragment.appendChild(renderPlot(plot)));
      container.replaceChildren(fragment);

      if (data.complete === false) {
        const warning = makeTextElement(
          "p",
          "Часть данных временно не обновилась. Показана последняя успешно полученная информация.",
          "plot-list-warning"
        );
        container.prepend(warning);
      }
    } catch (error) {
      console.error("Не удалось загрузить список участков:", error);
      showState(
        container,
        "Не удалось загрузить список участков. Обновите страницу или уточните наличие по телефону.",
        "plot-list-error"
      );
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-plots-source]").forEach(loadPlotList);
  });
})();
