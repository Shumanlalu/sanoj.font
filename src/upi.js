'use strict';

const QRCode = require('qrcode');

function buildUpiLink({ upiId, payeeName, amount, note }) {
  const params = [
    ['pa', upiId],
    ['pn', payeeName],
    ['am', Number(amount).toFixed(2)],
    ['cu', 'INR'],
    ['tn', note],
  ];

  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `upi://pay?${query}`;
}

async function createUpiQr(link) {
  return QRCode.toDataURL(link, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640,
    color: {
      dark: '#11120f',
      light: '#ffffff',
    },
  });
}

function paymentNote(orderId) {
  const clean = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
  return `SANOJ ${clean}`.slice(0, 35);
}

module.exports = { buildUpiLink, createUpiQr, paymentNote };
