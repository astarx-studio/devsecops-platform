# GCP VPN edge — image & instance template

Operator kit for the **vpnedge** public ingress VM. Full maintainer docs:
[`__DOCS__/99_maintainers/10_gcp_edge_template.md`](../../__DOCS__/99_maintainers/10_gcp_edge_template.md).

## Current production identifiers

| Item                       | Value                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Project                    | `yada-technology`                                                                         |
| Zone                       | `asia-southeast2-a`                                                                       |
| Instance                   | `yada-tunnel-managed-68bh`                                                                |
| Network tags               | `custom-ssh`, `http-server`, `https-server`, `lb-health-check`, `wireguard-tunnel`        |
| Passthrough LB IP          | `34.101.130.148` (`yada-tunnel-pip` / `yada-tunnel-lb-forwarding-rule`, `allPorts: true`) |
| Image family               | `vpn-edge`                                                                                |
| Instance template          | `vpn-edge-devtools-v3` (preferred; `v2` had 4-port per-env RabbitMQ; `v1` Postgres-only)  |
| Devtools Postgres firewall | `allow-vpnedge-devtools-pg` (`tcp:25432` → tag `wireguard-tunnel`)                        |
| Devtools RabbitMQ firewall | `allow-vpnedge-devtools-amqp` (`tcp:25672,25682` → tag `wireguard-tunnel`)                |

## Files

| File                           | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `startup-script.sh`            | Metadata startup-script: packages, sysctl, systemd, re-apply NAT             |
| `create-image-and-template.sh` | Snapshot live VM → image family `vpn-edge` + template (set `GCP_EDGE_TEMPLATE`) |

## First-time / after NAT config change

1. Update [`../vpn-edge/forward-ports.env`](../vpn-edge/forward-ports.env) on the live VM and run `apply-nat.sh apply`.
2. Ensure GCP firewall allows the new public port(s).
3. From **repo root** (gcloud authenticated):

```bash
chmod +x edge/gcp/create-image-and-template.sh edge/gcp/startup-script.sh
GCP_EDGE_TEMPLATE=vpn-edge-devtools-v3 ./edge/gcp/create-image-and-template.sh
```

The script stops the instance briefly for a clean image, then starts it again.
Use `--no-stop` only if you accept a force-create while the VM stays running.

## Recreate an instance from the template

```bash
gcloud compute instances create yada-tunnel-managed-NEWID \
  --project=yada-technology \
  --zone=asia-southeast2-a \
  --source-instance-template=vpn-edge-devtools-v3
```

Then:

1. Attach the MIG / LB backend if this replaces the managed instance group member.
2. Verify `sudo wg show` (recent handshake) and `sudo nft list table ip vpnedge` (includes `25432`, `25672`, `25682`).
3. If WireGuard keys are stale, restore `/etc/wireguard/wg0.conf` from home
   `.vols/wireguard/peer_edge/peer_edge.conf` and `systemctl restart wg-quick@wg0 vpn-edge-nat`.

## Adding another shared-tool TCP port later

See the checklist in [`__DOCS__/99_maintainers/05_networking.md`](../../__DOCS__/99_maintainers/05_networking.md)
(section **Adding a shared-tool TCP forward**). Summary:

1. Home Traefik/compose publish port
2. `FORWARD_TCP` on edge
3. `apply-nat.sh apply`
4. GCP firewall
5. Rebuild image + template (new template name or delete old)
6. Update developer docs

**Exposed beyond HTTP(S) and GitLab SSH today:** shared Postgres `25432`, shared RabbitMQ AMQP `25672` (vhosts `dev`/`stg`), Management UI `25682`.
