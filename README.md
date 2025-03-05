# CF-Workers-DoH
![img](./img.png)

CF-Workers-DoH 是一个基于 Cloudflare Workers 构建的 DNS over HTTPS (DoH) 解析服务。它允许你通过 HTTPS 协议进行 DNS 查询，提高查询的安全性和隐私保护。

## 🚀 部署方式

- **Workers** 部署：复制 [_worker.js](https://github.com/cmliu/CF-Workers-DoH/blob/main/_worker.js) 代码，`保存并部署`即可
- **Pages** 部署：`Fork` 后 `连接GitHub` 一键部署即可

## 📖 使用方法

假设你已部署成功，你的服务域名为：`doh.090227.xyz`

### 1️⃣ DNS解析服务 (DoH)

将以下地址添加到支持DoH的设备或软件中：

```url
https://doh.090227.xyz/dns-query
```

### 2️⃣ 附加功能 IP信息查询

- 🔍 查询当前IP信息
```url
https://doh.090227.xyz/ip-info
```

- 🔍 查询指定IP信息
```url
https://doh.090227.xyz/ip-info?ip=8.8.8.8
```

- 📝 **返回信息示例**：
```json
{
  "status": "success",
  "country": "美国",
  "countryCode": "US",
  "region": "VA",
  "regionName": "弗吉尼亚州",
  "city": "Ashburn",
  "zip": "20149",
  "lat": 39.03,
  "lon": -77.5,
  "timezone": "America/New_York",
  "isp": "Google LLC",
  "org": "Google Public DNS",
  "as": "AS15169 Google LLC",
  "query": "8.8.8.8"
}
```

> 💡 **提示**：请将示例中的 `doh.090227.xyz` 替换为你实际部署的域名

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
[tina-hello](https://github.com/tina-hello/doh-cf-workers)、[ip-api](https://ip-api.com/)、Cloudflare、GPT