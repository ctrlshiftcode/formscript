const FORM_PREFIX = "formscript:form:";
const SETTINGS_KEY = "formscript:settings";
const PENDING_PREFIX = "pending:";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const CONTEXT_MENU_ID = "formscript-menu";
const FILL_CONTEXT_MENU_ID = "formscript-fill-form";
const CLEAR_CONTEXT_MENU_ID = "formscript-clear-site-data";
const DATA_TEST_MENU_ID = "formscript-fill-data-test";
const NAME_CONTEXT_MENU_ID = "formscript-add-name";
const EMAIL_CONTEXT_MENU_ID = "formscript-add-email";
const CELLPHONE_CONTEXT_MENU_ID = "formscript-add-cellphone";
const UNFORMATTED_CELLPHONE_CONTEXT_MENU_ID = "formscript-add-unformatted-cellphone";
const LANDLINE_CONTEXT_MENU_ID = "formscript-add-landline";
const UNFORMATTED_LANDLINE_CONTEXT_MENU_ID = "formscript-add-unformatted-landline";
const CPF_CONTEXT_MENU_ID = "formscript-add-cpf";
const UNFORMATTED_CPF_CONTEXT_MENU_ID = "formscript-add-unformatted-cpf";
const RG_CONTEXT_MENU_ID = "formscript-add-rg";
const UNFORMATTED_RG_CONTEXT_MENU_ID = "formscript-add-unformatted-rg";
const CNPJ_CONTEXT_MENU_ID = "formscript-add-cnpj";
const UNFORMATTED_CNPJ_CONTEXT_MENU_ID = "formscript-add-unformatted-cnpj";
const COMPANY_NAME_CONTEXT_MENU_ID = "formscript-add-company-name";
const ADDRESS_CONTEXT_MENU_ID = "formscript-add-address";
const CEP_CONTEXT_MENU_ID = "formscript-add-cep";
const UNFORMATTED_CEP_CONTEXT_MENU_ID = "formscript-add-unformatted-cep";
const consentWindowIds = new Map();

function consentIdFor(formKey) {
  let hash = 2166136261;
  for (let index = 0; index < formKey.length; index += 1) {
    hash ^= formKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `formscript-${(hash >>> 0).toString(16)}`;
}

const CRYPTO_KEY_ID = "formscript:crypto_key";
let cachedCryptoKey = null;

// Convert Uint8Array to base64 string.
function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

// Convert base64 string to Uint8Array.
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Retrieve or generate the AES-GCM 256-bit encryption key stored in local extension storage.
async function getCryptoKey() {
  if (cachedCryptoKey) return cachedCryptoKey;

  const stored = await chrome.storage.local.get(CRYPTO_KEY_ID);
  if (stored[CRYPTO_KEY_ID]) {
    const rawKey = base64ToBytes(stored[CRYPTO_KEY_ID]);
    cachedCryptoKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    return cachedCryptoKey;
  }

  const generatedKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", generatedKey);
  const base64Key = bytesToBase64(new Uint8Array(exported));
  await chrome.storage.local.set({ [CRYPTO_KEY_ID]: base64Key });
  cachedCryptoKey = generatedKey;
  return cachedCryptoKey;
}

// Encrypt a password string with AES-GCM using a unique 12-byte initialization vector (IV).
// Returns a tagged payload string: "enc:v1:<iv_base64>:<ciphertext_base64>".
async function encryptPassword(plainText) {
  if (!plainText || typeof plainText !== "string") return plainText;
  try {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plainText);
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    const ivBase64 = bytesToBase64(iv);
    const cipherBase64 = bytesToBase64(new Uint8Array(cipherBuffer));
    return `enc:v1:${ivBase64}:${cipherBase64}`;
  } catch {
    return plainText;
  }
}

// Decrypt an AES-GCM encrypted password payload ("enc:v1:...").
// Returns original plaintext string, or input if unencrypted.
async function decryptPassword(cipherText) {
  if (typeof cipherText !== "string" || !cipherText.startsWith("enc:v1:")) {
    return cipherText;
  }
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 4) return cipherText;
    const iv = base64ToBytes(parts[2]);
    const cipherBytes = base64ToBytes(parts[3]);
    const key = await getCryptoKey();
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    return cipherText;
  }
}

// Encrypt any field marked with type === "password" before persisting.
async function encryptFields(fields) {
  return Promise.all(fields.map(async (field) => {
    if (field?.type === "password" && typeof field.value === "string") {
      return {
        ...field,
        value: await encryptPassword(field.value)
      };
    }
    return field;
  }));
}

