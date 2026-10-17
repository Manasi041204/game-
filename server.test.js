const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server");

async function withServer(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "friendship-garden-"));
  const server = createServer({ dataFile: path.join(directory, "garden.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, directory });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function request(baseUrl, route, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

test("creates and joins a private circle with an invite code", async () => {
  await withServer(async ({ baseUrl }) => {
    const created = await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "Avery" } });
    assert.equal(created.status, 201);
    assert.match(created.data.circle.code, /^[A-HJ-NP-Z2-9]{8}$/);
    const joined = await request(baseUrl, "/api/circles/join", {
      method: "POST", body: { code: created.data.circle.code.toLowerCase(), displayName: "Rory" }
    });
    assert.equal(joined.status, 201);
    assert.deepEqual(joined.data.circle.members.map((member) => member.name), ["Avery", "Rory"]);
    const privateRead = await request(baseUrl, `/api/circles/${created.data.circle.code}`);
    assert.equal(privateRead.status, 403);
  });
});

test("rejects invalid names, invite codes, message kinds, and oversized text", async () => {
  await withServer(async ({ baseUrl }) => {
    assert.equal((await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "  " } })).status, 400);
    assert.equal((await request(baseUrl, "/api/circles/join", { method: "POST", body: { code: "public", displayName: "Alex" } })).status, 400);
    const created = await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "Alex" } });
    const url = `/api/circles/${created.data.circle.code}/messages`;
    const base = { memberId: created.data.memberId };
    assert.equal((await request(baseUrl, url, { method: "POST", body: { ...base, kind: "unknown", text: "Hello" } })).status, 400);
    assert.equal((await request(baseUrl, url, { method: "POST", body: { ...base, kind: "tip", text: "x".repeat(501) } })).status, 400);
    assert.equal((await request(baseUrl, url, { method: "POST", body: { ...base, kind: "prompt", text: "Answer" } })).status, 400);
  });
});

test("saves and reloads garden progress, and allows own edit and removal", async () => {
  await withServer(async ({ baseUrl, directory }) => {
    const created = await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "Jo" } });
    const second = await request(baseUrl, "/api/circles/join", {
      method: "POST", body: { code: created.data.circle.code, displayName: "Dee" }
    });
    const circleUrl = `/api/circles/${created.data.circle.code}`;
    const posted = await request(baseUrl, `${circleUrl}/messages`, {
      method: "POST",
      body: { memberId: second.data.memberId, kind: "prompt", prompt: "A nice thing?", text: "A sunny walk." }
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.data.circle.flowers, 1);
    const reloaded = await request(baseUrl, `${circleUrl}?memberId=${created.data.memberId}`);
    assert.equal(reloaded.data.circle.flowers, 1);
    assert.equal(reloaded.data.circle.messages[0].text, "A sunny walk.");
    const messageId = posted.data.message.id;
    assert.equal((await request(baseUrl, `${circleUrl}/messages/${messageId}`, {
      method: "PATCH", body: { memberId: created.data.memberId, text: "Not my note." }
    })).status, 403);
    assert.equal((await request(baseUrl, `${circleUrl}/messages/${messageId}`, {
      method: "PATCH", body: { memberId: second.data.memberId, text: "A longer sunny walk." }
    })).status, 200);
    assert.equal((await request(baseUrl, `${circleUrl}/messages/${messageId}`, {
      method: "DELETE", body: { memberId: second.data.memberId }
    })).status, 200);
    const finalRead = await request(baseUrl, `${circleUrl}?memberId=${created.data.memberId}`);
    assert.equal(finalRead.data.circle.flowers, 1);
    assert.equal(finalRead.data.circle.messages.length, 0);
    const saved = JSON.parse(await fs.readFile(path.join(directory, "garden.json"), "utf8"));
    assert.equal(saved.circles[0].flowers, 1);
  });
});

test("preserves progress when several circle members share at once", async () => {
  await withServer(async ({ baseUrl }) => {
    const owner = await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "Owner" } });
    const url = `/api/circles/${owner.data.circle.code}`;
    const members = [owner.data.memberId];
    for (const name of ["Rae", "Kai"]) {
      const joined = await request(baseUrl, "/api/circles/join", {
        method: "POST", body: { code: owner.data.circle.code, displayName: name }
      });
      members.push(joined.data.memberId);
    }
    const responses = await Promise.all(members.map((memberId, index) => request(baseUrl, `${url}/messages`, {
      method: "POST",
      body: { memberId, kind: "tip", text: `A friendly tip ${index + 1}.` }
    })));
    assert.deepEqual(responses.map((response) => response.status), [201, 201, 201]);
    const reloaded = await request(baseUrl, `${url}?memberId=${owner.data.memberId}`);
    assert.equal(reloaded.data.circle.flowers, 3);
    assert.equal(reloaded.data.circle.messages.length, 3);
  });
});

test("reports a message and restricts member moderation to the creator", async () => {
  await withServer(async ({ baseUrl }) => {
    const owner = await request(baseUrl, "/api/circles", { method: "POST", body: { displayName: "Owner" } });
    const guest = await request(baseUrl, "/api/circles/join", {
      method: "POST", body: { code: owner.data.circle.code, displayName: "Guest" }
    });
    const url = `/api/circles/${owner.data.circle.code}`;
    const posted = await request(baseUrl, `${url}/messages`, {
      method: "POST", body: { memberId: owner.data.memberId, kind: "memory", text: "A safe little memory." }
    });
    const kindNote = await request(baseUrl, `${url}/messages`, {
      method: "POST",
      body: {
        memberId: owner.data.memberId,
        kind: "kindness",
        text: "I’m glad we’re friends.",
        recipientId: guest.data.memberId
      }
    });
    assert.equal(kindNote.status, 201);
    assert.equal(kindNote.data.message.recipient, "Guest");
    const report = await request(baseUrl, `${url}/reports`, {
      method: "POST",
      body: { memberId: guest.data.memberId, messageId: posted.data.message.id, reason: "Please check in about this note." }
    });
    assert.equal(report.status, 201);
    assert.equal((await request(baseUrl, `${url}/members/${guest.data.memberId}`, {
      method: "DELETE", body: { memberId: guest.data.memberId }
    })).status, 200);
  });
});
