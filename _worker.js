export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const hostname = url.hostname;
        
        // 处理 OPTIONS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Max-Age': '86400'
                }
            });
        }
        
        // 如果请求路径是 /dns-query，则作为 DoH 服务器处理
        if (path === '/dns-query') {
            return await DOHRequest(request);
        }
        
        // 如果请求参数中包含 domain 和 doh，则执行 DNS 解析
        if (url.searchParams.has("domain") && url.searchParams.has("doh")) {
            const domain = url.searchParams.get("domain") || "www.google.com";
            const doh = url.searchParams.get("doh") || "https://cloudflare-dns.com/dns-query";
            const type = url.searchParams.get("type") || "all"; // 默认同时查询 A 和 AAAA
            
            // 如果使用的是当前站点，则使用 Cloudflare 的 DoH 服务
            if (doh.includes(url.host) || doh === '/dns-query') {
                return await handleLocalDohRequest(domain, type, hostname);
            }

            try {
                // 根据请求类型进行不同的处理
                if (type === "all") {
                    // 同时请求 A、AAAA 和 NS 记录，使用新的查询函数
                    const ipv4Result = await querySpecificProvider(doh, domain, "A");
                    const ipv6Result = await querySpecificProvider(doh, domain, "AAAA");
                    const nsResult = await querySpecificProvider(doh, domain, "NS");
                    
                    // 合并结果
                    const combinedResult = {
                        Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
                        TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
                        RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
                        RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
                        AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
                        CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
                        Question: [...(ipv4Result.Question || []), ...(ipv6Result.Question || []), ...(nsResult.Question || [])],
                        Answer: [...(ipv4Result.Answer || []), ...(ipv6Result.Answer || []), ...(nsResult.Answer || [])],
                        ipv4: {
                            records: ipv4Result.Answer || []
                        },
                        ipv6: {
                            records: ipv6Result.Answer || []
                        },
                        ns: {
                            records: nsResult.Answer || []
                        }
                    };
                    
                    return new Response(JSON.stringify(combinedResult, null, 2), {
                        headers: { "content-type": "application/json" }
                    });
                } else {
                    // 普通的单类型查询，使用新的查询函数
                    const result = await querySpecificProvider(doh, domain, type);
                    return new Response(JSON.stringify(result, null, 2), {
                        headers: { "content-type": "application/json" }
                    });
                }
            } catch (err) {
                console.error("DNS 查询失败:", err);
                return new Response(JSON.stringify({ 
                    error: `DNS 查询失败: ${err.message}`,
                    doh: doh,
                    domain: domain,
                    stack: err.stack
                }, null, 2), {
                    headers: { "content-type": "application/json" },
                    status: 500
                });
            }
        }

        return await HTML();
    }
}

