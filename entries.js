const state = {
  entries: [],
  entryLists: [],
  host: { isHost: false }
};

const CODE_PATTERN = /^[a-hj-km-np-z2-9]{6}$/;

const session = {
  partyId: getInitialPartyId(),
  hostToken: "",
  joinToken: ""
};

const els = {
  connection: document.querySelector("#connection-status"),
  scoreboardLink: document.querySelector("#scoreboard-link"),
  partyIdInput: document.querySelector("#party-id-input"),
  switchParty: document.querySelector("#switch-party"),
  hostStatus: document.querySelector("#host-status"),
  hostStatusDetail: document.querySelector("#host-status-detail"),
  hostPassword: document.querySelector("#host-password"),
  claimHost: document.querySelector("#claim-host"),
  entryListSelect: document.querySelector("#entry-list-select"),
  entryListName: document.querySelector("#entry-list-name"),
  loadEntryList: document.querySelector("#load-entry-list"),
  entriesRows: document.querySelector("#entries-rows"),
  addEntry: document.querySelector("#add-entry"),
  saveEntries: document.querySelector("#save-entries"),
  saveEntryList: document.querySelector("#save-entry-list"),
  entriesMessage: document.querySelector("#entries-message")
};

session.hostToken = getStoredHostToken(session.partyId);
session.joinToken = getStoredJoinToken(session.partyId);
bindActions();
loadPage();

async function loadPage() {
  setPartyUi();
  await Promise.all([loadState(), loadEntryLists()]);
}

function bindActions() {
  els.switchParty.addEventListener("click", () => switchParty(els.partyIdInput.value));
  els.claimHost.addEventListener("click", () => claimHost());
  els.entryListSelect.addEventListener("change", () => {
    els.entryListName.value = els.entryListSelect.value;
  });
  els.loadEntryList.addEventListener("click", () => loadSelectedEntryList());
  els.addEntry.addEventListener("click", () => addEntryRow());
  els.saveEntries.addEventListener("click", () => saveEntries({ saveList: false }));
  els.saveEntryList.addEventListener("click", () => saveEntries({ saveList: true }));
  els.entriesRows.addEventListener("input", () => setMessage(""));
  els.entriesRows.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-entry]");
    if (!removeButton) return;
    removeButton.closest("[data-entry-row]")?.remove();
    renumberEntryRows();
  });
}

async function loadState() {
  try {
    const data = await api("/api/state");
    updateState(data);
    els.connection.textContent = "Loaded";
    els.connection.classList.add("is-live");
  } catch (error) {
    els.connection.textContent = "Error";
    setMessage(error.message, true);
  }
}

async function loadEntryLists() {
  try {
    const data = await api("/api/entry-lists");
    state.entryLists = data.lists || [];
    renderEntryLists();
  } catch (error) {
    state.entryLists = [];
    setMessage(error.message, true);
  }
}

function updateState(nextState) {
  state.entries = nextState.entries || [];
  state.entryListId = nextState.entryListId || "";
  state.host = nextState.host || { isHost: false };
  renderHost();
  renderEntryLists();
  renderRows();
}

function renderHost() {
  const isHost = Boolean(state.host?.isHost);
  els.hostStatus.textContent = isHost ? "Host controls unlocked" : "Host controls locked";
  els.hostStatusDetail.textContent = isHost
    ? `This browser can edit party ${session.partyId}.`
    : state.host?.hasPassword
      ? "Enter the host password to unlock this browser."
      : "Claim this browser as host for this party.";

  els.loadEntryList.disabled = !isHost;
  els.saveEntries.disabled = !isHost;
  els.saveEntryList.disabled = !isHost;
}

