// api/authedFetch.js
import { getIdToken, clearTokens } from './auth';

export async function authedFetch(url, options = {}) {
  const token = await getIdToken();

  if (!token) {
    // You can handle this however you want (redirect to login, show modal, etc.)
    throw new Error('Not logged in (missing token). Please log in again.');
  }

  const resp = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  // If your authorizer rejects the token, force logout-ish behavior
  if (resp.status === 401 || resp.status === 403) {
    await clearTokens();
  }

  return resp;
}
