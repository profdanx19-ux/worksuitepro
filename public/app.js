const form = document.querySelector("#invoice-form");
const status = document.querySelector("#form-status");
const button = form.querySelector("button");
const plan = document.querySelector("#plan");

document.querySelectorAll("[data-plan]").forEach((link) => {
  link.addEventListener("click", () => {
    plan.value = link.dataset.plan;
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  status.className = "status";
  button.disabled = true;

  const email = String(new FormData(form).get("email") || "").trim();

  try {
    const response = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, plan: plan.value }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not send the request.");
    }

    status.textContent = data.message;
    status.classList.add("ok");
    form.reset();
  } catch (error) {
    status.textContent = error.message || "Could not send the request.";
    status.classList.add("err");
  } finally {
    button.disabled = false;
  }
});
