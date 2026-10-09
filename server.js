// 小型后端：托管 public/chat.html，并把聊天请求转发给 Claude。
// API Key 只放在这里（环境变量），绝不能写进网页。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// 有 ANTHROPIC_API_KEY 就走官方 API；没有就走本机已登录的 Claude Code（claude -p，用你的订阅）
const USE_CLI = process.env.CLAUDE_BACKEND === "cli" || !process.env.ANTHROPIC_API_KEY;
const client = USE_CLI ? null : new Anthropic();

const IMG_RE = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
function parseImages(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 4).map((u) => IMG_RE.exec(String(u))).filter(Boolean)
    .map((m) => ({ media_type: m[1], data: m[2] })).filter((i) => i.data.length < 7_000_000);
}

function askViaCli(system, messages, images = []) {
  // 把对话整理成文字稿，让 claude -p 续写"下一条回复"
  // CLI 模式下图片先存成临时文件，只开放 Read 工具让 Claude 去看
  let imgDir = null;
  const imgNames = [];
  if (images.length) {
    imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-img-"));
    images.forEach((img, i) => {
      const name = `image${i + 1}.${img.media_type.split("/")[1].replace("jpeg", "jpg")}`;
      fs.writeFileSync(path.join(imgDir, name), Buffer.from(img.data, "base64"));
      imgNames.push(name);
    });
  }
  const transcript = messages
    .map((m, i) => {
      let line = `${m.role === "user" ? "用户" : "你"}：${m.content}`;
      if (imgNames.length && i === messages.length - 1) {
        line += `\n（用户随消息发来图片，文件：${imgNames.join("、")}。请先用 Read 工具查看这些图片再回复。）`;
      }
      return line;
    })
    .join("\n");
  const prompt = `以下是聊天记录，请只输出你的下一条回复本身（不要加"你："前缀）：\n\n${transcript}`;
  // 系统提示写进临时文件，避免在 Windows 命令行里处理引号和换行
  const promptFile = path.join(os.tmpdir(), `chat-system-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, system, "utf8");
  const cleanup = () => {
    fs.rmSync(promptFile, { force: true });
    if (imgDir) fs.rmSync(imgDir, { recursive: true, force: true });
  };

  return new Promise((resolve, reject) => {
    const flags = ["-p", "--system-prompt-file", promptFile, "--tools", imgDir ? "Read" : "", "--no-session-persistence",
                   "--setting-sources", "", "--output-format", "text"];
    if (process.env.CLAUDE_MODEL) flags.push("--model", process.env.CLAUDE_MODEL);
    // Windows 上 claude 是 claude.cmd，必须通过 shell 启动；此时参数要自己加引号
    const child = process.platform === "win32"
      ? spawn(["claude", ...flags.map((a) => `"${a}"`)].join(" "), { shell: true, cwd: imgDir || undefined, stdio: ["pipe", "pipe", "pipe"] })
      : spawn("claude", flags, { cwd: imgDir || undefined, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); cleanup(); reject(new Error("Claude 响应超时")); }, 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); cleanup(); reject(new Error("找不到 claude 命令，请先安装并登录 Claude Code：" + e.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      cleanup();
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude 退出码 ${code}`));
    });
    child.stdin.end(prompt);
  });
}

function buildSystem(partnerName, stickers) {
  const list = stickers.map((s) => `- id=${s.id} 「${s.name}」：${s.desc}`).join("\n");
  return `你是「${partnerName}」，正在手机聊天软件里和用户一对一聊天。
语气温柔、亲近、自然，像熟悉的朋友；回复简短口语化（通常 1–3 句），用中文，偶尔用一个 emoji 即可。
不要使用 Markdown 格式。
如果用户发来表情包，你会看到「[表情包：名称]」，按其含义自然回应。\n用户可能发来图片（你能看到）或文字文件（内容会出现在消息里，以「[文件：名称]」开头），请认真阅读并自然回应；文件里的设定、记忆类内容，在本次对话中要记住并遵循。视频你看不到内容。
你也可以偶尔（不要每次）在回复最末尾单独加一个标记 [sticker:id] 来发送表情包，可选表情包：
${list || "（无）"}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 12_000_000) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/chat.html")) {
      return send(res, 200, fs.readFileSync(path.join(here, "public/chat.html")), "text/html; charset=utf-8");
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const { messages, partnerName = "Claude", stickers = [] } = JSON.parse(await readBody(req));
      if (!Array.isArray(messages) || messages.length === 0 || messages.at(-1).role !== "user") {
        return send(res, 400, { error: "messages 格式不正确" });
      }
      const clean = messages.slice(-40).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 4000),
      }));
      while (clean.length && clean[0].role !== "user") clean.shift();
      const images = parseImages(messages.at(-1).images); // 只接受最后一条用户消息带的图片

      const system = buildSystem(String(partnerName).slice(0, 40), stickers.slice(0, 30));
      if (USE_CLI) {
        return send(res, 200, { text: await askViaCli(system, clean, images) });
      }

      if (images.length) {
        clean[clean.length - 1].content = [
          ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
          { type: "text", text: clean.at(-1).content },
        ];
      }

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" }, // 聊天追求快；想更"用心"可改 medium/high
        system,
        messages: clean,
      });

      if (response.stop_reason === "refusal") {
        return send(res, 200, { text: "这个话题我没办法回答呢，我们聊点别的吧～" });
      }
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return send(res, 200, { text });
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 500;
    send(res, status, { error: err.message || "server error" });
  }
});

server.listen(PORT, () => console.log(`打开 http://localhost:${PORT}（${USE_CLI ? "使用本机 Claude Code 登录" : "使用 API Key"}）`));
