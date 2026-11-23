// Local Identity fixture for browser tests. The SDK talks to the same-origin
// /.netlify/identity paths; Playwright answers those and the app's session route
// so no live Netlify site, HTTPS Deploy Preview or credential is involved.
const DEFAULT_USER = {
  id: "identity-user-1",
  email: "reader@example.com",
  emailVerified: true,
  name: "Fixture Reader",
  image: null,
};

export function sessionBody(signedIn = true, userId = DEFAULT_USER.id) {
  const user = { ...DEFAULT_USER, id: userId };
  return {
    session: signedIn ? { id: user.id } : null,
    user: signedIn ? user : null,
  };
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 3_600,
  })).toString("base64url");
  return `fixture.${payload}.signature`;
}

export async function installIdentityFixture(context, { signedIn = false, userId = DEFAULT_USER.id } = {}) {
  const user = { ...DEFAULT_USER, id: userId };
  let authenticated = signedIn;
  const apiUser = {
    id: user.id,
    email: user.email,
    confirmed_at: "2026-01-01T00:00:00.000Z",
    user_metadata: { full_name: user.name },
    app_metadata: { provider: "email" },
  };

  await context.route("**/.netlify/identity/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (action === "token") authenticated = true;
    if (action === "logout") authenticated = false;
    const body = action === "token"
      ? { access_token: tokenFor(user), refresh_token: "fixture-refresh", expires_in: 3_600, token_type: "bearer", ...apiUser }
      : action === "user" ? apiUser : { ok: true };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await context.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionBody(authenticated, user.id)),
    });
  });
  await context.route("**/api/auth/sign-out", async (route) => {
    authenticated = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
}
