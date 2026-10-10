const FORM_PREFIX = "formscript:form:";
const SENSITIVE_FIELD_NAME = /password|passwd|passcode|token|secret|one.?time|verification.?code|\botp\b|\bcvv\b|\bcvc\b|card.?number/i;
const EXCLUDED_AUTOCOMPLETE = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "username"
]);
const EXCLUDED_INPUT_TYPES = new Set([
  "button",
  "file",
  "hidden",
  "image",
  "password",
  "reset",
  "submit"
]);
let contextMenuForm = null;
const formFillWidgets = new Map();
let formFillHost = null;
let formFillRoot = null;

// Exclude credentials, payment data, and controls that cannot be safely replayed.
function isEligibleControl(control) {
  if (!control.name || control.disabled || control.readOnly) return false;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
    return false;
  }

  const type = (control.type || "text").toLowerCase();
  if (EXCLUDED_INPUT_TYPES.has(type) || (control instanceof HTMLSelectElement && control.multiple)) return false;
  if (SENSITIVE_FIELD_NAME.test(control.name)) return false;

  const autocomplete = (control.autocomplete || "").toLowerCase().split(/\s+/);
  if (autocomplete.some((token) => EXCLUDED_AUTOCOMPLETE.has(token) || token.startsWith("cc-"))) return false;

  return true;
}

function getEligibleControls(form) {
  return Array.from(form.elements).filter(isEligibleControl);
}

function getFormKey(form, controls) {
  let actionPath;
  try {
    actionPath = new URL(form.getAttribute("action") || location.href, location.href).pathname;
  } catch {
    actionPath = location.pathname;
  }

  // Match forms by structure so changing field values does not create a new record.
  const signature = JSON.stringify({
    actionPath,
    controls: controls.map((control) => ({
      name: control.name,
      tag: control.tagName.toLowerCase(),
      type: (control.type || "text").toLowerCase()
    }))
  });

  return `${FORM_PREFIX}${location.origin}:${encodeURIComponent(signature)}`;
}

function getEligibleFormEntries() {
  return Array.from(document.forms).flatMap((form) => {
    const controls = getEligibleControls(form);
    if (controls.length === 0) return [];

    return [{
      form,
      control: controls[0],
      formKey: getFormKey(form, controls)
    }];
  });
}