// Decrypt any encrypted password field before replaying or comparing.
async function decryptFields(fields) {
  return Promise.all(fields.map(async (field) => {
    if (field?.type === "password" && typeof field.value === "string") {
      return {
        ...field,
        value: await decryptPassword(field.value)
      };
    }
    return field;
  }));
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
      else {
        consentWindowIds.set(createdWindow.id, consentId);
        resolve(createdWindow);
      }
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
  const savedFormKeys = formKeys.filter((key) => Boolean(stored[key]));
  const hasSavedForm = savedFormKeys.length > 0;

  setTabBadge(sender.tab.id, hasSavedForm);
  return { ok: true, hasSavedForm, savedFormKeys };
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
  // Compare submitted plain values against decrypted stored values to determine if consent is needed.
  let hasChangedValues = false;
  if (hasSavedRecord) {
    const decryptedSavedFields = await decryptFields(savedRecord.fields);
    hasChangedValues = JSON.stringify(decryptedSavedFields) !== JSON.stringify(fields);
  }
  if (hasSavedRecord && !hasChangedValues) return { ok: true, status: "unchanged" };

  const consentId = consentIdFor(message.formKey);
  const pendingKey = `${PENDING_PREFIX}${consentId}`;
  // Encrypt password fields at rest before writing to storage.
  const encryptedFields = await encryptFields(fields);
  const record = {
    origin: message.origin,
    savedAt: new Date().toISOString(),
    fields: encryptedFields
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
    const consentWindow = await openConsentWindow(consentId, message.origin, fields.length, hasSavedRecord);
    const { [pendingKey]: pending } = await chrome.storage.session.get(pendingKey);
    if (pending) {
      await chrome.storage.session.set({
        [pendingKey]: { ...pending, windowId: consentWindow.id }
      });
    }
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
  // Decrypt any encrypted password fields before returning the record to the page content script.
  const decryptedFields = await decryptFields(record.fields);
  const decryptedRecord = { ...record, fields: decryptedFields };
  return { ok: true, status: "found", record: decryptedRecord, settings: settings || {} };
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

// Generate 11 valid CPF digits using the standard Brazilian checksum algorithm (Modulo 11).
function generateCpfDigits() {
  const digits = [];
  let allEqual = true;
  for (let index = 0; index < 9; index += 1) {
    const digit = Math.floor(Math.random() * 10);
    digits.push(digit);
    if (index > 0 && digit !== digits[0]) allEqual = false;
  }
  // Ensure the 9 initial base digits are not all identical (invalid in CPF rules).
  if (allEqual) {
    digits[8] = (digits[8] + 1) % 10;
  }

  // Calculate first verification digit using weights 10 down to 2.
  let sum1 = 0;
  for (let index = 0; index < 9; index += 1) {
    sum1 += digits[index] * (10 - index);
  }
  const remainder1 = sum1 % 11;
  const digit10 = remainder1 < 2 ? 0 : 11 - remainder1;
  digits.push(digit10);

  // Calculate second verification digit using weights 11 down to 2.
  let sum2 = 0;
  for (let index = 0; index < 10; index += 1) {
    sum2 += digits[index] * (11 - index);
  }
  const remainder2 = sum2 % 11;
  const digit11 = remainder2 < 2 ? 0 : 11 - remainder2;
  digits.push(digit11);

  return digits;
}

// Return formatted CPF string: XXX.XXX.XXX-XX.
function generateFormattedCpf() {
  const digits = generateCpfDigits();
  return `${digits[0]}${digits[1]}${digits[2]}.${digits[3]}${digits[4]}${digits[5]}.${digits[6]}${digits[7]}${digits[8]}-${digits[9]}${digits[10]}`;
}

// Return unformatted CPF string containing only numeric digits: XXXXXXXXXXX.
function generateUnformattedCpf() {
  return generateCpfDigits().join("");
}

// Generate 14 valid CNPJ digits using the standard Brazilian checksum algorithm (Modulo 11 with cyclical weights).
function generateCnpjDigits() {
  const digits = [];
  let allEqual = true;
  for (let index = 0; index < 8; index += 1) {
    const digit = Math.floor(Math.random() * 10);
    digits.push(digit);
    if (index > 0 && digit !== digits[0]) allEqual = false;
  }
  if (allEqual) {
    digits[7] = (digits[7] + 1) % 10;
  }
  digits.push(0, 0, 0, 1);

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum1 = 0;
  for (let index = 0; index < 12; index += 1) {
    sum1 += digits[index] * weights1[index];
  }
  const remainder1 = sum1 % 11;
  const digit13 = remainder1 < 2 ? 0 : 11 - remainder1;
  digits.push(digit13);

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum2 = 0;
  for (let index = 0; index < 13; index += 1) {
    sum2 += digits[index] * weights2[index];
  }
  const remainder2 = sum2 % 11;
  const digit14 = remainder2 < 2 ? 0 : 11 - remainder2;
  digits.push(digit14);

  return digits;
}

// Format CNPJ digits with mask: XX.XXX.XXX/XXXX-XX.
function generateFormattedCnpj() {
  const digits = generateCnpjDigits();
  return `${digits[0]}${digits[1]}.${digits[2]}${digits[3]}${digits[4]}.${digits[5]}${digits[6]}${digits[7]}/${digits[8]}${digits[9]}${digits[10]}${digits[11]}-${digits[12]}${digits[13]}`;
}

// Return unformatted CNPJ string with 14 numeric digits.
function generateUnformattedCnpj() {
  return generateCnpjDigits().join("");
}

// Common first and last names for generating realistic full names in Portuguese.
const FIRST_NAMES = [
  "Lucas", "Gabriel", "Matheus", "Rafael", "Leonardo",
  "Thiago", "Bruno", "Felipe", "Rodrigo", "Guilherme",
  "Pedro", "Carlos", "Eduardo", "Andre", "Gustavo",
  "Julia", "Beatriz", "Larissa", "Mariana", "Camila",
  "Amanda", "Carolina", "Fernanda", "Leticia", "Gabriela",
  "Ana", "Maria", "Juliana", "Paula", "Renata"
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues",
  "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
  "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida",
  "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa",
  "Rocha", "Dias", "Nascimento", "Andrade", "Moreira"
];

// Generate a random full name consisting of a first name and two distinct surnames.
function generateRandomName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName1 = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  let lastName2 = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  while (lastName2 === lastName1) {
    lastName2 = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  }
  return `${firstName} ${lastName1} ${lastName2}`;
}

// Generate a random email with ASCII-normalized names and safe test domains.
function generateRandomEmail() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const num = Math.floor(Math.random() * 900 + 100);
  const domains = ["example.com", "test.com", "mailtest.org"];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const cleanFirst = firstName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleanLast = lastName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return `${cleanFirst}.${cleanLast}${num}@${domain}`;
}

