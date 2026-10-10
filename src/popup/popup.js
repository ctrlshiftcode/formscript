const fillButton = document.getElementById("fill-form");
const optionsButton = document.getElementById("open-options");
const statusText = document.getElementById("status");

fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  statusText.textContent = "Looking for a saved form...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("No active tab available");

    const result = await chrome.tabs.sendMessage(tab.id, { type: "FORMSCRIPT_FILL_ACTIVE_FORM" });
    if (result?.status === "filled") {
      statusText.textContent = `${result.count} fields filled.`;
    } else if (result?.status === "not-found") {
      statusText.textContent = "No saved form matches this page.";
    } else if (result?.status === "no-fields") {
      statusText.textContent = "No supported fields found on this page.";
    } else {
      statusText.textContent = "Could not fill this form.";
    }
  } catch {
    statusText.textContent = "This page does not allow extension form filling.";
  } finally {
    fillButton.disabled = false;
  }
});

// Open extension settings only after the user selects the settings action.
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());