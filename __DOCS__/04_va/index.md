# Vulnerability Assessment: user manual

This manual is for people who run security scans of the web applications and APIs hosted on this platform and who read the reports. Operators who install or maintain the service should read [Operations](01_operations.md).

[TOC]

---

## 1. What this service does

You pick an application, press a button, and get a report that lists its security weaknesses, how serious each one is, and how to fix it. Every report has the same layout, so two reports can be compared line by line.

One scan runs five tools and merges their results:

| Tool | What it looks for |
|---|---|
| OWASP ZAP | Weaknesses in the application itself: injection, cross-site scripting, missing security headers, unsafe cookies. It explores the application by following links, and tests every endpoint of an API definition if you upload one. |
| Nuclei | Known vulnerabilities (CVEs) in the software behind the address, exposed admin panels, backup files, default settings. |
| testssl.sh | The HTTPS setup: outdated protocol versions, weak ciphers, certificate problems. |
| OpenVAS | The server behind the address: open ports and known vulnerabilities in the services listening on them. |
| Trivy | Optional. Known vulnerabilities in the packages inside the application's container image. |

### What it does not do

- It does not find flaws in business rules, such as "a customer can see another customer's invoice by changing a number", unless the flaw shows up as a generic pattern. Access-control checks of that kind need a person.
- It cannot prove an application is secure. A clean report means these tools found nothing with the settings used.
- It only scans applications on this platform. Addresses outside the allowed domains are refused.

---

## 2. Signing in

Open `https://va.devops.<DOMAIN>` and sign in with your platform account. Access is limited to the `admins` group.

Findings are stored in DefectDojo at `https://va-dojo.devops.<DOMAIN>`, linked from the menu as **Findings (DefectDojo)**. It uses the same platform sign-in: there is no second password. The first time you open it, DefectDojo creates your account from your platform email address.

**Logout** in DefectDojo signs you out of the whole platform, not just DefectDojo.

---

## 3. Quick start

1. **Targets > Add target.** Give it a name and the application's address.
2. On the target page, set the **Login** if the application needs one (section 5).
3. If it is an API, upload its **API definition** (section 6).
4. **New scan**, choose the target and a profile (section 7), tick the confirmation, **Start scan**.
5. Wait. The scan page refreshes on its own. You can close it and come back.
6. Download the report from the scan page (section 9).

---

## 4. Adding a target

A target is one application at one address.

| Field | What to enter |
|---|---|
| Name | How the application appears in reports, for example `Customer portal (staging)`. |
| Base URL | The address users open, for example `https://portal.stg.apps.<DOMAIN>`. Everything on that host is in scope. Other hosts are never touched, even if the application links or redirects to them. |
| Environment | Development, Staging or Production. Production changes the defaults to the safest settings (sections 6 and 7). |
| Container image | Optional. The image the application runs from, for example `registry.devops.<DOMAIN>/group/app:tag`. If set, Trivy checks its packages. |
| GraphQL endpoint path | Optional. For example `/graphql`. |

Use one target per environment. The report compares each scan with the previous scan of the same target, and that comparison only means something if the target stays the same.

---

## 5. Setting up the login

Without a login, the scan only sees what an anonymous visitor sees. For most applications that is the login page and little else, so set this up.

**Always use a dedicated test account.** The scanner clicks and submits whatever it finds. Never use a real person's account or an account with administrator rights over real data.

Choose the type on the target page under **Login**.

### None

For public sites, or as a first look at what is exposed without an account.

### Bearer token / API key / cookie

For APIs and for applications where you can copy a session from your browser. Enter one header per line:

```
Authorization: Bearer eyJhbGciOi...
X-Api-Key: 4f1c...
```

To reuse a browser session, sign in to the application, copy the `Cookie` header from the browser's developer tools (Network tab), and enter `Cookie: <value>`.

Set **URL that requires login** to an address that answers "unauthorised" without the header, for example `https://api.dev.apps.<DOMAIN>/v1/me`. The scan uses it to check the credentials before starting.

**Token lifetime matters.** The scanners send the same header for the whole scan. If the token expires halfway, the rest of the scan runs without a login. The report detects this for standard (JWT) tokens and marks the login as failed. Use a token that stays valid longer than the scan: about 30 minutes for Passive, up to 2 hours for Standard, up to 5 hours for Deep.

### OAuth2 token

The scan requests a token itself, immediately before starting.