// Valid Brazilian area codes (DDDs) covering all states.
const BRAZIL_DDDS = [
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28", "31", "32", "33", "34",
  "35", "37", "38", "41", "42", "43", "44", "45", "46",
  "47", "48", "49", "51", "53", "54", "55", "61", "62",
  "64", "65", "66", "67", "68", "69", "71", "73", "74",
  "75", "77", "79", "81", "82", "83", "84", "85", "86",
  "87", "88", "89", "91", "92", "93", "94", "95", "96",
  "97", "98", "99"
];

// Generate an 11-digit Brazilian mobile number (DDD + 9XXXX-XXXX).
function generateRandomCellPhoneDigits() {
  const ddd = BRAZIL_DDDS[Math.floor(Math.random() * BRAZIL_DDDS.length)];
  // Brazilian mobile numbers always start with 9 followed by 6, 7, 8, or 9.
  const first = Math.floor(Math.random() * 4) + 6;
  let rest = "";
  for (let index = 0; index < 7; index += 1) {
    rest += Math.floor(Math.random() * 10);
  }
  return { ddd, number: `9${first}${rest}` };
}

// Format mobile phone with mask: (XX) 9XXXX-XXXX.
function generateFormattedCellPhone() {
  const { ddd, number } = generateRandomCellPhoneDigits();
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
}

// Return unformatted 11-digit mobile phone string: XX9XXXXXXXX.
function generateUnformattedCellPhone() {
  const { ddd, number } = generateRandomCellPhoneDigits();
  return `${ddd}${number}`;
}

