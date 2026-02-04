// utils/servicePdfExporter.js
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

// Basic HTML escaping so notes, titles, etc. don't break the PDF
const escapeHtml = (str = '') =>
  String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));

const digitsOnly = (s) => String(s ?? '').replace(/[^\d]/g, '');

const formatThousands = (numStr) =>
  digitsOnly(numStr).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // ← fixed regex

const formatDateDisplay = (d) => {
  try {
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    if (!dateObj || isNaN(dateObj.getTime())) return 'N/A';
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return 'N/A';
  }
};

const getMimeFromUri = (uri = '') => {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
};

/**
 * Export selected services to a multi-page PDF.
 * Each service:
 *  - 1 summary page
 *  - 1 page per attached proof image (full-page image)
 */
export async function exportServicesToPdf({ services, vehicleLabel }) {
  try {
    if (!services || services.length === 0) {
      Alert.alert('No Services', 'There are no services to export yet.');
      return;
    }

    // Only export services that actually have tracking info or proofs
    const tracking = services.filter(
      (svc) =>
        svc.applies &&
        (svc.completedMileageNumber != null ||
          svc.completedMileage ||
          svc.lastCompletedDate ||
          (svc.proofUris && svc.proofUris.length > 0))
    );

    if (tracking.length === 0) {
      Alert.alert(
        'Nothing to Export',
        'Only services that have started tracking or have proof images are exported.'
      );
      return;
    }

    const pages = [];

    for (const svc of tracking) {
      const title = escapeHtml(svc.text || 'Service');
      const notes = escapeHtml(svc.notes || 'N/A');

      const completedMileage =
        svc.completedMileage ||
        (svc.completedMileageNumber != null
          ? formatThousands(String(svc.completedMileageNumber))
          : '');

      const completedMileageDisplay = completedMileage || 'N/A';
      const completedDateDisplay =
        svc.date ||
        (svc.lastCompletedDate
          ? formatDateDisplay(svc.lastCompletedDate)
          : 'N/A');

      const dueMilesDisplay =
        svc.dueDisplay && svc.dueDisplay !== '—' ? svc.dueDisplay : 'N/A';

      const dueDateDisplay = svc.dueDateIso
        ? formatDateDisplay(svc.dueDateIso)
        : 'N/A';

      const intervalMilesDisplay = svc.intervalMiles
        ? `${formatThousands(String(svc.intervalMiles))} miles`
        : 'N/A';

      const intervalMonthsDisplay = svc.intervalMonths
        ? `${svc.intervalMonths} months`
        : 'N/A';

      // 1️⃣ Summary page for this service
      pages.push(`
        <div class="page">
          <div class="header">
            <div class="app-title">Torque the Mechanic — Service Record</div>
            <div class="vehicle">${escapeHtml(vehicleLabel || 'Vehicle')}</div>
          </div>

          <div class="service-title">${title}</div>

          <div class="section">
            <div class="section-title">Intervals</div>
            <div class="row">
              <div class="label">Mileage Interval</div>
              <div class="value">${escapeHtml(intervalMilesDisplay)}</div>
            </div>
            <div class="row">
              <div class="label">Time Interval</div>
              <div class="value">${escapeHtml(intervalMonthsDisplay)}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Next Due</div>
            <div class="row">
              <div class="label">Due Mileage</div>
              <div class="value">${escapeHtml(dueMilesDisplay)}</div>
            </div>
            <div class="row">
              <div class="label">Due Date</div>
              <div class="value">${escapeHtml(dueDateDisplay)}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Last Completion</div>
            <div class="row">
              <div class="label">Completed Mileage</div>
              <div class="value">${escapeHtml(completedMileageDisplay)}</div>
            </div>
            <div class="row">
              <div class="label">Completed Date</div>
              <div class="value">${escapeHtml(completedDateDisplay)}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Notes</div>
            <div class="notes">
              ${notes.replace(/\n/g, '<br />')}
            </div>
          </div>
        </div>
      `);

      // 2️⃣ One full-page image for each proof
      if (Array.isArray(svc.proofUris) && svc.proofUris.length) {
        for (const uri of svc.proofUris) {
          try {
            const base64 = await FileSystem.readAsStringAsync(uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const mime = getMimeFromUri(uri);
            pages.push(`
              <div class="page">
                <div class="header small">
                  <div class="app-title">Torque the Mechanic — Service Proof</div>
                  <div class="vehicle">${escapeHtml(vehicleLabel || 'Vehicle')}</div>
                </div>
                <div class="image-wrap">
                  <img src="data:${mime};base64,${base64}" />
                </div>
              </div>
            `);
          } catch (err) {
            console.warn('Failed to read proof image for PDF:', err);
          }
        }
      }
    }

    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            @page {
              size: A4 portrait;
              margin: 15mm;
            }

            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
            }
            body {
              margin: 0;
              padding: 0;
              background: #111827;
              color: #f9fafb;
            }
            .page {
              width: 100%;
              height: 100vh;
              padding: 16px 18px;
              background: #020617;
              page-break-after: always;
              display: flex;
              flex-direction: column;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              margin-bottom: 12px;
              border-bottom: 2px solid #1f2937;
              padding-bottom: 6px;
            }
            .header.small {
              margin-bottom: 8px;
            }
            .app-title {
              font-size: 16px;
              font-weight: 800;
              color: #22c55e;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .vehicle {
              font-size: 13px;
              font-weight: 600;
              color: #9ca3af;
              text-align: right;
            }
            .service-title {
              font-size: 22px;
              font-weight: 900;
              color: #f9fafb;
              margin-bottom: 14px;
            }
            .section {
              border-radius: 14px;
              border: 1px solid #1f2937;
              background: #020617;
              padding: 12px 14px;
              margin-bottom: 10px;
            }
            .section-title {
              font-size: 13px;
              font-weight: 800;
              letter-spacing: 0.12em;
              text-transform: uppercase;
              color: #9ca3af;
              margin-bottom: 4px;
            }
            .row {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              padding: 3px 0;
            }
            .label {
              font-size: 13px;
              color: #d1d5db;
              font-weight: 600;
            }
            .value {
              font-size: 14px;
              color: #f9fafb;
              font-weight: 800;
              text-align: right;
              padding-left: 16px;
              max-width: 60%;
              word-wrap: break-word;
            }
            .notes {
              font-size: 13px;
              color: #e5e7eb;
              line-height: 1.5;
              white-space: pre-wrap;
            }
            .image-wrap {
              flex: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              padding-top: 6px;
              padding-bottom: 6px;
              page-break-inside: avoid;
            }
            .image-wrap img {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body>
          ${pages.join('\n')}
        </body>
      </html>
    `;

    const { uri } = await Print.printToFileAsync({ html });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share or Print Service PDF',
      });
    } else {
      Alert.alert('Export Complete', 'PDF has been generated.');
    }
  } catch (err) {
    console.warn('Error exporting services PDF:', err);
    Alert.alert('Export Failed', String(err?.message || err));
  }
}
