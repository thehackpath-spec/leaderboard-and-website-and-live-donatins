var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(json, "json");
function secureEqual(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
__name(secureEqual, "secureEqual");
function validGameRequest(request, env) {
  const secret = env.SECRET;
  if (!secret) {
    return null;
  }
  const authorization = request.headers.get("Authorization") || "";
  const expected = "Bearer " + secret;
  return secureEqual(authorization, expected);
}
__name(validGameRequest, "validGameRequest");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const publicRoutes = request.method === "GET" && (url.pathname === "/api/state" || url.pathname === "/api/stream");
    const gameRoutes = request.method === "POST" && (url.pathname === "/api/leaderboards" || url.pathname === "/api/donations");
    if (!publicRoutes && !gameRoutes) {
      return json({ error: "Not found" }, 404);
    }
    if (url.pathname === "/api/stream" && request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }
    if (gameRoutes) {
      const authorized = validGameRequest(request, env);
      if (authorized === null) {
        return json({ error: "Worker secret is not configured" }, 503);
      }
      if (!authorized) {
        return json({ error: "Unauthorized" }, 401);
      }
    }
    const id = env.DONATION_HUB.idFromName("summer-donations");
    const hub = env.DONATION_HUB.get(id);
    return hub.fetch(request);
  }
};
var DonationHub = class {
  static {
    __name(this, "DonationHub");
  }
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/state") {
      const boards = await this.ctx.storage.get("leaderboards") || {
        donated: [],
        raised: [],
        updatedAt: null
      };
      return json({ boards });
    }
    if (request.method === "GET" && url.pathname === "/api/stream") {
      return this.openStream();
    }
    if (request.method === "POST" && url.pathname === "/api/leaderboards") {
      return this.updateLeaderboards(request);
    }
    if (request.method === "POST" && url.pathname === "/api/donations") {
      return this.publishDonation(request);
    }
    return json({ error: "Not found" }, 404);
  }
  async openStream() {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const boards = await this.ctx.storage.get("leaderboards") || {
      donated: [],
      raised: [],
      updatedAt: null
    };
    server.send(JSON.stringify({ type: "initial", boards }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: corsHeaders
    });
  }
  async updateLeaderboards(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const donatedSource = payload?.donated ?? payload?.Donated;
    const raisedSource = payload?.raised ?? payload?.Raised;
    if (!Array.isArray(donatedSource) || !Array.isArray(raisedSource)) {
      return json({ error: "Expected donated and raised arrays" }, 400);
    }
    if (donatedSource.length > 100 || raisedSource.length > 100) {
      return json({ error: "Leaderboard limit is 100 entries" }, 400);
    }
    const donated = donatedSource.map(normalizeLeaderboardEntry);
    const raised = raisedSource.map(normalizeLeaderboardEntry);
    if (donated.includes(null) || raised.includes(null)) {
      return json({ error: "Leaderboard entries contain invalid data" }, 400);
    }
    const boards = {
      donated,
      raised,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.ctx.storage.put("leaderboards", boards);
    this.broadcast({ type: "leaderboards", boards });
    return json({ ok: true, updatedAt: boards.updatedAt });
  }
  async publishDonation(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const donation = normalizeDonation(payload);
    if (!donation) {
      return json({ error: "Donation contains invalid data" }, 400);
    }
    this.broadcast({
      type: "donation",
      donation: {
        ...donation,
        receivedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    return json({ ok: true });
  }
  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(encoded);
      } catch {
        socket.close(1011, "Unable to deliver update");
      }
    }
  }
  webSocketMessage(socket) {
    socket.close(1008, "Client messages are not accepted");
  }
};
function normalizeLeaderboardEntry(entry, index) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const userId = Number(entry.userId ?? entry.Id ?? entry.id);
  const username = entry.username ?? entry.Username ?? entry.name;
  const value = Number(entry.value ?? entry.Value ?? entry.amount);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }
  if (typeof username !== "string" || username.length === 0 || username.length > 40) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return {
    rank: index + 1,
    userId,
    username,
    value
  };
}
__name(normalizeLeaderboardEntry, "normalizeLeaderboardEntry");
function normalizeDonation(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const donorUserId = Number(payload.donorUserId ?? payload.donor?.userId);
  const recipientUserId = Number(payload.recipientUserId ?? payload.recipient?.userId);
  const donorUsername = payload.donorUsername ?? payload.donor?.username;
  const recipientUsername = payload.recipientUsername ?? payload.recipient?.username;
  const amount = Number(payload.amount);
  const durationSeconds = Number(payload.durationSeconds);
  if (!Number.isSafeInteger(donorUserId) || donorUserId <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(recipientUserId) || recipientUserId <= 0) {
    return null;
  }
  if (typeof donorUsername !== "string" || donorUsername.length === 0 || donorUsername.length > 40) {
    return null;
  }
  if (typeof recipientUsername !== "string" || recipientUsername.length === 0 || recipientUsername.length > 40) {
    return null;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) {
    return null;
  }
  return {
    donor: {
      userId: donorUserId,
      username: donorUsername
    },
    recipient: {
      userId: recipientUserId,
      username: recipientUsername
    },
    amount,
    durationSeconds
  };
}
__name(normalizeDonation, "normalizeDonation");
export {
  DonationHub,
  index_default as default
};
//# sourceMappingURL=index.js.map
