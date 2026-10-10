const FORM_PREFIX = "formscript:form:";
const SETTINGS_KEY = "formscript:settings";
const PENDING_PREFIX = "pending:";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const FILL_CONTEXT_MENU_ID = "formscript-fill-form";

function consentIdFor(formKey) {
  let hash = 2166136261;
  for (let index = 0; index < formKey.length; index += 1) {
    hash ^= formKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `formscript-${(hash >>> 0).toString(16)}`;
}

// Accept page messages only when their sender matches the claimed HTTP(S) origin.
function isFormMessageFromPage(message, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url) return false;

  try {
    const origin = new URL(sender.url).origin;
    return origin === message.origin && /^https?:$/.test(new URL(sender.url).protocol);
  } catch {
    return false;
  }
}

// Limit field count and value size before keeping submitted data in extension storage.
function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return [];

  return fields.slice(0, 150).flatMap((field) => {
    if (
      !field ||
      typeof field.name !== "string" ||
      typeof field.type !== "string" ||
      !Number.isInteger(field.index) ||
      field.name.length > 200 ||
      field.type.length > 30
    ) {
      return [];
    }

    const sanitized = {
      name: field.name,
      type: field.type,
      index: field.index
    };

    if (field.type === "checkbox" || field.type === "radio") {
      sanitized.value = typeof field.value === "string" ? field.value.slice(0, 5000) : "";
      sanitized.checked = Boolean(field.checked);
    } else if (typeof field.value === "string") {
      sanitized.value = field.value.slice(0, 5000);
    } else {
      return [];
    }

    return [sanitized];
  });
}

async function openConsentWindow(consentId, origin, fieldCount, isUpdate) {
  const width = 280;
  const height = 60;
  const focusedWindow = await new Promise((resolve) => {
    chrome.windows.getLastFocused({}, resolve);
  });
  const optionsUrl = new URL(chrome.runtime.getURL("src/consent/consent.html"));
  optionsUrl.searchParams.set("id", consentId);
  optionsUrl.searchParams.set("site", new URL(origin).hostname);
  optionsUrl.searchParams.set("count", String(fieldCount));
  optionsUrl.searchParams.set("mode", isUpdate ? "update" : "save");

  const createOptions = {
    url: optionsUrl.href,
    type: "popup",
    width,
    height,
    focused: true
  };

  if (focusedWindow && Number.isFinite(focusedWindow.left) && Number.isFinite(focusedWindow.top)) {
    createOptions.left = Math.round(Math.max(focusedWindow.left, focusedWindow.left + focusedWindow.width - width - 16));
    createOptions.top = Math.round(Math.max(focusedWindow.top, focusedWindow.top + focusedWindow.height - height - 16));
  }

  return new Promise((resolve, reject) => {
    chrome.windows.create(createOptions, (createdWindow) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(createdWindow);
    });
  });
}

function setTabBadge(tabId, hasSavedForm) {
  if (!Number.isInteger(tabId)) return;

  chrome.action.setBadgeBackgroundColor({ color: "#176b56", tabId });
  chrome.action.setBadgeText({ text: hasSavedForm ? "1" : "", tabId });
  chrome.action.setTitle({
    tabId,
    title: hasSavedForm ? "FormScript: a saved form is available for this site" : "FormScript"
  });
}

async function handleSavedFormCheck(message, sender) {
  if (!isFormMessageFromPage(message, sender) || !Array.isArray(message.formKeys)) {
    return { ok: false, reason: "invalid-sender" };
  }

  const originPrefix = `${FORM_PREFIX}${message.origin}:`;
  const formKeys = [...new Set(message.formKeys)]
    .filter((key) => typeof key === "string" && key.startsWith(originPrefix))
    .slice(0, 100);
  const stored = formKeys.length > 0 ? await chrome.storage.local.get(formKeys) : {};
  const hasSavedForm = formKeys.some((key) => Boolean(stored[key]));

  setTabBadge(sender.tab.id, hasSavedForm);
  return { ok: true, hasSavedForm };
}