// Generate a 10-digit Brazilian landline number (DDD + [2-5]XXX-XXXX).
function generateRandomLandlineDigits() {
  const ddd = BRAZIL_DDDS[Math.floor(Math.random() * BRAZIL_DDDS.length)];
  // Brazilian fixed landlines start with digits 2, 3, 4, or 5.
  const first = Math.floor(Math.random() * 4) + 2;
  let rest = "";
  for (let index = 0; index < 7; index += 1) {
    rest += Math.floor(Math.random() * 10);
  }
  return { ddd, number: `${first}${rest}` };
}

// Format landline phone with mask: (XX) XXXX-XXXX.
function generateFormattedLandline() {
  const { ddd, number } = generateRandomLandlineDigits();
  return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
}

// Return unformatted 10-digit landline string: XXXXXXXXXX.
function generateUnformattedLandline() {
  const { ddd, number } = generateRandomLandlineDigits();
  return `${ddd}${number}`;
}

// Lexical components for generating realistic Brazilian corporate names.
const COMPANY_PREFIXES = [
  "Alpha", "Beta", "Delta", "Omega", "Prime", "Nexus", "Atlas", "Horizonte",
  "Vanguarda", "Inova", "Global", "Apex", "Omni", "Lumina", "Vertex",
  "Orion", "Futura", "Avançar", "Solidez", "Virtus", "Pinnacle", "Quantum"
];

const COMPANY_MIDDLES = [
  "Tecnologia", "Sistemas", "Logística", "Consultoria", "Serviços", "Engenharia",
  "Comércio", "Empreendimentos", "Participações", "Soluções Digitais", "Alimentos",
  "Transportes", "Segurança", "Comunicação", "Inovação", "Gestão", "Distribuição"
];

const COMPANY_SUFFIXES = [
  "Ltda", "S.A.", "ME", "EPP", "Brasil Ltda", "Digital Ltda", "e Serviços Ltda"
];

// Generate a random company name combining brand prefix, industry segment, and legal type.
function generateRandomCompanyName() {
  const prefix = COMPANY_PREFIXES[Math.floor(Math.random() * COMPANY_PREFIXES.length)];
  const middle = COMPANY_MIDDLES[Math.floor(Math.random() * COMPANY_MIDDLES.length)];
  const suffix = COMPANY_SUFFIXES[Math.floor(Math.random() * COMPANY_SUFFIXES.length)];
  return `${prefix} ${middle} ${suffix}`;
}

// Generate 9 RG digits using the SSP validation algorithm (weights 2 through 9).
// If check digit calculation results in 10 (historically roman 'X'), regenerate to ensure purely numeric string.
function generateRgDigits() {
  while (true) {
    const digits = [];
    for (let index = 0; index < 8; index += 1) {
      digits.push(Math.floor(Math.random() * 10));
    }
    let sum = 0;
    for (let index = 0; index < 8; index += 1) {
      sum += digits[index] * (index + 2);
    }
    const remainder = sum % 11;
    let checkDigit = 11 - remainder;
    if (checkDigit === 11) checkDigit = 0;
    if (checkDigit === 10) continue;
    digits.push(checkDigit);
    return digits;
  }
}

// Format RG with standard mask: XX.XXX.XXX-X.
function generateFormattedRg() {
  const digits = generateRgDigits();
  return `${digits[0]}${digits[1]}.${digits[2]}${digits[3]}${digits[4]}.${digits[5]}${digits[6]}${digits[7]}-${digits[8]}`;
}

// Return unformatted 9-digit RG string: XXXXXXXXX.
function generateUnformattedRg() {
  return generateRgDigits().join("");
}

