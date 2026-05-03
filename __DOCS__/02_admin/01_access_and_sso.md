# Access and Single Sign-On

← [Back to Admin Guide](index.md)

This platform uses a single login system called **Keycloak**. Once a user has a Keycloak account, they can log in to GitLab, Vault, and the Management API with the same username and password — no separate accounts needed per tool. This is called Single Sign-On (SSO).

---

## How the login flow works

When a user clicks "Sign in with Keycloak" on any of the platform tools, this is what happens behind the scenes:

1. The tool (say, GitLab) redirects the user's browser to the Keycloak login page at `https://auth.devops.yourdomain.com`
2. The user enters their credentials on that page
3. Keycloak verifies the credentials and issues a token (a digitally signed proof of identity)
4. The user's browser is redirected back to GitLab, carrying that token
5. GitLab validates the token against Keycloak and grants access

This flow is the same for all tools that support OIDC (GitLab, Vault, the Management API). Tools that don't have built-in OIDC support — specifically the Traefik dashboard and Kong admin panel — are protected by a proxy called `oauth2-proxy` that intercepts requests and performs the login check before forwarding them.

---

## Managing users

All user accounts are managed in Keycloak. To create, edit, or disable a user:

1. Go to `https://auth.devops.yourdomain.com`
2. Log in with your Keycloak admin credentials (`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `.env`)
3. In the left sidebar, make sure you're in the **devops** realm (not the master realm)
4. Go to **Users** to see existing users, create new ones, or disable accounts

When you create a user in Keycloak, they'll be able to log in to all connected tools (GitLab, Vault, etc.) using that account. However, their access level within each tool may need to be configured separately. For example, in GitLab you'd still need to add them to a group and assign a role.

---

## When SSO breaks

SSO failures are almost always caused by one of three things:

**The client secret doesn't match**

Each service (GitLab, Vault, etc.) has a "client secret" — a shared password that it presents to Keycloak during the login handshake. These secrets are set in `.env` (`KC_CLIENT_SECRET_*`) and must match the values configured in Keycloak.

If they don't match, the login redirect will succeed but the token exchange will fail. You'll typically see an error like "Authentication failed" or an infinite login redirect loop.

To fix: go to Keycloak admin → **Clients** → select the client (e.g., `gitlab`) → **Credentials** tab → regenerate the secret, then update the corresponding value in `.env` and restart the affected service.

**The issuer URL is wrong**

Keycloak publishes its identity under a URL called the "issuer." For this platform, the issuer is always the public HTTPS URL: `https://auth.devops.yourdomain.com/realms/devops`.

Services validate tokens against this URL. If the URL is unreachable, or if it doesn't exactly match what Keycloak reports, authentication fails. This is already configured correctly out of the box, but if you've changed your domain or Keycloak's hostname settings, things can go out of sync.

To check: visit `https://auth.devops.yourdomain.com/realms/devops/.well-known/openid-configuration` in a browser. You should see a JSON document with an `"issuer"` field matching the URL. If you see an error or the wrong URL, check Keycloak's `KC_HOSTNAME` setting.

**Internal routing issue**

The platform's services communicate with each other inside Docker's network, but they still need to reach Keycloak's HTTPS URL to validate tokens. This is handled by routing internal requests through Traefik (which is aliased to all the platform domains inside the Docker network).

If you see errors like "connection refused" or "TLS handshake failed" in service logs after login, this is likely the cause. Check that Traefik is running and healthy.

---

## Tools that don't use SSO directly

The Traefik dashboard (`https://traefik.devops.yourdomain.com`) and Kong admin panel (`https://gw-admin.devops.yourdomain.com`) don't have built-in OIDC support. They're protected by `oauth2-proxy`, which sits in front of them and enforces Keycloak login before allowing access. By default only users in the Keycloak **`admins`** group (JWT `groups` claim) may use those panels; configure **`OAUTH2_PROXY_ALLOWED_GROUPS`** in `.env` to change or widen that list (see [Environment variables](../01_infra/02_env.md#oauth2-proxy-allowed-groups)).

To restrict those panels to **specific Keycloak groups**, or to learn **how to extend** the stack with additional oauth2-proxy instances for different policies (examples in that guide use labels such as internal vs external), see [Adding tiered OIDC with oauth2-proxy](08_oauth2_proxy_tiers_and_forwardauth.md).

If you can't access these panels even after a successful Keycloak login, check that the `oauth2-proxy` service is running:

```bash
docker compose ps oauth2-proxy
docker compose logs -f oauth2-proxy
```
