from pathlib import Path

root = Path(__file__).resolve().parents[1]
dt = "dev" + "tools"

# --- sample.env ---
sample = root / dt / "sample.env"
st = sample.read_text(encoding="utf-8")
if "DEVTOOLS_MINIO_STATIC_IP" not in st:
    st = st.rstrip() + "\n\n" + "\n".join(
        [
            "# --- MinIO (S3) --------------------------------------------------------------",
            "DEVTOOLS_MINIO_STATIC_IP=172.19.0.103",
            "DEVTOOLS_MINIO_ROOT_USER=admin",
            "DEVTOOLS_MINIO_ROOT_PASSWORD=change-me",
            "DEVTOOLS_MINIO_CFA_USER=cfa",
            "DEVTOOLS_MINIO_CFA_PASSWORD=change-me",
            "# Must match aliases on main Traefik (sample.env / .env).",
            "DEVTOOLS_MINIO_API_DOMAIN=s3-devtools.devops.yourdomain.com",
            "DEVTOOLS_MINIO_CONSOLE_DOMAIN=minio-devtools.devops.yourdomain.com",
            "",
        ]
    )
    sample.write_text(st, encoding="utf-8")

# --- live DevTools/.env (append secrets; do not print) ---
envp = root / dt / ".env"
et = envp.read_text(encoding="utf-8") if envp.exists() else ""
admin_pw = "PFW2FZUrdyu3OAGYZfObg7NZ"
cfa_pw = "rprk1riD2q6QQOThXOEWGdC4"
if "DEVTOOLS_MINIO_ROOT_PASSWORD=" not in et:
    et = et.rstrip() + "\n\n" + "\n".join(
        [
            "# --- MinIO (S3) --------------------------------------------------------------",
            "DEVTOOLS_MINIO_STATIC_IP=172.19.0.103",
            "DEVTOOLS_MINIO_ROOT_USER=admin",
            f"DEVTOOLS_MINIO_ROOT_PASSWORD={admin_pw}",
            "DEVTOOLS_MINIO_CFA_USER=cfa",
            f"DEVTOOLS_MINIO_CFA_PASSWORD={cfa_pw}",
            "DEVTOOLS_MINIO_API_DOMAIN=s3-devtools.devops.yadatechnology.com",
            "DEVTOOLS_MINIO_CONSOLE_DOMAIN=minio-devtools.devops.yadatechnology.com",
            "",
        ]
    )
    envp.write_text(et, encoding="utf-8")

# --- main sample.env domains ---
ms = root / "sample.env"
mt = ms.read_text(encoding="utf-8")
if "DEVTOOLS_MINIO_API_DOMAIN" not in mt:
    mt = mt.replace(
        "GRAFANA_DOMAIN=grafana.devops.yourdomain.com\n",
        "GRAFANA_DOMAIN=grafana.devops.yourdomain.com\n"
        "DEVTOOLS_MINIO_API_DOMAIN=s3-devtools.devops.yourdomain.com\n"
        "DEVTOOLS_MINIO_CONSOLE_DOMAIN=minio-devtools.devops.yourdomain.com\n",
        1,
    )
    ms.write_text(mt, encoding="utf-8")

# --- main .env aliases (domains only; no minio root secrets here) ---
menv = root / ".env"
if menv.exists():
    met = menv.read_text(encoding="utf-8")
    if "DEVTOOLS_MINIO_API_DOMAIN=" not in met:
        met = met.rstrip() + "\n" + "\n".join(
            [
                "DEVTOOLS_MINIO_API_DOMAIN=s3-devtools.devops.yadatechnology.com",
                "DEVTOOLS_MINIO_CONSOLE_DOMAIN=minio-devtools.devops.yadatechnology.com",
                "",
            ]
        )
        menv.write_text(met, encoding="utf-8")

# --- traefik aliases ---
compose = root / "docker-compose.yml"
ct = compose.read_text(encoding="utf-8")
if "DEVTOOLS_MINIO_API_DOMAIN" not in ct.split("aliases:")[1].split("\n\n")[0]:
    ct = ct.replace(
        "          - ${GRAFANA_DOMAIN}\n",
        "          - ${GRAFANA_DOMAIN}\n"
        "          - ${DEVTOOLS_MINIO_API_DOMAIN}\n"
        "          - ${DEVTOOLS_MINIO_CONSOLE_DOMAIN}\n",
        1,
    )
if '"29000:29000"' not in ct and "29000:29000" not in ct:
    ct = ct.replace(
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n',
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n'
        '      - "29000:29000" # DevTools shared MinIO S3 API (TCP passthrough)\n',
        1,
    )
    # try lowercase comment variant
    ct = ct.replace(
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n',
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n'
        '      - "29000:29000" # DevTools shared MinIO S3 API (TCP passthrough)\n',
        1,
    )
if "29000:29000" not in ct:
    ct = ct.replace(
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n',
        '      - "25682:25682" # DevTools shared RabbitMQ Management UI\n'
        '      - "29000:29000" # DevTools shared MinIO S3 API (TCP passthrough)\n',
        1,
    )
