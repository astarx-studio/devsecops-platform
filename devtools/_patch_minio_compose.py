from pathlib import Path

dt = "dev" + "tools"
p = Path(__file__).with_name("docker-compose.yml")
text = p.read_text(encoding="utf-8")
old_header_end = text.index("networks:")

header = "\n".join(
    [
        "# =============================================================================",
        f"# {dt} stack — shared Postgres + RabbitMQ + MinIO + logging",
        "# (Loki/Grafana/Alloy) for app teams on this host.",
        "#",
        "# Independent Compose project (deliberately separate from the main platform",
        "# stack). Run from the DevToolssecops-platform repo root:",
        "#",
        f"#   docker compose -p {dt} -f {dt}/docker-compose.yml up -d",
        f"#   docker compose -p {dt} -f {dt}/docker-compose.yml down",
        "#",
        "# Joins the *existing* devops-network created by the main stack (external),",
        "# so it's reachable by container name from Traefik and from the k3d server",
        f"# node — see {dt}/k8s-bridge.yaml for how pods reach it.",
        "#",
        "# Env isolation (generic):",
        "#   Postgres  → logical DBs created by project-specific scripts in",
        "#               postgres-init/ (gitignored; copy from *.sample.sh)",
        f"#   RabbitMQ  → vhosts {'dev'} / stg  (created by rabbitmq-init/ensure-vhosts.sh)",
        "#   MinIO     → users admin (root) + cfa (readwrite); buckets cfa-dev / cfa-stg",
        "#   Logging   → Loki labels (namespace / app / container); Grafana UI via",
        "#               https://${GRAFANA_DOMAIN} + oidc-auth-devtools (admins+users)",
        "#",
        f"# k3d pod logs: apply {dt}/k8s/alloy-daemonset.yaml after the bridge.",
        "# =============================================================================",
        "",
        "",
    ]
).replace("DevToolssecops-platform", "devsecops-platform")

rest = text[old_header_end:]
if f"{dt}-minio:" not in rest:
    minio_lines = [
        "",
        "  # Shared MinIO (S3). Root user is admin; cfa service user + buckets from",
        "  # minio-init/ensure-users.sh. Console HTTPS via oidc-auth-devtools; S3 API",
        "  # HTTPS without SSO (access-key auth) + TCP passthrough :29000.",
        f"  {dt}-minio:",
        "    image: quay.io/minio/minio:latest",
        f"    container_name: {dt}-minio",
        "    restart: unless-stopped",
        "    command: server /data --console-address :9001",
        "    environment:",
        "      MINIO_ROOT_USER: ${DEVTOOLS_MINIO_ROOT_USER:-admin}",
        f"      MINIO_ROOT_PASSWORD: ${{DEVTOOLS_MINIO_ROOT_PASSWORD:?set DEVTOOLS_MINIO_ROOT_PASSWORD in {dt}/.env}}",
        f"      MINIO_SERVER_URL: https://${{DEVTOOLS_MINIO_API_DOMAIN:?set DEVTOOLS_MINIO_API_DOMAIN in {dt}/.env}}",
        f"      MINIO_BROWSER_REDIRECT_URL: https://${{DEVTOOLS_MINIO_CONSOLE_DOMAIN:?set DEVTOOLS_MINIO_CONSOLE_DOMAIN in {dt}/.env}}",
        "    volumes:",
        "      - ./.vols/minio:/data",
        "    healthcheck:",
        '      test: ["CMD-SHELL", "curl -sf http://127.0.0.1:9000/minio/health/live || exit 1"]',
        "      interval: 10s",
        "      timeout: 5s",
        "      retries: 8",
        "      start_period: 15s",
        "    labels:",
        '      traefik.enable: "true"',
        "      # S3 API — access-key auth only (do not put oauth2-proxy in front).",
        f'      traefik.http.routers.{dt}-minio-api.rule: "Host(`${{DEVTOOLS_MINIO_API_DOMAIN}}`)"',
        f'      traefik.http.routers.{dt}-minio-api.entrypoints: "websecure"',
        f'      traefik.http.routers.{dt}-minio-api.tls.certresolver: "letsencrypt"',
        f'      traefik.http.routers.{dt}-minio-api.service: "{dt}-minio-api"',
        f'      traefik.http.services.{dt}-minio-api.loadbalancer.server.port: "9000"',
        "      # Console — platform SSO (admins+users) then MinIO login form.",
        f'      traefik.http.routers.{dt}-minio-console.rule: "Host(`${{DEVTOOLS_MINIO_CONSOLE_DOMAIN}}`)"',
        f'      traefik.http.routers.{dt}-minio-console.entrypoints: "websecure"',
        f'      traefik.http.routers.{dt}-minio-console.tls.certresolver: "letsencrypt"',
        f'      traefik.http.routers.{dt}-minio-console.middlewares: "oidc-auth-devtools@file"',
        f'      traefik.http.routers.{dt}-minio-console.service: "{dt}-minio-console"',
        f'      traefik.http.services.{dt}-minio-console.loadbalancer.server.port: "9001"',
        "    networks:",
        "      devops-network:",
        "        ipv4_address: ${DEVTOOLS_MINIO_STATIC_IP:-172.19.0.103}",
        "",
        f"  {dt}-minio-init:",
        "    image: quay.io/minio/mc:latest",
        f"    container_name: {dt}-minio-init",
        "    depends_on:",
        f"      {dt}-minio:",
        "        condition: service_healthy",
        '    restart: "no"',
        "    environment:",
        "      MINIO_ROOT_USER: ${DEVTOOLS_MINIO_ROOT_USER:-admin}",
        f"      MINIO_ROOT_PASSWORD: ${{DEVTOOLS_MINIO_ROOT_PASSWORD:?set DEVTOOLS_MINIO_ROOT_PASSWORD in {dt}/.env}}",
        "      DEVTOOLS_MINIO_CFA_USER: ${DEVTOOLS_MINIO_CFA_USER:-cfa}",
        f"      DEVTOOLS_MINIO_CFA_PASSWORD: ${{DEVTOOLS_MINIO_CFA_PASSWORD:?set DEVTOOLS_MINIO_CFA_PASSWORD in {dt}/.env}}",
        f"      MINIO_ENDPOINT: http://{dt}-minio:9000",
        "    volumes:",
        "      - ./minio-init/ensure-users.sh:/ensure-users.sh:ro",
        '    entrypoint: ["/bin/sh", "/ensure-users.sh"]',
        "    networks:",
        "      - devops-network",
        "",
    ]
    minio_block = "\n".join(minio_lines)
    marker = "  # Alloy — scrape Docker container logs"
    if marker in rest:
        rest = rest.replace(marker, minio_block + "\n" + marker, 1)
    else:
        rest = rest.rstrip() + "\n" + minio_block + "\n"

p.write_text(header + rest, encoding="utf-8")
print("ok", f"{dt}-minio:" in p.read_text(encoding="utf-8"))