// Curated list of realistic Brazilian streets, neighborhoods, cities, UFs, and postal code prefixes.
const ADDRESS_DATA = [
  { street: "Av. Paulista", neighborhood: "Bela Vista", city: "São Paulo", uf: "SP", cep: "01311000" },
  { street: "Rua Augusta", neighborhood: "Consolação", city: "São Paulo", uf: "SP", cep: "01305100" },
  { street: "Rua Oscar Freire", neighborhood: "Cerqueira César", city: "São Paulo", uf: "SP", cep: "01426001" },
  { street: "Av. Brigadeiro Faria Lima", neighborhood: "Itaim Bibi", city: "São Paulo", uf: "SP", cep: "04538133" },
  { street: "Rua Domingos de Morais", neighborhood: "Vila Mariana", city: "São Paulo", uf: "SP", cep: "04010000" },
  { street: "Av. Atlântica", neighborhood: "Copacabana", city: "Rio de Janeiro", uf: "RJ", cep: "22070000" },
  { street: "Rua Visconde de Pirajá", neighborhood: "Ipanema", city: "Rio de Janeiro", uf: "RJ", cep: "22410003" },
  { street: "Av. Rio Branco", neighborhood: "Centro", city: "Rio de Janeiro", uf: "RJ", cep: "20040002" },
  { street: "Av. Afonso Pena", neighborhood: "Funcionários", city: "Belo Horizonte", uf: "MG", cep: "30130005" },
  { street: "Rua da Bahia", neighborhood: "Lourdes", city: "Belo Horizonte", uf: "MG", cep: "30160011" },
  { street: "Av. Sete de Setembro", neighborhood: "Batel", city: "Curitiba", uf: "PR", cep: "80230010" },
  { street: "Rua XV de Novembro", neighborhood: "Centro", city: "Curitiba", uf: "PR", cep: "80020310" },
  { street: "Av. Borges de Medeiros", neighborhood: "Praia de Belas", city: "Porto Alegre", uf: "RS", cep: "90110150" },
  { street: "Av. Tancredo Neves", neighborhood: "Caminho das Árvores", city: "Salvador", uf: "BA", cep: "41820021" },
  { street: "Av. Beira Mar", neighborhood: "Meireles", city: "Fortaleza", uf: "CE", cep: "60165121" },
  { street: "Av. Boa Viagem", neighborhood: "Boa Viagem", city: "Recife", uf: "PE", cep: "51011060" },
  { street: "Av. Beira Mar Norte", neighborhood: "Centro", city: "Florianópolis", uf: "SC", cep: "88015702" },
  { street: "Setor Bancário Sul", neighborhood: "Asa Sul", city: "Brasília", uf: "DF", cep: "70070120" }
];

// Generate a realistic full Brazilian address: Street, Number - Neighborhood, City - UF.
function generateRandomAddress() {
  const item = ADDRESS_DATA[Math.floor(Math.random() * ADDRESS_DATA.length)];
  const number = Math.floor(Math.random() * 2500) + 10;
  return `${item.street}, ${number} - ${item.neighborhood}, ${item.city} - ${item.uf}`;
}

// Generate 8 CEP digits using a realistic regional prefix and randomized suffix.
function generateCepDigits() {
  const item = ADDRESS_DATA[Math.floor(Math.random() * ADDRESS_DATA.length)];
  const prefix = item.cep.slice(0, 5);
  const suffix = String(Math.floor(Math.random() * 900 + 100));
  return `${prefix}${suffix}`;
}

