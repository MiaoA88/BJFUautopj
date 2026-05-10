// ==UserScript==
// @name         北林教务系统自动评教
// @name:zh-CN   北林教务系统自动评教
// @name:en      BJFU Auto Teaching Evaluation
// @namespace    https://newjwxt.bjfu.edu.cn/
// @version      1.0.0
// @description  在学生评教课程列表页一键自动填写并提交未完成的评教。
// @description:zh-CN 在学生评教课程列表页一键自动填写并提交未完成的评教。
// @description:en Automatically fill and submit teaching evaluations from the BJFU course evaluation list page.
// @author       Miao_A
// @license      MIT
// @match        http://newjwxt.bjfu.edu.cn/jsxsd/xspj/*
// @match        https://newjwxt.bjfu.edu.cn/jsxsd/xspj/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    // 1 = 第一项，例如“非常满意”；2 = 第二项，例如“满意”。
    teacherOptionIndex: 2,
    selfOptionIndex: 2,

    // 如果选了需要评价理由的选项，或服务器要求理由，会提交这段文字。长度保持在 10-50 个汉字附近。
    reasonText: "课程内容清晰，老师讲解认真负责。",

    // 个性化标签最多 6 个。脚本会优先按文字选中这些正向标签，找不到时选前几个可用标签。
    preferredTags: ["严师益友", "学者风范", "言传身教", "耐心细致", "条理清晰", "善于引导学生"],
    maxTags: 6,

    // 两次提交之间的间隔，给教务系统一点喘息空间。
    delayMs: 900,

    // 调试时可改成 true：只抓取并生成表单数据，不真正提交。
    dryRun: false,
  };

  const state = {
    running: false,
    stopped: false,
    panel: null,
    logBox: null,
    startButton: null,
    stopButton: null,
  };

  function init() {
    if (!isEvaluationArea()) return;

    injectStyles();
    createPanel();

    if (isListPage()) {
      const count = collectEvaluationLinks().length;
      log(`检测到 ${count} 个可评教入口。`);
    } else if (isEditPage()) {
      state.startButton.textContent = "自动提交当前评教";
      log("当前是单个评教页面，也可以自动填写并提交当前页。");
    } else {
      log("未检测到评教列表或评教表单。请在评教课程列表页使用。", "warn");
    }
  }

  function isEvaluationArea() {
    return location.pathname.includes("/jsxsd/xspj/") || document.body.textContent.includes("学生评教");
  }

  function isListPage() {
    return collectEvaluationLinks().length > 0;
  }

  function isEditPage(doc = document) {
    return Boolean(doc.querySelector("form#Form1") && doc.querySelector("input[name='pj06xh']"));
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #auto-eval-panel {
        position: fixed;
        right: 18px;
        top: 86px;
        z-index: 999999;
        width: 310px;
        color: #1f2933;
        background: #fff;
        border: 1px solid #9db7df;
        box-shadow: 0 8px 24px rgba(31, 41, 51, 0.18);
        font: 13px/1.5 Arial, "Microsoft YaHei", sans-serif;
      }
      #auto-eval-panel .ae-head {
        padding: 8px 10px;
        color: #fff;
        background: #2f6db5;
        font-weight: 700;
      }
      #auto-eval-panel .ae-body { padding: 10px; }
      #auto-eval-panel .ae-actions { display: flex; gap: 8px; margin-bottom: 8px; }
      #auto-eval-panel button {
        cursor: pointer;
        border: 1px solid #1f5d9e;
        background: #2f6db5;
        color: #fff;
        padding: 5px 10px;
        font-size: 13px;
      }
      #auto-eval-panel button:disabled { cursor: not-allowed; opacity: 0.55; }
      #auto-eval-panel button.ae-stop { border-color: #9f3a38; background: #b94a48; }
      #auto-eval-panel .ae-note { margin-bottom: 8px; color: #5b6673; }
      #auto-eval-panel .ae-log {
        max-height: 260px;
        overflow: auto;
        border: 1px solid #d8e0ea;
        background: #f7f9fc;
        padding: 6px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #auto-eval-panel .ok { color: #1f7a3f; }
      #auto-eval-panel .warn { color: #986b00; }
      #auto-eval-panel .err { color: #b00020; }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "auto-eval-panel";
    panel.innerHTML = `
      <div class="ae-head">自动评教</div>
      <div class="ae-body">
        <div class="ae-actions">
          <button type="button" class="ae-start">开始自动评教</button>
          <button type="button" class="ae-stop" disabled>停止</button>
        </div>
        <div class="ae-note">点击开始后会直接提交，提交后通常不能修改。</div>
        <div class="ae-log"></div>
      </div>
    `;
    document.body.appendChild(panel);

    state.panel = panel;
    state.logBox = panel.querySelector(".ae-log");
    state.startButton = panel.querySelector(".ae-start");
    state.stopButton = panel.querySelector(".ae-stop");

    state.startButton.addEventListener("click", start);
    state.stopButton.addEventListener("click", () => {
      state.stopped = true;
      log("收到停止请求，当前这一项处理完后停止。", "warn");
    });
  }

  async function start() {
    if (state.running) return;

    state.running = true;
    state.stopped = false;
    state.startButton.disabled = true;
    state.stopButton.disabled = false;

    try {
      if (isEditPage()) {
        await submitCurrentEditPage();
      } else {
        await submitFromListPage();
      }
    } catch (error) {
      log(error && error.message ? error.message : String(error), "err");
    } finally {
      state.running = false;
      state.startButton.disabled = false;
      state.stopButton.disabled = true;
    }
  }

  async function submitCurrentEditPage() {
    fillEvaluationDocument(document);

    if (CONFIG.dryRun) {
      log("调试模式：已填写当前页，但没有提交。", "warn");
      return;
    }

    const form = document.querySelector("form#Form1");
    form.querySelector("#issubmit, input[name='issubmit']").value = "1";
    log("正在提交当前评教页...");
    form.submit();
  }

  async function submitFromListPage() {
    const links = collectEvaluationLinks();
    if (links.length === 0) {
      log("没有找到可评教入口。", "warn");
      return;
    }

    log(`开始处理 ${links.length} 个评教入口。`);
    let success = 0;
    let failed = 0;

    for (let index = 0; index < links.length; index += 1) {
      if (state.stopped) break;

      const item = links[index];
      log(`(${index + 1}/${links.length}) ${item.title}：读取评教页...`);

      try {
        const result = await submitOne(item.url);
        success += 1;
        markRow(item.anchor, true);
        log(`(${index + 1}/${links.length}) ${item.title}：${result}`, "ok");
      } catch (error) {
        failed += 1;
        markRow(item.anchor, false);
        log(`(${index + 1}/${links.length}) ${item.title}：失败 - ${error.message || error}`, "err");
      }

      if (index < links.length - 1 && !state.stopped) {
        await sleep(CONFIG.delayMs);
      }
    }

    log(`完成：成功 ${success} 项，失败 ${failed} 项。建议刷新页面确认“是否提交”状态。`, failed ? "warn" : "ok");
  }

  async function submitOne(editUrl) {
    const absoluteEditUrl = new URL(editUrl, location.origin).href;
    const editHtml = await requestText(absoluteEditUrl, { method: "GET" });
    const editDoc = new DOMParser().parseFromString(editHtml, "text/html");

    if (!isEditPage(editDoc)) {
      throw new Error("返回页面不是评教表单，可能登录已失效或评教未开放");
    }

    fillEvaluationDocument(editDoc);
    const form = editDoc.querySelector("form#Form1");
    const submitFlag = form.querySelector("#issubmit, input[name='issubmit']");
    if (submitFlag) submitFlag.value = "1";

    const action = form.getAttribute("action");
    if (!action) throw new Error("评教表单缺少提交地址");

    if (CONFIG.dryRun) {
      return "调试模式已生成提交数据，未真正提交";
    }

    const formData = buildRequestBody(form);
    const submitUrl = new URL(action, absoluteEditUrl).href;
    const responseText = await requestText(submitUrl, {
      method: (form.getAttribute("method") || "POST").toUpperCase(),
      body: formData,
    });

    const plainText = normalizeText(responseText);
    if (/登录|重新登陆|重新登录|notSession/i.test(plainText) && !/提交成功|保存成功/.test(plainText)) {
      throw new Error("服务器提示可能未登录，请重新登录后再试");
    }
    if (/失败|错误|异常/.test(plainText) && !/提交成功|保存成功/.test(plainText)) {
      throw new Error(firstUsefulLine(plainText) || "服务器返回失败信息");
    }

    return /提交成功|保存成功/.test(plainText) ? "提交成功" : "已提交，服务器未返回明确成功文字";
  }

  function fillEvaluationDocument(doc) {
    chooseRadioGroups(doc, "pj06xh", CONFIG.teacherOptionIndex);
    chooseRadioGroups(doc, "xszwpjxh", CONFIG.selfOptionIndex);
    fillReasons(doc);
    chooseTags(doc);
  }

  function buildRequestBody(form) {
    const enctype = (form.getAttribute("enctype") || "application/x-www-form-urlencoded").toLowerCase();
    const formData = new FormData(form);
    if (enctype.includes("multipart/form-data")) return formData;

    const params = new URLSearchParams();
    formData.forEach((value, key) => params.append(key, value));
    return params;
  }

  function chooseRadioGroups(doc, hiddenName, optionIndex) {
    const ids = Array.from(doc.querySelectorAll(`input[name='${hiddenName}']`)).map((input) => input.value);
    ids.forEach((id) => {
      const radios = Array.from(doc.querySelectorAll(`input[type='radio'][name='pj0601id_${cssEscape(id)}']`));
      if (radios.length === 0) return;

      const wantedIndex = Math.min(Math.max(optionIndex, 1), radios.length) - 1;
      radios.forEach((radio) => {
        radio.checked = false;
        radio.removeAttribute("checked");
      });
      radios[wantedIndex].checked = true;
      radios[wantedIndex].setAttribute("checked", "checked");
    });
  }

  function fillReasons(doc) {
    doc.querySelectorAll("input[name^='pjly_'], textarea[name^='pjly_']").forEach((field) => {
      field.value = CONFIG.reasonText;
      field.setAttribute("value", CONFIG.reasonText);
    });
  }

  function chooseTags(doc) {
    const checkboxes = Array.from(doc.querySelectorAll("input[type='checkbox'][name='gxhbq']"));
    if (checkboxes.length === 0) return;

    checkboxes.forEach((checkbox) => {
      checkbox.checked = false;
      checkbox.removeAttribute("checked");
    });

    const selected = [];
    CONFIG.preferredTags.forEach((keyword) => {
      const checkbox = checkboxes.find((item) => !selected.includes(item) && getCheckboxLabelText(doc, item).includes(keyword));
      if (checkbox && selected.length < CONFIG.maxTags) selected.push(checkbox);
    });

    checkboxes.forEach((checkbox) => {
      if (selected.length < Math.min(CONFIG.maxTags, checkboxes.length) && !selected.includes(checkbox)) {
        selected.push(checkbox);
      }
    });

    selected.slice(0, CONFIG.maxTags).forEach((checkbox) => {
      checkbox.checked = true;
      checkbox.setAttribute("checked", "checked");
    });
  }

  function getCheckboxLabelText(doc, checkbox) {
    const id = checkbox.getAttribute("id");
    if (id) {
      const label = doc.querySelector(`label[for='${cssEscape(id)}']`);
      if (label) return normalizeText(label.textContent);
    }
    return normalizeText(checkbox.closest("td") ? checkbox.closest("td").textContent : "");
  }

  function collectEvaluationLinks() {
    const links = Array.from(document.querySelectorAll("a"));
    const result = [];
    const seen = new Set();

    links.forEach((anchor) => {
      if (normalizeText(anchor.textContent) !== "评教") return;

      const raw = anchor.getAttribute("href") || anchor.getAttribute("onclick") || "";
      const editUrl = extractEditUrl(raw);
      if (!editUrl || seen.has(editUrl)) return;

      seen.add(editUrl);
      result.push({
        anchor,
        url: editUrl,
        title: getRowTitle(anchor),
      });
    });

    return result;
  }

  function extractEditUrl(raw) {
    const decoded = htmlDecode(raw);
    const match = decoded.match(/JsMod1\(["']([^"']*xspj_edit\.do[^"']*)["']/i);
    if (match) return match[1];
    if (/xspj_edit\.do/i.test(decoded)) return decoded.replace(/^javascript:/i, "");
    return "";
  }

  function getRowTitle(anchor) {
    const row = anchor.closest("tr");
    if (!row) return "评教项目";

    const cells = Array.from(row.cells).map((cell) => normalizeText(cell.textContent)).filter(Boolean);
    const teacher = cells[3] || "未知教师";
    const type = cells[4] || "";
    const course = findCourseName(row) || cells[2] || "课程";
    return `${course} / ${teacher}${type ? ` / ${type}` : ""}`;
  }

  function findCourseName(row) {
    let current = row;
    while (current) {
      const cells = Array.from(current.cells || []);
      const visibleCourseCell = cells.find((cell, index) => {
        const text = normalizeText(cell.textContent);
        const hidden = /display\s*:\s*none/i.test(cell.getAttribute("style") || "");
        return index >= 1 && text && !/^\d+$/.test(text) && !hidden && !/[是否]/.test(text);
      });
      if (visibleCourseCell) return normalizeText(visibleCourseCell.textContent);
      current = current.previousElementSibling;
    }
    return "";
  }

  async function requestText(url, options) {
    const response = await fetch(url, {
      credentials: "include",
      redirect: "follow",
      ...options,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${firstUsefulLine(text) || response.statusText}`);
    }
    return text;
  }

  function markRow(anchor, ok) {
    const row = anchor.closest("tr");
    if (!row) return;
    row.style.outline = ok ? "2px solid #2e8b57" : "2px solid #b00020";
    row.style.backgroundColor = ok ? "#f0fff5" : "#fff5f5";
  }

  function log(message, type) {
    if (!state.logBox) return;
    const line = document.createElement("div");
    if (type) line.className = type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logBox.appendChild(line);
    state.logBox.scrollTop = state.logBox.scrollHeight;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function firstUsefulLine(text) {
    return normalizeText(String(text || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 120);
  }

  function htmlDecode(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/['"\\]/g, "\\$&");
  }

  init();
})();