| Field | Example |
|---|---|
| Token URL | `https://auth.devops.<DOMAIN>/realms/devops/protocol/openid-connect/token` |
| Grant | `client_credentials` for a service account, `password` for a test user |
| Client ID, client secret | From the identity provider |
| Username, password | Only for the `password` grant |
| Scope | Optional |

The same lifetime rule applies. Keycloak's default access token lasts 5 minutes, which is too short. Ask your operator for a dedicated client with a longer access token lifespan for scanning.

### App login form

For applications with their own username and password form.

| Field | Example |
|---|---|
| Login form URL | The address the form is submitted to, for example `https://portal.dev.apps.<DOMAIN>/login` |
| Username field name, password field name | The `name` of the two inputs, for example `email` and `password`. Right-click the field in the browser and choose Inspect to see it. |
| Test user, password | The dedicated test account |
| Extra form fields | Optional, for example `remember=1` |
| Text that only appears when logged in | For example `Logout` or the test user's name |

### Browser login (Keycloak SSO, OIDC, SAML)

For applications that send you to a separate sign-in page, including this platform's Keycloak. The scanner opens a real browser, follows the redirect, types the test user's name and password, and continues as that user.

| Field | Example |
|---|---|
| Page that starts the login | The application's own address or its protected page |
| Test user, password | A dedicated test account at the identity provider |
| Text that only appears when logged in | Recommended |

This works for sign-in pages with a username field and a password field, on one page or two. It does not work with multi-factor authentication or a CAPTCHA: use a test account without them, or switch to the cookie method above.

### Custom ZAP authentication script

For logins none of the above can handle. Upload a ZAP authentication script and give the test user. This needs someone who knows ZAP scripting. The simpler fallback is the cookie method: sign in by hand, copy the session cookie, use **Bearer token / API key / cookie**.

### How you know the login worked

Every report states the result under **Coverage > Login check**:

| Result | Meaning |
|---|---|
| Passed | The credentials were accepted, or the logged-in text was seen. |
| Failed | The credentials were rejected, the token expired during the scan, or the logged-in text never appeared. The report shows a red notice. Pages behind the login were not tested. |
| Could not be confirmed | A form or browser login was used and no logged-in text is set. Set it and scan again. |

Secrets are stored encrypted. They are never shown again after saving, and never appear in logs or reports. To change one, type a new value; leaving a field empty keeps the stored value.

---

## 6. Scanning an API from a definition file

A crawler cannot discover API endpoints by following links, so give the scanner the list. Upload the file on the target page under **API definition**.

### Supported files

| Type | Versions | Notes |
|---|---|---|
| OpenAPI / Swagger | Swagger 2.0, OpenAPI 3.0 and 3.1, JSON or YAML | Often available from the API at `/openapi.json`, `/v3/api-docs` or `/swagger.json`. |
| Postman collection | v2.0 and v2.1 | In Postman: the collection's menu > **Export** > **Collection v2.1**. |
| Postman environment | Optional, with a collection | In Postman: **Environments** > the environment's menu > **Export**. |

### What happens on upload

The file is checked immediately and the page shows what was found: the number of endpoints, the server addresses in the file, and any variables. If the file cannot be read, the message says why.

- **Server addresses are replaced** by the target's base URL. A file that names `localhost` works unchanged. A file that names a host outside the allowed domains is refused, so a definition cannot redirect the scan somewhere else.
- **Postman requests to other hosts** are left out of the scan and listed in the scan settings. Requests to a host outside the allowed domains make the upload fail.

### Variables

Postman `{{variables}}` take their values from the environment file. The **Variables** table shows each one and whether the file supplies a value. Type your own value to override it. A scan cannot start while a variable has no value, because sending the literal text `{{token}}` would test nothing.

For OpenAPI, the table lists path and query parameters. Parameters without an example get a neutral default (`1`, `test`). Set real values where it matters: `GET /orders/{orderId}` only exercises the application properly if `orderId` is an order that exists and that the test user may see.

Values you enter are stored encrypted and not shown again.

### Choosing which requests are sent

The **Endpoints to scan** table lists every request with a tick box. Untick anything that must not be sent, for example requests that delete data, send email or SMS, or charge money.

For a **Production** target, every `POST`, `PUT`, `PATCH` and `DELETE` request starts unticked. Tick back in only the ones you are sure are harmless.

### Login

If a login is set on the target, it is used. If not, and the Postman collection carries its own authorization (bearer token, API key or basic), that is used. For OpenAPI, always set the login on the target.

