# Container build verification

- Application commit: `0a2ddee5ba841402589ca2ffaace2b8a275ac767`
- GitHub Actions: [successful run 42987224915](https://github.com/zzdccww/scaleway-serverless-container/actions/runs/42987224915)
- Image: `ghcr.io/zzdccww/scaleway-serverless-container:sha-0a2ddee5ba841402589ca2ffaace2b8a275ac767`
- Image digest: `sha256:5de74bbefc4bb8d2e14320a25456604d66c409cb06ac9dcfa87bc3c3db0b73b0`
- Architecture: `linux/amd64`; runtime: Node.js 24 Alpine.
- No local Docker image was built. GitHub Actions built, tested and published the image.

## Passed checks

- JavaScript syntax checks for the application and smoke script.
- Credential pattern scan over application and build files: no findings.
- Git whitespace check.
- GitHub container runtime with `--cpus 0.07 --memory 128m --memory-swap 128m`.
- Read-only root filesystem and unprivileged application process.
- HTTP health, homepage, missing route and favicon responses.
- Subscription route output with an explicitly configured identity and domain.
- Authenticated WebSocket TCP round trip to a local echo service.
- SIGTERM shutdown exited with code 0; the container was not OOM-killed.
- Container memory snapshot after smoke verification: 18.57 MiB / 128 MiB.
- Both the immutable SHA tag and `latest` were pushed to GHCR.

## Image archive

[Download the image archive and SHA-256 checksum](https://github.com/zzdccww/scaleway-serverless-container/actions/runs/42987224915/artifacts/13839478683)

The artifact contains `serverless-containers-image.tar` and its `.sha256` file.
GitHub reports a compressed artifact size of 63,294,252 bytes. The retention
period is 14 days. Repository access is required to download the artifact.

## Scope and remaining deployment checks

This verifies startup and one connection under Docker resource constraints;
it is not a production load test or a Scaleway platform test. Scaleway gVisor,
ingress WebSocket behavior, request timeouts and real traffic still need to be
checked after deployment. No Scaleway resources have been created or changed.
Source repository visibility and GHCR package visibility are independent.
For the private image, copy it to a Scaleway Container Registry in the same
Project before deployment, following [the Chinese deployment guide](docs/deploy.zh-CN.md).

## Public source review (2026-11-11)

- Gitleaks v8.30.1 scanned both existing commits with all reachable Git history:
  no secrets detected.
- Gitleaks separately scanned the complete homepage HTML and the successful
  GitHub Actions build log: no secrets detected.
- Manual review found runtime credentials are supplied through environment
  variables. The fixed UUID and paths in the workflow and smoke script are
  explicitly documented CI fixtures, not production credentials.
- No committed `.env`, private key, API key or local configuration was found.
- Local audit tools and reports under `.codex/` are ignored by Git and Docker.
- The saved homepage contains public article content and referral links;
  these are not service credentials. No email address was found in the HTML.
- GHCR anonymous access returned `401` during this review. Making the source
  repository public does not change the package visibility.

These are automated scans and a targeted manual review, not a guarantee that
all possible sensitive content can be recognized.

## Actual Scaleway deployment (2026-11-11)

- Deployed the verified immutable GHCR image in `pl-waw` using the existing
  Serverless Containers namespace; no additional registry, network or gateway
  was provisioned.
- The GHCR package was already public at deployment time. Anonymous manifest
  retrieval returned HTTP 200 with the expected image digest.
- The console's lowest selectable CPU was 100 mVCPU, for both sandbox choices;
  70 mVCPU was not offered. The actual deployment uses 100 mVCPU / 128 MB,
  sandbox v2, min-scale 0 and max-scale 1.
- Runtime configuration: port 8080, HTTP/1.1, public invocation, HTTPS only,
  3600-second request timeout, HTTP `/healthz` liveness probe.
- Newly generated UUID, WebSocket path and subscription path are stored as
  Scaleway secrets. Client access information remains only in the ignored
  local `.codex/scaleway-access.json`, outside the public repository.
- The console reports Ready; public health and homepage return HTTP 200,
  an unknown path returns 404, and the subscription route returns the expected
  configured identity, domain and WebSocket path.
- An external WSS/VLESS client connected through the deployed endpoint and
  forwarded an HTTP request to example.com:80 successfully.
- This is a smoke check, not a concurrency or 60-minute connection test.
- At 100 mVCPU, continuous full-month operation exceeds 200,000 vCPU-s;
  scale-to-zero reduces runtime but does not guarantee zero cost.
