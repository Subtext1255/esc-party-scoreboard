const state = {
  entries: [],
  entryLists: [],
  submissions: [],
  scoreboard: [],
  currentReveal: null,
  winnerReveal: null,
  votingStatus: "open",
  pointsByRank: [],
  host: { isHost: false }
};

const CODE_PATTERN = /^[a-hj-km-np-z2-9]{6}$/;

const session = {
  partyId: getInitialPartyId(),
  hostToken: "",
  joinToken: "",
  ballotToken: "",
  activeSubmissionId: "",
  networkUrls: []
};

const els = {
  connection: document.querySelector("#connection-status"),
  scoreboardTitle: document.querySelector("#scoreboard-title"),
  scoreboard: document.querySelector("#scoreboard"),
  spotlight: document.querySelector("#spotlight"),
  rankingList: document.querySelector("#ranking-list"),
  voteForm: document.querySelector("#vote-form"),
  voteMessage: document.querySelector("#vote-message"),
  jurorName: document.querySelector("#juror-name"),
  submitRanking: document.querySelector("#submit-ranking"),
  deviceBallots: document.querySelector("#device-ballots"),
  newBallot: document.querySelector("#new-ballot"),
  clearRanking: document.querySelector("#clear-ranking"),
  juryQueue: document.querySelector("#jury-queue"),
  revealNext: document.querySelector("#reveal-next"),
  revealButtons: [...document.querySelectorAll("[data-reveal-to]")],
  nextJury: document.querySelector("#next-jury"),
  finishReveal: document.querySelector("#finish-reveal"),
  showWinner: document.querySelector("#show-winner"),
  openVoting: document.querySelector("#open-voting"),
  closeVoting: document.querySelector("#close-voting"),
  addPracticeBallots: document.querySelector("#add-practice-ballots"),
  resetVotes: document.querySelector("#reset-votes"),
  hostStatus: document.querySelector("#host-status"),
  hostStatusDetail: document.querySelector("#host-status-detail"),
  hostPassword: document.querySelector("#host-password"),
  claimHost: document.querySelector("#claim-host"),
  releaseHost: document.querySelector("#release-host"),
  partyName: document.querySelector("#party-name"),
  partyIdInput: document.querySelector("#party-id-input"),
  createParty: document.querySelector("#create-party"),
  joinParty: document.querySelector("#join-party"),
  inviteLink: document.querySelector("#invite-link"),
  inviteLinkOptions: document.querySelector("#invite-link-options"),
  inviteQr: document.querySelector("#invite-qr"),
  inviteHelp: document.querySelector("#invite-help"),
  entryEditorLink: document.querySelector("#entry-editor-link"),
  newHostPassword: document.querySelector("#new-host-password"),
  setHostPassword: document.querySelector("#set-host-password"),
  hostPasswordMessage: document.querySelector("#host-password-message"),
  presentationToggle: document.querySelector("#presentation-toggle"),
  landingPage: document.querySelector("#landing-page"),
  landingError: document.querySelector("#landing-error"),
  landingJoinCode: document.querySelector("#landing-join-code"),
  landingJoinPassword: document.querySelector("#landing-join-password"),
  landingJoinPasswordGroup: document.querySelector("#landing-join-password-group"),
  landingCreateName: document.querySelector("#landing-create-name"),
  landingCreatePassword: document.querySelector("#landing-create-password"),
  landingAdminSecretGroup: document.querySelector("#landing-admin-secret-group"),
  landingAdminSecret: document.querySelector("#landing-admin-secret"),
  landingCreateParty: document.querySelector("#landing-create-party"),
  landingJoinParty: document.querySelector("#landing-join-party"),
  setupPage: document.querySelector("#setup-page"),
  setupClose: document.querySelector("#setup-close"),
  setupEntryList: document.querySelector("#setup-entry-list"),
  setupEntriesText: document.querySelector("#setup-entries-text"),
  setupApplyEntries: document.querySelector("#setup-apply-entries"),
  setupEntryEditorLink: document.querySelector("#setup-entry-editor-link"),
  setupMessage: document.querySelector("#setup-message"),
  leaveParty: document.querySelector("#leave-party")
};

let events;
let hasRenderedSpotlight = false;
let isSetupVisible = false;
session.hostToken = session.partyId ? getStoredHostToken(session.partyId) : "";
session.joinToken = session.partyId ? getStoredJoinToken(session.partyId) : "";
loadActiveDeviceBallot();
applyPresentationMode(localStorage.getItem("presentationMode") === "true");
bindTabs();
bindActions();
if (session.partyId) {
  loadInitialState();
} else {
  renderLanding();
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource(apiUrl("/api/events", { hostToken: session.hostToken, joinToken: session.joinToken }));

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
  if (!session.partyId) {
    renderLanding();
    return;
  }
  try {
    const data = await api("/api/state");
    updateState(data);
    hideLanding();
    connectEvents();
    loadNetworkInfo();
  } catch (error) {
    if (events) {
      events.close();
      events = null;
    }
    if (error.code === "join_password_required") {
      showJoinPasswordPrompt(error.partyName);
    } else {
      session.partyId = null;
      localStorage.removeItem("partyId");
      renderLanding(error.message);
    }
  }
}

function updateState(nextState) {
  const previousSpotlight = getSpotlightSnapshot(state);
  Object.assign(state, nextState);
  hideLanding();
  renderPartySettings();
  renderSetupScreen();
  const spotlightAnimation = hasRenderedSpotlight ? getSpotlightAnimation(previousSpotlight, getSpotlightSnapshot(state)) : "";
  renderScoreboard();
  renderRankingForm();
  renderDeviceBallots();
  renderHost();
  renderSpotlight(spotlightAnimation);
}

