const state = {
  entries: [],
  submissions: [],
  scoreboard: [],
  currentReveal: null,
  pointsByRank: [],
  host: { isHost: false }
};

const session = {
  partyId: getInitialPartyId(),
  hostToken: "",
  ballotToken: "",
  networkUrls: []
};

const els = {
  connection: document.querySelector("#connection-status"),
  scoreboard: document.querySelector("#scoreboard"),
  spotlight: document.querySelector("#spotlight"),
  rankingList: document.querySelector("#ranking-list"),
  voteForm: document.querySelector("#vote-form"),
  voteMessage: document.querySelector("#vote-message"),
  jurorName: document.querySelector("#juror-name"),
  submitRanking: document.querySelector("#submit-ranking"),
  juryQueue: document.querySelector("#jury-queue"),
  revealNext: document.querySelector("#reveal-next"),
  revealButtons: [...document.querySelectorAll("[data-reveal-to]")],
  finishReveal: document.querySelector("#finish-reveal"),
  entriesInput: document.querySelector("#entries-input"),
  entriesMessage: document.querySelector("#entries-message"),
  saveEntries: document.querySelector("#save-entries"),
  resetVotes: document.querySelector("#reset-votes"),
  backgroundButtons: [...document.querySelectorAll("[data-background-mode]")],
  hostStatus: document.querySelector("#host-status"),
  hostStatusDetail: document.querySelector("#host-status-detail"),
  hostPassword: document.querySelector("#host-password"),
  claimHost: document.querySelector("#claim-host"),
  partyName: document.querySelector("#party-name"),
  partyIdInput: document.querySelector("#party-id-input"),
  createParty: document.querySelector("#create-party"),
  joinParty: document.querySelector("#join-party"),
  inviteLink: document.querySelector("#invite-link"),
  inviteLinkOptions: document.querySelector("#invite-link-options"),
  inviteHelp: document.querySelector("#invite-help"),
  newHostPassword: document.querySelector("#new-host-password"),
  setHostPassword: document.querySelector("#set-host-password")
};

let events;
session.hostToken = getStoredHostToken(session.partyId);
session.ballotToken = getStoredBallotToken(session.partyId);
applyBackgroundMode(localStorage.getItem("backgroundMode") || "image");
connectEvents();
bindTabs();
bindActions();
loadInitialState();
loadNetworkInfo();

function connectEvents() {
  if (events) events.close();
  events = new EventSource(apiUrl("/api/events", { hostToken: session.hostToken }));

  events.onopen = () => {
    els.connection.textContent = "Live";
    els.connection.classList.add("is-live");
  };

  events.onmessage = (event) => {
    updateState(JSON.parse(event.data));
  };

  events.onerror = () => {
    els.connection.textContent = "Reconnecting";
    els.connection.classList.remove("is-live");
  };
}

async function loadInitialState() {
  const data = await api("/api/state");
  updateState(data);
}

function updateState(nextState) {
  Object.assign(state, nextState);
  renderScoreboard();
  renderRankingForm();
  renderHost();
  renderEntries();
  renderSpotlight();
  renderPartySettings();
}

function renderScoreboard() {
  const previousPositions = measureScoreRows();

  els.scoreboard.innerHTML = state.scoreboard
    .map((entry, index) => `
      <article class="score-row ${entry.lastPoints ? `has-points point-${entry.pointTier}` : ""}" data-entry-id="${entry.id}">
        <div class="rank">${index + 1}</div>
        <div>
          <div class="entry-name">${escapeHtml(entry.country || entry.name)}</div>
          <div class="entry-meta">${escapeHtml(entry.song || "")}${entry.song && entry.artist ? " / " : ""}${escapeHtml(entry.artist || "")}</div>
          ${entry.lastPoints ? `<div class="last-points">+${entry.lastPoints} from ${escapeHtml(state.currentReveal?.juror || "")}</div>` : ""}
        </div>
        <div class="points">${entry.total}</div>
      </article>
    `)
    .join("");

  animateScoreRows(previousPositions);
}

