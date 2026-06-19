/**
 * Cloudflare Workers AI চ্যাট, KV স্টোরেজ, D1 Database, MCP এবং সম্পূর্ণ GitHub Repository Workspace।
 * এর মাধ্যমে সরাসরি ফাইল ব্রাউজ, এডিট এবং গিটহাবে কমিট (Commit) করা সম্ভব।
 */

export interface Env {
  AI: any; 
  KV: KVNamespace; 
  DB: D1Database; 
  ASSETS: { fetch: typeof fetch };
}

const mcpSessions = new Map<string, ReadableStreamDefaultController>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ==========================================
    // ১. GitHub Workspace API Endpoints
    // ==========================================

    // ক. রিপোজিটরি ফাইল লিস্ট এবং কনটেন্ট রিড করা (GET /api/github/contents)
    if (url.pathname === "/api/github/contents" && request.method === "POST") {
      try {
        const { token, owner, repo, path } = await request.json() as any;
        if (!token || !owner || !repo) {
          return new Response(JSON.stringify({ error: "টোকেন, ওনার এবং রিপোজিটরি নাম আবশ্যক।" }), { status: 400 });
        }

        const targetUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path || ""}`;
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Cloudflare-Workers-GitHub-Workspace"
          }
        });

        const data = await response.json();
        return new Response(JSON.stringify({ status: response.status, data }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // খ. ফাইল এডিট করে সরাসরি Commit করা (POST /api/github/commit)
    if (url.pathname === "/api/github/commit" && request.method === "POST") {
      try {
        const { token, owner, repo, path, content, sha, message } = await request.json() as any;
        if (!token || !owner || !repo || !path || !content) {
          return new Response(JSON.stringify({ error: "প্রয়োজনীয় ফাইল ইনফরমেশন অনুপস্থিত।" }), { status: 400 });
        }

        const targetUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        
        // ফাইল কনটেন্টকে Base64 এ রূপান্তর করা
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        const response = await fetch(targetUrl, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Cloudflare-Workers-GitHub-Workspace"
          },
          body: JSON.stringify({
            message: message || "Updated via Workers Super-Admin Workspace",
            content: base64Content,
            sha: sha || undefined // ফাইল আপডেট করতে পূর্বের SHA প্রয়োজন হয়
          })
        });

        const data = await response.json();
        return new Response(JSON.stringify({ status: response.status, data }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ==========================================
    // ২. MCP (Model Context Protocol) SSE সার্ভার
    // ==========================================
    if (url.pathname === "/api/mcp/sse" && request.method === "GET") {
      const sessionId = crypto.randomUUID();
      const stream = new ReadableStream({
        start(controller) {
          mcpSessions.set(sessionId, controller);
          const endpointUrl = `${url.origin}/api/mcp/message?sessionId=${sessionId}`;
          const initPayload = `event: endpoint\ndata: ${endpointUrl}\n\n`;
          controller.enqueue(new TextEncoder().encode(initPayload));
        },
        cancel() {
          mcpSessions.delete(sessionId);
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (url.pathname === "/api/mcp/message" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) return new Response("Missing sessionId", { status: 400 });

      const requestBody: any = await request.json();
      const { method, params, id } = requestBody;
      let result: any = null;
      let error: any = null;

      try {
        if (method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "Cloudflare-Super-Admin-MCP", version: "1.0.0" }
          };
        } else if (method === "tools/list") {
          result = {
            tools: [
              {
                name: "run_sql",
                description: "D1 database 'bd_bd' এ SQL কুয়েরি চালান।",
                inputSchema: {
                  type: "object",
                  properties: { sql: { type: "string" } },
                  required: ["sql"]
                }
              }
            ]
          };
        } else if (method === "tools/call") {
          const { name, arguments: args } = params;
          if (name === "run_sql") {
            const dbResult = await env.DB.prepare(args.sql).all();
            result = { content: [{ type: "text", text: JSON.stringify(dbResult) }] };
          }
        }
      } catch (e: any) {
        error = { code: -32603, message: e.message };
      }

      const responsePayload: any = { jsonrpc: "2.0", id };
      if (error) responsePayload.error = error;
      else responsePayload.result = result;

      const controller = mcpSessions.get(sessionId);
      if (controller) {
        const payload = `event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      }

      return new Response("OK", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // ==========================================
    // ৩. চ্যাট রিকোয়েস্ট (POST /api/chat)
    // ==========================================
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body: any = await request.json();
        const { messages, systemPrompt, model, adminMode, activeRepoFiles } = body;

        const selectedModel = model || "@cf/meta/llama-3.1-8b-instruct-fp8";

        let finalSystemPrompt = systemPrompt || "আপনি একজন চ্যাট অ্যাসিস্ট্যান্ট।";
        if (adminMode) {
          finalSystemPrompt += ` [SUPER-ADMIN & GITHUB WORKSPACE ACTIVE]
          আপনি এখন ইউজারের সম্পূর্ণ প্রজেক্ট রিপোজিটরি ব্রাউজ করতে পারেন এবং সেগুলোর ফাইল এডিট বা নতুন কোড লেখার ফুল অ্যাক্সেস রাখেন।
          
          বর্তমানে একটিভ রিপোজিটরির ফাইল স্কিমা ও ডিরেক্টরি নিচে দেওয়া হলো:
          ${activeRepoFiles ? JSON.stringify(activeRepoFiles) : "কোনো ফাইল এখনও লোড করা হয়নি।"}

          ইউজার যদি কোনো ফাইলের কোড আপডেট করতে বলে, তাহলে আপনি ফাইলটির নাম ও প্রয়োজনীয় কোড বাংলায় বুঝিয়ে লিখুন। ব্যবহারকারীকে যেকোনো ফাইল কমিট (Commit) করতে সাহায্য করুন।`;
        }

        const fullMessages = [
          { role: "system", content: finalSystemPrompt },
          ...messages
        ];

        const stream = await env.AI.run(selectedModel, {
          messages: fullMessages,
          max_tokens: 2048,
          stream: true
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            "connection": "keep-alive"
          }
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // D1 SQL রানার গেটওয়ে
    if (url.pathname === "/api/admin/query" && request.method === "POST") {
      try {
        const { sql } = await request.json() as { sql: string };
        const result = await env.DB.prepare(sql).all();
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // KV এডমিন অ্যাকশন
    if (url.pathname.startsWith("/api/admin/kv")) {
      try {
        if (request.method === "GET") {
          const list = await env.KV.list();
          const items = [];
          for (const key of list.keys) {
            const value = await env.KV.get(key.name);
            items.push({ key: key.name, value });
          }
          return new Response(JSON.stringify({ items }), {
            headers: { "Content-Type": "application/json" }
          });
        } else if (request.method === "POST") {
          const { key, value } = await request.json() as any;
          await env.KV.put(key, value);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // রুট পাথে ফ্রন্টএন্ড প্রদর্শন
    return new Response(getHTMLContent(url.origin), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

// ফ্রন্টএন্ড লেআউট ডিজাইন
function getHTMLContent(origin: string): string {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workers AI - Super Admin & GitHub Workspace</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #1e1e2e;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #44475a;
      border-radius: 3px;
    }
  </style>
</head>
<body class="bg-[#11121c] text-[#f8f8f2] min-h-screen flex flex-col">

  <!-- হেডার -->
  <header class="bg-[#181926] border-b border-[#2d3142] py-4 px-6 flex justify-between items-center shadow-lg">
    <div class="flex items-center gap-3">
      <div class="bg-gradient-to-tr from-purple-600 to-pink-500 p-2 rounded-xl text-white">
        <i data-lucide="github" class="w-6 h-6 animate-pulse"></i>
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-wide bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">AI Super-Admin & GitHub Workspace</h1>
        <p class="text-xs text-[#a0a0b0]">D1 [bd_bd] • KV • GitHub Workspace • MCP Engine</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2 bg-[#252636] px-3 py-1.5 rounded-full border border-[#3e405b]">
        <span class="w-2.5 h-2.5 bg-green-500 rounded-full animate-ping"></span>
        <span class="text-xs text-green-400 font-medium">ওয়ার্কস্পেস লাইভ</span>
      </div>
    </div>
  </header>

  <!-- প্রধান লেআউট -->
  <main class="flex-1 flex flex-col lg:flex-row overflow-hidden max-w-[1700px] w-full mx-auto">
    
    <!-- বাম পাশের কন্ট্রোল ও কাস্টম এডমিন প্যানেল -->
    <section class="w-full lg:w-[420px] bg-[#181926] p-6 border-b lg:border-b-0 lg:border-r border-[#2d3142] flex flex-col gap-5 overflow-y-auto custom-scrollbar">
      <div>
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2 text-purple-400">
          <i data-lucide="sliders" class="w-5 h-5"></i> কন্ট্রোল প্যানেল
        </h2>
        <p class="text-xs text-[#8a8a9a]">রিয়েল-টাইমে গিটহাব ফাইল ও এআই টিউনিং পরিচালনা করুন।</p>
      </div>

      <!-- গিটহাব ওয়ার্কস্পেস সেটিংস কার্ড -->
      <div class="bg-gradient-to-br from-[#1b2b3a] to-[#121f2d] p-4 rounded-xl border border-blue-500/30 flex flex-col gap-3">
        <h3 class="text-xs font-bold text-blue-300 flex items-center gap-2">
          <i data-lucide="git-branch" class="w-4 h-4 text-blue-400"></i> Active GitHub Workspace
        </h3>
        
        <div class="flex flex-col gap-2">
          <input id="gitOwner" type="text" placeholder="GitHub Username / Owner (যেমন: octocat)" class="bg-[#11121c] border border-[#3e405b] rounded p-2 text-xs text-gray-100 outline-none focus:border-blue-500">
          <input id="gitRepo" type="text" placeholder="Repository Name (যেমন: hello-world)" class="bg-[#11121c] border border-[#3e405b] rounded p-2 text-xs text-gray-100 outline-none focus:border-blue-500">
          <input id="gitToken" type="password" placeholder="GitHub Token (PAT)" class="bg-[#11121c] border border-[#3e405b] rounded p-2 text-xs text-gray-100 outline-none focus:border-blue-500">
        </div>

        <button onclick="loadGitHubWorkspace()" class="w-full bg-blue-600 hover:bg-blue-700 text-white rounded py-2 text-xs font-semibold transition flex justify-center items-center gap-2">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin hidden" id="repoSpinner"></i>
          <span>Workspace লোড করুন</span>
        </button>

        <!-- ফাইল ডিরেক্টরি ট্রি ব্রাউজার -->
        <div id="repoFiles" class="text-xs space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar bg-[#11121c] p-2 rounded border border-[#2d3142]">
          <span class="text-gray-500 italic block text-center">কোনো রিপোজিটরি লোড করা নেই</span>
        </div>
      </div>

      <!-- এআই মডেল সিলেকশন ও টগল -->
      <div class="flex flex-col gap-1.5 bg-[#252636] p-3 rounded-xl border border-[#3e405b]">
        <label class="text-xs font-semibold text-gray-400">Workers AI মডেল:</label>
        <select id="modelSelect" class="bg-[#11121c] border border-[#3e405b] rounded p-2 text-xs text-gray-100 outline-none">
          <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B FP8 (ফাস্ট)</option>
          <option value="@cf/qwen/qwen1.5-14b-chat">Qwen 1.5 14B Chat</option>
        </select>
        
        <div class="flex justify-between items-center mt-2 pt-2 border-t border-[#3e405b]">
          <span class="text-xs font-bold text-red-300">সুপার এডমিন মোড</span>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="adminModeToggle" checked class="sr-only peer">
            <div class="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
          </label>
        </div>
      </div>

      <!-- সরাসরি D1 SQL এক্সিকিউটর -->
      <div class="border-t border-[#2d3142] pt-3">
        <h3 class="text-xs font-bold text-green-400 mb-2 flex items-center gap-2">
          <i data-lucide="terminal" class="w-4 h-4"></i> D1 'bd_bd' SQL রানার
        </h3>
        <textarea id="sqlConsole" rows="2" class="w-full bg-[#11121c] text-green-400 font-mono p-2 rounded border border-[#3e405b] text-xs outline-none focus:border-green-500 resize-none" placeholder="SELECT name FROM sqlite_schema;"></textarea>
        <button onclick="runSQL()" class="w-full mt-1 bg-green-600 hover:bg-green-700 text-white rounded py-1.5 text-xs font-semibold transition">SQL রান করুন</button>
        <div id="sqlResult" class="mt-1 text-[9px] bg-[#11121c] p-2 rounded border border-[#2d3142] max-h-[100px] overflow-auto custom-scrollbar font-mono text-gray-400">
          D1 SQL রেজাল্ট...
        </div>
      </div>
    </section>

    <!-- ডান পাশের মূল চ্যাট ইন্টারফেস ও ফাইল রিডার / এডিটর প্যানেল -->
    <section class="flex-1 flex flex-col lg:flex-row bg-[#141521] overflow-hidden">
      
      <!-- চ্যাট ফিড -->
      <div class="flex-1 flex flex-col border-r border-[#2d3142]">
        <div class="bg-[#181926] px-6 py-3.5 border-b border-[#2d3142] flex justify-between items-center">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse"></div>
            <span class="text-sm font-semibold">লাইভ চ্যাট অ্যাসিস্ট্যান্ট</span>
          </div>
          <button onclick="clearChat()" class="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1 transition">
            <i data-lucide="trash-2" class="w-4 h-4"></i> রিসেট চ্যাট
          </button>
        </div>

        <!-- চ্যাট হিস্ট্রি -->
        <div id="chatHistory" class="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          <div class="flex gap-4 max-w-[85%]">
            <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0">
              <i data-lucide="bot" class="w-5 h-5"></i>
            </div>
            <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142]">
              <p class="text-sm leading-relaxed text-gray-100">হ্যালো সুপার-এডমিন! আপনার চ্যাটবটটি এখন <b>GitHub Workspace</b> এর সাথে কানেক্টেড। বাম পাশে রিপোজিটরি ইনফরমেশন দিলে আমি স্বয়ংক্রিয়ভাবে প্রজেক্ট ফাইলগুলো রিড করে আপনাকে রিয়েল-টাইমে কোডিং সহায়তা করতে পারব।</p>
              <span class="text-[10px] text-gray-500 mt-2 block">সিস্টেম অ্যাসিস্ট্যান্ট</span>
            </div>
          </div>
        </div>

        <!-- ইনপুট বার -->
        <div class="p-4 bg-[#181926] border-t border-[#2d3142]">
          <form id="chatForm" onsubmit="sendMessage(event)" class="flex gap-3">
            <input id="userMessage" type="text" required placeholder="ফাইলের নাম লিখে এআই-কে জিজ্ঞেস করুন বা যেকোনো সাহায্য চান..." class="flex-1 bg-[#1e1f30] border border-[#2d3142] rounded-xl px-4 py-3.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-purple-500 transition">
            <button id="sendBtn" type="submit" class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold px-6 rounded-xl flex items-center gap-2 transition">
              <span>পাঠান</span>
              <i data-lucide="send" class="w-4 h-4"></i>
            </button>
          </form>
        </div>
      </div>

      <!-- রাইট সাইড ফাইল রিডার ও কোড এডিটর (Commit Action) -->
      <div class="w-full lg:w-[480px] bg-[#1a1b26] flex flex-col border-t lg:border-t-0 border-[#2d3142]">
        <div class="bg-[#1f2030] px-4 py-3 border-b border-[#2d3142] flex justify-between items-center">
          <div class="flex items-center gap-2">
            <i data-lucide="file-code" class="w-4 h-4 text-blue-400"></i>
            <span class="text-xs font-semibold text-gray-200" id="currentFileName">কোড ভিউয়ার (কোনো ফাইল ওপেন নেই)</span>
          </div>
          <button id="commitBtn" onclick="commitCodeChange()" disabled class="bg-green-600 hover:bg-green-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition opacity-50 cursor-not-allowed">
            গিটহাবে Commit করুন
          </button>
        </div>
        
        <textarea id="fileEditor" class="flex-1 bg-[#11121c] text-green-300 font-mono p-4 text-xs outline-none resize-none custom-scrollbar" placeholder="// ফাইল সিলেক্ট করলে ফাইলের কোড এখানে রিড/রাইট করা যাবে..."></textarea>
        
        <div class="bg-[#1f2030] p-3 border-t border-[#2d3142] flex flex-col gap-2">
          <label class="text-[10px] font-bold text-gray-400">Commit Message:</label>
          <input id="commitMsg" type="text" value="Updated file using Cloudflare Super-Admin Space" class="bg-[#11121c] border border-[#3e405b] rounded p-2 text-xs text-gray-100 outline-none">
        </div>
      </div>

    </section>

  </main>

  <script>
    let messages = [];
    let currentLoadedFiles = []; // এআই কন্টেন্ট সিস্টেমে পাঠাতে ফাইল স্ট্রাকচার স্টোর
    let activeFileSHA = ""; // গিটহাব ফাইল আপডেটের জন্য SHA স্টোর
    let activeFilePath = ""; // এডিটিং ফাইলের পাথ

    window.onload = function() {
      lucide.createIcons();
      loadSavedGitConfig();
    };

    // লোকাল স্টোরেজ থেকে পূর্বে সেভ করা কনফিগ পুনরুদ্ধার
    function loadSavedGitConfig() {
      const owner = localStorage.getItem("git_owner");
      const repo = localStorage.getItem("git_repo");
      const token = localStorage.getItem("git_token");
      if (owner) document.getElementById("gitOwner").value = owner;
      if (repo) document.getElementById("gitRepo").value = repo;
      if (token) document.getElementById("gitToken").value = token;
    }

    // ১. গিটহাব ওয়ার্কস্পেস লোড করা
    async function loadGitHubWorkspace() {
      const owner = document.getElementById("gitOwner").value.trim();
      const repo = document.getElementById("gitRepo").value.trim();
      const token = document.getElementById("gitToken").value.trim();
      const spinner = document.getElementById("repoSpinner");
      const fileContainer = document.getElementById("repoFiles");

      if (!owner || !repo || !token) {
        alert("গিটহাব কনফিগারেশন পূর্ণাঙ্গভাবে দিন!");
        return;
      }

      // কনফিগ সেভ করা
      localStorage.setItem("git_owner", owner);
      localStorage.setItem("git_repo", repo);
      localStorage.setItem("git_token", token);

      spinner.classList.remove("hidden");
      fileContainer.innerHTML = "ফাইল লিস্ট লোড করা হচ্ছে...";

      try {
        const response = await fetch("/api/github/contents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, owner, repo, path: "" })
        });
        const resData = await response.json();

        if (resData.status === 200 && Array.isArray(resData.data)) {
          currentLoadedFiles = resData.data;
          fileContainer.innerHTML = "";
          
          resData.data.forEach(file => {
            const isDir = file.type === "dir";
            const icon = isDir ? "folder" : "file-code";
            const colorClass = isDir ? "text-yellow-500" : "text-blue-400";
            
            const div = document.createElement("div");
            div.className = "flex items-center justify-between hover:bg-[#1f2030] p-1 rounded cursor-pointer transition";
            div.innerHTML = \`
              <span onclick="openFile('\${file.path}', '\${file.sha}')" class="flex items-center gap-1.5 truncate">
                <i data-lucide="\${icon}" class="w-3.5 h-3.5 \${colorClass}"></i>
                <span class="truncate">\${file.name}</span>
              </span>
            \`;
            fileContainer.appendChild(div);
          });
          lucide.createIcons();
        } else {
          fileContainer.innerHTML = \`<span class="text-red-500 block text-center">লোড ব্যর্থ! ত্রুটি: \${resData.data.message || 'Error'}</span>\`;
        }
      } catch (err) {
        fileContainer.innerHTML = '<span class="text-red-500 block text-center">সার্ভার এরর!</span>';
      } finally {
        spinner.classList.add("hidden");
      }
    }

    // ২. স্পেসিফিক ফাইল ওপেন করা
    async function openFile(path, sha) {
      const owner = document.getElementById("gitOwner").value.trim();
      const repo = document.getElementById("gitRepo").value.trim();
      const token = document.getElementById("gitToken").value.trim();
      const editor = document.getElementById("fileEditor");
      const fileNameView = document.getElementById("currentFileName");
      const commitBtn = document.getElementById("commitBtn");

      editor.value = "ফাইল কন্টেন্ট ডাউনলোড হচ্ছে...";
      fileNameView.innerHTML = path;
      activeFilePath = path;
      activeFileSHA = sha;

      try {
        const response = await fetch("/api/github/contents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, owner, repo, path })
        });
        const resData = await response.json();

        if (resData.status === 200 && resData.data.content) {
          // Base64 থেকে ডিকোড করা
          const decodedContent = decodeURIComponent(escape(atob(resData.data.content)));
          editor.value = decodedContent;
          commitBtn.disabled = false;
          commitBtn.classList.remove("opacity-50", "cursor-not-allowed");
        } else {
          editor.value = "ফাইলটি ওপেন করা সম্ভব হয়নি।";
        }
      } catch (err) {
        editor.value = "ডাউনলোড এরর!";
      }
    }

    // ৩. ফাইল মডিফাই করে Commit করা
    async function commitCodeChange() {
      const owner = document.getElementById("gitOwner").value.trim();
      const repo = document.getElementById("gitRepo").value.trim();
      const token = document.getElementById("gitToken").value.trim();
      const content = document.getElementById("fileEditor").value;
      const message = document.getElementById("commitMsg").value.trim();
      const commitBtn = document.getElementById("commitBtn");

      if (!activeFilePath) return;

      commitBtn.disabled = true;
      commitBtn.innerHTML = "Commit হচ্ছে...";

      try {
        const response = await fetch("/api/github/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            owner,
            repo,
            path: activeFilePath,
            content,
            sha: activeFileSHA,
            message
          })
        });

        const data = await response.json();
        if (data.status === 200) {
          alert("সফলভাবে গিটহাবে Commit ও Push সম্পন্ন হয়েছে!");
          // ফাইল লিস্ট রিফ্রেশ করা নতুন SHA পেতে
          loadGitHubWorkspace();
        } else {
          alert("Commit ব্যর্থ হয়েছে! ত্রুটি: " + (data.data.message || "Unknown"));
        }
      } catch (err) {
        alert("কানেকশন এরর!");
      } finally {
        commitBtn.disabled = false;
        commitBtn.innerHTML = "গিটহাবে Commit করুন";
      }
    }

    // ৪. সরাসরি SQL রানার
    async function runSQL() {
      const sql = document.getElementById("sqlConsole").value.trim();
      const resultView = document.getElementById("sqlResult");
      if (!sql) return;

      resultView.innerHTML = "কুয়েরি রান হচ্ছে...";
      try {
        const response = await fetch("/api/admin/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql })
        });
        const data = await response.json();
        if (data.success) {
          resultView.innerHTML = JSON.stringify(data.result, null, 2);
        } else {
          resultView.innerHTML = "ত্রুটি: " + data.error;
        }
      } catch (err) {
        resultView.innerHTML = "কানেকশন এরর!";
      }
    }

    // ৫. চ্যাট মেসেজ ও স্ট্রিমিং (Active Files Context সহ)
    async function sendMessage(e) {
      e.preventDefault();
      const inputEl = document.getElementById("userMessage");
      const messageText = inputEl.value.trim();
      if (!messageText) return;

      const sendBtn = document.getElementById("sendBtn");
      sendBtn.disabled = true;

      appendMessage("user", messageText);
      inputEl.value = "";

      messages.push({ role: "user", content: messageText });
      
      const model = document.getElementById("modelSelect").value;
      const adminMode = document.getElementById("adminModeToggle").checked;

      const loadingId = appendLoadingMessage();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            model,
            adminMode,
            activeRepoFiles: currentLoadedFiles.map(f => ({ name: f.name, path: f.path, type: f.type }))
          })
        });

        if (!response.ok) throw new Error("সার্ভার রেসপন্স ব্যর্থ!");

        removeLoadingMessage(loadingId);
        const assistantMessageId = appendEmptyAssistantMessage();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessageText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") break;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.response) {
                  assistantMessageText += parsed.response;
                  updateAssistantMessage(assistantMessageId, assistantMessageText);
                }
              } catch (err) {}
            }
          }
        }

        messages.push({ role: "assistant", content: assistantMessageText });

      } catch (error) {
        removeLoadingMessage(loadingId);
        appendMessage("assistant", "ত্রুটি: সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি।");
      } finally {
        sendBtn.disabled = false;
      }
    }

    function appendMessage(role, text) {
      const chatHistory = document.getElementById("chatHistory");
      const messageDiv = document.createElement("div");
      messageDiv.className = role === "user" ? "flex gap-4 max-w-[85%] ml-auto justify-end" : "flex gap-4 max-w-[85%]";

      const avatar = role === "user" 
        ? '<div class="w-9 h-9 rounded-xl bg-pink-600 flex items-center justify-center text-white order-2 shrink-0"><i data-lucide="user" class="w-5 h-5"></i></div>'
        : '<div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0"><i data-lucide="bot" class="w-5 h-5"></i></div>';

      const bubbleClass = role === "user"
        ? "bg-purple-600/20 border border-purple-500/40 p-4 rounded-2xl rounded-tr-none text-right"
        : "bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142]";

      messageDiv.innerHTML = \`
        \${avatar}
        <div class="\${bubbleClass} order-1">
          <p class="text-sm leading-relaxed text-gray-100 text-left">\${text.replace(/\\n/g, '<br>')}</p>
          <span class="text-[10px] text-gray-500 mt-2 block">\${role === 'user' ? 'এডমিন' : 'Workers AI'}</span>
        </div>
      \`;

      chatHistory.appendChild(messageDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      lucide.createIcons();
    }

    function appendEmptyAssistantMessage() {
      const id = "ai-msg-" + Date.now();
      const chatHistory = document.getElementById("chatHistory");
      const messageDiv = document.createElement("div");
      messageDiv.id = id;
      messageDiv.className = "flex gap-4 max-w-[85%]";
      messageDiv.innerHTML = \`
        <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0">
          <i data-lucide="bot" class="w-5 h-5"></i>
        </div>
        <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142]">
          <p class="text-sm leading-relaxed text-gray-100 text-left cursor-blink" id="\${id}-text">...</p>
          <span class="text-[10px] text-gray-500 mt-2 block">Workers AI</span>
        </div>
      \`;
      chatHistory.appendChild(messageDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      lucide.createIcons();
      return id;
    }

    function updateAssistantMessage(id, text) {
      const textEl = document.getElementById(id + "-text");
      if (textEl) {
        textEl.innerHTML = text.replace(/\\n/g, '<br>');
        const chatHistory = document.getElementById("chatHistory");
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
    }

    function appendLoadingMessage() {
      const id = "loading-" + Date.now();
      const chatHistory = document.getElementById("chatHistory");
      const loadingDiv = document.createElement("div");
      loadingDiv.id = id;
      loadingDiv.className = "flex gap-4 max-w-[85%]";
      loadingDiv.innerHTML = `
        <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0 animate-pulse">
          <i data-lucide="loader" class="w-5 h-5 animate-spin"></i>
        </div>
        <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142] animate-pulse">
          <p class="text-sm text-gray-400">কানেক্ট করা হচ্ছে...</p>
        </div>
      `;
      chatHistory.appendChild(loadingDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      lucide.createIcons();
      return id;
    }

    function removeLoadingMessage(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }

    function clearChat() {
      messages = [];
      const chatHistory = document.getElementById("chatHistory");
      chatHistory.innerHTML = \`
        <div class="flex gap-4 max-w-[85%]">
          <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0">
            <i data-lucide="bot" class="w-5 h-5"></i>
          </div>
          <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142]">
            <p class="text-sm leading-relaxed text-gray-100">হিস্ট্রি সফলভাবে ক্লিয়ার করা হয়েছে। নতুন সেশন শুরু করুন।</p>
          </div>
        </div>
      \`;
      lucide.createIcons();
    }
  </script>
</body>
</html>`;
}