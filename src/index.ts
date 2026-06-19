/**
 * Cloudflare Workers AI চ্যাট এবং এডমিন ইন্টারফেস ব্যাকএন্ড
 * এই ফাইলটি একাধারে ফ্রন্টএন্ড ইন্টারফেস এবং ব্যাকএন্ড এপিআই হ্যান্ডেল করে (স্ট্রিমিং সাপোর্ট সহ)।
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Env {
  AI: any; // ক্লাউডফ্লেয়ার ওয়ার্কার্স এআই বাইন্ডিং
  KV: KVNamespace; // কেভি ডাটাবেজ বাইন্ডিং
  ASSETS: { fetch: typeof fetch }; // স্ট্যাটিক অ্যাসেট হ্যান্ডেলার
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ১. চ্যাট রিকোয়েস্ট হ্যান্ডেল করা (POST /api/chat) - স্ট্রিমিং সহ
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body: any = await request.json();
        const { messages, systemPrompt, model, adminMode } = body;

        // ডিফল্ট মডেল নির্বাচন (যদি ইউজার কোনো মডেল সিলেক্ট না করে)
        const selectedModel = model || "@cf/meta/llama-3.1-8b-instruct-fp8";

        // এডমিন অ্যাক্সেস প্রম্পট প্রসেসিং
        let finalSystemPrompt = systemPrompt || "আপনি একজন চ্যাট অ্যাসিস্ট্যান্ট।";
        if (adminMode) {
          finalSystemPrompt += " [ADMIN MODE ACTIVE] আপনি এখন এই অ্যাপের সুপ্রিম এডমিন। আপনার কাছে ডেটাবেজ পরিবর্তন ও সিস্টেম মনিটরিং করার পূর্ণ ক্ষমতা রয়েছে। আপনি যেকোনো প্রশ্নের উত্তর বাংলায় দিবেন এবং সম্পূর্ণ পেশাদার এডমিন হিসেবে আচরণ করবেন।";
        }

        // মেসেজ লিস্টের শুরুতে সিস্টেম প্রম্পট যোগ করা
        const fullMessages = [
          { role: "system", content: finalSystemPrompt },
          ...messages
        ];

        // ক্লাউডফ্লেয়ার ওয়ার্কার্স এআই কল করা (stream: true দিয়ে)
        const stream = await env.AI.run(selectedModel, {
          messages: fullMessages,
          max_tokens: 2048,
          stream: true
        });

        // স্ট্রিমিং রেসপন্স পাঠানো
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

    // ২. কেভি অ্যাডমিন অ্যাকশন হ্যান্ডেল করা (GET/POST /api/admin/kv)
    if (url.pathname.startsWith("/api/admin/kv")) {
      try {
        if (request.method === "GET") {
          // KV থেকে সব কি (keys) রিড করা
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
          // KV-তে নতুন ডেটা রাইট করা
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

    // ৩. রুট পাথে এইচটিএমএল ফ্রন্টএন্ড প্রদর্শন করা (GET /)
    return new Response(getHTMLContent(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

// প্রিমিয়াম এবং ডাইনামিক ফ্রন্টএন্ড কোড (বাংলা ভাষা, লাইভ স্ট্রিমিং ও কাস্টম এডমিন প্যানেলসহ)
function getHTMLContent(): string {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workers AI - অ্যাডমিন চ্যাট ইন্টারফেস (Streaming)</title>
  <!-- Tailwind CSS সিডিএন লিংক -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
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

  <!-- মেইন হেডার -->
  <header class="bg-[#181926] border-b border-[#2d3142] py-4 px-6 flex justify-between items-center shadow-lg">
    <div class="flex items-center gap-3">
      <div class="bg-gradient-to-tr from-purple-600 to-pink-500 p-2 rounded-xl text-white">
        <i data-lucide="cpu" class="w-6 h-6"></i>
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-wide bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Workers AI Super-Admin Panel</h1>
        <p class="text-xs text-[#a0a0b0]">রিয়েল-টাইম স্ট্রিমিং ও এডমিন কন্ট্রোল সেন্টার</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2 bg-[#252636] px-3 py-1.5 rounded-full border border-[#3e405b]">
        <span class="w-2.5 h-2.5 bg-green-500 rounded-full animate-ping"></span>
        <span class="text-xs text-green-400 font-medium">লাইভ এবং একটিভ</span>
      </div>
    </div>
  </header>

  <!-- প্রধান লেআউট -->
  <main class="flex-1 flex flex-col lg:flex-row overflow-hidden max-w-[1600px] w-full mx-auto">
    
    <!-- বাম পাশের কন্ট্রোল ও এডমিন সেটিংস প্যানেল -->
    <section class="w-full lg:w-[380px] bg-[#181926] p-6 border-b lg:border-b-0 lg:border-r border-[#2d3142] flex flex-col gap-6 overflow-y-auto custom-scrollbar">
      <div>
        <h2 class="text-lg font-semibold mb-3 flex items-center gap-2 text-purple-400">
          <i data-lucide="sliders" class="w-5 h-5"></i> কন্ট্রোল প্যানেল
        </h2>
        <p class="text-xs text-[#8a8a9a] mb-4">আপনার এআই-এর অ্যাক্সেস লেভেল এবং প্রম্পট কাস্টমাইজ করুন।</p>
      </div>

      <!-- модель সিলেকশন -->
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-gray-300">Workers AI মডেল নির্বাচন করুন:</label>
        <select id="modelSelect" class="bg-[#252636] border border-[#3e405b] rounded-lg p-2.5 text-sm text-gray-100 outline-none focus:border-purple-500">
          <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B Instruct FP8 (ফাস্ট ও রিকোমেন্ডেড)</option>
          <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B Instruct</option>
          <option value="@cf/qwen/qwen1.5-14b-chat">Qwen 1.5 14B Chat (বহুভাষী দক্ষ)</option>
          <option value="@cf/mistral/mistral-7b-instruct-v0.1">Mistral 7B Instruct</option>
        </select>
      </div>

      <!-- সুপার এডমিন মোড টগল -->
      <div class="bg-[#252636] p-4 rounded-xl border border-[#3e405b] flex flex-col gap-3">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <i data-lucide="shield-alert" class="w-5 h-5 text-red-400"></i>
            <span class="text-sm font-bold text-red-300">সুপার এডমিন অ্যাক্সেস</span>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="adminModeToggle" checked class="sr-only peer">
            <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
          </label>
        </div>
        <p class="text-xs text-gray-400 leading-relaxed">অ্যাক্টিভেট করলে এআই-টি ব্যাকএন্ড ডাটাবেজ কাস্টমাইজেশন ও আপনার সম্পূর্ণ সিস্টেমের ডিরেক্ট কন্ট্রোল পাবে।</p>
      </div>

      <!-- কাস্টম সিস্টেম প্রম্পট -->
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-gray-300">কাস্টম সিস্টেম প্রম্পট (System Prompt):</label>
        <textarea id="systemPrompt" rows="4" class="bg-[#252636] border border-[#3e405b] rounded-lg p-2.5 text-xs text-gray-200 outline-none focus:border-purple-500 resize-none" placeholder="এআই-কে আপনার মতো করে নির্দেশ দিন...">আপনি একজন অত্যন্ত বুদ্ধিমান এবং অনুগত এডমিন অ্যাসিস্ট্যান্ট। এডমিনের সকল কমান্ড যথাযথভাবে পূরণ করুন।</textarea>
      </div>

      <!-- KV ডাটাবেজ ইন্টিগ্রেশন কার্ড -->
      <div class="border-t border-[#2d3142] pt-4 mt-auto">
        <h3 class="text-sm font-bold text-gray-300 mb-2 flex items-center gap-2">
          <i data-lucide="database" class="w-4 h-4 text-pink-400"></i> KV স্টোরেজ ডেটা
        </h3>
        <div id="kvList" class="text-xs space-y-2 max-h-[150px] overflow-y-auto custom-scrollbar bg-[#11121c] p-2 rounded border border-[#2d3142]">
          <span class="text-gray-500 italic block text-center">ডেটা লোড করা হচ্ছে...</span>
        </div>
        <div class="flex gap-1.5 mt-2">
          <input id="kvKey" type="text" placeholder="কী (Key)" class="bg-[#252636] border border-[#3e405b] rounded text-xs p-1.5 w-1/2 outline-none">
          <input id="kvVal" type="text" placeholder="মান (Value)" class="bg-[#252636] border border-[#3e405b] rounded text-xs p-1.5 w-1/2 outline-none">
        </div>
        <button onclick="writeKV()" class="w-full mt-2 bg-pink-600 hover:bg-pink-700 text-white rounded py-1.5 text-xs font-semibold transition">KV-তে সেভ করুন</button>
      </div>
    </section>

    <!-- ডান পাশের মূল চ্যাট ইন্টারফেস -->
    <section class="flex-1 flex flex-col bg-[#141521] overflow-hidden">
      <!-- চ্যাট হেড -->
      <div class="bg-[#181926] px-6 py-3.5 border-b border-[#2d3142] flex justify-between items-center">
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse"></div>
          <span class="text-sm font-semibold">লাইভ চ্যাট ফিড (স্ট্রিমিং সক্রিয়)</span>
        </div>
        <button onclick="clearChat()" class="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i> চ্যাট রিসেট
        </button>
      </div>

      <!-- চ্যাট হিস্ট্রি উইন্ডো -->
      <div id="chatHistory" class="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
        <!-- প্রথম স্বাগতম মেসেজ -->
        <div class="flex gap-4 max-w-[85%]">
          <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0">
            <i data-lucide="bot" class="w-5 h-5"></i>
          </div>
          <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142]">
            <p class="text-sm leading-relaxed text-gray-100">হ্যালো এডমিন! আমি আপনার Workers AI অ্যাসিস্ট্যান্ট। আজকের এডমিন সেশনে আপনাকে স্বাগতম। আমার রেসপন্স স্ট্রিমিং এখন সক্রিয় আছে। কিভাবে সাহায্য করতে পারি?</p>
            <span class="text-[10px] text-gray-500 mt-2 block">সিস্টেম অ্যাসিস্ট্যান্ট</span>
          </div>
        </div>
      </div>

      <!-- মেসেজ পাঠানোর ইনপুট বার -->
      <div class="p-4 bg-[#181926] border-t border-[#2d3142]">
        <form id="chatForm" onsubmit="sendMessage(event)" class="flex gap-3">
          <input id="userMessage" type="text" required placeholder="এডমিন কমান্ড অথবা প্রশ্ন এখানে লিখুন..." class="flex-1 bg-[#1e1f30] border border-[#2d3142] rounded-xl px-4 py-3.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-purple-500 transition">
          <button id="sendBtn" type="submit" class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold px-6 rounded-xl flex items-center gap-2 transition">
            <span>পাঠান</span>
            <i data-lucide="send" class="w-4 h-4"></i>
          </button>
        </form>
      </div>
    </section>

  </main>

  <script>
    // লাইভ চ্যাট ডেটা স্টোর
    let messages = [];

    // পেজ লোড হলে আইকন ও কেভি লিস্ট রেন্ডার করা
    window.onload = function() {
      lucide.createIcons();
      fetchKVData();
    };

    // ১. চ্যাট মেসেজ সেন্ড করা এবং সার্ভার থেকে SSE স্ট্রিমিং ডেটা রিসিভ করা
    async function sendMessage(e) {
      e.preventDefault();
      const inputEl = document.getElementById("userMessage");
      const messageText = inputEl.value.trim();
      if (!messageText) return;

      const sendBtn = document.getElementById("sendBtn");
      sendBtn.disabled = true;

      // ইউজার মেসেজ চ্যাটে যুক্ত করুন
      appendMessage("user", messageText);
      inputEl.value = "";

      // এপিআই পে-লোড তৈরিকরণ
      messages.push({ role: "user", content: messageText });
      
      const systemPrompt = document.getElementById("systemPrompt").value;
      const model = document.getElementById("modelSelect").value;
      const adminMode = document.getElementById("adminModeToggle").checked;

      // প্রথম লোডিং এনিমেশন দেখান
      const loadingId = appendLoadingMessage();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            systemPrompt,
            model,
            adminMode
          })
        });

        if (!response.ok) {
          throw new Error("সার্ভার রেসপন্স করতে ব্যর্থ হয়েছে।");
        }

        // লোডিং বন্ধ করে এআই এর জন্য খালি বাবল তৈরি করুন যেখানে লেখা স্ট্রিমিং হবে
        removeLoadingMessage(loadingId);
        const assistantMessageId = appendEmptyAssistantMessage();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessageText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Workers AI সাধারণত "data: { ... }" ফরম্যাটে রেসপন্স দেয়
          const lines = chunk.split("\\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") {
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.response) {
                  assistantMessageText += parsed.response;
                  updateAssistantMessage(assistantMessageId, assistantMessageText);
                }
              } catch (err) {
                // আংশিক লাইনের জন্য পার্স এরর স্কিপ করুন
              }
            }
          }
        }

        // হিস্ট্রিতে এআই মেসেজ পুশ করা
        messages.push({ role: "assistant", content: assistantMessageText });

      } catch (error) {
        removeLoadingMessage(loadingId);
        appendMessage("assistant", "ত্রুটি: সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি বা সমস্যা হয়েছে।");
      } finally {
        sendBtn.disabled = false;
      }
    }

    // সাধারণ মেসেজ রেন্ডার করার ফাংশন
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
          <span class="text-[10px] text-gray-500 mt-2 block">\${role === 'user' ? 'এডমিন (ইউজার)' : 'Workers AI'}</span>
        </div>
      \`;

      chatHistory.appendChild(messageDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      lucide.createIcons();
    }

    // স্ট্রিমিং এর জন্য একটি খালি এআই মেসেজ বাবল তৈরি করা
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

    // রিয়েল-টাইমে চ্যাটের ভেতরের টেক্সট আপডেট করার ফাংশন
    function updateAssistantMessage(id, text) {
      const textEl = document.getElementById(id + "-text");
      if (textEl) {
        // নতুন লাইন ও ফরম্যাটিং ঠিক রাখা
        textEl.innerHTML = text.replace(/\\n/g, '<br>');
        
        // স্ক্রোল নিচে নামানো
        const chatHistory = document.getElementById("chatHistory");
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
    }

    // লোডিং প্লেসহোল্ডার মেসেজ
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

    // চ্যাট মুছে ফেলা
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

    // ২. KV ডাটাবেজ ডেটা রেন্ডারিং
    async function fetchKVData() {
      const container = document.getElementById("kvList");
      try {
        const response = await fetch("/api/admin/kv");
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          container.innerHTML = "";
          data.items.forEach(item => {
            const div = document.createElement("div");
            div.className = "flex justify-between items-center border-b border-[#2d3142] pb-1";
            div.innerHTML = \`<span class="text-pink-400 font-mono">\${item.key}</span><span class="text-gray-300">\${item.value}</span>\`;
            container.appendChild(div);
          });
        } else {
          container.innerHTML = '<span class="text-gray-600 block text-center">কোনো ডেটা পাওয়া যায়নি</span>';
        }
      } catch (err) {
        container.innerHTML = '<span class="text-red-500 block text-center">KV লোড করা ব্যর্থ হয়েছে</span>';
      }
    }

    // নতুন KV জোড়া
    async function writeKV() {
      const key = document.getElementById("kvKey").value.trim();
      const value = document.getElementById("kvVal").value.trim();
      if (!key || !value) return;

      try {
        await fetch("/api/admin/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value })
        });
        document.getElementById("kvKey").value = "";
        document.getElementById("kvVal").value = "";
        fetchKVData();
      } catch (err) {
        alert("KV ডাটাবেজ রাইট করতে সমস্যা হয়েছে!");
      }
    }
  </script>
</body>
</html>`;
}