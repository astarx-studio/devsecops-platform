# SonarQube SSO and groups

← [Back to Admin Guide](index.md)

SonarQube uses **SAML** with Keycloak (Community Build) for interactive login. Traefik terminates TLS only; there is no oauth2-proxy in front of Sonar.

## Keycloak (no separate init service)

**Clean install:** `keycloak/realm-export.json` on first Keycloak start includes:

- SAML client `sonarqube` (`${SONARQUBE_DOMAIN}` substituted at container start)
- Group **`admins`** for platform operators (SAML group sync to Sonar global admin)
- SAML mappers: `login`, `email`, `groups` (short names, `full.path=false`)

**Existing install:** Realm import does **not** re-run. Put operators in Keycloak **`admins`** only. Developers need no Keycloak group for Sonar — Sonar assigns built-in **`sonar-users`** on login.

## SonarQube automated bootstrap

| Service | Purpose |
|---|---|
| `sonarqube-config-init` | IdP metadata → `.vols/sonarqube/conf/sonar.properties` (SAML) |
| `sonarqube-init` | Ensures Sonar built-in **`sonar-users`** permissions, creates **`admins`** with global admin, removes legacy custom groups |

**Env:** `SONAR_ADMIN_GROUP` (default `admins`), `SONAR_ADMIN_*`, `SONARQUBE_EXTERNAL_URL`.

**Re-run:** `docker compose run --rm sonarqube-init`

**Verify replication:** from repo root, `sh scripts/verify-sonar-setup.sh` (checks `.env`, generated `sonar.properties`, container health).

## Group model

| Keycloak group | Sonar group | Access |
|---|---|---|
| *(none)* | **`sonar-users`** (built-in default) | `scan`, `provisioning` — all authenticated SAML users |
| `admins` | **`admins`** | Global **Administer** |

Assign platform operators to Keycloak **`admins`** only. Do not create a Keycloak `sonar-users` group — Sonar already has that name as its default local group.

**`sonar-administrators`** remains for the local **`admin`** account only (Sonar built-in).

## CI access

CI uses **`SONAR_TOKEN`**, not SAML. See [Manual onboarding Sonar](../03_devs/06_manual_onboarding.md#sonarqube-opt-in).

See also: [SonarQube service](../99_maintainers/02_services.md#sonarqube).
