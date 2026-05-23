const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { createStorage } = require("./storage");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "esc-scoreboard-data") : path.join(ROOT, "data")));
const PARTY_DIR = path.join(DATA_DIR, "parties");
const ENTRY_LIST_DIR = path.join(ROOT, "entries");
const STORAGE_DRIVER = String(process.env.STORAGE_DRIVER || (process.env.ESC_DOCKER ? "sqlite" : "json")).toLowerCase();
const DATABASE_FILE = path.resolve(process.env.DATABASE_FILE || path.join(DATA_DIR, "scoreboard.sqlite"));
const PARTY_CREATION = String(process.env.PARTY_CREATION || "open").toLowerCase();
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "");
const DEFAULT_ENTRY_LIST_ID = "2026";
const ENTRIES_FILE = path.resolve(process.env.ENTRIES_FILE || path.join(ENTRY_LIST_DIR, `${DEFAULT_ENTRY_LIST_ID}.tsv`));
const DEFAULT_PARTY_ID = "local";
const PARTY_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PARTY_CODE_LENGTH = 6;
const CODE_PATTERN = /^[a-hj-km-np-z2-9]{6}$/;
const POINTS_BY_RANK = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const storage = createStorage({
  driver: STORAGE_DRIVER,
  dataDir: DATA_DIR,
  partyDir: PARTY_DIR,
  databaseFile: DATABASE_FILE
});
const clients = new Map();

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true,
        storage: storage.driver,
        uptime: Math.round(process.uptime())
      });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      return handleEvents(req, res, url);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const hostLabel = ["0.0.0.0", "::"].includes(HOST) ? "localhost" : HOST;
    console.log(`Eurovision scoreboard running at http://${hostLabel}:${PORT}`);
    console.log(`Storage driver: ${storage.driver}`);
  });
}