# match actual file comment
if "29000:29000" not in ct:
    needle = '      - "25682:25682"'
    if needle in ct:
        idx = ct.index(needle)
        end = ct.index("\n", idx) + 1
        ct = ct[:end] + '      - "29000:29000" # DevTools shared MinIO S3 API (TCP passthrough)\n' + ct[end:]
compose.write_text(ct, encoding="utf-8")

# --- traefik static entrypoint ---
tr = root / "traefik" / "traefik.yml"
tt = tr.read_text(encoding="utf-8")
if "devtools-minio-s3" not in tt:
    tt = tt.replace(
        "  DevTools-amqp-mgmt:\n    address: \":25682\"\n",
        "  DevTools-amqp-mgmt:\n    address: \":25682\"\n"
        "  DevTools-minio-s3:\n    address: \":29000\"\n",
        1,
    )
if "devtools-minio-s3" not in tt:
    tt = tt.replace(
        "  DevTools-amqp-mgmt:\n    address: \":25682\"\n",
        "  DevTools-amqp-mgmt:\n    address: \":25682\"\n"
        "  DevTools-minio-s3:\n    address: \":29000\"\n",
        1,
    )
# actual keys are lowercase DevTools-amqp-mgmt? check file — they are DevTools-pg etc? From read: DevTools-pg is wrong, file has DevTools-pg as DevTools? Earlier read showed:
#   DevTools-pg: NO — "devtools-pg"
if "devtools-minio-s3" not in tt:
    tt = tt.replace(
        '  DevTools-amqp-mgmt:\n    address: ":25682"\n',
        '  DevTools-amqp-mgmt:\n    address: ":25682"\n'
        '  DevTools-minio-s3:\n    address: ":29000"\n',
    )
if "devtools-minio-s3" not in tt:
    tt = tt.replace(
        '  DevTools-amqp-mgmt:\n    address: ":25682"\n',
        "",
    )
# force with real key names from file
if "devtools-minio-s3" not in tt:
    key = "devtools-amqp-mgmt"
    block = (
        f"  {key}:\n"
        '    address: ":25682"\n'
        "  DevTools-minio-s3:\n".replace("DevTools-minio-s3", "devtools-minio-s3")
        + '    address: ":29000"\n'
    )
    old = f'  {key}:\n    address: ":25682"\n'
    if old in tt:
        tt = tt.replace(old, block, 1)
tr.write_text(tt, encoding="utf-8")

# --- tcp passthrough ---
tcp = root / "traefik" / "dynamic" / "tcp-passthrough.yml"
tp = tcp.read_text(encoding="utf-8")
if "devtools-minio-s3" not in tp:
    tp = tp.rstrip() + "\n\n" + "\n".join(
        [
            "    DevTools-minio-s3:",
            '      rule: "HostSNI(`*`)"',
            "      entryPoints:",
            "        - DevTools-minio-s3",
            "      service: DevTools-minio-s3",
            "",
            "  # NOTE: services block merge — appended below if missing",
            "",
        ]
    )
    # Better: surgical insert into routers and services with lowercase
    tp = tcp.read_text(encoding="utf-8")
    if "devtools-minio-s3" not in tp:
        tp = tp.replace(
            "    DevTools-amqp-mgmt:\n"
            '      rule: "HostSNI(`*`)"\n'
            "      entryPoints:\n"
            "        - DevTools-amqp-mgmt\n"
            "      service: DevTools-amqp-mgmt\n",
            "    DevTools-amqp-mgmt:\n"
            '      rule: "HostSNI(`*`)"\n'
            "      entryPoints:\n"
            "        - DevTools-amqp-mgmt\n"
            "      service: DevTools-amqp-mgmt\n"
            "\n"
            "    DevTools-minio-s3:\n"
            '      rule: "HostSNI(`*`)"\n'
            "      entryPoints:\n"
            "        - DevTools-minio-s3\n"
            "      service: DevTools-minio-s3\n",
        )
        # lowercase
        tp = tcp.read_text(encoding="utf-8")
        old_r = (
            "    DevTools-amqp-mgmt:\n"
            '      rule: "HostSNI(`*`)"\n'
            "      entryPoints:\n"
            "        - DevTools-amqp-mgmt\n"
            "      service: DevTools-amqp-mgmt\n"
        )
        # use actual lowercase from file
        old_r = (
            "    DevTools-amqp-mgmt:\n".replace("DevTools", "devtools")
        )
tcp.write_text(tp if "devtools-minio-s3" in tp else tcp.read_text(encoding="utf-8"), encoding="utf-8")

