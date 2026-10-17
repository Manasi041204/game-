const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DEFAULT_DATA_FILE = path.join(ROOT, "data", "friendship-garden.json");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MESSAGE_KINDS = new Set(["prompt", "tip", "memory", "kindness"]);
const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanString(value, field, maxLength, { optional = false } = {}) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  const cleaned = value.trim();
  if (!cleaned && !optional) throw new HttpError(400, `${field} is required.`);
  if (cleaned.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return cleaned;
}

function makeId() {
  return crypto.randomUUID();
}

function makeCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      throw new HttpError(413, "This request is too large.");
    }
  }
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("Expected a JSON object.");
    }
    return value;
  } catch {
    throw new HttpError(400, "Please send valid JSON.");
  }
}

function createStore(filePath) {
  let pendingWrite = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!parsed || !Array.isArray(parsed.circles) || !Array.isArray(parsed.reports)) {
        throw new Error("The saved garden data has an unexpected format.");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { circles: [], reports: [] };
      throw error;
    }
  }

  async function save(state) {
    pendingWrite = pendingWrite.catch((error) => {
      console.error("A previous garden save failed:", error);
    }).then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.${makeId()}.tmp`;
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
        await fs.rename(temporaryPath, filePath);
      } finally {
        await fs.rm(temporaryPath, { force: true });
      }
    });
    return pendingWrite;
  }

  return { load, save };
}

function requireMember(circle, memberId) {
  const member = circle.members.find((candidate) => candidate.id === memberId);
  if (!member) throw new HttpError(403, "You need to join this circle to do that.");
  return member;
}

function requireModerator(circle, member) {
  if (circle.creatorId !== member.id) {
    throw new HttpError(403, "Only the circle's creator can manage other members or messages.");
  }
}

function getCircle(state, code) {
  const circle = state.circles.find((candidate) => candidate.code === code.toUpperCase());
  if (!circle) throw new HttpError(404, "We couldn't find that circle. Check the invite code.");
  return circle;
}

function publicCircle(circle) {
  return {
    code: circle.code,
    creatorId: circle.creatorId,
    flowers: circle.flowers,
    members: circle.members.map(({ id, name }) => ({ id, name })),
    messages: circle.messages.slice(-40).reverse(),
  };
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(data));
}

function staticFile(pathname, response) {
  const knownFiles = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  };
  const entry = knownFiles[pathname];
  if (!entry) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(path.join(ROOT, entry[0])).then((contents) => {
    response.writeHead(200, {
      "Content-Type": entry[1],
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    response.end(contents);
  }).catch((error) => {
    console.error("Unable to serve static file:", error);
    response.writeHead(500);
    response.end("Unable to load the page.");
  });
}

function createServer({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = createStore(dataFile);
  let apiQueue = Promise.resolve();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      staticFile(url.pathname, response);
      return;
    }

    const previousRequest = apiQueue;
    let releaseRequest;
    apiQueue = new Promise((resolve) => { releaseRequest = resolve; });
    await previousRequest;

    try {
      const state = await store.load();
      const body = ["POST", "PATCH", "DELETE"].includes(request.method)
        ? await readBody(request)
        : {};
      let match;

      if (request.method === "POST" && url.pathname === "/api/circles") {
        const name = cleanString(body.displayName, "Display name", 32);
        let code = makeCode();
        while (state.circles.some((circle) => circle.code === code)) code = makeCode();
        const member = { id: makeId(), name };
        const circle = {
          code,
          creatorId: member.id,
          flowers: 0,
          members: [member],
          messages: [],
        };
        state.circles.push(circle);
        await store.save(state);
        json(response, 201, { circle: publicCircle(circle), memberId: member.id });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/circles/join") {
        const code = cleanString(body.code, "Invite code", 8).toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
          throw new HttpError(400, "Invite codes are 8 letters or numbers.");
        }
        const circle = getCircle(state, code);
        if (circle.members.length >= 20) throw new HttpError(400, "This circle has reached its 20-member limit.");
        const name = cleanString(body.displayName, "Display name", 32);
        const member = { id: makeId(), name };
        circle.members.push(member);
        await store.save(state);
        json(response, 201, { circle: publicCircle(circle), memberId: member.id });
        return;
      }

      if ((match = url.pathname.match(/^\/api\/circles\/([A-HJ-NP-Z2-9]+)$/)) && request.method === "GET") {
        const circle = getCircle(state, match[1]);
        requireMember(circle, url.searchParams.get("memberId"));
        json(response, 200, { circle: publicCircle(circle) });
        return;
      }

      if ((match = url.pathname.match(/^\/api\/circles\/([A-HJ-NP-Z2-9]+)\/messages$/)) && request.method === "POST") {
        const circle = getCircle(state, match[1]);
        const member = requireMember(circle, body.memberId);
        const kind = cleanString(body.kind, "Activity type", 16);
        if (!MESSAGE_KINDS.has(kind)) throw new HttpError(400, "Choose one of the available activity types.");
        const text = cleanString(body.text, "Message", 500);
        let recipientId = "";
        if (kind === "kindness") {
          recipientId = cleanString(body.recipientId, "Recipient", 36);
          if (!circle.members.some((person) => person.id === recipientId)) {
            throw new HttpError(400, "Choose someone in your circle.");
          }
          if (recipientId === member.id) throw new HttpError(400, "Choose another circle member for this note.");
        }
        const prompt = kind === "prompt" ? cleanString(body.prompt, "Prompt", 180) : "";
        const message = {
          id: makeId(),
          memberId: member.id,
          author: member.name,
          kind,
          text,
          prompt,
          recipientId,
          recipient: circle.members.find((person) => person.id === recipientId)?.name || "",
          createdAt: new Date().toISOString(),
        };
        circle.messages.push(message);
        circle.flowers += 1;
        await store.save(state);
        json(response, 201, { message, circle: publicCircle(circle) });
        return;
      }

      if ((match = url.pathname.match(/^\/api\/circles\/([A-HJ-NP-Z2-9]+)\/messages\/([0-9a-f-]+)$/i))) {
        const circle = getCircle(state, match[1]);
        const member = requireMember(circle, body.memberId);
        const message = circle.messages.find((candidate) => candidate.id === match[2]);
        if (!message) throw new HttpError(404, "That message is no longer here.");

        if (request.method === "PATCH") {
          if (message.memberId !== member.id) throw new HttpError(403, "You can edit only your own message.");
          message.text = cleanString(body.text, "Message", 500);
          await store.save(state);
          json(response, 200, { circle: publicCircle(circle) });
          return;
        }
        if (request.method === "DELETE") {
          if (message.memberId !== member.id) requireModerator(circle, member);
          circle.messages = circle.messages.filter((candidate) => candidate.id !== message.id);
          await store.save(state);
          json(response, 200, { circle: publicCircle(circle) });
          return;
        }
      }

      if ((match = url.pathname.match(/^\/api\/circles\/([A-HJ-NP-Z2-9]+)\/members\/([0-9a-f-]+)$/i)) && request.method === "DELETE") {
        const circle = getCircle(state, match[1]);
        const member = requireMember(circle, body.memberId);
        const targetId = match[2];
        if (targetId !== member.id) requireModerator(circle, member);
        if (targetId === circle.creatorId && targetId !== member.id) {
          throw new HttpError(400, "The circle creator cannot be removed by another member.");
        }
        if (!circle.members.some((person) => person.id === targetId)) {
          throw new HttpError(404, "That member is no longer in the circle.");
        }
        circle.members = circle.members.filter((person) => person.id !== targetId);
        circle.messages = circle.messages.filter((message) => message.memberId !== targetId);
        if (targetId === circle.creatorId) circle.creatorId = circle.members[0]?.id || "";
        if (circle.members.length === 0) {
          state.circles = state.circles.filter((candidate) => candidate.code !== circle.code);
        }
        await store.save(state);
        json(response, 200, { circle: circle.members.length ? publicCircle(circle) : null });
        return;
      }

      if ((match = url.pathname.match(/^\/api\/circles\/([A-HJ-NP-Z2-9]+)\/reports$/)) && request.method === "POST") {
        const circle = getCircle(state, match[1]);
        const member = requireMember(circle, body.memberId);
        const messageId = cleanString(body.messageId, "Message", 36);
        if (!circle.messages.some((message) => message.id === messageId)) {
          throw new HttpError(404, "That message is no longer here.");
        }
        const reason = cleanString(body.reason, "Concern", 300);
        state.reports.push({
          id: makeId(),
          circleCode: circle.code,
          messageId,
          reporterId: member.id,
          reason,
          createdAt: new Date().toISOString(),
        });
        await store.save(state);
        json(response, 201, { reported: true });
        return;
      }

      throw new HttpError(404, "That page or activity is not available.");
    } catch (error) {
      if (error instanceof HttpError) {
        json(response, error.status, { error: error.message });
        return;
      }
      console.error("Friendship Garden request failed:", error);
      json(response, 500, { error: "Something went wrong while saving. Please try again." });
    } finally {
      releaseRequest();
    }
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 3000);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Friendship Garden is available at http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