function renderEntryLists() {
  const currentListId = state.entryListId || "";
  els.entryListSelect.innerHTML = [
    `<option value="">Custom current list</option>`,
    ...state.entryLists.map((list) => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}${list.isDefault ? " (default)" : ""}</option>`)
  ].join("");
  els.entryListSelect.value = currentListId;
  if (document.activeElement !== els.entryListName) {
    els.entryListName.value = currentListId;
  }
}

function renderRows() {
  els.entriesRows.innerHTML = state.entries.map((entry, index) => entryRowMarkup(entry, index)).join("");
}

function entryRowMarkup(entry = {}, index = 0) {
  const runningOrder = Number.isInteger(Number(entry.runningOrder)) && Number(entry.runningOrder) > 0 ? Number(entry.runningOrder) : index + 1;
  return `
    <article class="entry-edit-row" data-entry-row>
      <div class="entry-edit-rank">${index + 1}</div>
      <label>
        Running Order
        <input data-entry-field="runningOrder" type="number" min="1" step="1" value="${runningOrder}" placeholder="${index + 1}">
      </label>
      <label>
        Country
        <input data-entry-field="country" value="${escapeHtml(entry.country || "")}" placeholder="Country">
      </label>
      <label>
        Artist
        <input data-entry-field="artist" value="${escapeHtml(entry.artist || "")}" placeholder="Artist">
      </label>
      <label>
        Song
        <input data-entry-field="song" value="${escapeHtml(entry.song || "")}" placeholder="Song">
      </label>
      <button class="danger-action" type="button" data-remove-entry aria-label="Remove entry ${index + 1}">Remove</button>
    </article>
  `;
}

async function claimHost() {
  try {
    const data = await api("/api/host/claim", {
      method: "POST",
      body: { password: els.hostPassword.value }
    });
    session.hostToken = data.hostToken;
    saveHostToken(session.partyId, data.hostToken);
    els.hostPassword.value = "";
    updateState(data.party);
    setMessage("");
  } catch (error) {
    if (error.code === "host_token_stale") {
      await loadState();
    }
    setMessage(error.message, true);
  }
}

async function loadSelectedEntryList() {
  setMessage("");
  try {
    const data = await api("/api/entry-lists/load", {
      method: "POST",
      body: { entryListId: els.entryListSelect.value || els.entryListName.value }
    });
    updateState(data);
    setMessage("Entry list loaded. Voting has been reset for this party.");
  } catch (error) {
    if (error.code === "host_token_stale") {
      await loadState();
    }
    setMessage(error.message, true);
  }
}

function addEntryRow(entry = {}) {
  els.entriesRows.insertAdjacentHTML("beforeend", entryRowMarkup(entry, els.entriesRows.querySelectorAll("[data-entry-row]").length));
}

function collectEntryRows() {
  return [...els.entriesRows.querySelectorAll("[data-entry-row]")]
    .map((row, index) => ({
      runningOrder: Number(row.querySelector('[data-entry-field="runningOrder"]')?.value) || index + 1,
      country: row.querySelector('[data-entry-field="country"]')?.value.trim() || "",
      artist: row.querySelector('[data-entry-field="artist"]')?.value.trim() || "",
      song: row.querySelector('[data-entry-field="song"]')?.value.trim() || ""
    }))
    .filter((entry) => entry.country || entry.artist || entry.song);
}

function renumberEntryRows() {
  els.entriesRows.querySelectorAll("[data-entry-row]").forEach((row, index) => {
    const rank = row.querySelector(".entry-edit-rank");
    const runningOrder = row.querySelector('[data-entry-field="runningOrder"]');
    rank.textContent = index + 1;
    if (runningOrder && !runningOrder.value) runningOrder.value = index + 1;
  });
}

async function saveEntries({ saveList }) {
  setMessage("");
  try {
    const data = await api("/api/entries", {
      method: "POST",
      body: {
        entries: collectEntryRows(),
        entryListId: els.entryListName.value || els.entryListSelect.value,
        saveList
      }
    });

    state.entryLists = data.entryLists || state.entryLists;
    updateState(data.party || data);
    setMessage(
      saveList
        ? "Entry list saved and applied. Voting has been reset for this party."
        : "Entries applied. Voting has been reset for this party."
    );
  } catch (error) {
    if (error.code === "host_token_stale") {
      await loadState();
    }
    setMessage(error.message, true);
  }
}

function switchParty(partyId) {
  session.partyId = normalizePartyId(partyId);
  session.hostToken = getStoredHostToken(session.partyId);
  session.joinToken = getStoredJoinToken(session.partyId);
  localStorage.setItem("partyId", session.partyId);
  const url = new URL(window.location.href);
  url.searchParams.set("party", session.partyId);
  window.history.replaceState({}, "", url);
  loadPage();
}

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(session.hostToken ? { "X-Host-Token": session.hostToken } : {}),
      ...(session.joinToken ? { "X-Join-Token": session.joinToken } : {}),
      "X-Party-Id": session.partyId
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();

  if (!response.ok) {
    if (data.error === "join_password_required") {
      removeJoinToken(data.partyId || session.partyId);
      window.location.href = `/?party=${encodeURIComponent(data.partyId || session.partyId)}`;
      return new Promise(() => {});
    }
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    if (data.error === "Host controls are locked. Claim host access first.") {
      error.code = "host_token_stale";
      removeHostToken(session.partyId);
      session.hostToken = "";
    }
    throw error;
  }

  return data;
}

function apiUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("party", session.partyId);
  return `${url.pathname}${url.search}`;
}

function setPartyUi() {
  els.partyIdInput.value = CODE_PATTERN.test(session.partyId) ? session.partyId.toUpperCase() : session.partyId;
  els.scoreboardLink.href = `/?party=${encodeURIComponent(session.partyId)}`;
}

function getInitialPartyId() {
  const fromUrl = new URLSearchParams(window.location.search).get("party");
  const partyId = normalizePartyId(fromUrl || localStorage.getItem("partyId") || "local");
  localStorage.setItem("partyId", partyId);
  return partyId;
}

function normalizePartyId(value) {
  const raw = String(value || "local").trim().toLowerCase();
  if (CODE_PATTERN.test(raw)) return raw;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "local";
}

function getStoredHostToken(partyId) {
  return localStorage.getItem(`hostToken:${normalizePartyId(partyId)}`) || "";
}

function saveHostToken(partyId, token) {
  if (token) localStorage.setItem(`hostToken:${normalizePartyId(partyId)}`, token);
}

function removeHostToken(partyId) {
  if (partyId) localStorage.removeItem(`hostToken:${normalizePartyId(partyId)}`);
}

function getStoredJoinToken(partyId) {
  if (!partyId) return "";
  return localStorage.getItem(`joinToken:${normalizePartyId(partyId)}`) || "";
}

function removeJoinToken(partyId) {
  if (partyId) localStorage.removeItem(`joinToken:${normalizePartyId(partyId)}`);
}

function setMessage(message, isError = false) {
  els.entriesMessage.textContent = message;
  els.entriesMessage.classList.toggle("is-error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
