# Scaleway Serverless Containers 部署项目

基于 Node.js 的 HTTP / WebSocket 服务，适配 Scaleway Serverless Containers。
GitHub Actions 负责构建 `linux/amd64` 镜像，本地无需构建。

**完整操作步骤见：[中文部署说明](docs/deploy.zh-CN.md)。**

## 已完成的适配

- 使用 Node.js 24 Alpine，以非 root 用户运行。
- 监听 `0.0.0.0:$PORT`，默认端口 `8080`。
- 提供 `GET /healthz` 健康检查，默认关闭源码自毁逻辑。
- 镜像使用锁文件安装依赖，预设 Node.js 堆内存上限为 48 MB。
- GitHub Actions 在 `70 mvCPU / 128 MB` 限制下验证 HTTP、订阅路由和 WebSocket TCP 转发。
- 检查通过后推送 GHCR，并生成镜像 `.tar` 和 SHA-256 校验文件。

## 镜像和下载

| 项目 | 地址 |
| --- | --- |
| GHCR 镜像 | `ghcr.io/zzdccww/scaleway-serverless-container:latest` |
| 已验证的固定版本 | `ghcr.io/zzdccww/scaleway-serverless-container:sha-0a2ddee5ba841402589ca2ffaace2b8a275ac767` |
| 构建记录 | [GitHub Actions](https://github.com/zzdccww/scaleway-serverless-container/actions) |
| 已验证镜像下载 | [镜像 tar 包与校验文件](https://github.com/zzdccww/scaleway-serverless-container/actions/runs/42987224915/artifacts/13839478683) |
| 验证结果 | [verification.md](verification.md) |

源码仓库与 GHCR 包的可见性独立。**源码仓库公开不会自动公开 GHCR 镜像。**
2026-11-11 部署复查时，GHCR 包已公开，固定版本匿名拉取返回 `200`。
可以直接使用外部公开镜像，或复制到 Scaleway Container Registry。镜像产物保留 14 天，
下载通常需要登录 GitHub；过期后可在 Actions 页面手动重新运行构建。

## 推荐起步配置

| 配置 | 值 |
| --- | --- |
| 架构 | `linux/amd64` |
| CPU / 内存 | 按控制台可用档位；本次华沙实际部署为 `100 mvCPU / 128 MB` |
| 容器端口 | `8080` |
| 协议 | `HTTP/1.1` |
| 最小 / 最大实例数 | `0 / 1` |
| 健康检查 | HTTP `GET /healthz` |

部署时设置固定的 `UUID`、`WSPATH`，以及 Scaleway 分配的域名 `DOMAIN`。
实际凭据放在 Scaleway 的 Secret environment variables 中，不要提交到仓库。
示例 UUID 和路径仅供 CI 验证，不能作为生产配置。

镜像已在 Docker 的 `70 mvCPU / 128 MB` 限制下验证启动和单连接；本次 Scaleway
华沙控制台最低可选 CPU 为 `100 mvCPU`，已完成实际部署与 WSS/VLESS 转发验证。
按 `100 mvCPU` 连续运行整月可能超出 CPU 免费额度，详见中文说明。
GitHub Actions 只构建镜像，不会创建 Scaleway 资源或自动部署应用。
