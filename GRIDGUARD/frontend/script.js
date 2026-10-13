
"use strict";

/* =========================================================
   GRIDGUARD — INTERACTIVE FRONTEND
   Connects to the existing Flask Python API.
   All telemetry is explicitly treated as simulated data.
   ========================================================= */

const API = {
    health: "/api/health",
    dashboard: "/api/dashboard",
    simulate: "/api/simulate-leak",
    reset: "/api/reset"
};

const REFRESH_INTERVAL = 3000;
const MAX_EVENTS = 60;

const state = {
    connected: false,
    dashboard: null,
    history: [],
    events: [],
    eventFilter: "all",
    selectedPipe: null,
    refreshTimer: null,
    refreshInProgress: false,
    busy: false,
    chartHoverIndex: null,
    lastPayloadSignature: null
};

const $ = (selector, root = document) => root.querySelector(selector);

const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

const SVG_NS = "http://www.w3.org/2000/svg";

const formatNumber = (value, digits = 2) => {
    const number = Number(value);

    return Number.isFinite(number)
        ? number.toFixed(digits)
        : "—";
};

const signedNumber = (value, digits = 2) => {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
};

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);

function localTime() {
    return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function eventTimestamp() {
    return new Date().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function addEvent(type, title, message) {
    state.events.unshift({
        id: `${Date.now()}-${Math.random()}`,
        type,
        title,
        message,
        time: eventTimestamp()
    });

    state.events = state.events.slice(0, MAX_EVENTS);

    renderEvents();
}

function showToast(title, message, type = "success") {
    const container = $("#toastContainer");

    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast-error" : ""}`;

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "error" ? "!" : "✓";

    const content = document.createElement("div");

    const heading = document.createElement("strong");
    heading.textContent = title;

    const description = document.createElement("p");
    description.textContent = message;

    content.append(heading, description);
    toast.append(icon, content);
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 5000);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? {
                "Content-Type": "application/json"
            } : {}),
            ...options.headers
        }
    });

    const contentType = response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        throw new Error(
            `Expected JSON from ${url}. Check that the Python API is running.`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error || `Request failed (${response.status}).`
        );
    }

    return data;
}

/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function setConnectionStatus(connected, message = "") {
    state.connected = connected;

    const dotSelectors = [
        "#sidebarStatusDot",
        "#topStatusDot"
    ];

    dotSelectors.forEach(selector => {
        const dot = $(selector);

        if (dot) {
            dot.classList.toggle("offline", !connected);
        }
    });

    const sidebarLabel = $("#connectionLabel");
    const sidebarDescription = $("#connectionDescription");
    const topStatusText = $("#topStatusText");
    const footerStatus = $("#footerApiStatus");
    const refreshButton = $("#refreshButton");

    if (sidebarLabel) {
        sidebarLabel.textContent = connected
            ? "Python API connected"
            : "API disconnected";
    }

    if (sidebarDescription) {
        sidebarDescription.textContent = connected
            ? "Receiving data from the local GRIDGUARD service."
            : message || "Cannot reach the Python API.";
    }

    if (topStatusText) {
        topStatusText.textContent = connected
            ? "API connected"
            : "Offline";
    }

    if (footerStatus) {
        footerStatus.textContent = connected
            ? "Connected"
            : "Disconnected";
    }

    if (refreshButton) {
        refreshButton.disabled = !connected;
    }
}

async function checkConnection() {
    try {
        await apiRequest(API.health);
        setConnectionStatus(true);
        return true;
    } catch (error) {
        setConnectionStatus(false, error.message);
        return false;
    }
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
    bindNavigation();
    bindSimulator();
    bindMonitoringFilters();
    bindAlertFilters();
    bindModal();
    bindButtons();
    bindChartInteraction();
    bindKeyboardShortcuts();

    updateSeverityDisplay();

    addEvent(
        "system",
        "Dashboard initialized",
        "GRIDGUARD frontend is ready to connect to the Python simulation."
    );

    startPolling();
}

function startPolling() {
    if (state.refreshTimer) {
        window.clearInterval(state.refreshTimer);
    }

    refreshDashboard();

    state.refreshTimer = window.setInterval(() => {
        refreshDashboard();
    }, REFRESH_INTERVAL);
}

/* =========================================================
   DASHBOARD DATA
   ========================================================= */

