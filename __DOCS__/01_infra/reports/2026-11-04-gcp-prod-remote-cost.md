# prod-remote cost estimate — qestor full-stack on GKE (asia-southeast2)

_Generated 2026-11-04. On-demand list prices ±~10% regional variance; spot at 70% off (published 60-91%)._

| Scenario | Monthly total |
|---|---|
| **S1 Minimal (1 node, all-in)** | **$146.29** |
| **S2 Recommended (spot app pool)** | **$158.69** |
| **S2b Same, app pool ON-DEMAND** | **$309.95** |
| **S3 HA regional (3 zones)** | **$457.97** |
| **S4 Autopilot (6vCPU/16GiB pods)** | **$288.65** |


## S1 Minimal (1 node, all-in) — $146.29/mo

- compute: $108.04
- boot disk (50GB std): $2.00
- postgres PV (100GB balanced): $10.00
- GCS Standard (100GB): $2.00
- load balancer: $18.25
- egress (50GB): $6.00
- GKE cluster fee (free tier): $0.00

## S2 Recommended (spot app pool) — $158.69/mo

- compute: db/system node e2-standard-2 (on-demand): $54.02
- compute: 2x app nodes e2-standard-4 (SPOT 70% off): $64.82
- boot disks (3x 30GB std): $3.60
- postgres PV (100GB balanced): $10.00
- GCS Standard (100GB): $2.00
- load balancer: $18.25
- egress (50GB): $6.00
- GKE cluster fee (free tier): $0.00

## S2b Same, app pool ON-DEMAND — $309.95/mo

- compute: db/system node e2-standard-2 (on-demand): $54.02
- compute: 2x app nodes e2-standard-4 (SPOT 70% off): $216.08
- boot disks (3x 30GB std): $3.60
- postgres PV (100GB balanced): $10.00
- GCS Standard (100GB): $2.00
- load balancer: $18.25
- egress (50GB): $6.00
- GKE cluster fee (free tier): $0.00

## S3 HA regional (3 zones) — $457.97/mo

- GKE cluster fee (regional, no free tier): $73.00
- compute: 3x e2-standard-4 on-demand (1/zone): $324.12
- boot disks (3x 30GB std): $3.60
- postgres regional PD (2x100GB balanced): $20.00
- GCS Standard (100GB): $2.00
- load balancer (+multi-zone): $23.25
- egress (100GB): $12.00

## S4 Autopilot (6vCPU/16GiB pods) — $288.65/mo

- pods: 6 vCPU: $194.91
- pods: 16 GiB mem: $57.49
- postgres PV (100GB balanced): $10.00
- GCS Standard (100GB): $2.00
- load balancer: $18.25
- egress (50GB): $6.00
- GKE cluster fee (free tier covers Autopilot): $0.00

## Assumptions

- Workload: qestor core + Hasura + console (~4 vCPU / 8 GiB), Postgres (2 vCPU / 8 GiB, 100 GB), object storage moved to a 100 GB GCS Standard bucket.
- Region: asia-southeast2 (Jakarta) — single zonal cluster so the $74.40/mo GKE free tier covers the $73 cluster fee (S1, S2, S4). Regional cluster (S3) is not covered.
- No Cloud NAT (public GKE endpoint). Add ~$32/mo + data if you want private nodes.
- Sustained-use discounts do NOT apply to e2; committed-use discounts (28-46%) possible once steady-state usage is known.
- Existing baseline (tunnel VM + static IP + disk) runs roughly $15-20/mo on top, unchanged.