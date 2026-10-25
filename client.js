/**
 * dsh-cyrene 的浏览器半边 —— 在「设置 → 通用」里放两行：
 *
 *   1. 「称呼偏好」输入框（留空时用昵称；对齐上游的 nickname / callPreference 两个字段）
 *   2. 「角色扮演模式」开关
 *
 * ## 为什么开关要放在浏览器半边
 *
 * 主机半边（index.js / scene.js）读的是 `<DSH_HOME>/cyrene-scene.json`，浏览器碰不到
 * 文件系统；反过来浏览器有界面但没有主机权限。所以两边分工：
 *
 *   设置 → 通用 ──(fetch)──> /cyrene-scene-api ──> scene.js 的 writeState
 *                                                        ↓
 *                                            cyrene-scene.json
 *                                                        ↓
 *                                     scene.js 每轮注册 cyrene:scene 上下文
 *
 * 开关写的是**部署级**状态：打开之后，所有走 chat 预设的会话都按角色扮演回复，
 * 关掉就回到平常聊天。
 *
 * ## 第三件事：编辑最后一条用户消息
 *
 * 纯文本对话模式里，最后一条用户消息右上角加一个铅笔按钮（图标随包发运，见 assets/）。
 * 点开是「编辑」弹层：保存后走主机半边 `/cyrene-edit-api`，用会话的**表面替换**
 * （`surfaceOp: replace`）把「这条消息 + 它之后的一切」换成改好的文本 ——
 * 旧事件留在 append-only 日志里，只是不再进入模型看到的历史。
 *
 * 这块是**DOM 补丁**：官方对话组件没有给"消息操作"留槽位，只能认 `data-chat-flow-kind`
 * 这类稳定 data 属性往消息行里塞按钮。所以补丁是幂等的、可反复跑的（React 重渲染会
 * 把按钮冲掉，观察者会补回去）。
 *
 * 只在**纯文本对话模式**（预设 id 带 chat）里生效；其它模式不挂按钮。
 *
 * ## 组件约定
 *
 * 槽位 `settings.general.item` 是 list 槽位（`id` 保证唯一）。行内样式照抄官方设置页
 * 用的 `--dsw-alias-*` 变量，不引外部样式表 —— 客户端半边的打包里没有 CSS 通道。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cyrene',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    /** 本插件自己的 locale 命名空间（同 ns + 同语言不能重复注册）。 */
    var NS = 'dsh-cyrene';
    /** 主机接口：角色扮演模式开关。 */
    var API = '/cyrene-scene-api';
    /** 主机接口：手动检查更新（GitHub releases/latest）。 */
    var UPDATE_API = '/cyrene-update-api';
    /** 主机接口：称呼偏好 / 昵称。 */
    var ADDRESS_API = '/cyrene-nickname-api';
    /** 主机接口：编辑最后一条用户消息。 */
    var EDIT_API = '/cyrene-edit-api';
    /** 编辑按钮的图标（主机半边发运）。 */
    var EDIT_ICON = '/cyrene-edit-icon.png';
    /** 编辑器 / 按钮的 DOM 标记，避免和页面其它节点混在一起。 */
    var EDIT_BTN_CLASS = 'dsh-cyrene-edit-btn';
    /** 版本切换按钮（‹ ›）的类名。 */
    var VERSION_BTN_CLASS = 'dsh-cyrene-version-btn';
    /**
     * 版本链缓存：{ sessionId, at, versions, currentIndex, loading }。
     * 每次渲染都去问主机会太吵，这里 2 秒内复用；点箭头后立刻作废。
     */
    var versionsState = { sessionId: '', at: 0, versions: [], currentIndex: -1, loading: false };
    var EDIT_MODAL_ATTR = 'data-dsh-cyrene-edit-modal';

    //#region 行样式（与官方设置行一致）

    var rowStyle = {
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
      padding: '16px 0',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      minWidth: 0
    };
    var rowTextStyle = { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: '1 1 auto' };
    var titleStyle = {
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: '22px'
    };
    var descStyle = {
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      fontWeight: 400,
      lineHeight: '18px'
    };
    var errorStyle = { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px' };
    var switchStyle = {
      flex: 'none',
      position: 'relative',
      width: '40px',
      height: '22px',
      borderRadius: '11px',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      background: 'var(--dsw-alias-border-l2)',
      transition: 'background 120ms ease'
    };
    var switchOnStyle = {
      background: 'var(--dsw-alias-state-business-primary)'
    };
    var knobStyle = {
      position: 'absolute',
      top: '3px',
      left: '3px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: 'var(--dsw-alias-bg-module-platform)',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
      transition: 'left 120ms ease'
    };
    var knobOnStyle = { left: '21px' };
    var inputStyle = {
      flex: '0 1 240px',
      minWidth: '120px',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-module-platform)',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: '8px',
      padding: '5px 10px',
      outline: 'none'
    };

    //#endregion

    /**
     * 读开关状态。
     * @returns Promise<boolean>
     */
    function fetchEnabled() {
      return fetch(API, { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          return { enabled: body.enabled === true, trailblazer: body.trailblazer === true };
        });
    }

    /**
     * 写开关状态。
     * @param enabled - 目标状态。
     * @returns Promise<boolean> 主机确认后的状态。
     */
    function saveEnabled(patch) {
      return fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch)
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
          return { enabled: body.enabled === true, trailblazer: body.trailblazer === true };
        });
    }

    /**
     * 读称呼配置。
     * @returns Promise<{ nickname: string, callPreference: string, address: string }>
     */
    function fetchAddress() {
      return fetch(ADDRESS_API, { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          return {
            nickname: String(body.nickname || ''),
            callPreference: String(body.callPreference || ''),
            address: String(body.address || '')
          };
        });
    }

    /**
     * 写称呼偏好（或昵称）。
     * @param field - 'callPreference' / 'nickname'。
     * @param value - 新值，空串表示清除。
     * @returns Promise<{ nickname, callPreference, address }>
     */
    function saveAddress(field, value) {
      return fetch(ADDRESS_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ field: field, value: value })
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
          return {
            nickname: String(body.nickname || ''),
            callPreference: String(body.callPreference || ''),
            address: String(body.address || '')
          };
        });
    }

    //#region 编辑最后一条用户消息

    /** 会话服务（apply 里注入；没有就不挂这个功能）。 */
    var sessionsScope = null;
    /** DOM 补丁的观察者。 */
    var editObserver = null;
    /** rAF 合并：一次重渲染会触发成百上千条 mutation。 */
    var editFrame = 0;

    /**
     * 当前会话（没有就 undefined）。
     * @returns 会话对象或 undefined。
     */
    function currentSession() {
      try {
        var list = sessionsScope && sessionsScope.sessions && sessionsScope.sessions.list;
        var snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null;
        if (!snapshot || snapshot.current === undefined) return undefined;
        return snapshot.byId[snapshot.current];
      } catch (err) {
        return undefined;
      }
    }

    /**
     * 当前会话是不是「纯文本对话模式」。只认预设 id 里带 chat 的会话 ——
     * 工作模式带 shell / 文件工具，编辑历史这种事不该在那里悄悄发生。
     * @param session - 会话对象。
     * @returns 是否允许编辑。
     */
    function isChatSession(session) {
      try {
        var preset = session && session.projectionValues ? session.projectionValues.agentPreset : undefined;
        return typeof preset === 'string' && preset.toLowerCase().indexOf('chat') !== -1;
      } catch (err) {
        return false;
      }
    }

    /**
     * 页面是浅色还是深色（决定铅笔图标要不要反色）。
     * @returns 浅色返回 true。
     */
    function isLightTheme() {
      try {
        var bg = window.getComputedStyle(document.body).backgroundColor || '';
        var m = /rgba?\(([^)]+)\)/.exec(bg);
        if (m === null) return false;
        var parts = m[1].split(',').map(function (x) { return Number(x); });
        var lum = (parts[0] * 0.299 + parts[1] * 0.587 + parts[2] * 0.114);
        return lum > 140;
      } catch (err) {
        return false;
      }
    }

    /** 往页面塞一次样式（按钮、弹层、提示条）。 */
    function injectEditStyles() {
      if (document.getElementById('dsh-cyrene-edit-style') !== null) return;
      var style = document.createElement('style');
      style.id = 'dsh-cyrene-edit-style';
      style.textContent = [
        '.' + EDIT_BTN_CLASS + '{display:inline-flex;align-items:center;justify-content:center;',
        'width:22px;height:22px;margin:0 2px;padding:0;border:none;border-radius:6px;',
        'background:transparent;cursor:pointer;opacity:.55;transition:opacity .12s ease,background .12s ease;}',
        '.' + EDIT_BTN_CLASS + ':hover{opacity:1;background:var(--dsw-alias-bg-module-platform);}',
        '.' + EDIT_BTN_CLASS + ' img{display:block;width:14px;height:14px;}',
        '.' + VERSION_BTN_CLASS + '{display:inline-flex;align-items:center;justify-content:center;',
        'min-width:18px;height:22px;margin:0;padding:0 3px;border:none;border-radius:6px;',
        'background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;',
        'font:inherit;font-size:13px;line-height:18px;opacity:.7;}',
        '.' + VERSION_BTN_CLASS + ':hover{opacity:1;background:var(--dsw-alias-bg-module-platform);}',
        '.dsh-cyrene-version-count{font:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary);',
        'padding:0 2px;white-space:nowrap;}',
        '.dsh-cyrene-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);',
        'background:rgba(24,24,24,.92);color:#fff;font-size:13px;line-height:20px;padding:8px 14px;',
        'border-radius:10px;z-index:2147483600;pointer-events:none;max-width:80vw;}'
      ].join('');
      document.head.appendChild(style);
    }

    /**
     * 底部提示条。
     * @param message - 文案。
     */
    function toast(message) {
      var el = document.createElement('div');
      el.className = 'dsh-cyrene-toast';
      el.textContent = String(message);
      document.body.appendChild(el);
      window.setTimeout(function () {
        if (el.parentNode !== null) el.parentNode.removeChild(el);
      }, 2400);
    }

    /**
     * 弹层：编辑最后一条用户消息。
     * @param text - 原文（预填）。
     * @param sessionId - 会话 id。
     */
    function openEditor(text, sessionId) {
      injectEditStyles();
      var old = document.querySelector('[' + EDIT_MODAL_ATTR + ']');
      if (old !== null && old.parentNode !== null) old.parentNode.removeChild(old);

      var overlay = document.createElement('div');
      overlay.setAttribute(EDIT_MODAL_ATTR, '');
      overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,.38);padding:16px;'
      ].join('');

      var panel = document.createElement('div');
      panel.style.cssText = [
        'width:min(560px,92vw);max-height:82vh;display:flex;flex-direction:column;gap:10px;',
        'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);',
        'border:0.5px solid var(--dsw-alias-border-l2);border-radius:14px;padding:16px;',
        'box-shadow:0 18px 48px rgba(0,0,0,.32);font:inherit;'
      ].join('');

      var title = document.createElement('div');
      title.textContent = '编辑这条消息';
      title.style.cssText = 'font-size:14px;line-height:22px;font-weight:500;';

      var hint = document.createElement('div');
      hint.textContent = '「保存」只改这一句，后面的回复留着；「保存并撤回后续」会把这条之后的内容一并撤回（原文仍留在会话日志里）。';
      hint.style.cssText = 'font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);';

      var area = document.createElement('textarea');
      area.value = text;
      area.rows = 6;
      area.style.cssText = [
        'width:100%;box-sizing:border-box;min-height:132px;resize:vertical;font:inherit;font-size:13px;',
        'line-height:20px;padding:10px;border-radius:10px;outline:none;',
        'background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);',
        'border:0.5px solid var(--dsw-alias-border-l2);'
      ].join('');

      var footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
      var pill = function (label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = [
          'font:inherit;font-size:13px;line-height:20px;padding:5px 14px;border-radius:14px;cursor:pointer;',
          'border:none;background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);'
        ].join('');
        return b;
      };
      var cancel = pill('取消');
      var saveTruncate = pill('保存并撤回后续');
      var save = pill('保存');
      save.style.background = 'var(--dsw-alias-state-business-primary)';
      save.style.color = '#fff';
      footer.appendChild(cancel);
      footer.appendChild(saveTruncate);
      footer.appendChild(save);

      panel.appendChild(title);
      panel.appendChild(hint);
      panel.appendChild(area);
      panel.appendChild(footer);
      overlay.appendChild(panel);

      function close() {
        if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
      }

      function submit(mode) {
        var next = area.value.trim();
        if (next === '') { toast('消息不能为空'); return; }
        var label = save.textContent;
        save.disabled = true;
        saveTruncate.disabled = true;
        cancel.disabled = true;
        (mode === 'truncate' ? saveTruncate : save).textContent = '保存中…';
        fetch(EDIT_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, text: next, mode: mode })
        })
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
            close();
            toast('已修改');
            /*
             * 主机写的是表面替换，正常情况下前端会收到事件并重渲染。
             * 万一这一版前端没跟上（替换的旧节点不在可见窗口里等），
             * 1.5 秒后检查一下新文本到没到、没到就刷新一次页面。
             */
            window.setTimeout(function () {
              var rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
              var lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
              var shown = lastRow !== null ? (lastRow.textContent || '') : '';
              if (shown.indexOf(next.slice(0, 24)) === -1) window.location.reload();
            }, 1500);
          })
          .catch(function (err) {
            save.disabled = false;
            saveTruncate.disabled = false;
            cancel.disabled = false;
            save.textContent = label;
            saveTruncate.textContent = '保存并撤回后续';
            toast(String((err && err.message) || err));
          });
      }

      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        /* Ctrl/Cmd+Enter = 只改这一句（更保守的那个）；撤回后续得显式点。 */
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit('keep'); }
      }

      cancel.addEventListener('click', close);
      save.addEventListener('click', function () { submit('keep'); });
      saveTruncate.addEventListener('click', function () { submit('truncate'); });
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) close();
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }

    /**
     * 打开编辑器：先问主机「这条能不能改」，再预填原文。
     */
    function startEdit() {
      var session = currentSession();
      if (session === undefined) { toast('先打开一个会话'); return; }
      if (!isChatSession(session)) return;
      var sessionId = String(session.id || '');
      if (sessionId === '') { toast('拿不到当前会话'); return; }
      fetch(EDIT_API + '?session=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          if (body.canEdit !== true) { toast(body.reason || '这条消息现在不能编辑'); return; }
          openEditor(String(body.text || ''), sessionId);
        })
        .catch(function (err) { toast(String((err && err.message) || err)); });
    }

    /**
     * 拉版本链（2 秒内复用缓存）。失败就当作没有版本，不打扰用户。
     * @param sessionId - 会话 id。
     */
    function refreshVersions(sessionId) {
      var now = Date.now();
      if (versionsState.loading) return;
      if (versionsState.sessionId === sessionId && now - versionsState.at < 2000) return;
      versionsState.loading = true;
      fetch(EDIT_API + '?session=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          versionsState = {
            sessionId: sessionId,
            at: Date.now(),
            versions: body && Array.isArray(body.versions) ? body.versions : [],
            currentIndex: body && Number.isInteger(body.currentIndex) ? body.currentIndex : -1,
            loading: false
          };
          scheduleEditPatch();
        })
        .catch(function () {
          versionsState = { sessionId: sessionId, at: Date.now(), versions: [], currentIndex: -1, loading: false };
        });
    }

    /**
     * 切到某一版（写历史：再 append 一次单节点替换）。
     * @param sessionId - 会话 id。
     * @param targetSeq - 目标版本的事件 seq。
     */
    function switchVersion(sessionId, targetSeq) {
      toast('切换中…');
      fetch(EDIT_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, targetSeq: targetSeq })
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '切换失败');
          versionsState.at = 0;
          versionsState.loading = false;
          scheduleEditPatch();
          toast('已切到这一版');
          window.setTimeout(function () { patchEditButtons(); }, 600);
        })
        .catch(function (err) { toast(String((err && err.message) || err)); });
    }

    /** 版本角标里的序号（1 起）。 */
    function versionLabel(index, total) {
      return (index + 1) + '/' + total;
    }

    /**
     * 往最后一条用户消息的操作区塞铅笔按钮（其它行清掉）。
     * 幂等：React 重渲染把按钮冲掉之后，下一轮 mutation 会补回来。
     */
    function patchEditButtons() {
      var rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
      var last = rows.length > 0 ? rows[rows.length - 1] : null;
      /* 提交回显 / 待发队列里的消息还没进日志，先不给编辑入口。 */
      if (last !== null && (last.getAttribute('data-submission-echo') !== null || last.getAttribute('data-pending-steering') !== null)) {
        last = null;
      }
      var session = currentSession();
      var allowed = last !== null && isChatSession(session);
      var sessionId = allowed ? String(session.id || '') : '';
      if (allowed) refreshVersions(sessionId);

      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var owner = row === last && allowed;
        var existing = row.querySelectorAll(
          '.' + EDIT_BTN_CLASS + ',.' + VERSION_BTN_CLASS + ',.dsh-cyrene-version-count'
        );
        for (var j = 0; j < existing.length; j += 1) {
          if (!owner && existing[j].parentNode !== null) existing[j].parentNode.removeChild(existing[j]);
        }
        if (!owner) continue;
        /* 已经有一个就不重复塞（每轮 mutation 都会进来）。 */
        if (row.querySelector('.' + EDIT_BTN_CLASS) !== null) continue;
        var host = row.querySelector('[class*="actions"]') || row;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = EDIT_BTN_CLASS;
        button.title = '编辑这条消息';
        button.setAttribute('aria-label', '编辑这条消息');
        var img = document.createElement('img');
        img.src = EDIT_ICON;
        img.alt = '';
        if (isLightTheme()) img.style.filter = 'invert(1)';
        button.appendChild(img);
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          startEdit();
        });

        /* 有历史版本时，在铅笔前面加 ‹ 1/2 ›。 */
        var chain = versionsState.sessionId === sessionId ? versionsState.versions : [];
        if (chain.length > 1) {
          var index = versionsState.currentIndex;
          var count = document.createElement('span');
          count.className = 'dsh-cyrene-version-count';
          count.textContent = versionLabel(index, chain.length);
          var prev = document.createElement('button');
          prev.type = 'button';
          prev.className = VERSION_BTN_CLASS;
          prev.textContent = '‹';
          prev.title = '切回上一版';
          prev.disabled = index <= 0;
          prev.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            switchVersion(sessionId, chain[index - 1].seq);
          });
          var next = document.createElement('button');
          next.type = 'button';
          next.className = VERSION_BTN_CLASS;
          next.textContent = '›';
          next.title = '切到下一版';
          next.disabled = index >= chain.length - 1;
          next.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            switchVersion(sessionId, chain[index + 1].seq);
          });
          host.appendChild(prev);
          host.appendChild(count);
          host.appendChild(next);
        }
        host.appendChild(button);
      }
    }

    /** 合并到下一帧再补一次按钮（mutation 太密，逐条跑会卡）。 */
    function scheduleEditPatch() {
      if (editFrame !== 0) return;
      editFrame = window.requestAnimationFrame(function () {
        editFrame = 0;
        try { patchEditButtons(); } catch (err) { /* 补丁失败不该打断页面 */ }
      });
    }

    /** 装观察者：DOM 一变就补按钮（只在纯文本对话模式里真的加东西）。 */
    function watchEditDom() {
      injectEditStyles();
      scheduleEditPatch();
      if (editObserver !== null) return;
      editObserver = new MutationObserver(function () { scheduleEditPatch(); });
      editObserver.observe(document.body, { childList: true, subtree: true });
    }

    //#endregion

    /**
     * 设置行：「称呼偏好」输入框。
     * @param props - 槽位传入的 `{ t }`。
     * @returns React 元素。
     */
    function AddressRow(props) {
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key; };
      var profilePair = react.useState(null);
      var profile = profilePair[0];
      var setProfile = profilePair[1];
      var draftPair = react.useState('');
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var errorPair = react.useState('');
      var error = errorPair[0];
      var setError = errorPair[1];

      function apply(next) {
        setProfile(next);
        setDraft(next.callPreference);
      }

      react.useEffect(function () {
        var alive = true;
        fetchAddress()
          .then(function (next) { if (alive) apply(next); })
          .catch(function (err) { if (alive) setError(String((err && err.message) || err)); });
        return function () { alive = false; };
      }, []);

      function commit() {
        if (profile === null) return;
        var value = draft.trim();
        if (value === profile.callPreference) return;
        setError('');
        saveAddress('callPreference', value)
          .then(function (next) { apply(next); })
          .catch(function (err) { setError(String((err && err.message) || err)); });
      }

      var hint = profile === null
        ? t('addressLoading')
        : (profile.callPreference !== ''
          ? t('addressOn') + '「' + profile.address + '」'
          : t('addressOff') + '「' + profile.address + '」');

      return react.createElement(
        'div',
        { style: rowStyle },
        react.createElement(
          'div',
          { style: rowTextStyle },
          react.createElement('div', { style: titleStyle }, t('addressTitle')),
          react.createElement('div', { style: descStyle }, hint),
          error ? react.createElement('div', { style: errorStyle }, error) : null
        ),
        react.createElement('input', {
          type: 'text',
          value: draft,
          placeholder: t('addressPlaceholder'),
          'aria-label': t('addressTitle'),
          style: inputStyle,
          disabled: profile === null,
          onChange: function (event) { setDraft(String(event.target.value)); },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setDraft(profile === null ? '' : profile.callPreference);
          }
        })
      );
    }

    /**
     * 设置行：「角色扮演模式」开关。
     * @param props - 槽位传入的 `{ t }`。
     * @returns React 元素。
     */
    function RoleplayRow(props) {
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key; };
      var statePair = react.useState(null); // null = 还没读到
      var enabled = statePair[0];
      var setEnabled = statePair[1];
      var trailPair = react.useState(false);
      var trailblazer = trailPair[0];
      var setTrailblazer = trailPair[1];
      var busyPair = react.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var errorPair = react.useState('');
      var error = errorPair[0];
      var setError = errorPair[1];

      react.useEffect(function () {
        var alive = true;
        fetchEnabled()
          .then(function (value) {
            if (!alive) return;
            setEnabled(value.enabled);
            setTrailblazer(value.trailblazer);
          })
          .catch(function (err) { if (alive) setError(String((err && err.message) || err)); });
        return function () { alive = false; };
      }, []);

      function toggle() {
        if (busy || enabled === null) return;
        var next = !enabled;
        setBusy(true);
        setError('');
        saveEnabled({ enabled: next })
          .then(function (value) {
            setEnabled(value.enabled);
            setTrailblazer(value.trailblazer);
          })
          .catch(function (err) { setError(String((err && err.message) || err)); })
          .then(function () { setBusy(false); });
      }

      function toggleTrailblazer() {
        if (busy || enabled !== true) return;
        var next = !trailblazer;
        setBusy(true);
        setError('');
        saveEnabled({ trailblazer: next })
          .then(function (value) {
            setEnabled(value.enabled);
            setTrailblazer(value.trailblazer);
          })
          .catch(function (err) { setError(String((err && err.message) || err)); })
          .then(function () { setBusy(false); });
      }

      var checked = enabled === true;
      var trailOn = trailblazer === true;

      function switchEl(ariaLabel, isOn, disabled, onClick) {
        return react.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': isOn,
          'aria-label': ariaLabel,
          title: ariaLabel,
          disabled: disabled,
          style: isOn ? Object.assign({}, switchStyle, switchOnStyle) : switchStyle,
          onClick: onClick
        }, react.createElement('span', {
          style: isOn ? Object.assign({}, knobStyle, knobOnStyle) : knobStyle
        }));
      }

      var children = [
        react.createElement(
          'div',
          { key: 'main', style: rowStyle },
          react.createElement(
            'div',
            { style: rowTextStyle },
            react.createElement('div', { style: titleStyle }, t('title')),
            react.createElement('div', { style: descStyle }, checked ? t('onHint') : t('offHint')),
            error ? react.createElement('div', { style: errorStyle }, error) : null
          ),
          switchEl(t('title'), checked, busy || enabled === null, toggle)
        )
      ];

      /*
       * 依赖开关：只在角色扮演模式**开着**时才出现。
       * 关掉模式后这一行直接消失 —— 免得人以为"开拓者"是个独立功能。
       */
      if (checked) {
        children.push(react.createElement(
          'div',
          { key: 'trailblazer', style: Object.assign({}, rowStyle, { paddingLeft: '16px', borderBottom: 'none' }) },
          react.createElement(
            'div',
            { style: rowTextStyle },
            react.createElement('div', { style: titleStyle }, t('trailblazerTitle')),
            react.createElement('div', { style: descStyle }, trailOn ? t('trailblazerOn') : t('trailblazerOff'))
          ),
          switchEl(t('trailblazerTitle'), trailOn, busy, toggleTrailblazer)
        ));
      }

      return react.createElement('div', null, children);
    }

    /**
     * 设置行：手动检查更新。
     *
     * 只做「查」和「显示」，不自动安装：本插件用 link: 安装在本地仓库里，
     * 更新就是去那个目录 git pull。查询走宿主 `/cyrene-update-api`，
     * 宿主有 24 小时缓存；本行初始化时只取本地版本，不联网。
     * @param props - 槽位传入的 `{ t }`。
     * @returns React 元素。
     */
    function UpdateRow(props) {
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key; };
      var infoPair = react.useState({
        current: '', latest: '', hasUpdate: false, url: '', busy: false, error: '', checked: false
      });
      var info = infoPair[0];
      var setInfo = infoPair[1];

      function patch(next) {
        setInfo(function (prev) {
          var out = {};
          for (var k in prev) out[k] = prev[k];
          for (var j in next) out[j] = next[j];
          return out;
        });
      }

      react.useEffect(function () {
        var alive = true;
        fetch(UPDATE_API + '?meta=1', { headers: { accept: 'application/json' } })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (alive && data && data.ok === true) patch({ current: String(data.current || '') });
          })
          .catch(function () { /* 拿不到版本也不影响按钮 */ });
        return function () { alive = false; };
      }, []);

      function check() {
        if (info.busy) return;
        patch({ busy: true, error: '', checked: false });
        fetch(UPDATE_API + '?force=1', { headers: { accept: 'application/json' } })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) || t('updateFailed'));
            patch({
              current: String(data.current || info.current),
              latest: String(data.latest || ''),
              hasUpdate: data.hasUpdate === true,
              url: String(data.url || ''),
              busy: false,
              checked: true
            });
          })
          .catch(function (err) {
            patch({ busy: false, error: String((err && err.message) || err), checked: true });
          });
      }

      var buttonStyle = {
        flex: 'none',
        padding: '6px 14px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        lineHeight: '18px',
        cursor: info.busy ? 'default' : 'pointer',
        opacity: info.busy ? 0.6 : 1
      };

      var children = [
        react.createElement('div', { key: 'text', style: rowTextStyle },
          react.createElement('div', { style: titleStyle }, t('updateTitle')),
          react.createElement('div', { style: descStyle }, t('updateDesc')),
          react.createElement('div', { style: descStyle },
            (info.current ? t('updateCurrent') + ' v' + info.current + '　' : '') +
            t('updateManualHint')
          ),
          info.checked
            ? react.createElement('div', {
              key: 'result',
              style: info.error ? errorStyle : descStyle
            }, info.error
              ? t('updateFailed') + '：' + info.error
              : info.hasUpdate
                ? t('updateAvailable') + ' v' + info.latest + (info.url ? '　' : '')
                : t('updateLatest'))
            : null,
          info.checked && info.hasUpdate && info.url
            ? react.createElement('a', {
              key: 'link',
              href: info.url,
              target: '_blank',
              rel: 'noreferrer',
              style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: '12px', lineHeight: '18px' }
            }, info.url)
            : null
        ),
        react.createElement('button', {
          key: 'check',
          type: 'button',
          style: buttonStyle,
          disabled: info.busy,
          onClick: check
        }, info.busy ? t('updateChecking') : t('updateCheck'))
      ];
      return react.createElement('div', { style: rowStyle }, children);
    }

    /** 需要的主机侧服务：槽位、文案、会话（编辑按钮要靠它认当前会话）。 */
    var inject = ['slots', 'locale', 'sessions'];

    /**
     * 注册文案与设置行。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: {
            title: '角色扮演模式',
            onHint: '已开启：每一轮回复都会带场景描述、你的动作描述与你的外貌描述（叙述＋对话）。',
            offHint: '平常聊天。开着她会按角色扮演推进：每轮都写场景、动作和样子。',
            addressTitle: '称呼偏好',
            addressPlaceholder: '例如：伙伴（留空时用昵称）',
            addressLoading: '正在读取…',
            addressOn: '她这样叫你：',
            trailblazerTitle: '默认对方是开拓者',
            trailblazerOn: '已开启：这场戏里你就是开拓者 —— 她认得你，不会问「你是谁」。',
            trailblazerOff: '关闭：不预设身份，她按你说的来（说自己是别人也照办）。',
            addressOff: '留空，用昵称：',
            updateTitle: '检查更新',
            updateDesc: '只查询 GitHub 上的最新 Release，不会自动安装；更新方式是在仓库目录里 git pull。',
            updateCurrent: '当前版本',
            updateManualHint: '点右侧按钮手动检查。',
            updateCheck: '检查更新',
            updateChecking: '检查中…',
            updateLatest: '已是最新版本。',
            updateAvailable: '有新版',
            updateFailed: '检查失败',
          },
          en: {
            title: 'Role-play mode',
            onHint: 'On: every reply includes a scene description, your action, and your appearance (narration + dialogue).',
            offHint: 'Plain chat. Turn it on and each reply narrates the scene, her actions, and how she looks.',
            addressTitle: 'Preferred address',
            addressPlaceholder: 'e.g. partner (falls back to your nickname)',
            addressLoading: 'Loading…',
            addressOn: 'She calls you: ',
            trailblazerTitle: 'Assume you are the Trailblazer',
            trailblazerOn: 'On: in this role-play you are the Trailblazer; she knows you and will not ask who you are.',
            trailblazerOff: 'Off: no assumed identity; she follows whatever you say.',
            addressOff: 'Empty — using your nickname: ',
            updateTitle: 'Check for updates',
            updateDesc: 'Queries the latest GitHub Release only; nothing is installed automatically. Update with git pull in the repo directory.',
            updateCurrent: 'Current version',
            updateManualHint: 'Use the button to check manually.',
            updateCheck: 'Check',
            updateChecking: 'Checking…',
            updateLatest: 'You are up to date.',
            updateAvailable: 'New version',
            updateFailed: 'Check failed',
          }
        });
      }, 'dsh-cyrene: locale');

      /*
       * 编辑按钮：先抓住会话服务，再挂 DOM 观察者。
       * 放在 ctx.effect 里返回清理函数 —— 插件被热替换 / 禁用时把观察者摘掉。
       */
      ctx.effect(function () {
        sessionsScope = { sessions: ctx.sessions };
        watchEditDom();
        return function () {
          sessionsScope = null;
          if (editObserver !== null) {
            editObserver.disconnect();
            editObserver = null;
          }
          if (editFrame !== 0) {
            window.cancelAnimationFrame(editFrame);
            editFrame = 0;
          }
        };
      }, 'dsh-cyrene: edit button');

      /* 称呼偏好：排在角色扮演开关之前（先定"怎么叫"，再定"怎么演"）。 */
      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'cyrene-address',
          order: 44,
          locale: NS
        }, AddressRow);
      });

      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'cyrene-roleplay',
          order: 45,
          locale: NS
        }, RoleplayRow);
      });

      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'cyrene-update',
          order: 46,
          locale: NS
        }, UpdateRow);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
