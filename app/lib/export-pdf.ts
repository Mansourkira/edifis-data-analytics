import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/** Wait after data + charts paint so layout and Recharts animations settle before capture. */
export const PDF_EXPORT_DOM_STABILIZE_MS = 500;

export async function waitForPdfDomStable(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, PDF_EXPORT_DOM_STABILIZE_MS));
}

/**
 * Tailwind v4 emits `lab()` / `oklch()` / `color-mix()` in CSS. html2canvas cannot parse those.
 * We strip cloned stylesheets and inline computed styles so the snapshot uses resolved colors.
 */
function stripClonedStylesheets(doc: Document): void {
  doc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    node.parentNode?.removeChild(node);
  });
}

/** Any payload html2canvas' color parser cannot handle (incl. browser-serialized `lab()` on getComputedStyle). */
function containsUnsupportedColorSyntax(value: string): boolean {
  return /(?:lab|oklab|oklch|lch|color-mix)\s*\(/i.test(value);
}

/**
 * Collapse modern color spaces to rgb/hex so html2canvas never sees `lab()` / `oklch()`.
 */
function forceHtml2CanvasSafeColor(value: string, probe: CanvasRenderingContext2D): string {
  if (!containsUnsupportedColorSyntax(value)) return value;

  try {
    probe.fillStyle = "#000000";
    probe.fillStyle = value;
    const fromCanvas = String(probe.fillStyle);
    if (!containsUnsupportedColorSyntax(fromCanvas)) return fromCanvas;
  } catch {
    /* continue */
  }

  const probeEl = document.createElement("div");
  probeEl.setAttribute("style", "position:fixed;left:-9999px;top:0;visibility:hidden");
  document.body.appendChild(probeEl);
  try {
    probeEl.style.color = value;
    const fromComputed = getComputedStyle(probeEl).color;
    if (!containsUnsupportedColorSyntax(fromComputed)) return fromComputed;
  } catch {
    /* continue */
  } finally {
    probeEl.remove();
  }

  return "#808080";
}

function resolveColor(cssColor: string, probe: CanvasRenderingContext2D): string {
  const t = cssColor.trim();
  if (!t || t === "transparent" || t === "none") return cssColor;
  return forceHtml2CanvasSafeColor(t, probe);
}

function resolveCSSValue(
  prop: string,
  val: string,
  probe: CanvasRenderingContext2D,
): string {
  if (prop === "box-shadow" || prop === "text-shadow") {
    const div = document.createElement("div");
    div.setAttribute("style", "position:absolute;left:-9999px;visibility:hidden");
    document.body.appendChild(div);
    try {
      div.style.setProperty(prop, val);
      let resolved = getComputedStyle(div).getPropertyValue(prop);
      resolved = forceHtml2CanvasSafeColor(resolved, probe);
      return containsUnsupportedColorSyntax(resolved) ? "none" : resolved;
    } catch {
      return "none";
    } finally {
      div.remove();
    }
  }
  return resolveColor(val, probe);
}

function inlineComputedStyles(
  orig: Element,
  clone: Element,
  probe: CanvasRenderingContext2D,
): void {
  const style = (clone as HTMLElement | SVGElement).style;
  if (!style) return;

  const cs = window.getComputedStyle(orig);
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    try {
      let val = cs.getPropertyValue(prop);
      if (containsUnsupportedColorSyntax(val)) {
        try {
          val = resolveCSSValue(prop, val, probe);
        } catch {
          val = forceHtml2CanvasSafeColor(val, probe);
        }
      }
      if (containsUnsupportedColorSyntax(val)) {
        val = forceHtml2CanvasSafeColor(val, probe);
      }
      style.setProperty(prop, val, cs.getPropertyPriority(prop));
    } catch {
      /* Skip one broken declaration so the rest of the export still runs */
    }
  }
}

