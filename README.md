# Scaleway Serverless Containers deployment

This repository packages the Node.js WebSocket service for Scaleway Serverless
Containers. GitHub Actions builds a Node.js 24 `linux/amd64` image, verifies it
with a 128 MB memory limit and 0.07 CPU limit, publishes it to GHCR, and uploads
a Docker image tarball with a SHA-256 checksum as a workflow artifact.

## Scaleway settings

- Architecture: `x86_64` / `linux/amd64`
- CPU: `70 mvCPU`
- Memory: `128 MB`
- Container port: `8080`
- Environment variable: `PORT=8080`
- Health check: `GET /healthz`
- Recommended minimum scale: `0`
- Maximum scale for a single instance budget: `1`
- Protocol: `HTTP/1.1` (WebSocket uses HTTP Upgrade)

The process binds to the `PORT` environment variable and does not require a
public IP. Set a fixed `UUID` and `WSPATH` in secret environment variables so
clients continue to work across restarts. Set `DOMAIN` to the assigned
Scaleway hostname without a scheme or port; public TLS terminates at Scaleway
on port 443. `SUB_PATH` optionally enables a subscription route and defaults to
disabled. Keep Telegram credentials in Scaleway secret environment variables
rather than committing them. The service can print subscription credentials
to startup logs, so restrict access to logs.

`SELF_DESTRUCT` defaults to `false` for container operation. Set it to `true`
only when the legacy self-destruction behavior is explicitly required.

## Image locations

After a successful workflow on `main`, use:

```text
ghcr.io/zzdccww/scaleway-serverless-container:latest
```

The workflow run also exposes `serverless-containers-image-<commit>` as a
downloadable artifact. Load it locally with:

```bash
sha256sum --check serverless-containers-image.tar.sha256
docker load --input serverless-containers-image.tar
```

The image is built by GitHub Actions; no local Docker build is required.

## Next deployment step

The repository and GHCR package are private by default. To deploy without
making them public, copy the image to a Scaleway Container Registry namespace
in the same Project as the Serverless Container. This does not rebuild it.
For example, after logging in to both registries with your own credentials:

```bash
docker pull ghcr.io/zzdccww/scaleway-serverless-container:sha-<full-commit>
docker tag ghcr.io/zzdccww/scaleway-serverless-container:sha-<full-commit> rg.fr-par.scw.cloud/<namespace>/node-ws:<full-commit>
docker push rg.fr-par.scw.cloud/<namespace>/node-ws:<full-commit>
```

Select the image in Serverless Containers, set the environment variables and
port above, and check `/healthz` and a real WebSocket client connection. To
roll back, select the previous immutable commit image and deploy again.
The workflow does not create Scaleway resources or deploy the application.
The minimum resource check covers startup and one connection; concurrent
production traffic can need more CPU or memory. WebSocket lifetime is also
subject to the platform request timeout (maximum 60 minutes).

References: [Scaleway FAQ](https://www.scaleway.com/en/docs/serverless-containers/faq/),
[container limitations](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/).
