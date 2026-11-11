# Scaleway Serverless Containers 中文部署说明

本文使用 GitHub Actions 已构建的镜像部署，无需在本地构建项目。
官方文档核对日期：2026-11-11；控制台名称如有调整，以实际界面为准。

## 1. 准备工作

- 已开通 Scaleway 账号，并有目标 Project 的容器、镜像仓库操作权限。
- 能进入 [GitHub Actions](https://github.com/zzdccww/scaleway-serverless-container/actions)，下载构建产物。
- 若采用镜像复制方式，准备一个能运行 Docker 的环境，用于加载、打标签和推送镜像；这些步骤都不会重新构建镜像。
- 准备一个新 UUID 和两个随机路径。不要使用仓库中 CI 的测试 UUID 或 `ci-smoke` 路径。

可在装有 Node.js 的环境分别执行以下命令，生成 UUID、WebSocket 路径和可选订阅路径。
命令只在自己的终端运行，生成结果不要发到公开评论或提交到仓库。

```bash
node -e "console.log(require('crypto').randomUUID())"
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## 2. 选择镜像来源

### 方案 A：将现成镜像复制到 Scaleway Container Registry

这是保持部署镜像独立于外部 Registry 的方式，也是 Scaleway 官方推荐的镜像来源。
Scaleway Container Registry 的 namespace 必须与 Serverless Container 位于同一 Project。

1. 在 Scaleway 控制台进入 **Container Registry**，选择区域并创建 namespace。
2. 记下控制台显示的完整 Registry 地址，例如 `rg.fr-par.scw.cloud/<你的-namespace>`。
3. 在 GitHub 打开一次成功的构建，下载 `serverless-containers-image-<提交号>`，解压得到 `serverless-containers-image.tar` 和 `serverless-containers-image.tar.sha256`。
4. 在两个文件所在目录校验并加载镜像。

Linux / WSL / Git Bash：

```bash
sha256sum --check serverless-containers-image.tar.sha256
docker load --input serverless-containers-image.tar
```

Windows PowerShell 可先运行 `Get-FileHash .\serverless-containers-image.tar -Algorithm SHA256`，
与 `.sha256` 文件中的值比较，再执行同一条 `docker load` 命令。

当前已经验证的镜像会加载为：

```text
ghcr.io/zzdccww/scaleway-serverless-container:sha-0a2ddee5ba841402589ca2ffaace2b8a275ac767
```

5. 登录 Scaleway Registry。下面的 `<你的-namespace>` 要替换成控制台显示的实际值。密码提示中输入具有该 Project 镜像推送权限的 Scaleway Secret Key，不要写进命令或文件。

```bash
docker login rg.fr-par.scw.cloud/<你的-namespace> --username nologin
```

6. 给加载的镜像打标签并推送。若使用其他区域，请同时替换 Registry 域名。

```bash
docker tag ghcr.io/zzdccww/scaleway-serverless-container:sha-0a2ddee5ba841402589ca2ffaace2b8a275ac767 rg.fr-par.scw.cloud/<你的-namespace>/node-ws:0a2ddee
docker push rg.fr-par.scw.cloud/<你的-namespace>/node-ws:0a2ddee
```

这些命令只上传现成镜像，不执行 `docker build`。
如下载的是后续构建，以 `docker load` 输出的完整镜像标签为准，并使用新版本标签。
镜像的源仓库可公开，Scaleway Registry namespace 可以继续保持私有。

### 方案 B：从公开的 GHCR 镜像直接部署

**仓库公开与镜像公开是两项设置。** 2026-11-11 部署复查时，GHCR 包已公开，
已验证固定版本镜像可以匿名拉取，因此本次实际部署采用此方案。
Scaleway 支持外部公开 Registry，不支持外部私有 Registry。

其他镜像若仍为私有，可由仓库所有者在 GitHub 个人主页的 **Packages** 中选择镜像，
进入 **Package settings → Change package visibility → Public**。
确认无需登录即可拉取镜像后，在 Scaleway 选择 **External Container Registry** 并填写：

```text
ghcr.io/zzdccww/scaleway-serverless-container:sha-0a2ddee5ba841402589ca2ffaace2b8a275ac767
```

外部公开 Registry 有拉取限流等不确定性；对启动稳定性有要求时使用方案 A。
GitHub Actions 后续构建继续向同一个 GHCR 包推送，不会自动修改该包的可见性。

## 3. 创建 Serverless Container

1. 在 Scaleway 控制台选择目标 Project、区域，进入 **Serverless → Containers**。
2. 创建或选择一个 Serverless Containers namespace。
3. 点击 **Deploy container**。
4. 采用方案 A 时，选择 **Scaleway Container Registry**，选择对应区域、namespace、镜像和版本。
5. 容器名称可填 `node-ws`，资源及网络设置如下。

| 配置项 | 起步值 | 说明 |
| --- | --- | --- |
| 架构 | `linux/amd64` / x86_64 | 已构建镜像的目标平台 |
| CPU | `100 mvCPU` | 本次华沙控制台最低可选值；FAQ 标注 70，但界面没有该选项 |
| 内存 | `128 MB` | 已通过启动和单连接验证 |
| 容器端口 | `8080` | 应用读取平台注入的 `PORT` |
| 协议 | `HTTP/1.1` | WebSocket 通过 HTTP Upgrade 建立连接 |
| Minimum scale | `0` | 允许无流量时缩容到 0 |
| Maximum scale | `1` | 限制为一个实例，便于控制额度 |
| 请求超时 | 按需求设置，上限 `3600` 秒 | 长连接需要客户端能自动重连 |
| HTTP 健康检查（若可配置） | `GET /healthz`，端口 `8080` | 正常返回 `200` 和 `ok` |

保留镜像默认启动命令，不需要填写自定义 command 或 args。
平台端口设置为 `8080`，不要把内部监听端口设成公网 TLS 的 `443`。

## 4. 配置环境变量

| 变量 | 是否必填 | 填写方式 |
| --- | --- | --- |
| `UUID` | 应固定设置 | 新生成的 UUID，放入 Secret environment variables |
| `WSPATH` | 应固定设置 | 随机字符串，不加开头 `/`，放入 Secret environment variables |
| `DOMAIN` | 生成订阅时需要 | Scaleway 分配的 hostname，不含 `https://`、路径或端口 |
| `SUB_PATH` | 可选 | 独立随机字符串，不加开头 `/`；不设置则关闭 HTTP 订阅入口 |
| `NAME` | 可选 | 节点备注，例如 `scaleway-paris` |
| `SELF_DESTRUCT` | 建议保持默认 | 镜像默认 `false`，容器部署保持关闭 |
| `PORT` | 平台提供 | 来自控制台端口配置，期望为 `8080` |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | 可选 | 仅需 Telegram 发送订阅时填写，使用 Secret environment variables |

`UUID` 和 `WSPATH` 未设置时会随机生成，实例重启后会改变，因此部署时应固定设置。
路径也承担访问保护作用，应使用随机值，并避免让 `SUB_PATH` 与 `WSPATH` 相同。

首次部署时若还不知道容器域名，可以先固定设置 `UUID`、`WSPATH` 后部署。
Ready 后复制控制台显示的 endpoint，只取 hostname 填入 `DOMAIN`，保存并重新部署。
未设置 `DOMAIN` 时 `/healthz` 仍可检查，订阅生成会跳过，启用的订阅路由会返回 `503`。

通常需要在容器高级选项中允许 **Public** 调用，才能直接使用普通客户端。
这表示公网可以到达入口，不代表需要公开 Registry 中的镜像。
如果使用平台 **Private / IAM authentication** 调用，客户端还必须满足 Scaleway 的平台鉴权要求。

## 5. 部署后验证

1. 等待控制台状态变为 **Ready**。
2. 浏览器访问 `https://<你的域名>/healthz`，应看到 `ok`。
3. 访问 `https://<你的域名>/`，应看到首页；首页可打开不代表 WebSocket 转发已经验证。
4. 如配置了 `SUB_PATH`，访问 `https://<你的域名>/<SUB_PATH>`，应返回 Base64 订阅。
5. 客户端使用相同的域名、UUID 和路径，连接参数为公网端口 `443`、TLS 开启、传输 `WebSocket`、路径 `/<WSPATH>`。
6. 实测一次连接、断开重连以及休眠后的冷启动，并观察 Scaleway 日志和指标。

项目在 Telegram 未配置或发送失败时，会把订阅输出到启动日志。
Base64 只是编码；订阅和日志中的 UUID、路径均应按凭据保护，不要贴到公开 Issue。
CI 中使用的固定 UUID、`ci-smoke` 和 `ci-sub` 均为公开测试数据。

## 6. 免费额度与运行边界

按本次核对的 FAQ，每月免费额度为 `200,000 vCPU-s` 和 `400,000 GB-s`。
按 FAQ 的换算方式，单实例 `70 mvCPU / 128 MB` 连续运行 31 天约消耗：

- CPU：`0.07 × 31 × 86400 = 187,488 vCPU-s`。
- 内存：`0.125 × 31 × 86400 = 334,800 GB-s`。

两项均在该额度内。但本次华沙控制台最低实际可选 CPU 为 `100 mvCPU`，部署采用
`100 mvCPU / 128 MB`，因此上述 70 mvCPU 的免费整月估算不适用于实际部署：

| 持续运行时间 | CPU 消耗 | 超出 200,000 vCPU-s 的部分 |
| --- | --- | --- |
| 30 天 | `259,200 vCPU-s` | `59,200 vCPU-s` |
| 31 天 | `267,840 vCPU-s` | `67,840 vCPU-s` |

100 mvCPU 在无其他消耗时可覆盖约 555.6 小时，即 23.15 天的累计运行时长；
内存 128 MB 的上述消耗不变。当前部署设置实例数 `0–1`，可在空闲时缩容，
但不能保证持续访问下整月零费用。请以当前定价、实际用量和账单为准。

这只是该单实例的估算；其他计算资源消耗、部署期间的实例重叠、
后续资源上调以及额外产品费用需要另外考虑。免费额度是按月计算，不是无限使用承诺。
Scaleway Container Registry 等独立产品也不能默认视为免费，应查看各自价格及账单。

`min-scale=0` 可减少低流量时运行量，但会产生冷启动；长连接和持续流量会影响缩容。
本项目的 `70 mvCPU / 128 MB` 验证只覆盖启动和单连接，不能据此承诺生产并发性能。
平台 HTTP 请求超时上限为 60 分钟，长时间 WebSocket 使用需要部署后验证并配置客户端重连。

## 7. 更新与回滚

代码推送到 `main` 或手动触发 Actions 后，流程依次构建、验证、发布镜像并导出 tar 包。
`latest` 指向最近一次通过验证的 main 构建；部署时建议记录并使用固定 `sha-<完整提交号>` 标签。

1. 更新：下载新镜像产物或拉取新 SHA 镜像，复制到 Scaleway Registry，选中新的版本再部署。
2. 回滚：在控制台选择先前保留的镜像版本，重新部署；不要覆盖作为回滚依据的旧标签。
3. 重新拉取：使用同名标签更新镜像时，也需要重新部署容器，仅推送镜像不会更新现有运行实例。

GitHub Actions 不会自动创建、修改或部署 Scaleway 资源。

## 8. 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 拉取 GHCR 返回 `401` / `403` | GHCR 包是否仍为私有；源码公库不会自动公开镜像 |
| 容器无法变为 Ready | 端口是否 `8080`、架构是否 amd64、启动日志是否有错误 |
| `/healthz` 正常但客户端连不上 | 平台调用权限、HTTP/1.1、域名、TLS、UUID、WSPATH 是否匹配 |
| 订阅返回 `503` | `DOMAIN` 是否已填写并重新部署 |
| 订阅路由返回 `404` | `SUB_PATH` 是否启用，路径是否多写 `/` |
| 运行后重启或内存不足 | 并发与流量是否超过最小档位，日志中是否出现 OOM |
| 空闲后首次访问较慢 | `min-scale=0` 的冷启动；如改为常驻，应重新评估资源消耗 |
| 镜像下载产物过期 | 在 Actions 重新运行构建，下载新的 tar 和校验文件 |

## 官方参考

- [控制台部署容器](https://www.scaleway.com/en/docs/serverless-containers/how-to/deploy-container/)
- [Serverless Containers FAQ](https://www.scaleway.com/en/docs/serverless-containers/faq/)
- [资源、架构和超时限制](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/)