module.exports = handleRequest;

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/network") {
    const partyId = getPartyId(url, req);
    return sendJson(res, 200, {
      port: PORT,
      partyId,
      urls: getNetworkUrls(partyId)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/entry-lists") {
    return sendJson(res, 200, {
      defaultListId: DEFAULT_ENTRY_LIST_ID,
      lists: getEntryLists()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/entry-lists/read") {
    const listId = normalizeEntryListId(url.searchParams.get("entryListId"));
    if (!listId) {
      return sendJson(res, 400, { error: "Choose an entry list first." });
    }
    const entries = readEntryListFile(listId);
    return sendJson(res, 200, {
      entryListId: listId,
      entries,
      entriesText: formatEntries(entries)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/parties") {
    const body = await readJson(req);
    if (!canCreateParty(req, url, body)) {
      return sendJson(res, 403, { error: "admin_secret_required" });
    }
    const joinPassword = body.joinPassword ? String(body.joinPassword).trim() : null;
    if (joinPassword && joinPassword.length < 4) {
      return sendJson(res, 400, { error: "Join password must be at least 4 characters." });
    }
    const party = createInitialState(createPartyId(), String(body.name || "Eurovision Party").trim() || "Eurovision Party", joinPassword);
    const hostToken = createToken();
    const joinToken = createToken();
    party.host = {
      mode: body.password ? "password" : "device",
      tokens: [hashToken(hostToken)],
      password: body.password ? hashPassword(String(body.password)) : null
    };
    party.join.tokens = [hashToken(joinToken)];
    savePartyState(party);
    return sendJson(res, 200, { party: getPublicState(party, hostToken, joinToken), hostToken, joinToken });
  }

  if (req.method === "POST" && url.pathname === "/api/parties/join") {
    const body = await readJson(req);
    const partyId = normalizePartyId(getPartyId(url, req));
    const state = loadPartyState(partyId);

    if (!state.join?.password) {
      const joinToken = createToken();
      state.join.tokens = [...new Set([...(state.join?.tokens || []), hashToken(joinToken)])];
      savePartyState(state);
      return sendJson(res, 200, {
        party: getPublicState(state, getHostToken(req, url), joinToken),
        joinToken
      });
    }

    const password = String(body.password || "");
    if (!verifyPassword(password, state.join.password)) {
      return sendJson(res, 403, { error: "Incorrect join password." });
    }

    const joinToken = createToken();
    state.join.tokens = [...new Set([...(state.join.tokens || []), hashToken(joinToken)])];
    savePartyState(state);
    return sendJson(res, 200, {
      party: getPublicState(state, getHostToken(req, url), joinToken),
      joinToken
    });
  }

  const partyId = getPartyId(url, req);
  const joinToken = getJoinToken(req, url);
  const state = loadPartyState(partyId);

  if (req.method === "GET" && url.pathname === "/api/state") {
    if (!isJoinAuthorized(state, joinToken)) {
      return sendJson(res, 401, { error: "join_password_required", partyName: state.name, partyId: state.id });
    }
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/host/claim") {
    const body = await readJson(req);
    const result = claimHost(state, String(body.password || ""), getHostToken(req, url));
    if (result.error) {
      return sendJson(res, result.status, { error: result.error });
    }
    saveAndBroadcast(state);
    return sendJson(res, 200, { hostToken: result.hostToken, party: getPublicState(state, result.hostToken, joinToken) });
  }

  if (req.method === "POST" && url.pathname === "/api/host/password") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const password = String(body.password || "");
    if (password.length < 4) {
      return sendJson(res, 400, { error: "Use a host password with at least 4 characters." });
    }

    state.host.mode = "password";
    state.host.password = hashPassword(password);
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/host/release") {
    const hostToken = getHostToken(req, url);
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    releaseHost(state, hostToken);
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, "", joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/party/name") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const name = String(body.name || "").trim();
    if (!name) {
      return sendJson(res, 400, { error: "Add a scoreboard title." });
    }
    if (name.length > 80) {
      return sendJson(res, 400, { error: "Keep the scoreboard title under 80 characters." });
    }

    state.name = name;
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/entries") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const entries = parseEntriesPayload(body);

    if (entries.length < 10) {
      return sendJson(res, 400, { error: "Add at least 10 entries before voting." });
    }

    let savedListId = "";
    if (body.saveList) {
      savedListId = normalizeEntryListId(body.entryListId || body.entryListName);
      if (!savedListId) {
        return sendJson(res, 400, { error: "Add a list name before saving the entry list." });
      }
      writeEntryListFile(savedListId, entries);
    }

    state.entries = entries;
    state.entriesFile = savedListId ? getEntryListStatePath(savedListId, true) : null;
    state.submissions = [];
    state.appliedVotes = [];
    state.currentReveal = null;
    state.winnerReveal = null;
    state.votingStatus = "open";
    state.votingStatusChangedAt = new Date().toISOString();
    saveAndBroadcast(state);
    return sendJson(res, 200, {
      party: getPublicState(state, getHostToken(req, url), joinToken),
      entryLists: getEntryLists(),
      savedListId: savedListId || null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/entry-lists/load") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const listId = normalizeEntryListId(body.entryListId);
    if (!listId) {
      return sendJson(res, 400, { error: "Choose an entry list first." });
    }

    const entries = readEntryListFile(listId);
    if (entries.length < 10) {
      return sendJson(res, 400, { error: "That entry list needs at least 10 entries." });
    }

    state.entries = entries;
    state.entriesFile = getEntryListStatePath(listId);
    state.submissions = [];
    state.appliedVotes = [];
    state.currentReveal = null;
    state.winnerReveal = null;
    state.votingStatus = "open";
    state.votingStatusChangedAt = new Date().toISOString();
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const body = await readJson(req);
    const juror = String(body.juror || "").trim();
    const ballotToken = String(body.ballotToken || "");
    const ranking = Array.isArray(body.ranking) ? body.ranking.map(String) : [];
    const validIds = new Set(state.entries.map((entry) => entry.id));
    const uniqueRanking = [...new Set(ranking)].filter((id) => validIds.has(id)).slice(0, 10);

    if (state.votingStatus === "closed") {
      return sendJson(res, 403, { error: "Voting is closed." });
    }

    if (!juror) {
      return sendJson(res, 400, { error: "Please add your name." });
    }

    if (uniqueRanking.length !== 10) {
      return sendJson(res, 400, { error: "Rank exactly 10 different entries." });
    }

    const tokenHash = ballotToken ? hashToken(ballotToken) : "";
    const existing = tokenHash
      ? state.submissions.find((submission) => safeEqual(submission.ballotTokenHash || "", tokenHash))
      : null;

    if (existing && existing.status !== "pending") {
      return sendJson(res, 409, { error: "Presentation has started for this ballot, so it can no longer be edited." });
    }

    if (state.submissions.some((submission) => submission.id !== existing?.id && sameName(submission.juror, juror))) {
      return sendJson(res, 409, { error: "That jury name is already in use. Use the same browser to edit it, or ask the host to remove it." });
    }

    const nextBallotToken = existing ? ballotToken : createToken();
    const submission = {
      id: existing?.id || randomUUID(),
      juror,
      ranking: uniqueRanking,
      status: "pending",
      submittedAt: existing?.submittedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ballotTokenHash: existing?.ballotTokenHash || hashToken(nextBallotToken)
    };

    if (existing) {
      Object.assign(existing, submission);
    } else {
      state.submissions.push(submission);
    }

    saveAndBroadcast(state);
    return sendJson(res, 200, { ok: true, submissionId: submission.id, ballotToken: nextBallotToken, submission });
  }

  if (req.method === "POST" && url.pathname === "/api/submissions/practice") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const count = Math.max(1, Math.min(12, Number(body.count || 5)));
    const result = addPracticeSubmissions(state, count);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    saveAndBroadcast(state);
    return sendJson(res, 200, { ...getPublicState(state, getHostToken(req, url), joinToken), addedPracticeBallots: result.added });
  }

  if (req.method === "POST" && url.pathname === "/api/submissions/remove") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const submissionId = String(body.submissionId || "");
    const submission = state.submissions.find((item) => item.id === submissionId);

    if (!submission) {
      return sendJson(res, 404, { error: "That juror ballot was not found." });
    }

    state.submissions = state.submissions.filter((item) => item.id !== submissionId);
    state.appliedVotes = state.appliedVotes.filter((vote) => vote.submissionId !== submissionId);
    state.winnerReveal = null;

    if (state.currentReveal?.submissionId === submissionId) {
      state.currentReveal = null;
    } else if (state.currentReveal?.lastAwards?.some((award) => award.submissionId === submissionId)) {
      state.currentReveal.lastAwards = [];
      state.currentReveal.lastAward = null;
    }

    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/start") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const submission = state.submissions.find((item) => item.id === body.submissionId);

    if (!submission) {
      return sendJson(res, 404, { error: "That jury submission was not found." });
    }

    if (submission.status === "applied") {
      return sendJson(res, 400, { error: "That jury has already been fully applied." });
    }

    startSubmissionReveal(state, submission);
    state.winnerReveal = null;
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/next-jury") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    if (state.currentReveal && !state.currentReveal.finished) {
      return sendJson(res, 400, { error: "Finish the current jury before starting the next one." });
    }

    if (state.currentReveal?.finished) {
      const currentSubmission = state.submissions.find((item) => item.id === state.currentReveal.submissionId);
      if (currentSubmission) currentSubmission.status = "applied";
      state.currentReveal = null;
    }

    const nextSubmission = state.submissions.find((submission) => submission.status === "pending");
    if (!nextSubmission) {
      return sendJson(res, 400, { error: "There are no pending juries to reveal." });
    }

    startSubmissionReveal(state, nextSubmission);
    state.winnerReveal = null;
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/next") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const result = awardNextPoint(state);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/to") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const result = awardThroughPoint(state, Number(body.targetPoints));
    if (result.error) return sendJson(res, result.status, { error: result.error });
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/finish") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    if (state.currentReveal) {
      const submission = state.submissions.find((item) => item.id === state.currentReveal.submissionId);
      if (submission && state.currentReveal.nextIndex < 0) {
        submission.status = "applied";
      }
    }
    state.currentReveal = null;
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/winner/show") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    if (state.currentReveal && !state.currentReveal.finished) {
      return sendJson(res, 400, { error: "Finish the current jury before showing the winner." });
    }

    if (!state.appliedVotes.length) {
      return sendJson(res, 400, { error: "Reveal at least one jury before showing the winner." });
    }

    if (!state.submissions.length || state.submissions.some((submission) => submission.status !== "applied")) {
      return sendJson(res, 400, { error: "Reveal every submitted jury before showing the winner." });
    }

    state.currentReveal = null;
    state.winnerReveal = { shownAt: new Date().toISOString() };
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/voting/status") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const status = String(body.status || "");
    if (!["open", "closed"].includes(status)) {
      return sendJson(res, 400, { error: "Choose open or closed voting." });
    }

    state.votingStatus = status;
    state.votingStatusChangedAt = new Date().toISOString();
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    if (body.mode === "votes") {
      state.submissions = [];
      state.appliedVotes = [];
      state.currentReveal = null;
      state.winnerReveal = null;
      state.votingStatus = "open";
      state.votingStatusChangedAt = new Date().toISOString();
    } else {
      const fresh = createInitialState(state.id, state.name);
      fresh.host = state.host;
      Object.assign(state, fresh);
    }
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url), joinToken));
  }

  return sendJson(res, 404, { error: "Not found." });
}