async function refreshDashboard(manual = false) {
    if (state.refreshInProgress) return;

    state.refreshInProgress = true;

    try {
        const data = await apiRequest(API.dashboard);

        state.dashboard = data;

        setConnectionStatus(true);
        renderDashboard(data);

        if (manual) {
            showToast(
                "Data refreshed",
                "Latest data received from the Python API."
            );
        }
    } catch (error) {
        setConnectionStatus(false, error.message);

        if (manual) {
            showToast(
                "Refresh failed",
                error.message,
                "error"
            );
        }
    } finally {
        state.refreshInProgress = false;
    }
}

function renderDashboard(data) {
    renderMetrics(data);
    renderNetwork(data);
    renderPipeOptions(data);
    renderMonitoring(data);
    renderDetections(data);
    renderPressureChart(data);
    renderSimulatorStatus(data);
    updateTimestamps(data);
}

function updateTimestamps(data) {
    const lastUpdated = $("#lastUpdated");

    if (lastUpdated) {
        lastUpdated.textContent = data.generated_at || localTime();
    }
}

/* =========================================================
   METRIC CARDS
   ========================================================= */

function renderMetrics(data) {
    const network = data.network || {};
    const telemetry = data.telemetry || {};
    const summary = data.summary || {};
    const detections = data.detections || [];

    setText("#junctionCount", network.node_count ?? 0);
    setText("#pipeCount", network.pipe_count ?? 0);

    setText(
        "#averagePressure",
        formatNumber(telemetry.average_pressure)
    );

    setText("#activeLeakCount", summary.active_leaks ?? detections.length);
    setText("#navLeakCount", detections.length);

    setText(
        "#leakStatusText",
        detections.length
            ? "Simulated leak detected"
            : "No simulated leaks"
    );

    setText(
        "#networkHealthLabel",
        detections.length ? "Attention required" : "Network stable"
    );

    setText(
        "#networkStatusText",
        summary.network_status || "Unknown"
    );

    const leakDot = $("#leakStatusDot");

    if (leakDot) {
        leakDot.style.color = detections.length
            ? "var(--red)"
            : "var(--green)";
    }

    const activeConnections = $("#activeConnections");

    if (activeConnections) {
        activeConnections.textContent =
            `${network.pipe_count ?? 0} segments`;
    }
}

function setText(selector, value) {
    const element = $(selector);

    if (element) {
        element.textContent = String(value);
    }
}

/* =========================================================
   PIPELINE SVG MAP
   ========================================================= */

function svgElement(tag, attributes = {}, textContent = null) {
    const element = document.createElementNS(SVG_NS, tag);

    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
    });

    if (textContent !== null) {
        element.textContent = textContent;
    }

    return element;
}

function renderNetwork(data) {
    const svg = $("#networkSvg");

    if (!svg) return;

    const network = data.network || {};
    const nodes = network.nodes || [];
    const edges = network.edges || [];

    svg.replaceChildren();

    if (!nodes.length) {
        svg.appendChild(
            svgElement(
                "text",
                {
                    x: 50,
                    y: 50,
                    "text-anchor": "middle",
                    fill: "#9aabc5",
                    "font-size": 4
                },
                "No pipeline data available"
            )
        );

        return;
    }

    const positions = new Map(
        nodes.map(node => [node.id, node])
    );

    // Pipes are drawn first so junctions remain visible above them.
    edges.forEach(edge => {
        const start = positions.get(edge.start);
        const end = positions.get(edge.end);

        if (!start || !end) return;

        const group = svgElement("g", {
            class: `network-edge${edge.leak ? " is-leaking" : ""}`,
            tabindex: 0,
            role: "button",
            "aria-label": `Inspect pipe ${edge.id}`,
            "data-pipe-id": edge.id
        });

        group.appendChild(
            svgElement("line", {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                class: "pipe-hitbox"
            })
        );

        group.appendChild(
            svgElement("line", {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                class: "pipe-base"
            })
        );

        group.appendChild(
            svgElement("line", {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                class: "pipe-overlay"
            })
        );

        const midX = (Number(start.x) + Number(end.x)) / 2;
        const midY = (Number(start.y) + Number(end.y)) / 2;

        const label = svgElement(
            "text",
            {
                x: midX,
                y: midY - 2.1,
                "text-anchor": "middle",
                class: `pipe-label${edge.leak ? " leak-label" : ""}`
            },
            edge.id
        );

        group.appendChild(label);

        if (edge.leak) {
            group.appendChild(
                svgElement("circle", {
                    cx: midX,
                    cy: midY,
                    r: 1.1,
                    class: "leak-pulse"
                })
            );
        }

        group.addEventListener("click", () => {
            openPipeDetails(edge);
        });

        group.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPipeDetails(edge);
            }
        });

        svg.appendChild(group);
    });

    // Junctions are interactive too.
    nodes.forEach(node => {
        const group = svgElement("g", {
            class: `network-node${node.status === "warning" ? " node-warning" : ""}`,
            tabindex: 0,
            role: "button",
            "aria-label": `Inspect junction ${node.id}`,
            "data-node-id": node.id
        });

        group.appendChild(
            svgElement("circle", {
                cx: node.x,
                cy: node.y,
                r: 4.1,
                class: "node-halo"
            })
        );

        group.appendChild(
            svgElement("circle", {
                cx: node.x,
                cy: node.y,
                r: 2,
                class: "node-core"
            })
        );

        const labelY = Number(node.y) - 6;

        group.appendChild(
            svgElement(
                "text",
                {
                    x: node.x,
                    y: labelY,
                    "text-anchor": "middle",
                    class: "node-label"
                },
                node.id
            )
        );

        group.appendChild(
            svgElement(
                "text",
                {
                    x: node.x,
                    y: Number(node.y) + 7,
                    "text-anchor": "middle",
                    class: "node-value"
                },
                `${formatNumber(node.pressure, 1)} PSI`
            )
        );

        group.addEventListener("click", () => {
            openJunctionDetails(node);
        });

        group.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openJunctionDetails(node);
            }
        });

        svg.appendChild(group);
    });
}