# Rewrite tcp file cleanly by parsing known structure
tp = Path(root / "traefik" / "dynamic" / "tcp-passthrough.yml").read_text(encoding="utf-8")
if "devtools-minio-s3" not in tp:
    tp = tp.replace(
        """    DevTools-amqp-mgmt:
      rule: "HostSNI(`*`)"
      entryPoints:
        - DevTools-amqp-mgmt
      service: DevTools-amqp-mgmt
""".replace("DevTools", "devtools"),
        """    DevTools-amqp-mgmt:
      rule: "HostSNI(`*`)"
      entryPoints:
        - DevTools-amqp-mgmt
      service: DevTools-amqp-mgmt

    DevTools-minio-s3:
      rule: "HostSNI(`*`)"
      entryPoints:
        - DevTools-minio-s3
      service: DevTools-minio-s3
""".replace("DevTools", "devtools"),
        1,
    )
    tp = tp.replace(
        """    DevTools-amqp-mgmt:
      loadBalancer:
        servers:
          - address: "DevTools-rabbitmq:15672"
""".replace("DevTools", "devtools"),
        """    DevTools-amqp-mgmt:
      loadBalancer:
        servers:
          - address: "DevTools-rabbitmq:15672"

    DevTools-minio-s3:
      loadBalancer:
        servers:
          - address: "DevTools-minio:9000"
""".replace("DevTools", "devtools"),
        1,
    )
    Path(root / "traefik" / "dynamic" / "tcp-passthrough.yml").write_text(tp, encoding="utf-8")

# --- k8s bridge ---
bridge = root / dt / "k8s-bridge.yaml"
bt = bridge.read_text(encoding="utf-8")
if f"{dt}-minio" not in bt:
    bt = bt.rstrip() + "\n\n" + "\n".join(
        [
            "---",
            "apiVersion: v1",
            "kind: Service",
            "metadata:",
            f"  name: {dt}-minio",
            f"  namespace: {dt}",
            "spec:",
            "  ports:",
            "    - name: s3",
            "      port: 9000",
            "    - name: console",
            "      port: 9001",
            "---",
            "apiVersion: v1",
            "kind: Endpoints",
            "metadata:",
            f"  name: {dt}-minio",
            f"  namespace: {dt}",
            "subsets:",
            "  - addresses:",
            "      # Must match DEVTOOLS_MINIO_STATIC_IP in DevTools/.env.",
            "      - ip: 172.19.0.103",
            "    ports:",
            "      - name: s3",
            "        port: 9000",
            "      - name: console",
            "        port: 9001",
            "",
        ]
    ).replace("DevTools/.env", f"{dt}/.env")
    # header comment update
    bt = bt.replace(
        f"{dt}-postgres and {dt}-rabbitmq run as plain Docker containers",
        f"{dt}-postgres, {dt}-rabbitmq, and {dt}-minio run as plain Docker containers",
        1,
    )
    if f"{dt}-minio.{dt}.svc" not in bt:
        bt = bt.replace(
            f"#   {dt}-rabbitmq.{dt}.svc.cluster.local:15672  (Management UI)\n",
            f"#   {dt}-rabbitmq.{dt}.svc.cluster.local:15672  (Management UI)\n"
            f"#   {dt}-minio.{dt}.svc.cluster.local:9000      (S3 API)\n",
            1,
        )
    bridge.write_text(bt, encoding="utf-8")

# --- apply-k8s-bridge.sh ---
sh = root / dt / "apply-k8s-bridge.sh"
stxt = sh.read_text(encoding="utf-8")
stxt = stxt.replace(
    f"for c in {dt}-postgres {dt}-rabbitmq {dt}-loki; do",
    f"for c in {dt}-postgres {dt}-rabbitmq {dt}-loki {dt}-minio; do",
)
if f"{dt}-minio" not in stxt.split("info ")[-1]:
    stxt = stxt.replace(
        f'info "  Loki:      {dt}-loki.{dt}.svc.cluster.local:3100"',
        f'info "  Loki:      {dt}-loki.{dt}.svc.cluster.local:3100"\n'
        f'info "  MinIO S3:  {dt}-minio.{dt}.svc.cluster.local:9000"',
    )
sh.write_text(stxt, encoding="utf-8")

# --- edge forward ports ---
for rel in [
    Path("edge/vpn-edge/forward-ports.sample.env"),
    Path("edge/vpn-edge/forward-ports.env"),
]:
    fp = root / rel
    if not fp.exists():
        continue
    ft = fp.read_text(encoding="utf-8")
    if "29000:29000" not in ft:
        ft = ft.replace(
            "FORWARD_TCP=80:10080,443:10443,12222:12222,25432:25432,25672:25672,25682:25682",
            "FORWARD_TCP=80:10080,443:10443,12222:12222,25432:25432,25672:25672,25682:25682,29000:29000",
        )
        if "29000" not in ft:
            # append comment + rewrite any FORWARD_TCP line
            import re

            ft2, n = re.subn(
                r"^(FORWARD_TCP=.*)$",
                r"\1,29000:29000",
                ft,
                count=1,
                flags=re.M,
            )
            if n:
                ft = ft2
        fp.write_text(ft, encoding="utf-8")

print("wiring patch complete")
print("compose has 29000", "29000:29000" in compose.read_text(encoding="utf-8"))
print("traefik has minio entry", "devtools-minio-s3" in tr.read_text(encoding="utf-8"))
print("tcp has minio", "devtools-minio-s3" in Path(root / "traefik/dynamic/tcp-passthrough.yml").read_text(encoding="utf-8"))
print("bridge has minio", f"{dt}-minio" in bridge.read_text(encoding="utf-8"))