### In the report

**Coverage > API endpoints** lists every endpoint from the file with what happened:

| Result | Meaning |
|---|---|
| reached | The API answered normally. The endpoint was tested. |
| unauthorised | The API answered 401 or 403. Fix the login, or the test user's permissions. |
| not found | 404. Usually a wrong path parameter value or a wrong base path. |
| server error | The API answered with a 5xx error to a normal request. Worth investigating by itself. |
| not requested | The scanner never sent it. Check the tool's log. |
| skipped (excluded) | You unticked it. |

Only "reached" endpoints were fully tested. Read this table before trusting a clean report.

---

## 7. Choosing a profile

| Profile | What it does | Typical duration | Use for |
|---|---|---|---|
| Passive | Explores the application and inspects what it sends back. No attack payloads, no form submissions. | About 30 minutes, plus the server scan | Production. A first look at anything. |
| Standard | Explores, then sends attack payloads at normal strength to every input it found. | Up to 2 hours | Development and staging, routinely. |
| Deep | Longer exploration, more payload variants, higher strength. | Up to 5 hours | Before a major release. |

OpenVAS runs in every profile and takes 30 to 60 minutes; the scan finishes when the slowest tool finishes.

**About "Passive" and production.** Passive sends no attacks, but it does browse the application as a visitor would: it follows links and clicks buttons. A badly designed application that changes data on a simple link click can still be affected. Standard and Deep submit forms with test data and attack strings. On an application without good input handling this can create junk records, trigger emails, or lock accounts. That is why they need an extra confirmation for production targets, and why they belong on staging.

### Network route

- **Internal** (default): scanners reach the application through the platform's own reverse proxy. Faster, and the traffic does not leave the server.
- **Public**: scanners go out to the internet and back in, the way an outside attacker does. Use it when you want to include whatever sits in front of the platform.

OpenVAS always scans the public address, because the ports reachable from outside are what matters for a server scan.

---

## 8. Starting a scan and following it

On **New scan**, choose the target, profile and route, and tick **I am authorised to test this target**. Tell the application's owners before scanning; a scan looks like an attack in their logs.

If **Start scan** is disabled, the page says why:

| Message | What to do |
|---|---|
| OpenVAS is not ready / feeds are still loading | After installation or an update, the vulnerability feeds take 30 to 90 minutes to load. Wait. |
| DefectDojo is not reachable | Tell your operator. |
| The API definition has variables without a value | Set them on the target page. |

Scans run one at a time. A second scan waits in the queue.

The scan page shows each tool's status:

| Status | Meaning |
|---|---|
| Not started / Running | In progress. |
| Completed | The tool finished. The detail column may say "with warnings"; open the tool's log if so. |
| Skipped | Not applicable, for example testssl.sh on a plain-HTTP target, or Trivy with no image set. |
| Failed | The tool did not finish. Its checks are missing from the report, and the report says so. |

**Cancel scan** stops everything. A cancelled scan has no report.

If one tool fails, the others still complete and you still get a report. It is marked **Incomplete scan** on the cover and names the missing tool. Do not treat an incomplete report as a clean bill of health for the area that tool covers.

---

## 9. Reading the report

Download the PDF or open the HTML version from the scan page. Both have the same content. The sections are always the same and always in this order.

| Section | What it tells you |
|---|---|
| Cover | Target, scan ID, date, profile, who ran it, and the overall risk rating. |
| 1. Executive summary | How many issues at each severity, the five most important, and any warning that the scan was incomplete or the login failed. Read this first. |
| 2. Scope and method | Exactly what was tested and how: address, profile, login type, API definition, route, tool versions. |
| 3. Coverage | Whether each tool finished, whether the login worked, how many pages were reached, and the endpoint-by-endpoint table for APIs. **Read this second.** It tells you how far to trust the rest. |
| 4. Findings summary | One line per issue, most severe first, with a reference number (`F-001`). |
| 5. OWASP mapping | The issues grouped by the OWASP Top 10 (2021) and OWASP API Security Top 10 (2023) categories. Useful for audits. A category with zero issues was not necessarily tested in depth. |
| 6. Finding details | For each issue: rating, where it was found, description, evidence, and how to fix it. Hand this section to the developers. |
| 7. Change since the previous scan | Which issues are new, which are no longer found, which are still open. |
| 8. Appendix | Full scan settings, issues set aside as false positives or accepted risks, and the severity scale. |

