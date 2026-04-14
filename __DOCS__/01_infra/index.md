# Infra / Operator Guide

← [Back to docs home](../index.md)

This guide is for the person setting up the server — someone who has access to the machine, can run terminal commands, and controls the domain's DNS settings. You don't need to be a software developer, but you do need to be comfortable with a command line.

Here's what you'll do, in order:

1. **[Check prerequisites](01_prereqs.md)** — Make sure your server meets the hardware requirements and has Docker installed.
2. **[Configure the environment](02_env.md)** — Fill in a single configuration file with your domain, credentials, and API tokens. This is the most important step.
3. **[Start the platform](03_bootstrap.md)** — Bring everything up with one command and verify it's working.
4. **[Ongoing operations](04_operations.md)** — How to start, stop, view logs, back up data, and upgrade services.
5. **[Reset from zero](05_reset_from_zero.md)** — If you ever need to wipe everything and start fresh, this is the procedure.

---

A few things worth knowing before you dive in:

Everything runs as Docker containers on a single machine. There's a file called `docker-compose.yml` that defines all the services and how they connect to each other. You won't need to edit that file unless you're making intentional changes to the platform configuration — everything you're expected to customize lives in the `.env` file.

All persistent data (GitLab repositories, secrets, database contents) is stored under a folder called `.vols/` on the server. Keep this folder safe. If it's deleted, the data is gone.

The platform is designed to be accessible over HTTPS only. Certificates are issued automatically by Let's Encrypt, using your Cloudflare account to prove domain ownership. This means you need both a domain name and a Cloudflare account set up before starting.