// Keep fill controls in a shadow root so page styles cannot affect their appearance.
function ensureFormFillRoot() {
  if (formFillHost?.isConnected) return formFillRoot;

  formFillHost = document.createElement("div");
  formFillHost.dataset.formscriptFillUi = "true";
  formFillHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  formFillRoot = formFillHost.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    button {
      all: initial;
      position: fixed;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 30px;
      height: 24px;
      border: 1px solid #ffffff;
      border-radius: 6px;
      background: #176b56;
      box-shadow: 0 2px 8px rgb(0 0 0 / 24%);
      color: #ffffff;
      font: 700 14px/1 "Segoe UI", sans-serif;
      cursor: pointer;
      pointer-events: auto;
    }
    button:hover { background: #105642; }
    button:focus-visible { outline: 3px solid #e19a42; outline-offset: 2px; }
    button:disabled { cursor: wait; opacity: 0.65; }
    button[hidden] { display: none !important; }
  `;
  formFillRoot.append(style);
  document.documentElement.append(formFillHost);
  return formFillRoot;
}

function positionFormFillWidgets() {
  for (const [form, widget] of formFillWidgets) {
    if (!form.isConnected || !widget.control.isConnected) {
      widget.button.remove();
      formFillWidgets.delete(form);
      continue;
    }

    const rect = widget.control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      widget.button.hidden = true;
      continue;
    }

    const left = Math.max(4, Math.min(rect.right + 8, window.innerWidth - 34));
    const top = Math.max(4, Math.min(rect.top + (rect.height - 24) / 2, window.innerHeight - 28));
    widget.button.style.left = `${left}px`;
    widget.button.style.top = `${top}px`;
    widget.button.hidden = false;
  }
}

function createFormFillButton(form) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "F";
  button.title = "Fill this form with FormScript";
  button.setAttribute("aria-label", "Fill this form with FormScript");
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const widget = formFillWidgets.get(form);
    if (!widget) return;
    button.disabled = true;

    try {
      const result = await fillForm(form);
      button.title = result.status === "filled"
        ? `Filled ${result.count} fields`
        : "No saved data matches this form";
    } catch {
      button.title = "Could not fill this form";
    } finally {
      button.disabled = false;
      window.setTimeout(() => {
        if (button.isConnected) button.title = "Fill this form with FormScript";
      }, 1800);
    }
  });
  return button;
}

// Show an icon only for forms with a matching saved record.
function syncFormFillWidgets(entries, savedFormKeys) {
  const savedKeys = new Set(savedFormKeys);
  const matchingEntries = entries.filter((entry) => savedKeys.has(entry.formKey));

  for (const [form, widget] of formFillWidgets) {
    if (!matchingEntries.some((entry) => entry.form === form)) {
      widget.button.remove();
      formFillWidgets.delete(form);
    }
  }

  if (matchingEntries.length === 0) {
    formFillHost?.remove();
    formFillHost = null;
    formFillRoot = null;
    return;
  }

  const root = ensureFormFillRoot();
  for (const entry of matchingEntries) {
    let widget = formFillWidgets.get(entry.form);
    if (!widget) {
      widget = {
        button: createFormFillButton(entry.form),
        control: entry.control
      };
      formFillWidgets.set(entry.form, widget);
    } else {
      widget.control = entry.control;
    }

    if (widget.button.parentNode !== root) root.append(widget.button);
  }

  positionFormFillWidgets();
}

function checkForSavedForms() {
  const entries = getEligibleFormEntries();
  const formKeys = [...new Set(entries.map((entry) => entry.formKey))];

  try {
    void chrome.runtime.sendMessage({
      type: "FORMSCRIPT_CHECK_SAVED_FORMS",
      origin: location.origin,
      formKeys
    }).then((response) => {
      if (response?.ok) syncFormFillWidgets(entries, response.savedFormKeys || []);
    }).catch(() => {});
  } catch {}
}

function snapshotFields(controls) {
  const occurrences = new Map();

  return controls.flatMap((control) => {
    const type = (control.type || "text").toLowerCase();
    const identity = `${control.name}\u0000${type}`;
    const index = occurrences.get(identity) || 0;
    occurrences.set(identity, index + 1);

    if (type !== "checkbox" && type !== "radio" && control.value === "") return [];

    return [{
      name: control.name,
      type,
      index,
      value: control.value,
      ...(type === "checkbox" || type === "radio" ? { checked: control.checked } : {})
    }];
  });
}

// Capture values before the page navigates away after a standard form submission.
async function captureForm(form) {
  const controls = getEligibleControls(form);
  const fields = snapshotFields(controls);
  if (fields.length === 0) return;

  try {
    await chrome.runtime.sendMessage({
      type: "FORMSCRIPT_FORM_SUBMITTED",
      origin: location.origin,
      formKey: getFormKey(form, controls),
      fields
    });
  } catch {
    // The form submission should continue if the extension is unavailable.
  }
}

// Use native setters and input events so framework-controlled fields observe updates.
function setControlValue(control, value) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value");
  if (descriptor?.set) descriptor.set.call(control, value);
  else control.value = value;
}

function setControlChecked(control, checked) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (descriptor?.set) descriptor.set.call(control, checked);
  else control.checked = checked;
}

function applyField(control, field, fillOnlyEmpty) {
  if (field.type === "checkbox" || field.type === "radio") {
    setControlChecked(control, field.checked);
  } else {
    if (fillOnlyEmpty && control.value !== "") return false;
    setControlValue(control, field.value);
  }

  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function fillForm(form) {
  const controls = getEligibleControls(form);
  if (controls.length === 0) return { status: "no-fields", count: 0 };

  const response = await chrome.runtime.sendMessage({
    type: "FORMSCRIPT_FILL_REQUEST",
    origin: location.origin,
    formKey: getFormKey(form, controls)
  });

  if (!response?.ok) return { status: "error", count: 0 };
  if (response.status === "not-found") return { status: "not-found", count: 0 };

  const occurrences = new Map();
  const savedFields = new Map(response.record.fields.map((field) => [
    `${field.name}\u0000${field.type}\u0000${field.index}`,
    field
  ]));
  const filledRadioGroups = new Set();
  let count = 0;

  for (const control of controls) {
    const type = (control.type || "text").toLowerCase();
    if (type === "radio" && response.settings?.fillOnlyEmpty === true) {
      if (filledRadioGroups.has(control.name)) continue;
      filledRadioGroups.add(control.name);
      if (controls.some((candidate) => candidate.type === "radio" && candidate.name === control.name && candidate.checked)) {
        continue;
      }
    }

    const identity = `${control.name}\u0000${type}`;
    const index = occurrences.get(identity) || 0;
    occurrences.set(identity, index + 1);

    const field = savedFields.get(`${control.name}\u0000${type}\u0000${index}`);
    if (field && applyField(control, field, response.settings?.fillOnlyEmpty === true)) count += 1;
  }

  return { status: "filled", count };
}

async function fillFirstSavedForm() {
  for (const candidate of document.forms) {
    if (getEligibleControls(candidate).length === 0) continue;
    const result = await fillForm(candidate);
    if (result.status !== "not-found") return result;
  }
  return { status: "not-found", count: 0 };
}

document.addEventListener("submit", (event) => {
  if (event.target instanceof HTMLFormElement) void captureForm(event.target);
}, true);
// Remember the form under the pointer so a context-menu action targets that form.
document.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    contextMenuForm = null;
    return;
  }

  const control = target.closest("input, select, textarea");
  contextMenuForm = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    ? control.form
    : target.closest("form");
}, true);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkForSavedForms();
});
window.addEventListener("scroll", positionFormFillWidgets, true);
window.addEventListener("resize", positionFormFillWidgets);

let badgeCheckTimer;
const formObserver = new MutationObserver(() => {
  clearTimeout(badgeCheckTimer);
  badgeCheckTimer = setTimeout(checkForSavedForms, 250);
});
formObserver.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FORMSCRIPT_FILL_ACTIVE_FORM") {
    fillFirstSavedForm()
      .then(sendResponse)
      .catch(() => sendResponse({ status: "error", count: 0 }));
    return true;
  }

  if (message?.type === "FORMSCRIPT_FILL_CONTEXT_FORM") {
    const form = message.targetForm && contextMenuForm && document.contains(contextMenuForm)
      ? contextMenuForm
      : null;
    const operation = form ? fillForm(form) : fillFirstSavedForm();

    operation
      .then(sendResponse)
      .catch(() => sendResponse({ status: "error", count: 0 }));
    return true;
  }

  if (message?.type !== "FORMSCRIPT_FILL_FORM") return false;

  const form = Array.from(document.forms).find((candidate) => {
    const controls = getEligibleControls(candidate);
    return controls.length > 0 && getFormKey(candidate, controls) === message.formKey;
  });

  if (!form) {
    sendResponse({ status: "not-found", count: 0 });
    return false;
  }

  fillForm(form)
    .then(sendResponse)
    .catch(() => sendResponse({ status: "error", count: 0 }));
  return true;
});

checkForSavedForms();