function renderScoreboard() {
  const previousPositions = measureScoreRows();
  const tieBreakLabels = getTieBreakLabels(state.scoreboard);
  applyScoreboardLayout(state.scoreboard.length);

  els.scoreboard.innerHTML = state.scoreboard
    .map((entry, index) => {
      const detail = entryDetailInlineMarkup(entry);
      const tieBreakLabel = tieBreakLabels.get(entry.id);
      return `
      <article class="score-row ${entry.lastPoints ? `has-points point-value-${entry.lastPoints}` : ""}" style="${entry.lastPoints ? awardStyle(entry.lastPoints) : ""}" data-entry-id="${entry.id}">
        <div class="rank">${index + 1}</div>
        <div class="entry-info">
          <div class="entry-name">${flagMarkup(entry)}<span class="entry-country">${escapeHtml(entry.countryName || entry.country || entry.name)}</span>${detail}</div>
          ${tieBreakLabel ? `<div class="entry-meta tie-break-note">${escapeHtml(tieBreakLabel)}</div>` : ""}
        </div>
        <div class="score-cell">
          ${entry.lastPoints ? `<span class="point-badge">+${entry.lastPoints}</span>` : ""}
          <span class="points">${entry.total}</span>
        </div>
      </article>
    `;
    })
    .join("");

  animateScoreRows(previousPositions);
}

function applyScoreboardLayout(entryCount) {
  const columns = getScoreboardColumnCount(entryCount);
  const rows = Math.max(1, Math.ceil(entryCount / columns));
  els.scoreboard.style.setProperty("--score-columns", columns);
  els.scoreboard.style.setProperty("--score-rows", rows);
  els.scoreboard.dataset.entryCount = entryCount;
  els.scoreboard.dataset.scoreColumns = columns;
  els.scoreboard.dataset.scoreRows = rows;
}

function getScoreboardColumnCount(entryCount) {
  if (entryCount <= 1) return 1;
  if (entryCount <= 20) return 2;
  if (entryCount <= 30) return 2;
  if (entryCount <= 48) return 3;
  return 4;
}

