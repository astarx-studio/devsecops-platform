# Company email onboarding

← [Back to admin guide](index.md)

The operator console **People** tab registers one person and their company address. It does not create an inbox, and it does not open public signup.

What the person gets:

- Mail sent to the company address is forwarded to their personal inbox by Cloudflare Email Routing.
- A Mailgun SMTP login so they can send as the company address from Gmail.
- A YADA DSOaaS account. The username is the part before `@<DOMAIN>`, and the sign-in address is the full company email. They set the password from a link in a second mail. The form never chooses a password.

## One-time setup

DNS for the company domain stays as it is for sending today:

- MX records point at Cloudflare Email Routing.
- SPF includes both Mailgun and Cloudflare Email Routing.
- Mailgun DKIM CNAMEs stay in place. Do not add Mailgun's MX records.

Create a Cloudflare API token with both of these permissions:

- Zone → Email Routing Rules → Edit
- Account → Email Routing Addresses → Edit

The zone id and account id are on the domain's Cloudflare Overview page, under API. Put them in `.env` with `MAILGUN_API_KEY`. Names are listed in `sample.env`.

On a realm that already exists, create the Keycloak service account once:

```bash
bash bootstrap/patch-keycloak-onboarding.sh
docker compose up -d api
```

The script adds a confidential client in the `devops` realm. It does not change realm SMTP settings. `realm-export.json` does not re-apply this client on its own.

## Using the form

Open `https://console.devops.<DOMAIN>` as an admin. The **People** tab asks for:

- personal email
- first name
- last name
- username, the part before `@<DOMAIN>`. The form shows the domain and does not ask for it. That name is the YADA username. The mailbox and the sign-in address are `username@<DOMAIN>`.

Role addresses such as `admin`, `noreply`, and the platform From address are rejected.

**Search people** filters the cards by name, company address, or personal inbox. It searches stored records, up to 50 matches.

If this personal inbox has never been confirmed with Cloudflare, the page stops at **Waiting for them to open Cloudflare's verification mail**. No YADA account is created yet. Confirm the two addresses on the card, ask the person to open that Cloudflare message (including spam), then click **Resume**.

When the destination is already verified, start continues: one exact-address forward, one Mailgun SMTP login, one HTML setup mail to the personal inbox, then two YADA mails. One asks them to confirm the address. The other asks them to set a password. Both are HTML, sent to the company address and copied straight to the personal inbox, because a forward of mail from this domain does not reliably show up there. Each link expires in 24 hours.

The setup mail contains the Mailgun SMTP password. It does not contain a YADA password. The Mailgun login can send as any address on the domain. The mail says so. Repeating start for the same company address does not create a second user or a second login.

## Remove someone

**Remove** on the card disables the YADA user, deletes that forward, and deletes that Mailgun login. It leaves the Cloudflare destination, because other company addresses may forward to the same personal inbox. Mail already delivered stays in that inbox.

Starting the same company address again after removal creates a new forward and a new send login, and sends a new invite.
