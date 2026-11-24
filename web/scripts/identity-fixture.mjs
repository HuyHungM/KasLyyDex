// Local session fixture for browser tests. Playwright answers the auth routes
// with the same response shapes as the Worker, so no live provider or credential
// is involved.
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

export async function installIdentityFixture(context, { signedIn = false, userId = DEFAULT_USER.id } = {}) {
  const user = { ...DEFAULT_USER, id: userId };
  let authenticated = signedIn;

  await context.route("**/api/auth/config", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"googleClientId":null}' });
  });
  await context.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionBody(authenticated, user.id)),
    });
  });
  for (const action of ["sign-in", "sign-up"]) {
    await context.route(`**/api/auth/${action}`, async (route) => {
      authenticated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionBody(true, user.id)),
      });
    });
  }
  await context.route("**/api/auth/sign-out", async (route) => {
    authenticated = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
}
