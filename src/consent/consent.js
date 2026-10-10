const parameters = new URLSearchParams(location.search);
const consentId = parameters.get("id") || "";
const site = parameters.get("site") || "este site";
const fieldCount = Number(parameters.get("count")) || 0;
const isUpdate = parameters.get("mode") === "update";
const confirmButton = document.getElementById("confirm");
const title = document.getElementById("consent-title");
const details = document.getElementById("consent-details");
const statusText = document.getElementById("status");

title.textContent = isUpdate ? "Atualizar os dados salvos deste formulario?" : "Salvar os dados deste formulario?";
details.textContent = isUpdate
  ? `${site} enviou novos valores para ${fieldCount} campos compativeis. OK substitui os dados anteriores; Esc mantem o registro atual.`
  : `${site} enviou um formulario com ${fieldCount} campos compativeis. Os dados ficam somente neste navegador.`;

async function decide(decision) {
  confirmButton.disabled = true;
  statusText.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FORMSCRIPT_CONSENT_DECISION",
      consentId,
      decision
    });
    if (!response?.ok) throw new Error("Esta confirmacao expirou. Envie o formulario novamente.");
    window.close();
  } catch (error) {
    statusText.textContent = error.message || "Nao foi possivel salvar a escolha.";
    confirmButton.disabled = false;
  }
}

confirmButton.addEventListener("click", () => void decide("save"));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void decide("discard");
  }
});

if (!/^formscript-[a-f0-9]+$/.test(consentId)) {
  confirmButton.disabled = true;
  statusText.textContent = "Confirmacao invalida.";
}