/* =========================================================
   PIPE DETAILS MODAL
   ========================================================= */

function bindModal() {
    const backdrop = $("#pipeModalBackdrop");

    $("#closePipeModal")?.addEventListener("click", closePipeModal);
    $("#closePipeModalButton")?.addEventListener("click", closePipeModal);

    backdrop?.addEventListener("click", event => {
        if (event.target === backdrop) {
            closePipeModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closePipeModal();
        }
    });
}

function openModal(title, html) {
    setText("#pipeModalTitle", title);

    const content = $("#pipeModalContent");

    if (content) {
        content.innerHTML = html;
    }

    $("#pipeModalBackdrop")?.classList.remove("hidden");
    $("#closePipeModal")?.focus();
}

function closePipeModal() {
    $("#pipeModalBackdrop")?.classList.add("hidden");
}

function openPipeDetails(edge) {
    const start = state.dashboard?.network?.nodes?.find(
        node => node.id === edge.start
    );

    const end = state.dashboard?.network?.nodes?.find(
        node => node.id === edge.end
    );

    const status = edge.leak
        ? "Simulated leak"
        : "Normal in simulation";

    const severity = edge.leak
        ? `${Math.round(Number(edge.severity) * 100)}%`
        : "0%";

    const description = edge.leak
        ? "This segment is marked as leaking in the current simulation. The displayed detector result is based on the simulator's leak label."
        : "This segment is not marked as leaking in the current simulation. This does not prove that a real-world pipe is leak-free.";

    const html = `
        <div class="modal-detail-grid">
            <div class="modal-detail">
                <span>Pipe identifier</span>
                <strong>${escapeHTML(edge.id)}</strong>
            </div>
            <div class="modal-detail">
                <span>Segment length</span>
                <strong>${formatNumber(edge.length, 0)} m</strong>
            </div>
            <div class="modal-detail">
                <span>Simulation status</span>
                <strong>${escapeHTML(status)}</strong>
            </div>
            <div class="modal-detail">
                <span>Configured severity</span>
                <strong>${severity}</strong>
            </div>
            <div class="modal-detail">
                <span>Start junction</span>
                <strong>${escapeHTML(edge.start)}</strong>
                <small>${formatNumber(start?.pressure)} PSI*</small>
            </div>
            <div class="modal-detail">
                <span>End junction</span>
                <strong>${escapeHTML(edge.end)}</strong>
                <small>${formatNumber(end?.pressure)} PSI*</small>
            </div>
        </div>
        <p class="modal-description">${escapeHTML(description)}</p>
    `;

    state.selectedPipe = edge.id;
    openModal(`Pipe ${edge.id}`, html);
}

