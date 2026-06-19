/**
 * Supercharged LLM Chat App Frontend
 * * Features:
 * - Robust SSE (Server-Sent Events) Stream Processing (supports Cloudflare Workers & OpenAI formats)
 * - Custom Lightweight Markdown & Rich Code Block Renderer
 * - Modern "Copy Code" Clipboard Functionality
 * - Dynamic Chat Persistence (Local Storage Backup)
 * - Intelligent Auto-Scrolling & Screen Tracking
 * - Auto-resizing Multi-line Responsive Textarea
 */

// DOM Elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const modelSelect = document.getElementById("model-select");
const adminModeToggle = document.getElementById("admin-mode-toggle");

// Chat State Configuration
let chatHistory = [];
let isProcessing = false;
let autoScrollEnabled = true;

// Init on Page Load
window.addEventListener("DOMContentLoaded", () => {
    loadChatHistory();
    setupEventListeners();
});

/**
 * All Event Listeners Setup
 */
function setupEventListeners() {
    // Auto-resize textarea dynamically
    userInput.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 250) + "px"; // Limit max height
    });

    // Handle Enter and Shift+Enter key combinations
    userInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Send Button Trigger
    sendButton.addEventListener("click", sendMessage);

    // Scroll tracker to detect manual up-scrolling
    chatMessages.addEventListener("scroll", () => {
        const threshold = 50; // pixels from bottom
        const currentScroll = chatMessages.scrollTop + chatMessages.clientHeight;
        const totalHeight = chatMessages.scrollHeight;
        autoScrollEnabled = (totalHeight - currentScroll) <= threshold;
    });
}

/**
 * Loads Chat History from Local Storage
 */
