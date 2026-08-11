import { toPng } from 'html-to-image';

export async function downloadScreenshot(pageName: string): Promise<void> {
  const element =
    document.getElementById('apex-main-content') ||
    document.querySelector('main') ||
    document.body;

  const timestamp = new Date()
    .toISOString()
    .replace('T', '-')
    .replace(/:/g, '')
    .slice(0, 15);

  const filename = `apex-${pageName.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.png`;

  const bgColor =
    getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#f8fafc';

  const dataUrl = await toPng(element, {
    quality: 0.95,
    pixelRatio: 2,
    backgroundColor: bgColor,
    filter: (node) => {
      if (node instanceof HTMLElement) {
        if (node.getAttribute('data-radix-popper-content-wrapper')) return false;
        if (node.classList.contains('toast-container')) return false;
        if (node.classList.contains('Toaster')) return false;
      }
      return true;
    },
  });

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
