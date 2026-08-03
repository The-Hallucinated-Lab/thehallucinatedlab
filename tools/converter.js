/* ============================================================
   tools/converter.js — Shared image conversion engine.
   Used by:
     - tools/converter.html (the standalone tool page)
     - interface.html             (assistant, on-demand)
   ============================================================ */

(function () {
  'use strict';

  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

  function normalize(fmt) {
    fmt = (fmt || '').toLowerCase();
    if (fmt === 'jpeg') return 'jpg';
    return fmt;
  }

  /**
   * Convert an image File/Blob to a target format using Canvas.
   * @param {File|Blob} file   Source image
   * @param {string}    format One of "png" | "jpg" | "webp"
   * @param {number}    [quality=0.9] 0–1 (ignored for png)
   * @returns {Promise<{blob: Blob, width: number, height: number, format: string}>}
   */
  function convert(file, format, quality) {
    format = normalize(format);
    if (!MIME[format]) return Promise.reject(new Error(`Unsupported format: ${format}`));

    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        img.onerror = () => reject(new Error('That image format could not be decoded by your browser.'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          // JPG has no alpha channel — composite on white so transparency
          // doesn't render as solid black.
          if (format === 'jpg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0);
          const q = format === 'png' ? undefined : (quality ?? 0.9);
          canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Browser failed to encode the output.'));
            resolve({ blob, width: canvas.width, height: canvas.height, format });
          }, MIME[format], q);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.HallucinatedLab = window.HallucinatedLab || {};
  window.HallucinatedLab.converter = { convert, normalize, MIME };
})();