function handleEvents(req, res, url) {
  const partyId = getPartyId(url, req);
  const state = loadPartyState(partyId);
  const joinToken = getJoinToken(req, url);

  if (!isJoinAuthorized(state, joinToken)) {
    sendJson(res, 401, { error: "join_password_required", partyName: state.name, partyId: state.id });
    return;
  }

  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`data: ${JSON.stringify(getPublicState(state, getHostToken(req, url), joinToken))}\n\n`);

  if (!clients.has(partyId)) clients.set(partyId, new Set());
  const client = { res, hostToken: getHostToken(req, url), joinToken };
  clients.get(partyId).add(client);

  req.on("close", () => {
    clients.get(partyId)?.delete(client);
  });
}

function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT, cleanPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, securityHeaders());
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, securityHeaders());
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...securityHeaders(),
      "Cache-Control": isStaticAsset(ext) ? "public, max-age=300" : "no-cache",
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    res.end(content);
  });
}

function getPublicState(state, hostToken = "", joinToken = "") {
  const totals = new Map(state.entries.map((entry) => [entry.id, 0]));
  const pointCounts = new Map(state.entries.map((entry) => [entry.id, createPointCounts()]));
  const pointJurors = new Map(state.entries.map((entry) => [entry.id, new Set()]));
  for (const vote of state.appliedVotes) {
    totals.set(vote.entryId, (totals.get(vote.entryId) || 0) + vote.points);
    const counts = pointCounts.get(vote.entryId);
    if (counts && POINTS_BY_RANK.includes(vote.points)) {
      counts.set(vote.points, (counts.get(vote.points) || 0) + 1);
    }
    pointJurors.get(vote.entryId)?.add(vote.submissionId || vote.juror || vote.id);
  }

  const recentAwards = getRecentAwards(state);
  const scoreboard = state.entries
    .map((entry) => {
      const recentAward = recentAwards.get(entry.id);
      return {
        ...entry,
        total: totals.get(entry.id) || 0,
        pointJurorCount: pointJurors.get(entry.id)?.size || 0,
        pointCounts: Object.fromEntries(pointCounts.get(entry.id) || createPointCounts()),
        lastPoints: recentAward?.points || null,
        pointTier: recentAward ? getPointTier(recentAward.points) : null
      };
    })
    .sort(compareScoreboardEntries);
  const winnerReveal = getWinnerReveal(state, scoreboard);

  return {
    id: state.id,
    name: state.name,
    entries: state.entries,
    entriesFile: state.entriesFile,
    entryListId: getEntryListIdFromPath(state.entriesFile),
    submissions: state.submissions.map(({ ballotTokenHash, ...submission }) => submission),
    appliedVotes: state.appliedVotes,
    currentReveal: state.currentReveal,
    winnerReveal,
    votingStatus: state.votingStatus || "open",
    votingStatusChangedAt: state.votingStatusChangedAt || null,
    createdAt: state.createdAt,
    host: {
      mode: state.host?.mode || "open",
      hasPassword: Boolean(state.host?.password),
      isHost: isHostToken(state, hostToken)
    },
    join: {
      hasPassword: Boolean(state.join?.password),
      isAuthorized: isJoinAuthorized(state, joinToken)
    },
    entriesText: formatEntries(state.entries),
    scoreboard,
    pointsByRank: POINTS_BY_RANK
  };
}

