// utils/imageUpload.js
import * as ImageManipulator from 'expo-image-manipulator';

// Returns { base64, dataUrl, bytesApprox }
export async function compressForUpload(uri, opts = {}) {
  const {
    targetWidth = 900,
    compress = 0.55,
    format = ImageManipulator.SaveFormat.JPEG,
  } = opts;

  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: targetWidth } }],
    { compress, format, base64: true }
  );

  const base64 = out.base64 || '';
  const bytesApprox = Math.floor((base64.length * 3) / 4); // approx decoded bytes
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  return { base64, dataUrl, bytesApprox };
}
