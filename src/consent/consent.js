const parameters = new URLSearchParams(location.search);
const consentId = parameters.get("id") || "";
const site = parameters.get("site") || "this site";
const isUpdate = parameters.get("mode") === "update";
const confirmButton = document.getElementById("confirm");
const cancelButton = document.getElementById("cancel");
const statusText = document.getElementById("status");

document.title = isUpdate
  ? `Update saved form data for ${site}?`
  : `Save form data for ${site}?`;

// Keep the existing record unchanged when the user cancels or presses Escape.
async function decide(decision) {
  confirmButton.disabled = true;
  cancelButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FORMSCRIPT_CONSENT_DECISION",
      consentId,
      decision
    });
    if (!response?.ok) throw new Error("This confirmation expired. Submit the form again.");
    window.close();
  } catch (error) {
    const errorMessage = error.message || "Could not save your choice.";
    document.title = errorMessage;
    statusText.textContent = errorMessage;
    confirmButton.disabled = false;
    cancelButton.disabled = false;
  }
}

confirmButton.addEventListener("click", () => void decide("save"));
cancelButton.addEventListener("click", () => void decide("discard"));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void decide("discard");
  }
});

if (!/^formscript-[a-f0-9]+$/.test(consentId)) {
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  document.title = "Invalid confirmation";
}