function getRecentAwards(state) {
  const awards = state.currentReveal?.highlightedAwards?.length
    ? state.currentReveal.highlightedAwards
    : state.currentReveal?.lastAwards?.length
      ? state.currentReveal.lastAwards
    : state.currentReveal?.lastAward
      ? [state.currentReveal.lastAward]
      : [];

  return new Map(awards.map((award) => [award.entryId, award]));
}

function getWinnerReveal(state, scoreboard) {
  if (!state.winnerReveal || !scoreboard.length) return null;

  const winner = scoreboard[0];
  const winningTotal = winner.total;
  if (winningTotal <= 0) return null;
  const topEntries = scoreboard.filter((entry) => entry.total === winningTotal);

  return {
    shownAt: state.winnerReveal.shownAt,
    total: winningTotal,
    entry: winner,
    entries: [winner],
    tiedEntries: topEntries,
    tieBreak: getWinnerTieBreak(winner, topEntries)
  };
}

function getPointTier(points) {
  if ([8, 10, 12].includes(points)) return `special-${points}`;
  return "standard";
}

function addPracticeSubmissions(state, count) {
  if (state.entries.length < 10) {
    return { status: 400, error: "Add at least 10 entries before creating practice ballots." };
  }

  const existingNames = new Set(state.submissions.map((submission) => submission.juror.toLowerCase()));
  const submissions = [];

  for (let index = 0; index < count; index += 1) {
    const juror = getPracticeJurorName(existingNames);
    const ballotToken = createToken();
    const submission = {
      id: randomUUID(),
      juror,
      ranking: shuffleEntries(state.entries).slice(0, 10).map((entry) => entry.id),
      status: "pending",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ballotTokenHash: hashToken(ballotToken),
      isPractice: true
    };
    submissions.push(submission);
    existingNames.add(juror.toLowerCase());
  }

  state.submissions.push(...submissions);
  state.winnerReveal = null;
  return { added: submissions.length };
}