function preparePdfCloneSubtree(
  originalCaptureRoot: HTMLElement,
  clonedCaptureRoot: HTMLElement,
): void {
  const probeCanvas = document.createElement("canvas");
  const probe = probeCanvas.getContext("2d");
  if (!probe) return;

  const processed = new WeakSet<Element>();

  const processPair = (orig: Element, clone: Element) => {
    if (processed.has(orig)) return;
    processed.add(orig);
    try {
      inlineComputedStyles(orig, clone, probe);
    } catch {
      /* Continue with sibling nodes */
    }
  };

  let o: Element | null = originalCaptureRoot;
  let c: Element | null = clonedCaptureRoot;
  while (o && c) {
    processPair(o, c);
    o = o.parentElement;
    c = c.parentElement;
  }

  const walk = (orig: Element, clone: Element) => {
    const n = Math.min(orig.children.length, clone.children.length);
    for (let i = 0; i < n; i++) {
      const oc = orig.children[i];
      const cc = clone.children[i];
      processPair(oc, cc);
      walk(oc, cc);
    }
  };
  walk(originalCaptureRoot, clonedCaptureRoot);
}

/** Prevent scroll/max-height clipping in the iframe clone so tables/charts aren't cropped. */
function unwrapScrollClippingInClone(clonedCaptureRoot: HTMLElement): void {
  let node: HTMLElement | null = clonedCaptureRoot;
  while (node) {
    try {
      node.style.height = "auto";
      node.style.maxHeight = "none";
      node.style.minHeight = "0";
      node.style.overflow = "visible";
    } catch {
      /* ignore */
    }
    node = node.parentElement;
  }

  const doc = clonedCaptureRoot.ownerDocument;
  try {
    if (doc.documentElement) {
      doc.documentElement.style.height = "auto";
      doc.documentElement.style.overflow = "visible";
      doc.documentElement.style.backgroundColor = "#ffffff";
      doc.documentElement.style.color = "#171717";
    }
    if (doc.body) {
      doc.body.style.height = "auto";
      doc.body.style.overflow = "visible";
      doc.body.style.backgroundColor = "#ffffff";
      doc.body.style.color = "#171717";
    }
  } catch {
    /* ignore */
  }
}

function addCanvasRasterPaginated(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  marginMm: number,
  contentWidthMm: number,
  contentHeightMm: number,
): void {
  const imgWidthMm = contentWidthMm;
  const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;

  if (imgHeightMm <= contentHeightMm + 0.001) {
    pdf.addImage(canvas.toDataURL("image/png", 1.0), "PNG", marginMm, marginMm, imgWidthMm, imgHeightMm);
    return;
  }

  const pxPerMm = canvas.height / imgHeightMm;
  let sourceY = 0;
  let pageIndex = 0;

  while (sourceY < canvas.height) {
    const remainingPx = canvas.height - sourceY;
    const targetPx = Math.min(remainingPx, Math.round(contentHeightMm * pxPerMm));
    const slicePx = Math.max(1, targetPx);

    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = slicePx;
    const ctx = slice.getContext("2d");
    if (!ctx) break;

    ctx.drawImage(canvas, 0, sourceY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);

    const sliceHeightMm = (slicePx / canvas.height) * imgHeightMm;

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/png", 1.0), "PNG", marginMm, marginMm, imgWidthMm, sliceHeightMm);

    sourceY += slicePx;
    pageIndex += 1;

    if (slicePx >= remainingPx) break;
  }
}

/**
 * Renders a DOM subtree to a multi-page A4 PDF (tables + SVG/canvas charts).
 * Elements matching `[data-pdf-ignore]` are omitted from the capture (e.g. export buttons).
 *
 * Intended for Next.js App Router client components — only call from the browser after paint.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const sw = Math.max(1, element.scrollWidth);
  const sh = Math.max(1, element.scrollHeight);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: sw,
    windowHeight: sh,
    width: sw,
    height: sh,
    ignoreElements: (node) =>
      node instanceof Element && node.closest("[data-pdf-ignore]") !== null,
    onclone: (documentClone, clonedReferenceElement) => {
      stripClonedStylesheets(documentClone);
      preparePdfCloneSubtree(element, clonedReferenceElement as HTMLElement);
      unwrapScrollClippingInClone(clonedReferenceElement as HTMLElement);
    },
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - 2 * margin;
  const contentHeight = pageHeight - 2 * margin;

  addCanvasRasterPaginated(pdf, canvas, margin, contentWidth, contentHeight);

  const safeName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  pdf.save(safeName);
}