function renderRankingForm() {
  const ownBallot = getOwnBallot();
  const previousValues = ownBallot?.ranking || (session.activeSubmissionId ? [] : getSelectedRanking());
  const points = state.pointsByRank.length ? state.pointsByRank : [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const isVotingClosed = state.votingStatus === "closed";
  const isLocked = Boolean(ownBallot && ownBallot.status !== "pending") || isVotingClosed;

  if (document.activeElement !== els.jurorName) {
    els.jurorName.value = ownBallot?.juror || "";
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
  if (isVotingClosed) {
    setMessage(els.voteMessage, "Voting is closed.");
  } else if (isLocked) {
    setMessage(els.voteMessage, "Presentation has started for your ballot, so it is locked.");
  }
  disableDuplicateOptions();
}

function renderDeviceBallots() {
  const savedBallots = getDeviceBallots()
    .map((ballot) => ({ ...ballot, submission: state.submissions.find((submission) => submission.id === ballot.submissionId) }))
    .filter((ballot) => ballot.submission);

  saveDeviceBallots(savedBallots.map(({ submission, ...ballot }) => ballot));
  const activeStillExists = savedBallots.some((ballot) => ballot.submissionId === session.activeSubmissionId);
  if (session.activeSubmissionId && !activeStillExists) {
    clearActiveDeviceBallot();
  }

  els.deviceBallots.innerHTML = [
    `<option value="">New ballot</option>`,
    ...savedBallots.map((ballot) => {
      const status = ballot.submission.status === "pending" ? "editable" : "locked";
      return `<option value="${escapeHtml(ballot.submissionId)}">${escapeHtml(ballot.submission.juror)} (${status})</option>`;
    })
  ].join("");
  els.deviceBallots.value = session.activeSubmissionId || "";
}

function renderHost() {
  const isHost = Boolean(state.host?.isHost);
  const nextPoint = getNextRevealPoint();
  const hasPendingJury = state.submissions.some((submission) => submission.status === "pending");
  const allSubmittedJuriesApplied = state.submissions.length > 0 && state.submissions.every((submission) => submission.status === "applied");
  els.revealNext.textContent = nextPoint ? `Reveal ${nextPoint}` : "Reveal 1";
  els.revealNext.disabled = !isHost || !state.currentReveal || state.currentReveal.finished || !nextPoint;
  els.revealButtons.forEach((button) => {
    const targetPoints = Number(button.dataset.revealTo);
    button.disabled = !isHost || !state.currentReveal || state.currentReveal.finished || !nextPoint || targetPoints < nextPoint;
  });
  els.nextJury.disabled = !isHost || !hasPendingJury || Boolean(state.currentReveal && !state.currentReveal.finished);
  els.finishReveal.disabled = !isHost || !state.currentReveal;
  els.showWinner.disabled = !isHost || !allSubmittedJuriesApplied || !state.appliedVotes.length;
  els.openVoting.disabled = !isHost || state.votingStatus === "open";
  els.closeVoting.disabled = !isHost || state.votingStatus === "closed";
  els.addPracticeBallots.disabled = !isHost || state.entries.length < 10;
  els.resetVotes.disabled = !isHost;
  els.setHostPassword.disabled = !isHost;
  els.releaseHost.disabled = !isHost;

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

function renderPartySettings() {
  const partyId = state.id || session.partyId;
  const shareCode = CODE_PATTERN.test(partyId) ? partyId.toUpperCase() : partyId;
  els.partyIdInput.value = shareCode;
  els.scoreboardTitle.textContent = state.name || "Eurovision Scoreboard";
  if (document.activeElement !== els.partyName) {
    els.partyName.value = state.name || "";
  }
  const inviteLink = getBestInviteLink(partyId);
  els.inviteLink.value = inviteLink;
  renderInviteOptions(inviteLink);
  renderInviteQr(inviteLink);
  els.inviteHelp.textContent = isLocalHost() && inviteLink.includes("localhost")
    ? "Guests on other devices cannot use localhost. Use your computer's local IP address instead."
    : isLocalHost()
      ? "Use this local-network link for guests on the same Wi-Fi or wired network."
      : "Share this link with guests for this party.";
  els.entryEditorLink.href = `/entries.html?party=${encodeURIComponent(partyId)}`;
  if (els.setupEntryEditorLink) {
    els.setupEntryEditorLink.href = `/entries.html?party=${encodeURIComponent(partyId)}`;
  }
}

function renderSetupScreen() {
  if (!els.setupPage) return;
  els.setupPage.classList.toggle("is-hidden", !isSetupVisible);
  document.querySelector(".app-shell")?.classList.toggle("is-hidden", isSetupVisible);
  if (!isSetupVisible) return;

  renderSetupEntryLists();
  if (document.activeElement !== els.setupEntriesText && !els.setupEntriesText.value) {
    els.setupEntriesText.value = state.entriesText || formatEntriesForTextarea(state.entries);
  }
}

function renderSetupEntryLists() {
  if (!els.setupEntryList) return;
  const currentListId = state.entryListId || "";
  els.setupEntryList.innerHTML = [
    `<option value="">Custom current list</option>`,
    ...state.entryLists.map((list) => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}${list.isDefault ? " (default)" : ""}</option>`)
  ].join("");
  els.setupEntryList.value = currentListId;
}

function stageShareMarkup() {
  const partyId = state.id || session.partyId;
  const shareCode = CODE_PATTERN.test(partyId) ? partyId.toUpperCase() : partyId;
  return `
    <div class="stage-share" id="stage-share" aria-label="Join this party">
      <div>
        <span>Join code</span>
        <strong id="stage-party-code">${escapeHtml(shareCode || "------")}</strong>
      </div>
      <canvas id="stage-invite-qr" width="260" height="260" aria-label="Join QR code"></canvas>
    </div>
  `;
}

function renderStageInvite() {
  const stageShare = document.querySelector("#stage-share");
  const stageInviteQr = document.querySelector("#stage-invite-qr");
  if (!stageShare || !stageInviteQr) return;

  const stageInviteLink = getGuestInviteLink(state.id || session.partyId);
  renderInviteQr(stageInviteLink, stageInviteQr);
  stageShare.classList.toggle("is-unavailable", !stageInviteLink);
}

function renderSpotlight(animation = "") {
  els.spotlight.classList.toggle("has-winner", Boolean(state.winnerReveal));
  els.spotlight.classList.toggle("has-voting-status", !state.winnerReveal && !state.currentReveal && Boolean(state.votingStatus));
  const juryProgress = getJuryProgress();
  const juryProgressLabel = juryProgress
    ? `Jury ${juryProgress.current} of ${juryProgress.total} now voting`
    : "Now revealing";

  if (state.winnerReveal) {
    const winner = state.winnerReveal.entry || state.winnerReveal.entries?.[0];
    const tieBreak = state.winnerReveal.tieBreak;
    els.spotlight.innerHTML = `
      <span class="spotlight-label">Winner</span>
      <strong>${flagMarkup(winner)}${escapeHtml(winner?.countryName || winner?.country || winner?.name || "Winner")}</strong>
      <span>${escapeHtml(entryDetail(winner))} with ${state.winnerReveal.total} points${tieBreak ? ` after tie-break: ${escapeHtml(tieBreak.label)}.` : "."}</span>
    `;
    renderStageInvite();
    animateSpotlight(animation);
    hasRenderedSpotlight = true;
    return;
  }

  if (!state.currentReveal && state.votingStatus) {
    const isClosed = state.votingStatus === "closed";
    els.spotlight.innerHTML = `
      <div class="spotlight-copy">
        <span class="spotlight-label">${juryProgress ? `Jury ${juryProgress.current} of ${juryProgress.total}` : "Voting status"}</span>
        <strong>${isClosed ? "STOP VOTING NOW" : "START VOTING NOW"}</strong>
        <span>${isClosed ? "The host has closed ballot submissions." : "Guests can submit or update their rankings."}</span>
      </div>
      ${stageShareMarkup()}
    `;
    renderStageInvite();
    animateSpotlight(animation);
    hasRenderedSpotlight = true;
    return;
  }

  const reveal = state.currentReveal;
  if (!reveal) {
    els.spotlight.innerHTML = `
      <span class="spotlight-label">Now revealing</span>
      <strong>No jury selected</strong>
      <span>Choose a pending jury from Host Control.</span>
    `;
    renderStageInvite();
    animateSpotlight(animation);
    hasRenderedSpotlight = true;
    return;
  }

  if (reveal.lastAward) {
    const lastAwards = reveal.lastAwards?.length ? reveal.lastAwards : [reveal.lastAward];
    const highestAward = lastAwards[lastAwards.length - 1];
    const entry = state.entries.find((item) => item.id === highestAward.entryId);

    if (lastAwards.length > 1) {
      const lowerAwardEntries = lastAwards
        .slice(0, -1)
        .reverse()
        .map((award) => state.entries.find((item) => item.id === award.entryId))
        .filter(Boolean);
      els.spotlight.innerHTML = `
        <span class="spotlight-label">${juryProgressLabel}</span>
        <strong>${escapeHtml(reveal.juror)} awards ${highestAward.points} points to ${flagMarkup(entry)}${escapeHtml(entry?.countryName || entry?.country || "Unknown entry")}</strong>
        <span class="spotlight-award-summary">${escapeHtml(reveal.juror)} awards points to ${countryListMarkup(lowerAwardEntries)}.</span>
        ${reveal.finished ? `<span class="spotlight-status">Jury complete.</span>` : ""}
      `;
      renderStageInvite();
      animateSpotlight(animation);
      hasRenderedSpotlight = true;
      return;
    }

      els.spotlight.innerHTML = `
      <span class="spotlight-label">${juryProgressLabel}</span>
      <strong>${escapeHtml(reveal.juror)} awards ${highestAward.points} points to ${flagMarkup(entry)}${escapeHtml(entry?.countryName || entry?.country || "Unknown entry")}</strong>
      <span>${escapeHtml(entryDetail(entry))}</span>
      ${reveal.finished ? `<span class="spotlight-status">Jury complete.</span>` : ""}
    `;
    renderStageInvite();
    animateSpotlight(animation);
    hasRenderedSpotlight = true;
    return;
  }

  els.spotlight.innerHTML = `
    <span class="spotlight-label">${juryProgressLabel}</span>
    <strong>${escapeHtml(reveal.juror)}</strong>
    <span>Start with 1 point and build to 12.</span>
  `;
  renderStageInvite();
  animateSpotlight(animation);
  hasRenderedSpotlight = true;
}

function getSpotlightSnapshot(nextState) {
  if (nextState.winnerReveal) {
    return {
      type: "winner",
      shownAt: nextState.winnerReveal.shownAt || "",
      entryIds: (nextState.winnerReveal.entries || []).map((entry) => entry.id).join(","),
      tieBreak: nextState.winnerReveal.tieBreak?.label || ""
    };
  }

  if (!nextState.currentReveal && nextState.votingStatus) {
    return {
      type: "voting",
      status: nextState.votingStatus,
      changedAt: nextState.votingStatusChangedAt || ""
    };
  }

  const reveal = nextState.currentReveal;
  if (!reveal) {
    return null;
  }

  return {
    type: "reveal",
    submissionId: reveal.submissionId,
    finished: Boolean(reveal.finished)
  };
}

function getJuryProgress() {
  const total = state.submissions.length;
  if (!total) return null;

  if (state.currentReveal?.submissionId) {
    const index = state.submissions.findIndex((submission) => submission.id === state.currentReveal.submissionId);
    return {
      current: index >= 0 ? index + 1 : Math.min(total, state.submissions.filter((submission) => submission.status === "applied").length + 1),
      total
    };
  }

  const completed = state.submissions.filter((submission) => submission.status === "applied").length;
  return {
    current: Math.min(total, completed + 1),
    total
  };
}

function getSpotlightAnimation(previousSpotlight, nextSpotlight) {
  if (nextSpotlight?.type === "winner" && previousSpotlight?.type !== "winner") return "is-showing-winner";
  if (nextSpotlight?.type === "voting" && (previousSpotlight?.type !== "voting" || previousSpotlight.status !== nextSpotlight.status || previousSpotlight.changedAt !== nextSpotlight.changedAt)) return "is-showing-voting-status";
  if (nextSpotlight?.type === "reveal" && previousSpotlight?.submissionId !== nextSpotlight.submissionId) return "is-starting-reveal";
  if (previousSpotlight?.submissionId === nextSpotlight?.submissionId && !previousSpotlight?.finished && nextSpotlight?.finished) return "is-completing-reveal";
  if (previousSpotlight && !nextSpotlight) return "is-clearing-reveal";
  return "";
}

function animateSpotlight(animation) {
  els.spotlight.classList.remove("is-starting-reveal", "is-completing-reveal", "is-clearing-reveal", "is-showing-winner", "is-showing-voting-status");
  if (!animation) return;
  void els.spotlight.offsetWidth;
  els.spotlight.classList.add(animation);
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
    if (session.activeSubmissionId && !getOwnBallot()) {
      clearActiveDeviceBallot();
    }

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
        session.activeSubmissionId = data.submissionId;
        saveDeviceBallot({
          submissionId: data.submissionId,
          ballotToken: data.ballotToken,
          juror: data.submission.juror
        });
        setMessage(els.voteMessage, "Ranking saved. You can update it until the host starts presenting your ballot.");
      });
    } catch (error) {
      if (error.code === "host_token_stale") loadInitialState();
      setMessage(els.voteMessage, error.message, true);
    }
  });

  els.revealButtons.forEach((button) => {
    button.addEventListener("click", () => revealThrough(Number(button.dataset.revealTo)));
  });
  els.revealNext.addEventListener("click", () => revealNextPoint());
  els.nextJury.addEventListener("click", () => startNextJury());
  els.finishReveal.addEventListener("click", () => api("/api/reveal/finish", { method: "POST" }));
  els.showWinner.addEventListener("click", () => showWinner());
  els.openVoting.addEventListener("click", () => setVotingStatus("open"));
  els.closeVoting.addEventListener("click", () => setVotingStatus("closed"));
  els.addPracticeBallots.addEventListener("click", () => addPracticeBallots());
  els.claimHost.addEventListener("click", () => claimHost());
  els.releaseHost.addEventListener("click", () => releaseHost());
  els.hostPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") claimHost();
  });
  els.createParty.addEventListener("click", async () => {
    try {
      await createParty(undefined, undefined, undefined, { showSetup: true });
    } catch (error) {
      renderLanding(error.message, { keepAdminSecret: error.code === "admin_secret_required" });
    }
  });
  els.partyName.addEventListener("blur", () => savePartyName());
  els.partyName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.partyName.blur();
    }
  });
  els.joinParty.addEventListener("click", () => switchParty(els.partyIdInput.value));
  if (els.landingCreateParty) {
    els.landingCreateParty.addEventListener("click", async () => {
      try {
        const password = els.landingCreatePassword?.value || "";
        const name = els.landingCreateName?.value || "Eurovision Party";
        const adminSecret = els.landingAdminSecret?.value || "";
        await createParty(password, name, adminSecret, { showSetup: true });
      } catch (error) {
        renderLanding(error.message, { keepAdminSecret: error.code === "admin_secret_required" });
      }
    });
  }
  if (els.landingJoinParty) {
    els.landingJoinParty.addEventListener("click", async () => {
      try {
        await joinParty(
          els.landingJoinCode?.value || "",
          els.landingJoinPassword?.value || ""
        );
      } catch (error) {
        renderLanding(error.message, { keepJoinPassword: CODE_PATTERN.test(normalizePartyId(els.landingJoinCode?.value || "")) });
      }
    });
  }
  if (els.landingJoinCode) {
    els.landingJoinCode.addEventListener("input", () => {
      els.landingJoinCode.value = els.landingJoinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      setLandingMessage("");
    });
    els.landingJoinCode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.landingJoinParty?.click();
    });
  }
  if (els.landingJoinPassword) {
    els.landingJoinPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.landingJoinParty?.click();
    });
  }
  if (els.landingAdminSecret) {
    els.landingAdminSecret.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.landingCreateParty?.click();
    });
  }
  els.setHostPassword.addEventListener("click", () => setHostPassword());
  els.deviceBallots.addEventListener("change", () => selectDeviceBallot(els.deviceBallots.value));
  els.newBallot.addEventListener("click", () => selectDeviceBallot("", { clearForm: true }));
  els.clearRanking.addEventListener("click", clearRankingForm);
  els.inviteLinkOptions.addEventListener("change", () => {
    els.inviteLink.value = els.inviteLinkOptions.value;
    renderInviteQr(els.inviteLinkOptions.value);
  });
  els.leaveParty?.addEventListener("click", () => leaveParty());
  els.setupClose?.addEventListener("click", () => hideSetupScreen());
  els.setupEntryList?.addEventListener("change", () => loadSetupEntryList(els.setupEntryList.value));
  els.setupApplyEntries?.addEventListener("click", () => applySetupEntries());

  els.resetVotes.addEventListener("click", async () => {
    if (!confirm("Reset every submission and applied vote?")) return;
    await api("/api/reset", { method: "POST", body: { mode: "votes" } });
  });

  els.presentationToggle.addEventListener("click", () => {
    applyPresentationMode(!document.body.classList.contains("is-presentation"));
  });
}

async function startReveal(submissionId) {
  await api("/api/reveal/start", { method: "POST", body: { submissionId } });
}

async function startNextJury() {
  await api("/api/reveal/next-jury", { method: "POST" });
}

async function claimHost() {
  try {
    setMessage(els.hostPasswordMessage, "");
    const data = await api("/api/host/claim", {
      method: "POST",
      body: { password: els.hostPassword.value }
    });
    saveHostToken(session.partyId, data.hostToken);
    session.hostToken = data.hostToken;
    els.hostPassword.value = "";
    connectEvents();
    updateState(data.party);
  } catch (error) {
    if (error.code === "host_token_stale") {
      connectEvents();
      loadInitialState();
    }
    els.hostStatusDetail.textContent = error.message;
  }
}

async function createParty(joinPassword = "", name = els.partyName.value || "Eurovision Party", adminSecret = "", options = {}) {
  const body = { name };
  if (joinPassword) body.joinPassword = joinPassword;
  if (adminSecret) body.adminSecret = adminSecret;

  const data = await api("/api/parties", {
    method: "POST",
    body,
    skipParty: true
  });

  switchParty(data.party.id, data.hostToken, data.joinToken, data.party, { showSetup: Boolean(options.showSetup) });
}

async function savePartyName() {
  const name = els.partyName.value.trim() || "Eurovision Scoreboard";
  if (name === state.name) return;

  try {
    const data = await api("/api/party/name", {
      method: "POST",
      body: { name }
    });
    updateState(data);
  } catch (error) {
    els.partyName.value = state.name || "";
    if (error.code === "host_token_stale") {
      connectEvents();
      loadInitialState();
    }
    els.hostStatusDetail.textContent = error.message;
  }
}

async function setHostPassword() {
  try {
    const data = await api("/api/host/password", {
      method: "POST",
      body: { password: els.newHostPassword.value }
    });
    els.newHostPassword.value = "";
    updateState(data);
    setMessage(els.hostPasswordMessage, "Host password set. Other devices can now unlock host controls with it.");
  } catch (error) {
    if (error.code === "host_token_stale") {
      connectEvents();
      loadInitialState();
    }
    setMessage(els.hostPasswordMessage, error.message, true);
  }
}

async function releaseHost() {
  try {
    const data = await api("/api/host/release", { method: "POST" });
    removeHostToken(session.partyId);
    session.hostToken = "";
    connectEvents();
    updateState(data);
    setMessage(els.hostPasswordMessage, "This browser has relinquished host control.");
  } catch (error) {
    if (error.code === "host_token_stale") {
      connectEvents();
      loadInitialState();
    }
    els.hostStatusDetail.textContent = error.message;
  }
}

async function joinParty(code, password = "") {
  const normalized = normalizePartyId(code);
  if (!CODE_PATTERN.test(normalized)) {
    throw new Error("Party codes are 6 letters and numbers.");
  }

  const previousPartyId = session.partyId;
  session.partyId = normalized;

  try {
    const data = await api("/api/parties/join", {
      method: "POST",
      body: password ? { password } : {}
    });
    switchParty(normalized, "", data.joinToken, data.party);
  } catch (error) {
    session.partyId = previousPartyId;
    throw error;
  }
}

function switchParty(partyId, hostToken = getStoredHostToken(partyId), joinToken = getStoredJoinToken(partyId), knownState = null, options = {}) {
  session.partyId = normalizePartyId(partyId);
  session.hostToken = hostToken || "";
  session.joinToken = joinToken || "";
  loadActiveDeviceBallot();
  saveHostToken(session.partyId, session.hostToken);
  saveJoinToken(session.partyId, session.joinToken);
  localStorage.setItem("partyId", session.partyId);
  const url = new URL(window.location.href);
  url.searchParams.set("party", session.partyId);
  window.history.replaceState({}, "", url);
  if (knownState) {
    updateState(knownState);
    if (options.showSetup) showSetupScreen();
    connectEvents();
    loadNetworkInfo();
  } else {
    loadInitialState();
  }
}

function leaveParty() {
  if (events) {
    events.close();
    events = null;
  }
  isSetupVisible = false;
  session.partyId = null;
  session.hostToken = "";
  session.joinToken = "";
  session.ballotToken = "";
  session.activeSubmissionId = "";
  session.networkUrls = [];
  applyPresentationMode(false);
  localStorage.removeItem("partyId");
  const url = new URL(window.location.href);
  url.searchParams.delete("party");
  window.history.replaceState({}, "", url);
  renderLanding();
}

async function showSetupScreen() {
  applyPresentationMode(false);
  isSetupVisible = true;
  els.setupEntriesText.value = state.entriesText || formatEntriesForTextarea(state.entries);
  setMessage(els.setupMessage, "");
  await loadEntryLists();
  renderSetupScreen();
}

function hideSetupScreen() {
  isSetupVisible = false;
  renderSetupScreen();
}

async function loadEntryLists() {
  try {
    const data = await api("/api/entry-lists");
    state.entryLists = data.lists || [];
    renderSetupEntryLists();
  } catch (error) {
    setMessage(els.setupMessage, error.message, true);
  }
}

async function loadSetupEntryList(entryListId) {
  setMessage(els.setupMessage, "");
  if (!entryListId) {
    els.setupEntriesText.value = state.entriesText || formatEntriesForTextarea(state.entries);
    return;
  }

  try {
    const data = await api("/api/entry-lists/read", { query: { entryListId } });
    els.setupEntriesText.value = data.entriesText || "";
  } catch (error) {
    setMessage(els.setupMessage, error.message, true);
  }
}

async function applySetupEntries() {
  setMessage(els.setupMessage, "");
  try {
    const data = await api("/api/entries", {
      method: "POST",
      body: {
        entriesText: els.setupEntriesText.value,
        saveList: false
      }
    });
    state.entryLists = data.entryLists || state.entryLists;
    updateState(data.party || data);
    setMessage(els.setupMessage, "Entries applied. Voting has been reset for this party.");
  } catch (error) {
    if (error.code === "host_token_stale") {
      connectEvents();
      loadInitialState();
    }
    setMessage(els.setupMessage, error.message, true);
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

async function showWinner() {
  await api("/api/winner/show", { method: "POST" });
}

async function setVotingStatus(status) {
  await api("/api/voting/status", { method: "POST", body: { status } });
}

async function addPracticeBallots() {
  try {
    await api("/api/submissions/practice", { method: "POST", body: { count: 5 } });
  } catch (error) {
    els.hostStatusDetail.textContent = error.message;
    alert(`Could not add practice ballots: ${error.message}`);
  }
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
  const response = await fetch(apiUrl(url, options.query || {}, options.skipParty), {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(session.hostToken ? { "X-Host-Token": session.hostToken } : {}),
      ...(session.joinToken ? { "X-Join-Token": session.joinToken } : {}),
      "X-Party-Id": session.partyId || ""
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    if (data.error === "join_password_required") {
      error.code = "join_password_required";
      error.partyName = data.partyName;
      removeJoinToken(data.partyId || session.partyId);
      session.joinToken = "";
    } else if (data.error === "admin_secret_required") {
      error.code = "admin_secret_required";
      error.message = "Enter the admin secret to create a party on this server.";
    } else if (data.error === "Host controls are locked. Claim host access first.") {
      error.code = "host_token_stale";
      removeHostToken(session.partyId);
      session.hostToken = "";
    }
    throw error;
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
  if (fromUrl) {
    const normalized = normalizePartyId(fromUrl);
    localStorage.setItem("partyId", normalized);
    return normalized;
  }
  const stored = localStorage.getItem("partyId");
  if (stored) return normalizePartyId(stored);
  return null;
}

function normalizePartyId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "local";
  if (CODE_PATTERN.test(raw)) return raw;
  const normalized = raw
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized || "local";
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

function saveJoinToken(partyId, token) {
  if (token && partyId) localStorage.setItem(`joinToken:${normalizePartyId(partyId)}`, token);
}

function removeJoinToken(partyId) {
  if (partyId) localStorage.removeItem(`joinToken:${normalizePartyId(partyId)}`);
}

function getBestInviteLink(partyId) {
  const fallback = `${window.location.origin}${window.location.pathname}?party=${encodeURIComponent(partyId)}`;
  return getGuestInviteLink(partyId) || fallback;
}

function getGuestInviteLink(partyId) {
  const fallback = `${window.location.origin}${window.location.pathname}?party=${encodeURIComponent(partyId)}`;
  const urls = [fallback, ...session.networkUrls];
  return urls.find(isGuestSafeInviteUrl) || "";
}

function isGuestSafeInviteUrl(value) {
  try {
    const { hostname } = new URL(value);
    return !["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(hostname.toLowerCase());
  } catch {
    return false;
  }
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

function renderInviteQr(value, canvas = els.inviteQr) {
  if (!value) {
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const matrix = createQrMatrix(value);
  const context = canvas.getContext("2d");
  const quiet = 5;
  const modules = matrix.length + quiet * 2;
  const scale = Math.floor(canvas.width / modules);
  const offset = Math.floor((canvas.width - modules * scale) / 2);

  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";

  matrix.forEach((row, y) => {
    row.forEach((isDark, x) => {
      if (!isDark) return;
      context.fillRect(offset + (x + quiet) * scale, offset + (y + quiet) * scale, scale, scale);
    });
  });
}

function createQrMatrix(value) {
  const version = 6;
  const size = version * 4 + 17;
  const dataCodewords = 136;
  const ecPerBlock = 18;
  const blockCount = 2;
  const bytes = [...new TextEncoder().encode(value)];

  if (bytes.length > 120) {
    throw new Error("Invite link is too long for the built-in QR code.");
  }

  const bits = [0, 1, 0, 0];
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  const capacity = dataCodewords * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(parseInt(bits.slice(index, index + 8).join(""), 2));
  }
  for (let pad = 0; data.length < dataCodewords; pad ^= 1) {
    data.push(pad ? 0x11 : 0xec);
  }

  const blocks = [];
  const blockSize = dataCodewords / blockCount;
  for (let block = 0; block < blockCount; block += 1) {
    const chunk = data.slice(block * blockSize, (block + 1) * blockSize);
    blocks.push({ data: chunk, ec: reedSolomonRemainder(chunk, ecPerBlock) });
  }

  const codewords = [];
  for (let index = 0; index < blockSize; index += 1) {
    blocks.forEach((block) => codewords.push(block.data[index]));
  }
  for (let index = 0; index < ecPerBlock; index += 1) {
    blocks.forEach((block) => codewords.push(block.ec[index]));
  }

  let bestMatrix = null;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = Array.from({ length: size }, () => Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));
    drawQrFunctionPatterns(matrix, reserved, version);
    drawQrData(matrix, reserved, codewords, mask);
    drawQrFormat(matrix, reserved, mask);
    const penalty = getQrPenalty(matrix);
    if (penalty < bestPenalty) {
      bestMatrix = matrix;
      bestPenalty = penalty;
    }
  }

  return bestMatrix;
}

function appendBits(bits, value, length) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((value >>> index) & 1);
  }
}

function drawQrFunctionPatterns(matrix, reserved, version) {
  const size = matrix.length;
  drawFinder(matrix, reserved, 0, 0);
  drawFinder(matrix, reserved, size - 7, 0);
  drawFinder(matrix, reserved, 0, size - 7);

  for (let i = 8; i < size - 8; i += 1) {
    setModule(matrix, reserved, 6, i, i % 2 === 0);
    setModule(matrix, reserved, i, 6, i % 2 === 0);
  }

  drawAlignment(matrix, reserved, 34, 34);
  setModule(matrix, reserved, 8, version * 4 + 9, true);

  for (let i = 0; i < 9; i += 1) {
    reserve(reserved, 8, i);
    reserve(reserved, i, 8);
  }

  for (let i = 0; i < 8; i += 1) {
    reserve(reserved, size - 1 - i, 8);
    reserve(reserved, 8, size - 1 - i);
  }
}

function drawFinder(matrix, reserved, x, y) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (!matrix[yy] || matrix[yy][xx] === undefined) continue;
      const isDark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setModule(matrix, reserved, xx, yy, isDark);
    }
  }
}

function drawAlignment(matrix, reserved, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const isDark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      setModule(matrix, reserved, cx + dx, cy + dy, isDark);
    }
  }
}

function drawQrData(matrix, reserved, codewords, mask) {
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  const size = matrix.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        const masked = bit ^ Number(shouldMask(mask, x, y));
        matrix[y][x] = Boolean(masked);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function shouldMask(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
  if (mask === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
  return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
}

function getQrPenalty(matrix) {
  const size = matrix.length;
  let penalty = 0;

  for (let y = 0; y < size; y += 1) {
    penalty += getQrRunPenalty(matrix[y]);
  }

  for (let x = 0; x < size; x += 1) {
    penalty += getQrRunPenalty(matrix.map((row) => row[x]));
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = matrix[y][x];
      if (matrix[y][x + 1] === color && matrix[y + 1][x] === color && matrix[y + 1][x + 1] === color) {
        penalty += 3;
      }
    }
  }

  const finderLike = [true, false, true, true, true, false, true, false, false, false, false];
  const finderLikeReverse = [...finderLike].reverse();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x <= size - finderLike.length; x += 1) {
      const section = matrix[y].slice(x, x + finderLike.length);
      if (matchesPattern(section, finderLike) || matchesPattern(section, finderLikeReverse)) penalty += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    const column = matrix.map((row) => row[x]);
    for (let y = 0; y <= size - finderLike.length; y += 1) {
      const section = column.slice(y, y + finderLike.length);
      if (matchesPattern(section, finderLike) || matchesPattern(section, finderLikeReverse)) penalty += 40;
    }
  }

  const darkModules = matrix.flat().filter(Boolean).length;
  const percent = (darkModules * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return penalty;
}

function getQrRunPenalty(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;

  for (let index = 1; index <= line.length; index += 1) {
    if (line[index] === runColor) {
      runLength += 1;
      continue;
    }

    if (runLength >= 5) penalty += 3 + runLength - 5;
    runColor = line[index];
    runLength = 1;
  }

  return penalty;
}

function matchesPattern(line, pattern) {
  return pattern.every((value, index) => line[index] === value);
}

function drawQrFormat(matrix, reserved, mask) {
  const size = matrix.length;
  const format = getFormatBits(1, mask);
  const bit = (index) => Boolean((format >>> index) & 1);

  for (let i = 0; i <= 5; i += 1) setModule(matrix, reserved, 8, i, bit(i));
  setModule(matrix, reserved, 8, 7, bit(6));
  setModule(matrix, reserved, 8, 8, bit(7));
  setModule(matrix, reserved, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setModule(matrix, reserved, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) setModule(matrix, reserved, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setModule(matrix, reserved, 8, size - 15 + i, bit(i));
}

function getFormatBits(errorLevelBits, mask) {
  let data = (errorLevelBits << 3) | mask;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function setModule(matrix, reserved, x, y, isDark) {
  matrix[y][x] = isDark;
  reserve(reserved, x, y);
}

function reserve(reserved, x, y) {
  if (reserved[y] && reserved[y][x] !== undefined) reserved[y][x] = true;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = Array(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }

  return result;
}

function reedSolomonGenerator(degree) {
  let result = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = Array(result.length + 1).fill(0);
    result.forEach((coefficient, index) => {
      next[index] ^= gfMultiply(coefficient, 1);
      next[index + 1] ^= gfMultiply(coefficient, gfPow(2, i));
    });
    result = next;
  }
  return result.slice(1);
}

function gfPow(value, power) {
  let result = 1;
  for (let i = 0; i < power; i += 1) result = gfMultiply(result, value);
  return result;
}

function gfMultiply(left, right) {
  let result = 0;
  for (let i = 0; i < 8; i += 1) {
    if (right & 1) result ^= left;
    const carry = left & 0x80;
    left = (left << 1) & 0xff;
    if (carry) left ^= 0x1d;
    right >>>= 1;
  }
  return result;
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function getOwnBallot() {
  if (!session.activeSubmissionId) return null;
  return state.submissions.find((submission) => submission.id === session.activeSubmissionId) || null;
}

function selectDeviceBallot(submissionId, options = {}) {
  const saved = getDeviceBallots().find((ballot) => ballot.submissionId === submissionId);
  session.activeSubmissionId = saved?.submissionId || "";
  session.ballotToken = saved?.ballotToken || "";
  localStorage.setItem(`activeSubmissionId:${session.partyId}`, session.activeSubmissionId);
  setMessage(els.voteMessage, "");
  renderRankingForm();
  if (options.clearForm) clearRankingForm({ clearName: true });
  renderDeviceBallots();
}

function clearRankingForm(options = {}) {
  if (options.clearName) els.jurorName.value = "";
  els.rankingList.querySelectorAll("select").forEach((select) => {
    select.value = "";
  });
  disableDuplicateOptions();
  setMessage(els.voteMessage, "");
}

function renderLanding(errorMessage = "", options = {}) {
  if (els.landingPage) els.landingPage.classList.remove("is-hidden");
  if (els.setupPage) els.setupPage.classList.add("is-hidden");
  document.querySelector(".app-shell")?.classList.add("is-hidden");
  if (!options.keepJoinPassword) {
    els.landingJoinPasswordGroup?.classList.add("is-hidden");
  } else {
    els.landingJoinPasswordGroup?.classList.remove("is-hidden");
  }
  if (!options.keepAdminSecret) {
    els.landingAdminSecretGroup?.classList.add("is-hidden");
  } else {
    els.landingAdminSecretGroup?.classList.remove("is-hidden");
    els.landingAdminSecret?.focus();
  }
  setLandingMessage(errorMessage, Boolean(errorMessage));
}

function hideLanding() {
  if (els.landingPage) els.landingPage.classList.add("is-hidden");
  document.querySelector(".app-shell")?.classList.remove("is-hidden");
}

function showJoinPasswordPrompt(partyName) {
  renderLanding("", { keepJoinPassword: true });
  if (els.landingJoinCode) els.landingJoinCode.value = session.partyId ? session.partyId.toUpperCase() : "";
  if (els.landingJoinPasswordGroup) els.landingJoinPasswordGroup.classList.remove("is-hidden");
  setLandingMessage(`"${partyName}" requires a join password.`, true);
}

function setLandingMessage(message, isError = false) {
  if (!els.landingError) return;
  els.landingError.textContent = message;
  els.landingError.classList.toggle("is-error", isError);
}

function formatEntriesForTextarea(entries) {
  const lines = ["Running Order\tCountry\tArtist\tSong"];
  entries.forEach((entry, index) => {
    lines.push([entry.runningOrder || index + 1, entry.country, entry.artist, entry.song].map((value) => String(value || "").trim()).join("\t"));
  });
  return `${lines.join("\n")}\n`;
}

function loadActiveDeviceBallot() {
  const savedBallots = getDeviceBallots();
  const activeSubmissionId = localStorage.getItem(`activeSubmissionId:${session.partyId}`) || savedBallots[0]?.submissionId || "";
  const active = savedBallots.find((ballot) => ballot.submissionId === activeSubmissionId);
  session.activeSubmissionId = active?.submissionId || "";
  session.ballotToken = active?.ballotToken || "";
}

function getDeviceBallots() {
  try {
    return JSON.parse(localStorage.getItem(`deviceBallots:${session.partyId}`) || "[]");
  } catch {
    return [];
  }
}

function saveDeviceBallots(ballots) {
  localStorage.setItem(`deviceBallots:${session.partyId}`, JSON.stringify(ballots));
}

function saveDeviceBallot(nextBallot) {
  const ballots = getDeviceBallots().filter((ballot) => ballot.submissionId !== nextBallot.submissionId);
  ballots.push(nextBallot);
  saveDeviceBallots(ballots);
  localStorage.setItem(`activeSubmissionId:${session.partyId}`, nextBallot.submissionId);
}

function clearActiveDeviceBallot() {
  session.activeSubmissionId = "";
  session.ballotToken = "";
  localStorage.removeItem(`activeSubmissionId:${session.partyId}`);
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
    const deltaX = previous.left - current.left;
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

    row.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
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
  const country = [entry.flagCode && `[${entry.flagCode}]`, entry.countryName || entry.country || entry.name].filter(Boolean).join(" ");
  return [country, entry.artist, entry.song].filter(Boolean).join(" - ");
}

function entryDetail(entry) {
  if (!entry) return "";
  return [entry.song && `"${entry.song}"`, entry.artist].filter(Boolean).join(" / ");
}

function countryListMarkup(entries) {
  const labels = entries
    .map((entry) => `${flagMarkup(entry)}${escapeHtml(entry.countryName || entry.country || entry.name)}`)
    .filter(Boolean);
  if (labels.length <= 1) return labels[0] || "no other entries";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function entryDetailInlineMarkup(entry) {
  if (!entry) return "";
  return [
    entry.song ? `<span class="entry-inline-detail"><span class="detail-icon song-icon" aria-hidden="true"></span><span class="entry-detail-text">${escapeHtml(entry.song)}</span></span>` : "",
    entry.artist ? `<span class="entry-inline-detail"><span class="detail-icon artist-icon" aria-hidden="true"></span><span class="entry-detail-text">${escapeHtml(entry.artist)}</span></span>` : ""
  ].filter(Boolean).join("");
}

function getTieBreakLabels(scoreboard) {
  const labels = new Map();
  const groups = new Map();
  for (const entry of scoreboard) {
    if (!entry.total) continue;
    const group = groups.get(entry.total) || [];
    group.push(entry);
    groups.set(entry.total, group);
  }

  for (const group of groups.values()) {
    if (group.length > 1) assignTieBreakLabels(group, labels, 0);
  }
  return labels;
}

function assignTieBreakLabels(entries, labels, pointIndex) {
  if (entries.length <= 1) return;
  const points = state.pointsByRank.length ? state.pointsByRank : [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const pointValue = points[pointIndex];

  if (!pointValue) {
    entries.forEach((entry) => {
      if (entry.runningOrder) labels.set(entry.id, `Running order ${entry.runningOrder}`);
    });
    return;
  }

  const buckets = new Map();
  for (const entry of entries) {
    const count = Number(entry.pointCounts?.[pointValue] || 0);
    const bucket = buckets.get(count) || [];
    bucket.push(entry);
    buckets.set(count, bucket);
  }

  if (buckets.size === 1) {
    assignTieBreakLabels(entries, labels, pointIndex + 1);
    return;
  }

  for (const [count, bucket] of buckets) {
    if (bucket.length === 1) {
      labels.set(bucket[0].id, `Received ${pointValue}pts from ${count} ${count === 1 ? "Jury" : "Juries"}`);
    } else {
      assignTieBreakLabels(bucket, labels, pointIndex + 1);
    }
  }
}

function flagMarkup(entry) {
  if (!entry?.flagCode) return "";
  const code = entry.flagCode.toLowerCase();
  const label = escapeHtml(entry.countryName || entry.flagCode);
  const fallback = escapeHtml(entry.flagCode);
  return `
    <span class="flag-wrap" aria-label="${label}">
      <img class="flag-icon" alt="" src="https://cdnjs.cloudflare.com/ajax/libs/flag-icons/7.5.0/flags/4x3/${code}.svg" loading="lazy" onerror="this.hidden=true; this.nextElementSibling.hidden=false;">
      <span class="flag-fallback" hidden>${fallback}</span>
    </span>`;
}

function awardStyle(points) {
  const colors = {
    1: "74, 222, 128",
    2: "45, 212, 191",
    3: "56, 189, 248",
    4: "129, 140, 248",
    5: "168, 85, 247",
    6: "217, 70, 239",
    7: "244, 114, 182",
    8: "251, 113, 133",
    10: "251, 146, 60",
    12: "250, 204, 21"
  };
  return `--award-rgb: ${colors[points] || "255, 209, 102"};`;
}

function applyPresentationMode(isPresentation) {
  document.body.classList.toggle("is-presentation", isPresentation);
  localStorage.setItem("presentationMode", String(isPresentation));
  els.presentationToggle.textContent = isPresentation ? "Show Panel" : "Hide Panel";
  els.presentationToggle.setAttribute("aria-pressed", String(isPresentation));
}