function openJunctionDetails(node) {
    const html = `
        <div class="modal-detail-grid">
            <div class="modal-detail">
                <span>Junction identifier</span>
                <strong>${escapeHTML(node.id)}</strong>
            </div>
            <div class="modal-detail">
                <span>Simulation status</span>
                <strong>${escapeHTML(node.status || "normal")}</strong>
            </div>
            <div class="modal-detail">
                <span>Current pressure</span>
                <strong>${formatNumber(node.pressure)} PSI*</strong>
            </div>
            <div class="modal-detail">
                <span>Healthy baseline</span>
                <strong>${formatNumber(node.healthy_pressure)} PSI*</strong>
            </div>
            <div class="modal-detail">
                <span>Current flow</span>
                <strong>${formatNumber(node.flow)}</strong>
            </div>
            <div class="modal-detail">
                <span>Pressure variance</span>
                <strong>${signedNumber(
                    Number(node.pressure) - Number(node.healthy_pressure)
                )} PSI*</strong>
            </div>
        </div>
        <p class="modal-description">
            Junction readings are generated by the GRIDGUARD simulation.
            They are illustrative values, not physical sensor measurements.
        </p>
    `;

    openModal(`Junction ${node.id}`, html);
}

/* =========================================================
   PIPE SELECTOR
   ========================================================= */

function renderPipeOptions(data) {
    const select = $("#pipeSelect");

    if (!select) return;

    const edges = data.network?.edges || [];
    const previousValue = select.value;

    select.replaceChildren();

    if (!edges.length) {
        select.add(new Option("No pipe segments available", ""));
        return;
    }

    edges.forEach(edge => {
        const label = `${edge.id} · ${edge.length} m`;
        select.add(new Option(label, edge.id));
    });

    if (edges.some(edge => edge.id === previousValue)) {
        select.value = previousValue;
    } else if (edges.some(edge => edge.id === "J1-J2")) {
        select.value = "J1-J2";
    }
}

/* =========================================================
   SIMULATOR CONTROLS
   ========================================================= */

function bindSimulator() {
    $("#severitySlider")?.addEventListener("input", updateSeverityDisplay);

    $("#leakForm")?.addEventListener("submit", async event => {
        event.preventDefault();

        if (state.busy) return;

        const selectedPipe = $("#pipeSelect")?.value;
        const severity = Number($("#severitySlider")?.value || 50) / 100;

        if (!selectedPipe) {
            showToast(
                "Select a pipe",
                "Choose a valid pipe segment first.",
                "error"
            );
            return;
        }

        const [pipe_start, pipe_end] = selectedPipe.split("-");

        if (!pipe_start || !pipe_end) {
            showToast(
                "Invalid pipe",
                "The selected pipe identifier is not valid.",
                "error"
            );
            return;
        }

        setBusy(true);

        try {
            const result = await apiRequest(API.simulate, {
                method: "POST",
                body: JSON.stringify({
                    pipe_start,
                    pipe_end,
                    severity
                })
            });

            if (result.dashboard) {
                state.dashboard = result.dashboard;
                renderDashboard(result.dashboard);
            } else {
                await refreshDashboard();
            }

            const percent = Math.round(severity * 100);

            addEvent(
                "leak",
                "Leak simulation activated",
                `Pipe ${selectedPipe} · Configured severity ${percent}%.`
            );

            showToast(
                "Simulation updated",
                `A simulated leak is active on ${selectedPipe}.`
            );
        } catch (error) {
            showToast(
                "Could not simulate leak",
                error.message,
                "error"
            );
        } finally {
            setBusy(false);
        }
    });

    $("#resetButton")?.addEventListener("click", async () => {
        if (state.busy) return;

        setBusy(true);

        try {
            const result = await apiRequest(API.reset, {
                method: "POST",
                body: JSON.stringify({})
            });

            if (result.dashboard) {
                state.dashboard = result.dashboard;
                renderDashboard(result.dashboard);
            } else {
                await refreshDashboard();
            }

            addEvent(
                "system",
                "Simulation reset",
                "The active simulated leak has been cleared."
            );

            showToast(
                "Network reset",
                "The simulation has returned to its healthy baseline."
            );
        } catch (error) {
            showToast(
                "Reset failed",
                error.message,
                "error"
            );
        } finally {
            setBusy(false);
        }
    });
}

function setBusy(busy) {
    state.busy = busy;

    const simulateButton = $("#simulateButton");
    const resetButton = $("#resetButton");

    if (simulateButton) {
        simulateButton.disabled = busy;
        simulateButton.textContent = busy
            ? "Processing..."
            : "⚡ Simulate leak";
    }

    if (resetButton) {
        resetButton.disabled = busy;
        resetButton.textContent = busy
            ? "Please wait..."
            : "↺ Reset network";
    }
}

