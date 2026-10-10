const parameters = new URLSearchParams(location.search);
const consentId = parameters.get("id") || "";
const isUpdate = parameters.get("mode") === "update";
const countdownStart = 10;
const countdownLabel = document.getElementById("countdown");
const confirmButton = document.getElementById("confirm");
const cancelButton = document.getElementById("cancel");
let secondsRemaining = countdownStart;
let decisionSent = false;
let countdownTimer;

function updateTitle() {
  document.title = isUpdate ? "Update form?" : "Save form?";
  countdownLabel.textContent = `${secondsRemaining}s`;
}

async function decide(decision) {
  if (decisionSent) return;
  decisionSent = true;
  clearInterval(countdownTimer);
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
    if (decision === "discard") {
      window.close();
      return;
    }

    decisionSent = false;
    document.title = error.message || "Could not save this form";
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
  document.title = "Invalid confirmation";
  window.close();
} else {
  updateTitle();
  countdownTimer = setInterval(() => {
    secondsRemaining -= 1;
    if (secondsRemaining <= 0) {
      void decide("discard");
      return;
    }
    updateTitle();
  }, 1000);
}