async function handleFormSubmitted(message, sender) {
  if (!isFormMessageFromPage(message, sender)) return { ok: false, reason: "invalid-sender" };
  if (typeof message.formKey !== "string" || !message.formKey.startsWith(`${FORM_PREFIX}${message.origin}:`)) {
    return { ok: false, reason: "invalid-form" };
  }

  await cleanupExpiredPendingForms();

  const { [SETTINGS_KEY]: settings, [message.formKey]: savedRecord } = await chrome.storage.local.get([
    SETTINGS_KEY,
    message.formKey
  ]);
  const fields = sanitizeFields(message.fields);
  if (fields.length === 0) return { ok: true, status: "empty" };
  const hasSavedRecord = Boolean(savedRecord);
  // Ask for consent only when a submission differs from the stored values.
  const hasChangedValues = hasSavedRecord && JSON.stringify(savedRecord.fields) !== JSON.stringify(fields);
  if (hasSavedRecord && !hasChangedValues) return { ok: true, status: "unchanged" };

  const consentId = consentIdFor(message.formKey);
  const pendingKey = `${PENDING_PREFIX}${consentId}`;
  const record = {
    origin: message.origin,
    savedAt: new Date().toISOString(),
    fields
  };

  if (settings?.askBeforeSave === false) {
    await chrome.storage.local.set({ [message.formKey]: record });
    setTabBadge(sender.tab.id, true);
    return { ok: true, status: hasSavedRecord ? "updated" : "saved" };
  }

  // Keep unapproved values in session storage until the user makes a choice.
  await chrome.storage.session.set({
    [pendingKey]: {
      formKey: message.formKey,
      record,
      tabId: sender.tab.id,
      isUpdate: hasSavedRecord,
      createdAt: Date.now()
    }
  });

  try {
    await openConsentWindow(consentId, message.origin, fields.length, hasSavedRecord);
  } catch (error) {
    await chrome.storage.session.remove(pendingKey);
    return { ok: false, reason: error.message };
  }

  return { ok: true, status: "consent-requested" };
}

async function handleFillRequest(message, sender) {
  if (!isFormMessageFromPage(message, sender)) return { ok: false, reason: "invalid-sender" };
  if (typeof message.formKey !== "string" || !message.formKey.startsWith(`${FORM_PREFIX}${message.origin}:`)) {
    return { ok: false, reason: "invalid-form" };
  }

  const { [message.formKey]: record, [SETTINGS_KEY]: settings } = await chrome.storage.local.get([
    message.formKey,
    SETTINGS_KEY
  ]);
  if (!record) return { ok: true, status: "not-found" };
  return { ok: true, status: "found", record, settings: settings || {} };
}

async function handleConsentDecision(message, sender) {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("src/consent/consent.html")) ||
    typeof message.consentId !== "string" ||
    !/^formscript-[a-f0-9]+$/.test(message.consentId) ||
    !["save", "discard"].includes(message.decision)
  ) {
    return { ok: false, reason: "invalid-request" };
  }

  const pendingKey = `${PENDING_PREFIX}${message.consentId}`;
  const { [pendingKey]: pending } = await chrome.storage.session.get(pendingKey);
  if (!pending) return { ok: false, reason: "expired" };

  if (message.decision === "save") {
    await chrome.storage.local.set({ [pending.formKey]: pending.record });
    setTabBadge(pending.tabId, true);
  }

  await chrome.storage.session.remove(pendingKey);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === "FORMSCRIPT_FORM_SUBMITTED") {
    operation = handleFormSubmitted(message, sender);
  } else if (message?.type === "FORMSCRIPT_FILL_REQUEST") {
    operation = handleFillRequest(message, sender);
  } else if (message?.type === "FORMSCRIPT_CHECK_SAVED_FORMS") {
    operation = handleSavedFormCheck(message, sender);
  } else if (message?.type === "FORMSCRIPT_CONSENT_DECISION") {
    operation = handleConsentDecision(message, sender);
  } else {
    return false;
  }

  operation
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, reason: "storage-error" }));
  return true;
});

// Rebuild the browser context menu when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: FILL_CONTEXT_MENU_ID,
      title: "Fill form with FormScript",
      contexts: ["page", "editable"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== FILL_CONTEXT_MENU_ID || !Number.isInteger(tab?.id)) return;

  try {
    void chrome.tabs.sendMessage(tab.id, {
      type: "FORMSCRIPT_FILL_CONTEXT_FORM",
      targetForm: info.editable === true
    }).catch(() => {});
  } catch {}
});

async function cleanupExpiredPendingForms() {
  const sessionEntries = await chrome.storage.session.get(null);
  const expiredKeys = Object.entries(sessionEntries)
    .filter(([key, pending]) => {
      if (!key.startsWith(PENDING_PREFIX)) return false;
      return !pending?.createdAt || Date.now() - pending.createdAt > PENDING_TTL_MS;
    })
    .map(([key]) => key);

  if (expiredKeys.length > 0) await chrome.storage.session.remove(expiredKeys);
}