(() => {
  "use strict";

  const prompts = [
    "What is a small thing that made you smile this week?",
    "What is a place that helps you feel at ease?",
    "What is something you enjoy doing at your own pace?"
  ];
  const kindLabels = {
    prompt: "A gentle prompt",
    tip: "A practical tip",
    memory: "A favorite memory",
    kindness: "A kind note"
  };
  const kindMessages = [
    "I’m glad we’re friends.",
    "Thinking of you and wishing you a peaceful day.",
    "Thank you for being part of our circle.",
    "I appreciate the way you show up for others."
  ];
  const sessionKey = "friendship-garden-session";
  const sizeKey = "friendship-garden-text-size";
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    welcome: $("#welcome-screen"),
    garden: $("#garden-screen"),
    welcomeError: $("#welcome-error"),
    gardenTitle: $("#garden-title"),
    subtitle: $("#garden-subtitle"),
    growth: $("#growth-copy"),
    gardenArt: $("#garden-art"),
    members: $("#member-list"),
    feed: $("#activity-feed"),
    dialog: $("#activity-dialog"),
    reportDialog: $("#report-dialog"),
    live: $("#live-message"),
    toast: $("#toast")
  };
  let session = null;
  let circle = null;
  let editingId = null;
  let editingKind = null;
  let activePrompt = "";
  let reportingId = null;
  let toastTimer = null;

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "That didn’t work. Please try again.");
    return data;
  }

  function setError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 4500);
    elements.live.textContent = message;
  }

  function saveSession() {
    if (session?.demo) return;
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  }

  function showGarden(nextCircle) {
    circle = nextCircle;
    elements.welcome.hidden = true;
    elements.garden.hidden = false;
    elements.gardenTitle.textContent = session.demo ? "A Demo Friendship Garden" : "Our Friendship Garden";
    elements.subtitle.textContent = `${circle.members.length} ${circle.members.length === 1 ? "member" : "members"} in your private circle`;
    elements.growth.textContent = circle.flowers === 0
      ? "Your garden is ready for its first flower."
      : `${circle.flowers} ${circle.flowers === 1 ? "flower has" : "flowers have"} grown through shared activities.`;
    renderGarden();
    $("#invite-code").hidden = true;
    $("#invite-button").textContent = "Show invite code";
    $("#invite-button").hidden = Boolean(session.demo);
  }

  function renderGarden() {
    const flowers = Math.min(circle.flowers, 36);
    elements.gardenArt.setAttribute("aria-label",
      `${flowers} ${flowers === 1 ? "flower" : "flowers"} in the shared garden${circle.flowers > flowers ? `, with ${circle.flowers - flowers} more represented in the total` : ""}.`);
    elements.gardenArt.replaceChildren();
    if (flowers === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-garden";
      empty.textContent = "A quiet place, ready to grow when your circle feels like sharing.";
      elements.gardenArt.append(empty);
    } else {
      const flowerSymbols = ["✿", "❀", "✽", "✾"];
      for (let index = 0; index < flowers; index += 1) {
        const flower = document.createElement("span");
        flower.className = "flower";
        flower.setAttribute("aria-hidden", "true");
        flower.textContent = flowerSymbols[index % flowerSymbols.length];
        elements.gardenArt.append(flower);
      }
    }

    const currentMember = session.memberId;
    const isCreator = circle.creatorId === currentMember;
    elements.members.replaceChildren();
    for (const member of circle.members) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = member.name;
      if (member.id === circle.creatorId) {
        const creator = document.createElement("span");
        creator.className = "creator-label";
        creator.textContent = " · circle creator";
        name.append(creator);
      }
      item.append(name);
      if (isCreator && member.id !== currentMember && !session.demo) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "member-remove";
        remove.textContent = `Remove ${member.name}`;
        remove.setAttribute("aria-label", `Remove ${member.name} from the circle`);
        remove.addEventListener("click", () => removeMember(member));
        item.append(remove);
      }
      elements.members.append(item);
    }

    elements.feed.replaceChildren();
    if (circle.messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-feed";
      empty.textContent = "When someone shares a note, it will appear here. There is no rush.";
      elements.feed.append(empty);
      return;
    }
    for (const message of circle.messages) {
      const card = document.createElement("article");
      card.className = "feed-item";
      const meta = document.createElement("div");
      meta.className = "feed-meta";
      const author = document.createElement("strong");
      author.textContent = message.author;
      const date = document.createElement("time");
      date.dateTime = message.createdAt;
      date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(message.createdAt));
      meta.append(author, date);
      const kind = document.createElement("span");
      kind.className = "feed-kind";
      kind.textContent = message.kind === "kindness" && message.recipient
        ? `${kindLabels[message.kind]} for ${message.recipient}`
        : kindLabels[message.kind] || "A shared note";
      card.append(meta, kind);
      if (message.prompt) {
        const prompt = document.createElement("p");
        prompt.className = "feed-prompt";
        prompt.textContent = message.prompt;
        card.append(prompt);
      }
      const text = document.createElement("p");
      text.className = "feed-message";
      text.textContent = message.text;
      card.append(text);

      const isOwn = message.memberId === currentMember;
      const actions = document.createElement("div");
      actions.className = "feed-actions";
      if (isOwn && !session.demo) {
        actions.append(actionButton("Edit your note", () => openEdit(message)));
        actions.append(actionButton("Remove your note", () => removeMessage(message)));
      } else if (!session.demo) {
        actions.append(actionButton("Report a concern", () => openReport(message)));
        if (isCreator) actions.append(actionButton("Remove note", () => removeMessage(message, true)));
      }
      if (actions.childElementCount) card.append(actions);
      elements.feed.append(card);
    }
  }

  function actionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  async function refresh() {
    if (session.demo) return;
    const data = await api(`/api/circles/${encodeURIComponent(session.code)}?memberId=${encodeURIComponent(session.memberId)}`);
    showGarden(data.circle);
  }

  async function enterCircle(result, code) {
    session = { code, memberId: result.memberId, demo: false };
    saveSession();
    showGarden(result.circle);
  }

  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(elements.welcomeError, "");
    const displayName = $("#create-name").value.trim();
    try {
      const result = await api("/api/circles", { method: "POST", body: JSON.stringify({ displayName }) });
      await enterCircle(result, result.circle.code);
      showToast("Your private circle is ready. Invite friends when you like.");
    } catch (error) { setError(elements.welcomeError, error.message); }
  });

  $("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(elements.welcomeError, "");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/circles/join", {
        method: "POST",
        body: JSON.stringify({ code: form.get("code").trim(), displayName: form.get("displayName").trim() })
      });
      await enterCircle(result, result.circle.code);
      showToast("Welcome to your circle.");
    } catch (error) { setError(elements.welcomeError, error.message); }
  });

  $("#demo-button").addEventListener("click", () => {
    session = { code: "DEMO", memberId: "demo-you", demo: true };
    circle = {
      creatorId: "demo-you",
      flowers: 5,
      members: [{ id: "demo-you", name: "You" }, { id: "demo-sam", name: "Sam" }, { id: "demo-lee", name: "Lee" }],
      messages: [
        { id: "demo-1", memberId: "demo-sam", author: "Sam", kind: "prompt", prompt: prompts[0], text: "The sun came out while I was having tea in the garden.", createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
        { id: "demo-2", memberId: "demo-lee", author: "Lee", kind: "kindness", recipient: "Sam", text: "I’m glad we’re friends.", createdAt: new Date(Date.now() - 86400000).toISOString() }
      ]
    };
    showGarden(circle);
  });

  document.querySelectorAll("[data-activity]").forEach((button) => {
    button.addEventListener("click", () => openActivity(button.dataset.activity));
  });

  function openActivity(kind) {
    editingId = null;
    editingKind = kind;
    activePrompt = kind === "prompt" ? prompts[Math.floor(Math.random() * prompts.length)] : "";
    $("#dialog-title").textContent = kind === "prompt" ? "A gentle conversation prompt" : kindLabels[kind];
    $("#dialog-eyebrow").textContent = kind === "kindness" ? "Choose a message" : "Share only what feels comfortable";
    $("#prompt-text").textContent = activePrompt;
    $("#prompt-text").hidden = !activePrompt;
    $("#activity-text").hidden = kind === "kindness";
    $("#activity-text-label").hidden = kind === "kindness";
    $("#character-count").hidden = kind === "kindness";
    $("#kind-message-label").hidden = kind !== "kindness";
    $("#kindness-message").hidden = kind !== "kindness";
    $("#kindness-message").replaceChildren();
    const emptyChoice = document.createElement("option");
    emptyChoice.value = "";
    emptyChoice.textContent = "Choose a kind message";
    $("#kindness-message").append(emptyChoice);
    for (const message of kindMessages) {
      const option = document.createElement("option");
      option.value = message;
      option.textContent = message;
      $("#kindness-message").append(option);
    }
    $("#kindness-message").value = "";
    $("#activity-text").value = "";
    $("#activity-text").placeholder = kind === "tip"
      ? "A small practical idea that may help a friend."
      : kind === "memory" ? "Share a memory you feel comfortable telling."
        : "Write only what you feel comfortable sharing.";
    $("#recipient-label").hidden = kind !== "kindness";
    $("#recipient-select").hidden = kind !== "kindness";
    populateRecipients();
    $("#message-preview").hidden = true;
    $("#post-button").disabled = true;
    $("#post-button").textContent = "Share with the circle";
    $("#skip-button").hidden = false;
    setError($("#dialog-error"), "");
    elements.dialog.showModal();
    if (kind === "kindness") $("#recipient-select").focus();
    else $("#activity-text").focus();
  }

  function populateRecipients(selected = "") {
    const select = $("#recipient-select");
    select.replaceChildren();
    for (const member of circle.members.filter((person) => person.id !== session.memberId)) {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = member.name;
      select.append(option);
    }
    if (selected) select.value = selected;
    if (select.options.length === 0) {
      const option = document.createElement("option");
      option.textContent = "Invite a friend to send a note";
      option.value = "";
      select.append(option);
    }
  }

  function currentDraft() {
    return editingKind === "kindness" && !editingId
      ? $("#kindness-message").value
      : $("#activity-text").value.trim();
  }

  function refreshPostState() {
    const text = currentDraft();
    const hasRecipient = editingKind !== "kindness" || Boolean(editingId) || Boolean($("#recipient-select").value);
    $("#post-button").disabled = !text || !hasRecipient;
    if (editingKind !== "kindness" || editingId) $("#character-count").textContent = `${$("#activity-text").value.length} of 500 characters`;
    $("#message-preview").hidden = true;
  }

  $("#activity-text").addEventListener("input", refreshPostState);
  $("#kindness-message").addEventListener("change", refreshPostState);
  $("#recipient-select").addEventListener("change", refreshPostState);
  $("#preview-button").addEventListener("click", () => {
    const text = currentDraft();
    const hasRecipient = editingKind !== "kindness" || Boolean($("#recipient-select").value);
    if (!text || !hasRecipient) {
      setError($("#dialog-error"), "Add a note first, or skip this activity.");
      return;
    }
    setError($("#dialog-error"), "");
    $("#preview-content").textContent = text;
    $("#message-preview").hidden = false;
    $("#post-button").disabled = false;
    $("#post-button").focus();
  });

  $("#post-button").addEventListener("click", async () => {
    const text = currentDraft();
    if (!text) return;
    if (session.demo) {
      showToast("Demo mode doesn’t save changes. Create or join a circle to share.");
      elements.dialog.close();
      return;
    }
    $("#post-button").disabled = true;
    try {
      if (editingId) {
        await api(`/api/circles/${encodeURIComponent(session.code)}/messages/${encodeURIComponent(editingId)}`, {
          method: "PATCH", body: JSON.stringify({ memberId: session.memberId, text })
        });
        showToast("Your note has been updated.");
      } else {
        const payload = {
          memberId: session.memberId,
          kind: editingKind,
          text,
          ...(editingKind === "prompt" ? { prompt: activePrompt } : {}),
          ...(editingKind === "kindness" ? { recipientId: $("#recipient-select").value } : {})
        };
        await api(`/api/circles/${encodeURIComponent(session.code)}/messages`, {
          method: "POST", body: JSON.stringify(payload)
        });
        showToast("Your note has been shared. A new flower has grown.");
      }
      elements.dialog.close();
      await refresh();
    } catch (error) {
      setError($("#dialog-error"), error.message);
      $("#post-button").disabled = false;
    }
  });

  $("#skip-button").addEventListener("click", () => elements.dialog.close());
  $("#dialog-close").addEventListener("click", () => elements.dialog.close());

  function openEdit(message) {
    editingId = message.id;
    editingKind = message.kind;
    activePrompt = message.prompt || "";
    $("#dialog-title").textContent = "Edit your note";
    $("#dialog-eyebrow").textContent = "Only you can edit this note";
    $("#prompt-text").textContent = activePrompt;
    $("#prompt-text").hidden = !activePrompt;
    $("#activity-text").hidden = false;
    $("#activity-text-label").hidden = false;
    $("#character-count").hidden = false;
    $("#activity-text").value = message.text;
    $("#recipient-label").hidden = true;
    $("#recipient-select").hidden = true;
    $("#kind-message-label").hidden = true;
    $("#kindness-message").hidden = true;
    $("#message-preview").hidden = true;
    $("#skip-button").hidden = true;
    $("#post-button").textContent = "Save changes";
    $("#post-button").disabled = false;
    setError($("#dialog-error"), "");
    elements.dialog.showModal();
    $("#activity-text").focus();
  }

  async function removeMessage(message, moderator = false) {
    const label = moderator ? "Remove this message from the circle?" : "Remove your note from the feed?";
    if (!window.confirm(label)) return;
    try {
      await api(`/api/circles/${encodeURIComponent(session.code)}/messages/${encodeURIComponent(message.id)}`, {
        method: "DELETE", body: JSON.stringify({ memberId: session.memberId })
      });
      await refresh();
      showToast("The note was removed from the activity feed.");
    } catch (error) { showToast(error.message); }
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name} and their notes from this circle?`)) return;
    try {
      await api(`/api/circles/${encodeURIComponent(session.code)}/members/${encodeURIComponent(member.id)}`, {
        method: "DELETE", body: JSON.stringify({ memberId: session.memberId })
      });
      await refresh();
      showToast(`${member.name} was removed from the circle.`);
    } catch (error) { showToast(error.message); }
  }

  function openReport(message) {
    reportingId = message.id;
    $("#report-reason").value = "";
    setError($("#report-error"), "");
    elements.reportDialog.showModal();
    $("#report-reason").focus();
  }

  $("#report-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (session.demo) return;
    const reason = $("#report-reason").value.trim();
    if (!reason) {
      setError($("#report-error"), "Please add a short note about your concern.");
      return;
    }
    $("#report-submit").disabled = true;
    try {
      await api(`/api/circles/${encodeURIComponent(session.code)}/reports`, {
        method: "POST",
        body: JSON.stringify({ memberId: session.memberId, messageId: reportingId, reason })
      });
      elements.reportDialog.close();
      showToast("Your concern has been recorded for the circle.");
    } catch (error) {
      setError($("#report-error"), error.message);
    } finally { $("#report-submit").disabled = false; }
  });

  $("#report-close").addEventListener("click", () => elements.reportDialog.close());
  $("#report-cancel").addEventListener("click", () => elements.reportDialog.close());
  $("#invite-button").addEventListener("click", () => {
    const code = $("#invite-code");
    code.textContent = session.code;
    code.hidden = false;
    $("#invite-button").textContent = "Invite code shown";
  });

  $("#leave-button").addEventListener("click", async () => {
    if (session.demo) {
      leaveGarden();
      return;
    }
    if (!window.confirm("Leave this circle? Your messages will also be removed.")) return;
    try {
      await api(`/api/circles/${encodeURIComponent(session.code)}/members/${encodeURIComponent(session.memberId)}`, {
        method: "DELETE", body: JSON.stringify({ memberId: session.memberId })
      });
      leaveGarden();
    } catch (error) { showToast(error.message); }
  });

  function leaveGarden() {
    session = null;
    circle = null;
    saveSession();
    elements.garden.hidden = true;
    elements.welcome.hidden = false;
  }

  $("#text-larger").addEventListener("click", () => changeTextSize(1));
  $("#text-smaller").addEventListener("click", () => changeTextSize(-1));
  function changeTextSize(delta) {
    const current = Number(localStorage.getItem(sizeKey) || 18);
    const next = Math.max(16, Math.min(23, current + delta));
    document.documentElement.style.fontSize = `${next}px`;
    localStorage.setItem(sizeKey, String(next));
  }
  const savedSize = Number(localStorage.getItem(sizeKey));
  if (savedSize >= 16 && savedSize <= 23) document.documentElement.style.fontSize = `${savedSize}px`;

  try {
    const saved = JSON.parse(localStorage.getItem(sessionKey) || "null");
    if (saved?.code && saved?.memberId) {
      session = { code: saved.code, memberId: saved.memberId, demo: false };
      refresh().catch((error) => {
        session = null;
        localStorage.removeItem(sessionKey);
        setError(elements.welcomeError, `${error.message} Please join your circle again with its invite code.`);
      });
    }
  } catch (error) {
    console.error("Unable to restore the saved circle session:", error);
    localStorage.removeItem(sessionKey);
  }
})();
