import { serve } from "https://deno.land/std@0.220.1/http/server.ts";

interface ErrorWithMessage {
  message: string;
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
  if (isErrorWithMessage(maybeError)) return maybeError;

  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    return new Error(String(maybeError));
  }
}

function getErrorMessage(error: unknown) {
  return toErrorWithMessage(error).message;
}

// 处理 WebSocket 连接
async function handleWebSocket(req: Request): Promise<Response> {
  // 获取目标 URL
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing target URL", { status: 400 });
  }

  try {
    // 连接到目标 WebSocket 服务器
    const targetWs = new WebSocket(targetUrl);
    
    // 等待目标连接建立
    await new Promise((resolve, reject) => {
      targetWs.onopen = resolve;
      targetWs.onerror = reject;
    });

    // 升级当前连接为 WebSocket
    const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

    // 处理客户端消息
    clientWs.onmessage = (event) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(event.data);
      }
    };

    // 处理客户端关闭
    clientWs.onclose = () => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.close();
      }
    };

    // 处理客户端错误
    clientWs.onerror = (error) => {
      console.error("Client WebSocket error:", getErrorMessage(error));
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.close();
      }
    };

    // 处理目标服务器消息
    targetWs.onmessage = (event) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(event.data);
      }
    };

    // 处理目标服务器关闭
    targetWs.onclose = () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    };

    // 处理目标服务器错误
    targetWs.onerror = (error) => {
      console.error("Target WebSocket error:", getErrorMessage(error));
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    };

    return response;
  } catch (error) {
    console.error("Connection error:", getErrorMessage(error));
    return new Response(`Failed to connect to target: ${getErrorMessage(error)}`, { status: 502 });
  }
}

// 处理 HTTP 请求
function handleHttp(req: Request): Response {
  if (req.method === "OPTIONS") {
    // 处理预检请求
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  return new Response("WebSocket proxy server", {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// 主处理函数
async function handler(req: Request): Promise<Response> {
  // 添加 CORS 头
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });

  try {
    // 检查是否是 WebSocket 请求
    const upgradeHeader = req.headers.get("upgrade") || "";
    if (upgradeHeader.toLowerCase() === "websocket") {
      return await handleWebSocket(req);
    }
    
    // 处理普通 HTTP 请求
    return handleHttp(req);
  } catch (error) {
    console.error("Server error:", getErrorMessage(error));
    return new Response(`Server error: ${getErrorMessage(error)}`, { 
      status: 500,
      headers 
    });
  }
}

// 启动服务器
serve(handler, { port: 8000 }); 