function loadChatHistory() {
    try {
        const savedHistory = localStorage.getItem("super_chat_history");
        if (savedHistory) {
            chatHistory = JSON.parse(savedHistory);
            renderAllMessages();
        } else {
            // Default Welcome Message
            chatHistory = [
                {
                    role: "assistant",
                    content: "হ্যালো! আমি ক্লাউডফ্লেয়ার ওয়ার্কার্স এআই দ্বারা চালিত একটি সুপারচার্জড চ্যাট অ্যাসিস্ট্যান্ট। আমি কোড লিখতে, ডিরেক্টরি ব্রাউজ করতে এবং গিটহাবে সরাসরি কাজ করতে আপনাকে সাহায্য করতে পারি। আজ আপনাকে কীভাবে সাহায্য করতে পারি?",
                }
            ];
            renderAllMessages();
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

/**
 * Saves Chat History to Local Storage
 */
function saveChatHistory() {
    try {
        localStorage.setItem("super_chat_history", JSON.stringify(chatHistory));
    } catch (e) {
        console.error("Failed to save chat history to Storage:", e);
    }
}

/**
 * Clean & Render All Messages from History
 */
function renderAllMessages() {
    chatMessages.innerHTML = "";
    chatHistory.forEach(msg => {
        addMessageToChat(msg.role, msg.content, false);
    });
    scrollToBottom(true);
}

/**
 * Robust Custom Markdown to HTML Renderer
 * Handles headers, bold text, inline code, and complex code blocks with copy-to-clipboard buttons.
 */
function formatMarkdown(text) {
    if (!text) return "";

    // Escape HTML to prevent XSS
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Code Blocks with Syntax-like Highlighting and Copy Button
    // Match ```lang\ncode\n```
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n?```/g;
    html = html.replace(codeBlockRegex, (match, lang, code) => {
        const language = lang || "code";
        const uniqueId = "code-" + Math.random().toString(36).substr(2, 9);
        return `
            <div class="code-block-container my-4 rounded-xl overflow-hidden border border-[#2d3142] bg-[#11121c] shadow-md font-mono">
                <div class="code-block-header bg-[#1f2030] px-4 py-2 flex justify-between items-center border-b border-[#2d3142]">
                    <span class="text-xs text-purple-400 font-semibold uppercase tracking-wider">${language}</span>
                    <button onclick="copyToClipboard('${uniqueId}', this)" class="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition bg-[#2a2b3d] hover:bg-[#34354a] px-2.5 py-1 rounded">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                        <span>Copy</span>
                    </button>
                </div>
                <pre class="p-4 overflow-x-auto custom-scrollbar text-xs leading-relaxed text-green-300"><code id="${uniqueId}">${code}</code></pre>
            </div>
        `;
    });

    // Inline Code: `code`
    html = html.replace(/`([^`]+)`/g, '<code class="bg-[#282a36] text-pink-400 px-1.5 py-0.5 rounded font-mono text-xs">$1</code>');

    // Bold Text: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');

    // Italic Text: *text*
    html = html.replace(/\*([^*]+)\*/g, '<em class="italic text-gray-300">$1</em>');

    // Bullet Lists: lines starting with - or *
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc text-sm text-gray-200 py-0.5">$1</li>');

    // Line breaks to <br> outside code containers
    html = html.replace(/\n/g, "<br>");

    return html;
}

/**
 * Universal Clipboard Copy Helper
 */
window.copyToClipboard = function (elementId, buttonEl) {
    const codeElement = document.getElementById(elementId);
    if (!codeElement) return;

    // Use textarea selection method to bypass iframe restrictions in some workspace environments
    const textToCopy = codeElement.innerText;
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = textToCopy;
    tempTextArea.style.position = "absolute";
    tempTextArea.style.left = "-9999px";
    document.body.appendChild(tempTextArea);
    tempTextArea.select();

    try {
        const successful = document.execCommand("copy");
        if (successful) {
            const originalText = buttonEl.innerHTML;
            buttonEl.innerHTML = `
                <svg class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                <span class="text-green-400 font-bold">Copied!</span>
            `;
            setTimeout(() => {
                buttonEl.innerHTML = originalText;
            }, 2000);
        }
    } catch (err) {
        console.error("Unable to copy", err);
    } finally {
        document.body.removeChild(tempTextArea);
    }
};

/**
 * Sends User Message and Handles Advanced Stream Chunk Processing
 */
async function sendMessage() {
    const message = userInput.value.trim();
    if (message === "" || isProcessing) return;

    // Set Processing State
    isProcessing = true;
    userInput.disabled = true;
    sendButton.disabled = true;

    // Append User Message to UI & State
    addMessageToChat("user", message);
    chatHistory.push({ role: "user", content: message });
    saveChatHistory();

    // Reset Textarea Heights
    userInput.value = "";
    userInput.style.height = "auto";

    // Show Typing Loader
    typingIndicator.classList.add("visible");

    try {
        // Build empty response bubble
        const assistantMessageId = "assistant-msg-" + Date.now();
        const assistantMessageEl = document.createElement("div");
        assistantMessageEl.id = assistantMessageId;
        assistantMessageEl.className = "message assistant-message flex gap-4 max-w-[85%] mt-4 animate-fadeIn";
        assistantMessageEl.innerHTML = `
            <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0 shadow">
                <svg class="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
            </div>
            <div class="bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142] flex-1">
                <div class="text-sm leading-relaxed text-gray-100 markdown-body" id="${assistantMessageId}-text">...</div>
                <span class="text-[10px] text-gray-500 mt-2 block">Workers AI Stream</span>
            </div>
        `;
        chatMessages.appendChild(assistantMessageEl);
        const textContainer = document.getElementById(`${assistantMessageId}-text`);

        scrollToBottom(true);

        // Extract UI Settings Context
        const model = modelSelect ? modelSelect.value : "@cf/meta/llama-3.1-8b-instruct-fp8";
        const adminMode = adminModeToggle ? adminModeToggle.checked : false;

        // Fetch API request
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: chatHistory,
                model: model,
                adminMode: adminMode
            }),
        });

        if (!response.ok) throw new Error("সার্ভার প্রতিক্রিয়া দিতে ব্যর্থ হয়েছে।");
        if (!response.body) throw new Error("সার্ভার রেসপন্স বডি নাল এসেছে।");

        // Hide Typing Loader immediately when stream starts
        typingIndicator.classList.remove("visible");

        // Handle SSE Chunks Stream Reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let responseText = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parsed = consumeSseEvents(buffer);
            buffer = parsed.buffer;

            for (const data of parsed.events) {
                if (data === "[DONE]") break;
                try {
                    const jsonData = JSON.parse(data);
                    let chunk = "";
                    if (typeof jsonData.response === "string") {
                        chunk = jsonData.response;
                    } else if (jsonData.choices?.[0]?.delta?.content) {
                        chunk = jsonData.choices[0].delta.content;
                    }
                    if (chunk) {
                        responseText += chunk;
                        textContainer.innerHTML = formatMarkdown(responseText);
                        scrollToBottom(false);
                    }
                } catch (e) {
                    // Fail silently for half-written JSON chunks during high-speed stream
                }
            }
        }

        // Add completed assistant response to history
        if (responseText.length > 0) {
            chatHistory.push({ role: "assistant", content: responseText });
            saveChatHistory();
        }

    } catch (error) {
        console.error("Error Processing AI Stream:", error);
        typingIndicator.classList.remove("visible");
        addMessageToChat("assistant", "💥 দুঃখিত! সিস্টেম সার্ভারের সাথে সংযোগ স্থাপন করতে পারেনি। দয়া করে আপনার নেটওয়ার্ক কানেকশন চেক করুন এবং পুনরায় চেষ্টা করুন।");
    } finally {
        isProcessing = false;
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }
}

