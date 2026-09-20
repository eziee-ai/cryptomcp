// The only script on this site, and only /submit loads it. It copies the agent prompt to the clipboard.
// It reads text from the page and writes it to the clipboard. It loads nothing and sends nothing.
(() => {
  const button = document.querySelector("button[data-copy-target]");
  const source = button && document.getElementById(button.dataset.copyTarget);
  if (!button || !source || !navigator.clipboard) return;

  const label = button.querySelector("[data-copy-label]");
  const status = document.getElementById("copy-status");
  const idle = label.textContent;
  let timer;

  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.textContent);
      label.textContent = "Copied";
      status.textContent = "Copied. Now paste it into your coding agent.";
    } catch {
      status.textContent = "Could not copy. Open the prompt below and copy it by hand.";
    }
    clearTimeout(timer);
    timer = setTimeout(() => { label.textContent = idle; }, 2500);
  });
})();