function updateSeverityDisplay() {
    const slider = $("#severitySlider");

    if (!slider) return;

    const value = Number(slider.value);
    const label = $("#severityValue");
    const description = $("#severityDescription");
    const dot = $(".severity-preview-dot");

    if (label) {
        label.textContent = `${value}%`;
    }

    if (description) {
        if (value < 35) {
            description.textContent = "Minor simulated leak";
        } else if (value < 70) {
            description.textContent = "Moderate simulated leak";
        } else {
            description.textContent = "High-severity simulated leak";
        }
    }

    if (dot) {
        dot.style.background = value >= 70
            ? "var(--red)"
            : value >= 35
                ? "var(--orange)"
                : "var(--teal)";
    }
}

function renderSimulatorStatus(data) {
    const element = $("#simulatorStatus");

    if (!element) return;

    const detections = data.detections || [];
    const activeLeak = detections.length > 0;

    element.classList.toggle("has-leak", activeLeak);

    const icon = $(".simulator-status-icon", element);
    const strong = $("strong", element);
    const paragraph = $("p", element);

    if (icon) {
        icon.textContent = activeLeak ? "!" : "✓";
    }

    if (strong) {
        strong.textContent = activeLeak
            ? "Leak scenario active"
            : "Network ready";
    }

    if (paragraph) {
        paragraph.textContent = activeLeak
            ? `${detections.length} simulated leak(s) currently marked.`
            : "No leak currently marked in the simulation.";
    }
}

/* =========================================================
   LIVE MONITORING TABLE
   ========================================================= */

function bindMonitoringFilters() {
    $("#junctionSearch")?.addEventListener(
        "input",
        () => renderMonitoring(state.dashboard || {})
    );

    $("#junctionStatusFilter")?.addEventListener(
        "change",
        () => renderMonitoring(state.dashboard || {})
    );
}

