const FORM_PREFIX = "formscript:form:";

// Sensitive field patterns that remain strictly excluded (payment cards, OTP, 2FA codes).
// Passwords and usernames are allowed and encrypted at rest by the background service worker.
const SENSITIVE_FIELD_NAME = /token|secret|one.?time|verification.?code|\botp\b|\bcvv\b|\bcvc\b|card.?number/i;

// Autocomplete values that remain excluded (one-time verification codes and credit cards).
const EXCLUDED_AUTOCOMPLETE = new Set([
  "one-time-code"
]);

// Non-fillable input types. Note: "password" is intentionally supported and encrypted at rest.
const EXCLUDED_INPUT_TYPES = new Set([
  "button",
  "file",
  "hidden",
  "image",
  "reset",
  "submit"
]);

// Eligible text-like input types, including password fields.
const TEXT_FIELD_TYPES = new Set(["text", "search", "email", "tel", "url", "password"]);
let contextMenuForm = null;
let lastContextMenuTarget = null;
const formFillWidgets = new Map();
let formFillHost = null;
let formFillRoot = null;

// Track active password toggle widgets and revealed password inputs.
const passwordToggleWidgets = new Map();
const revealedPasswordInputs = new WeakSet();
let passwordToggleHost = null;
let passwordToggleRoot = null;

// Clean SVG icons for password visibility toggle (eye open and eye slashed).
const EYE_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 7 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;

function isEditableTextField(control) {
  if (!control || !(control instanceof Element)) return false;
  if (control instanceof HTMLTextAreaElement) {
    return !control.disabled && !control.readOnly;
  }
  if (control instanceof HTMLInputElement) {
    const type = (control.type || "text").toLowerCase();
    const disallowedTypes = new Set([
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "image",
      "file",
      "hidden",
      "color",
      "range"
    ]);
    return !disallowedTypes.has(type) && !control.disabled && !control.readOnly;
  }
  if (control.isContentEditable) return true;
  return false;
}

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

// Return unformatted CPF string: XXXXXXXXXXX.
function generateUnformattedCpf() {
  return generateCpfDigits().join("");
}

// Generate 14 valid CNPJ digits using Modulo 11 with cyclical weights.
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

// Format CNPJ with mask: XX.XXX.XXX/XXXX-XX.
function generateFormattedCnpj() {
  const digits = generateCnpjDigits();
  return `${digits[0]}${digits[1]}.${digits[2]}${digits[3]}${digits[4]}.${digits[5]}${digits[6]}${digits[7]}/${digits[8]}${digits[9]}${digits[10]}${digits[11]}-${digits[12]}${digits[13]}`;
}

// Return unformatted CNPJ string: XXXXXXXXXXXXXX.
function generateUnformattedCnpj() {
  return generateCnpjDigits().join("");
}

// Generate 9 RG digits using SSP weights (2 through 9).
// Regenerate if remainder equals 10 to guarantee a purely numeric digit.
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

// Valid Brazilian area codes (DDDs).
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

// Curated list of realistic Brazilian addresses and postal code prefixes.
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

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none;left:-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    textarea.remove();
    return successful;
  } catch {
    return false;
  }
}

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