function startSubmissionReveal(state, submission) {
  state.currentReveal = {
    submissionId: submission.id,
    juror: submission.juror,
    nextIndex: 9,
    lastAward: null,
    lastAwards: [],
    highlightedAwards: []
  };
  submission.status = "revealing";
}

function getPracticeJurorName(existingNames) {
  for (let index = 1; index < 1000; index += 1) {
    const name = `Practice Jury ${index}`;
    if (!existingNames.has(name.toLowerCase())) return name;
  }
  return `Practice Jury ${randomBytes(3).toString("hex")}`;
}

function shuffleEntries(entries) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = randomInt(index + 1);
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }
  return shuffled;
}

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  let value;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return value % max;
}

function awardNextPoint(state) {
  const context = getRevealContext(state);
  if (context.error) return context;

  const { submission } = context;
  const rankIndex = state.currentReveal.nextIndex;
  if (rankIndex < 0) {
    return { status: 400, error: "This jury has already been revealed." };
  }

  applyAwards(state, submission, [rankIndex]);
  return {};
}

function awardThroughPoint(state, targetPoints) {
  const context = getRevealContext(state);
  if (context.error) return context;

  if (!POINTS_BY_RANK.includes(targetPoints)) {
    return { status: 400, error: "Choose one of the Eurovision point values." };
  }

  const { submission } = context;
  const rankIndexes = [];
  while (state.currentReveal.nextIndex >= 0 && POINTS_BY_RANK[state.currentReveal.nextIndex] <= targetPoints) {
    rankIndexes.push(state.currentReveal.nextIndex);
    state.currentReveal.nextIndex -= 1;
  }

  if (!rankIndexes.length) {
    state.currentReveal.lastAwards = [];
    state.currentReveal.lastAward = null;
    return {};
  }

  applyAwards(state, submission, rankIndexes, { nextIndexAlreadyMoved: true });
  return {};
}

function getRevealContext(state) {
  if (!state.currentReveal) {
    return { status: 400, error: "Pick a jury to reveal first." };
  }

  const submission = state.submissions.find((item) => item.id === state.currentReveal.submissionId);
  if (!submission) {
    state.currentReveal = null;
    saveAndBroadcast(state);
    return { status: 404, error: "The current jury submission is missing." };
  }

  return { submission };
}

function applyAwards(state, submission, rankIndexes, options = {}) {
  const awards = rankIndexes.map((rankIndex) => {
    const entryId = submission.ranking[rankIndex];
    const points = POINTS_BY_RANK[rankIndex];
    return {
      id: randomUUID(),
      submissionId: submission.id,
      juror: submission.juror,
      entryId,
      points,
      rank: rankIndex + 1,
      appliedAt: new Date().toISOString()
    };
  });

  state.appliedVotes.push(...awards);
  state.currentReveal.lastAwards = awards;
  state.currentReveal.lastAward = awards[awards.length - 1] || null;
  state.currentReveal.highlightedAwards = [...(state.currentReveal.highlightedAwards || []), ...awards];

  if (!options.nextIndexAlreadyMoved) {
    state.currentReveal.nextIndex -= awards.length;
  }

  if (state.currentReveal.nextIndex < 0) {
    submission.status = "applied";
    state.currentReveal.finished = true;
  }
}

function claimHost(state, password, currentToken = "") {
  const host = ensureHost(state);

  if (isHostToken(state, currentToken)) {
    return { hostToken: currentToken };
  }

  if (host.mode === "password") {
    if (!verifyPassword(password, host.password)) {
      return { status: 403, error: "That host password did not match." };
    }
  } else if (host.mode !== "open" || host.tokens.length) {
    return { status: 403, error: "Host access is already claimed. Ask the host to set a password if you need to unlock another device." };
  }

  const hostToken = createToken();
  host.tokens = [...new Set([...(host.tokens || []), hashToken(hostToken)])];
  if (host.mode === "open") {
    host.mode = "device";
  }

  return { hostToken };
}