function renderMonitoring(data) {
    const tbody = $("#monitoringTableBody");

    if (!tbody) return;

    const nodes = data.network?.nodes || [];
    const searchTerm = (
        $("#junctionSearch")?.value || ""
    ).trim().toLowerCase();

    const statusFilter = $("#junctionStatusFilter")?.value || "all";

    const filtered = nodes.filter(node => {
        const matchesSearch = node.id.toLowerCase().includes(searchTerm);

        const matchesStatus = statusFilter === "all"
            || node.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    tbody.replaceChildren();

    if (!filtered.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 6;
        cell.className = "empty-state";
        cell.textContent = nodes.length
            ? "No junctions match the selected filters."
            : "Waiting for Python telemetry...";

        row.appendChild(cell);
        tbody.appendChild(row);
    } else {
        filtered.forEach(node => {
            const row = document.createElement("tr");

            const variance = Number(node.pressure) -
                Number(node.healthy_pressure);

            const varianceClass = variance < -0.1
                ? "variance-negative"
                : variance > 0.1
                    ? "variance-positive"
                    : "variance-neutral";

            const status = node.status === "warning"
                ? "Warning"
                : "Normal";

            const cells = [
                {
                    className: "junction-cell",
                    html: `
                        <span class="junction-indicator ${node.status === "warning" ? "warning" : ""}"></span>
                        ${escapeHTML(node.id)}
                    `
                },
                {
                    className: "pressure-value",
                    text: `${formatNumber(node.pressure)} PSI`
                },
                {
                    className: "",
                    text: `${formatNumber(node.healthy_pressure)} PSI`
                },
                {
                    className: "",
                    text: formatNumber(node.flow)
                },
                {
                    className: varianceClass,
                    text: `${signedNumber(variance)} PSI`
                },
                {
                    className: "",
                    html: `
                        <span class="status-badge ${node.status === "warning" ? "status-warning" : "status-normal"}">
                            ${status}
                        </span>
                    `
                }
            ];

            cells.forEach(item => {
                const cell = document.createElement("td");

                if (item.className) {
                    cell.className = item.className;
                }

                if (item.html) {
                    cell.innerHTML = item.html;
                } else {
                    cell.textContent = item.text;
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });
    }

    setText(
        "#monitoringRecordCount",
        `${filtered.length} of ${nodes.length} monitoring points`
    );
}

/* =========================================================
   DETECTION RESULTS
   ========================================================= */

function renderDetections(data) {
    const container = $("#detectionList");

    if (!container) return;

    const detections = data.detections || [];

    setText("#detectionResultCount", `${detections.length} results`);

    container.replaceChildren();

    if (!detections.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent =
            "No simulated leak labels are currently active.";

        container.appendChild(empty);
        return;
    }

    detections.forEach(item => {
        const element = document.createElement("div");
        element.className = "detection-item";

        const severity = Math.round(Number(item.severity) * 100);

        const priority = String(item.priority || "Low").toLowerCase();

        const icon = document.createElement("div");
        icon.className = "detection-icon";
        icon.textContent = "!";

        const copy = document.createElement("div");
        copy.className = "detection-copy";

        const heading = document.createElement("strong");
        heading.textContent = `Pipe ${item.pipe}`;

        const description = document.createElement("small");
        description.textContent =
            `Configured severity: ${severity}% · Status: ${item.status || "Detected"}`;

        copy.append(heading, description);

        const badge = document.createElement("span");
        badge.className = `priority-badge priority-${priority}`;
        badge.textContent = `${item.priority || "Low"} priority`;

        element.append(icon, copy, badge);

        element.style.cursor = "pointer";
        element.title = "Open pipe details";

        element.addEventListener("click", () => {
            const edge = data.network?.edges?.find(
                candidate => candidate.id === item.pipe
            );

            if (edge) {
                openPipeDetails(edge);
            }
        });

        container.appendChild(element);
    });
}

/* =========================================================
   PRESSURE CHART — NATIVE CANVAS, NO LIBRARY REQUIRED
   ========================================================= */

function bindChartInteraction() {
    const canvas = $("#pressureChart");

    if (!canvas) return;

    canvas.addEventListener("mousemove", event => {
        const rect = canvas.getBoundingClientRect();

        const x = event.clientX - rect.left;
        const chartWidth = rect.width;

        const nodes = state.dashboard?.network?.nodes || [];

        if (!nodes.length) return;

        const left = 37;
        const right = 13;
        const plotWidth = chartWidth - left - right;

        const position = Math.max(
            0,
            Math.min(
                nodes.length - 1,
                Math.round((x - left) / (plotWidth / Math.max(1, nodes.length - 1)))
            )
        );

        state.chartHoverIndex = position;
        renderPressureChart(state.dashboard || {});
    });

    canvas.addEventListener("mouseleave", () => {
        state.chartHoverIndex = null;
        renderPressureChart(state.dashboard || {});
    });

    window.addEventListener("resize", () => {
        if (state.dashboard) {
            renderPressureChart(state.dashboard);
        }
    });
}

function renderPressureChart(data) {
    const canvas = $("#pressureChart");

    if (!canvas) return;

    const container = $("#pressureChartContainer");

    const nodes = data.network?.nodes || [];

    const current = nodes.map(node => Number(node.pressure));
    const baseline = nodes.map(node => Number(node.healthy_pressure));
    const labels = nodes.map(node => node.id);

    const currentAverage = current.length
        ? current.reduce((sum, value) => sum + value, 0) / current.length
        : NaN;

    const baselineAverage = baseline.length
        ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length
        : NaN;

    setText("#chartCurrentAverage", formatNumber(currentAverage));
    setText("#chartBaselineAverage", formatNumber(baselineAverage));

    setText(
        "#chartDifference",
        Number.isFinite(currentAverage) && Number.isFinite(baselineAverage)
            ? `${signedNumber(currentAverage - baselineAverage)} PSI`
            : "—"
    );

    if (!container) return;

    const width = Math.max(260, container.clientWidth - 2);
    const height = Math.max(160, container.clientHeight);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padding = {
        top: 18,
        right: 13,
        bottom: 29,
        left: 36
    };

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    if (!nodes.length) {
        ctx.fillStyle = "#71829e";
        ctx.font = "11px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
            "Waiting for telemetry data",
            width / 2,
            height / 2
        );
        return;
    }

    const allValues = [...current, ...baseline].filter(
        value => Number.isFinite(value)
    );

    if (!allValues.length) return;

    const minimum = Math.floor(Math.min(...allValues) - 3);
    const maximum = Math.ceil(Math.max(...allValues) + 3);
    const range = Math.max(1, maximum - minimum);

    const xPosition = index => {
        if (nodes.length === 1) {
            return padding.left + plotWidth / 2;
        }

        return padding.left +
            (index / (nodes.length - 1)) * plotWidth;
    };

    const yPosition = value =>
        padding.top +
        ((maximum - value) / range) * plotHeight;

    // Horizontal grid and pressure-axis labels.
    ctx.lineWidth = 1;
    ctx.font = "9px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let tick = 0; tick <= 4; tick++) {
        const value = maximum - (range * tick) / 4;
        const y = yPosition(value);

        ctx.strokeStyle = "rgba(143, 167, 205, 0.12)";
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = "#7e91af";
        ctx.fillText(value.toFixed(0), padding.left - 8, y);
    }

    // Draw a series with an optional filled area.
    function drawSeries(values, stroke, fill, dashed = false) {
        if (!values.length) return;

        ctx.beginPath();

        values.forEach((value, index) => {
            const x = xPosition(index);
            const y = yPosition(value);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        if (fill && values.length > 1) {
            const lastX = xPosition(values.length - 1);
            const firstX = xPosition(0);
            const baseY = padding.top + plotHeight;

            ctx.lineTo(lastX, baseY);
            ctx.lineTo(firstX, baseY);
            ctx.closePath();

            ctx.fillStyle = fill;
            ctx.fill();

            ctx.beginPath();

            values.forEach((value, index) => {
                const x = xPosition(index);
                const y = yPosition(value);

                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
        }

        ctx.setLineDash(dashed ? [4, 4] : []);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.setLineDash([]);

        values.forEach((value, index) => {
            const x = xPosition(index);
            const y = yPosition(value);

            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = stroke;
            ctx.fill();
        });
    }

    // Baseline first, then current readings.
    drawSeries(
        baseline,
        "#79a8ff",
        "rgba(121, 168, 255, 0.035)",
        true
    );

    drawSeries(
        current,
        "#5de4c7",
        "rgba(93, 228, 199, 0.09)"
    );

    // Junction labels.
    ctx.fillStyle = "#8b9fbd";
    ctx.font = "9px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    labels.forEach((label, index) => {
        ctx.fillText(
            label,
            xPosition(index),
            height - padding.bottom + 10
        );
    });

    // Hover indicator and tooltip.
    const hoverIndex = state.chartHoverIndex;

    if (
        hoverIndex !== null &&
        hoverIndex >= 0 &&
        hoverIndex < nodes.length
    ) {
        const x = xPosition(hoverIndex);
        const y = yPosition(current[hoverIndex]);

        ctx.strokeStyle = "rgba(205, 223, 250, 0.28)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + plotHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#5de4c7";
        ctx.strokeStyle = "#0e1b2e";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        const tooltipWidth = 128;
        const tooltipHeight = 51;

        const tooltipX = Math.min(
            width - tooltipWidth - 5,
            Math.max(5, x + 10)
        );

        const tooltipY = Math.max(
            4,
            Math.min(height - tooltipHeight - 4, y - 35)
        );

        ctx.fillStyle = "#1a2a43";
        ctx.strokeStyle = "rgba(151, 175, 211, 0.28)";
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.roundRect(
            tooltipX,
            tooltipY,
            tooltipWidth,
            tooltipHeight,
            7
        );
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = "bold 10px Segoe UI, sans-serif";
        ctx.fillStyle = "#e8f0ff";
        ctx.fillText(labels[hoverIndex], tooltipX + 9, tooltipY + 7);

        ctx.font = "9px Segoe UI, sans-serif";
        ctx.fillStyle = "#5de4c7";
        ctx.fillText(
            `Current: ${formatNumber(current[hoverIndex])} PSI`,
            tooltipX + 9,
            tooltipY + 22
        );

        ctx.fillStyle = "#91b8ff";
        ctx.fillText(
            `Baseline: ${formatNumber(baseline[hoverIndex])} PSI`,
            tooltipX + 9,
            tooltipY + 36
        );
    }
}

/* =========================================================
   EVENT CENTER
   ========================================================= */

function bindAlertFilters() {
    $$(".filter-chip").forEach(button => {
        button.addEventListener("click", () => {
            $$(".filter-chip").forEach(item => {
                item.classList.remove("active");
            });

            button.classList.add("active");
            state.eventFilter = button.dataset.alertFilter || "all";

            renderEvents();
        });
    });

    $("#clearAlertsButton")?.addEventListener("click", () => {
        state.events = [];
        renderEvents();

        showToast(
            "Events cleared",
            "The local dashboard event history has been cleared."
        );
    });
}

function renderEvents() {
    const container = $("#eventList");

    if (!container) return;

    const filtered = state.events.filter(event => {
        return state.eventFilter === "all"
            || event.type === state.eventFilter;
    });

    container.replaceChildren();

    if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = state.events.length
            ? "No events match this filter."
            : "No events recorded in this dashboard session.";

        container.appendChild(empty);
        return;
    }

    filtered.forEach(event => {
        const item = document.createElement("div");
        item.className = "event-item";

        const icon = document.createElement("div");
        icon.className = `event-icon ${event.type === "leak" ? "event-leak" : "event-system"}`;
        icon.textContent = event.type === "leak" ? "!" : "◈";

        const copy = document.createElement("div");
        copy.className = "event-copy";

        const title = document.createElement("strong");
        title.textContent = event.title;

        const message = document.createElement("p");
        message.textContent = event.message;

        const time = document.createElement("time");
        time.textContent = event.time;

        copy.append(title, message, time);
        item.append(icon, copy);
        container.appendChild(item);
    });
}

/* =========================================================
   NAVIGATION AND GENERAL BUTTONS
   ========================================================= */

function bindNavigation() {
    const navLinks = $$(".nav-link");

    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            navLinks.forEach(item => item.classList.remove("active"));
            link.classList.add("active");

            const sectionName = link.dataset.section || "overview";

            setText(
                "#breadcrumbCurrent",
                link.querySelector("span:nth-child(2)")?.textContent
                    || "Overview"
            );

            if (sectionName === "network") {
                window.setTimeout(() => {
                    if (state.dashboard) {
                        renderNetwork(state.dashboard);
                    }
                }, 100);
            }

            $("#sidebar")?.classList.remove("open");
            $("#menuToggle")?.setAttribute("aria-expanded", "false");
        });
    });

    $("#menuToggle")?.addEventListener("click", () => {
        const sidebar = $("#sidebar");

        if (!sidebar) return;

        const isOpen = sidebar.classList.toggle("open");

        $("#menuToggle")?.setAttribute(
            "aria-expanded",
            String(isOpen)
        );
    });

    // Keep the active section aligned with the visible page section.
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) =>
                    b.intersectionRatio - a.intersectionRatio
                )[0];

            if (!visible) return;

            const id = visible.target.id;

            const link = $(`.nav-link[data-section="${id}"]`);

            if (link) {
                navLinks.forEach(item => {
                    item.classList.toggle("active", item === link);
                });

                const label = link.querySelector("span:nth-child(2)");

                if (label) {
                    setText("#breadcrumbCurrent", label.textContent);
                }
            }
        }, {
            rootMargin: "-18% 0px -65% 0px",
            threshold: [0, 0.15, 0.35]
        });

        navLinks.forEach(link => {
            const section = document.getElementById(
                link.dataset.section
            );

            if (section) {
                observer.observe(section);
            }
        });
    }
}