// Format postal code (CEP) with standard mask: XXXXX-XXX.
function generateFormattedCep() {
  const cep = generateCepDigits();
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

// Return unformatted 8-digit postal code string: XXXXXXXX.
function generateUnformattedCep() {
  return generateCepDigits();
}

// Send a data insertion message to the content script of the active tab.
function sendInsertDataMessage(tabId, text) {
  try {
    void chrome.tabs.sendMessage(tabId, {
      type: "FORMSCRIPT_INSERT_DATA",
      text
    }).catch(() => {});
  } catch {}
}

// Rebuild the browser context-menu submenu when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "FormScript",
      contexts: ["page", "editable"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
    chrome.contextMenus.create({
      id: FILL_CONTEXT_MENU_ID,
      parentId: CONTEXT_MENU_ID,
      title: "Fill form",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: CLEAR_CONTEXT_MENU_ID,
      parentId: CONTEXT_MENU_ID,
      title: "Clear saved form data for this site",
      contexts: ["page", "editable"]
    });
    // Main "Fill data test" container menu.
    chrome.contextMenus.create({
      id: DATA_TEST_MENU_ID,
      parentId: CONTEXT_MENU_ID,
      title: "Fill data test",
      contexts: ["page", "editable"]
    });

    // Group 1: Contact data (Name, Email, Cell phone, Landline).
    chrome.contextMenus.create({
      id: NAME_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Name",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: EMAIL_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Email",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: CELLPHONE_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Cell phone (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_CELLPHONE_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Cell phone (unformated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: LANDLINE_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Landline (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_LANDLINE_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Landline (unformated)",
      contexts: ["page", "editable"]
    });
    // Group 2: Personal identification (CPF, RG).
    chrome.contextMenus.create({
      id: "formscript-data-test-sep-1",
      parentId: DATA_TEST_MENU_ID,
      type: "separator",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: CPF_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CPF (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_CPF_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CPF (unformated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: RG_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "RG (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_RG_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "RG (unformated)",
      contexts: ["page", "editable"]
    });

    // Group 3: Corporate identification (Company name, CNPJ).
    chrome.contextMenus.create({
      id: "formscript-data-test-sep-2",
      parentId: DATA_TEST_MENU_ID,
      type: "separator",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: COMPANY_NAME_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Company name",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: CNPJ_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CNPJ (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_CNPJ_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CNPJ (unformated)",
      contexts: ["page", "editable"]
    });

    // Group 4: Location & Address (Address, CEP).
    chrome.contextMenus.create({
      id: "formscript-data-test-sep-3",
      parentId: DATA_TEST_MENU_ID,
      type: "separator",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: ADDRESS_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "Address",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: CEP_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CEP (formated)",
      contexts: ["page", "editable"]
    });
    chrome.contextMenus.create({
      id: UNFORMATTED_CEP_CONTEXT_MENU_ID,
      parentId: DATA_TEST_MENU_ID,
      title: "CEP (unformated)",
      contexts: ["page", "editable"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!Number.isInteger(tab?.id)) return;

  if (info.menuItemId === CLEAR_CONTEXT_MENU_ID) {
    void clearSavedFormsForSite(info.pageUrl || tab.url, tab.id).catch(() => {});
    return;
  }
  if (info.menuItemId === FILL_CONTEXT_MENU_ID) {
    try {
      void chrome.tabs.sendMessage(tab.id, {
        type: "FORMSCRIPT_FILL_CONTEXT_FORM",
        targetForm: info.editable === true
      }).catch(() => {});
    } catch {}
    return;
  }
  if (info.menuItemId === NAME_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateRandomName());
    return;
  }
  if (info.menuItemId === EMAIL_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateRandomEmail());
    return;
  }
  if (info.menuItemId === CELLPHONE_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedCellPhone());
    return;
  }
  if (info.menuItemId === UNFORMATTED_CELLPHONE_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedCellPhone());
    return;
  }
  if (info.menuItemId === LANDLINE_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedLandline());
    return;
  }
  if (info.menuItemId === UNFORMATTED_LANDLINE_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedLandline());
    return;
  }
  if (info.menuItemId === CPF_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedCpf());
    return;
  }
  if (info.menuItemId === UNFORMATTED_CPF_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedCpf());
    return;
  }
  if (info.menuItemId === RG_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedRg());
    return;
  }
  if (info.menuItemId === UNFORMATTED_RG_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedRg());
    return;
  }
  if (info.menuItemId === COMPANY_NAME_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateRandomCompanyName());
    return;
  }
  if (info.menuItemId === CNPJ_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedCnpj());
    return;
  }
  if (info.menuItemId === UNFORMATTED_CNPJ_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedCnpj());
    return;
  }
  if (info.menuItemId === ADDRESS_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateRandomAddress());
    return;
  }
  if (info.menuItemId === CEP_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateFormattedCep());
    return;
  }
  if (info.menuItemId === UNFORMATTED_CEP_CONTEXT_MENU_ID) {
    sendInsertDataMessage(tab.id, generateUnformattedCep());
  }
});

// Remove only records whose origin exactly matches the page where the menu was opened.
async function clearSavedFormsForSite(pageUrl, tabId) {
  let origin;
  try {
    const url = new URL(pageUrl);
    if (!/^https?:$/.test(url.protocol)) return;
    origin = url.origin;
  } catch {
    return;
  }

  const originPrefix = `${FORM_PREFIX}${origin}:`;
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(originPrefix));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
  setTabBadge(tabId, false);
}

async function discardConsentOnWindowClose(windowId) {
  const consentId = consentWindowIds.get(windowId);
  consentWindowIds.delete(windowId);

  let pendingKey = consentId ? `${PENDING_PREFIX}${consentId}` : null;
  let pending;
  if (pendingKey) {
    const stored = await chrome.storage.session.get(pendingKey);
    pending = stored[pendingKey];
  }

  if (!pending) {
    const sessionEntries = await chrome.storage.session.get(null);
    const match = Object.entries(sessionEntries).find(([key, value]) => (
      key.startsWith(PENDING_PREFIX) && value?.windowId === windowId
    ));
    if (match) [pendingKey, pending] = match;
  }

  if (pending && pendingKey) await chrome.storage.session.remove(pendingKey);
}

chrome.windows.onRemoved.addListener((windowId) => {
  void discardConsentOnWindowClose(windowId).catch(() => {});
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