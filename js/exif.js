/* LeakLens – hidden photo data (EXIF) reader.
   Reads GPS location, date/time and phone make/model from a JPEG file.
   Runs entirely in the browser; nothing is uploaded. */
(function (root) {
  'use strict';

  const TAGS = {
    0x010F: 'Make', 0x0110: 'Model', 0x0132: 'DateTime', 0x0131: 'Software',
    0x8769: 'ExifIFD', 0x8825: 'GPSIFD',
    0x9003: 'DateTimeOriginal', 0xA430: 'CameraOwnerName', 0xA431: 'BodySerialNumber',
  };
  const GPS_TAGS = { 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 6: 'GPSAltitude' };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function readValue(view, entryOffset, tiffStart, little) {
    const type = view.getUint16(entryOffset + 2, little);
    const count = view.getUint32(entryOffset + 4, little);
    const size = (TYPE_SIZE[type] || 1) * count;
    const valueOffset = size > 4 ? tiffStart + view.getUint32(entryOffset + 8, little) : entryOffset + 8;
    if (valueOffset + size > view.byteLength) return null;
    switch (type) {
      case 2: { // ASCII
        let s = '';
        for (let i = 0; i < count; i++) {
          const c = view.getUint8(valueOffset + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 3: return count === 1 ? view.getUint16(valueOffset, little)
        : Array.from({ length: count }, (_, i) => view.getUint16(valueOffset + 2 * i, little));
      case 4: return count === 1 ? view.getUint32(valueOffset, little)
        : Array.from({ length: count }, (_, i) => view.getUint32(valueOffset + 4 * i, little));
      case 5: case 10: {
        const signed = type === 10;
        const out = [];
        for (let i = 0; i < count; i++) {
          const n = signed ? view.getInt32(valueOffset + 8 * i, little) : view.getUint32(valueOffset + 8 * i, little);
          const d = signed ? view.getInt32(valueOffset + 8 * i + 4, little) : view.getUint32(valueOffset + 8 * i + 4, little);
          out.push(d === 0 ? 0 : n / d);
        }
        return count === 1 ? out[0] : out;
      }
      default: return null;
    }
  }

  function readIFD(view, ifdOffset, tiffStart, little, dict) {
    const out = {};
    if (ifdOffset + 2 > view.byteLength) return out;
    const entries = view.getUint16(ifdOffset, little);
    for (let i = 0; i < entries; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      const tag = view.getUint16(e, little);
      const name = dict[tag];
      if (!name) continue;
      out[name] = (name === 'ExifIFD' || name === 'GPSIFD')
        ? view.getUint32(e + 8, little)
        : readValue(view, e, tiffStart, little);
    }
    return out;
  }

  function toDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    let v = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') v = -v;
    return Math.round(v * 1e6) / 1e6;
  }

  /** Parse EXIF from an ArrayBuffer. Returns {} when there is none or the data is damaged. */
  function parseExif(buffer) {
    try { return parseExifUnsafe(buffer); } catch (e) { return {}; }
  }

  function parseExifUnsafe(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return {}; // not a JPEG
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) return {};
      const marker = view.getUint8(offset + 1);
      const length = view.getUint16(offset + 2);
      if (marker === 0xE1 && view.getUint32(offset + 4) === 0x45786966) { // "Exif"
        const tiff = offset + 10;
        if (tiff + 8 > view.byteLength) return {};
        const little = view.getUint16(tiff) === 0x4949;
        const ifd0 = readIFD(view, tiff + view.getUint32(tiff + 4, little), tiff, little, TAGS);
        const result = {};
        ['Make', 'Model', 'DateTime', 'Software'].forEach(k => { if (ifd0[k]) result[k] = ifd0[k]; });
        if (ifd0.ExifIFD) {
          const ex = readIFD(view, tiff + ifd0.ExifIFD, tiff, little, TAGS);
          ['DateTimeOriginal', 'CameraOwnerName', 'BodySerialNumber'].forEach(k => { if (ex[k]) result[k] = ex[k]; });
        }
        if (ifd0.GPSIFD) {
          const g = readIFD(view, tiff + ifd0.GPSIFD, tiff, little, GPS_TAGS);
          const lat = toDecimal(g.GPSLatitude, g.GPSLatitudeRef);
          const lon = toDecimal(g.GPSLongitude, g.GPSLongitudeRef);
          if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) result.gps = { lat, lon };
        }
        return result;
      }
      if (marker === 0xDA) break; // start of image data – no EXIF after this
      offset += 2 + length;
    }
    return {};
  }

  const api = { parseExif, toDecimal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LL = root.LL || {};
  root.LL.exif = api;
})(typeof window !== 'undefined' ? window : globalThis);
