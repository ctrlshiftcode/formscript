const fillButton = document.getElementById("fill-form");
const optionsButton = document.getElementById("open-options");
const statusText = document.getElementById("status");

fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  statusText.textContent = "Procurando um formulario salvo...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("Aba indisponivel");

    const result = await chrome.tabs.sendMessage(tab.id, { type: "FORMSCRIPT_FILL_ACTIVE_FORM" });
    if (result?.status === "filled") {
      statusText.textContent = `${result.count} campos preenchidos.`;
    } else if (result?.status === "not-found") {
      statusText.textContent = "Nenhum formulario salvo corresponde a esta pagina.";
    } else if (result?.status === "no-fields") {
      statusText.textContent = "Nenhum campo compativel encontrado nesta pagina.";
    } else {
      statusText.textContent = "Nao foi possivel preencher este formulario.";
    }
  } catch {
    statusText.textContent = "Esta pagina nao permite o preenchimento da extensao.";
  } finally {
    fillButton.disabled = false;
  }
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());