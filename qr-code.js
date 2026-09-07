import qrcode from 'qrcode-generator';

// Generate invitation QR images locally so the private token never leaves the browser.
window.BedehQr = Object.freeze({
  dataUrl(value) {
    const code = qrcode(0, 'M');
    code.addData(String(value));
    code.make();
    return code.createDataURL(7, 12);
  },
});