The same issue found at several addresses, or by more than one tool, appears once, with all the addresses listed.

### Severity and how fast to fix

| Severity | Meaning | Suggested fix time |
|---|---|---|
| Critical | Can be exploited remotely with little effort to take over the system or read all its data. | 7 days |
| High | Serious weakness that exposes sensitive data or functions, usually needing some precondition. | 30 days |
| Medium | Helps an attacker or exposes limited data; often needs a user to do something. | 90 days |
| Low | Minor weakness or missing hardening with little direct impact. | 180 days |
| Info | Observation with no direct security impact. | No deadline |

The **overall risk rating** is the severity of the most serious open issue. The fix times are suggestions; follow your own policy if you have one.

Severity is assigned by the tools from general rules. They do not know your application. A "Medium" on the page that handles payments may matter more than a "High" on a page nobody uses. Use judgement.

### "No longer found" does not always mean fixed

Section 7 compares with the previous scan. An issue can disappear because it was fixed, or because this scan looked at less: a different profile, a login that failed, a smaller API definition. Check that the two scans used the same settings (section 2 of each report) before reporting something as fixed.

---

## 10. False positives and accepted risks

Automated tools are sometimes wrong, and some real issues are consciously accepted. Record both in DefectDojo so they stop appearing as open:

1. On the scan page, open **Findings in DefectDojo**.
2. Open the finding.
3. For a wrong result, edit it and tick **False Positive**. For a real issue the owner accepts, use **Accept Risk** and write down who accepted it and why.
4. Back on the scan page, press **Regenerate report**.

The regenerated report moves those issues from the findings list to **Appendix > Issues set aside**, so a reader can still see what was excluded and judge whether that was right. They are no longer counted in the totals or the risk rating.

DefectDojo remembers false positives for the same application, so they stay set aside in later scans.

Mark something as a false positive only after checking. If unsure, leave it open and ask the developers.

---

## 11. Confirming a fix

1. The developers deploy the fix.
2. Scan the same target with the **same profile, login and API definition** as before.
3. In the new report, section 7, the issue should be listed under **No longer found**.
4. Check section 3 to make sure the new scan covered as much as the old one.

---

## 12. Rules of use

- Scan only applications you are responsible for or have been asked to test. The service enforces the allowed domains; it cannot check that you have the owner's agreement.
- Tell the application's owners before a scan. Give them the scan ID.
- Use Passive for production unless the owner has explicitly agreed to more, at a time they chose.
- Use dedicated test accounts with test data.
- Reports are confidential. They are a list of ways into the system. Share them only with the people fixing the issues.

---

## 13. Troubleshooting

| What you see | Likely cause and what to do |
|---|---|
| "…is not on the allowlist" when adding a target | The address is outside the domains this service may scan. Check for typos. To add a domain, ask your operator. |
| Report says the login failed | Wrong credentials, an expired token, or a test user without access. For tokens, check the lifetime (section 5). Fix and scan again. |
| Very few pages reached (Coverage) | The login did not work, or the application is a single-page app that needs the login to show anything. Set the logged-in text so failures are detected. |
| Most API endpoints "unauthorised" | The login is missing or the test user lacks permissions. |
| Most API endpoints "not found" | The base URL or the path prefix is wrong, or the path parameter defaults do not exist. Set real values under Variables. |
| A tool shows "Failed" | Open its log from the scan page. A timeout usually means the target is slow or very large; try again at a quieter time. Report repeated failures to your operator. |
| "The PDF could not be created" | Open the HTML report and print it to PDF from the browser. Tell your operator. |
| Upload refused: "points at … which is not on the allowlist" | The definition names a server outside the allowed domains. Remove that server entry from the file, or export the definition for the right environment. |
| Upload refused: "Only Postman collection v2.0 and v2.1 are supported" | Export again from Postman and choose Collection v2.1. |
| Scan stuck on "queued" | Another scan is running. Scans run one at a time. |
| The application misbehaved during a scan | Cancel the scan. Tell the owners the scan ID and time. Use Passive, or exclude the requests that caused it, next time. |

### Questions

**How long are results kept?** Reports and findings are kept. The raw output of each tool is deleted after 30 days.

**Can two people scan at once?** Yes, but the scans run one after the other.

**Can I schedule scans?** Not in this version. Scans are started by hand.

**Why does every scan include the server scan?** So every report covers the same ground and reports stay comparable.