function releaseHost(state, token) {
  const host = ensureHost(state);
  const tokenHash = hashToken(token);
  host.tokens = host.tokens.filter((knownHash) => !safeEqual(knownHash, tokenHash));

  if (!host.password && !host.tokens.length) {
    host.mode = "open";
  } else if (host.password) {
    host.mode = "password";
  }
}

function canCreateParty(req, url, body = {}) {
  if (PARTY_CREATION !== "admin") return true;
  if (!ADMIN_SECRET) return false;
  const providedSecret = String(body.adminSecret || req.headers["x-admin-secret"] || url.searchParams.get("adminSecret") || "");
  return safeEqual(providedSecret, ADMIN_SECRET);
}

function requireHost(req, url, state) {
  if (isHostToken(state, getHostToken(req, url))) return {};
  return { status: 403, error: "Host controls are locked. Claim host access first." };
}

function ensureHost(state) {
  if (!state.host) {
    state.host = { mode: "open", tokens: [], password: null };
  }
  state.host.tokens ||= [];
  return state.host;
}

function isHostToken(state, token) {
  if (!token) return false;
  const host = ensureHost(state);
  const tokenHash = hashToken(token);
  return host.tokens.some((knownHash) => safeEqual(knownHash, tokenHash));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: createHash("sha256").update(`${salt}:${password}`).digest("hex") };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  return safeEqual(createHash("sha256").update(`${stored.salt}:${password}`).digest("hex"), stored.hash);
}

function createToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function saveAndBroadcast(state) {
  savePartyState(state);
  const partyClients = clients.get(state.id) || new Set();
  for (const client of partyClients) {
    client.res.write(`data: ${JSON.stringify(getPublicState(state, client.hostToken, client.joinToken))}\n\n`);
  }
}

function loadPartyState(partyId) {
  const id = normalizePartyId(partyId);
  const savedState = storage.loadParty(id);

  if (savedState) {
    const state = {
      ...savedState,
      entries: Array.isArray(savedState.entries) && savedState.entries.length
        ? savedState.entries.map((entry, index) => normalizeEntry(entry, index + 1))
        : readEntriesFile()
    };
    state.id = id;
    state.host = state.host || { mode: "open", tokens: [], password: null };
    state.join = state.join || { password: null, tokens: [] };
    state.join.tokens ||= [];
    state.entriesFile = state.entriesFile ?? null;
    state.winnerReveal = state.winnerReveal || null;
    state.votingStatus = state.votingStatus || "open";
    state.votingStatusChangedAt = state.votingStatusChangedAt || null;
    return state;
  }

  const state = createInitialState(id, id === DEFAULT_PARTY_ID ? "Local Watch Party" : "Eurovision Party");
  savePartyState(state);
  return state;
}

function savePartyState(state) {
  storage.saveParty(state);
}

function createInitialState(id = DEFAULT_PARTY_ID, name = "Eurovision Party", joinPassword = null) {
  return {
    id: normalizePartyId(id),
    name,
    entries: readEntriesFile(),
    entriesFile: path.relative(ROOT, ENTRIES_FILE),
    submissions: [],
    appliedVotes: [],
    currentReveal: null,
    winnerReveal: null,
    votingStatus: "open",
    votingStatusChangedAt: new Date().toISOString(),
    host: { mode: "open", tokens: [], password: null },
    join: {
      password: joinPassword ? hashPassword(joinPassword) : null,
      tokens: []
    },
    createdAt: new Date().toISOString()
  };
}

function getPartyId(url, req) {
  return normalizePartyId(url.searchParams.get("party") || req.headers["x-party-id"] || DEFAULT_PARTY_ID);
}

function getHostToken(req, url) {
  return String(url.searchParams.get("hostToken") || req.headers["x-host-token"] || "");
}

function getJoinToken(req, url) {
  return String(url.searchParams.get("joinToken") || req.headers["x-join-token"] || "");
}

function isJoinAuthorized(state, token) {
  if (!state.join?.password) return true;
  if (!token) return false;
  const tokenHash = hashToken(token);
  return (state.join.tokens || []).some((t) => safeEqual(t, tokenHash));
}

function createPartyId() {
  return generatePartyCode();
}

function generatePartyCode() {
  const bytes = randomBytes(PARTY_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) {
    code += PARTY_CODE_CHARS[bytes[i] % PARTY_CODE_CHARS.length];
  }
  return code.toLowerCase();
}