function bindButtons() {
    $("#refreshButton")?.addEventListener("click", () => {
        refreshDashboard(true);
    });

    $("#fitNetworkButton")?.addEventListener("click", () => {
        if (state.dashboard) {
            renderNetwork(state.dashboard);
        }

        showToast(
            "Network view refreshed",
            "The pipeline map has been redrawn from the latest API data."
        );
    });

    $("#viewNetworkDetails")?.addEventListener("click", () => {
        const data = state.dashboard;

        if (!data) {
            showToast(
                "Data unavailable",
                "Wait for the Python API to return network data.",
                "error"
            );
            return;
        }

        const network = data.network || {};

        openModal(
            "Network overview",
            `
                <div class="modal-detail-grid">
                    <div class="modal-detail">
                        <span>Junction count</span>
                        <strong>${Number(network.node_count) || 0}</strong>
                    </div>
                    <div class="modal-detail">
                        <span>Pipe count</span>
                        <strong>${Number(network.pipe_count) || 0}</strong>
                    </div>
                    <div class="modal-detail">
                        <span>Simulation mode</span>
                        <strong>Enabled</strong>
                    </div>
                    <div class="modal-detail">
                        <span>Active leak labels</span>
                        <strong>${(data.detections || []).length}</strong>
                    </div>
                </div>
                <p class="modal-description">
                    These details are taken from the current response from the
                    GRIDGUARD Python API. Network size and readings represent
                    the current virtual pipeline model.
                </p>
            `
        );
    });

    $("#apiStatusButton")?.addEventListener("click", async () => {
        const connected = await checkConnection();

        showToast(
            connected ? "API is connected" : "API is unavailable",
            connected
                ? "The local GRIDGUARD Python service responded successfully."
                : "Check that the Flask server is running in your terminal.",
            connected ? "success" : "error"
        );
    });
}

function bindKeyboardShortcuts() {
    document.addEventListener("keydown", event => {
        const target = event.target;

        const isTyping = target instanceof HTMLElement
            && (
                target.isContentEditable
                || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
            );

        if (isTyping || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (event.key.toLowerCase() === "r") {
            refreshDashboard(true);
        }

        if (event.key === "Escape") {
            $("#sidebar")?.classList.remove("open");
            $("#menuToggle")?.setAttribute("aria-expanded", "false");
        }
    });
}