/**
 * Inserts a single message bubble into the chat window DOM
 */
function addMessageToChat(role, content, saveToState = false) {
    const messageEl = document.createElement("div");
    const isUser = role === "user";
    
    messageEl.className = isUser 
        ? "flex gap-4 max-w-[85%] ml-auto justify-end mt-4 animate-fadeIn" 
        : "flex gap-4 max-w-[85%] mt-4 animate-fadeIn";

    const avatar = isUser
        ? `<div class="w-9 h-9 rounded-xl bg-pink-600 flex items-center justify-center text-white order-2 shrink-0 shadow">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
           </div>`
        : `<div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shrink-0 shadow">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
           </div>`;

    const bubbleClass = isUser
        ? "bg-purple-600/20 border border-purple-500/40 p-4 rounded-2xl rounded-tr-none text-right flex-1"
        : "bg-[#1e1f30] p-4 rounded-2xl rounded-tl-none border border-[#2d3142] flex-1";

    messageEl.innerHTML = `
        ${avatar}
        <div class="${bubbleClass} order-1">
            <div class="text-sm leading-relaxed text-gray-100 text-left markdown-body">${formatMarkdown(content)}</div>
            <span class="text-[10px] text-gray-500 mt-2 block">${isUser ? 'Super Admin' : 'Workers AI'}</span>
        </div>
    `;

    chatMessages.appendChild(messageEl);
    scrollToBottom(false);

    if (saveToState) {
        chatHistory.push({ role, content });
        saveChatHistory();
    }
}

/**
 * Scroll Control Manager
 */
function scrollToBottom(force = false) {
    if (autoScrollEnabled || force) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

/**
 * Consumes continuous Server-Sent Event Streams accurately
 */
function consumeSseEvents(buffer) {
    let normalized = buffer.replace(/\r/g, "");
    const events = [];
    let eventEndIndex;
    
    while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
        const rawEvent = normalized.slice(0, eventEndIndex);
        normalized = normalized.slice(eventEndIndex + 2);

        const lines = rawEvent.split("\n");
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith("data:")) {
                dataLines.push(line.slice("data:".length).trimStart());
            }
        }
        if (dataLines.length === 0) continue;
        events.push(dataLines.join("\n"));
    }
    return { events, buffer: normalized };
}

/**
 * Completely Clears Active Session & Local Chat Storage
 */
window.resetChatSession = function() {
    localStorage.removeItem("super_chat_history");
    chatHistory = [
        {
            role: "assistant",
            content: "হিস্ট্রি সফলভাবে ক্লিয়ার করা হয়েছে। নতুন চ্যাট সেশন শুরু করুন!",
        }
    ];
    renderAllMessages();
};