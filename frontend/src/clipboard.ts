/**
 * Copies text to the clipboard. Returns false only if every way failed.
 *
 * `navigator.clipboard` exists only in a secure context (https or localhost), and Bastion usually runs on
 * plain http in a home network, so without it the text goes through a hidden textarea and `execCommand`.
 * Call it straight from a click handler: the fallback needs the user's gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // denied, or the page lost focus: try the old way
    }
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];

  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true; // no on-screen keyboard on phones
  area.tabIndex = -1;
  area.setAttribute("aria-hidden", "true");
  // fixed and off-screen, so focusing it does not scroll the page; 16px keeps iOS from zooming in
  Object.assign(area.style, { position: "fixed", top: "0", left: "-9999px", fontSize: "16px", opacity: "0" });
  document.body.appendChild(area);

  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select()
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    focused?.focus({ preventScroll: true });
  }
}