function renderRankingForm() {
  const ownBallot = getOwnBallot();
  const previousValues = ownBallot?.ranking || getSelectedRanking();
  const points = state.pointsByRank.length ? state.pointsByRank : [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const isLocked = Boolean(ownBallot && ownBallot.status !== "pending");

  if (ownBallot && document.activeElement !== els.jurorName) {
    els.jurorName.value = ownBallot.juror;
  }

  els.rankingList.innerHTML = points
    .map((pointValue, index) => `
      <label class="ranking-row">
        <span>${index + 1}</span>
        <select data-rank="${index}" aria-label="Rank ${index + 1}">
          <option value="">Choose entry</option>
          ${state.entries.map((entry) => `<option value="${entry.id}">${escapeHtml(entryLabel(entry))}</option>`).join("")}
        </select>
        <em>${pointValue}</em>
      </label>
    `)
    .join("");

  els.rankingList.querySelectorAll("select").forEach((select, index) => {
    select.value = previousValues[index] || "";
    select.disabled = isLocked;
    select.addEventListener("change", disableDuplicateOptions);
  });
  els.jurorName.disabled = isLocked;
  els.submitRanking.disabled = isLocked;
  els.submitRanking.textContent = ownBallot ? "Update Ranking" : "Send Ranking";
  if (isLocked) {
    setMessage(els.voteMessage, "Presentation has started for your ballot, so it is locked.");
  }
  disableDuplicateOptions();
}

function renderHost() {
  const isHost = Boolean(state.host?.isHost);
  const nextPoint = getNextRevealPoint();
  els.revealNext.textContent = nextPoint ? `Reveal ${nextPoint}` : "Reveal 1";
  els.revealNext.disabled = !isHost || !state.currentReveal || state.currentReveal.finished || !nextPoint;
  els.revealButtons.forEach((button) => {
    const targetPoints = Number(button.dataset.revealTo);
    button.disabled = !isHost || !state.currentReveal || state.currentReveal.finished || !nextPoint || targetPoints < nextPoint;
  });
  els.finishReveal.disabled = !isHost || !state.currentReveal;
  els.resetVotes.disabled = !isHost;
  els.saveEntries.disabled = !isHost;
  els.setHostPassword.disabled = !isHost;

  els.hostStatus.textContent = isHost ? "Host controls unlocked" : "Host controls locked";
  els.hostStatusDetail.textContent = isHost
    ? `This browser can host party ${state.id || session.partyId}.`
    : state.host?.hasPassword
      ? "Enter the host password to unlock this browser."
      : "Claim this browser as host for this party.";

  if (!state.submissions.length) {
    els.juryQueue.innerHTML = `<div class="jury-card"><div><strong>No ballots yet</strong><span>Submitted rankings will appear here.</span></div></div>`;
    return;
  }

  els.juryQueue.innerHTML = state.submissions
    .map((submission) => {
      const isCurrent = state.currentReveal?.submissionId === submission.id;
      const isApplied = submission.status === "applied";
      const startLabel = isCurrent ? "On air" : submission.status === "revealing" ? "Revealing" : isApplied ? "Applied" : "Start";
      const statusLabel = isCurrent ? "In progress" : isApplied ? "Applied to scoreboard" : "Ready to reveal";
      return `
        <article class="jury-card">
          <div>
            <strong>${escapeHtml(submission.juror)}</strong>
            <span>${statusLabel}</span>
          </div>
          <div class="jury-card-actions">
            <button type="button" data-start="${submission.id}" ${!isHost || isCurrent || isApplied ? "disabled" : ""}>${startLabel}</button>
            <button class="danger-action" type="button" data-remove="${submission.id}" aria-label="Remove ${escapeHtml(submission.juror)} ballot" ${!isHost ? "disabled" : ""}>Remove</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.juryQueue.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", () => startReveal(button.dataset.start));
  });
  els.juryQueue.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeBallot(button.dataset.remove));
  });
}

function renderEntries() {
  if (document.activeElement === els.entriesInput) return;
  els.entriesInput.value = state.entriesText || state.entries.map((entry) => [entry.country || entry.name, entry.artist, entry.song].join("\t")).join("\n");
}

function renderPartySettings() {
  const partyId = state.id || session.partyId;
  els.partyIdInput.value = partyId;
  els.partyName.value = state.name || "";
  const inviteLink = getBestInviteLink(partyId);
  els.inviteLink.value = inviteLink;
  renderInviteOptions(inviteLink);
  els.inviteHelp.textContent = isLocalHost() && inviteLink.includes("localhost")
    ? "Guests on other devices cannot use localhost. Use your computer's local IP address instead."
    : isLocalHost()
      ? "Use this local-network link for guests on the same Wi-Fi or wired network."
      : "Share this link with guests for this party.";
}

function renderSpotlight() {
  const reveal = state.currentReveal;
  if (!reveal) {
    els.spotlight.innerHTML = `
      <span class="spotlight-label">Now revealing</span>
      <strong>No jury selected</strong>
      <span>Choose a pending jury from Host Control.</span>
    `;
    return;
  }

  if (reveal.lastAward) {
    const lastAwards = reveal.lastAwards?.length ? reveal.lastAwards : [reveal.lastAward];
    const highestAward = lastAwards[lastAwards.length - 1];
    const entry = state.entries.find((item) => item.id === highestAward.entryId);

    if (lastAwards.length > 1) {
      els.spotlight.innerHTML = `
        <span class="spotlight-label">${escapeHtml(reveal.juror)} awards</span>
        <strong>${lastAwards.length} entries receive 1-${highestAward.points} points</strong>
        <span>${reveal.finished ? "Jury complete." : "Next award is ready."}</span>
      `;
      return;
    }

    els.spotlight.innerHTML = `
      <span class="spotlight-label">${escapeHtml(reveal.juror)} awards</span>
      <strong>${highestAward.points} points to ${escapeHtml(entry?.country || "Unknown entry")}</strong>
      <span>${escapeHtml(entryDetail(entry))}${reveal.finished ? " Jury complete." : ""}</span>
    `;
    return;
  }

  els.spotlight.innerHTML = `
    <span class="spotlight-label">Now revealing</span>
    <strong>${escapeHtml(reveal.juror)}</strong>
    <span>Start with 1 point and build to 12.</span>
  `;
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab);
      });
    });
  });
}

function bindActions() {
  els.voteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(els.voteMessage, "");

    try {
      await api("/api/submissions", {
        method: "POST",
        body: {
          juror: els.jurorName.value,
          ballotToken: session.ballotToken,
          ranking: getSelectedRanking()
        }
      }).then((data) => {
        session.ballotToken = data.ballotToken;
        saveBallotToken(session.partyId, data.ballotToken);
        localStorage.setItem(`submissionId:${session.partyId}`, data.submissionId);
        setMessage(els.voteMessage, "Ranking saved. You can update it until the host starts presenting your ballot.");
      });
    } catch (error) {
      setMessage(els.voteMessage, error.message, true);
    }
  });

  els.revealButtons.forEach((button) => {
    button.addEventListener("click", () => revealThrough(Number(button.dataset.revealTo)));
  });
  els.revealNext.addEventListener("click", () => revealNextPoint());
  els.finishReveal.addEventListener("click", () => api("/api/reveal/finish", { method: "POST" }));
  els.claimHost.addEventListener("click", () => claimHost());
  els.createParty.addEventListener("click", () => createParty());
  els.joinParty.addEventListener("click", () => switchParty(els.partyIdInput.value));
  els.setHostPassword.addEventListener("click", () => setHostPassword());
  els.inviteLinkOptions.addEventListener("change", () => {
    els.inviteLink.value = els.inviteLinkOptions.value;
  });

  els.saveEntries.addEventListener("click", async () => {
    setMessage(els.entriesMessage, "");
    try {
      await api("/api/entries", {
        method: "POST",
        body: { entriesText: els.entriesInput.value }
      });
      setMessage(els.entriesMessage, "Entries saved to the year file. Voting has been reset for the new running order.");
    } catch (error) {
      setMessage(els.entriesMessage, error.message, true);
    }
  });

  els.resetVotes.addEventListener("click", async () => {
    if (!confirm("Reset every submission and applied vote?")) return;
    await api("/api/reset", { method: "POST", body: { mode: "votes" } });
  });

  els.backgroundButtons.forEach((button) => {
    button.addEventListener("click", () => applyBackgroundMode(button.dataset.backgroundMode));
  });
}

async function startReveal(submissionId) {
  await api("/api/reveal/start", { method: "POST", body: { submissionId } });
}

async function claimHost() {
  const data = await api("/api/host/claim", {
    method: "POST",
    body: { password: els.hostPassword.value }
  });
  saveHostToken(session.partyId, data.hostToken);
  session.hostToken = data.hostToken;
  els.hostPassword.value = "";
  connectEvents();
  updateState(data.party);
}

async function createParty() {
  const data = await api("/api/parties", {
    method: "POST",
    body: { name: els.partyName.value || "Eurovision Party" },
    skipParty: true
  });

  switchParty(data.party.id, data.hostToken, data.party);
}

async function setHostPassword() {
  await api("/api/host/password", {
    method: "POST",
    body: { password: els.newHostPassword.value }
  });
  els.newHostPassword.value = "";
}

function switchParty(partyId, hostToken = getStoredHostToken(partyId), knownState = null) {
  session.partyId = normalizePartyId(partyId);
  session.hostToken = hostToken || "";
  session.ballotToken = getStoredBallotToken(session.partyId);
  saveHostToken(session.partyId, session.hostToken);
  localStorage.setItem("partyId", session.partyId);
  const url = new URL(window.location.href);
  url.searchParams.set("party", session.partyId);
  window.history.replaceState({}, "", url);
  connectEvents();
  loadNetworkInfo();
  if (knownState) {
    updateState(knownState);
  } else {
    loadInitialState();
  }
}

async function loadNetworkInfo() {
  try {
    const data = await api("/api/network");
    session.networkUrls = data.urls || [];
    renderPartySettings();
  } catch {
    session.networkUrls = [];
  }
}

async function revealThrough(targetPoints) {
  await api("/api/reveal/to", { method: "POST", body: { targetPoints } });
}

async function revealNextPoint() {
  await api("/api/reveal/next", { method: "POST" });
}

async function removeBallot(submissionId) {
  const submission = state.submissions.find((item) => item.id === submissionId);
  if (!submission) return;

  const appliedCount = state.appliedVotes.filter((vote) => vote.submissionId === submissionId).length;
  const detail = appliedCount ? ` This will also remove ${appliedCount} awarded point result${appliedCount === 1 ? "" : "s"} from the scoreboard.` : "";
  if (!confirm(`Remove ${submission.juror}'s ballot?${detail}`)) return;

  await api("/api/submissions/remove", { method: "POST", body: { submissionId } });
}

function getSelectedRanking() {
  return [...els.rankingList.querySelectorAll("select")].map((select) => select.value).filter(Boolean);
}

function disableDuplicateOptions() {
  const selects = [...els.rankingList.querySelectorAll("select")];
  const selected = selects.map((select) => select.value).filter(Boolean);

  for (const select of selects) {
    for (const option of select.options) {
      if (!option.value) continue;
      option.disabled = option.value !== select.value && selected.includes(option.value);
    }
  }
}

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url, {}, options.skipParty), {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(session.hostToken ? { "X-Host-Token": session.hostToken } : {}),
      "X-Party-Id": session.partyId
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function apiUrl(path, extraParams = {}, skipParty = false) {
  const url = new URL(path, window.location.origin);
  if (!skipParty) url.searchParams.set("party", session.partyId);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

function getInitialPartyId() {
  const fromUrl = new URLSearchParams(window.location.search).get("party");
  const partyId = normalizePartyId(fromUrl || localStorage.getItem("partyId") || "local");
  localStorage.setItem("partyId", partyId);
  return partyId;
}

function normalizePartyId(value) {
  return String(value || "local")
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

function getStoredBallotToken(partyId) {
  return localStorage.getItem(`ballotToken:${normalizePartyId(partyId)}`) || "";
}

function saveBallotToken(partyId, token) {
  if (token) localStorage.setItem(`ballotToken:${normalizePartyId(partyId)}`, token);
}

function getBestInviteLink(partyId) {
  const fallback = `${window.location.origin}${window.location.pathname}?party=${encodeURIComponent(partyId)}`;
  if (!isLocalHost()) return fallback;
  return session.networkUrls.find((url) => !url.includes("localhost")) || fallback;
}

function renderInviteOptions(selectedUrl) {
  const partyId = state.id || session.partyId;
  const fallback = `${window.location.origin}${window.location.pathname}?party=${encodeURIComponent(partyId)}`;
  const urls = [...new Set([selectedUrl, ...session.networkUrls, fallback].filter(Boolean))];
  els.inviteLinkOptions.innerHTML = urls
    .map((url) => `<option value="${escapeHtml(url)}">${escapeHtml(url)}</option>`)
    .join("");
  els.inviteLinkOptions.value = selectedUrl;
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function getOwnBallot() {
  const submissionId = localStorage.getItem(`submissionId:${session.partyId}`);
  if (!submissionId) return null;
  return state.submissions.find((submission) => submission.id === submissionId) || null;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function measureScoreRows() {
  return new Map(
    [...els.scoreboard.querySelectorAll(".score-row")].map((row) => [
      row.dataset.entryId,
      row.getBoundingClientRect()
    ])
  );
}

function animateScoreRows(previousPositions) {
  if (!previousPositions.size) return;

  const rows = [...els.scoreboard.querySelectorAll(".score-row")];
  const movedRows = [];

  for (const row of rows) {
    const previous = previousPositions.get(row.dataset.entryId);
    if (!previous) continue;

    const current = row.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1) continue;

    row.style.transform = `translateY(${deltaY}px)`;
    row.style.transition = "none";
    movedRows.push(row);
  }

  if (!movedRows.length) return;

  requestAnimationFrame(() => {
    for (const row of movedRows) {
      row.classList.add("is-moving");
      row.style.transform = "";
      row.style.transition = "";
    }
  });

  window.setTimeout(() => {
    for (const row of movedRows) {
      row.classList.remove("is-moving");
    }
  }, 720);
}

function getNextRevealPoint() {
  if (!state.currentReveal || state.currentReveal.finished) return null;
  const index = state.currentReveal.nextIndex;
  return state.pointsByRank[index] || null;
}

function entryLabel(entry) {
  return [entry.country || entry.name, entry.artist, entry.song].filter(Boolean).join(" - ");
}

function entryDetail(entry) {
  if (!entry) return "";
  return [entry.song && `"${entry.song}"`, entry.artist].filter(Boolean).join(" / ");
}

function applyBackgroundMode(mode) {
  const nextMode = mode === "css" ? "css" : "image";
  document.body.dataset.backgroundMode = nextMode;
  localStorage.setItem("backgroundMode", nextMode);

  els.backgroundButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.backgroundMode === nextMode);
  });
}
