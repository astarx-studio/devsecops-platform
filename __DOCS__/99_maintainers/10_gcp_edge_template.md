# GCP edge template (vpnedge)

← [Back to Maintainer Guide](index.md)

How the **VPN edge** VM is snapshotted into a GCP custom image and instance template so reinstantiation keeps WireGuard, nftables NAT, and shared-tool TCP forwards (**devtools Postgres `25432`**, **devtools MySQL `23306`**, **devtools RabbitMQ AMQP `25672`**, **Management UI `25682`**, **MinIO S3 `29000`**).

Related: [Networking — VPN edge](05_networking.md#vpn-edge-ingress-wireguard), [`edge/gcp/`](../../edge/gcp/), [Shared Postgres](../03_devs/10_shared_devtools_postgres.md), [Shared RabbitMQ](../03_devs/11_shared_devtools_rabbitmq.md).

---

## Identifiers (production)

| Item | Value |
|---|---|
| Project | `yada-technology` |
| Zone | `asia-southeast2-a` |
| Live instance | `yada-tunnel-managed-68bh` |
| Machine type | `e2-micro` |
| Network tags | `custom-ssh`, `http-server`, `https-server`, `lb-health-check`, `wireguard-tunnel` |
| Reserved LB IP | `34.101.130.148` (`yada-tunnel-pip`) |
| Forwarding rule | `yada-tunnel-lb-forwarding-rule` (`L3_DEFAULT`, **`allPorts: true`**) |
| Backend / MIG | `yada-tunnel-lb` / `yada-tunnel-managed` |
| Image family | `vpn-edge` |
| Instance template | **`vpn-edge-devtools-v4`** (preferred; Spot + `canIpForward`; `v3`/`v2`/`v1` are older STANDARD global templates) |
| Firewall (devtools PG) | `allow-vpnedge-devtools-pg` — `tcp:25432` → tag `wireguard-tunnel` |
| Firewall (RabbitMQ) | `allow-vpnedge-devtools-amqp` — `tcp:25672,25682` → tag `wireguard-tunnel` |
| Firewall (MinIO) | `allow-vpnedge-devtools-minio` — `tcp:29000` → tag `wireguard-tunnel` |
| Firewall (MySQL) | `allow-vpnedge-devtools-mysql` — `tcp:23306` → tag `wireguard-tunnel` |

DNS for `*.devops.<DOMAIN>` / apps zones should point at the **LB IP** (`34.101.130.148`), not the VM's ephemeral NIC IP.

---

## What the custom image contains

Built from the live edge disk after NAT is configured:

- Packages: `wireguard`, `nftables`, etc.
- `/etc/wireguard/wg0.conf` (WireGuard **private key** — treat the image as sensitive)
- `/home/iam_msams/vpn-edge/` kit (`apply-nat.sh`, `forward-ports.env` with Postgres + MySQL + RabbitMQ + MinIO ports, systemd units)
- Enabled units: `wg-quick@wg0`, `vpn-edge-nat`

**Startup script** ([`edge/gcp/startup-script.sh`](../../edge/gcp/startup-script.sh)) is attached as instance metadata for defense-in-depth: reinstall packages/sysctl if needed, ensure units, re-apply NAT if inactive. It does **not** embed secrets.

---

## Rebuild image + template

From the **devsecops-platform** repo root, with `gcloud` authenticated:

```bash
chmod +x edge/gcp/create-image-and-template.sh edge/gcp/startup-script.sh
GCP_EDGE_TEMPLATE=vpn-edge-devtools-v4 ./edge/gcp/create-image-and-template.sh
```

- Default template name is **`vpn-edge-devtools-v4`**. Image name is `${TEMPLATE}-${YYYYMMDD}` in family `vpn-edge`.
- The script clones **Spot** + **`can-ip-forward`** from the live instance so MIG repair matches production (do not bake a STANDARD template without IP forwarding).
- Default: stops the VM briefly for a consistent image, then starts it again.
- `--no-stop`: force-create while the VM keeps running (shorter downtime, slightly riskier snapshot).
- If template `vpn-edge-devtools-v4` already exists, delete it or set `GCP_EDGE_TEMPLATE` to a new name before re-running.
- After create, point MIG `yada-tunnel-managed` at the new template (`set-instance-template`). Update policy is **OPPORTUNISTIC**: `versionTarget.isReached` can stay false until the member is actually replaced. Next repair/preempt still uses the new template (`forceUpdateOnRepair: YES`). Do not `recreate-instances` unless you want extra downtime now.

After a successful rebuild, optionally refresh metadata on the live VM:

```bash
gcloud compute instances add-metadata yada-tunnel-managed-68bh \
  --project=yada-technology \
  --zone=asia-southeast2-a \
  --metadata-from-file=startup-script=edge/gcp/startup-script.sh
```

---

## Reinstantiate from template

```bash
gcloud compute instances create yada-tunnel-managed-NEWID \
  --project=yada-technology \
  --zone=asia-southeast2-a \
  --source-instance-template=vpn-edge-devtools-v4
```

Then:

1. Put the new instance into MIG `yada-tunnel-managed` (or replace the old member) so the LB still has a healthy backend.
2. Prefer a **reserved** external IP on the instance if you bypass the LB for admin SSH; public app traffic should stay on `yada-tunnel-pip`.
3. Verify:
   ```bash
   sudo wg show          # recent handshake, growing transfer
   sudo nft list table ip vpnedge | grep -E '25432|23306|25672|25682|29000'
   systemctl is-active wg-quick@wg0 vpn-edge-nat
   ```
4. Update DNS only if the **LB IP** changed (it should not if `yada-tunnel-pip` stays attached to the forwarding rule).

### WireGuard key restore

If the image is stale or keys were rotated on the home `wireguard` container:

1. Copy home `.vols/wireguard/peer_edge/peer_edge.conf` to the edge as `/etc/wireguard/wg0.conf` (`chmod 600`).
2. `sudo systemctl restart wg-quick@wg0 vpn-edge-nat`
3. Rebuild the custom image so the next template bake includes the new key.

Optional future improvement: keep `wg0.conf` + `forward-ports.env` on a **persistent disk** mounted at boot so key rotation does not require a full image rebuild (not required for the current single-tenant setup).

---

## Security notes

- Ports **25432**, **23306**, **25672**, **25682**, and **29000** are open to `0.0.0.0/0` via the devtools firewall rules. Auth is service user/password only. Prefer rotating DevTools passwords and optionally narrowing firewall `sourceRanges`.
- The custom image embeds the WireGuard private key — limit who can `compute.images.get` / create instances from the template.
- Do not commit live `forward-ports.env` or `wg0.conf` (already gitignored under `edge/vpn-edge/`).
