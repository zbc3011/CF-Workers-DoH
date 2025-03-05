# CF-Workers-DoH
![img](./img.png)

CF-Workers-DoH 是一个基于 Cloudflare Workers 构建的 DNS over HTTPS (DoH) 解析服务。它允许你通过 HTTPS 协议进行 DNS 查询，提高查询的安全性和隐私保护。

## 🚀 部署方式

- **Workers** 部署：复制 [_worker.js](https://github.com/cmliu/CF-Workers-DoH/blob/main/_worker.js) 代码，`保存并部署`即可
- **Pages** 部署：`Fork` 后 `连接GitHub` 一键部署即可

## 📖 使用方法

例如 **Workers项目域名** 为：`doh.090227.xyz`；

在支持 DoH 的客户端或应用中，将 DoH 地址设置为：
```url
https://doh.090227.xyz/dns-query
```

## 🔧 变量说明

| 变量名 | 示例 | 必填 | 备注 | 
|--|--|--|--|
| DOH | `dns.google` |❌| 设置上游DoH服务（默认：`cloudflare-dns.com`） |
| TOKEN | `dns-query` |❌| 设置请求DoH服务路径（默认：`/dns-query`） |

## 💡 技术特性
- 基于 Cloudflare Workers 无服务器架构
- 使用原生 JavaScript 实现

## 📝 许可证
本项目开源使用，欢迎自由部署和修改！

## 🙏 鸣谢
[tina-hello](https://github.com/tina-hello/doh-cf-workers)、Cloudflare、GPT