function isTextField(control) {
  return control instanceof HTMLTextAreaElement || (
    control instanceof HTMLInputElement && TEXT_FIELD_TYPES.has(control.type.toLowerCase())
  );
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
    const control = controls.find(isTextField);
    if (!control) return [];

    return [{
      form,
      control,
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
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid #ffffff;
      border-radius: 6px;
      background: #176b56;
      box-shadow: 0 2px 8px rgb(0 0 0 / 24%);
      color: #ffffff;
      font: 700 12px/1 "Segoe UI", sans-serif;
      text-align: center;
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
    const inset = 5;
    const buttonSize = Math.min(
      24,
      Math.floor(rect.width - inset * 2),
      Math.floor(rect.height - 2)
    );
    if (buttonSize < 12) {
      widget.button.hidden = true;
      continue;
    }

    // Offset the form fill button to the left if the control also hosts an active password toggle.
    const hasPasswordToggle = passwordToggleWidgets.has(widget.control) &&
      !passwordToggleWidgets.get(widget.control).hidden;
    const rightOffset = hasPasswordToggle ? (buttonSize + inset + 2) : inset;

    const left = rect.right - buttonSize - rightOffset;
    const top = rect.top + (rect.height - buttonSize) / 2;
    if (
      left < 0 ||
      top < 0 ||
      left + buttonSize > window.innerWidth ||
      top + buttonSize > window.innerHeight
    ) {
      widget.button.hidden = true;
      continue;
    }

    widget.button.style.width = `${buttonSize}px`;
    widget.button.style.height = `${buttonSize}px`;
    widget.button.style.fontSize = `${Math.min(12, buttonSize * 0.6)}px`;
    widget.button.style.left = `${left}px`;
    widget.button.style.top = `${top}px`;
    widget.button.hidden = false;
  }
}

// Keep password visibility toggle buttons in an isolated shadow root so page CSS does not affect styling.
function ensurePasswordToggleRoot() {
  if (passwordToggleHost?.isConnected) return passwordToggleRoot;

  passwordToggleHost = document.createElement("div");
  passwordToggleHost.dataset.formscriptPasswordToggleUi = "true";
  passwordToggleHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  passwordToggleRoot = passwordToggleHost.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    button.formscript-password-toggle {
      all: initial;
      position: fixed;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 24px;
      height: 24px;
      padding: 0;
      margin: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      pointer-events: auto;
      transition: color 0.15s ease, background-color 0.15s ease;
      user-select: none;
      -webkit-user-select: none;
    }
    button.formscript-password-toggle:hover {
      color: #0f172a;
      background-color: rgba(0, 0, 0, 0.08);
    }
    button.formscript-password-toggle:active {
      background-color: rgba(0, 0, 0, 0.14);
    }
    button.formscript-password-toggle:focus-visible {
      outline: 2px solid #3b82f6;
      outline-offset: 1px;
    }
    button.formscript-password-toggle[hidden] {
      display: none !important;
    }
    button.formscript-password-toggle svg {
      width: 16px;
      height: 16px;
      display: block;
      pointer-events: none;
    }
  `;
  passwordToggleRoot.append(style);
  document.documentElement.append(passwordToggleHost);
  return passwordToggleRoot;
}

// Position eye toggle buttons within the right-hand boundary of eligible password inputs.
function positionPasswordToggleWidgets() {
  for (const [input, button] of passwordToggleWidgets) {
    if (!input.isConnected) {
      button.remove();
      passwordToggleWidgets.delete(input);
      revealedPasswordInputs.delete(input);
      continue;
    }

    const rect = input.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      button.hidden = true;
      continue;
    }

    const style = window.getComputedStyle(input);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      button.hidden = true;
      continue;
    }

    const inset = 5;
    const buttonSize = Math.min(
      24,
      Math.floor(rect.width - inset * 2),
      Math.floor(rect.height - 2)
    );
    if (buttonSize < 12) {
      button.hidden = true;
      continue;
    }

    const left = rect.right - buttonSize - inset;
    const top = rect.top + (rect.height - buttonSize) / 2;

    button.style.width = `${buttonSize}px`;
    button.style.height = `${buttonSize}px`;
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.hidden = false;
  }
}

// Create an eye button that toggles masking for a password input field.
function createPasswordToggleButton(input) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "formscript-password-toggle";
  const isRevealed = revealedPasswordInputs.has(input);
  button.innerHTML = isRevealed ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
  button.title = isRevealed ? "Hide password" : "Show password";
  button.setAttribute("aria-label", button.title);

  // Prevent mousedown from moving focus away from the input field.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!input.isConnected) return;

    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    const currentlyRevealed = revealedPasswordInputs.has(input);

    if (currentlyRevealed) {
      input.type = "password";
      revealedPasswordInputs.delete(input);
      button.innerHTML = EYE_OPEN_SVG;
      button.title = "Show password";
      button.setAttribute("aria-label", "Show password");
    } else {
      input.type = "text";
      revealedPasswordInputs.add(input);
      button.innerHTML = EYE_CLOSED_SVG;
      button.title = "Hide password";
      button.setAttribute("aria-label", "Hide password");
    }

    // Preserve typing focus and cursor selection position.
    try {
      input.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    } catch {}
  });

  return button;
}

// Scan DOM for password fields and synchronize their visibility toggle widgets.
function syncPasswordToggleWidgets() {
  const inputs = Array.from(document.querySelectorAll("input")).filter((input) => {
    if (!input.isConnected) return false;
    const type = (input.type || "").toLowerCase();
    return type === "password" || revealedPasswordInputs.has(input);
  });

  for (const [input, button] of passwordToggleWidgets) {
    if (!inputs.includes(input)) {
      button.remove();
      passwordToggleWidgets.delete(input);
      revealedPasswordInputs.delete(input);
    }
  }

  if (inputs.length === 0) {
    passwordToggleHost?.remove();
    passwordToggleHost = null;
    passwordToggleRoot = null;
    return;
  }

  const root = ensurePasswordToggleRoot();
  for (const input of inputs) {
    let button = passwordToggleWidgets.get(input);
    if (!button) {
      button = createPasswordToggleButton(input);
      passwordToggleWidgets.set(input, button);
    }
    if (button.parentNode !== root) {
      root.append(button);
    }
  }

  positionPasswordToggleWidgets();
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
    let type = (control.type || "text").toLowerCase();
    // Preserve password type even if currently revealed in plaintext by the eye toggle.
    if (revealedPasswordInputs.has(control)) {
      type = "password";
    }
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
// Remember the form and textfield under the pointer so context-menu actions target them.
document.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    contextMenuForm = null;
    lastContextMenuTarget = null;
    return;
  }

  let editable = target.closest("input, textarea, [contenteditable='true'], [contenteditable='']");
  if (!editable && target.closest("label")) {
    const label = target.closest("label");
    editable = label.control || label.querySelector("input, textarea");
  }
  lastContextMenuTarget = isEditableTextField(editable) ? editable : null;

  const control = target.closest("input, select, textarea");
  contextMenuForm = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    ? control.form
    : target.closest("form");
}, true);
// Reposition both form fill and password visibility toggle widgets on layout changes.
function repositionAllWidgets() {
  positionPasswordToggleWidgets();
  positionFormFillWidgets();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkForSavedForms();
    syncPasswordToggleWidgets();
  }
});
window.addEventListener("scroll", repositionAllWidgets, true);
window.addEventListener("resize", repositionAllWidgets);

let badgeCheckTimer;
const formObserver = new MutationObserver(() => {
  clearTimeout(badgeCheckTimer);
  badgeCheckTimer = setTimeout(() => {
    checkForSavedForms();
    syncPasswordToggleWidgets();
  }, 250);
});
formObserver.observe(document.documentElement, { childList: true, subtree: true });

// Insert text into target editable input or fall back to copying to system clipboard.
// When filling inputs, uses control value setter and dispatches "input"/"change" events for React/Vue compatibility.
function insertOrCopyText(value, sendResponse) {
  const target = lastContextMenuTarget && document.contains(lastContextMenuTarget)
    ? lastContextMenuTarget
    : null;

  if (target && isEditableTextField(target)) {
    if (target.isContentEditable) {
      target.textContent = value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setControlValue(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    target.focus();
    sendResponse({ ok: true, target: "field", value });
  } else {
    copyToClipboard(value)
      .then((copied) => sendResponse({ ok: copied, target: "clipboard", value }))
      .catch(() => sendResponse({ ok: false, target: "clipboard", value }));
    return true;
  }
  return false;
}

// Handle extension messages dispatched from service worker or popup.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FORMSCRIPT_INSERT_DATA") {
    const value = typeof message.text === "string" ? message.text : "";
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_CPF") {
    const value = typeof message.cpf === "string" && message.cpf ? message.cpf : generateFormattedCpf();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_CNPJ") {
    const value = typeof message.cnpj === "string" && message.cnpj ? message.cnpj : generateFormattedCnpj();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_COMPANY_NAME") {
    const value = typeof message.companyName === "string" && message.companyName ? message.companyName : generateRandomCompanyName();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_RG") {
    const value = typeof message.rg === "string" && message.rg ? message.rg : generateFormattedRg();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_ADDRESS") {
    const value = typeof message.address === "string" && message.address ? message.address : generateRandomAddress();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_CEP") {
    const value = typeof message.cep === "string" && message.cep ? message.cep : generateFormattedCep();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_CELLPHONE") {
    const value = typeof message.phone === "string" && message.phone ? message.phone : generateFormattedCellPhone();
    return insertOrCopyText(value, sendResponse);
  }
  if (message?.type === "FORMSCRIPT_INSERT_LANDLINE") {
    const value = typeof message.phone === "string" && message.phone ? message.phone : generateFormattedLandline();
    return insertOrCopyText(value, sendResponse);
  }
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
syncPasswordToggleWidgets();