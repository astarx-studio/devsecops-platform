# Prerequisites

← [Back to Infra Guide](index.md)

Before you start the platform, make sure you have the following in place. Most of these are one-time setup steps you only need to do once.

---

## A server with enough resources

GitLab is by far the heaviest piece of this stack. If you're running everything on a single machine, the minimums below apply to that machine:

| | Minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Disk | 50 GB free | 200 GB+ |

The operating system can be Linux (preferred for always-on server use) or Windows 10/11 with Docker Desktop. If you're running this on a VPS or cloud instance, a standard 4-core/8GB Linux server is the minimum viable option.

---

## Docker and Docker Compose

The platform runs entirely in Docker, so Docker must be installed on the server.

To check if Docker is already installed, run:

```bash
docker version
docker compose version
```

If either command returns a "not found" error, you need to install Docker first. Visit [https://docs.docker.com/get-docker/](https://docs.docker.com/get-docker/) and follow the instructions for your operating system. Make sure you get **Docker Engine** plus **Docker Compose v2** (they're bundled together in Docker Desktop, or available as separate packages on Linux).

---

## A domain name managed through Cloudflare

The platform uses a wildcard subdomain structure under your chosen domain. For example, if your domain is `example.com`, all platform services will be reachable at addresses like `gitlab.devops.example.com`, `auth.devops.example.com`, and so on.

You need to:

1. **Own a domain name** — registered through any registrar (GoDaddy, Namecheap, Google Domains, etc.)
2. **Have that domain managed by Cloudflare** — meaning Cloudflare is your DNS provider. If your domain is registered elsewhere, you can still use Cloudflare for free by changing the nameservers at your registrar to point to Cloudflare's. Visit [https://dash.cloudflare.com](https://dash.cloudflare.com), add your domain, and follow the instructions to update your nameservers.

Once Cloudflare is managing your DNS, you'll need to point the platform's subdomain group to your server's IP address. Create a DNS A record in Cloudflare:

- **Name**: `*.devops` (this is a wildcard — it covers all subdomains under `devops.yourdomain.com`)
- **Value**: your server's public IP address
- **Proxy status**: DNS only (grey cloud, not orange) — the Cloudflare proxy can interfere with HTTPS certificate issuance

---

## A Cloudflare API token

The platform needs a Cloudflare API token for two things: issuing HTTPS certificates automatically, and (optionally) managing DNS records through the Management API.

To create the token:

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com)
2. Click your profile icon in the top right, then click **My Profile**
3. Go to the **API Tokens** tab
4. Click **Create Token**
5. Choose **Create Custom Token**
6. Give it a name (e.g., "devops-platform")
7. Under **Permissions**, add:
   - Zone → DNS → **Edit**
   - Zone → Zone → **Read**
8. Under **Zone Resources**, select **All zones** (or restrict it to your specific domain if you prefer)
9. Click **Continue to summary**, then **Create Token**
10. Copy the token immediately — you won't be able to see it again after leaving the page

This token goes into the `CLOUDFLARE_API_TOKEN` field in your `.env` file.

---

## A Cloudflare Tunnel (for internet access via Cloudflare)

This step is optional if you're accessing the platform only from within your local network or via direct public IP. But if you want external access without opening firewall ports, you'll use a Cloudflare Tunnel.

To create a tunnel:

1. In the Cloudflare dashboard, go to **Zero Trust** (in the left sidebar)
2. Navigate to **Networks → Tunnels**
3. Click **Create a tunnel**, choose **Cloudflared**, and give it a name
4. Copy the **tunnel token** shown during setup (it's a long string starting with `ey...`)
5. In the tunnel's **Public Hostnames** settings, add entries routing your subdomains to the appropriate internal addresses (e.g., `gitlab.devops.yourdomain.com` → `http://gitlab:80`)

The tunnel token goes into the `CLOUDFLARE_TUNNEL_TOKEN` field in your `.env` file.

The **Account ID**, **Zone ID**, and **Tunnel ID** are optional — they're only needed if you want the Management API to create DNS records automatically. You can find them in the Cloudflare dashboard under your domain's overview page (Account ID and Zone ID are shown in the right sidebar).

---

## An SMTP provider (for email)

The platform sends emails through GitLab (for things like pipeline notifications and account invites) and Keycloak (for password reset emails). You'll need credentials from an SMTP provider.

Common options:

- **Gmail / Google Workspace**: Use an App Password (not your regular Google password). Go to your Google account → Security → 2-Step Verification → App Passwords. The SMTP host is `smtp.gmail.com`, port `587`.
- **SendGrid**: Create an API key at [sendgrid.com](https://sendgrid.com). The SMTP host is `smtp.sendgrid.net`, port `587`, username is `apikey`, and the password is your API key.
- **Mailgun, Postmark, AWS SES**: All support SMTP with similar setup. Check their documentation for the host, port, username, and password.

You'll fill in the `SMTP_*` variables in `.env` with whatever your provider gives you.

---

Once you have all of the above, move on to [configuring your environment file](02_env.md).

---

## Choosing a public ingress mode

Before you start the stack, decide how the platform will be reachable from the internet. There are three mutually exclusive modes, each with its own prerequisites.

| Mode | When to use | Extra prerequisites |
|---|---|---|
| **Direct** | Your network already exposes the host's ports `10080` and `10443` to the internet. ISP or router firewall allows inbound TCP 80/443/12222. | Nothing beyond the above. Point DNS `A` records at your public IP. |
| **Cloudflare Tunnel** | You want internet access without opening any inbound firewall ports. Cloudflare routes traffic through an outbound-only connection. | A Cloudflare Tunnel token (created above). Tunnel routing rules configured in the Cloudflare dashboard (Zero Trust → Networks → Tunnels). |
| **VPN edge** | Your ISP blocks inbound TCP 80/443 (e.g. residential CGNAT), or you want a stable public IP without relying on Cloudflare. A cloud VM holds your public IP and forwards traffic through WireGuard to your home server. | A cloud VM (e.g. GCP, DigitalOcean, AWS Lightsail) with a static public IPv4. VPC/firewall rules allowing inbound TCP 80, 443, 12222 to that VM. Outbound UDP 51820 from that VM to your home public IP. Your home router must forward UDP `51820` to the Docker host. |

**You can only use one mode per public DNS name at a time.** Do not point the same domain at both a Cloudflare Tunnel and a VPN edge VM.

After choosing:

- **Direct:** no extra configuration needed — proceed to [configuring your environment](02_env.md).
- **Cloudflare Tunnel:** ensure `CLOUDFLARE_TUNNEL_TOKEN` is filled in `.env`; use `docker compose --profile cftunnel up -d` instead of plain `docker compose up -d`.
- **VPN edge:** additionally follow the **Edge VM bootstrap** section in [Networking — VPN edge ingress](../99_maintainers/05_networking.md#edge-vm-bootstrap-fresh-ubuntu) after the stack is running. Use `docker compose --profile vpnedge up -d` instead of plain `docker compose up -d`.
