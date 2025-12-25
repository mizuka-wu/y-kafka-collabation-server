# With-NestJs | API

## Getting Started

First, run the development server:

```bash
pnpm run dev
# Also works with NPM, YARN, BUN, ...
```

By default, your server will run at [localhost:3000](http://localhost:3000). You can use your favorite API platform like [Insomnia](https://insomnia.rest/) or [Postman](https://www.postman.com/) to test your APIs

You can start editing the demo **APIs** by modifying [linksService](./src/links/links.service.ts) provider.

## 与 apps/server 协同

本 demo 主要展示 `ProtocolProvider` + editor 客户端如何驱动服务端的 Kafka/MySQL pipeline。因为服务端暴露的是标准 REST 接口（`POST /collab/publish`、`POST /collab/persist`、`GET /collab/status`），你可以在任何 controller/service 中通过 `fetch` 或 `axios` 调用，而不需要直接嵌入 Kafka 客户端。

建议在 `apps/demo` 根目录（或项目根）建立 `.env` 文件，指定 `COLLAB_SERVER_URL`（如 `http://localhost:3000`），然后在业务代码里使用：

```ts
const baseUrl = process.env.COLLAB_SERVER_URL ?? 'http://localhost:3000';

async function publishUpdate(docId: string, content: string) {
  await fetch(`${baseUrl}/collab/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, content }),
  });
}

async function persistSnapshot(docId: string, snapshot: string) {
  return fetch(`${baseUrl}/collab/persist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, snapshot }),
  });
}
```

在实际 editor 里，可以监听 `Y.Doc` 更新，将 `Y.encodeStateAsUpdate(doc)` 或 awareness payload 发出去；在收到 Kafka 反馈或周期性同步时，再调用 `GET /collab/status` 取得当前 message count + snapshot。

如果想进一步复现 `ProtocolProvider` 行为，可以在 `apps/demo` 中直接使用 `Provider`，让它指向 `wss://your-kafka-gateway`，然后在服务端把 Kafka topic 与 MySQL 状态作为数据流观察点。

### Important Note 🚧

If you plan to `build` or `test` the app. Please make sure to build the `packages/*` first.

## Learn More

Learn more about `NestJs` with following resources:

- [Official Documentation](https://docs.nestjs.com) - A progressive Node.js framework for building efficient, reliable and scalable server-side applications.
- [Official NestJS Courses](https://courses.nestjs.com) - Learn everything you need to master NestJS and tackle modern backend applications at any scale.
- [GitHub Repo](https://github.com/nestjs/nest)
