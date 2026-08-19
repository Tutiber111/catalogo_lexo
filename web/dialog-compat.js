(() => {
  const FALLBACK_ATTRIBUTE = "data-dialog-fallback-open";

  function hasNativeDialog(dialog) {
    return typeof dialog?.showModal === "function" && typeof dialog?.close === "function";
  }

  function isOpen(dialog) {
    return Boolean(dialog?.hasAttribute("open"));
  }

  function syncFallbackState() {
    document.body.classList.toggle(
      "dialog-fallback-active",
      Boolean(document.querySelector(`dialog[${FALLBACK_ATTRIBUTE}]`)),
    );
  }

  function open(dialog) {
    if (!dialog || isOpen(dialog)) return;
    if (hasNativeDialog(dialog)) {
      dialog.showModal();
      return;
    }

    const fallbackDialogs = document.querySelectorAll(`dialog[${FALLBACK_ATTRIBUTE}]`).length;
    dialog.setAttribute("open", "");
    dialog.setAttribute(FALLBACK_ATTRIBUTE, "");
    dialog.style.setProperty("--dialog-fallback-z", String(81 + fallbackDialogs));
    syncFallbackState();
    requestAnimationFrame(() => dialog.querySelector("button, input, select, textarea")?.focus());
  }

  function close(dialog, returnValue = "cancel") {
    if (!dialog || !isOpen(dialog)) return;
    if (hasNativeDialog(dialog)) {
      dialog.close(returnValue);
      return;
    }

    dialog.removeAttribute("open");
    dialog.removeAttribute(FALLBACK_ATTRIBUTE);
    dialog.style.removeProperty("--dialog-fallback-z");
    syncFallbackState();
    dialog.dispatchEvent(new Event("close"));
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-dialog-close]");
    if (!button) return;
    const dialog = button.closest("dialog");
    if (!dialog) return;
    event.preventDefault();
    close(dialog);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const dialogs = [...document.querySelectorAll(`dialog[${FALLBACK_ATTRIBUTE}]`)];
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    event.preventDefault();
    close(dialog);
  });

  window.CATALOG_DIALOG = { open, close, isOpen };
})();
