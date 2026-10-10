const SETTINGS_KEY = "formscript:settings";
const FORM_PREFIX = "formscript:form:";
const BACKUP_FORMAT = "formscript-backup";
const DEFAULT_SETTINGS = {
  askBeforeSave: true,
  fillOnlyEmpty: false
};

const askBeforeSave = document.getElementById("ask-before-save");
const fillOnlyEmpty = document.getElementById("fill-only-empty");
const exportButton = document.getElementById("export-backup");
const restoreButton = document.getElementById("restore-backup");
const backupFile = document.getElementById("backup-file");
const savedFormsContainer = document.getElementById("saved-forms");
const savedFormsSummary = document.getElementById("saved-forms-summary");
const deleteAllFormsButton = document.getElementById("delete-all-forms");
const statusText = document.getElementById("status");

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#a32d2d" : "#176b56";
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  askBeforeSave.checked = settings.askBeforeSave !== false;
  fillOnlyEmpty.checked = settings.fillOnlyEmpty === true;
}

async function saveSettings() {
  const settings = {
    askBeforeSave: askBeforeSave.checked,
    fillOnlyEmpty: fillOnlyEmpty.checked
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  showStatus("Preferences saved in this browser.");
}

// Show site names and field counts without exposing saved field values.
async function loadSavedForms() {
  const stored = await chrome.storage.local.get(null);
  const records = Object.entries(stored)
    .filter(([key, record]) => key.startsWith(FORM_PREFIX) && record && typeof record.origin === "string")
    .map(([key, record]) => ({ key, record, host: new URL(record.origin).hostname }))
    .sort((left, right) => left.host.localeCompare(right.host));

  savedFormsContainer.replaceChildren();
  savedFormsSummary.textContent = records.length === 1
    ? "1 saved form in this browser."
    : `${records.length} saved forms in this browser.`;
  deleteAllFormsButton.disabled = records.length === 0;

  if (records.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "saved-forms-empty";
    emptyMessage.textContent = "No saved forms.";
    savedFormsContainer.append(emptyMessage);
    return;
  }

  for (const { key, record, host } of records) {
    const row = document.createElement("div");
    row.className = "saved-form-row";

    const details = document.createElement("div");
    details.className = "saved-form-details";

    const siteName = document.createElement("strong");
    siteName.textContent = host;
    const fieldCount = document.createElement("small");
    const count = Array.isArray(record.fields) ? record.fields.length : 0;
    fieldCount.textContent = `${count} saved fields`;
    details.append(siteName, fieldCount);

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete saved form data for ${host}`);
    deleteButton.addEventListener("click", () => void deleteSavedForm(key, host));

    row.append(details, deleteButton);
    savedFormsContainer.append(row);
  }
}

async function deleteSavedForm(key, host) {
  if (!window.confirm(`Delete saved form data for ${host}?`)) return;
  await chrome.storage.local.remove(key);
  await loadSavedForms();
  showStatus(`Saved form data for ${host} deleted.`);
}

async function deleteAllSavedForms() {
  const stored = await chrome.storage.local.get(null);
  const formKeys = Object.keys(stored).filter((key) => key.startsWith(FORM_PREFIX));
  if (formKeys.length === 0) return;
  if (!window.confirm(`Delete saved data for all ${formKeys.length} forms?`)) return;

  await chrome.storage.local.remove(formKeys);
  await loadSavedForms();
  showStatus("All saved form data has been deleted.");
}

function isValidFormEntry(entry) {
  if (!entry || typeof entry.key !== "string" || !entry.key.startsWith(FORM_PREFIX)) return false;
  if (!entry.record || typeof entry.record.origin !== "string" || !Array.isArray(entry.record.fields)) return false;

  try {
    const url = new URL(entry.record.origin);
    if (
      !/^https?:$/.test(url.protocol) ||
      !entry.key.startsWith(`${FORM_PREFIX}${url.origin}:`) ||
      entry.record.fields.length > 150
    ) return false;

    return entry.record.fields.every((field) => {
      if (
        !field ||
        typeof field.name !== "string" ||
        field.name.length > 200 ||
        !Number.isInteger(field.index) ||
        field.index < 0 ||
        typeof field.type !== "string" ||
        !/^(text|search|email|tel|url|number|date|time|datetime-local|month|week|color|range|textarea|select-one|checkbox|radio)$/.test(field.type)
      ) {
        return false;
      }

      if (field.type === "checkbox" || field.type === "radio") {
        return typeof field.value === "string" && field.value.length <= 5000 && typeof field.checked === "boolean";
      }
      return typeof field.value === "string" && field.value.length <= 5000;
    });
  } catch {
    return false;
  }
}

// Validate imported data before it can replace records in browser storage.
function validateBackup(backup) {
  if (
    !backup ||
    backup.format !== BACKUP_FORMAT ||
    backup.version !== 1 ||
    !Array.isArray(backup.forms) ||
    backup.forms.length > 1000 ||
    !backup.forms.every(isValidFormEntry)
  ) {
    throw new Error("This file is not a valid FormScript backup.");
  }

  const settings = backup.settings && typeof backup.settings === "object" ? backup.settings : {};
  return {
    settings: {
      askBeforeSave: settings.askBeforeSave !== false,
      fillOnlyEmpty: settings.fillOnlyEmpty === true
    },
    forms: backup.forms
  };
}

async function exportBackup() {
  const stored = await chrome.storage.local.get(null);
  const forms = Object.entries(stored)
    .filter(([key]) => key.startsWith(FORM_PREFIX))
    .map(([key, record]) => ({ key, record }));
  const backup = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) },
    forms
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `formscript-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  showStatus(`${forms.length} forms included in the backup.`);
}

async function restoreBackup(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error("The file exceeds the 10 MB limit.");
  const backup = validateBackup(JSON.parse(await file.text()));
  const accepted = window.confirm(
    `Restore ${backup.forms.length} forms and replace the current FormScript data in this browser?`
  );
  if (!accepted) return;

  const stored = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(stored).filter((key) => key === SETTINGS_KEY || key.startsWith(FORM_PREFIX));
  await chrome.storage.local.remove(keysToRemove);

  const restoredData = Object.fromEntries(backup.forms.map(({ key, record }) => [key, record]));
  restoredData[SETTINGS_KEY] = backup.settings;
  await chrome.storage.local.set(restoredData);
  await loadSettings();
  await loadSavedForms();
  showStatus(`Backup restored: ${backup.forms.length} forms.`);
}

askBeforeSave.addEventListener("change", () => void saveSettings().catch(() => showStatus("Could not save preferences.", true)));
fillOnlyEmpty.addEventListener("change", () => void saveSettings().catch(() => showStatus("Could not save preferences.", true)));
exportButton.addEventListener("click", () => void exportBackup().catch(() => showStatus("Could not create the backup.", true)));
restoreButton.addEventListener("click", () => backupFile.click());
deleteAllFormsButton.addEventListener("click", () => {
  void deleteAllSavedForms().catch(() => showStatus("Could not delete saved forms.", true));
});
backupFile.addEventListener("change", async () => {
  const [file] = backupFile.files || [];
  if (!file) return;

  try {
    await restoreBackup(file);
  } catch (error) {
    showStatus(error.message || "Could not restore the backup.", true);
  } finally {
    backupFile.value = "";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && Object.keys(changes).some((key) => key.startsWith(FORM_PREFIX))) {
    void loadSavedForms().catch(() => showStatus("Could not load saved forms.", true));
  }
});

void Promise.all([loadSettings(), loadSavedForms()]).catch(() => {
  showStatus("Could not load settings.", true);
});