function getNetworkUrls(partyId) {
  const candidates = [];
  const interfaces = os.networkInterfaces();

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      candidates.push({
        name,
        address: address.address,
        url: `http://${address.address}:${PORT}/?party=${encodeURIComponent(partyId)}`,
        score: scoreNetworkAddress(name, address.address)
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return [
    `http://localhost:${PORT}/?party=${encodeURIComponent(partyId)}`,
    ...candidates.map((candidate) => candidate.url)
  ].filter((url, index, urls) => urls.indexOf(url) === index);
}

function scoreNetworkAddress(name, address) {
  const label = name.toLowerCase();
  let score = 0;

  if (address.startsWith("192.168.")) score += 60;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 50;
  else if (address.startsWith("10.")) score += 40;

  if (/(wi-?fi|wireless|wlan|ethernet|en\d|eth\d)/.test(label)) score += 20;
  if (/(vpn|virtual|vmware|virtualbox|vbox|docker|wsl|hyper-v|vethernet|tailscale|zerotier|loopback|bluetooth)/.test(label)) score -= 80;

  return score;
}

function normalizePartyId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_PARTY_ID;
  if (CODE_PATTERN.test(raw)) return raw;
  const normalized = raw
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized || DEFAULT_PARTY_ID;
}

function readEntriesFile() {
  return parseEntries(fs.readFileSync(ENTRIES_FILE, "utf8"));
}

function getEntryLists() {
  const lists = new Map();

  try {
    fs.readdirSync(ENTRY_LIST_DIR)
      .filter((file) => file.toLowerCase().endsWith(".tsv"))
      .forEach((file) => {
        const id = normalizeEntryListId(path.basename(file, ".tsv"));
        if (!id) return;
        lists.set(id, {
          id,
          name: getEntryListName(id),
          path: path.relative(ROOT, path.join(ENTRY_LIST_DIR, file)),
          isDefault: path.resolve(ENTRY_LIST_DIR, file) === ENTRIES_FILE
        });
      });
  } catch {
    // The bundled entry directory is optional in custom images.
  }

  for (const rawId of storage.listEntryLists()) {
    const id = normalizeEntryListId(rawId);
    if (!id) continue;
    lists.set(id, {
      id,
      name: getEntryListName(id),
      path: `data/entry-lists/${id}.tsv`,
      isDefault: false
    });
  }

  return [...lists.values()].sort((a, b) => b.id.localeCompare(a.id));
}

function readEntryListFile(listId) {
  const id = normalizeEntryListId(listId);
  const storedList = storage.readEntryList(id);
  if (storedList !== null) return parseEntries(storedList);
  return parseEntries(fs.readFileSync(getBundledEntryListFile(id), "utf8"));
}

function writeEntryListFile(listId, entries) {
  storage.writeEntryList(normalizeEntryListId(listId), formatEntries(entries));
}

function getEntryListStatePath(listId, forceStored = false) {
  const id = normalizeEntryListId(listId);
  if (forceStored || storage.readEntryList(id) !== null) return `data/entry-lists/${id}.tsv`;
  return path.relative(ROOT, getBundledEntryListFile(id));
}

function getBundledEntryListFile(listId) {
  return path.join(ENTRY_LIST_DIR, `${normalizeEntryListId(listId)}.tsv`);
}

function getEntryListName(id) {
  return /^\d{4}$/.test(id) ? `${id} Grand Final` : id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getEntryListIdFromPath(filePath) {
  if (!filePath) return "";
  const parsed = path.parse(filePath);
  return normalizeEntryListId(parsed.name);
}

function normalizeEntryListId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.tsv$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function parseEntriesPayload(body) {
  if (Array.isArray(body.entries)) {
    return uniqueEntries(body.entries
      .map((entry, index) => normalizeEntry({
        runningOrder: entry?.runningOrder,
        country: entry?.country,
        artist: entry?.artist,
        song: entry?.song
      }, index + 1))
      .filter((entry) => entry.country));
  }

  return parseEntries(typeof body.entriesText === "string" ? body.entriesText : "");
}

function parseEntries(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const header = lines[0]?.toLowerCase();
  const hasRunningOrderColumn = header?.startsWith("running order\tcountry\tartist\tsong");
  if (hasRunningOrderColumn || header?.startsWith("country\tartist\tsong")) {
    lines.shift();
  }

  const entries = lines.map((line, index) => {
    const parts = line.split("\t").map((part) => part.trim());
    const [runningOrder, country, artist, song] = hasRunningOrderColumn
      ? [parts[0], parts[1], parts[2], parts[3]]
      : [index + 1, parts[0], parts[1], parts[2]];
    return normalizeEntry({ runningOrder, country, artist, song }, index + 1);
  }).filter((entry) => entry.country);

  return uniqueEntries(entries);
}

function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function formatEntries(entries) {
  const lines = ["Running Order\tCountry\tArtist\tSong"];
  entries.forEach((entry, index) => {
    lines.push([entry.runningOrder || index + 1, entry.country, entry.artist, entry.song].map((value) => String(value || "").trim()).join("\t"));
  });
  return `${lines.join("\n")}\n`;
}

function createPointCounts() {
  return new Map(POINTS_BY_RANK.map((points) => [points, 0]));
}

function compareScoreboardEntries(a, b) {
  return b.total - a.total
    || (b.pointJurorCount || 0) - (a.pointJurorCount || 0)
    || comparePointCounts(a, b)
    || compareRunningOrder(a, b)
    || a.name.localeCompare(b.name);
}

function comparePointCounts(a, b) {
  for (const points of POINTS_BY_RANK) {
    const diff = (b.pointCounts?.[points] || 0) - (a.pointCounts?.[points] || 0);
    if (diff) return diff;
  }
  return 0;
}

function getWinnerTieBreak(winner, tiedEntries) {
  if (tiedEntries.length <= 1) return null;

  const winnerJurorCount = winner.pointJurorCount || 0;
  const highestJurorCount = Math.max(...tiedEntries.map((entry) => entry.pointJurorCount || 0));
  const entriesWithHighestJurorCount = tiedEntries.filter((entry) => (entry.pointJurorCount || 0) === highestJurorCount);
  if (winnerJurorCount === highestJurorCount && entriesWithHighestJurorCount.length < tiedEntries.length) {
    return {
      type: "pointJurors",
      count: winnerJurorCount,
      label: `Received points from ${winnerJurorCount} ${winnerJurorCount === 1 ? "Jury" : "Juries"}`
    };
  }

  for (const points of POINTS_BY_RANK) {
    const winnerCount = winner.pointCounts?.[points] || 0;
    const highestCount = Math.max(...tiedEntries.map((entry) => entry.pointCounts?.[points] || 0));
    const entriesWithHighestCount = tiedEntries.filter((entry) => (entry.pointCounts?.[points] || 0) === highestCount);
    if (winnerCount === highestCount && entriesWithHighestCount.length < tiedEntries.length) {
      return {
        type: "points",
        points,
        count: winnerCount,
        label: `Received ${points}pts from ${winnerCount} ${winnerCount === 1 ? "Jury" : "Juries"}`
      };
    }
  }

  return {
    type: "runningOrder",
    runningOrder: winner.runningOrder,
    label: `Earlier running order (${winner.runningOrder})`
  };
}

function compareRunningOrder(a, b) {
  const aOrder = Number.isFinite(a.runningOrder) ? a.runningOrder : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(b.runningOrder) ? b.runningOrder : Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
}

function normalizeEntry(entry, fallbackRunningOrder = null) {
  const runningOrder = normalizeRunningOrder(entry.runningOrder, fallbackRunningOrder);
  const country = String(entry.country || entry.name || "").trim();
  const artist = String(entry.artist || "").trim();
  const song = String(entry.song || "").trim();
  const flag = parseFlagPrefix(country);
  const countryName = flag.countryName || country;
  const name = [country, artist && `- ${artist}`, song && `- "${song}"`].filter(Boolean).join(" ");

  return {
    id: slug(country),
    runningOrder,
    country,
    countryName,
    flagCode: flag.flagCode,
    artist,
    song,
    name
  };
}

function normalizeRunningOrder(value, fallback = null) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) return number;
  const fallbackNumber = Number(fallback);
  if (Number.isInteger(fallbackNumber) && fallbackNumber > 0) return fallbackNumber;
  return null;
}

function parseFlagPrefix(country) {
  const chars = [...country];
  const first = chars[0]?.codePointAt(0);
  const second = chars[1]?.codePointAt(0);
  const regionalA = 0x1f1e6;
  const regionalZ = 0x1f1ff;
  if (first >= regionalA && first <= regionalZ && second >= regionalA && second <= regionalZ) {
    const flagCode = String.fromCharCode(65 + first - regionalA, 65 + second - regionalA);
    return {
      flagCode,
      countryName: chars.slice(2).join("").trim()
    };
  }

  return { flagCode: "", countryName: country };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin"
  };
}

function isStaticAsset(ext) {
  return [".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".ico"].includes(ext);
}

function slug(value) {
  const base = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || randomUUID();
}

function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
