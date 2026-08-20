// Anonymous session identity — created once per browser, persisted in
// localStorage. This token is the only thing that links a payment back to
// "you" with no sign-in step.

const SESSION_KEY = 'projectwall_session_token';

export function getSessionToken() {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}
