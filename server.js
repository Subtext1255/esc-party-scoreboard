const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PARTY_DIR = path.join(DATA_DIR, "parties");
const ENTRIES_FILE = path.resolve(process.env.ENTRIES_FILE || path.join(ROOT, "entries", "2026.tsv"));
const DEFAULT_PARTY_ID = "local";
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

const clients = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

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
});

server.listen(PORT, () => {
  console.log(`Eurovision scoreboard running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/network") {
    const partyId = getPartyId(url, req);
    return sendJson(res, 200, {
      port: PORT,
      partyId,
      urls: getNetworkUrls(partyId)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/parties") {
    const body = await readJson(req);
    const party = createInitialState(createPartyId(), String(body.name || "Eurovision Party").trim() || "Eurovision Party");
    const hostToken = createToken();
    party.host = {
      mode: body.password ? "password" : "device",
      tokens: [hashToken(hostToken)],
      password: body.password ? hashPassword(String(body.password)) : null
    };
    savePartyState(party);
    return sendJson(res, 200, { party: getPublicState(party, hostToken), hostToken });
  }

  const partyId = getPartyId(url, req);
  const state = loadPartyState(partyId);

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  if (req.method === "POST" && url.pathname === "/api/host/claim") {
    const body = await readJson(req);
    const result = claimHost(state, String(body.password || ""));
    if (result.error) {
      return sendJson(res, result.status, { error: result.error });
    }
    saveAndBroadcast(state);
    return sendJson(res, 200, { hostToken: result.hostToken, party: getPublicState(state, result.hostToken) });
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
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  if (req.method === "POST" && url.pathname === "/api/entries") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const entriesText = typeof body.entriesText === "string" ? body.entriesText : "";
    const entries = parseEntries(entriesText);

    if (entries.length < 10) {
      return sendJson(res, 400, { error: "Add at least 10 entries before voting." });
    }

    state.entries = entries;
    state.entriesFile = null;
    state.submissions = [];
    state.appliedVotes = [];
    state.currentReveal = null;
    state.winnerReveal = null;
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const body = await readJson(req);
    const juror = String(body.juror || "").trim();
    const ballotToken = String(body.ballotToken || "");
    const ranking = Array.isArray(body.ranking) ? body.ranking.map(String) : [];
    const validIds = new Set(state.entries.map((entry) => entry.id));
    const uniqueRanking = [...new Set(ranking)].filter((id) => validIds.has(id)).slice(0, 10);

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
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
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

    state.currentReveal = {
      submissionId: submission.id,
      juror: submission.juror,
      nextIndex: 9,
      lastAward: null,
      lastAwards: [],
      highlightedAwards: []
    };
    state.winnerReveal = null;
    submission.status = "revealing";
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/next") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const result = awardNextPoint(state);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  if (req.method === "POST" && url.pathname === "/api/reveal/to") {
    const auth = requireHost(req, url, state);
    if (auth.error) return sendJson(res, auth.status, { error: auth.error });

    const body = await readJson(req);
    const result = awardThroughPoint(state, Number(body.targetPoints));
    if (result.error) return sendJson(res, result.status, { error: result.error });
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
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
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
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
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
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
    } else {
      const fresh = createInitialState(state.id, state.name);
      fresh.host = state.host;
      Object.assign(state, fresh);
    }
    saveAndBroadcast(state);
    return sendJson(res, 200, getPublicState(state, getHostToken(req, url)));
  }

  return sendJson(res, 404, { error: "Not found." });
}

function handleEvents(req, res, url) {
  const partyId = getPartyId(url, req);
  const state = loadPartyState(partyId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`data: ${JSON.stringify(getPublicState(state, getHostToken(req, url)))}\n\n`);

  if (!clients.has(partyId)) clients.set(partyId, new Set());
  const client = { res, hostToken: getHostToken(req, url) };
  clients.get(partyId).add(client);

  req.on("close", () => {
    clients.get(partyId)?.delete(client);
  });
}

function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT, cleanPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function getPublicState(state, hostToken = "") {
  const totals = new Map(state.entries.map((entry) => [entry.id, 0]));
  for (const vote of state.appliedVotes) {
    totals.set(vote.entryId, (totals.get(vote.entryId) || 0) + vote.points);
  }

  const recentAwards = getRecentAwards(state);
  const scoreboard = state.entries
    .map((entry) => {
      const recentAward = recentAwards.get(entry.id);
      return {
        ...entry,
        total: totals.get(entry.id) || 0,
        lastPoints: recentAward?.points || null,
        pointTier: recentAward ? getPointTier(recentAward.points) : null
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const winnerReveal = getWinnerReveal(state, scoreboard);

  return {
    id: state.id,
    name: state.name,
    entries: state.entries,
    entriesFile: state.entriesFile,
    submissions: state.submissions.map(({ ballotTokenHash, ...submission }) => submission),
    appliedVotes: state.appliedVotes,
    currentReveal: state.currentReveal,
    winnerReveal,
    createdAt: state.createdAt,
    host: {
      mode: state.host?.mode || "open",
      hasPassword: Boolean(state.host?.password),
      isHost: isHostToken(state, hostToken)
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

  const winningTotal = scoreboard[0].total;
  if (winningTotal <= 0) return null;

  return {
    shownAt: state.winnerReveal.shownAt,
    total: winningTotal,
    entries: scoreboard.filter((entry) => entry.total === winningTotal)
  };
}

function getPointTier(points) {
  if ([8, 10, 12].includes(points)) return `special-${points}`;
  return "standard";
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

function claimHost(state, password) {
  const host = ensureHost(state);
  if (host.mode === "password" && !verifyPassword(password, host.password)) {
    return { status: 403, error: "That host password did not match." };
  }

  const hostToken = createToken();
  host.tokens = [...new Set([...(host.tokens || []), hashToken(hostToken)])];
  if (host.mode === "open") {
    host.mode = "device";
  }

  return { hostToken };
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
    client.res.write(`data: ${JSON.stringify(getPublicState(state, client.hostToken))}\n\n`);
  }
}

function loadPartyState(partyId) {
  const id = normalizePartyId(partyId);

  try {
    const savedState = JSON.parse(fs.readFileSync(getPartyFile(id), "utf8"));
    const state = {
      ...savedState,
      entries: Array.isArray(savedState.entries) && savedState.entries.length
        ? savedState.entries.map(normalizeEntry)
        : readEntriesFile()
    };
    state.id = id;
    state.host = state.host || { mode: "open", tokens: [], password: null };
    state.entriesFile = state.entriesFile ?? null;
    state.winnerReveal = state.winnerReveal || null;
    return state;
  } catch {
    const state = createInitialState(id, id === DEFAULT_PARTY_ID ? "Local Watch Party" : "Eurovision Party");
    savePartyState(state);
    return state;
  }
}

function savePartyState(state) {
  fs.mkdirSync(PARTY_DIR, { recursive: true });
  fs.writeFileSync(getPartyFile(state.id), JSON.stringify(state, null, 2));
}

function createInitialState(id = DEFAULT_PARTY_ID, name = "Eurovision Party") {
  return {
    id: normalizePartyId(id),
    name,
    entries: readEntriesFile(),
    entriesFile: path.relative(ROOT, ENTRIES_FILE),
    submissions: [],
    appliedVotes: [],
    currentReveal: null,
    winnerReveal: null,
    host: { mode: "open", tokens: [], password: null },
    createdAt: new Date().toISOString()
  };
}

function getPartyFile(partyId) {
  return path.join(PARTY_DIR, `${normalizePartyId(partyId)}.json`);
}

function getPartyId(url, req) {
  return normalizePartyId(url.searchParams.get("party") || req.headers["x-party-id"] || DEFAULT_PARTY_ID);
}

function getHostToken(req, url) {
  return String(url.searchParams.get("hostToken") || req.headers["x-host-token"] || "");
}

function createPartyId() {
  return randomBytes(4).toString("base64url").toLowerCase();
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
  return String(value || DEFAULT_PARTY_ID)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || DEFAULT_PARTY_ID;
}

function readEntriesFile() {
  return parseEntries(fs.readFileSync(ENTRIES_FILE, "utf8"));
}

function writeEntriesFile(entries) {
  fs.mkdirSync(path.dirname(ENTRIES_FILE), { recursive: true });
  fs.writeFileSync(ENTRIES_FILE, formatEntries(entries));
}

function parseEntries(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines[0]?.toLowerCase().startsWith("country\tartist\tsong")) {
    lines.shift();
  }

  const entries = lines.map((line) => {
    const [country = "", artist = "", song = ""] = line.split("\t").map((part) => part.trim());
    return normalizeEntry({ country, artist, song });
  }).filter((entry) => entry.country);

  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function formatEntries(entries) {
  const lines = ["Country\tArtist\tSong"];
  for (const entry of entries) {
    lines.push([entry.country, entry.artist, entry.song].map((value) => String(value || "").trim()).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function normalizeEntry(entry) {
  const country = String(entry.country || entry.name || "").trim();
  const artist = String(entry.artist || "").trim();
  const song = String(entry.song || "").trim();
  const flag = parseFlagPrefix(country);
  const countryName = flag.countryName || country;
  const name = [country, artist && `- ${artist}`, song && `- "${song}"`].filter(Boolean).join(" ");

  return {
    id: slug(country),
    country,
    countryName,
    flagCode: flag.flagCode,
    artist,
    song,
    name
  };
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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