// 查询DNS的通用函数
async function queryDns(dohServer, domain, type) {
    // 构造 DoH 请求 URL
    const dohUrl = new URL(dohServer);
    dohUrl.searchParams.set("name", domain);
    dohUrl.searchParams.set("type", type);
    
    // 尝试多种请求头格式
    const fetchOptions = [
        // 标准 application/dns-json
        { 
            headers: { 'Accept': 'application/dns-json' }
        },
        // 部分服务使用没有指定 Accept 头的请求
        { 
            headers: {} 
        },
        // 另一个尝试 application/json
        { 
            headers: { 'Accept': 'application/json' }
        },
        // 稳妥起见，有些服务可能需要明确的用户代理
        {
            headers: { 
                'Accept': 'application/dns-json',
                'User-Agent': 'Mozilla/5.0 DNS Client' 
            }
        }
    ];
    
    let lastError = null;
    
    // 依次尝试不同的请求头组合
    for (const options of fetchOptions) {
        try {
            const response = await fetch(dohUrl.toString(), options);
            
            // 如果请求成功，解析JSON
            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                // 检查内容类型是否兼容
                if (contentType.includes('json') || contentType.includes('dns-json')) {
                    return await response.json();
                } else {
                    // 对于非标准的响应，仍尝试进行解析
                    const textResponse = await response.text();
                    try {
                        return JSON.parse(textResponse);
                    } catch (jsonError) {
                        throw new Error(`无法解析响应为JSON: ${jsonError.message}, 响应内容: ${textResponse.substring(0, 100)}`);
                    }
                }
            }
            
            // 错误情况记录，继续尝试下一个选项
            const errorText = await response.text();
            lastError = new Error(`DoH 服务器返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
            
        } catch (err) {
            // 记录错误，继续尝试下一个选项
            lastError = err;
        }
    }
    
    // 所有尝试都失败，抛出最后一个错误
    throw lastError || new Error("无法完成 DNS 查询");
}

// 添加对特定 DoH 服务的特殊处理
async function querySpecificProvider(dohServer, domain, type) {
    // 检查是否为已知需要特殊处理的服务
    const dohLower = dohServer.toLowerCase();
    
    // Google DNS 特殊处理
    if (dohLower.includes('dns.google')) {
        const url = new URL(dohServer);
        // Google DNS 使用 /resolve 的 endpoint
        if (!dohLower.includes('/resolve')) {
            url.pathname = '/resolve';
        }
        url.searchParams.set("name", domain);
        url.searchParams.set("type", type);
        
        const response = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google DNS 服务返回错误 (${response.status}): ${errorText}`);
        }
        
        return await response.json();
    }
    
    // OpenDNS 特殊处理
    else if (dohLower.includes('opendns.com')) {
        const url = new URL(dohServer);
        url.searchParams.set("name", domain);
        url.searchParams.set("type", type);
        
        const response = await fetch(url.toString(), {
            headers: { 
                'Accept': 'application/dns-json',
                'User-Agent': 'Mozilla/5.0 DNS Client' 
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenDNS 服务返回错误 (${response.status}): ${errorText}`);
        }
        
        return await response.json();
    }
    
    // 使用通用方法
    return await queryDns(dohServer, domain, type);
}

// 处理本地 DoH 请求的函数 - 直接调用 Cloudflare DoH，而不是自身服务
async function handleLocalDohRequest(domain, type, hostname) {
    // 直接使用 Cloudflare DoH 服务而不是自己，避免循环引用
    const cfDoH = "https://cloudflare-dns.com/dns-query";
    
    try {
        if (type === "all") {
            // 同时请求 A、AAAA 和 NS 记录
            const ipv4Promise = querySpecificProvider(cfDoH, domain, "A");
            const ipv6Promise = querySpecificProvider(cfDoH, domain, "AAAA");
            const nsPromise = querySpecificProvider(cfDoH, domain, "NS");
            
            // 等待所有请求完成
            const [ipv4Result, ipv6Result, nsResult] = await Promise.all([ipv4Promise, ipv6Promise, nsPromise]);
            
            // 合并结果
            const combinedResult = {
                Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
                TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
                RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
                RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
                AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
                CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
                Question: [...(ipv4Result.Question || []), ...(ipv6Result.Question || []), ...(nsResult.Question || [])],
                Answer: [...(ipv4Result.Answer || []), ...(ipv6Result.Answer || []), ...(nsResult.Answer || [])],
                ipv4: {
                    records: ipv4Result.Answer || []
                },
                ipv6: {
                    records: ipv6Result.Answer || []
                },
                ns: {
                    records: nsResult.Answer || []
                }
            };
            
            return new Response(JSON.stringify(combinedResult, null, 2), {
                headers: { 
                    "content-type": "application/json",
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } else {
            // 普通的单类型查询
            const result = await querySpecificProvider(cfDoH, domain, type);
            return new Response(JSON.stringify(result, null, 2), {
                headers: { 
                    "content-type": "application/json",
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    } catch (err) {
        console.error("Cloudflare DoH 查询失败:", err);
        return new Response(JSON.stringify({ 
            error: `Cloudflare DoH 查询失败: ${err.message}`,
            stack: err.stack
        }, null, 2), {
            headers: { 
                "content-type": "application/json",
                'Access-Control-Allow-Origin': '*'
            },
            status: 500
        });
    }
}

// DoH 请求处理函数
async function DOHRequest(request) {
    const { method, headers } = request;
    const url = new URL(request.url);
    const { searchParams } = url;
    
    // 处理 DNS over HTTPS 请求
    // 使用 Cloudflare 的安全 DoH 服务作为后端
    const cloudflareDoH = 'https://cloudflare-dns.com/dns-query';
    
    try {
        // 根据请求方法和参数构建转发请求
        let response;
        
        if (method === 'GET' && searchParams.has('name')) {
            // 处理 JSON 格式的 DoH 请求
            const name = searchParams.get('name');
            const type = searchParams.get('type') || 'A';
            
            // 防止循环引用，检查请求是否来自自身
            const cfUrl = new URL(cloudflareDoH);
            cfUrl.searchParams.set('name', name);
            cfUrl.searchParams.set('type', type);
            
            response = await fetch(cfUrl.toString(), {
                headers: {
                    'Accept': 'application/dns-json',
                    // 添加 User-Agent 以避免被识别为自动爬虫
                    'User-Agent': 'DoH Client'
                }
            });
        } else if (method === 'GET' && searchParams.has('dns')) {
            // 处理 base64url 格式的 GET 请求
            response = await fetch(`${cloudflareDoH}?dns=${searchParams.get('dns')}`, {
                headers: {
                    'Accept': 'application/dns-message',
                    'User-Agent': 'DoH Client'
                }
            });
        } else if (method === 'POST') {
            // 处理 POST 请求
            const contentType = headers.get('content-type');
            if (contentType === 'application/dns-message') {
                response = await fetch(cloudflareDoH, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/dns-message',
                        'Content-Type': 'application/dns-message',
                        'User-Agent': 'DoH Client'
                    },
                    body: request.body
                });
            } else {
                return new Response('不支持的请求格式', { status: 400 });
            }
        } else {
            // 初始请求处理
            // 如果是浏览器直接访问 /dns-query 路径，返回简单信息
            if (headers.get('accept')?.includes('text/html')) {
                return new Response('DoH 端点已启用。这是一个 DNS over HTTPS 服务接口，不是网页。', {
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            }
            return new Response('不支持的请求格式', { status: 400 });
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloudflare DoH 返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
        }
        
        // 创建一个新的响应头对象
        const responseHeaders = new Headers(response.headers);
        // 设置跨域资源共享 (CORS) 的头部信息
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        
        // 返回响应
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error("DoH 请求处理错误:", error);
        return new Response(JSON.stringify({
            error: `DoH 请求处理错误: ${error.message}`,
            stack: error.stack
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
  
async function HTML() {
    // 否则返回 HTML 页面
    const html = `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>DNS Resolver</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #f8f9fa;
          padding: 20px;
          line-height: 1.6;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background-color: #ffffff;
          border-radius: 10px;
          box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
          padding: 30px;
        }
        .card {
          margin-bottom: 20px;
          border: none;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        }
        .card-header {
          background-color: #f0f7ff;
          font-weight: 600;
          padding: 12px 20px;
          border-bottom: none;
        }
        .form-label {
          font-weight: 500;
          margin-bottom: 8px;
          color: #495057;
        }
        .form-select, .form-control {
          border-radius: 6px;
          padding: 10px;
          border: 1px solid #ced4da;
        }
        .btn-primary {
          background-color: #0d6efd;
          border: none;
          border-radius: 6px;
          padding: 10px 20px;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        .btn-primary:hover {
          background-color: #0a58ca;
          transform: translateY(-1px);
        }
        pre {
          background-color: #f8f9fa;
          padding: 15px;
          border-radius: 6px;
          border: 1px solid #eaeaea;
          white-space: pre-wrap;
          word-break: break-all;
          font-family: Consolas, Monaco, 'Andale Mono', monospace;
          font-size: 14px;
          max-height: 400px;
          overflow: auto;
        }
        .loading {
          display: none;
          text-align: center;
          padding: 20px 0;
        }
        .loading-spinner {
          border: 4px solid rgba(0, 0, 0, 0.1);
          border-left: 4px solid #0d6efd;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          animation: spin 1s linear infinite;
          margin: 0 auto 10px;
        }
        .badge {
          margin-left: 5px;
          font-size: 11px;
          vertical-align: middle;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          color: #6c757d;
          font-size: 14px;
        }
        @media (max-width: 576px) {
          .container {
            padding: 20px;
          }
        }
        .error-message {
          color: #dc3545;
          margin-top: 10px;
        }
        .success-message {
          color: #198754;
        }
        .nav-tabs .nav-link {
          border-top-left-radius: 6px;
          border-top-right-radius: 6px;
          padding: 8px 16px;
          font-weight: 500;
        }
        .nav-tabs .nav-link.active {
          background-color: #f8f9fa;
          border-bottom-color: #f8f9fa;
        }
        .tab-content {
          background-color: #f8f9fa;
          border-radius: 0 0 6px 6px;
          padding: 15px;
          border: 1px solid #dee2e6;
          border-top: none;
        }
        .ip-record {
          padding: 5px 10px;
          margin-bottom: 5px;
          border-radius: 4px;
          background-color: #fff;
          border: 1px solid #e9ecef;
        }
        .ip-record:hover {
          background-color: #f0f7ff;
        }
        .ip-address {
          font-family: monospace;
          font-weight: 600;
        }
        .result-summary {
          margin-bottom: 15px;
          padding: 10px;
          background-color: #e9ecef;
          border-radius: 6px;
        }
        .result-tabs {
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 class="text-center mb-4">DNS Resolver</h1>
        <div class="card">
          <div class="card-header">DNS 查询设置</div>
          <div class="card-body">
            <form id="resolveForm">
              <div class="mb-3">
                <label for="dohSelect" class="form-label">选择 DoH 地址:</label>
                <select id="dohSelect" class="form-select">
                  <option value="current" selected>当前站点 (自动)</option>
                  <option value="https://doh.pub/dns-query">doh.pub (腾讯)</option>
                  <option value="https://cloudflare-dns.com/dns-query">Cloudflare DNS</option>
                  <option value="https://dns.google/resolve">Google (谷歌)</option>
                  <option value="https://dns.twnic.tw/dns-query">Quad101 (TWNIC)</option>
                  <option value="custom">自定义...</option>
                </select>
              </div>
              <div id="customDohContainer" class="mb-3" style="display:none;">
                <label for="customDoh" class="form-label">输入自定义 DoH 地址:</label>
                <input type="text" id="customDoh" class="form-control" placeholder="https://example.com/dns-query">
              </div>
              <div class="mb-3">
                <label for="domain" class="form-label">待解析域名:</label>
                <div class="input-group">
                  <input type="text" id="domain" class="form-control" value="www.google.com" placeholder="输入域名，如 example.com">
                  <button type="button" class="btn btn-outline-secondary" id="clearBtn">清除</button>
                </div>
              </div>
              <div class="d-grid">
                <button type="submit" class="btn btn-primary">解析</button>
              </div>
            </form>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span>解析结果</span>
            <button class="btn btn-sm btn-outline-secondary" id="copyBtn" style="display: none;">复制结果</button>
          </div>
          <div class="card-body">
            <div id="loading" class="loading">
              <div class="loading-spinner"></div>
              <p>正在查询中，请稍候...</p>
            </div>
            
            <!-- 结果展示区，包含选项卡 -->
            <div id="resultContainer" style="display: none;">
              <ul class="nav nav-tabs result-tabs" id="resultTabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active" id="ipv4-tab" data-bs-toggle="tab" data-bs-target="#ipv4" type="button" role="tab">IPv4 地址</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="ipv6-tab" data-bs-toggle="tab" data-bs-target="#ipv6" type="button" role="tab">IPv6 地址</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="ns-tab" data-bs-toggle="tab" data-bs-target="#ns" type="button" role="tab">NS 记录</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="raw-tab" data-bs-toggle="tab" data-bs-target="#raw" type="button" role="tab">原始数据</button>
                </li>
              </ul>
              <div class="tab-content" id="resultTabContent">
                <div class="tab-pane fade show active" id="ipv4" role="tabpanel" aria-labelledby="ipv4-tab">
                  <div class="result-summary" id="ipv4Summary"></div>
                  <div id="ipv4Records"></div>
                </div>
                <div class="tab-pane fade" id="ipv6" role="tabpanel" aria-labelledby="ipv6-tab">
                  <div class="result-summary" id="ipv6Summary"></div>
                  <div id="ipv6Records"></div>
                </div>
                <div class="tab-pane fade" id="ns" role="tabpanel" aria-labelledby="ns-tab">
                  <div class="result-summary" id="nsSummary"></div>
                  <div id="nsRecords"></div>
                </div>
                <div class="tab-pane fade" id="raw" role="tabpanel" aria-labelledby="raw-tab">
                  <pre id="result">等待查询...</pre>
                </div>
              </div>
            </div>
            
            <!-- 错误信息区域 -->
            <div id="errorContainer" style="display: none;">
              <pre id="errorMessage" class="error-message"></pre>
            </div>
          </div>
        </div>
        
        <div class="footer">
          <p>基于 Cloudflare Workers 的 DoH (DNS over HTTPS) 解析服务</p>
        </div>
      </div>
      
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      <script>
        // 获取当前页面的 URL 和主机名
        const currentUrl = window.location.href;
        const currentHost = window.location.host;
        const currentProtocol = window.location.protocol;
        const currentDohUrl = currentProtocol + '//' + currentHost + '/dns-query';
        
        // 记录当前使用的 DoH 地址
        let activeDohUrl = currentDohUrl;
        
        // 显示当前正在使用的 DoH 服务
        function updateActiveDohDisplay() {
          const dohSelect = document.getElementById('dohSelect');
          if (dohSelect.value === 'current') {
            activeDohUrl = currentDohUrl;
          }
        }
        
        // 初始更新
        updateActiveDohDisplay();
        
        // 当选择自定义时显示输入框
        document.getElementById('dohSelect').addEventListener('change', function(){
          const customContainer = document.getElementById('customDohContainer');
          customContainer.style.display = (this.value === 'custom') ? 'block' : 'none';
          
          if (this.value === 'current') {
            activeDohUrl = currentDohUrl;
          } else if (this.value !== 'custom') {
            activeDohUrl = this.value;
          }
        });
        
        // 清除按钮功能
        document.getElementById('clearBtn').addEventListener('click', function() {
          document.getElementById('domain').value = '';
          document.getElementById('domain').focus();
        });
        
        // 复制结果功能
        document.getElementById('copyBtn').addEventListener('click', function() {
          const resultText = document.getElementById('result').textContent;
          navigator.clipboard.writeText(resultText).then(function() {
            const originalText = this.textContent;
            this.textContent = '已复制';
            setTimeout(() => {
              this.textContent = originalText;
            }, 2000);
          }.bind(this)).catch(function(err) {
            console.error('无法复制文本: ', err);
          });
        });
        
        // 格式化 TTL
        function formatTTL(seconds) {
          if (seconds < 60) return seconds + '秒';
          if (seconds < 3600) return Math.floor(seconds / 60) + '分钟';
          if (seconds < 86400) return Math.floor(seconds / 3600) + '小时';
          return Math.floor(seconds / 86400) + '天';
        }
        
        // 显示记录
        function displayRecords(data) {
          document.getElementById('resultContainer').style.display = 'block';
          document.getElementById('errorContainer').style.display = 'none';
          document.getElementById('result').textContent = JSON.stringify(data, null, 2);
          
          // IPv4 记录
          const ipv4Records = data.ipv4?.records || [];
          const ipv4Container = document.getElementById('ipv4Records');
          ipv4Container.innerHTML = '';
          
          if (ipv4Records.length === 0) {
            document.getElementById('ipv4Summary').innerHTML = \`<strong>未找到 IPv4 记录</strong>\`;
          } else {
            document.getElementById('ipv4Summary').innerHTML = \`<strong>找到 \${ipv4Records.length} 条 IPv4 记录</strong>\`;
            
            ipv4Records.forEach(record => {
              if (record.type === 1) {  // 1 = A记录
                const recordDiv = document.createElement('div');
                recordDiv.className = 'ip-record';
                recordDiv.innerHTML = \`
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="ip-address">\${record.data}</span>
                    <span class="text-muted">TTL: \${formatTTL(record.TTL)}</span>
                  </div>
                \`;
                ipv4Container.appendChild(recordDiv);
              }
            });
          }
          
          // IPv6 记录
          const ipv6Records = data.ipv6?.records || [];
          const ipv6Container = document.getElementById('ipv6Records');
          ipv6Container.innerHTML = '';
          
          if (ipv6Records.length === 0) {
            document.getElementById('ipv6Summary').innerHTML = \`<strong>未找到 IPv6 记录</strong>\`;
          } else {
            document.getElementById('ipv6Summary').innerHTML = \`<strong>找到 \${ipv6Records.length} 条 IPv6 记录</strong>\`;
            
            ipv6Records.forEach(record => {
              if (record.type === 28) {  // 28 = AAAA记录
                const recordDiv = document.createElement('div');
                recordDiv.className = 'ip-record';
                recordDiv.innerHTML = \`
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="ip-address">\${record.data}</span>
                    <span class="text-muted">TTL: \${formatTTL(record.TTL)}</span>
                  </div>
                \`;
                ipv6Container.appendChild(recordDiv);
              }
            });
          }
          
          // NS 记录
          const nsRecords = data.ns?.records || [];
          const nsContainer = document.getElementById('nsRecords');
          nsContainer.innerHTML = '';
          
          if (nsRecords.length === 0) {
            document.getElementById('nsSummary').innerHTML = \`<strong>未找到 NS 记录</strong>\`;
          } else {
            document.getElementById('nsSummary').innerHTML = \`<strong>找到 \${nsRecords.length} 条名称服务器记录</strong>\`;
            
            nsRecords.forEach(record => {
              if (record.type === 2) {  // 2 = NS记录
                const recordDiv = document.createElement('div');
                recordDiv.className = 'ip-record';
                recordDiv.innerHTML = \`
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="ip-address">\${record.data}</span>
                    <span class="text-muted">TTL: \${formatTTL(record.TTL)}</span>
                  </div>
                \`;
                nsContainer.appendChild(recordDiv);
              }
            });
          }
          
          // 显示复制按钮
          document.getElementById('copyBtn').style.display = 'block';
        }
        
        // 显示错误
        function displayError(message) {
          document.getElementById('resultContainer').style.display = 'none';
          document.getElementById('errorContainer').style.display = 'block';
          document.getElementById('errorMessage').textContent = message;
          document.getElementById('copyBtn').style.display = 'none';
        }
        
        // 表单提交后发起 DNS 查询请求
        document.getElementById('resolveForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const dohSelect = document.getElementById('dohSelect').value;
          let doh;
          
          if(dohSelect === 'current') {
            doh = currentDohUrl;
          } else if(dohSelect === 'custom') {
            doh = document.getElementById('customDoh').value;
            if (!doh) {
              alert('请输入自定义 DoH 地址');
              return;
            }
          } else {
            doh = dohSelect;
          }
          
          const domain = document.getElementById('domain').value;
          if (!domain) {
            alert('请输入需要解析的域名');
            return;
          }
          
          // 显示加载状态
          document.getElementById('loading').style.display = 'block';
          document.getElementById('resultContainer').style.display = 'none';
          document.getElementById('errorContainer').style.display = 'none';
          document.getElementById('copyBtn').style.display = 'none';
          
          try {
            // 发起查询，参数采用 GET 请求方式，type=all 表示同时查询 A 和 AAAA
            const response = await fetch(\`?doh=\${encodeURIComponent(doh)}&domain=\${encodeURIComponent(domain)}&type=all\`);
            
            if (!response.ok) {
              throw new Error(\`HTTP 错误: \${response.status}\`);
            }
            
            const json = await response.json();
            
            // 检查响应是否包含错误
            if (json.error) {
              displayError(json.error);
            } else {
              displayRecords(json);
            }
          } catch (error) {
            displayError('查询失败: ' + error.message);
          } finally {
            // 隐藏加载状态
            document.getElementById('loading').style.display = 'none';
          }
        });
        
        // 页面加载完成后执行
        document.addEventListener('DOMContentLoaded', function() {
          // 使用本地存储记住最后使用的域名
          const lastDomain = localStorage.getItem('lastDomain');
          if (lastDomain) {
            document.getElementById('domain').value = lastDomain;
          }
          
          // 监听域名输入变化并保存
          document.getElementById('domain').addEventListener('input', function() {
            localStorage.setItem('lastDomain', this.value);
          });
        });
      </script>
    </body>
    </html>`;
  
    return new Response(html, {
        headers: { "content-type": "text/html;charset=UTF-8" }
    });
}