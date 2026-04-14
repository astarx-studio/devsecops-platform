# Deployments

← [Back to Developer Guide](index.md)

Once your pipeline builds a Docker image and pushes it to the registry, the next step is deploying it so it's actually running somewhere. This page explains what's available today and where the platform is headed.

---

## What's set up when your project is provisioned

When the Management API creates your project, it registers a **Kong route** for your service. This means there's already a URL in place for your application — requests to that URL will be forwarded to your service once it's running.

Your initial project template may also include a deployment stage in `.gitlab-ci.yml`. Depending on how your project was set up, this might be:

- A **manual trigger** — a play button appears in the pipeline after the build step, and you click it to deploy
- An **automatic step** — the pipeline deploys automatically after a successful build

Check your pipeline configuration (`.gitlab-ci.yml`) to see what's set up.

---

## How deployments work in v1

In v1, all projects deploy to the **same server** as the platform (called `local` mode). There's no SSH remote deployment or Kubernetes integration in this version — those would require a separate orchestration layer that isn't part of v1.

When the Management API provisions your project, it registers a Kong route for it. This route points to a container it expects to be running on the server at `http://{clientName}-{projectName}:3000`. That's the naming convention — if your client is `acme` and your project is `webapp`, Kong expects to reach your app at `http://acme-webapp:3000` on the platform network.

Your deployment pipeline (configured in `.gitlab-ci.yml`) is responsible for actually starting that container. The `deploy-compose` template handles this: the runner pulls the latest image and runs `docker compose up -d` via the host's Docker socket (the runner has access to the host Docker daemon). This step is a **manual trigger** in the pipeline — it won't run automatically after every push. You click the play button to deploy.

---

## Where the gaps are

The current setup works, but it's deliberately minimal. Here's what's honest about it:

There's no automatic rollback if a deployment fails. If a bad image is deployed and the container crashes, you need to manually pull the previous image and restart.

Health checks are basic — the pipeline doesn't wait to confirm your application is healthy after deployment. If your container starts but immediately crashes, the pipeline will still show "success."

There's no environment promotion (dev → staging → production). Every deployment goes to the same server. Building a multi-environment setup would require duplicating the entire platform or adding an environment-aware deployment layer.

Future versions could improve this by adding a deployment job queue, health gate steps, and multi-server support. For v1, the goal is a working pipeline that gets an image running — not a production-grade release system.

---

## Checking if your deployment is running

Once deployed, your application is reachable at the URL that was registered in Kong during provisioning. The URL format is:

```
https://{projectName}.apps.yourdomain.com
```

For example, if your project is `webapp` under client `acme`, it would be:

```
https://webapp.apps.yourdomain.com
```

Ask your platform admin if you're unsure of your exact URL.

If the URL returns a 404, check that:
1. The Kong route exists — your admin can verify this in the Kong admin UI
2. Your service container is running — check `docker compose ps` on the server
3. The container is named correctly (`{clientName}-{projectName}`) and listening on port 3000
4. Your container is on the platform's Docker network (`devops-network`)
