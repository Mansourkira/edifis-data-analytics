import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Renders a DOM subtree to a multi-page A4 PDF (tables + SVG/canvas charts).
 * Elements matching `[data-pdf-ignore]` are omitted from the capture (e.g. export buttons).
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  await new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
  });
  await new Promise((r) => setTimeout(r, 120));

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
    ignoreElements: (node) => {
      if (!(node instanceof HTMLElement)) return false;
      return Boolean(node.closest("[data-pdf-ignore]"));
    },
  });

  const imgData = canvas.toDataURL("image/png", 1.0);
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

  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
  heightLeft -= contentHeight;

  while (heightLeft > 0) {
    pdf.addPage();
    position = margin - (imgHeight - heightLeft);
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= contentHeight;
  }

  const safeName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  pdf.save(safeName);
}
